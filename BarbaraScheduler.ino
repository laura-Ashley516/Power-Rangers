/*
  Barbara Scheduler v2 — ESP32 + ILI9341 (240x320) + XPT2046 touch

  What's new in this version
  - Touch: tap fires instantly on press (no blocking loops), with a built-in
    3-point touch calibration that is saved to flash. Hold the screen during
    the boot splash (or send 'c' over Serial) to recalibrate.
  - BLE data is queued and drawn ONLY from loop(). The old code drew the
    screen from the BLE task while loop() was drawing too, which caused
    stalls and wrong screens.
  - Text is rendered off-screen and sent to the display in one burst, so
    pages draw much faster than with per-pixel font drawing.
  - Navigation: big BACK bar at the bottom of every sub-page (plus PREV/NEXT
    when an activity list needs more than one page).
  - Dynamic layout: 1 activity = one huge card with huge text; more activities
    share the space equally and the font steps down only as needed.
  - Palette taken from the planner image: olive, cream, terracotta.
    Energy colours are soft and warm: sage (low), sand (medium),
    terracotta (high). No pure white, no saturated red/yellow.

  BLE protocol (unchanged, matches the existing HTML sender):
    SCHEDULE_START
    day|period|activity name|energy      (one row per write)
    SCHEDULE_END   -> ESP32 replies SCHEDULE_RECEIVED
  Legacy rows day|activity name|energy are still accepted (-> Morning).

  Wiring (unchanged):
    TFT_CS=5  TFT_DC=2  TFT_RST=4   SCK=18  MISO=19  MOSI=23
    T_CS=15   (T_IRQ not used)

  Libraries: Adafruit GFX, Adafruit ILI9341, XPT2046_Touchscreen,
             ESP32 BLE Arduino (+ Preferences, included with the ESP32 core)
*/

#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <XPT2046_Touchscreen.h>
#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold18pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "Types.h"

// -------------------- PINS --------------------
#define TFT_CS    5
#define TFT_DC    2
#define TFT_RST   4
#define TOUCH_CS  15

const int SCR_W = 240;
const int SCR_H = 320;

Adafruit_ILI9341 tft(TFT_CS, TFT_DC, TFT_RST);
XPT2046_Touchscreen touch(TOUCH_CS);

// Off-screen strip used to draw text quickly (240 x 60 x 2 bytes = ~29 KB).
const int CANVAS_H = 60;
GFXcanvas16 canvas(SCR_W, CANVAS_H);

Preferences prefs;

// -------------------- BLE --------------------
static const char* DEVICE_NAME  = "Barbara Scheduler";
static const char* SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
static const char* RX_UUID      = "12345678-1234-1234-1234-1234567890ac";
static const char* TX_UUID      = "12345678-1234-1234-1234-1234567890ad";

BLECharacteristic* txCharacteristic = nullptr;

// BLE callbacks only drop lines in this queue; loop() does all the work.
const int BLE_LINE_MAX = 128;
struct BleMsg { char text[BLE_LINE_MAX]; };
QueueHandle_t bleQueue = nullptr;

bool receivingSchedule = false;
bool wantWeekRedraw = false;

// -------------------- COLOURS (from the planner image) --------------------
constexpr uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

const uint16_t C_BG      = rgb565(123, 135,  88);  // olive background
const uint16_t C_BAR     = rgb565( 94, 106,  66);  // deeper olive (bottom bar)
const uint16_t C_CREAM   = rgb565(248, 228, 205);  // title cream
const uint16_t C_SUB     = rgb565(236, 218, 186);  // small text on olive
const uint16_t C_CARD    = rgb565(242, 218, 198);  // peach/cream cards
const uint16_t C_OLIVE   = rgb565( 84,  96,  56);  // dark olive text on cards
const uint16_t C_INK     = rgb565( 58,  36,  20);  // dark brown text
const uint16_t C_MUTED   = rgb565(112,  88,  66);  // muted brown caption
const uint16_t C_TERRA   = rgb565(212, 130,  74);  // terracotta accent
const uint16_t C_RUST    = rgb565(184,  92,  48);  // rust accent
const uint16_t C_EDGE    = rgb565(104,  74,  46);  // card outline

// Energy colours: all warm and soft, no pure red / yellow / green.
const uint16_t C_LOW     = rgb565(176, 198, 140);  // sage        (green)
const uint16_t C_MED     = rgb565(238, 198, 116);  // warm sand   (yellow)
const uint16_t C_HIGH    = rgb565(214, 124,  84);  // terracotta  (red)
const uint16_t C_OTHER   = rgb565(226, 200, 176);  // unknown energy

// -------------------- DATA --------------------
const int DAY_COUNT = 7;
const int PERIOD_COUNT = 3;
const int MAX_ACTIVITIES = 70;

const char* days[DAY_COUNT] = {
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
};
const char* periods[PERIOD_COUNT] = { "Morning", "Afternoon", "Evening" };

