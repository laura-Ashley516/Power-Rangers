// =====================================================================
//  pwr_config.h  -  ALL pins, timings and limits in one place
// =====================================================================
//  Change values here, not in the other files.
//
//  The pin numbers are PROPOSED. Check them against the real circuit
//  (see hardware/wiring/pins.md) before wiring anything.
// =====================================================================
#pragma once

#include <Arduino.h>

// ---------------------------------------------------------------------
//  Display: ILI9341 240x320 TFT on the ESP32 hardware SPI bus (VSPI)
//  SPI bus pins are fixed by the ESP32: SCK 18, MOSI 23, MISO 19.
//  The microSD card shares the same SPI bus, with its own CS pin.
// ---------------------------------------------------------------------
const int PIN_TFT_CS  = 5;
const int PIN_TFT_DC  = 2;
const int PIN_TFT_RST = 4;
const int PIN_SD_CS   = 21;   // microSD chip select (proposed)

const uint32_t SD_SPI_FREQUENCY = 4000000;   // 4 MHz: slow but reliable

// ---------------------------------------------------------------------
//  Microphone: INMP441 (I2S). Connect its L/R pin to GND (left channel).
// ---------------------------------------------------------------------
const int PIN_MIC_SCK = 26;   // INMP441 SCK  (bit clock, BCLK)
const int PIN_MIC_WS  = 25;   // INMP441 WS   (word select, LRCL)
const int PIN_MIC_SD  = 33;   // INMP441 SD   (data out of the mic)

// ---------------------------------------------------------------------
//  Buttons: one side to the GPIO, other side to GND.
//  We use the internal pull-up, so a pressed button reads LOW.
// ---------------------------------------------------------------------
const int PIN_BTN_RECORD = 32;   // hold to record a voice note
const int PIN_BTN_NEXT   = 27;   // show the next day
const int PIN_BTN_DONE   = 14;   // stop the reminder / back to today

const uint32_t BUTTON_DEBOUNCE_MS = 30;

// ---------------------------------------------------------------------
//  ESP32-C5 (the team's new board, Nov 2026): the pins above are for the
//  classic ESP32 (ESP32 Dev Module). The C5 only has GPIO 0..28, so the
//  microphone (33) and the record button (32) do not exist there, and its
//  SPI pins are different. The firmware compiles for the C5 (core 3.3.x,
//  Huge APP partition), but the hardware team must choose C5 pins from the
//  real wiring before flashing, here, inside this #if.
// ---------------------------------------------------------------------
#if defined(CONFIG_IDF_TARGET_ESP32C5)
#pragma message "ESP32-C5 build: set the C5 pin numbers in pwr_config.h before flashing (the classic ESP32 pins are used now)."
#endif

// ---------------------------------------------------------------------
//  Vibration motor: ALWAYS through a transistor (or MOSFET) + flyback
//  diode. Never connect the motor directly to the GPIO pin.
// ---------------------------------------------------------------------
const int PIN_MOTOR = 13;

// ---------------------------------------------------------------------
//  Bluetooth (must match docs/protocol.md)
// ---------------------------------------------------------------------
#define DEVICE_NAME       "PWR Reminder"   // no personal names: Bluetooth names are visible to anyone nearby
#define SERVICE_UUID      "12345678-1234-1234-1234-1234567890ab"
#define RX_CHARACTERISTIC "12345678-1234-1234-1234-1234567890ac"   // app -> device (write)
#define TX_CHARACTERISTIC "12345678-1234-1234-1234-1234567890ad"   // device -> app (notify)

const int PROTOCOL_VERSION   = 3;   // v2: clock time per activity, quiet times. v3: planner copy (STATE_*), Wi-Fi with end-to-end encryption
const int MAX_MESSAGE_LEN    = 180;  // longest message allowed by the protocol
const int RX_LINE_BUFFER     = 200;  // a little bigger, so we can detect too-long lines
const int RX_QUEUE_LENGTH    = 48;   // how many incoming lines can wait for loop()
const uint16_t BLE_MTU       = 247;  // we ask for a big packet size (the app decides)
const uint32_t BLE_SEND_GAP_MS = 10; // pause after every notification we send
const uint32_t SCHEDULE_RX_TIMEOUT_MS = 30000;  // give up a half-received schedule after 30 s
const int NOTE_CHUNK_BYTES   = 120;  // raw bytes per "D|seq|base64" line (160 base64 chars)
const uint32_t STATE_MAX_BYTES = 256UL * 1024UL;   // v3: largest planner copy (STATE_START), docs/protocol.md
const uint32_t STATE_RX_TIMEOUT_MS = 30000;        // give up a half-received planner copy after 30 s without a line

// ---------------------------------------------------------------------
//  Wi-Fi (through an MQTT broker, docs/protocol.md + docs/wifi-plan.md)
//  1 = Bluetooth AND Wi-Fi. 0 = Bluetooth only (no extra libraries needed).
// ---------------------------------------------------------------------
#ifndef PWR_USE_WIFI
#define PWR_USE_WIFI 1
#endif

