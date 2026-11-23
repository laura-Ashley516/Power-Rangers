// =====================================================================
//  pwr_protocol.cpp  -  BLE server + every command of docs/protocol.md
// =====================================================================
//  The commands are the same for Bluetooth and Wi-Fi. Each queued line
//  remembers its transport (SRC_BLE / SRC_WIFI); sendLine() answers on
//  the transport of the line being handled. A transfer that goes on
//  over several loop() calls (voice note, planner copy) remembers the
//  transport it was started from.
// =====================================================================
#include "pwr_protocol.h"
#include "pwr_config.h"
#include "pwr_schedule.h"
#include "pwr_storage.h"
#include "pwr_clock.h"
#include "pwr_base64.h"
#include "pwr_wifi.h"
#include "pwr_app.h"

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

// ---------------------------------------------------------------------
//  Incoming lines: BLE task / Wi-Fi code -> queue -> loop()
// ---------------------------------------------------------------------
const uint8_t RX_KIND_LINE       = 0;   // a text line from the app
const uint8_t RX_KIND_DISCONNECT = 1;   // the app (BLE) or the broker (Wi-Fi) disconnected

struct RxItem {
  uint8_t kind;
  uint8_t source;   // SRC_BLE or SRC_WIFI
  char    text[RX_LINE_BUFFER + 1];
};

static QueueHandle_t rxQueue = nullptr;
static BLECharacteristic *txChar = nullptr;
static BLEServer *bleServer = nullptr;
static volatile bool bleConnected = false;
static volatile uint16_t bleConnId = 0;
static String partialLine;            // a BLE message arriving in "+" pieces (small packets)
static volatile uint32_t droppedLines = 0;   // lines lost because the queue was full

static uint8_t replySource = SRC_BLE; // transport of the line being handled right now

// ---------------------------------------------------------------------
//  Schedule transfer state
// ---------------------------------------------------------------------
static bool receivingSchedule = false;
static uint8_t scheduleSource = SRC_BLE;
static int  expectedCount = -1;       // count from SCHEDULE_START|n (-1 for v0)
static int  tempCount = 0;            // valid lines received so far
static Activity tempSchedule[MAX_ACTIVITIES];   // only copied over when complete
static uint32_t lastScheduleLineMs = 0;

// ---------------------------------------------------------------------
//  Outgoing file transfer: a voice note (D lines) or the planner copy (S lines)
// ---------------------------------------------------------------------
struct OutTransfer {
  bool     active = false;
  bool     isState = false;     // false = voice note, true = planner copy
  uint8_t  source = SRC_BLE;    // transport it goes out on
  File     file;
  int      noteId = 0;
  uint32_t seq = 0;
  uint32_t chunks = 0;
  uint32_t sum = 0;             // sum of all raw bytes (sent modulo 65536)
  int      chunkBytes = NOTE_CHUNK_BYTES;   // raw bytes per chunk, fitted to the packet size
};
static OutTransfer sending;

// ---------------------------------------------------------------------
//  v3 planner copy being received (STATE_START, S lines, STATE_END)
// ---------------------------------------------------------------------
static bool        receivingState = false;
static uint8_t     stateSource = SRC_BLE;
static uint32_t    stateBytes = 0;      // announced size
static uint32_t    stateChunks = 0;     // announced number of S lines
static uint32_t    stateUnix = 0;       // announced time
static uint32_t    stateGot = 0;        // bytes written so far
static uint32_t    stateSeq = 0;        // next expected seq
static uint32_t    stateSum = 0;
static uint32_t    lastStateLineMs = 0;
static const char *stateError = nullptr;   // why the last transfer stopped (answered at STATE_END)