enum { ENERGY_LOW = 0, ENERGY_MED = 1, ENERGY_HIGH = 2, ENERGY_OTHER = 3 };

Activity activities[MAX_ACTIVITIES];
int activityCount = 0;

// -------------------- SCREEN STATE --------------------
ScreenPage currentPage = PAGE_WEEK;
int selectedDay = 0;
int selectedPeriod = 0;
int actPage = 0;    // current page of the activity list
int actPages = 1;   // number of pages for the current list

// -------------------- LAYOUT --------------------
const int HDR_H = 50;
const int BAR_H = 46;
const int BAR_Y = SCR_H - BAR_H;            // 274
const int CONTENT_TOP = HDR_H + 6;          // 56
const int CONTENT_BOTTOM = BAR_Y - 6;       // 268

const int WEEK_TOP = 58;
const int WEEK_W = 108;
const int WEEK_H = 56;
const int WEEK_GAP = 7;

const int MAX_PER_PAGE = 6;

bool hit(const Rect& r, int x, int y, int pad = 0) {
  return x >= r.x - pad && x < r.x + r.w + pad &&
         y >= r.y - pad && y < r.y + r.h + pad;
}

Rect weekRect(int i) {
  int col = i % 2, row = i / 2;
  Rect r = { (int16_t)(8 + col * (WEEK_W + 8)),
             (int16_t)(WEEK_TOP + row * (WEEK_H + WEEK_GAP)),
             WEEK_W, WEEK_H };
  return r;
}

Rect periodRect(int i) {
  Rect r = { 10, (int16_t)(CONTENT_TOP + i * 74), 220, 64 };
  return r;
}

// -------------------- FONTS / TEXT --------------------
const GFXfont* F_R9  = &FreeSans9pt7b;
const GFXfont* F_B9  = &FreeSansBold9pt7b;
const GFXfont* F_B12 = &FreeSansBold12pt7b;
const GFXfont* F_B18 = &FreeSansBold18pt7b;
const GFXfont* F_B24 = &FreeSansBold24pt7b;

const int FIT_FONTS = 4;
const GFXfont* FIT[FIT_FONTS] = { F_B24, F_B18, F_B12, F_B9 };

enum { A_LEFT = 0, A_CENTER = 1, A_RIGHT = 2 };

void setMeasureFont(const GFXfont* f) {
  canvas.setFont(f);       // nullptr = built-in 6x8 font
  canvas.setTextSize(1);
}

int measureW(const String& s) {
  int16_t x1, y1;
  uint16_t w, h;
  canvas.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return (int)w;
}

void fontMetrics(const GFXfont* f, int& asc, int& desc) {
  setMeasureFont(f);
  int16_t x1, y1;
  uint16_t w, h;
  canvas.getTextBounds("Ag", 0, 0, &x1, &y1, &w, &h);
  asc = -y1;
  desc = (int)h + y1;
}

// Draw one line of text. `baseline` is the text baseline in screen pixels
// (for the built-in font: the bottom of the capital letters).
// The text is drawn into RAM first, then pushed to the TFT in one go.
void drawText(const String& s, const GFXfont* f, int ax, int baseline,
              int align, uint16_t fg, uint16_t bg) {
  if (s.length() == 0) return;
  setMeasureFont(f);
  int16_t x1, y1;
  uint16_t w, h;
  canvas.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  if (w == 0 || h == 0) return;
  if (w > SCR_W) w = SCR_W;
  if (h > CANVAS_H) h = CANVAS_H;

  canvas.fillRect(0, 0, w, h, bg);
  canvas.setTextColor(fg);
  canvas.setTextWrap(false);
  canvas.setCursor(-x1, f ? -y1 : 0);
  canvas.print(s);

  int left = (align == A_CENTER) ? ax - (int)w / 2 : (align == A_RIGHT ? ax - (int)w : ax);
  int top = f ? baseline + y1 : baseline - 7;
  if (left < 0) left = 0;
  if (left + (int)w > SCR_W) left = SCR_W - (int)w;

  uint16_t* buf = canvas.getBuffer();
  tft.startWrite();
  tft.setAddrWindow(left, top, w, h);
  for (int r = 0; r < (int)h; r++) {
    tft.writePixels(buf + r * SCR_W, w);
  }
  tft.endWrite();
}

