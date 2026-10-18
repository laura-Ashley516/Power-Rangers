// =====================================================================
//  pwr_app.h  -  functions written in pwr_device.ino that other files call
// =====================================================================
//  The Bluetooth code (pwr_protocol.cpp) uses these to tell the main
//  sketch that something changed, so the main sketch can redraw the
//  screen. They are always called from loop(), never from a BLE callback.
// =====================================================================
#pragma once

void appScheduleChanged();   // a new schedule was received and saved
void appClockChanged();      // TIME received: the clock is now set
void appNotesChanged();      // a voice note was deleted (or added)
