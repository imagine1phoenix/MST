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
 *  - Locker Servo:       Neurick Servo Port 1 (6.5V rail via STM32 / Newrick library)
 * ============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <SPI.h>
#include <MFRC522.h>
#include <TinyGPSPlus.h>
#include <DHT.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Newrick.h>

// Forward declarations for C++ compiler
float readUltrasonicCm();
void handleRfidTap();
void sendTelemetry(float distanceCm);
void pollDeliveryStatus();
void updateOled(const char* line1, const char* line2);
void connectWiFi();

// --- Configuration ---
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* RELAY_HOST    = "http://192.168.1.100:5001"; // IP of Node.js Relay Server
const int   DELIVERY_ID   = 1;

// --- Pin Definitions (P1 Expansion Header) ---
#define PIN_RFID_SS     10
#define PIN_RFID_RST    6
#define PIN_RFID_MOSI   11
#define PIN_RFID_SCK    12
#define PIN_RFID_MISO   13

#define PIN_US_TRIG     15
#define PIN_US_ECHO     16

#define PIN_DHT_DATA    5
#define DHTTYPE         DHT22

#define PIN_MQ135_ANALOG 4 // Safe ADC1 pin

#define PIN_GPS_RX      17 // Connects to GPS Module TX
#define PIN_GPS_TX      18 // Connects to GPS Module RX

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
  // NOTE: According to Neurick manual, nr.begin() starts I2C on SDA=8, SCL=9 at 400kHz.
  // Never call Wire.begin() separately!
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
  SPI.begin(PIN_RFID_SCK, PIN_RFID_MISO, PIN_RFID_MOSI, PIN_RFID_SS);
  rfid.PCD_Init();
  Serial.println("[Terminal] RC522 RFID Reader Ready.");

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
    handleRfidTap();
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }

  // Check onboard user button from STM32 motion controller (Newrick library)
  if (nr.buttonState > 0) {
    Serial.println("\n[Button] Onboard user button pressed! Triggering manual status & telemetry sync...");
    updateOled("SYNCING STATUS", "Checking Blockchain...");
    pollDeliveryStatus();
    sendTelemetry(distanceCm);
    delay(400); // Simple debounce
  }

  // Periodic Environmental Telemetry Reporting (every 4 seconds)
  if (millis() - lastTelemetryTime > 4000) {
    lastTelemetryTime = millis();
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
  if (duration == 0) return 400.0;
  return (duration * 0.0343) / 2.0;
}

void handleRfidTap() {
  String uidStr = "";
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) uidStr += "0";
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

    String json = "{\"deliveryId\":" + String(DELIVERY_ID) +
                  ",\"rfidUid\":\"" + uidStr + "\"" +
                  ",\"latitude\":" + String(currentLat, 6) +
                  ",\"longitude\":" + String(currentLon, 6) + "}";

    int httpCode = http.POST(json);
    if (httpCode == 200) {
      Serial.println("[Relay] Scan accepted! Key 1 confirmed on MST Blockchain.");
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

  if (isnan(temp)) temp = 22.0;
  if (isnan(hum)) hum = 48.0;

  float batteryVolts = 12.0;
  if (nr.updateSensors()) {
    batteryVolts = nr.batteryVolts;
  }

  Serial.printf("[Telemetry] T: %.1fC | H: %.1f%% | Gas: %d | Dist: %.1f cm | Batt: %.2fV | GPS Fix: %s\n",
                temp, hum, rawGas, distanceCm, batteryVolts, hasGpsFix ? "YES" : "SIMULATED");

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(String(RELAY_HOST) + "/api/terminal/telemetry");
    http.addHeader("Content-Type", "application/json");

    String json = "{\"deliveryId\":" + String(DELIVERY_ID) +
                  ",\"temperature\":" + String(temp, 1) +
                  ",\"humidity\":" + String(hum, 1) +
                  ",\"airQualityPpm\":" + String(rawGas) +
                  ",\"distanceCm\":" + String(distanceCm, 1) +
                  ",\"batteryVolts\":" + String(batteryVolts, 2) +
                  ",\"lat\":" + String(currentLat, 6) +
                  ",\"lon\":" + String(currentLon, 6) + "}";

    http.POST(json);
    http.end();
  }
}

void pollDeliveryStatus() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(String(RELAY_HOST) + "/api/terminal/status/" + String(DELIVERY_ID));
  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    // Check if unlocked / settled
    if (payload.indexOf("\"unlockDoor\":true") >= 0 || payload.indexOf("\"status\":3") >= 0) {
      if (!isDoorUnlocked) {
        isDoorUnlocked = true;
        isSettled = true;
        Serial.println("\n🎉 [SETTLEMENT] Multi-Sig Complete! Opening Locker Compartment.");
        nr.servo(90, 0, 0); // Rotate Servo 1 to 90 degrees (Latch Open)
        updateOled("DELIVERY SETTLED", "Compartment Open!");
      }
    }
  }
  http.end();
}

void updateOled(const char* line1, const char* line2) {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.println(line1);
  display.setCursor(0, 16);
  display.println(line2);
  display.display();
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
