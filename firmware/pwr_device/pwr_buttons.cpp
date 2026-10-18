// =====================================================================
//  pwr_buttons.cpp  -  debounced push buttons
// =====================================================================
//  A mechanical button "bounces" (flickers on/off) for a few ms when
//  pressed. We only accept a new state once the pin has stayed the same
//  for BUTTON_DEBOUNCE_MS.
// =====================================================================
#include "pwr_buttons.h"
#include "pwr_config.h"

DebouncedButton::DebouncedButton(int pinNumber)
  : pin(pinNumber),
    stableDown(false),
    lastRawDown(false),
    lastRawChangeMs(0),
    downSinceMs(0),
    pressedEvent(false),
    releasedEvent(false) {}

void DebouncedButton::begin() {
  pinMode(pin, INPUT_PULLUP);
  lastRawDown = (digitalRead(pin) == LOW);
  stableDown = lastRawDown;
  lastRawChangeMs = millis();
  downSinceMs = millis();
}

void DebouncedButton::update() {
  bool rawDown = (digitalRead(pin) == LOW);   // pressed = LOW (pull-up)
  uint32_t now = millis();

  if (rawDown != lastRawDown) {
    lastRawDown = rawDown;
    lastRawChangeMs = now;
  }

  if (rawDown != stableDown && (now - lastRawChangeMs) >= BUTTON_DEBOUNCE_MS) {
    stableDown = rawDown;
    if (stableDown) {
      pressedEvent = true;
      downSinceMs = now;
    } else {
      releasedEvent = true;
    }
  }
}

bool DebouncedButton::isDown() const {
  return stableDown;
}

bool DebouncedButton::wasPressed() {
  bool e = pressedEvent;
  pressedEvent = false;
  return e;
}

bool DebouncedButton::wasReleased() {
  bool e = releasedEvent;
  releasedEvent = false;
  return e;
}

uint32_t DebouncedButton::heldMs() const {
  if (!stableDown) return 0;
  return millis() - downSinceMs;
}
