// =====================================================================
//  pwr_display.h  -  everything drawn on the ILI9341 screen
// =====================================================================
//  Same look as the first-try sketch: portrait 240x320, header with the
//  day name, one section per period, pastel cards coloured by energy,
//  footer with the activity count. New: a status line at the bottom.
// =====================================================================
#pragma once

#include <Arduino.h>

// What the status line shows. The main sketch fills this in.
struct DeviceStatus {
  bool connected;      // Bluetooth connected to the app
  bool sdOk;           // microSD card mounted
  int  notesWaiting;   // voice notes not yet downloaded
  int  minutesOfDay;   // local time for the clock, -1 if not set
};

void displayBegin();
void displaySplash(const char *title, const char *subtitle);

// Draw a whole day page. isToday adds a "TODAY" tag.
// reminderPeriod >= 0 shows only that block with a "Coming up" banner.
void displayDay(int day, bool isToday, int reminderPeriod);

// Redraw only the bottom status line (cheap, no flicker of the cards).
void displayStatus(const DeviceStatus &st);

// Full-screen messages.
void displayMessage(const char *line1, const char *line2);
void displayRecordingStart();
void displayRecordingSeconds(uint32_t seconds);
