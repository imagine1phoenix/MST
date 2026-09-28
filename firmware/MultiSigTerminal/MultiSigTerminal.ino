/**
 * ============================================================================
 * Project: Blockchain-Verified Smart Delivery Terminal (MST Blockchain)
 * Hardware: Newrro Neurick Development Board (ESP32-S3 + STM32F103)
 * Target Track: MST × Robotics Track (MST Blockchain Buildathon)
 * ============================================================================
 * Sensors & Pinout:
 *  - RC522 RFID (SPI):   SDA->IO10, SCK->IO12, MOSI->IO11, MISO->IO13, RST->IO6
 *  - HC-SR04 Ultrasonic: Trig->IO15, Echo->IO16 (3.3V divider)
 *  - DHT22 Temp/Humidity: Data->IO5
 *  - MQ135 Gas Sensor:   Analog->IO4 (ADC1)
 *  - NEO-6M GPS (UART):  TX->IO17 (RX2), RX->IO18 (TX2)
 *  - SSD1306 OLED (I2C): IO8 (SDA), IO9 (SCL) @ Address 0x3C
 *  - Locker Servo:       Neurick Servo Port 1 (6.5V rail via STM32 / Newrick
 * library)
 * ============================================================================
 */

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <MFRC522.h>
#include <Newrick.h>
#include <SPI.h>
#include <TinyGPSPlus.h>
#include <WiFi.h>
#include <Wire.h>

// Forward declarations for C++ compiler
float readUltrasonicCm();
void handleRfidTap();
void sendTelemetry(float distanceCm);
void pollDeliveryStatus();
void updateOled(const char *line1, const char *line2);
void connectWiFi();
void syncDeliveryId();

// --- Configuration ---
const char *WIFI_SSID = "BMS_Buildathon";
const char *WIFI_PASSWORD = "Bmsce$2026$!";
const char *RELAY_HOST = "http://10.80.79.100:5001"; // Mac Relay IP
int currentDeliveryId = 8; // Synced dynamically from relay server

// --- Pin Definitions (Neurick Shield CN2, CN9, CN10) ---
#define PIN_RFID_SS 3     // SDA / Chip Select (CN2)
#define PIN_RFID_RST 15   // Reset (CN2)
#define PIN_RFID_MISO 16  // SPI Master In Slave Out (CN2)
#define PIN_RFID_MOSI 17  // SPI Master Out Slave In (CN2)
#define PIN_RFID_SCK 18   // SPI Clock (CN2)

#define PIN_US_TRIG 10    // Ultrasonic Trigger (CN9)
#define PIN_US_ECHO 11    // Ultrasonic Echo (CN9)

#define PIN_DHT_DATA 5
#define DHTTYPE DHT22

#define PIN_MQ135_ANALOG 4 // Safe ADC1 pin

#define PIN_GPS_RX 12 // Connects to GPS Module TX (CN10)
#define PIN_GPS_TX 13 // Connects to GPS Module RX (CN10)

// --- Hardware Objects ---
TinyGPSPlus gps;
Newrick nr;
Adafruit_SSD1306 display(128, 32, &Wire, -1);
MFRC522 rfid(PIN_RFID_SS, PIN_RFID_RST);
DHT dht(PIN_DHT_DATA, DHTTYPE);
HardwareSerial gpsSerial(2);

// --- State Variables ---
unsigned long lastTelemetryTime = 0;
unsigned long lastStatusPollTime = 0;
bool isKey1Confirmed = false;
bool isSettled = false;
bool isDoorUnlocked = false;