// Word-wrap `text` to maxW pixels using the font currently set on the canvas.
// Returns the number of lines, or maxLines+1 if it does not fit.
int wrapText(const String& text, int maxW, String lines[], int maxLines) {
  int n = 0;
  String line = "";
  int i = 0;
  int len = text.length();

  while (i < len) {
    while (i < len && text[i] == ' ') i++;
    if (i >= len) break;
    int j = text.indexOf(' ', i);
    if (j < 0) j = len;
    String word = text.substring(i, j);
    i = j;

    // A single word wider than the card is split across lines.
    while (measureW(word) > maxW && word.length() > 1) {
      int k = word.length() - 1;
      while (k > 1 && measureW(word.substring(0, k)) > maxW) k--;
      if (line.length()) {
        if (n >= maxLines) return maxLines + 1;
        lines[n++] = line;
        line = "";
      }
      if (n >= maxLines) return maxLines + 1;
      lines[n++] = word.substring(0, k);
      word = word.substring(k);
    }

    String cand = line.length() ? line + " " + word : word;
    if (measureW(cand) <= maxW) {
      line = cand;
    } else {
      if (n >= maxLines) return maxLines + 1;
      lines[n++] = line;
      line = word;
    }
  }
  if (line.length()) {
    if (n >= maxLines) return maxLines + 1;
    lines[n++] = line;
  }
  return n;
}

// Centre text inside a box, using the biggest font (starting at FIT[startIdx])
// that fits. Falls back to the smallest font with "..." if nothing fits.
void drawFitText(const String& text, int x, int y, int w, int h,
                 uint16_t fg, uint16_t bg, int startIdx) {
  const int MAX_LINES = 12;
  const int usableW = w - 16;
  const int usableH = h - 10;
  String lines[MAX_LINES];
  int chosen = -1, n = 0, pitch = 0, asc = 0, desc = 0;

  for (int fi = startIdx; fi < FIT_FONTS; fi++) {
    fontMetrics(FIT[fi], asc, desc);
    int p = asc + desc + 5;
    int maxL = (usableH - asc - desc) / p + 1;
    if (maxL < 1) continue;
    if (maxL > MAX_LINES) maxL = MAX_LINES;
    setMeasureFont(FIT[fi]);
    int c = wrapText(text, usableW, lines, maxL);
    if (c >= 1 && c <= maxL) {
      chosen = fi;
      n = c;
      pitch = p;
      break;
    }
  }

  if (chosen < 0) {
    chosen = FIT_FONTS - 1;
    fontMetrics(FIT[chosen], asc, desc);
    pitch = asc + desc + 5;
    int maxL = (usableH - asc - desc) / pitch + 1;
    if (maxL < 1) maxL = 1;
    if (maxL > MAX_LINES) maxL = MAX_LINES;
    setMeasureFont(FIT[chosen]);
    int c = wrapText(text, usableW, lines, maxL);
    bool truncated = c > maxL;
    n = truncated ? maxL : c;
    if (n < 1) return;
    if (truncated) {
      lines[n - 1] += "...";
      while (measureW(lines[n - 1]) > usableW && lines[n - 1].length() > 4) {
        lines[n - 1].remove(lines[n - 1].length() - 4, 1);
      }
    }
  }

  int totalH = (n - 1) * pitch + asc + desc;
  int top = y + (h - totalH) / 2;
  for (int i = 0; i < n; i++) {
    drawText(lines[i], FIT[chosen], x + w / 2, top + asc + i * pitch,
             A_CENTER, fg, bg);
  }
}

// -------------------- DATA HELPERS --------------------
uint16_t levelColour(uint8_t level) {
  switch (level) {
    case ENERGY_LOW:  return C_LOW;
    case ENERGY_MED:  return C_MED;
    case ENERGY_HIGH: return C_HIGH;
    default:          return C_OTHER;
  }
}

// Returns total count; c[0..3] = per energy level. period < 0 means all.
int levelCounts(int day, int period, int c[4]) {
  c[0] = c[1] = c[2] = c[3] = 0;
  int total = 0;
  for (int i = 0; i < activityCount; i++) {
    if (activities[i].day == day && (period < 0 || activities[i].period == period)) {
      c[activities[i].energy]++;
      total++;
    }
  }
  return total;
}

int dayIndex(String v) {
  v.trim();
  v.toLowerCase();
  for (int i = 0; i < DAY_COUNT; i++) {
    String d = String(days[i]);
    d.toLowerCase();
    if (v == d || v == d.substring(0, 3)) return i;
  }
  return -1;
}

int periodIndex(String v) {
  v.trim();
  v.toLowerCase();
  for (int i = 0; i < PERIOD_COUNT; i++) {
    String p = String(periods[i]);
    p.toLowerCase();
    if (v == p) return i;
  }
  return -1;
}

