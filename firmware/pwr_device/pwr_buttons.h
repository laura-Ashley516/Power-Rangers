// =====================================================================
//  pwr_buttons.h  -  debounced push buttons (wired to GND, INPUT_PULLUP)
// =====================================================================
//  Usage:
//    DebouncedButton next(PIN_BTN_NEXT);
//    next.begin();              // in setup()
//    next.update();             // every loop()
//    if (next.wasPressed()) ... // true once per press
// =====================================================================
#pragma once

#include <Arduino.h>

class DebouncedButton {
public:
  explicit DebouncedButton(int pin);

  void begin();
  void update();               // read the pin; call often

  bool isDown() const;         // pressed right now (after debouncing)
  bool wasPressed();           // true once, just after the button went down
  bool wasReleased();          // true once, just after the button went up
  uint32_t heldMs() const;     // how long it has been held (0 if not down)

private:
  int      pin;
  bool     stableDown;         // debounced state
  bool     lastRawDown;        // last raw reading
  uint32_t lastRawChangeMs;    // when the raw reading last changed
  uint32_t downSinceMs;        // when the debounced press started
  bool     pressedEvent;
  bool     releasedEvent;
};
