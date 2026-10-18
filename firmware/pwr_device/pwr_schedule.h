// =====================================================================
//  pwr_schedule.h  -  the list of activities and how to read one line
// =====================================================================
#pragma once

#include <Arduino.h>
#include "pwr_config.h"

// Days are numbered 0 = Monday ... 6 = Sunday.
// Periods are numbered 0 = Morning, 1 = Afternoon, 2 = Evening.
const int NUM_DAYS    = 7;
const int NUM_PERIODS = 3;

// Energy levels (colour of the card).
const uint8_t ENERGY_GREEN   = 0;
const uint8_t ENERGY_YELLOW  = 1;
const uint8_t ENERGY_RED     = 2;
const uint8_t ENERGY_UNKNOWN = 3;   // shown in diagnostic blue

struct Activity {
  uint8_t day;      // 0..6
  uint8_t period;   // 0..2
  uint8_t energy;   // ENERGY_...
  String  name;
};

// The schedule that is shown on screen (and saved on the microSD).
extern Activity schedule[MAX_ACTIVITIES];
extern int activityCount;

// Names used in Bluetooth messages and in /schedule.txt ("Monday", "Morning").
const char *dayName(int day);
const char *periodName(int period);
// Upper-case names used on the screen ("MONDAY", "MORNING").
const char *dayLabel(int day);
const char *periodLabel(int period);
// "green" / "yellow" / "red" / "unknown" (used in /schedule.txt).
const char *energyName(uint8_t energy);
// Same, but only the 3 values allowed by the protocol (unknown -> "yellow").
const char *energyProtocolName(uint8_t energy);

// Text -> number. Return -1 if the text is not recognised.
int dayFromText(String s);
int periodFromText(String s);
// Never fails: unrecognised labels give ENERGY_UNKNOWN.
uint8_t energyFromText(String s);

// Reads one line "day|period|name|energy" (v1) or "day|name|energy"
// (legacy v0, placed in the morning). Returns false if the line is unusable.
bool parseActivityLine(const String &line, Activity &out);

// How many activities on this day (and this period; period -1 = all periods).
int countActivities(int day, int period);

// Start time of a period in minutes after midnight (local time).
int periodStartMinutes(int period);
