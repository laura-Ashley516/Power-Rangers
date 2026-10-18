// =====================================================================
//  pwr_clock.h  -  a simple software clock, set by the app (TIME message)
// =====================================================================
//  The ESP32 has no battery-backed clock. The app sends
//  TIME|<unixSeconds>|<utcOffsetMinutes> at every sync; we remember it
//  together with the time since boot, and count from there.
//  After a reset the clock is "not set" again until the next sync.
// =====================================================================
#pragma once

#include <Arduino.h>

// utcOffsetMinutes: local time = UTC + offset. Ottawa in summer = -240.
void clockSet(uint32_t unixSeconds, int utcOffsetMinutes);
bool clockIsSet();

uint32_t clockNowUnix();       // UTC unix seconds, 0 if the clock is not set
int      clockTodayIndex();    // 0 = Monday ... 6 = Sunday, -1 if not set
int      clockMinutesOfDay();  // local minutes after midnight, -1 if not set
long     clockDayNumber();     // local days since 1 Jan 1970, -1 if not set