// Default GPS fallback coordinates if testing indoors without satellite lock
double currentLat = 28.612900;
double currentLon = 77.229500;
bool hasGpsFix = false;

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n[Terminal] Starting MST Smart Delivery Terminal...");

  // 1. Initialize Neurick Board & I2C Bus
  // NOTE: According to Neurick manual, nr.begin() starts I2C on SDA=8, SCL=9 at
  // 400kHz. Never call Wire.begin() separately!
  nr.begin();
  nr.servo(0, 0, 0); // Lock compartment latch initially

  // 2. Initialize 0.91" SSD1306 OLED (128x32)
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("[Warning] SSD1306 OLED not found at 0x3C");
  } else {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("MST SMART TERMINAL");
    display.println("Booting System...");
    display.display();
  }

  // 3. Initialize Ultrasonic Sensor
  pinMode(PIN_US_TRIG, OUTPUT);
  pinMode(PIN_US_ECHO, INPUT);

  // 4. Initialize DHT22
  dht.begin();

  // 5. Initialize NEO-6M GPS on HardwareSerial 2
  gpsSerial.begin(9600, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);

  // 6. Initialize RC522 RFID on Custom SPI Pins
  Serial.println("\n[Terminal] Initializing MFRC522 RFID reader...");
  updateOled("INIT RC522...", "Connecting SPI");

  // Hardware Reset pulse to RC522
  pinMode(PIN_RFID_RST, OUTPUT);
  digitalWrite(PIN_RFID_RST, LOW);
  delay(10);
  digitalWrite(PIN_RFID_RST, HIGH);
  delay(50);

  pinMode(PIN_RFID_SS, OUTPUT);
  digitalWrite(PIN_RFID_SS, HIGH);
  delay(10);

  SPI.begin(PIN_RFID_SCK, PIN_RFID_MISO, PIN_RFID_MOSI, PIN_RFID_SS);
  delay(50);

  rfid.PCD_Init();
  delay(50);

  // Boost antenna gain to maximum (48dB) for best range & sensitivity
  rfid.PCD_SetAntennaGain(rfid.RxGain_max);

  byte rfidVer = rfid.PCD_ReadRegister(rfid.VersionReg);
  Serial.printf("\n[RFID Diagnostic] MFRC522 Chip Version Register: 0x%02X\n", rfidVer);

  if (rfidVer == 0x91 || rfidVer == 0x92) {
    Serial.println("[RFID Status] SUCCESS: RC522 communicates properly over SPI (v" + String(rfidVer == 0x92 ? "2.0" : "1.0") + ")");
    updateOled("RC522: OK", "Reader Ready");
    delay(1000);
  } else if (rfidVer == 0x12) {
    Serial.println("[RFID Status] SUCCESS: RC522 clone detected (0x12) - communication OK");
    updateOled("RC522: OK", "Clone Ready");
    delay(1000);
  } else {
    // Retry once with soft reset if chip was busy
    rfid.PCD_Reset();
    delay(50);
    rfid.PCD_Init();
    delay(50);
    rfid.PCD_SetAntennaGain(rfid.RxGain_max);
    rfidVer = rfid.PCD_ReadRegister(rfid.VersionReg);
    Serial.printf("[RFID Diagnostic] Retry Version: 0x%02X\n", rfidVer);
    if (rfidVer == 0x91 || rfidVer == 0x92 || rfidVer == 0x12) {
      Serial.println("[RFID Status] SUCCESS: RC522 ready after reset!");
      updateOled("RC522: OK", "Reader Ready");
      delay(1000);
    } else {
      Serial.println("[RFID Warning] Could not read 0x91/0x92 from version reg. Check physical wiring.");
      updateOled("RC522: CHECK WIRE", "Check 3.3V & GND");
      delay(1500);
    }
  }

  // 7. Connect to WiFi
  connectWiFi();

  updateOled("AWAITING SCAN", "Hold RFID to Terminal");
}

void loop() {
  // Feed GPS serial parser
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  if (gps.location.isValid()) {
    currentLat = gps.location.lat();
    currentLon = gps.location.lng();
    hasGpsFix = true;
  }

  // Check Ultrasonic distance
  float distanceCm = readUltrasonicCm();

  // Check for RFID card tap
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    Serial.println("\n[RFID] >>> RF field detected card! Reading UID...");
    handleRfidTap();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    delay(500);
  }

  // Check onboard user button from STM32 motion controller (Newrick library)
  if (nr.buttonState > 0) {
    Serial.println("\n[Button] Onboard user button pressed! Triggering manual "
                   "status & telemetry sync...");
    byte ver = rfid.PCD_ReadRegister(rfid.VersionReg);
    Serial.printf("[RFID Health Check] Version Reg: 0x%02X %s\n", ver,
                  (ver == 0x92 || ver == 0x91 || ver == 0x12)
                      ? "(OK)"
                      : "(FAILED - CHECK WIRING)");
    updateOled("SYNCING STATUS", "Checking Blockchain...");
    pollDeliveryStatus();
    sendTelemetry(distanceCm);
    delay(400); // Simple debounce
  }

  // Periodic Environmental Telemetry Reporting (every 4 seconds)
  if (millis() - lastTelemetryTime > 4000) {
    lastTelemetryTime = millis();
    syncDeliveryId();
    sendTelemetry(distanceCm);
  }

  // Periodic Delivery Settlement Polling (every 5 seconds)
  if (millis() - lastStatusPollTime > 5000) {
    lastStatusPollTime = millis();
    pollDeliveryStatus();
  }

  delay(50);
}

// --- Sensor Read Functions ---

float readUltrasonicCm() {
  digitalWrite(PIN_US_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_US_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_US_TRIG, LOW);

  long duration = pulseIn(PIN_US_ECHO, HIGH, 30000); // 30ms timeout
  if (duration == 0)
    return 400.0;
  return (duration * 0.0343) / 2.0;
}

