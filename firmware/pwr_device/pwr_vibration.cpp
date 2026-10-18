// =====================================================================
//  pwr_vibration.cpp  -  gentle vibration pulses
// =====================================================================
#include "pwr_vibration.h"
#include "pwr_config.h"

static int      pulsesLeft = 0;      // pulses still to do (including the current one)
static bool     motorOn = false;
static uint32_t phaseStartMs = 0;    // when the current on/off phase started

static void setMotor(bool on) {
  motorOn = on;
  digitalWrite(PIN_MOTOR, on ? HIGH : LOW);
}

void vibrationBegin() {
  pinMode(PIN_MOTOR, OUTPUT);
  setMotor(false);
}

void vibrationBuzz() {
  pulsesLeft = VIBRATION_PULSES;
  phaseStartMs = millis();
  setMotor(true);
}

void vibrationStop() {
  pulsesLeft = 0;
  setMotor(false);
}

bool vibrationIsRunning() {
  return pulsesLeft > 0;
}

void vibrationUpdate() {
  if (pulsesLeft <= 0) return;
  uint32_t elapsed = millis() - phaseStartMs;

  if (motorOn && elapsed >= VIBRATION_ON_MS) {
    // End of one pulse.
    setMotor(false);
    pulsesLeft--;
    phaseStartMs = millis();
  } else if (!motorOn && elapsed >= VIBRATION_OFF_MS) {
    // Pause finished: start the next pulse.
    phaseStartMs = millis();
    setMotor(true);
  }
}