// ---------------------------------------------------------------------
//  BLE callbacks. They run in the BLE task: keep them SHORT.
//  No SD card, no screen, no notify() here.
// ---------------------------------------------------------------------
class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    // getValue() returns std::string on core 2.0.x and String on 3.x;
    // .c_str() works with both.
    String value = characteristic->getValue().c_str();

    static RxItem item;   // static: keeps the BLE task stack small
    item.kind = RX_KIND_LINE;
    item.source = SRC_BLE;
    size_t n = value.length();
    if (n > (size_t)RX_LINE_BUFFER) n = RX_LINE_BUFFER;
    memcpy(item.text, value.c_str(), n);
    item.text[n] = '\0';

    if (xQueueSend(rxQueue, &item, 0) != pdTRUE) droppedLines = droppedLines + 1;   // (++ on a volatile is deprecated in C++20)
  }
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    bleConnId = server->getConnId();
    bleConnected = true;
  }
  void onDisconnect(BLEServer *server) override {
    bleConnected = false;
    // Tell loop() in order with the other lines, so a half-received
    // schedule is thrown away (the old schedule stays).
    static RxItem item;
    item.kind = RX_KIND_DISCONNECT;
    item.source = SRC_BLE;
    item.text[0] = '\0';
    xQueueSend(rxQueue, &item, 0);
    BLEDevice::startAdvertising();   // let the app reconnect
  }
};

// ---------------------------------------------------------------------
//  Small helpers
// ---------------------------------------------------------------------

static bool transportUp(uint8_t source) {
  if (source == SRC_WIFI) return wifiIsOnline();
  return bleConnected;
}

// Largest message that fits in one packet right now.
// Bluetooth: packet size - 3 bytes. The packet size (MTU) is agreed with the
// iPad/laptop after connecting; 23 is the minimum.
// Wi-Fi: one MQTT message per line, so a big number (no "+" pieces).
static int currentPayload(uint8_t source) {
  if (source == SRC_WIFI) return wifiPayload();
  uint16_t mtu = (bleServer != nullptr && bleConnected) ? bleServer->getPeerMTU(bleConnId) : 0;
  int payload = (mtu > 3) ? (int)mtu - 3 : 20;
  if (payload < 20) payload = 20;
  if (payload > MAX_MESSAGE_LEN) payload = MAX_MESSAGE_LEN;
  return payload;
}

// Raw bytes per "D|seq|base64" or "S|seq|base64" line so it fits in one packet:
// 4 base64 characters per 3 raw bytes, 8 characters for "D|12345|". Max 120.
static int chunkBytesFor(uint8_t source) {
  int n = ((currentPayload(source) - 8) / 4) * 3;
  if (n > NOTE_CHUNK_BYTES) n = NOTE_CHUNK_BYTES;
  if (n < 3) n = 3;
  return n;
}

static void notifyBytes(const uint8_t *data, size_t n) {
  txChar->setValue((uint8_t *)data, n);
  txChar->notify();
  delay(BLE_SEND_GAP_MS);
}

// Send one line to the app on the given transport.
// Bluetooth: if it is longer than one packet, it is cut into pieces: every piece
// except the last starts with '+', and the app glues them back together.
// Wi-Fi: one encrypted MQTT message, never cut.
static void sendLineTo(uint8_t source, const String &line, bool log = true) {
  size_t n = line.length();
  if (n > (size_t)MAX_MESSAGE_LEN) n = MAX_MESSAGE_LEN;

  if (source == SRC_WIFI) {
    if (!wifiSendLine(line.c_str(), n)) {
      if (log) Serial.println("TX (Wi-Fi) failed: not online.");
      return;
    }
  } else {
    if (txChar == nullptr || !bleConnected) return;
    const uint8_t *p = (const uint8_t *)line.c_str();
    size_t payload = (size_t)currentPayload(SRC_BLE);
    uint8_t piece[MAX_MESSAGE_LEN + 1];
    while (n > payload) {
      piece[0] = '+';
      memcpy(piece + 1, p, payload - 1);
      notifyBytes(piece, payload);
      p += payload - 1;
      n -= payload - 1;
    }
    notifyBytes(p, n);
  }
  if (log) {
    Serial.print(source == SRC_WIFI ? "TX (Wi-Fi): " : "TX: ");
    Serial.println(line);
  }
}