uint8_t parseEnergy(String e) {
  e.trim();
  e.toLowerCase();

  // Hex colours from the HTML sender, e.g. #B8D8B8 / #F4DF8C / #E9A6A6
  if (e.startsWith("#") && e.length() >= 7) {
    long v = strtol(e.substring(1, 7).c_str(), nullptr, 16);
    int r = (v >> 16) & 0xFF, g = (v >> 8) & 0xFF, b = v & 0xFF;
    if (g > r + 10 && g >= b) return ENERGY_LOW;     // greenish
    if (g * 100 > r * 80) return ENERGY_MED;          // yellowish
    return ENERGY_HIGH;                               // reddish
  }

  // "yellow" contains "low", so test yellow/medium BEFORE low.
  if (e.indexOf("yellow") >= 0 || e.indexOf("medium") >= 0 ||
      e.indexOf("moderate") >= 0 || e.indexOf("amber") >= 0 ||
      e.indexOf("orange") >= 0 || e == "mid" || e == "2") return ENERGY_MED;
  if (e.indexOf("green") >= 0 || e.indexOf("low") >= 0 || e == "1") return ENERGY_LOW;
  if (e.indexOf("red") >= 0 || e.indexOf("high") >= 0 || e == "3") return ENERGY_HIGH;
  return ENERGY_OTHER;
}

String getCompileDate() {
  // No Wi-Fi/RTC, so the build date is shown. __DATE__ = "Oct 17 2026"
  String d = String(__DATE__);
  String month = d.substring(0, 3);
  String day = d.substring(4, 6);
  String year = d.substring(7, 11);
  day.trim();
  return month + " " + day + ", " + year;
}

// -------------------- DRAWING: COMMON --------------------
void drawHeader(const String& title, const String& sub, bool center,
                const String& right = "") {
  tft.fillRect(0, 0, SCR_W, HDR_H, C_BG);
  tft.drawFastHLine(10, HDR_H - 2, SCR_W - 20, C_TERRA);
  tft.drawFastHLine(10, HDR_H - 1, SCR_W - 20, C_TERRA);

  if (center) {
    drawText(title, F_B18, SCR_W / 2, 28, A_CENTER, C_CREAM, C_BG);
    drawText(sub, nullptr, SCR_W / 2, 43, A_CENTER, C_SUB, C_BG);
  } else {
    drawText(title, F_B18, 10, 28, A_LEFT, C_CREAM, C_BG);
    drawText(sub, nullptr, 10, 43, A_LEFT, C_SUB, C_BG);
  }
  if (right.length()) {
    drawText(right, F_R9, SCR_W - 10, 28, A_RIGHT, C_CREAM, C_BG);
  }
}

// Bottom navigation bar. Tapping anywhere in it is handled by zone, so it is
// very forgiving. With paging: [ BACK ] [ < ] [ > ].
void drawBar(bool paging) {
  tft.fillRect(0, BAR_Y, SCR_W, BAR_H, C_BAR);
  tft.drawFastHLine(0, BAR_Y, SCR_W, C_TERRA);

  const int by = BAR_Y + 6, bh = 34;
  int bx = paging ? 6 : 8;
  int bw = paging ? 88 : 224;

  tft.fillRoundRect(bx, by, bw, bh, 9, C_TERRA);
  setMeasureFont(F_B12);
  int tw = measureW("BACK");
  int groupW = 8 + 8 + tw;
  int gx = bx + (bw - groupW) / 2;
  tft.fillTriangle(gx + 8, by + 9, gx + 8, by + bh - 9, gx, by + bh / 2, C_INK);
  drawText("BACK", F_B12, gx + 16, by + bh / 2 + 6, A_LEFT, C_INK, C_TERRA);

  if (paging) {
    tft.fillRoundRect(100, by, 62, bh, 9, C_CARD);
    tft.fillTriangle(142, by + 8, 142, by + bh - 8, 120, by + bh / 2, C_OLIVE);
    tft.fillRoundRect(170, by, 64, bh, 9, C_CARD);
    tft.fillTriangle(190, by + 8, 190, by + bh - 8, 212, by + bh / 2, C_OLIVE);
  }
}

// -------------------- DRAWING: WEEK PAGE --------------------
void drawDayCard(int i) {
  Rect r = weekRect(i);
  tft.fillRoundRect(r.x, r.y, r.w, r.h, 9, C_CARD);

  String name = String(days[i]);
  setMeasureFont(F_B9);
  const GFXfont* nf = (measureW(name) <= r.w - 14) ? F_B9 : F_R9;
  drawText(name, nf, r.x + 8, r.y + 17, A_LEFT, C_OLIVE, C_CARD);
  tft.drawFastHLine(r.x + 6, r.y + 24, r.w - 12, C_OLIVE);

  int c[4];
  int total = levelCounts(i, -1, c);
  int cy = r.y + 40;

  if (total == 0) {
    drawText("Free", F_R9, r.x + 8, r.y + 45, A_LEFT, C_MUTED, C_CARD);
    return;
  }

  int cx = r.x + 14;
  for (int lvl = 0; lvl < 4; lvl++) {
    if (c[lvl] == 0) continue;
    tft.fillCircle(cx, cy, 6, levelColour(lvl));
    tft.drawCircle(cx, cy, 6, C_EDGE);
    String num = String(c[lvl]);
    drawText(num, F_B9, cx + 10, r.y + 45, A_LEFT, C_INK, C_CARD);
    setMeasureFont(F_B9);
    cx += 10 + measureW(num) + 14;
  }
}

