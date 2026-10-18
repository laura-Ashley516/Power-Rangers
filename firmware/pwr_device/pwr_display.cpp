// =====================================================================
//  pwr_display.cpp  -  drawing code (based on the first-try sketch)
// =====================================================================
//  Only call these from setup()/loop(): the screen shares the SPI bus
//  with the microSD card.
// =====================================================================
#include "pwr_display.h"
#include "pwr_config.h"
#include "pwr_schedule.h"

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>

static Adafruit_ILI9341 tft(PIN_TFT_CS, PIN_TFT_DC, PIN_TFT_RST);

const int SCREEN_W = 240;
const int SCREEN_H = 320;
const int HEADER_H = 30;
const int FOOTER_H = 24;                 // two text rows: info + status
const int INFO_Y   = SCREEN_H - 22;      // "5 activities  Next: TUESDAY"
const int STATUS_Y = SCREEN_H - 11;      // "Connected  2 notes waiting   08:15"

// ---------------------------------------------------------------------
//  Colours
// ---------------------------------------------------------------------
static uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

// Match the web app's pastel energy colours:
// green #B7E4C7, yellow #F9E79F, red #F4B6B6.
static uint16_t energyColor(uint8_t energy) {
  if (energy == ENERGY_GREEN)  return rgb565(183, 228, 199);
  if (energy == ENERGY_YELLOW) return rgb565(249, 231, 159);
  if (energy == ENERGY_RED)    return rgb565(244, 182, 182);
  return rgb565(100, 160, 230);   // diagnostic blue for unknown labels
}

// ---------------------------------------------------------------------
//  Text helpers (from the first-try sketch)
// ---------------------------------------------------------------------
static int textWidth(const String &s, uint8_t size) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.setTextSize(size);
  tft.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return (int)w;
}

static void printCentered(const String &s, int y, uint8_t size, uint16_t color) {
  int w = textWidth(s, size);
  int x = (SCREEN_W - w) / 2;
  if (x < 0) x = 0;
  tft.setTextSize(size);
  tft.setTextColor(color);
  tft.setCursor(x, y);
  tft.print(s);
}

// Draws one or two lines and returns the required text height.
static int drawName(String name, int x, int y, int maxWidth, uint8_t size, int maxLines) {
  name.trim();
  if (!name.length()) name = "Activity";
  tft.setTextSize(size);
  tft.setTextColor(ILI9341_BLACK);

  const int lineH = 8 * size + 1;
  String lines[2] = {"", ""};
  int line = 0;
  int pos = 0;

  while (pos < (int)name.length() && line < maxLines) {
    int space = name.indexOf(' ', pos);
    if (space < 0) space = name.length();
    String word = name.substring(pos, space);
    String candidate = lines[line].length() ? lines[line] + " " + word : word;

    if (textWidth(candidate, size) > maxWidth && lines[line].length()) {
      line++;
      if (line >= maxLines) break;
      lines[line] = word;
    } else {
      lines[line] = candidate;
    }
    pos = space + 1;
  }

  for (int i = 0; i <= line && i < maxLines; i++) {
    // Trim overly long single words so they cannot draw outside the card.
    while (lines[i].length() > 1 && textWidth(lines[i], size) > maxWidth) {
      lines[i].remove(lines[i].length() - 1);
    }
    if (lines[i].length()) {
      tft.setCursor(x, y + i * lineH);
      tft.print(lines[i]);
    }
  }
  return (line + 1) * lineH;
}

// ---------------------------------------------------------------------
//  Cards and sections
// ---------------------------------------------------------------------
const int CARD_X = 8;
const int CARD_W = SCREEN_W - 16;
const int CARD_TEXT_MAX_W = CARD_W - 14;

static bool nameFitsOneLine(const String &name) {
  return textWidth(name, 2) <= CARD_TEXT_MAX_W;
}

static int drawActivityCard(const Activity &a, int y) {
  const int textX = CARD_X + 7;
  const uint8_t size = 2;
  const int textH = 8 * size + 1;

  String name = a.name;
  name.trim();
  if (!name.length()) name = "Activity";

  // Prefer a single large line. Use two lines only when the name needs them.
  bool oneLine = nameFitsOneLine(name);
  int cardH = oneLine ? 27 : 43;
  tft.fillRoundRect(CARD_X, y, CARD_W, cardH, 4, energyColor(a.energy));
  tft.drawRoundRect(CARD_X, y, CARD_W, cardH, 4, ILI9341_DARKGREY);

  int textY = y + (cardH - (oneLine ? textH : 2 * textH)) / 2;
  drawName(name, textX, textY, CARD_TEXT_MAX_W, size, oneLine ? 1 : 2);
  return cardH;
}

static void drawPeriodSection(int day, int period, int &y) {
  if (countActivities(day, period) == 0) return;

  const int bottomLimit = SCREEN_H - FOOTER_H - 2;
  if (y + 16 > bottomLimit) return;

  tft.setTextSize(1);
  tft.setTextColor(ILI9341_WHITE);
  tft.setCursor(8, y + 2);
  tft.print(periodLabel(period));
  tft.drawFastHLine(8, y + 13, SCREEN_W - 16, ILI9341_DARKGREY);
  y += 16;

  for (int i = 0; i < activityCount; i++) {
    if (schedule[i].day != day || schedule[i].period != period) continue;

    int cardH = nameFitsOneLine(schedule[i].name) ? 27 : 43;
    if (y + cardH > bottomLimit) {
      tft.setTextSize(1);
      tft.setTextColor(ILI9341_WHITE);
      tft.setCursor(8, bottomLimit - 8);
      tft.print("More activities...");
      y = bottomLimit;
      return;
    }

    cardH = drawActivityCard(schedule[i], y);
    y += cardH + 3;   // small gap between cards
  }
}