// Reply to the line being handled, on the transport it came from.
static void sendLine(const String &line, bool log = true) {
  sendLineTo(replySource, line, log);
}

// field("TIME|123|-240", 1) -> "123". Empty if the field does not exist.
static String field(const String &line, int index) {
  int start = 0;
  for (int i = 0; i < index; i++) {
    int bar = line.indexOf('|', start);
    if (bar < 0) return "";
    start = bar + 1;
  }
  int end = line.indexOf('|', start);
  if (end < 0) end = line.length();
  String s = line.substring(start, end);
  s.trim();
  return s;
}

// True if the text is a whole number (optional leading '-').
static bool isNumber(const String &s) {
  if (s.length() == 0) return false;
  unsigned int i = (s.charAt(0) == '-') ? 1 : 0;
  if (i >= s.length()) return false;
  for (; i < s.length(); i++) {
    if (!isDigit(s.charAt(i))) return false;
  }
  return true;
}

// True if the text is a whole number >= 0 (no sign).
static bool isUnsigned(const String &s) {
  return isNumber(s) && s.charAt(0) != '-';
}

static uint32_t toU32(const String &s) {
  return (uint32_t)strtoul(s.c_str(), nullptr, 10);
}

static bool isCommand(const String &cmd) {
  return cmd == "HELLO" || cmd == "TIME" ||
         cmd == "SCHEDULE_START" || cmd == "SCHEDULE_END" ||
         cmd == "BACKUP_GET" || cmd == "NOTES_LIST" ||
         cmd == "NOTE_GET" || cmd == "NOTE_DEL" ||
         cmd == "QUIET_START" || cmd == "Q" || cmd == "QUIET_END" ||
         cmd == "STATE_START" || cmd == "S" || cmd == "STATE_END" || cmd == "STATE_GET";
}

// ---------------------------------------------------------------------
//  Schedule sync (v1 safe sync, and v0)
// ---------------------------------------------------------------------
static void startSchedule(const String &line) {
  receivingSchedule = true;
  scheduleSource = replySource;
  tempCount = 0;
  lastScheduleLineMs = millis();
  if (line.indexOf('|') >= 0) {
    expectedCount = field(line, 1).toInt();   // v1: SCHEDULE_START|<count>
    Serial.printf("Receiving schedule (v1), %d lines expected...\n", expectedCount);
  } else {
    expectedCount = -1;                        // v0: bare SCHEDULE_START
    Serial.println("Receiving schedule (v0)...");
  }
  // No reply: the protocol only answers at SCHEDULE_END.
}

static void addScheduleLine(const String &line) {
  lastScheduleLineMs = millis();
  if (tempCount >= MAX_ACTIVITIES) {
    Serial.println("Schedule full; activity ignored.");
    return;
  }
  Activity a;
  if (parseActivityLine(line, a)) {
    tempSchedule[tempCount++] = a;
  }
  // A bad line is not counted, so SCHEDULE_END|<count> will not match
  // and the old schedule is kept (v1).
}

static void commitSchedule() {
  for (int i = 0; i < tempCount; i++) schedule[i] = tempSchedule[i];
  activityCount = tempCount;
  storageSaveSchedule();   // does nothing (returns false) without SD card
  appScheduleChanged();
  Serial.printf("Schedule replaced: %d activities.\n", activityCount);
}

static void finishSchedule(const String &line) {
  bool v1End = line.indexOf('|') >= 0;

  if (!receivingSchedule) {
    // SCHEDULE_END without SCHEDULE_START: nothing to replace.
    sendLine("ERR|SCHEDULE|0");
    return;
  }
  receivingSchedule = false;

  if (v1End) {
    int endCount = field(line, 1).toInt();
    bool countsMatch = (endCount == tempCount) &&
                       (expectedCount < 0 || expectedCount == endCount);
    if (countsMatch) {
      commitSchedule();
      sendLine("SCHEDULE_RECEIVED|" + String(tempCount));
    } else {
      Serial.printf("Schedule count mismatch: got %d, expected %d. Old schedule kept.\n",
                    tempCount, endCount);
      sendLine("ERR|SCHEDULE|" + String(tempCount));
    }
  } else {
    // v0: no count to check. Still uses the temporary list, so a
    // transfer that stops before SCHEDULE_END changes nothing.
    commitSchedule();
    sendLine("SCHEDULE_RECEIVED");
  }
}

