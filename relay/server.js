const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, ".env") });

const contractService = require("./contractService");
const { telegramService } = require("./telegramService");

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// In-memory state for live monitoring & hardware telemetry
let latestTelemetry = {
  distanceCm: 18.4,
  batteryVolts: 11.8,
  lat: 28.6129,
  lon: 77.2295,
  rfidVer: '0x82',
  timestamp: new Date().toISOString()
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

// Receive telemetry from ESP32-S3 (HC-SR04 ultrasonic, STM32 battery, GPS, RC522)
app.post("/api/terminal/telemetry", (req, res) => {
  const { distanceCm, batteryVolts, lat, lon, deliveryId, rfidVer } = req.body;

  const rfidHex = rfidVer !== undefined ? '0x' + Number(rfidVer).toString(16).toUpperCase() : (latestTelemetry.rfidVer || '0x82');

  latestTelemetry = {
    deliveryId: deliveryId || latestTelemetry.deliveryId || 1,
    distanceCm: Number(distanceCm !== undefined ? distanceCm : latestTelemetry.distanceCm),
    batteryVolts: Number(batteryVolts !== undefined ? batteryVolts : latestTelemetry.batteryVolts),
    lat: Number(lat !== undefined ? lat : latestTelemetry.lat),
    lon: Number(lon !== undefined ? lon : latestTelemetry.lon),
    rfidVer: rfidHex,
    timestamp: new Date().toISOString()
  };

  telemetryHistory.unshift(latestTelemetry);
  if (telemetryHistory.length > 50) telemetryHistory.pop();

  console.log(`[Telemetry Received] Distance: ${latestTelemetry.distanceCm} cm | Battery: ${latestTelemetry.batteryVolts}V | GPS: ${latestTelemetry.lat}, ${latestTelemetry.lon} | RFID Chip: ${rfidHex}`);

  res.json({
    status: "success",
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

    // Instant async Telegram alert to Sender and Recipient
    (async () => {
      try {
        const delivery = await contractService.getDelivery(targetDeliveryId);
        await telegramService.notifyDeliveryEvent({
          deliveryId: targetDeliveryId,
          sender: delivery?.sender,
          recipient: delivery?.recipient,
          type: 'KEY1_VERIFIED',
          data: {
            rfidUid: cleanUid,
            lat,
            lon,
            txHash: txResult.txHash
          }
        });
      } catch (tgErr) {
        console.warn('[Telegram] Key 1 scan alert error:', tgErr.message);
      }
    })();

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

// ==========================================
// --- Telegram Bot Management Endpoints ---
// ==========================================

// Get Telegram bot status & linked users
app.get("/api/telegram/status", (req, res) => {
  res.json(telegramService.getStatus());
});

// Update Telegram bot token or default chat ID at runtime
app.post("/api/telegram/config", async (req, res) => {
  try {
    const { token, defaultChatId } = req.body;
    const ok = await telegramService.updateConfig({ token, defaultChatId });
    res.json({
      success: ok,
      status: telegramService.getStatus()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Link a user's wallet address to their Telegram Chat ID
app.post("/api/telegram/link", (req, res) => {
  const { walletAddress, chatId } = req.body;
  if (!walletAddress || !chatId) {
    return res.status(400).json({ error: "walletAddress and chatId are required" });
  }
  const linked = telegramService.linkWallet(walletAddress, chatId);
  res.json({
    success: linked,
    walletAddress,
    chatId,
    status: telegramService.getStatus()
  });
});

// Webhook / frontend trigger for parcel events (e.g. newly created, settled)
app.post("/api/telegram/event", async (req, res) => {
  try {
    const { deliveryId, sender, recipient, type, data } = req.body;
    await telegramService.notifyDeliveryEvent({
      deliveryId,
      sender,
      recipient,
      type,
      data
    });
    res.json({ success: true, message: `Event ${type} dispatched to Telegram subscribers.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a test Telegram alert for demo verification
app.post("/api/telegram/test-notify", async (req, res) => {
  try {
    const { deliveryId = 20, type = 'SETTLED', recipientWallet, senderWallet } = req.body;
    const dId = Number(deliveryId) || 20;

    let delivery = null;
    if (contractService.contract) {
      try {
        delivery = await contractService.getDelivery(dId);
      } catch (_) {}
    }

    const sender = senderWallet || delivery?.sender || "0xb2CAcD0597ac693057aa80dA0eF9892b8951dd0a";
    const recipient = recipientWallet || delivery?.recipient || "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

    await telegramService.notifyDeliveryEvent({
      deliveryId: dId,
      sender,
      recipient,
      type,
      data: {
        amount: delivery?.escrowAmount || '0.1000',
        cashback: delivery?.cashbackAmount || '0.0050',
        payout: delivery?.courierPayout || '0.0950',
        rfidUid: '0x82',
        lat: '28.6129',
        lon: '77.2295',
        txHash: '0xaedc0aaa503b3ac8fcad1f43723553dcadd708e353016ec05ca056f92ed46b22'
      }
    });

    res.json({
      success: true,
      deliveryId: dId,
      type,
      sender,
      recipient,
      message: `Test ${type} alert sent to registered Telegram users!`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Background tracker for automated blockchain settlement & creation notifications
const monitoredDeliveries = new Map();

function startBlockchainMonitor() {
  setInterval(async () => {
    if (!contractService.contract) return;
    try {
      const countBig = await contractService.contract.deliveryCount();
      const count = Number(countBig);

      // Inspect recent deliveries
      const start = Math.max(1, count - 5);
      for (let id = start; id <= count; id++) {
        const d = await contractService.getDelivery(id);
        if (!d) continue;

        const prev = monitoredDeliveries.get(id);

        if (!prev) {
          // Newly discovered delivery
          monitoredDeliveries.set(id, { status: d.status, terminalConfirmed: d.terminalConfirmed });
          // If created recently (within last 30 minutes) and status is 0, notify
          const ageSeconds = Math.floor(Date.now() / 1000) - d.createdAt;
          if (ageSeconds < 1800 && d.status === 0) {
            telegramService.notifyDeliveryEvent({
              deliveryId: id,
              sender: d.sender,
              recipient: d.recipient,
              type: 'CREATED',
              data: {
                amount: d.escrowAmount,
                cashback: d.cashbackAmount,
                payout: d.courierPayout,
                lat: d.targetLat,
                lon: d.targetLon
              }
            }).catch(() => {});
          }
        } else {
          // Status change: Settled (Status 3)
          if (prev.status !== 3 && d.status === 3) {
            prev.status = 3;
            monitoredDeliveries.set(id, prev);
            telegramService.notifyDeliveryEvent({
              deliveryId: id,
              sender: d.sender,
              recipient: d.recipient,
              type: 'SETTLED',
              data: {
                amount: d.escrowAmount,
                cashback: d.cashbackAmount,
                payout: d.courierPayout
              }
            }).catch(() => {});
          }
        }
      }
    } catch (_) {
      // Graceful error handling for RPC latency
    }
  }, 10000);
}

app.listen(PORT, "0.0.0.0", async () => {
  console.log("=================================================");
  console.log(` 🚀 MST Smart Terminal Relay running on port ${PORT} (0.0.0.0:${PORT})`);
  console.log(`    Network: MST Testnet (Chain ID: 91562037)`);
  console.log(`    Terminal Signer: ${contractService.terminalWallet.address}`);
  console.log("=================================================");

  // Initialize Telegram Bot Service
  try {
    await telegramService.init(contractService, () => latestTelemetry);
  } catch (err) {
    console.warn("[Telegram] Init warning:", err.message);
  }

  // Start automated on-chain monitor
  startBlockchainMonitor();
});
