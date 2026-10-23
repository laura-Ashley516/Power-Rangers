#pragma once
#include <Arduino.h>

// Shared types. Kept in a header so the Arduino IDE's auto-generated
// function prototypes can see them.

const int NAME_LEN = 64;

struct Activity {
  uint8_t day;
  uint8_t period;
  uint8_t energy;
  char name[NAME_LEN];
};

enum ScreenPage { PAGE_WEEK, PAGE_PERIODS, PAGE_ACTIVITIES };

struct Rect { int16_t x, y, w, h; };

struct TouchCal {
  bool swapXY;
  int xa, xb;   // raw value of the "x" axis at screen x = CAL_L / CAL_R
  int ya, yb;   // raw value of the "y" axis at screen y = CAL_T / CAL_B
};

struct RawPt { int x; int y; };