// ---------------------------------------------------------------------
//  v2 quiet times: QUIET_START|n, Q|day|period (n lines), QUIET_END|n
//  Like the schedule: a temporary list, replaced only when the counts match.
// ---------------------------------------------------------------------
static bool quietTemp[NUM_DAYS][NUM_PERIODS];
static int  quietCount = 0;
static int  quietExpected = -1;
static bool receivingQuiet = false;

static void startQuiet(const String &line) {
  memset(quietTemp, 0, sizeof(quietTemp));
  quietCount = 0;
  quietExpected = field(line, 1).toInt();
  receivingQuiet = true;
}

static void addQuietLine(const String &line) {
  if (!receivingQuiet) return;
  int d = dayFromText(field(line, 1));
  int p = periodFromText(field(line, 2));
  if (d < 0 || p < 0) return;       // a bad line is not counted: the old list stays
  quietTemp[d][p] = true;
  quietCount++;
}

static void finishQuiet(const String &line) {
  int endCount = field(line, 1).toInt();
  if (!receivingQuiet || endCount != quietCount || (quietExpected >= 0 && quietExpected != endCount)) {
    receivingQuiet = false;
    sendLine("ERR|QUIET|" + String(quietCount));
    return;
  }
  receivingQuiet = false;
  memcpy(quietBlocks, quietTemp, sizeof(quietBlocks));
  storageSaveQuiet();
  sendLine("QUIET_RECEIVED|" + String(quietCount));
}

// ---------------------------------------------------------------------
//  v3 planner copy, app -> device:
//    STATE_START|<bytes>|<chunks>|<unix>, S|<seq>|<base64> (chunks lines), STATE_END|<sum16>
//  Written to /state.tmp; only swapped in when size, every seq and the sum match.
//  The only reply is at STATE_END: STATE_SAVED|<bytes> or ERR|STATE|<reason>.
// ---------------------------------------------------------------------
static void failState(const char *reason) {
  if (receivingState) storageStateAbortWrite();
  receivingState = false;
  stateError = reason;
  Serial.printf("Planner copy not saved (%s); the old copy stays.\n", reason);
}

static void startState(const String &line) {
  if (receivingState) storageStateAbortWrite();   // a new START replaces an unfinished transfer
  receivingState = false;
  stateError = nullptr;

  String bytesText = field(line, 1);
  String chunksText = field(line, 2);
  String unixText = field(line, 3);
  if (!isUnsigned(bytesText) || !isUnsigned(chunksText)) {
    stateError = "format";
    Serial.println("STATE_START: bad numbers.");
    return;
  }
  uint32_t bytes = toU32(bytesText);
  uint32_t chunks = toU32(chunksText);
  if (bytes == 0 || bytes > STATE_MAX_BYTES) {
    stateError = "size";
    Serial.printf("STATE_START: size %lu not allowed (max %lu).\n",
                  (unsigned long)bytes, (unsigned long)STATE_MAX_BYTES);
    return;
  }
  // At least 1 byte and at most NOTE_CHUNK_BYTES (120) bytes per chunk.
  if (chunks == 0 || chunks > bytes || chunks * (uint32_t)NOTE_CHUNK_BYTES < bytes) {
    stateError = "chunks";
    Serial.println("STATE_START: chunk count does not fit the size.");
    return;
  }
  if (!storageReady()) storageBegin();   // maybe the card was inserted later
  if (!storageReady()) {
    stateError = "nosd";
    Serial.println("STATE_START: no SD card.");
    return;
  }
  if (!storageStateBeginWrite()) {
    stateError = "write";
    return;
  }
  stateBytes = bytes;
  stateChunks = chunks;
  stateUnix = isUnsigned(unixText) ? toU32(unixText) : 0;
  stateGot = 0;
  stateSeq = 0;
  stateSum = 0;
  stateSource = replySource;
  lastStateLineMs = millis();
  receivingState = true;
  Serial.printf("Receiving planner copy: %lu bytes in %lu chunks...\n",
                (unsigned long)bytes, (unsigned long)chunks);
  // No reply: the protocol only answers at STATE_END.
}

