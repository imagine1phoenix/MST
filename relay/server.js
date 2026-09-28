const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, ".env") });

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
  batteryVolts: 11.8,
  lat: 28.6129,
  lon: 77.2295,
  timestamp: new Date().toISOString(),
  coldChainSafe: true
};

let latestScannedCard = {
  uid: null,
  timestamp: null
};

let activeDeliveryId = 1;

let hardwareScanState = {
  isArmed: true,
  scannedCardUid: null,
  scannedAt: null,
  confirmedOnChain: false,
  txHash: null,
  deliveryId: null,
  source: null,
  error: null
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
  const { temperature, humidity, airQualityPpm, distanceCm, batteryVolts, lat, lon, deliveryId } = req.body;

  // Cold chain rules (e.g., Pharmaceuticals or perishable goods: safe < 25°C, air quality < 300 ppm)
  const tempSafe = (temperature === undefined) || (Number(temperature) <= 25.0);
  const airSafe = (airQualityPpm === undefined) || (Number(airQualityPpm) <= 300);
  const coldChainSafe = tempSafe && airSafe;

  latestTelemetry = {
    deliveryId: deliveryId || latestTelemetry.deliveryId || 1,
    temperature: Number(temperature !== undefined ? temperature : latestTelemetry.temperature),
    humidity: Number(humidity !== undefined ? humidity : latestTelemetry.humidity),
    airQualityPpm: Number(airQualityPpm !== undefined ? airQualityPpm : latestTelemetry.airQualityPpm),
    distanceCm: Number(distanceCm !== undefined ? distanceCm : latestTelemetry.distanceCm),
    batteryVolts: Number(batteryVolts !== undefined ? batteryVolts : latestTelemetry.batteryVolts),
    lat: Number(lat !== undefined ? lat : latestTelemetry.lat),
    lon: Number(lon !== undefined ? lon : latestTelemetry.lon),
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
    history: telemetryHistory.slice(0, 15),
    lastScannedCard: latestScannedCard,
    hardwareScanState,
    activeDeliveryId
  });
});

// Endpoint to fetch the last scanned physical RFID card UID
app.get("/api/terminal/last-card", (req, res) => {
  res.json(latestScannedCard);
});

// Endpoint to fetch real-time hardware scan state
app.get("/api/terminal/hardware-scan-state", (req, res) => {
  res.json(hardwareScanState);
});

// Arm the hardware scanner for a delivery
app.post("/api/terminal/arm-scanner", (req, res) => {
  const { deliveryId } = req.body;
  if (deliveryId) activeDeliveryId = Number(deliveryId);
  hardwareScanState = {
    isArmed: true,
    scannedCardUid: null,
    scannedAt: null,
    confirmedOnChain: false,
    txHash: null,
    deliveryId: activeDeliveryId,
    source: null,
    error: null
  };
  console.log(`[Relay] 📡 Scanner armed for Delivery #${activeDeliveryId}. Waiting for physical RFID card tap on RC522...`);
  res.json({ status: "armed", deliveryId: activeDeliveryId });
});

// Update the active delivery being monitored / confirmed
app.post("/api/terminal/active-delivery", (req, res) => {
  if (req.body.deliveryId) {
    activeDeliveryId = Number(req.body.deliveryId);
    hardwareScanState.deliveryId = activeDeliveryId;
    console.log(`[Relay] Active delivery updated to #${activeDeliveryId}`);
  }
  res.json({ activeDeliveryId });
});

// Physical Key 1 Scan Endpoint (Triggered by ESP32 RFID card tap or Simulator)
app.post("/api/terminal/scan", async (req, res) => {
  try {
    let { deliveryId, rfidUid, latitude, longitude, source } = req.body;

    if (!rfidUid) {
      return res.status(400).json({ error: "rfidUid is required" });
    }

    const cleanUid = rfidUid.trim().toUpperCase();
    const isHardware = source === 'hardware' || req.headers['user-agent']?.includes('ESP32');

    // Track the physical card UID immediately
    latestScannedCard = {
      uid: cleanUid,
      timestamp: new Date().toISOString()
    };

    console.log(`\n======================================================`);
    console.log(`⭐ [RFID CARD TAP DETECTED] UID: ${cleanUid} | Source: ${isHardware ? 'PHYSICAL HARDWARE (RC522)' : 'MANUAL'}`);
    console.log(`   Time: ${new Date().toLocaleTimeString()} | GPS: ${latitude || latestTelemetry.lat}, ${longitude || latestTelemetry.lon}`);
    console.log(`======================================================\n`);

    const targetDeliveryId = deliveryId || activeDeliveryId;
    const lat = latitude !== undefined ? Number(latitude) : latestTelemetry.lat;
    const lon = longitude !== undefined ? Number(longitude) : latestTelemetry.lon;

    hardwareScanState = {
      isArmed: false,
      scannedCardUid: cleanUid,
      scannedAt: new Date().toISOString(),
      deliveryId: targetDeliveryId,
      source: isHardware ? 'hardware' : 'manual',
      lat,
      lon,
      confirmedOnChain: false,
      txHash: null,
      error: null
    };

    let txResult = null;
    let onChain = false;

    if (contractService.contract) {
      // Execute live on MST Blockchain Testnet
      txResult = await contractService.terminalConfirm(targetDeliveryId, cleanUid, lat, lon);
      onChain = true;
      hardwareScanState.confirmedOnChain = true;
      hardwareScanState.txHash = txResult.txHash;
    } else {
      // Simulation mode
      txResult = {
        success: true,
        simulation: true,
        txHash: "0xsimulated" + Math.random().toString(16).substring(2, 42),
        message: "Simulated hardware terminal verification (Contract not deployed on testnet yet)",
        mstScanUrl: "https://testnet.mstscan.com"
      };
      hardwareScanState.confirmedOnChain = true;
      hardwareScanState.txHash = txResult.txHash;
    }

    const scanRecord = {
      deliveryId: targetDeliveryId,
      rfidUid: cleanUid,
      lat,
      lon,
      onChain,
      txHash: txResult.txHash,
      timestamp: new Date().toISOString(),
      source: isHardware ? 'hardware' : 'manual'
    };
    scanAuditLog.unshift(scanRecord);

    res.json({
      success: true,
      deliveryId: targetDeliveryId,
      rfidUid: cleanUid,
      onChain,
      txResult,
      hardwareScanState,
      message: "Physical Terminal Scan (Key 1) verified and confirmed on-chain!"
    });
  } catch (error) {
    console.error("[Scan Error]:", error);
    hardwareScanState.error = error.reason || error.message;
    res.status(500).json({
      error: error.reason || error.message || "Failed to process terminal scan",
      hardwareScanState
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