void drawLegendCard() {
  Rect r = weekRect(7);
  tft.fillRoundRect(r.x, r.y, r.w, r.h, 9, C_CARD);
  drawText("Energy", F_B9, r.x + 8, r.y + 17, A_LEFT, C_OLIVE, C_CARD);
  tft.drawFastHLine(r.x + 6, r.y + 24, r.w - 12, C_OLIVE);

  const char* labels[3] = { "LOW", "MED", "HIGH" };
  uint16_t cols[3] = { C_LOW, C_MED, C_HIGH };
  for (int k = 0; k < 3; k++) {
    int px = r.x + 6 + k * 33;
    tft.fillRoundRect(px, r.y + 31, 31, 16, 4, cols[k]);
    tft.drawRoundRect(px, r.y + 31, 31, 16, 4, C_EDGE);
    drawText(labels[k], nullptr, px + 15, r.y + 43, A_CENTER, C_INK, cols[k]);
  }
}

void drawWeekPage() {
  currentPage = PAGE_WEEK;
  tft.fillScreen(C_BG);
  drawHeader("Weekly Planner", getCompileDate(), true);
  for (int i = 0; i < DAY_COUNT; i++) drawDayCard(i);
  drawLegendCard();
  drawText("Tap a day to open it", nullptr, SCR_W / 2, 316, A_CENTER, C_SUB, C_BG);
}

// -------------------- DRAWING: PERIODS PAGE --------------------
void drawPeriodIcon(int p, int cx, int cy) {
  if (p == 0) {
    // Sunrise: half sun on a horizon
    tft.fillCircle(cx, cy + 5, 12, C_MED);
    tft.fillRect(cx - 18, cy + 6, 37, 14, C_CARD);
    tft.drawFastHLine(cx - 18, cy + 5, 37, C_OLIVE);
    for (int deg = -150; deg <= -30; deg += 30) {
      float a = deg * PI / 180.0f;
      tft.drawLine(cx + cosf(a) * 15, cy + 5 + sinf(a) * 15,
                   cx + cosf(a) * 20, cy + 5 + sinf(a) * 20, C_TERRA);
    }
  } else if (p == 1) {
    // Full sun
    tft.fillCircle(cx, cy, 9, C_TERRA);
    for (int k = 0; k < 8; k++) {
      float a = k * PI / 4.0f;
      tft.drawLine(cx + cosf(a) * 13, cy + sinf(a) * 13,
                   cx + cosf(a) * 19, cy + sinf(a) * 19, C_TERRA);
    }
  } else {
    // Crescent moon
    tft.fillCircle(cx - 2, cy, 12, C_RUST);
    tft.fillCircle(cx + 5, cy - 4, 10, C_CARD);
  }
}

void drawPeriodsPage() {
  currentPage = PAGE_PERIODS;
  tft.fillScreen(C_BG);
  drawHeader(String(days[selectedDay]), "Choose a time of day", false);

  for (int i = 0; i < PERIOD_COUNT; i++) {
    Rect r = periodRect(i);
    tft.fillRoundRect(r.x, r.y, r.w, r.h, 11, C_CARD);

    drawPeriodIcon(i, r.x + 28, r.y + r.h / 2);
    drawText(periods[i], F_B18, r.x + 58, r.y + 30, A_LEFT, C_OLIVE, C_CARD);

    int c[4];
    int total = levelCounts(selectedDay, i, c);
    String cap = total == 0 ? String("Nothing planned")
                            : String(total) + (total == 1 ? " activity" : " activities");
    drawText(cap, F_R9, r.x + 58, r.y + 51, A_LEFT, C_MUTED, C_CARD);

    // chevron
    int ax = r.x + r.w - 22, ay = r.y + r.h / 2;
    tft.fillTriangle(ax, ay - 9, ax, ay + 9, ax + 10, ay, C_TERRA);
  }
  drawBar(false);
}

// -------------------- DRAWING: ACTIVITIES PAGE --------------------
void drawActivityCard(int x, int y, int w, int h, const Activity& a, int cardsOnPage) {
  uint16_t bg = levelColour(a.energy);
  tft.fillRoundRect(x, y, w, h, 10, bg);
  tft.drawRoundRect(x, y, w, h, 10, C_EDGE);
  tft.drawRoundRect(x + 1, y + 1, w - 2, h - 2, 9, C_EDGE);

  // 1 card -> biggest font; few cards -> large; many cards -> medium/small.
  int startIdx = (cardsOnPage == 1) ? 0 : (cardsOnPage <= 3 ? 1 : 2);
  drawFitText(String(a.name), x, y, w, h, C_INK, bg, startIdx);
}

