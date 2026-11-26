#pragma once

#include <Adafruit_GFX.h>
#include <Arduino_GFX_Library.h>
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <XPT2046_Touchscreen.h>
#include <time.h>

#include "pwr_config.h"

class ScheduleDisplay {
 public:
  void begin() {
    pinMode(PIN_TFT_CS, OUTPUT);
    digitalWrite(PIN_TFT_CS, HIGH);
    pinMode(PIN_TOUCH_CS, OUTPUT);
    digitalWrite(PIN_TOUCH_CS, HIGH);
    if (!SPI.begin(PIN_TFT_SCK, PIN_TOUCH_MISO, PIN_TFT_MOSI)) {
      Serial.println("ILI9488 SPI bus failed to start.");
      return;
    }
    ready = panel.begin(4000000);
    if (!ready) {
      Serial.println("ILI9488 display initialization failed.");
      return;
    }
    panel.setTextWrap(false);
    touchReady = touch.begin(SPI);
    touch.setRotation(1);
    Preferences prefs;
    if (touchReady && prefs.begin("c5-touch-v1", true)) {
      if (prefs.getBytesLength("points") == sizeof(cal)) prefs.getBytes("points", &cal, sizeof(cal));
      prefs.end();
      calibrated = valid(cal);
    }
    Serial.println(calibrated ? "Display ready. Touch calibration loaded."
                              : "Display ready. Send C to calibrate touch.");
  }

  void scheduleChanged() {
    page = 0;
    needsRedraw = true;
  }

  void setUtcOffset(int minutes) {
    utcOffsetMinutes = minutes;
    hasClock = true;
    needsRedraw = true;
  }

  void week() {
    followingToday = false;
    view = View::Week;
    needsRedraw = true;
  }

  void today() {
    followingToday = true;
    view = View::Periods;
    day = currentDay();
    page = 0;
    needsRedraw = true;
  }

  void next() {
    if (view == View::Activities && page + 1 < pageCount) {
      page++;
    } else {
      if (view != View::Week) day = (day + 1) % 7;
      view = View::Periods;
    }
    followingToday = false;
    needsRedraw = true;
  }

  void calibrate() {
    if (!ready || !touchReady) return;
    calibrationStep = 0;
    calibrationSince = millis();
    needsRedraw = true;
  }

  void update(const char* schedulePath, bool storageAvailable) {
    if (!ready) return;
    pollTouch();
    if (calibrationStep >= 0 && millis() - calibrationSince >= 30000) {
      calibrationStep = -1;
      needsRedraw = true;
      Serial.println("Touch calibration timed out. Send C to retry.");
    }
    if (followingToday && day != currentDay()) {
      day = currentDay();
      view = View::Periods;
      needsRedraw = true;
    }
    if (!needsRedraw) return;
    needsRedraw = false;
    if (calibrationStep >= 0) drawCalibration();
    else draw(schedulePath, storageAvailable);
  }

 private:
  enum class View { Week, Periods, Activities };
  struct Calibration { int xa, xb, ya, yb, swap; };

  static constexpr int width = 320, height = 480, footerY = 424;
  static constexpr int left = 24, right = 295, top = 24, bottom = 455;
  static constexpr int rowsPerPage = 5;
  static constexpr uint16_t bg = RGB565(123, 135, 88), bar = RGB565(94, 106, 66);
  static constexpr uint16_t cream = RGB565(248, 228, 205), card = RGB565(242, 218, 198);
  static constexpr uint16_t olive = RGB565(84, 96, 56), ink = RGB565(58, 36, 20);
  static constexpr uint16_t accent = RGB565(212, 130, 74);
  static constexpr uint16_t energyColors[] = {
    RGB565(176, 198, 140), RGB565(238, 198, 116), RGB565(214, 124, 84)
  };
  static constexpr const char* days[] = {
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
  };
  static constexpr const char* periods[] = {"Morning", "Afternoon", "Evening"};

