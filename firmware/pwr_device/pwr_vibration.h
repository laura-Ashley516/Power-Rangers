// =====================================================================
//  pwr_vibration.h  -  gentle vibration pulses (non-blocking)
// =====================================================================
//  The motor is switched by a transistor on PIN_MOTOR (HIGH = on).
//  vibrationBuzz() starts VIBRATION_PULSES short pulses; vibrationUpdate()
//  must be called from loop() to switch the motor on and off.
// =====================================================================
#pragma once

#include <Arduino.h>

void vibrationBegin();
void vibrationBuzz();      // start one "buzz" (e.g. 3 x 300 ms)
void vibrationStop();      // motor off now
void vibrationUpdate();    // call every loop()
bool vibrationIsRunning();