void drawActivitiesPage() {
  currentPage = PAGE_ACTIVITIES;
  tft.fillScreen(C_BG);

  int idx[MAX_ACTIVITIES];
  int n = 0;
  for (int i = 0; i < activityCount; i++) {
    if (activities[i].day == selectedDay && activities[i].period == selectedPeriod) {
      idx[n++] = i;
    }
  }

  String title = String(periods[selectedPeriod]);
  String sub = String(days[selectedDay]);

  if (n == 0) {
    actPages = 1;
    actPage = 0;
    drawHeader(title, sub, false);
    tft.fillRoundRect(8, CONTENT_TOP, 224, CONTENT_BOTTOM - CONTENT_TOP, 12, C_CARD);
    int mid = CONTENT_TOP + (CONTENT_BOTTOM - CONTENT_TOP) / 2;
    drawText("Nothing planned", F_B12, SCR_W / 2, mid, A_CENTER, C_OLIVE, C_CARD);
    drawText("Send a schedule from the planner", nullptr, SCR_W / 2, mid + 22,
             A_CENTER, C_MUTED, C_CARD);
    drawBar(false);
    return;
  }

  // Balanced paging: 7 activities -> pages of 4 + 3, not 6 + 1.
  actPages = (n + MAX_PER_PAGE - 1) / MAX_PER_PAGE;
  int perPage = (n + actPages - 1) / actPages;
  if (actPage < 0) actPage = 0;
  if (actPage >= actPages) actPage = actPages - 1;
  int start = actPage * perPage;
  int cnt = min(perPage, n - start);

  String right = actPages > 1 ? String(actPage + 1) + " / " + String(actPages) : String("");
  drawHeader(title, sub, false, right);

  const int gap = 6;
  int availH = CONTENT_BOTTOM - CONTENT_TOP - (cnt - 1) * gap;
  int baseH = availH / cnt;
  int rem = availH - baseH * cnt;

  int y = CONTENT_TOP;
  for (int i = 0; i < cnt; i++) {
    int h = baseH + (i < rem ? 1 : 0);
    drawActivityCard(8, y, SCR_W - 16, h, activities[idx[start + i]], cnt);
    y += h + gap;
  }
  drawBar(actPages > 1);
}

void showPage(ScreenPage p) {
  switch (p) {
    case PAGE_WEEK:       drawWeekPage();       break;
    case PAGE_PERIODS:    drawPeriodsPage();    break;
    case PAGE_ACTIVITIES: drawActivitiesPage(); break;
  }
}

// -------------------- TOUCH CALIBRATION --------------------
TouchCal cal = { false, 250, 3800, 250, 3800 };

const int CAL_L = 20;
const int CAL_R = SCR_W - 21;
const int CAL_T = 20;
const int CAL_B = SCR_H - 21;

bool calLooksValid(const TouchCal& c) {
  return abs(c.xb - c.xa) > 600 && abs(c.yb - c.ya) > 600;
}

bool loadCalibration() {
  prefs.begin("touchcal", false);
  bool ok = prefs.getBool("ok", false);
  if (ok) {
    cal.swapXY = prefs.getBool("swap", false);
    cal.xa = prefs.getInt("xa", 0);
    cal.xb = prefs.getInt("xb", 0);
    cal.ya = prefs.getInt("ya", 0);
    cal.yb = prefs.getInt("yb", 0);
  }
  prefs.end();
  return ok && calLooksValid(cal);
}

void saveCalibration() {
  prefs.begin("touchcal", false);
  prefs.putBool("swap", cal.swapXY);
  prefs.putInt("xa", cal.xa);
  prefs.putInt("xb", cal.xb);
  prefs.putInt("ya", cal.ya);
  prefs.putInt("yb", cal.yb);
  prefs.putBool("ok", true);
  prefs.end();
}

void drawCross(int x, int y) {
  tft.drawFastHLine(x - 13, y, 27, C_CREAM);
  tft.drawFastVLine(x, y - 13, 27, C_CREAM);
  tft.drawCircle(x, y, 7, C_TERRA);
  tft.fillCircle(x, y, 2, C_TERRA);
}

// Waits for a firm tap and returns the averaged raw reading.
RawPt captureRaw() {
  while (touch.touched()) delay(10);   // wait for previous release
  delay(150);
  while (true) {
    while (!touch.touched()) delay(5);
    delay(30);                          // let pressure settle
    long sx = 0, sy = 0;
    int n = 0;
    while (touch.touched() && n < 25) {
      TS_Point p = touch.getPoint();
      sx += p.x;
      sy += p.y;
      n++;
      delay(6);
    }
    if (n >= 6) {
      while (touch.touched()) delay(5);
      RawPt r;
      r.x = sx / n;
      r.y = sy / n;
      return r;
    }
  }
}

