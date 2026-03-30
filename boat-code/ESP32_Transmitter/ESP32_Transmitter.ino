#include <TinyGPS++.h>
#include <HardwareSerial.h>
#include <SPI.h>
#include <LoRa.h>
#include <math.h>

// 1. SET DEMO MODE HERE (true for indoor testing, false for real GPS outside)
#define DEMO_MODE true

// --- PIN DEFINITIONS ---
// LoRa
#define SS    5
#define RST   14
#define DIO0  2

// Alerts
#define LED_PIN    4
#define BUZZER_PIN 15

// --- ZONE THRESHOLDS ---
const float DANGER_KM  = 10.0;
const float WARNING_KM = 20.0;

// IMBL boundary coordinates (Palk Strait) — matches dashboard
float boundaryLats[] = {9.00, 9.17, 9.35, 9.52, 9.72, 9.95, 10.22, 10.47};
float boundaryLons[] = {79.35, 79.43, 79.49, 79.57, 79.67, 79.82, 79.97, 80.12};
int numPoints = 8;

// Simulated route — stays in open Palk Strait water (west of IMBL)
// Steps 1-5: SAFE  |  Steps 6-9: WARNING  |  Steps 10-12: DANGER  |  Steps 13-15: returning
float simLats[] = {
  9.80, 9.77, 9.73, 9.70, 9.65,
  9.60, 9.55, 9.50, 9.46, 9.42,
  9.39, 9.38, 9.42, 9.50, 9.60
};
float simLons[] = {
  79.30, 79.32, 79.33, 79.35, 79.37,
  79.40, 79.42, 79.44, 79.46, 79.48,
  79.50, 79.51, 79.47, 79.42, 79.36
};
int simStep = 0;

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

// Non-blocking blink state (matches receiver)
unsigned long lastBlinkTime = 0;
bool ledState = false;
String currentZone = "SAFE";

// Calculate real-world distance
float haversineDistance(float lat1, float lon1, float lat2, float lon2) {
  const float R = 6371.0;
  float dLat = radians(lat2 - lat1);
  float dLon = radians(lon2 - lon1);
  float a = sin(dLat/2)*sin(dLat/2) + cos(radians(lat1)) * cos(radians(lat2)) * sin(dLon/2)*sin(dLon/2);
  return R * 2 * atan2(sqrt(a), sqrt(1-a));
}

// Find closest boundary
float distanceToBoundary(float curLat, float curLon) {
  float minDist = 99999.0;
  for (int i = 0; i < numPoints; i++) {
    float d = haversineDistance(curLat, curLon, boundaryLats[i], boundaryLons[i]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// Hardware Alerts — matches receiver updateHardware() exactly
void updateAlert() {
  unsigned long now = millis();

  if (currentZone == "DANGER") {
    digitalWrite(LED_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    ledState = true;

  } else if (currentZone == "WARNING") {
    digitalWrite(BUZZER_PIN, LOW);
    if (now - lastBlinkTime >= 500) {
      lastBlinkTime = now;
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState ? HIGH : LOW);
    }

  } else {
    digitalWrite(LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
    ledState = false;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  
  gpsSerial.begin(9600, SERIAL_8N1, 16, 17);
  
  // Initialize LoRa
  LoRa.setPins(SS, RST, DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println("❌ LoRa init failed! Check Boat wiring.");
    while (1);
  }
  Serial.println("✅ AEGIS Boat Device Ready! Broadcasting...");
}

void loop() {
  float currentLat, currentLon;
  
  if (DEMO_MODE) {
    currentLat = simLats[simStep];
    currentLon = simLons[simStep];
    simStep = (simStep + 1) % 15;
  } else {
    while (gpsSerial.available())
      gps.encode(gpsSerial.read());
    
    if (!gps.location.isValid()) {
      Serial.println("Waiting for GPS fix...");
      delay(2000);
      return;
    }
    currentLat = gps.location.lat();
    currentLon = gps.location.lng();
  }
  
  float dist = distanceToBoundary(currentLat, currentLon);
  currentZone = (dist > WARNING_KM) ? "SAFE" : (dist > DANGER_KM) ? "WARNING" : "DANGER";
  updateAlert();
  
  String zone = currentZone;
  
  Serial.printf("Lat: %.4f | Lon: %.4f | Dist: %.2fkm | Zone: %s\n", currentLat, currentLon, dist, zone.c_str());
  
  // Transmit over LoRa (Exact format the Base Station expects)
  LoRa.beginPacket();
  LoRa.printf("BOAT1,%.4f,%.4f,%.2f,%s", currentLat, currentLon, dist, zone.c_str());
  LoRa.endPacket();
  
  // Smart wait: keeps LED/buzzer updating while waiting 2s for next packet
  unsigned long waitStart = millis();
  while (millis() - waitStart < 2000) {
    updateAlert();
    delay(20); 
  }
}