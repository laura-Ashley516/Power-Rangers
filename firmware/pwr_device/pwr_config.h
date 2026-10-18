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

const int PROTOCOL_VERSION   = 1;
const int MAX_MESSAGE_LEN    = 180;  // longest message allowed by the protocol
const int RX_LINE_BUFFER     = 200;  // a little bigger, so we can detect too-long lines
const int RX_QUEUE_LENGTH    = 48;   // how many incoming lines can wait for loop()
const uint16_t BLE_MTU       = 247;  // we ask for a big packet size (the app decides)
const uint32_t BLE_SEND_GAP_MS = 10; // pause after every notification we send
const uint32_t SCHEDULE_RX_TIMEOUT_MS = 30000;  // give up a half-received schedule after 30 s
const int NOTE_CHUNK_BYTES   = 120;  // raw bytes per "D|seq|base64" line (160 base64 chars)

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