  Arduino_HWSPI bus{PIN_TFT_DC, PIN_TFT_CS, PIN_TFT_SCK, PIN_TFT_MOSI, PIN_TOUCH_MISO, &SPI, true};
  Arduino_ILI9488_18bit panel{&bus, PIN_TFT_RST, 0, false};
  XPT2046_Touchscreen touch{PIN_TOUCH_CS};
  Calibration cal{};
  TS_Point raw[3]{};
  bool ready = false, touchReady = false, calibrated = false;
  bool pressed = false, needsRedraw = true, followingToday = false, hasClock = false;
  int utcOffsetMinutes = 0, day = 0, period = 0, page = 0, pageCount = 1;
  int calibrationStep = -1, samples = 0, sumX = 0, sumY = 0;
  uint32_t lastPoll = 0, lastPressed = 0, calibrationSince = 0;
  View view = View::Week;

  int currentDay() const {
    if (!hasClock) return day;
    const time_t local = time(nullptr) + time_t(utcOffsetMinutes) * 60;
    struct tm date;
    return gmtime_r(&local, &date) ? (date.tm_wday + 6) % 7 : day;
  }

  static bool valid(const Calibration& c) {
    return abs(c.xb - c.xa) > 600 && abs(c.yb - c.ya) > 600;
  }

  void pollTouch() {
    const uint32_t now = millis();
    if (!touchReady || now - lastPoll < 12) return;
    lastPoll = now;
    const TS_Point point = touch.getPoint();
    if (point.z >= 350) {
      if (now - lastPressed >= 60) {
        pressed = true;
        samples = sumX = sumY = 0;
      }
      lastPressed = now;
      if (pressed && samples < 12) {
        samples++;
        sumX += point.x;
        sumY += point.y;
      }
      return;
    }
    if (!pressed || now - lastPressed < 60) return;
    pressed = false;
    if (samples < (calibrationStep >= 0 ? 4 : 2)) return;
    const TS_Point tap(sumX / samples, sumY / samples, 0);
    if (calibrationStep >= 0) {
      raw[calibrationStep++] = tap;
      calibrationSince = now;
      if (calibrationStep == 3) finishCalibration();
      needsRedraw = true;
      return;
    }
    if (!calibrated) {
      calibrate();
      return;
    }
    const int x = constrain(map(cal.swap ? tap.y : tap.x, cal.xa, cal.xb, left, right), 0L, long(width - 1));
    const int y = constrain(map(cal.swap ? tap.x : tap.y, cal.ya, cal.yb, top, bottom), 0L, long(height - 1));
    handleTap(x, y);
  }

  void finishCalibration() {
    const bool swap = abs(raw[1].y - raw[0].y) > abs(raw[1].x - raw[0].x);
    const Calibration candidate = swap
      ? Calibration{raw[0].y, raw[1].y, raw[0].x, raw[2].x, 1}
      : Calibration{raw[0].x, raw[1].x, raw[0].y, raw[2].y, 0};
    if (!valid(candidate)) {
      calibrationStep = 0;
      Serial.println("Touch points too close. Repeat the three targets.");
      return;
    }
    cal = candidate;
    calibrated = true;
    calibrationStep = -1;
    Preferences prefs;
    bool saved = false;
    if (prefs.begin("c5-touch-v1", false)) {
      saved = prefs.putBytes("points", &cal, sizeof(cal)) == sizeof(cal);
      prefs.end();
    }
    Serial.println(saved ? "Touch calibration saved." : "Touch calibration active for this session.");
  }

  void handleTap(int x, int y) {
    switch (view) {
      case View::Week:
        if (y >= footerY) { today(); return; }
        for (int i = 0; i < 7; i++) {
          const int bx = 12 + (i % 2) * 152, by = 80 + (i / 2) * 83;
          if (x >= bx && x < bx + 144 && y >= by && y < by + 75) {
            day = i;
            view = View::Periods;
            needsRedraw = true;
            return;
          }
        }
        break;
      case View::Periods:
        if (y >= footerY) { week(); return; }
        if (x < 12 || x >= 308) return;
        for (int i = 0; i < 3; i++) {
          const int by = 83 + i * 110;
          if (y >= by && y < by + 95) {
            followingToday = false;
            period = i;
            page = 0;
            view = View::Activities;
            needsRedraw = true;
            return;
          }
        }
        break;
      case View::Activities:
        if (y < footerY) return;
        if (x < 112 || pageCount == 1) view = View::Periods;
        else if (x < 214) page = (page + pageCount - 1) % pageCount;
        else page = (page + 1) % pageCount;
        needsRedraw = true;
        break;
    }
  }