static void addStateChunk(const String &line) {
  if (!receivingState) return;   // no transfer, or it already failed: ignore the rest
  lastStateLineMs = millis();

  int bar1 = line.indexOf('|');
  int bar2 = (bar1 < 0) ? -1 : line.indexOf('|', bar1 + 1);
  if (bar2 < 0) { failState("format"); return; }
  String seqText = line.substring(bar1 + 1, bar2);
  if (!isUnsigned(seqText) || toU32(seqText) != stateSeq) { failState("seq"); return; }

  const char *b64 = line.c_str() + bar2 + 1;
  size_t b64Len = line.length() - (size_t)(bar2 + 1);
  uint8_t raw[(RX_LINE_BUFFER / 4) * 3 + 3];
  int n = base64Decode(b64, b64Len, raw, sizeof(raw));
  if (n <= 0) { failState("base64"); return; }
  if (stateGot + (uint32_t)n > stateBytes) { failState("size"); return; }
  if (!storageStateWrite(raw, (size_t)n)) { failState("write"); return; }

  for (int i = 0; i < n; i++) stateSum += raw[i];
  stateGot += (uint32_t)n;
  stateSeq++;
}

static void finishState(const String &line) {
  if (!receivingState) {
    String reason = stateError ? stateError : "nostart";
    stateError = nullptr;
    sendLine("ERR|STATE|" + reason);
    return;
  }
  receivingState = false;

  String sumText = field(line, 1);
  const char *problem = nullptr;
  if (stateSeq != stateChunks) problem = "chunks";
  else if (stateGot != stateBytes) problem = "size";
  else if (!isUnsigned(sumText) || toU32(sumText) != (stateSum & 0xFFFF)) problem = "sum";

  if (problem != nullptr) {
    storageStateAbortWrite();
    Serial.printf("Planner copy not saved (%s): got %lu bytes / %lu chunks. Old copy kept.\n",
                  problem, (unsigned long)stateGot, (unsigned long)stateSeq);
    sendLine(String("ERR|STATE|") + problem);
    return;
  }
  if (!storageStateCommit(stateBytes, stateUnix)) {
    sendLine("ERR|STATE|save");
    return;
  }
  sendLine("STATE_SAVED|" + String(stateBytes));
}

// ---------------------------------------------------------------------
//  Sending a file to the app, one chunk per loop()
// ---------------------------------------------------------------------
static void startOut(File f, bool isState, int noteId, uint32_t bytes) {
  sending.file = f;
  sending.isState = isState;
  sending.noteId = noteId;
  sending.source = replySource;
  sending.seq = 0;
  sending.sum = 0;
  sending.chunkBytes = chunkBytesFor(replySource);
  sending.chunks = (bytes + sending.chunkBytes - 1) / sending.chunkBytes;
  sending.active = true;
}

static void stopOut() {
  if (sending.file) sending.file.close();
  sending.active = false;
}

