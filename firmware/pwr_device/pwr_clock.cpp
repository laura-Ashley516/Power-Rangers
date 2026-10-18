// =====================================================================
//  pwr_clock.cpp  -  software clock
// =====================================================================
#include "pwr_clock.h"
#include "esp_timer.h"   // esp_timer_get_time(): microseconds since boot (64-bit, never wraps)

static bool     isSet = false;
static uint32_t baseUnix = 0;        // unix time received from the app
static int64_t  baseBootSeconds = 0; // seconds since boot when we received it
static int      offsetMinutes = 0;

static int64_t secondsSinceBoot() {
  return esp_timer_get_time() / 1000000LL;
}

void clockSet(uint32_t unixSeconds, int utcOffsetMinutes) {
  baseUnix = unixSeconds;
  baseBootSeconds = secondsSinceBoot();
  offsetMinutes = utcOffsetMinutes;
  isSet = true;
  Serial.printf("Clock set: unix=%lu offset=%d min\n",
                (unsigned long)unixSeconds, utcOffsetMinutes);
}

bool clockIsSet() {
  return isSet;
}

uint32_t clockNowUnix() {
  if (!isSet) return 0;
  return baseUnix + (uint32_t)(secondsSinceBoot() - baseBootSeconds);
}

// Local time in seconds since 1 Jan 1970 (64-bit so it can never be negative
// for any real date).
static int64_t localSeconds() {
  return (int64_t)clockNowUnix() + (int64_t)offsetMinutes * 60;
}

long clockDayNumber() {
  if (!isSet) return -1;
  int64_t s = localSeconds();
  if (s < 0) return -1;
  return (long)(s / 86400);
}

int clockTodayIndex() {
  long days = clockDayNumber();
  if (days < 0) return -1;
  // 1 Jan 1970 was a Thursday. With 0 = Monday, Thursday is 3.
  return (int)((days + 3) % 7);
}

int clockMinutesOfDay() {
  if (!isSet) return -1;
  int64_t s = localSeconds();
  if (s < 0) return -1;
  return (int)((s % 86400) / 60);
}
