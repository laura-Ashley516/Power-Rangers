#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define TFT_CS 5
#define TFT_DC 2
#define TFT_RST 4
Adafruit_ILI9341 tft(TFT_CS, TFT_DC, TFT_RST);

#define SERVICE_UUID      "12345678-1234-1234-1234-1234567890ab"
#define RX_CHARACTERISTIC "12345678-1234-1234-1234-1234567890ac"
#define TX_CHARACTERISTIC "12345678-1234-1234-1234-1234567890ad"

#define MAX_ACTIVITIES 35
const int SCREEN_W = 240;
const int SCREEN_H = 320;
const int HEADER_H = 30;
const int FOOTER_H = 12;

struct Activity {
  String day;
  String period;
  String name;
  String energy;
};

Activity schedule[MAX_ACTIVITIES];
int activityCount = 0;
bool receivingSchedule = false;
BLECharacteristic *txCharacteristic = nullptr;

const char *days[] = {
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY",
  "FRIDAY", "SATURDAY", "SUNDAY"
};
const char *periods[] = {"MORNING", "AFTERNOON", "EVENING"};
int currentDay = 0;
unsigned long lastDayChange = 0;
const unsigned long DAY_INTERVAL = 10000;

String normalized(String s) {
  s.trim();
  s.toLowerCase();
  return s;
}

String canonicalDay(String s) {
  s = normalized(s);
  for (int i = 0; i < 7; i++) {
    String d = String(days[i]);
    d.toLowerCase();
    if (s == d) return String(days[i]);
  }
  s.toUpperCase();
  return s;
}

bool isDay(String s) {
  s = canonicalDay(s);
  for (int i = 0; i < 7; i++) if (s == String(days[i])) return true;
  return false;
}

String canonicalPeriod(String s) {
  s = normalized(s);
  if (s == "morning" || s == "am") return "MORNING";
  if (s == "afternoon" || s == "pm") return "AFTERNOON";
  if (s == "evening" || s == "night") return "EVENING";
  return "";
}

// Accept the labels sent by the web app and common alternate labels.
String canonicalEnergy(String s) {
  s = normalized(s);
  if (s == "green" || s == "easy" || s == "low" ||
      s == "low energy" || s == "#dce8d9" || s == "#4caf50" ||
      s == "#b7e4c7") return "green";
  if (s == "yellow" || s == "moderate" || s == "medium" ||
      s == "moderate energy" || s == "#f4df85" || s == "#ffeb3b" ||
      s == "#f9e79f") return "yellow";
  if (s == "red" || s == "high" || s == "high energy" ||
      s == "#e9a39d" || s == "#f44336" || s == "#f4b6b6") return "red";

  Serial.print("Unrecognized energy label: [");
  Serial.print(s);
  Serial.println("] - using blue diagnostic colour");
  return "unknown";
}

uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

uint16_t energyColor(String energy) {
  energy = canonicalEnergy(energy);

  // Match the web app's pastel energy colors:
  // green #B7E4C7, yellow #F9E79F, red #F4B6B6.
  if (energy == "green")  return rgb565(183, 228, 199);
  if (energy == "yellow") return rgb565(249, 231, 159);
  if (energy == "red")    return rgb565(244, 182, 182);

  return rgb565(100, 160, 230); // Diagnostic blue for unknown labels.
}

int textWidth(String s, uint8_t size) {
  int16_t x1, y1;
  uint16_t w, h;
  tft.setTextSize(size);
  tft.getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return (int)w;
}