// Sends the next "D|seq|base64" / "S|seq|base64" chunk, or the end line after the last one.
static void pumpOut() {
  if (!transportUp(sending.source)) {
    Serial.println("Transfer stopped: the app is no longer connected.");
    stopOut();
    return;
  }

  if (sending.seq < sending.chunks) {
    uint8_t raw[NOTE_CHUNK_BYTES];
    size_t n = sending.file.read(raw, sending.chunkBytes);
    if (n == 0) {
      // Could not read (card removed?). The app will see missing chunks
      // and can ask again.
      Serial.println("Transfer: read error.");
      if (sending.isState) sendLineTo(sending.source, "ERR|STATE|read");
      else sendLineTo(sending.source, "ERR|NOTE|" + String(sending.noteId));
      stopOut();
      return;
    }
    for (size_t i = 0; i < n; i++) sending.sum += raw[i];

    char b64[4 * ((NOTE_CHUNK_BYTES + 2) / 3) + 1];   // 161 bytes
    base64Encode(raw, n, b64);

    char msg[MAX_MESSAGE_LEN + 1];
    snprintf(msg, sizeof(msg), "%s|%lu|%s", sending.isState ? "S" : "D", (unsigned long)sending.seq, b64);
    sendLineTo(sending.source, String(msg), false);   // not logged: there are thousands
    sending.seq++;
  } else {
    if (sending.isState) {
      sendLineTo(sending.source, "STATE_DATA_END|" + String(sending.sum & 0xFFFF));
    } else {
      sendLineTo(sending.source, "DATA_END|" + String(sending.noteId) + "|" + String(sending.sum & 0xFFFF));
    }
    stopOut();
  }
}

// ---------------------------------------------------------------------
//  Other commands
// ---------------------------------------------------------------------
static void handleHello() {
  // Last field: the packet payload, so the app knows when to cut its messages into pieces
  // (Bluetooth), or that it never needs to (Wi-Fi: 1024).
  String reply = "HELLO|" + String(PROTOCOL_VERSION) + "|" + DEVICE_NAME + "|" +
                 String(activityCount) + "|" + String(storageCountNotes()) + "|" +
                 String(currentPayload(replySource));
  sendLine(reply);
}

static void handleTime(const String &line) {
  String unixText = field(line, 1);
  String offsetText = field(line, 2);
  if (!isNumber(unixText) || unixText.charAt(0) == '-') {
    sendLine("ERR|TIME");
    return;
  }
  long offset = 0;
  if (offsetText.length() > 0) {
    if (!isNumber(offsetText)) {
      sendLine("ERR|TIME");
      return;
    }
    offset = offsetText.toInt();
  }
  if (offset < -14 * 60 || offset > 14 * 60) {   // real time zones are within +-14 h
    sendLine("ERR|TIME");
    return;
  }
  uint32_t unixSeconds = (uint32_t)strtoul(unixText.c_str(), nullptr, 10);
  clockSet(unixSeconds, (int)offset);
  appClockChanged();
  sendLine("OK|TIME");
}

static void handleBackupGet() {
  // Sent from the schedule in memory (it was loaded from the SD at boot),
  // so this also works without an SD card.
  int n = activityCount;
  sendLine("BACKUP_START|" + String(n));
  for (int i = 0; i < n; i++) {
    const Activity &a = schedule[i];
    String msg = String("B|") + dayName(a.day) + "|" + periodName(a.period) + "|" +
                 a.name + "|" + energyProtocolName(a.energy);
    if (a.timeMin >= 0) msg += "|" + timeText(a.timeMin);   // v2
    sendLine(msg);
  }
  sendLine("BACKUP_END|" + String(n));
}

static void handleNotesList() {
  static NoteInfo list[MAX_NOTES_LISTED];
  int n = storageListNotes(list, MAX_NOTES_LISTED);   // 0 without SD card
  for (int i = 0; i < n; i++) {
    sendLine("NOTE|" + String(list[i].id) + "|" + String(list[i].unixTime) + "|" +
             String(list[i].bytes));
  }
  sendLine("NOTES_END|" + String(n));
}