// Setup hotspot, opened when the device has no saved Wi-Fi (or NEXT + DONE held at power-on).
#define PWR_SETUP_AP_NAME "PWR-Setup"
const uint32_t WIFI_SETUP_OPEN_MS = 10UL * 60UL * 1000UL;   // the setup hotspot closes after 10 min

// Broker defaults shown on the setup page. NEVER put real passwords here (the repo is public):
// the broker username and password are typed on the setup page and saved on the device only.
#define PWR_MQTT_DEFAULT_HOST ""
const uint16_t PWR_MQTT_DEFAULT_PORT = 8883;       // MQTT over TLS

const uint16_t MQTT_BUFFER_SIZE   = 1500;  // PubSubClient buffer: a 1024-byte line + 28 bytes, as base64 (x4/3), + topic
const int      WIFI_PAYLOAD       = 1024;  // the "<payload>" HELLO reports over Wi-Fi (no "+" pieces)
const uint16_t MQTT_KEEPALIVE_S   = 60;    // a voice recording (15 s) blocks loop(): keep this well above that
const uint16_t MQTT_SOCKET_TIMEOUT_S = 5;
const uint32_t MQTT_RETRY_MIN_MS  = 2000;           // reconnect backoff: 2 s, 4 s, 8 s ... up to 60 s
const uint32_t MQTT_RETRY_MAX_MS  = 60000;
const uint32_t WIFI_RETRY_MS      = 30000;          // ask the router again every 30 s while Wi-Fi is down

// TLS. 0 = check the broker's certificate with PWR_MQTT_CA_CERT below (use this with the real broker).
//      1 = do NOT check it (setInsecure). Only for a first test with a public test broker.
// The messages are end-to-end encrypted either way; without the check, someone on the network
// could pretend to be the broker and read the broker username and password.
#ifndef PWR_MQTT_INSECURE
#define PWR_MQTT_INSECURE 0
#endif

// PLACEHOLDER: paste the broker's ROOT CA certificate here (PEM text, from the broker's
// console or docs, e.g. EMQX Serverless "CA certificate"). It is public, not a secret.
// Keep the BEGIN/END lines and the line breaks. Example of the shape:
//   const char PWR_MQTT_CA_CERT[] =
//     "-----BEGIN CERTIFICATE-----\n"
//     "MIID...first line of the certificate...\n"
//     "...one string per line...\n"
//     "-----END CERTIFICATE-----\n";
// While it is empty (and PWR_MQTT_INSECURE is 0) the device does not connect to the broker
// and says so on the Serial Monitor.
const char PWR_MQTT_CA_CERT[] = "";

// ---------------------------------------------------------------------
//  Schedule
// ---------------------------------------------------------------------
const int MAX_ACTIVITIES = 35;

// ---------------------------------------------------------------------
//  Reminders (times are LOCAL time, in minutes after midnight)
// ---------------------------------------------------------------------
const int MORNING_START_MIN   = 9 * 60;    // 09:00
const int AFTERNOON_START_MIN = 13 * 60;   // 13:00
const int EVENING_START_MIN   = 18 * 60;   // 18:00
const int REMINDER_LEAD_MIN   = 60;        // remind 60 minutes before a block starts

const int      REMINDER_MAX_BUZZES = 3;          // buzz at most 3 times per reminder
const uint32_t REMINDER_REPEAT_MS  = 5UL * 60UL * 1000UL;   // 5 minutes between buzzes

const int      VIBRATION_PULSES   = 3;     // one "buzz" = 3 short pulses
const uint32_t VIBRATION_ON_MS    = 300;
const uint32_t VIBRATION_OFF_MS   = 300;

// ---------------------------------------------------------------------
//  Voice recording
// ---------------------------------------------------------------------
const uint32_t MIC_SAMPLE_RATE      = 8000;   // Hz, mono (see docs/protocol.md)
const uint32_t RECORD_MAX_MS        = 15000;  // 15 seconds maximum
const uint32_t RECORD_MIN_MS        = 500;    // shorter presses are ignored
// The INMP441 sends 24-bit audio inside 32-bit words. Shifting right by
// 16 gives plain 16-bit audio; shifting by 14 gives the same audio x4
// (a modest gain, because the mic is quiet). Lower number = louder.
const int MIC_SHIFT = 14;

// ---------------------------------------------------------------------
//  Screen behaviour
// ---------------------------------------------------------------------
const uint32_t MESSAGE_SHOW_MS    = 2500;     // "Note saved" message time
// After NEXT was used, go back to today's page after this long without
// a button press (only when the clock is set). 0 = never.
const uint32_t RETURN_TO_TODAY_MS = 2UL * 60UL * 1000UL;
// The first-try sketch changed day every 10 s by itself.
// 0 = off (default: NEXT changes the day). Set to 10000 to bring it back.
const uint32_t AUTO_ROTATE_MS     = 0;
