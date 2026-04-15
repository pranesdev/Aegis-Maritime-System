#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <LoRa.h>
#include <WiFiClientSecure.h> // <-- CRITICAL NEW INCLUDE FOR RENDER HTTPS

// --- UPDATE THESE WITH YOUR DETAILS ---
const char* WIFI_SSID = "OnePlus 11 5G FD58";
const char* WIFI_PASSWORD = "pranes2007";

// Replace this with your actual live Render URL! (Make sure it has https://)
const char* SERVER_URL = "https://aegis-backend-3w2p.onrender.com/api/location";
// --------------------------------------

// LoRa Pins
#define SS    5
#define RST   14
#define DIO0  2

// LED & Buzzer Pins
#define LED_PIN    4
#define BUZZER_PIN 15

// Current zone state
String currentZone = "SAFE";

// Non-blocking blink state
unsigned long lastBlinkTime = 0;
bool ledState = false;

// Drive LED + buzzer based on zone (call every loop tick)
void updateHardware() {
  unsigned long now = millis();

  if (currentZone == "DANGER") {
    // LED solid ON, buzzer ON
    digitalWrite(LED_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    ledState = true;

  } else if (currentZone == "WARNING") {
    // LED blinks at 500 ms, buzzer OFF
    digitalWrite(BUZZER_PIN, LOW);
    if (now - lastBlinkTime >= 500) {
      lastBlinkTime = now;
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState ? HIGH : LOW);
    }

  } else {
    // SAFE — everything off
    digitalWrite(LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
    ledState = false;
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(LED_PIN,    OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(LED_PIN,    LOW);
  digitalWrite(BUZZER_PIN, LOW);

  // 1. Connect to WiFi
  Serial.print("Connecting to WiFi");
  
  // ========================================================
  // THE MAGIC DNS FIX: Force ESP32 to use Google's brain
  // ========================================================
  IPAddress googleDNS(8, 8, 8, 8);
  WiFi.config(INADDR_NONE, INADDR_NONE, INADDR_NONE, googleDNS); 
  // ========================================================

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");
  Serial.print("ESP32 IP Address: ");
  Serial.println(WiFi.localIP());

  // 2. Initialize LoRa
  LoRa.setPins(SS, RST, DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println("LoRa init failed. Check wiring!");
    while (1); // Halt if LoRa fails
  }
  Serial.println("LoRa Receiver Ready! Waiting for boat data...");
}

void loop() {
  // Always run hardware update so blink is non-blocking
  updateHardware();

  int packetSize = LoRa.parsePacket();

  if (packetSize) {
    String incoming = "";
    while (LoRa.available()) {
      incoming += (char)LoRa.read();
    }

    Serial.print("\nReceived LoRa packet: ");
    Serial.println(incoming);
    // Incoming format from boat: BOAT1,9.3000,80.5000,25.00,SAFE

    // 3. Parse the comma-separated data
    int firstComma  = incoming.indexOf(',');
    int secondComma = incoming.indexOf(',', firstComma + 1);
    int thirdComma  = incoming.indexOf(',', secondComma + 1);
    int fourthComma = incoming.indexOf(',', thirdComma + 1);

    if (firstComma > 0 && fourthComma > 0) {
      String boatId = incoming.substring(0, firstComma); // Extracted Boat ID!
      String lat  = incoming.substring(firstComma + 1, secondComma);
      String lon  = incoming.substring(secondComma + 1, thirdComma);
      String dist = incoming.substring(thirdComma + 1, fourthComma);
      String zone = incoming.substring(fourthComma + 1);
      zone.trim();

      // 4. Update hardware immediately based on received zone
      currentZone = zone;
      Serial.println("Zone: " + currentZone);

      // 5. Build JSON and POST to Render backend
      // Included boatId here in case your new MongoDB schema needs it
      String jsonPayload = "{\"boatId\":\"" + boatId + "\",\"lat\":" + lat + ",\"lon\":" + lon + ",\"distance\":" + dist + ",\"zone\":\"" + zone + "\"}";
      Serial.println("Sending to Cloud: " + jsonPayload);

      if (WiFi.status() == WL_CONNECTED) {
        
        // --- THIS IS THE MAGIC RENDER HTTPS FIX ---
        WiFiClientSecure client;
        client.setInsecure(); // Skips checking the Render SSL certificate (perfect for testing)
        HTTPClient http;
        
        http.begin(client, SERVER_URL); 
        http.addHeader("Content-Type", "application/json");

        int httpResponseCode = http.POST(jsonPayload);

        if (httpResponseCode > 0) {
          Serial.printf("Cloud HTTP Response: %d\n", httpResponseCode);
        } else {
          Serial.printf("Cloud HTTP Error: %d\n", httpResponseCode);
        }
        http.end();
      } else {
        Serial.println("WiFi Disconnected. Reconnecting...");
        WiFi.reconnect();
      }
    }
  }
}