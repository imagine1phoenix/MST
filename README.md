# 📦 Blockchain-Verified Smart Delivery Terminal

> **Two-Factor Multi-Signature IoT Escrow with GPS Geofencing & Cold-Chain Auditing**  
> **Target Track:** MST × Robotics Track (MST Blockchain Buildathon)  
> **Document & Build Version:** 3.0.0

---

## 🌟 Overview

The **MST Smart Delivery Terminal** solves the last-mile delivery oracle problem by combining a physical IoT verification terminal (Newrro Neurick ESP32-S3 + STM32) with a Two-Factor Multi-Signature (Multi-Sig) smart contract on the **MST Blockchain Testnet**.

### The Two-Factor Multi-Sig Mechanism

Funds locked in escrow are settled **only** when two independent cryptographic keys are validated:

| Key | Verification Type | Executor | Method |
|:---:|:---|:---|:---|
| **Key 1** | **Physical Hardware Proof** | Neurick IoT Terminal | RFID card scan within GPS geofence radius |
| **Key 2** | **Digital Human Approval** | Recipient | Cryptographic signature via BridgeKey Web3 Wallet |

Upon completion, 95% of the escrow is automatically paid to the courier and a **5% $MSTC cashback reward** is refunded to the customer.

---

## 🏗️ Repository Structure

```
MST/
├── contracts/        # Hardhat project with MultiSigDelivery.sol & unit tests
├── firmware/         # Newrro Neurick ESP32-S3 Arduino firmware (RFID, GPS, Sensors, Servo)
├── relay/            # Node.js backend relay server connecting IoT hardware to MST Blockchain
└── frontend/         # React + Vite Web3 DApp with BridgeKey integration
```

---

## 🌐 MST Blockchain Network Configuration

- **Network Name:** MST Testnet
- **RPC URL:** `https://testnetrpc.mstblockchain.com`
- **Chain ID:** `91562037` (`0x5752035`)
- **Currency Symbol:** `MSTC`
- **Block Explorer:** [MSTScan](https://testnet.mstscan.com)
- **Token Faucet:** [Masterstroke Academy Faucet](https://faucet.masterstroke.academy)

---

## 🚀 Quickstart Guide

### 1. Smart Contracts (`/contracts`)

```bash
cd contracts
npm install
npx hardhat test # Runs all 11 unit tests
```

To deploy to MST Testnet:
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Put your funded BridgeKey wallet private key into `PRIVATE_KEY`.
3. Run:
   ```bash
   npx hardhat run scripts/deploy.js --network mstTestnet
   ```
   *(This automatically synchronizes the contract address and ABI to `/relay` and `/frontend`)*.

---

### 2. Node.js Relay Server (`/relay`)

```bash
cd relay
npm install
npm start
```
Runs on `http://localhost:5001`. Provides endpoints for hardware scans, sensor telemetry, and blockchain interaction.

---

### 3. Frontend Web3 DApp (`/frontend`)

```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:3000`:
- Connect your **BridgeKey** (or MetaMask) wallet.
- If you're on a different network, the DApp automatically prompts you to switch to **MST Testnet**.
- Create deliveries, test the live telemetry monitor, simulate terminal scans, and sign Key 2 approvals!

---

### 4. Firmware (`/firmware`)

Open `firmware/MultiSigTerminal.ino` in the **Arduino IDE**:
- Select Board: `ESP32S3 Dev Module`
- Configure `Flash Size: 16MB`, `PSRAM: OPI PSRAM`, `USB CDC On Boot: Enabled`
- Update `WIFI_SSID`, `WIFI_PASSWORD`, and `RELAY_HOST`
- Upload over USB-C to the Newrro Neurick board.

---

## 🛡️ Pinout Reference (Neurick 40-Pin P1 Header)

- **RC522 RFID (SPI):** SDA→IO10, SCK→IO12, MOSI→IO11, MISO→IO13, RST→IO6
- **NEO-6M GPS (UART):** TX→IO17, RX→IO18
- **HC-SR04 Ultrasonic:** Trig→IO15, Echo→IO16 (3.3V divider)
- **DHT22 Temperature:** Data→IO5
- **MQ135 Gas Sensor:** Analog→IO4 (ADC1)
- **OLED Display:** IO8 (SDA), IO9 (SCL) @ Address `0x3C`
- **MG995 Servo Latch:** Neurick Servo Port 1 (`nr.servo`)
