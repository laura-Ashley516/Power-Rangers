// =====================================================================
//  pwr_protocol.h  -  the link with the app (Bluetooth and Wi-Fi)
// =====================================================================
//  Implements docs/protocol.md (v3, and still accepts v0 / v1 / v2).
//
//  How it works:
//   - The BLE library calls our onWrite() callback in ITS OWN task.
//     That callback only copies the line into a queue (fast, safe).
//   - The Wi-Fi code (pwr_wifi.cpp) decrypts each MQTT message and puts
//     the line in the SAME queue, marked as coming from Wi-Fi.
//   - protocolLoop(), called from loop(), takes lines out of the queue
//     and does the real work (SD card, screen, replies). Every reply goes
//     back on the transport the command came from.
//   - Sending a voice note or the planner copy is done one chunk per
//     protocolLoop() call, so the buttons and screen keep working.
// =====================================================================
#pragma once

#include <Arduino.h>

// Where a line came from (and where its replies go).
const uint8_t SRC_BLE  = 0;
const uint8_t SRC_WIFI = 1;

void protocolBegin();         // start Bluetooth and advertising
void protocolLoop();          // call every loop()
bool protocolIsConnected();   // the app is connected over Bluetooth, or the device is online on the broker
bool protocolIsBusy();        // a schedule, a voice note or the planner copy is being transferred

// Used by the Wi-Fi code, from the main task only.
bool protocolQueueLine(uint8_t source, const char *text, size_t len);   // one decrypted line
void protocolTransportLost(uint8_t source);                             // the broker connection dropped
