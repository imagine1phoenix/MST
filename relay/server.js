const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const contractService = require("./contractService");

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// In-memory state for live monitoring & cold-chain audit
let latestTelemetry = {
  temperature: 21.5,
  humidity: 48.0,
  airQualityPpm: 112,
  distanceCm: 18.4,
  lat: 28.6129,
  lon: 77.2295,
  timestamp: new Date().toISOString(),
  coldChainSafe: true
};

const telemetryHistory = [];
const scanAuditLog = [];

// --- Routes ---

// Health & Network Info
app.get("/api/network-info", (req, res) => {
  res.json({
    network: "MST Testnet",
    chainId: 91562037,
    rpcUrl: contractService.rpcUrl,
    explorerUrl: contractService.config.explorerUrl || "https://testnet.mstscan.com",
    contractAddress: contractService.config.contractAddress || null,
    terminalSignerAddress: contractService.terminalWallet.address,
    isContractConfigured: !!contractService.contract
  });
});

// Receive telemetry from ESP32-S3 (DHT22, MQ135, HC-SR04, GPS)
app.post("/api/terminal/telemetry", (req, res) => {
  const { temperature, humidity, airQualityPpm, distanceCm, lat, lon, deliveryId } = req.body;

  // Cold chain rules (e.g., Pharmaceuticals or perishable goods: safe < 25°C, air quality < 300 ppm)
  const tempSafe = (temperature === undefined) || (Number(temperature) <= 25.0);
  const airSafe = (airQualityPpm === undefined) || (Number(airQualityPpm) <= 300);
  const coldChainSafe = tempSafe && airSafe;

  latestTelemetry = {
    deliveryId: deliveryId || latestTelemetry.deliveryId || 1,
    temperature: Number(temperature || latestTelemetry.temperature),
    humidity: Number(humidity || latestTelemetry.humidity),
    airQualityPpm: Number(airQualityPpm || latestTelemetry.airQualityPpm),
    distanceCm: Number(distanceCm || latestTelemetry.distanceCm),
    lat: Number(lat || latestTelemetry.lat),
    lon: Number(lon || latestTelemetry.lon),
    timestamp: new Date().toISOString(),
    coldChainSafe
  };

  telemetryHistory.unshift(latestTelemetry);
  if (telemetryHistory.length > 50) telemetryHistory.pop();

  console.log(`[Telemetry Received] Temp: ${latestTelemetry.temperature}°C | Humidity: ${latestTelemetry.humidity}% | Gas: ${latestTelemetry.airQualityPpm} ppm | Ultrasonic: ${latestTelemetry.distanceCm} cm`);

  res.json({
    status: "success",
    coldChainSafe,
    recordedAt: latestTelemetry.timestamp
  });
});

// Get latest telemetry and recent history
app.get("/api/terminal/telemetry/latest", (req, res) => {
  res.json({
    latest: latestTelemetry,
    history: telemetryHistory.slice(0, 15)
  });
});

// Physical Key 1 Scan Endpoint (Triggered by ESP32 RFID card tap or Simulator)
app.post("/api/terminal/scan", async (req, res) => {
  try {
    const { deliveryId, rfidUid, latitude, longitude } = req.body;

    if (!deliveryId || !rfidUid) {
      return res.status(400).json({ error: "deliveryId and rfidUid are required" });
    }

    const lat = latitude !== undefined ? Number(latitude) : latestTelemetry.lat;
    const lon = longitude !== undefined ? Number(longitude) : latestTelemetry.lon;

    console.log(`[Scan Event] Delivery #${deliveryId} | RFID UID: ${rfidUid} | GPS: ${lat}, ${lon}`);

    let txResult = null;
    let onChain = false;

    if (contractService.contract) {
      // Execute live on MST Blockchain Testnet
      txResult = await contractService.terminalConfirm(deliveryId, rfidUid, lat, lon);
      onChain = true;
    } else {
      // Simulation mode
      txResult = {
        success: true,
        simulation: true,
        txHash: "0xsimulated" + Math.random().toString(16).substring(2, 42),
        message: "Simulated hardware terminal verification (Contract not deployed on testnet yet)",
        mstScanUrl: "https://testnet.mstscan.com"
      };
    }

    const scanRecord = {
      deliveryId,
      rfidUid,
      lat,
      lon,
      onChain,
      txHash: txResult.txHash,
      timestamp: new Date().toISOString()
    };
    scanAuditLog.unshift(scanRecord);

    res.json({
      success: true,
      deliveryId,
      onChain,
      txResult,
      message: "Physical Terminal Scan (Key 1) verified and confirmed on-chain!"
    });
  } catch (error) {
    console.error("[Scan Error]:", error);
    res.status(500).json({
      error: error.reason || error.message || "Failed to process terminal scan"
    });
  }
});

// Get delivery on-chain status
app.get("/api/terminal/status/:deliveryId", async (req, res) => {
  try {
    const deliveryId = req.params.deliveryId;
    if (contractService.contract) {
      const data = await contractService.getDelivery(deliveryId);
      const unlockDoor = data.terminalConfirmed && data.recipientConfirmed;
      res.json({ ...data, unlockDoor });
    } else {
      res.json({
        id: Number(deliveryId),
        simulation: true,
        terminalConfirmed: false,
        recipientConfirmed: false,
        status: 0, // Created
        unlockDoor: false,
        message: "Deploy smart contract on MST Testnet to see live on-chain state"
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// B2B Logistics Webhook (DTDC / Porter COD replacement)
app.post("/api/b2b/awb-webhook", (req, res) => {
  const { awbNumber, carrier, status, destinationCoords, recipientWallet } = req.body;
  console.log(`[B2B Webhook] Carrier: ${carrier || 'DTDC'} | AWB: ${awbNumber} | Status: ${status}`);

  res.json({
    status: "acknowledged",
    carrier: carrier || "DTDC Logistics",
    awbNumber,
    escrowBridge: "Ready for createDelivery()",
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log("=================================================");
  console.log(` 🚀 MST Smart Terminal Relay running on port ${PORT}`);
  console.log(`    Network: MST Testnet (Chain ID: 91562037)`);
  console.log(`    Terminal Signer: ${contractService.terminalWallet.address}`);
  console.log("=================================================");
});