void runCalibration() {
  const int tx[3] = { CAL_L, CAL_R, CAL_L };
  const int ty[3] = { CAL_T, CAL_T, CAL_B };
  RawPt raw[3];

  while (true) {
    for (int i = 0; i < 3; i++) {
      tft.fillScreen(C_BG);
      drawText("Touch Setup", F_B18, SCR_W / 2, 120, A_CENTER, C_CREAM, C_BG);
      drawText("Tap the centre of each cross", nullptr, SCR_W / 2, 146,
               A_CENTER, C_SUB, C_BG);
      drawText(String("Point ") + (i + 1) + " of 3", nullptr, SCR_W / 2, 162,
               A_CENTER, C_SUB, C_BG);
      drawCross(tx[i], ty[i]);
      raw[i] = captureRaw();
    }

    TouchCal c;
    c.swapXY = abs(raw[1].y - raw[0].y) > abs(raw[1].x - raw[0].x);
    if (!c.swapXY) {
      c.xa = raw[0].x; c.xb = raw[1].x;
      c.ya = raw[0].y; c.yb = raw[2].y;
    } else {
      c.xa = raw[0].y; c.xb = raw[1].y;
      c.ya = raw[0].x; c.yb = raw[2].x;
    }

    if (calLooksValid(c)) {
      cal = c;
      break;
    }
    tft.fillScreen(C_BG);
    drawText("That did not look right", F_B12, SCR_W / 2, 150, A_CENTER, C_CREAM, C_BG);
    drawText("Let's try again", F_R9, SCR_W / 2, 178, A_CENTER, C_SUB, C_BG);
    delay(1400);
  }

  saveCalibration();
  tft.fillScreen(C_BG);
  drawText("Touch saved", F_B18, SCR_W / 2, 160, A_CENTER, C_CREAM, C_BG);
  delay(800);
}

void mapTouch(const TS_Point& p, int& x, int& y) {
  int rx = cal.swapXY ? p.y : p.x;
  int ry = cal.swapXY ? p.x : p.y;
  long sx = CAL_L + (long)(rx - cal.xa) * (CAL_R - CAL_L) / (cal.xb - cal.xa);
  long sy = CAL_T + (long)(ry - cal.ya) * (CAL_B - CAL_T) / (cal.yb - cal.ya);
  x = constrain((int)sx, 0, SCR_W - 1);
  y = constrain((int)sy, 0, SCR_H - 1);
}

// -------------------- TOUCH HANDLING --------------------
void handleTouch(int x, int y) {
  Serial.printf("Tap x=%d y=%d\n", x, y);

  if (currentPage == PAGE_WEEK) {
    for (int i = 0; i < DAY_COUNT; i++) {
      if (hit(weekRect(i), x, y, 3)) {
        selectedDay = i;
        drawPeriodsPage();
        return;
      }
    }
    return;
  }

  bool inBar = (y >= BAR_Y - 4);

  if (currentPage == PAGE_PERIODS) {
    if (inBar) {
      drawWeekPage();
      return;
    }
    for (int i = 0; i < PERIOD_COUNT; i++) {
      if (hit(periodRect(i), x, y, 3)) {
        selectedPeriod = i;
        actPage = 0;
        drawActivitiesPage();
        return;
      }
    }
    return;
  }

  if (currentPage == PAGE_ACTIVITIES) {
    if (!inBar) return;
    if (actPages <= 1 || x < 96) {
      drawPeriodsPage();                       // BACK
    } else if (x < 166) {
      actPage = (actPage + actPages - 1) % actPages;   // PREV (wraps)
      drawActivitiesPage();
    } else {
      actPage = (actPage + 1) % actPages;              // NEXT (wraps)
      drawActivitiesPage();
    }
  }
}

// Fires once per tap, immediately on press. No blocking loops.
void pollTouch() {
  static bool latched = false;
  static uint8_t downSamples = 0;
  static uint32_t lastSeen = 0;

  uint32_t now = millis();
  if (touch.touched()) {
    lastSeen = now;
    if (!latched && ++downSamples >= 2) {     // 2 consecutive reads = real touch
      TS_Point p = touch.getPoint();
      int x, y;
      mapTouch(p, x, y);
      latched = true;
      downSamples = 0;
      handleTouch(x, y);
    }
  } else {
    downSamples = 0;
    if (latched && now - lastSeen >= 40) latched = false;   // finger released
  }
}

