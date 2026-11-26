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
//  Display: 4-inch ILI9488, 320x480, write-only SPI.
// ---------------------------------------------------------------------
#if defined(CONFIG_IDF_TARGET_ESP32C5)
// DevKitC-1 header labels. GPIO0/1/24 are assigned to the microphone.
const int PIN_TFT_SCK = 6;
const int PIN_TFT_MOSI = 5;
const int PIN_TFT_CS = 10;
const int PIN_TFT_DC = 4;
const int PIN_TFT_RST = 8;
const int PIN_TOUCH_CS = 9;
const int PIN_TOUCH_MISO = 23;
#else
const int PIN_TFT_SCK = 18;
const int PIN_TFT_MOSI = 23;
const int PIN_TFT_CS = 5;
const int PIN_TFT_DC = 2;
const int PIN_TFT_RST = 4;
const int PIN_TOUCH_CS = 15;
const int PIN_TOUCH_MISO = 19;
#endif
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
//  The C5 microphone pins are defined in pwr_voice_c5.h. The classic
//  microphone, button, SD and motor assignments are for legacy sketches.
// ---------------------------------------------------------------------

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

// The relay's certificate is checked against these 5 public ROOT certificates (Nov 2026). Between them they
// cover the common MQTT relays: EMQX Serverless / EMQX Cloud (DigiCert), HiveMQ Cloud (Let's Encrypt = ISRG),
// AWS IoT and brokers on AWS (Amazon), and any broker with a Let's Encrypt certificate. So no certificate
// step is needed to set up a relay: only its host name (PWR-Setup page). They are public, not secrets.
// A relay signed by another root: add its root here (from the relay's docs or console), PEM text, BEGIN/END lines kept.
// mbedTLS reads all the certificates in this one string; about 6.5 KB of flash.
const char PWR_MQTT_CA_CERT[] =
  // ISRG Root X1 (valid until Jun  4 11:04:38 2035 GMT)
  "-----BEGIN CERTIFICATE-----\n"
  "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\n"
  "-----END CERTIFICATE-----\n"
  // ISRG Root X2 (valid until Sep 17 16:00:00 2040 GMT)
  "-----BEGIN CERTIFICATE-----\n"
  "MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQsw\n"
  "CQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2gg\n"
  "R3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00\n"
  "MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBT\n"
  "ZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYw\n"
  "EAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW\n"
  "+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9\n"
  "ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T\n"
  "AQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI\n"
  "zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdW\n"
  "tL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1\n"
  "/q4AaOeMSQ+2b1tbFfLn\n"
  "-----END CERTIFICATE-----\n"
  // DigiCert Global Root CA (valid until Nov 10 00:00:00 2031 GMT)
  "-----BEGIN CERTIFICATE-----\n"
  "MIIDrzCCApegAwIBAgIQCDvgVpBCRrGhdWrJWZHHSjANBgkqhkiG9w0BAQUFADBh\n"
  "MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3\n"
  "d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBD\n"
  "QTAeFw0wNjExMTAwMDAwMDBaFw0zMTExMTAwMDAwMDBaMGExCzAJBgNVBAYTAlVT\n"
  "MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j\n"
  "b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IENBMIIBIjANBgkqhkiG\n"
  "9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4jvhEXLeqKTTo1eqUKKPC3eQyaKl7hLOllsB\n"
  "CSDMAZOnTjC3U/dDxGkAV53ijSLdhwZAAIEJzs4bg7/fzTtxRuLWZscFs3YnFo97\n"
  "nh6Vfe63SKMI2tavegw5BmV/Sl0fvBf4q77uKNd0f3p4mVmFaG5cIzJLv07A6Fpt\n"
  "43C/dxC//AH2hdmoRBBYMql1GNXRor5H4idq9Joz+EkIYIvUX7Q6hL+hqkpMfT7P\n"
  "T19sdl6gSzeRntwi5m3OFBqOasv+zbMUZBfHWymeMr/y7vrTC0LUq7dBMtoM1O/4\n"
  "gdW7jVg/tRvoSSiicNoxBN33shbyTApOB6jtSj1etX+jkMOvJwIDAQABo2MwYTAO\n"
  "BgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUA95QNVbR\n"
  "TLtm8KPiGxvDl7I90VUwHwYDVR0jBBgwFoAUA95QNVbRTLtm8KPiGxvDl7I90VUw\n"
  "DQYJKoZIhvcNAQEFBQADggEBAMucN6pIExIK+t1EnE9SsPTfrgT1eXkIoyQY/Esr\n"
  "hMAtudXH/vTBH1jLuG2cenTnmCmrEbXjcKChzUyImZOMkXDiqw8cvpOp/2PV5Adg\n"
  "06O/nVsJ8dWO41P0jmP6P6fbtGbfYmbW0W5BjfIttep3Sp+dWOIrWcBAI+0tKIJF\n"
  "PnlUkiaY4IBIqDfv8NZ5YBberOgOzW6sRBc4L0na4UU+Krk2U886UAb3LujEV0ls\n"
  "YSEY1QSteDwsOoBrp+uvFRTp2InBuThs4pFsiv9kuXclVzDAGySj4dzp30d8tbQk\n"
  "CAUw7C29C79Fv1C5qfPrmAESrciIxpg0X40KPMbp1ZWVbd4=\n"
  "-----END CERTIFICATE-----\n"
  // DigiCert Global Root G2 (valid until Jan 15 12:00:00 2038 GMT)
  "-----BEGIN CERTIFICATE-----\n"
  "MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh\n"
  "MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3\n"
  "d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH\n"
  "MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT\n"
  "MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j\n"
  "b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG\n"
  "9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI\n"
  "2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx\n"
  "1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ\n"
  "q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz\n"
  "tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ\n"
  "vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP\n"
  "BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV\n"
  "5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY\n"
  "1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4\n"
  "NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG\n"
  "Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91\n"
  "8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe\n"
  "pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl\n"
  "MrY=\n"
  "-----END CERTIFICATE-----\n"
  // Amazon Root CA 1 (valid until Jan 17 00:00:00 2038 GMT)
  "-----BEGIN CERTIFICATE-----\n"
  "MIIDQTCCAimgAwIBAgITBmyfz5m/jAo54vB4ikPmljZbyjANBgkqhkiG9w0BAQsF\n"
  "ADA5MQswCQYDVQQGEwJVUzEPMA0GA1UEChMGQW1hem9uMRkwFwYDVQQDExBBbWF6\n"
  "b24gUm9vdCBDQSAxMB4XDTE1MDUyNjAwMDAwMFoXDTM4MDExNzAwMDAwMFowOTEL\n"
  "MAkGA1UEBhMCVVMxDzANBgNVBAoTBkFtYXpvbjEZMBcGA1UEAxMQQW1hem9uIFJv\n"
  "b3QgQ0EgMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBALJ4gHHKeNXj\n"
  "ca9HgFB0fW7Y14h29Jlo91ghYPl0hAEvrAIthtOgQ3pOsqTQNroBvo3bSMgHFzZM\n"
  "9O6II8c+6zf1tRn4SWiw3te5djgdYZ6k/oI2peVKVuRF4fn9tBb6dNqcmzU5L/qw\n"
  "IFAGbHrQgLKm+a/sRxmPUDgH3KKHOVj4utWp+UhnMJbulHheb4mjUcAwhmahRWa6\n"
  "VOujw5H5SNz/0egwLX0tdHA114gk957EWW67c4cX8jJGKLhD+rcdqsq08p8kDi1L\n"
  "93FcXmn/6pUCyziKrlA4b9v7LWIbxcceVOF34GfID5yHI9Y/QCB/IIDEgEw+OyQm\n"
  "jgSubJrIqg0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMC\n"
  "AYYwHQYDVR0OBBYEFIQYzIU07LwMlJQuCFmcx7IQTgoIMA0GCSqGSIb3DQEBCwUA\n"
  "A4IBAQCY8jdaQZChGsV2USggNiMOruYou6r4lK5IpDB/G/wkjUu0yKGX9rbxenDI\n"
  "U5PMCCjjmCXPI6T53iHTfIUJrU6adTrCC2qJeHZERxhlbI1Bjjt/msv0tadQ1wUs\n"
  "N+gDS63pYaACbvXy8MWy7Vu33PqUXHeeE6V/Uq2V8viTO96LXFvKWlJbYK8U90vv\n"
  "o/ufQJVtMVT8QtPHRh8jrdkPSHCa2XV4cdFyQzR1bldZwgJcJmApzyMZFo6IQ6XU\n"
  "5MsI+yMRQ+hDKXJioaldXgjUkK642M4UwtBV8ob2xJNDd2ZhwLnoQdeXeGADbkpy\n"
  "rqXRfboQnoZsG4q5WTP468SQvvG5\n"
  "-----END CERTIFICATE-----\n";

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