void handleRfidTap() {
  String uidStr = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10)
      uidStr += "0";
    uidStr += String(rfid.uid.uidByte[i], HEX);
  }
  uidStr.toUpperCase();
  Serial.println("\n[RFID] Scanned UID: " + uidStr);

  updateOled("RFID DETECTED", "Transmitting Key 1...");

  // Post scan event to Relay Server
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(String(RELAY_HOST) + "/api/terminal/scan");
    http.addHeader("Content-Type", "application/json");

    String json =
        "{\"deliveryId\":" + String(currentDeliveryId) + ",\"rfidUid\":\"" +
        uidStr + "\"" + ",\"latitude\":" + String(currentLat, 6) +
        ",\"longitude\":" + String(currentLon, 6) + ",\"source\":\"hardware\"}";

    int httpCode = http.POST(json);
    if (httpCode == 200) {
      Serial.println(
          "[Relay] Scan accepted! Key 1 confirmed on MST Blockchain.");
      isKey1Confirmed = true;
      updateOled("KEY 1 VERIFIED", "Awaiting Recipient");
    } else {
      String resp = http.getString();
      Serial.println("[Relay Error " + String(httpCode) + "]: " + resp);
      updateOled("SCAN REJECTED", "Check Geofence/UID");
      delay(2000);
      updateOled("AWAITING SCAN", "Hold RFID to Terminal");
    }
    http.end();
  }
}

void sendTelemetry(float distanceCm) {
  float temp = dht.readTemperature();
  float hum = dht.readHumidity();
  int rawGas = analogRead(PIN_MQ135_ANALOG);

  if (isnan(temp))
    temp = 22.0;
  if (isnan(hum))
    hum = 48.0;

  float batteryVolts = 12.0;
  if (nr.updateSensors()) {
    batteryVolts = nr.batteryVolts;
  }

  byte currentRfidVer = rfid.PCD_ReadRegister(rfid.VersionReg);

  Serial.printf("[Telemetry] T: %.1fC | H: %.1f%% | Gas: %d | Dist: %.1f cm | "
                "Batt: %.2fV | RFID: 0x%02X\n",
                temp, hum, rawGas, distanceCm, batteryVolts, currentRfidVer);

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(String(RELAY_HOST) + "/api/terminal/telemetry");
    http.addHeader("Content-Type", "application/json");

    String json = "{\"deliveryId\":" + String(currentDeliveryId) +
                  ",\"temperature\":" + String(temp, 1) +
                  ",\"humidity\":" + String(hum, 1) +
                  ",\"airQualityPpm\":" + String(rawGas) +
                  ",\"distanceCm\":" + String(distanceCm, 1) +
                  ",\"batteryVolts\":" + String(batteryVolts, 2) +
                  ",\"rfidVer\":" + String(currentRfidVer) +
                  ",\"lat\":" + String(currentLat, 6) +
                  ",\"lon\":" + String(currentLon, 6) + "}";

    http.POST(json);
    http.end();
  }
}

void pollDeliveryStatus() {
  if (WiFi.status() != WL_CONNECTED)
    return;

  HTTPClient http;
  http.begin(String(RELAY_HOST) + "/api/terminal/status/" +
             String(currentDeliveryId));
  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    // Check if unlocked / settled
    if (payload.indexOf("\"unlockDoor\":true") >= 0 ||
        payload.indexOf("\"status\":3") >= 0) {
      if (!isDoorUnlocked) {
        isDoorUnlocked = true;
        isSettled = true;
        Serial.println("\n🎉 [SETTLEMENT] Multi-Sig Complete! Opening Locker "
                       "Compartment.");
        nr.servo(90, 0, 0); // Rotate Servo 1 to 90 degrees (Latch Open)
        updateOled("DELIVERY SETTLED", "Compartment Open!");
      }
    }
  }
  http.end();
}

void updateOled(const char *line1, const char *line2) {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.println(line1);
  display.setCursor(0, 16);
  display.println(line2);
  display.display();
}

void syncDeliveryId() {
  if (WiFi.status() != WL_CONNECTED)
    return;

  HTTPClient http;
  http.begin(String(RELAY_HOST) + "/api/terminal/hardware-scan-state");
  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    // Parse "deliveryId":N from JSON
    int idx = payload.indexOf("\"deliveryId\"");
    if (idx >= 0) {
      int colonIdx = payload.indexOf(':', idx);
      if (colonIdx >= 0) {
        int commaIdx = payload.indexOf(',', colonIdx);
        int braceIdx = payload.indexOf('}', colonIdx);
        int endIdx = (commaIdx >= 0 && (braceIdx < 0 || commaIdx < braceIdx))
                         ? commaIdx
                         : braceIdx;
        if (endIdx > colonIdx) {
          String valStr = payload.substring(colonIdx + 1, endIdx);
          valStr.trim();
          int newId = valStr.toInt();
          if (newId > 0 && newId != currentDeliveryId) {
            Serial.printf("[Sync] Delivery ID updated: %d -> %d\n",
                          currentDeliveryId, newId);
            currentDeliveryId = newId;
            updateOled("DELIVERY SYNCED",
                       ("ID: " + String(currentDeliveryId)).c_str());
            delay(500);
            updateOled("AWAITING SCAN", "Hold RFID to Terminal");
          }
        }
      }
    }
  }
  http.end();
}

void connectWiFi() {
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 20) {
    delay(500);
    Serial.print(".");
    tries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[WiFi] Running in standalone/offline mode.");
  }
}
