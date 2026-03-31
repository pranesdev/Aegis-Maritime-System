const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios = require('axios');

// --- UPDATE THIS TO YOUR BASE STATION COM PORT ---
const port = new SerialPort({ path: 'COM5', baudRate: 115200 });
// -------------------------------------------------

const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

console.log("🔌 USB Serial Bridge Started! Listening to ESP32...");

parser.on('data', async (data) => {
    // Print exactly what the ESP32 is saying over USB
    console.log(`[ESP32]: ${data}`);
    
    // If the data contains our LoRa packet...
    if (data.includes('BOAT1,')) {
        // Extract the coordinates (e.g., from "Raw Data: BOAT1,9.3800,80.3000,13.34,WARNING")
        try {
            const rawString = data.split('BOAT1,')[1]; 
            const parts = rawString.split(',');
            
            if (parts.length >= 4) {
                const payload = {
                    lat: parseFloat(parts[0]),
                    lon: parseFloat(parts[1]),
                    distance: parseFloat(parts[2]),
                    zone: parts[3].trim()
                };

                // Send it directly to localhost (Bypasses all WiFi and Firewalls!)
                await axios.post('http://localhost:5000/api/location', payload);
                console.log("✅ Successfully bridged packet to local database!");
            }
        } catch (err) {
            console.error("⚠️ Failed to parse or send data:", err.message);
        }
    }
});

port.on('error', (err) => {
    console.error("❌ Serial Port Error (Is the Arduino Serial Monitor closed?):", err.message);
});