// Draws one or two lines and returns the required text height.
int drawName(String name, int x, int y, int maxWidth, uint8_t size, int maxLines) {
  name.trim();
  if (!name.length()) name = "Activity";
  tft.setTextSize(size);
  tft.setTextColor(ILI9341_BLACK);

  const int lineH = 8 * size + 1;
  String lines[2] = {"", ""};
  int line = 0;
  int pos = 0;

  while (pos < name.length() && line < maxLines) {
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

bool periodHasActivities(String period) {
  for (int i = 0; i < activityCount; i++) {
    if (schedule[i].day == String(days[currentDay]) &&
        schedule[i].period == period) return true;
  }
  return false;
}

int drawActivityCard(const Activity &a, int y) {
  const int x = 8;
  const int w = SCREEN_W - 16;
  const int textX = x + 7;
  const int maxTextW = w - 14;

  String name = a.name;
  name.trim();
  if (!name.length()) name = "Activity";

  // Prefer a single large line. Use two lines only when the name needs them.
  uint8_t size = (textWidth(name, 2) <= maxTextW) ? 2 : 2;
  int textH = 8 * size + 1;
  bool oneLine = textWidth(name, size) <= maxTextW;

  // If it doesn't fit on one line, estimate a two-line card.
  int cardH = oneLine ? 27 : 43;
  tft.fillRoundRect(x, y, w, cardH, 4, energyColor(a.energy));
  tft.drawRoundRect(x, y, w, cardH, 4, ILI9341_DARKGREY);

  int textY = y + (cardH - (oneLine ? textH : 2 * textH)) / 2;
  drawName(name, textX, textY, maxTextW, size, oneLine ? 1 : 2);
  return cardH;
}

void drawPeriodSection(String period, int &y) {
  if (!periodHasActivities(period)) return;

  const int bottomLimit = SCREEN_H - FOOTER_H - 2;
  if (y + 16 > bottomLimit) return;

  tft.setTextSize(1);
  tft.setTextColor(ILI9341_WHITE);
  tft.setCursor(8, y + 2);
  tft.print(period);
  tft.drawFastHLine(8, y + 13, SCREEN_W - 16, ILI9341_DARKGREY);
  y += 16;

  for (int i = 0; i < activityCount; i++) {
    if (schedule[i].day != String(days[currentDay]) ||
        schedule[i].period != period) continue;

    String name = schedule[i].name;
    name.trim();
    bool oneLine = textWidth(name, 2) <= SCREEN_W - 30;
    int cardH = oneLine ? 27 : 43;

    if (y + cardH > bottomLimit) {
      tft.setTextSize(1);
      tft.setTextColor(ILI9341_WHITE);
      tft.setCursor(8, bottomLimit - 8);
      tft.print("More activities...");
      return;
    }

    cardH = drawActivityCard(schedule[i], y);
    y += cardH + 3; // Small gap instead of 5+ pixels of wasted space.
  }
}

void displayCurrentDay() {
  tft.fillScreen(ILI9341_BLACK);
  tft.setTextColor(ILI9341_WHITE);
  tft.setTextSize(2);
  tft.setCursor(8, 6);
  tft.print(days[currentDay]);
  tft.drawFastHLine(8, HEADER_H, SCREEN_W - 16, ILI9341_WHITE);

  bool any = false;
  for (int i = 0; i < activityCount; i++) {
    if (schedule[i].day == String(days[currentDay])) {
      any = true;
      break;
    }
  }

  if (!any) {
    tft.setTextSize(2);
    tft.setTextColor(ILI9341_WHITE);
    tft.setCursor(25, 130);
    tft.print("No activities");
  } else {
    int y = HEADER_H + 3;
    drawPeriodSection("MORNING", y);
    drawPeriodSection("AFTERNOON", y);
    drawPeriodSection("EVENING", y);
  }

  tft.fillRect(0, SCREEN_H - FOOTER_H, SCREEN_W, FOOTER_H, ILI9341_BLACK);
  tft.setTextSize(1);
  tft.setTextColor(ILI9341_LIGHTGREY);
  tft.setCursor(8, SCREEN_H - 10);
  tft.print("Next: ");
  tft.print(days[(currentDay + 1) % 7]);
}

void parseActivity(String line) {
  line.trim();
  int separators[3] = {-1, -1, -1};
  int found = 0;
  for (int i = 0; i < line.length() && found < 3; i++) {
    if (line.charAt(i) == '|') separators[found++] = i;
  }

  if (found < 2) {
    Serial.println("Ignored malformed activity row.");
    return;
  }
  if (activityCount >= MAX_ACTIVITIES) {
    Serial.println("Schedule full; activity ignored.");
    return;
  }

  Activity a;
  if (found == 3) {
    // Format sent by updated web app: day|period|name|energy
    a.day = canonicalDay(line.substring(0, separators[0]));
    a.period = canonicalPeriod(line.substring(separators[0] + 1, separators[1]));
    a.name = line.substring(separators[1] + 1, separators[2]);
    a.energy = canonicalEnergy(line.substring(separators[2] + 1));

    // If this is an old sender with day|name|energy|extra, flag it in Serial.
    if (a.period == "") {
      Serial.println("Invalid/missing period; placing activity in MORNING.");
      a.period = "MORNING";
    }
  } else {
    // Legacy format: day|name|energy. No period is available, so default to morning.
    a.day = canonicalDay(line.substring(0, separators[0]));
    a.period = "MORNING";
    a.name = line.substring(separators[0] + 1, separators[1]);
    a.energy = canonicalEnergy(line.substring(separators[1] + 1));
  }

  a.day.trim();
  a.period.trim();
  a.name.trim();

  if (!isDay(a.day)) {
    Serial.print("Ignored unknown day: ");
    Serial.println(a.day);
    return;
  }
  if (a.name.length() == 0) a.name = "Activity";

  schedule[activityCount++] = a;
  Serial.print("Added: ");
  Serial.print(a.day); Serial.print(" | ");
  Serial.print(a.period); Serial.print(" | ");
  Serial.print(a.name); Serial.print(" | ");
  Serial.println(a.energy);
}

class MyCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) override {
    String value = pCharacteristic->getValue().c_str();
    value.trim();
    Serial.print("Received: ");
    Serial.println(value);

    if (value == "SCHEDULE_START") {
      activityCount = 0;
      receivingSchedule = true;
      Serial.println("Receiving schedule...");
      return;
    }

    if (value == "SCHEDULE_END") {
      receivingSchedule = false;
      currentDay = 0;
      displayCurrentDay();
      lastDayChange = millis();
      if (txCharacteristic) {
        txCharacteristic->setValue("SCHEDULE_RECEIVED");
        txCharacteristic->notify();
      }
      Serial.println("Schedule received and displayed.");
      return;
    }

    if (receivingSchedule) parseActivity(value);
  }
};

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *pServer) override {
    Serial.println("BLE connected.");
  }
  void onDisconnect(BLEServer *pServer) override {
    Serial.println("BLE disconnected; restarting advertising.");
    BLEDevice::startAdvertising();
  }
};

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\nAccessible Scheduler starting...");

  tft.begin();
  tft.setRotation(0); // Portrait
  tft.fillScreen(ILI9341_BLACK);
  tft.setTextColor(ILI9341_WHITE);
  tft.setTextSize(2);
  tft.setCursor(16, 110);
  tft.println("Scheduler");
  tft.setTextSize(1);
  tft.setCursor(16, 140);
  tft.println("Waiting for schedule...");
  delay(900);

  BLEDevice::init("Barbara Scheduler");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new MyServerCallbacks());
  BLEService *service = server->createService(SERVICE_UUID);

  BLECharacteristic *rxCharacteristic = service->createCharacteristic(
    RX_CHARACTERISTIC, BLECharacteristic::PROPERTY_WRITE
  );
  rxCharacteristic->setCallbacks(new MyCallbacks());

  txCharacteristic = service->createCharacteristic(
    TX_CHARACTERISTIC, BLECharacteristic::PROPERTY_NOTIFY
  );
  txCharacteristic->addDescriptor(new BLE2902());

  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.println("BLE advertising started.");
  displayCurrentDay();
  lastDayChange = millis();
}

void loop() {
  if (!receivingSchedule && millis() - lastDayChange >= DAY_INTERVAL) {
    currentDay = (currentDay + 1) % 7;
    displayCurrentDay();
    lastDayChange = millis();
  }
}