static String formatTime(int minutesOfDay) {
  char buf[8];
  snprintf(buf, sizeof(buf), "%d:%02d", minutesOfDay / 60, minutesOfDay % 60);
  return String(buf);
}

// ---------------------------------------------------------------------
//  Public functions
// ---------------------------------------------------------------------
void displayBegin() {
  tft.begin();
  tft.setRotation(0);   // portrait
  tft.fillScreen(ILI9341_BLACK);
}

void displaySplash(const char *title, const char *subtitle) {
  tft.fillScreen(ILI9341_BLACK);
  tft.setTextColor(ILI9341_WHITE);
  tft.setTextSize(2);
  tft.setCursor(16, 110);
  tft.println(title);
  tft.setTextSize(1);
  tft.setCursor(16, 140);
  tft.println(subtitle);
}

void displayDay(int day, bool isToday, int reminderPeriod) {
  tft.fillScreen(ILI9341_BLACK);

  // Header: day name (+ "TODAY" tag on the right).
  tft.setTextColor(ILI9341_WHITE);
  tft.setTextSize(2);
  tft.setCursor(8, 6);
  tft.print(dayLabel(day));
  if (isToday) {
    tft.setTextSize(1);
    tft.setTextColor(ILI9341_LIGHTGREY);
    tft.setCursor(SCREEN_W - 8 - textWidth("TODAY", 1), 11);
    tft.print("TODAY");
  }
  tft.drawFastHLine(8, HEADER_H, SCREEN_W - 16, ILI9341_WHITE);

  int y = HEADER_H + 3;

  if (reminderPeriod >= 0) {
    // Reminder view: a calm banner + only the block that is coming up.
    uint16_t bannerColor = rgb565(60, 60, 70);   // dark, not bright
    tft.fillRoundRect(8, y, SCREEN_W - 16, 28, 4, bannerColor);
    tft.setTextSize(2);
    tft.setTextColor(ILI9341_WHITE);
    String text = "Coming up " + formatTime(periodStartMinutes(reminderPeriod));
    tft.setCursor(16, y + 7);
    tft.print(text);
    y += 33;
    drawPeriodSection(day, reminderPeriod, y);
  } else if (countActivities(day, -1) == 0) {
    tft.setTextSize(2);
    tft.setTextColor(ILI9341_WHITE);
    tft.setCursor(25, 130);
    tft.print("No activities");
  } else {
    for (int p = 0; p < NUM_PERIODS; p++) drawPeriodSection(day, p, y);
  }

  // Footer, first row (the second row is the status line).
  tft.fillRect(0, SCREEN_H - FOOTER_H, SCREEN_W, FOOTER_H, ILI9341_BLACK);
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_LIGHTGREY);
  tft.setCursor(8, INFO_Y);
  if (reminderPeriod >= 0) {
    tft.print("Press DONE when ready");
  } else {
    int n = countActivities(day, -1);
    tft.print(n);
    tft.print(n == 1 ? " activity" : " activities");
    tft.print("  Next: ");
    tft.print(dayLabel((day + 1) % NUM_DAYS));
  }
}

void displayStatus(const DeviceStatus &st) {
  tft.fillRect(0, STATUS_Y - 1, SCREEN_W, SCREEN_H - (STATUS_Y - 1), ILI9341_BLACK);
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_LIGHTGREY);
  tft.setCursor(8, STATUS_Y);
  tft.print(st.connected ? "Connected" : "Not connected");
  tft.print("  ");
  if (!st.sdOk) {
    tft.print("No SD card");
  } else {
    tft.print(st.notesWaiting);
    tft.print(st.notesWaiting == 1 ? " note waiting" : " notes waiting");
  }
  if (st.minutesOfDay >= 0) {
    String t = formatTime(st.minutesOfDay);
    tft.setCursor(SCREEN_W - 8 - textWidth(t, 1), STATUS_Y);
    tft.print(t);
  }
}

void displayMessage(const char *line1, const char *line2) {
  tft.fillScreen(ILI9341_BLACK);
  printCentered(String(line1), 125, 2, ILI9341_WHITE);
  if (line2 && line2[0]) printCentered(String(line2), 155, 2, ILI9341_LIGHTGREY);
}

void displayRecordingStart() {
  tft.fillScreen(ILI9341_BLACK);
  tft.fillCircle(SCREEN_W / 2, 80, 14, rgb565(244, 182, 182));   // soft red dot
  printCentered("Recording...", 115, 2, ILI9341_WHITE);
  printCentered("Release to stop", 250, 1, ILI9341_LIGHTGREY);
  displayRecordingSeconds(0);
}

void displayRecordingSeconds(uint32_t seconds) {
  tft.fillRect(0, 150, SCREEN_W, 40, ILI9341_BLACK);
  String s = String(seconds) + "s";
  printCentered(s, 155, 4, ILI9341_WHITE);
}