// -------------------- BLE SCHEDULE --------------------
bool parseActivity(String line) {
  line.trim();
  if (line.length() == 0) return false;

  // day|period|activity name|energy   (legacy: day|activity name|energy)
  int p1 = line.indexOf('|');
  if (p1 < 0) return false;
  int p2 = line.indexOf('|', p1 + 1);
  if (p2 < 0) return false;
  int p3 = line.indexOf('|', p2 + 1);

  int d = dayIndex(line.substring(0, p1));
  if (d < 0) {
    Serial.println("Ignored row: invalid day");
    return false;
  }

  int per;
  String name, energy;
  if (p3 >= 0) {
    per = periodIndex(line.substring(p1 + 1, p2));
    name = line.substring(p2 + 1, p3);
    energy = line.substring(p3 + 1);
  } else {
    per = 0;   // legacy rows have no period -> Morning
    name = line.substring(p1 + 1, p2);
    energy = line.substring(p2 + 1);
  }
  name.trim();
  energy.trim();

  if (per < 0 || name.length() == 0) {
    Serial.println("Ignored row: missing period or activity");
    return false;
  }

  uint8_t lvl = parseEnergy(energy);

  for (int i = 0; i < activityCount; i++) {
    if (activities[i].day == d && activities[i].period == per &&
        name.equals(activities[i].name)) {
      activities[i].energy = lvl;
      return true;
    }
  }

  if (activityCount >= MAX_ACTIVITIES) {
    Serial.println("Schedule full; activity ignored");
    return false;
  }

  Activity& a = activities[activityCount++];
  a.day = d;
  a.period = per;
  a.energy = lvl;
  strncpy(a.name, name.c_str(), NAME_LEN - 1);
  a.name[NAME_LEN - 1] = 0;
  return true;
}

void handleBleLine(String line) {
  line.trim();
  if (line.length() == 0) return;
  Serial.print("BLE: ");
  Serial.println(line);

  if (line == "SCHEDULE_START") {
    receivingSchedule = true;
    activityCount = 0;
    actPage = 0;
    return;
  }

  if (line == "SCHEDULE_END") {
    receivingSchedule = false;
    wantWeekRedraw = true;
    if (txCharacteristic != nullptr) {
      txCharacteristic->setValue("SCHEDULE_RECEIVED");
      txCharacteristic->notify();
    }
    Serial.println("Schedule received.");
    return;
  }

  if (parseActivity(line) && !receivingSchedule) {
    wantWeekRedraw = true;   // single-row write without START/END
  }
}

void processBle() {
  BleMsg m;
  while (xQueueReceive(bleQueue, &m, 0) == pdTRUE) {
    handleBleLine(String(m.text));
  }
  if (wantWeekRedraw && !receivingSchedule) {
    wantWeekRedraw = false;
    actPage = 0;
    drawWeekPage();
  }
}

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    // Works with both std::string (core 2.x) and String (core 3.x).
    auto v = characteristic->getValue();
    const char* s = v.c_str();
    size_t n = v.length();

    size_t start = 0;
    for (size_t i = 0; i <= n; i++) {
      if (i == n || s[i] == '\n') {
        if (i > start) {
          BleMsg m;
          size_t len = i - start;
          if (len > BLE_LINE_MAX - 1) len = BLE_LINE_MAX - 1;
          memcpy(m.text, s + start, len);
          m.text[len] = 0;
          xQueueSend(bleQueue, &m, pdMS_TO_TICKS(50));
        }
        start = i + 1;
      }
    }
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    Serial.println("BLE client connected");
  }
  void onDisconnect(BLEServer* server) override {
    Serial.println("BLE client disconnected");
    BLEDevice::startAdvertising();
  }
};

void setupBLE() {
  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(247);   // allows longer rows per write

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);

  BLECharacteristic* rx = service->createCharacteristic(
    RX_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCallbacks());

  txCharacteristic = service->createCharacteristic(
    TX_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  txCharacteristic->addDescriptor(new BLE2902());
  txCharacteristic->setValue("READY");

  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->start();

  Serial.println("BLE advertising as Barbara Scheduler");
}

// -------------------- SETUP / LOOP --------------------
void setup() {
  Serial.begin(115200);
  delay(200);

  bleQueue = xQueueCreate(64, sizeof(BleMsg));

  SPI.begin(18, 19, 23);
  tft.begin(40000000);        // if you see glitches, lower to 27000000
  tft.setRotation(0);         // portrait 240 x 320
  tft.fillScreen(C_BG);

  touch.begin();
  touch.setRotation(1);       // raw axes; calibration handles orientation

  bool haveCal = loadCalibration();

  // Splash: hold your finger on the screen now to redo the touch setup.
  tft.fillScreen(C_BG);
  drawText("Barbara", F_B24, SCR_W / 2, 140, A_CENTER, C_CREAM, C_BG);
  drawText("Scheduler", F_B24, SCR_W / 2, 180, A_CENTER, C_CREAM, C_BG);
  drawText("Hold screen to recalibrate touch", nullptr, SCR_W / 2, 300,
           A_CENTER, C_SUB, C_BG);

  bool forceCal = false;
  uint32_t t0 = millis();
  while (millis() - t0 < 1600) {
    if (touch.touched()) { forceCal = true; break; }
    delay(10);
  }

  if (!haveCal || forceCal) runCalibration();

  setupBLE();
  drawWeekPage();
  Serial.println("Ready. Send 'c' over Serial to recalibrate touch.");
}

void loop() {
  processBle();
  pollTouch();

  if (Serial.available() && Serial.read() == 'c') {
    runCalibration();
    showPage(currentPage);
  }

  delay(2);
}
