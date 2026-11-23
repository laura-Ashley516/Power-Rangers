// =====================================================================
//  pwr_wifi.h  -  Wi-Fi + MQTT link with the app (docs/protocol.md)
// =====================================================================
//  - First setup: a hotspot "PWR-Setup" (WiFiManager). On its page:
//    home Wi-Fi, broker host, port, username, password, pairing code.
//    Opens by itself when nothing is saved; hold NEXT + DONE while
//    switching on to open it again.
//  - Then: MQTT over TLS (PubSubClient + WiFiClientSecure, port 8883).
//    Receives on pwr/<id>/app, sends on pwr/<id>/dev, presence on
//    pwr/<id>/status (retained "online", last will "offline").
//  - Every message is end-to-end encrypted (pwr_crypto.*).
//  - Received lines go into the protocol queue (pwr_protocol.*), so the
//    commands are exactly the same as over Bluetooth.
//
//  With PWR_USE_WIFI 0 (pwr_config.h) these functions do nothing.
// =====================================================================
#pragma once

#include <Arduino.h>

void wifiBegin(bool openSetup);   // in setup(); openSetup = NEXT + DONE held at power-on
void wifiLoop();                  // every loop(); never waits long (except while connecting TLS)
bool wifiIsOnline();              // connected to the broker
bool wifiSetupOpen();             // the PWR-Setup hotspot is open
int  wifiPayload();               // the <payload> HELLO reports over Wi-Fi
bool wifiSendLine(const char *text, size_t len);   // encrypt + publish one line on pwr/<id>/dev