static void handleNoteGet(const String &line) {
  String idText = field(line, 1);
  int id = idText.toInt();
  if (!storageNoteExists(id)) {
    sendLine("ERR|NOTE|" + idText);
    return;
  }
  File f = storageOpenNoteForReading(id);
  if (!f) {
    sendLine("ERR|NOTE|" + idText);
    return;
  }
  uint32_t bytes = (uint32_t)f.size();
  startOut(f, false, id, bytes);
  sendLine("DATA_START|" + String(id) + "|" + String(bytes) + "|" + String(sending.chunks));
  // The chunks are sent by pumpOut(), one per loop().
}

static void handleNoteDel(const String &line) {
  String idText = field(line, 1);
  int id = idText.toInt();
  if (!storageReady() || id < 1) {
    sendLine("ERR|NOTE|" + idText);
    return;
  }
  // Deleting a note that is already gone is fine: the app wants it gone.
  if (storageDeleteNote(id)) {
    sendLine("OK|DEL|" + String(id));
    appNotesChanged();
  } else {
    sendLine("ERR|NOTE|" + idText);
  }
}

// v3: STATE_GET -> STATE_NONE, or STATE_DATA|bytes|chunks|unix + S lines + STATE_DATA_END|sum16
static void handleStateGet() {
  uint32_t bytes = 0;
  uint32_t unixTime = 0;
  if (!storageStateInfo(bytes, unixTime)) {
    sendLine("STATE_NONE");
    return;
  }
  File f = storageOpenStateForReading();
  if (!f) {
    sendLine("STATE_NONE");
    return;
  }
  bytes = (uint32_t)f.size();
  startOut(f, true, 0, bytes);
  sendLine("STATE_DATA|" + String(bytes) + "|" + String(sending.chunks) + "|" + String(unixTime));
  // The S lines are sent by pumpOut(), one per loop().
}

// ---------------------------------------------------------------------
//  One incoming line
// ---------------------------------------------------------------------
static void handleCommand(const String &cmd, const String &line) {
  if (cmd == "HELLO")               handleHello();
  else if (cmd == "TIME")           handleTime(line);
  else if (cmd == "SCHEDULE_START") startSchedule(line);
  else if (cmd == "SCHEDULE_END")   finishSchedule(line);
  else if (cmd == "BACKUP_GET")     handleBackupGet();
  else if (cmd == "NOTES_LIST")     handleNotesList();
  else if (cmd == "NOTE_GET")       handleNoteGet(line);
  else if (cmd == "NOTE_DEL")       handleNoteDel(line);
  else if (cmd == "QUIET_START")    startQuiet(line);
  else if (cmd == "Q")              addQuietLine(line);
  else if (cmd == "QUIET_END")      finishQuiet(line);
  else if (cmd == "STATE_START")    startState(line);
  else if (cmd == "S")              addStateChunk(line);
  else if (cmd == "STATE_END")      finishState(line);
  else if (cmd == "STATE_GET")      handleStateGet();
  else {
    String shortCmd = cmd;
    if (shortCmd.length() > 150) shortCmd = shortCmd.substring(0, 150);
    sendLine("ERR|UNKNOWN|" + shortCmd);
  }
}

static void handleLine(String line) {
  line.trim();
  if (line.length() == 0) return;
  bool chunk = line.startsWith("S|");   // planner copy chunks are not logged: there are hundreds
  if (!chunk) {
    Serial.print(replySource == SRC_WIFI ? "RX (Wi-Fi): " : "RX: ");
    Serial.println(line);
  }

  String cmd = field(line, 0);

  if (receivingSchedule && !isCommand(cmd)) {
    // Inside a schedule transfer, anything that is not a command is an
    // activity line ("Monday|Morning|Walk|green").
    addScheduleLine(line);
    return;
  }
  handleCommand(cmd, line);
}

// A transport went away: drop what was half-received from it.
static void transportGone(uint8_t source) {
  if (source == SRC_BLE) {
    Serial.println("BLE disconnected; advertising again.");
    partialLine = "";
  } else {
    Serial.println("Wi-Fi: broker connection lost.");
  }
  if (receivingSchedule && scheduleSource == source) {
    receivingSchedule = false;
    Serial.println("Schedule transfer interrupted; old schedule kept.");
  }
  if (receivingState && stateSource == source) failState("disconnected");
  // An outgoing transfer notices it in pumpOut().
}

