// =====================================================================
//  pwr_schedule.cpp  -  activity list + reading a "day|period|name|energy" line
// =====================================================================
#include "pwr_schedule.h"

Activity schedule[MAX_ACTIVITIES];
int activityCount = 0;

static const char *DAY_NAMES[NUM_DAYS] = {
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
};
static const char *DAY_LABELS[NUM_DAYS] = {
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"
};
static const char *PERIOD_NAMES[NUM_PERIODS]  = {"Morning", "Afternoon", "Evening"};
static const char *PERIOD_LABELS[NUM_PERIODS] = {"MORNING", "AFTERNOON", "EVENING"};

const char *dayName(int day) {
  if (day < 0 || day >= NUM_DAYS) return "?";
  return DAY_NAMES[day];
}

const char *dayLabel(int day) {
  if (day < 0 || day >= NUM_DAYS) return "?";
  return DAY_LABELS[day];
}

const char *periodName(int period) {
  if (period < 0 || period >= NUM_PERIODS) return "?";
  return PERIOD_NAMES[period];
}

const char *periodLabel(int period) {
  if (period < 0 || period >= NUM_PERIODS) return "?";
  return PERIOD_LABELS[period];
}

const char *energyName(uint8_t energy) {
  if (energy == ENERGY_GREEN)  return "green";
  if (energy == ENERGY_YELLOW) return "yellow";
  if (energy == ENERGY_RED)    return "red";
  return "unknown";
}

const char *energyProtocolName(uint8_t energy) {
  // The protocol only knows green / yellow / red. An unknown label
  // (should never happen with the real app) is sent back as "yellow".
  if (energy == ENERGY_GREEN) return "green";
  if (energy == ENERGY_RED)   return "red";
  return "yellow";
}

// Lower-case and trim a copy of the text.
static String normalized(String s) {
  s.trim();
  s.toLowerCase();
  return s;
}

int dayFromText(String s) {
  s = normalized(s);
  for (int i = 0; i < NUM_DAYS; i++) {
    String d = DAY_NAMES[i];
    d.toLowerCase();
    if (s == d) return i;
  }
  return -1;
}

int periodFromText(String s) {
  s = normalized(s);
  if (s == "morning"   || s == "am")    return 0;
  if (s == "afternoon" || s == "pm")    return 1;
  if (s == "evening"   || s == "night") return 2;
  return -1;
}

// Accept the labels sent by the web app and common alternate labels
// (same list as the first-try sketch).
uint8_t energyFromText(String s) {
  s = normalized(s);
  if (s == "green" || s == "easy" || s == "low" ||
      s == "low energy" || s == "#dce8d9" || s == "#4caf50" ||
      s == "#b7e4c7") return ENERGY_GREEN;
  if (s == "yellow" || s == "moderate" || s == "medium" ||
      s == "moderate energy" || s == "#f4df85" || s == "#ffeb3b" ||
      s == "#f9e79f") return ENERGY_YELLOW;
  if (s == "red" || s == "high" || s == "high energy" ||
      s == "#e9a39d" || s == "#f44336" || s == "#f4b6b6") return ENERGY_RED;

  Serial.print("Unrecognized energy label: [");
  Serial.print(s);
  Serial.println("] - using blue diagnostic colour");
  return ENERGY_UNKNOWN;
}

bool parseActivityLine(const String &lineIn, Activity &out) {
  String line = lineIn;
  line.trim();

  // Find the first, second and last '|' separators.
  int first = line.indexOf('|');
  if (first < 0) return false;
  int second = line.indexOf('|', first + 1);
  if (second < 0) return false;          // fewer than 3 fields
  int last = line.lastIndexOf('|');

  int day = dayFromText(line.substring(0, first));
  if (day < 0) {
    Serial.print("Ignored line with unknown day: ");
    Serial.println(line);
    return false;
  }

  String name;
  String energyText;
  int period;

  if (last == second) {
    // Exactly 3 fields -> legacy v0 format: day|name|energy (morning).
    period = 0;
    name = line.substring(first + 1, second);
    energyText = line.substring(second + 1);
  } else {
    // 4 fields (v1): day|period|name|energy.
    // If the name contains extra '|' we keep them in the name.
    period = periodFromText(line.substring(first + 1, second));
    if (period < 0) {
      Serial.println("Invalid/missing period; placing activity in MORNING.");
      period = 0;
    }
    name = line.substring(second + 1, last);
    energyText = line.substring(last + 1);
  }

  name.replace('|', '/');   // a '|' inside a name would break our messages
  name.trim();
  if (name.length() == 0) name = "Activity";
  // Keep names short enough that every message stays under 180 bytes.
  if (name.length() > 120) name = name.substring(0, 120);

  out.day = (uint8_t)day;
  out.period = (uint8_t)period;
  out.energy = energyFromText(energyText);
  out.name = name;
  return true;
}

int countActivities(int day, int period) {
  int n = 0;
  for (int i = 0; i < activityCount; i++) {
    if (schedule[i].day != day) continue;
    if (period >= 0 && schedule[i].period != period) continue;
    n++;
  }
  return n;
}

int periodStartMinutes(int period) {
  if (period == 0) return MORNING_START_MIN;
  if (period == 1) return AFTERNOON_START_MIN;
  return EVENING_START_MIN;
}