  void text(int x, int baseline, const String& value, const GFXfont& font, uint16_t color) {
    panel.setFont(&font);
    panel.setCursor(x, baseline);
    panel.setTextColor(color);
    panel.print(value);
  }

  void heading(const char* title, const String& subtitle) {
    text(15, 39, title, FreeSansBold18pt7b, cream);
    text(16, 63, subtitle, FreeSans9pt7b, cream);
    panel.fillRect(16, 70, 288, 2, accent);
  }

  void drawCalibration() {
    panel.fillScreen(bg);
    text(17, 190, "Touch setup", FreeSansBold18pt7b, cream);
    text(17, 222, "Hold each cross briefly, then release.", FreeSans9pt7b, cream);
    text(17, 251, "Point " + String(calibrationStep + 1) + " of 3", FreeSansBold12pt7b, cream);
    const int x = calibrationStep == 1 ? right : left;
    const int y = calibrationStep == 2 ? bottom : top;
    panel.drawCircle(x, y, 11, accent);
    panel.drawFastHLine(x - 15, y, 31, cream);
    panel.drawFastVLine(x, y - 15, 31, cream);
  }

  int textWidth(const String& value) {
    int16_t x, y;
    uint16_t w, h;
    panel.getTextBounds(value, 0, 0, &x, &y, &w, &h);
    return w;
  }

  void drawActivity(int row, String name, int energy) {
    const int y = 80 + row * 67;
    panel.fillRoundRect(12, y, 296, 59, 10, card);
    panel.fillCircle(27, y + 28, 6, energy < 0 ? cream : energyColors[energy]);
    panel.drawCircle(27, y + 28, 6, olive);
    panel.setFont(&FreeSansBold12pt7b);
    constexpr int maxWidth = 251;
    if (textWidth(name) <= maxWidth) {
      text(42, y + 35, name, FreeSansBold12pt7b, ink);
      return;
    }
    int split = name.length() - 1;
    while (split > 0 && textWidth(name.substring(0, split)) > maxWidth) split--;
    const int space = name.lastIndexOf(' ', split);
    if (space > split / 2) split = space;
    text(42, y + 25, name.substring(0, split), FreeSansBold12pt7b, ink);
    name.remove(0, split);
    name.trim();
    if (textWidth(name) > maxWidth) {
      do { name.remove(name.length() - 1); } while (name.length() && textWidth(name + "...") > maxWidth);
      name += "...";
    }
    text(42, y + 48, name, FreeSansBold12pt7b, ink);
  }

  static int indexOf(const String& value, const char* const* labels, int count) {
    for (int i = 0; i < count; i++) if (value == labels[i]) return i;
    return -1;
  }