// ---------------------------------------------------------------------
//  Public functions
// ---------------------------------------------------------------------
void protocolBegin() {
  rxQueue = xQueueCreate(RX_QUEUE_LENGTH, sizeof(RxItem));

  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(BLE_MTU);

  BLEServer *server = BLEDevice::createServer();
  bleServer = server;
  server->setCallbacks(new ServerCallbacks());
  BLEService *service = server->createService(SERVICE_UUID);

  BLECharacteristic *rxChar = service->createCharacteristic(
    RX_CHARACTERISTIC,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  rxChar->setCallbacks(new RxCallbacks());

  txChar = service->createCharacteristic(
    TX_CHARACTERISTIC, BLECharacteristic::PROPERTY_NOTIFY
  );
#if !defined(CONFIG_BT_NIMBLE_ENABLED)
  txChar->addDescriptor(new BLE2902());   // Bluedroid (classic ESP32, core 2.0.x); NimBLE (ESP32-C5) adds it by itself
#endif

  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("BLE advertising started as \"" DEVICE_NAME "\".");
}

// Called by the Wi-Fi code (main task) with one decrypted line.
bool protocolQueueLine(uint8_t source, const char *text, size_t len) {
  if (rxQueue == nullptr) return false;
  if (len > (size_t)RX_LINE_BUFFER) {
    Serial.printf("RX: line of %u bytes is too long; ignored.\n", (unsigned)len);
    return false;
  }
  static RxItem item;   // not the same static as the BLE callback's
  item.kind = RX_KIND_LINE;
  item.source = source;
  memcpy(item.text, text, len);
  item.text[len] = '\0';
  if (xQueueSend(rxQueue, &item, 0) != pdTRUE) {
    droppedLines = droppedLines + 1;   // (++ on a volatile is deprecated in C++20)
    return false;
  }
  return true;
}

void protocolTransportLost(uint8_t source) {
  if (rxQueue == nullptr) return;
  static RxItem item;
  item.kind = RX_KIND_DISCONNECT;
  item.source = source;
  item.text[0] = '\0';
  xQueueSend(rxQueue, &item, 0);
}

void protocolLoop() {
  // A schedule transfer that stopped halfway is thrown away after a while.
  if (receivingSchedule && millis() - lastScheduleLineMs > SCHEDULE_RX_TIMEOUT_MS) {
    receivingSchedule = false;
    Serial.println("Schedule transfer timed out; old schedule kept.");
  }
  // Same for the planner copy (the old /state.bin stays).
  if (receivingState && millis() - lastStateLineMs > STATE_RX_TIMEOUT_MS) {
    failState("timeout");
  }

  // While a file is being sent, send one chunk per loop() and leave the
  // other messages in the queue (the app waits for the end line anyway).
  if (sending.active) {
    pumpOut();
    return;
  }

  static RxItem item;
  int handled = 0;
  while (handled < 10 && xQueueReceive(rxQueue, &item, 0) == pdTRUE) {
    handled++;
    if (item.kind == RX_KIND_DISCONNECT) {
      transportGone(item.source);
      continue;
    }
    replySource = item.source;
    if (item.source == SRC_BLE) {
      if (item.text[0] == '+') {
        // A piece of a longer message: keep it (untrimmed) until the last piece arrives.
        if (partialLine.length() < 600) partialLine += String(item.text + 1);
        continue;
      }
      String line = partialLine + String(item.text);
      partialLine = "";
      handleLine(line);
    } else {
      handleLine(String(item.text));   // Wi-Fi: one MQTT message = one whole line, no pieces
    }
    if (sending.active) break;   // start sending the file on the next loop()
  }
}

bool protocolIsConnected() {
  return bleConnected || wifiIsOnline();
}

bool protocolIsBusy() {
  return sending.active || receivingSchedule || receivingState;
}
