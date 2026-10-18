// =====================================================================
//  pwr_protocol.h  -  Bluetooth Low Energy link with the app
// =====================================================================
//  Implements docs/protocol.md (v1, and still accepts v0).
//
//  How it works:
//   - The BLE library calls our onWrite() callback in ITS OWN task.
//     That callback only copies the line into a queue (fast, safe).
//   - protocolLoop(), called from loop(), takes lines out of the queue
//     and does the real work (SD card, screen, replies).
//   - Sending a voice note is done one chunk per protocolLoop() call,
//     so the buttons and screen keep working during a transfer.
// =====================================================================
#pragma once

#include <Arduino.h>

void protocolBegin();         // start Bluetooth and advertising
void protocolLoop();          // call every loop()
bool protocolIsConnected();   // the app is connected
bool protocolIsBusy();        // a schedule or a voice note is being transferred