  void draw(const char* path, bool storageAvailable) {
    panel.fillScreen(bg);
    int dayCounts[7]{}, energyCounts[7][3]{}, periodCounts[3]{};
    String activities[rowsPerPage];
    int energies[rowsPerPage]{};
    int matches = 0;
    File file = storageAvailable ? LittleFS.open(path, "r") : File();
    if (file) {
      while (file.available()) {
        String line = file.readStringUntil('\n');
        line.trim();
        const int first = line.indexOf('|');
        const int second = first < 0 ? -1 : line.indexOf('|', first + 1);
        const int third = second < 0 ? -1 : line.indexOf('|', second + 1);
        if (third < 0) continue;
        const int d = indexOf(line.substring(0, first), days, 7);
        const int p = indexOf(line.substring(first + 1, second), periods, 3);
        if (d < 0 || p < 0) continue;
        static const char* const labels[] = {"green", "yellow", "red"};
        const int e = indexOf(line.substring(third + 1), labels, 3);
        dayCounts[d]++;
        if (e >= 0) energyCounts[d][e]++;
        if (d != day) continue;
        periodCounts[p]++;
        if (p != period || view != View::Activities) continue;
        const int row = matches++ - page * rowsPerPage;
        if (row >= 0 && row < rowsPerPage) {
          activities[row] = line.substring(second + 1, third);
          energies[row] = e;
        }
      }
      file.close();
    }

    if (view == View::Week) {
      heading("Weekly Planner", storageAvailable ? "Choose a day" : "Schedule storage unavailable");
      for (int i = 0; i < 7; i++) {
        const int x = 12 + (i % 2) * 152, y = 80 + (i / 2) * 83;
        panel.fillRoundRect(x, y, 144, 75, 10, card);
        if (hasClock && i == currentDay()) panel.drawRoundRect(x, y, 144, 75, 10, accent);
        text(x + 9, y + 23, days[i], FreeSansBold9pt7b, olive);
        panel.drawFastHLine(x + 9, y + 29, 126, olive);
        if (!dayCounts[i]) text(x + 9, y + 55, "Free", FreeSans9pt7b, ink);
        else for (int e = 0; e < 3; e++) {
          if (!energyCounts[i][e]) continue;
          const int dot = x + 16 + e * 44;
          panel.fillCircle(dot, y + 51, 5, energyColors[e]);
          panel.drawCircle(dot, y + 51, 5, olive);
          text(dot + 8, y + 57, String(energyCounts[i][e]), FreeSans9pt7b, ink);
        }
      }
      panel.fillRoundRect(164, 329, 144, 75, 10, card);
      text(174, 351, "Energy", FreeSansBold9pt7b, olive);
      static const char* const labels[] = {"Low", "Med", "High"};
      for (int i = 0; i < 3; i++) {
        const int x = 170 + i * 45;
        panel.fillRoundRect(x, 360, 42, 25, 5, energyColors[i]);
        text(x + 3, 378, labels[i], FreeSans9pt7b, ink);
      }
    } else if (view == View::Periods) {
      heading(days[day], "Choose a time of day");
      for (int i = 0; i < 3; i++) {
        const int y = 83 + i * 110;
        panel.fillRoundRect(12, y, 296, 95, 12, card);
        panel.fillCircle(47, y + 45, 15, i == 0 ? energyColors[1] : accent);
        if (i == 0) {
          panel.fillRect(28, y + 47, 38, 16, card);
          panel.drawFastHLine(28, y + 47, 38, olive);
        } else if (i == 2) panel.fillCircle(54, y + 39, 12, card);
        text(76, y + 42, periods[i], FreeSansBold18pt7b, olive);
        const int count = periodCounts[i];
        text(77, y + 69, count ? String(count) + (count == 1 ? " activity" : " activities") : "Nothing planned",
             FreeSans9pt7b, ink);
      }
    } else {
      pageCount = max(1, (matches + rowsPerPage - 1) / rowsPerPage);
      heading(periods[period], String(days[day]) + "  |  " + String(page + 1) + "/" + String(pageCount));
      if (!matches) {
        panel.fillRoundRect(12, 84, 296, 71, 10, card);
        text(24, 127, "Nothing planned", FreeSansBold12pt7b, ink);
      }
      for (int row = 0; row < rowsPerPage && page * rowsPerPage + row < matches; row++) {
        drawActivity(row, activities[row], energies[row]);
      }
    }
    drawFooter();
  }

  void drawFooter() {
    panel.fillRect(0, footerY, width, height - footerY, bar);
    panel.drawFastHLine(0, footerY, width, accent);
    if (!calibrated) {
      text(15, 459, "Tap to set up touch", FreeSansBold12pt7b, cream);
    } else if (view == View::Activities && pageCount > 1) {
      button(9, 98, "Back", accent);
      button(114, 94, "Prev", card);
      button(217, 94, "Next", card);
    } else {
      button(10, 300, view == View::Week ? "Today" : "Back", accent);
    }
  }

  void button(int x, int w, const char* label, uint16_t fill) {
    panel.fillRoundRect(x, 431, w, 41, 8, fill);
    panel.setFont(&FreeSansBold12pt7b);
    text(x + (w - textWidth(label)) / 2, 459, label, FreeSansBold12pt7b, ink);
  }
};
