# 🤖 Newrro Neurick ESP32-S3 Firmware Guide

This firmware turns the **Newrro Neurick Development Board** into an IoT Multi-Sig Smart Delivery Terminal for the MST Blockchain.

---

## 🛠️ Arduino IDE Setup

Follow the **NEURICK Educational Kit Manual** instructions:

1. **Board Manager:** Install `esp32` by Espressif Systems.
2. **Select Board:** `ESP32S3 Dev Module`
3. **Tools Configuration:**
   - **Flash Size:** `16MB (128Mb)`
   - **PSRAM:** `OPI PSRAM`
   - **USB CDC On Boot:** `Enabled`
   - **Upload Speed:** `921600`
   - **Serial Baud Rate:** `115200`
4. **Libraries Required:**
   - `Newrick` (supplied with the Neurick kit — copy folder to `Documents/Arduino/libraries/Newrick`)
   - `MFRC522` by GithubCommunity
   - `TinyGPSPlus` by Mikal Hart
   - `DHT sensor library` by Adafruit
   - `Adafruit SSD1306` & `Adafruit GFX Library`

---

## 🔌 Hardware Wiring & P1 Header Pinout

Connect your sensors to the Neurick 40-pin P1 expansion header according to the pinout below:

| Sensor / Module | Signal | ESP32 GPIO | Header Pin | Notes |
|-----------------|--------|------------|------------|-------|
| **RC522 RFID** | SDA (SS) | **GPIO 10** | Pin 26 | 3.3V logic |
| **RC522 RFID** | SCK | **GPIO 12** | Pin 30 | 3.3V logic |
| **RC522 RFID** | MOSI | **GPIO 11** | Pin 28 | 3.3V logic |
| **RC522 RFID** | MISO | **GPIO 13** | Pin 32 | 3.3V logic |
| **RC522 RFID** | RST | **GPIO 6** | Pin 6 | Digital reset |
| **HC-SR04** | Trig | **GPIO 15** | Pin 10 | 3.3V trigger output |
| **HC-SR04** | Echo | **GPIO 16** | Pin 12 | ⚠️ Level-shift 5V to 3.3V |
| **DHT22** | Data | **GPIO 5** | Pin 4 | Digital 1-wire |
| **MQ135 Gas** | Analog | **GPIO 4** | Pin 2 | ADC1 safe with Wi-Fi |
| **NEO-6M GPS** | TX | **GPIO 17** | Pin 14 | Connects to ESP32 RX |
| **NEO-6M GPS** | RX | **GPIO 18** | Pin 16 | Connects to ESP32 TX |
| **0.91" OLED** | I2C | **GPIO 8/9**| Internal | Address 0x3C via `nr.begin()` |
| **MG995 Servo** | Signal | **Servo 1**| Dedicated | 6.5V rail via STM32 (`nr.servo`) |

---

## ⚡ How it Works with the Smart Contract

1. **Environmental Monitoring:** HC-SR04 detects package presence; DHT22 and MQ135 audit cold-chain safety and report to the Node.js relay.
2. **Key 1 (Hardware Verification):** Recipient taps RFID card. The ESP32 reads card UID and GPS coordinates from NEO-6M, transmitting to the relay server.
3. **Smart Lock Release:** When the smart contract confirms both Key 1 and Key 2 (BridgeKey digital approval), the relay returns `unlockDoor: true`. The ESP32 instructs the STM32 motion controller (`nr.servo(90, 0, 0)`) to mechanically unlock the compartment door for package retrieval!
