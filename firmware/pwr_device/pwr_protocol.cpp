// =====================================================================
//  pwr_protocol.cpp  -  BLE server + every command of docs/protocol.md
// =====================================================================
#include "pwr_protocol.h"
#include "pwr_config.h"
#include "pwr_schedule.h"
#include "pwr_storage.h"
#include "pwr_clock.h"
#include "pwr_app.h"

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"

// ---------------------------------------------------------------------
//  Incoming lines: BLE task -> queue -> loop()
// ---------------------------------------------------------------------
const uint8_t RX_KIND_LINE       = 0;   // a text line from the app
const uint8_t RX_KIND_DISCONNECT = 1;   // the app disconnected

struct RxItem {
  uint8_t kind;
  char    text[RX_LINE_BUFFER + 1];
};

static QueueHandle_t rxQueue = nullptr;
static BLECharacteristic *txChar = nullptr;
static BLEServer *bleServer = nullptr;
static volatile bool bleConnected = false;
static volatile uint16_t bleConnId = 0;
static String partialLine;            // a message arriving in "+" pieces (small packets)
static volatile uint32_t droppedLines = 0;   // lines lost because the queue was full

// ---------------------------------------------------------------------
//  Schedule transfer state
// ---------------------------------------------------------------------
static bool receivingSchedule = false;
static int  expectedCount = -1;       // count from SCHEDULE_START|n (-1 for v0)
static int  tempCount = 0;            // valid lines received so far
static Activity tempSchedule[MAX_ACTIVITIES];   // only copied over when complete
static uint32_t lastScheduleLineMs = 0;

// ---------------------------------------------------------------------
//  Voice note transfer state
// ---------------------------------------------------------------------
static bool     sendingNote = false;
static File     noteFile;
static int      noteId = 0;
static uint32_t noteSeq = 0;
static uint32_t noteChunks = 0;
static uint32_t noteSum = 0;          // sum of all raw bytes (sent modulo 65536)
static int      noteChunkBytes = NOTE_CHUNK_BYTES;   // raw bytes per chunk, fitted to the packet size

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
    size_t n = value.length();
    if (n > (size_t)RX_LINE_BUFFER) n = RX_LINE_BUFFER;
    memcpy(item.text, value.c_str(), n);
    item.text[n] = '\0';

    if (xQueueSend(rxQueue, &item, 0) != pdTRUE) droppedLines++;
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
    item.text[0] = '\0';
    xQueueSend(rxQueue, &item, 0);
    BLEDevice::startAdvertising();   // let the app reconnect
  }
};

// ---------------------------------------------------------------------
//  Small helpers
// ---------------------------------------------------------------------

// Largest message that fits in one Bluetooth packet right now (packet size - 3 bytes).
// The packet size (MTU) is agreed with the iPad/laptop after connecting; 23 is the minimum.
static int currentPayload() {
  uint16_t mtu = (bleServer != nullptr && bleConnected) ? bleServer->getPeerMTU(bleConnId) : 0;
  int payload = (mtu > 3) ? (int)mtu - 3 : 20;
  if (payload < 20) payload = 20;
  if (payload > MAX_MESSAGE_LEN) payload = MAX_MESSAGE_LEN;
  return payload;
}

static void notifyBytes(const uint8_t *data, size_t n) {
  txChar->setValue((uint8_t *)data, n);
  txChar->notify();
  delay(BLE_SEND_GAP_MS);
}

// Send one line to the app. If it is longer than one packet, it is cut into pieces:
// every piece except the last starts with '+', and the app glues them back together.
static void sendLine(const String &line, bool log = true) {
  if (txChar == nullptr || !bleConnected) return;
  size_t n = line.length();
  if (n > (size_t)MAX_MESSAGE_LEN) n = MAX_MESSAGE_LEN;
  const uint8_t *p = (const uint8_t *)line.c_str();
  size_t payload = (size_t)currentPayload();
  uint8_t piece[MAX_MESSAGE_LEN + 1];
  while (n > payload) {
    piece[0] = '+';
    memcpy(piece + 1, p, payload - 1);
    notifyBytes(piece, payload);
    p += payload - 1;
    n -= payload - 1;
  }
  notifyBytes(p, n);
  if (log) {
    Serial.print("TX: ");
    Serial.println(line);
  }
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

static bool isCommand(const String &cmd) {
  return cmd == "HELLO" || cmd == "TIME" ||
         cmd == "SCHEDULE_START" || cmd == "SCHEDULE_END" ||
         cmd == "BACKUP_GET" || cmd == "NOTES_LIST" ||
         cmd == "NOTE_GET" || cmd == "NOTE_DEL";
}

// Our own base64 encoder (standard alphabet, with '=' padding).
// out must have room for 4 * ((len + 2) / 3) + 1 characters.
static const char BASE64_TABLE[] =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static size_t base64Encode(const uint8_t *in, size_t len, char *out) {
  size_t o = 0;
  size_t i = 0;
  // Every 3 input bytes (24 bits) become 4 characters of 6 bits each.
  while (i + 3 <= len) {
    uint32_t v = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8) | in[i + 2];
    out[o++] = BASE64_TABLE[(v >> 18) & 0x3F];
    out[o++] = BASE64_TABLE[(v >> 12) & 0x3F];
    out[o++] = BASE64_TABLE[(v >> 6) & 0x3F];
    out[o++] = BASE64_TABLE[v & 0x3F];
    i += 3;
  }
  size_t rest = len - i;
  if (rest == 1) {
    uint32_t v = (uint32_t)in[i] << 16;
    out[o++] = BASE64_TABLE[(v >> 18) & 0x3F];
    out[o++] = BASE64_TABLE[(v >> 12) & 0x3F];
    out[o++] = '=';
    out[o++] = '=';
  } else if (rest == 2) {
    uint32_t v = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8);
    out[o++] = BASE64_TABLE[(v >> 18) & 0x3F];
    out[o++] = BASE64_TABLE[(v >> 12) & 0x3F];
    out[o++] = BASE64_TABLE[(v >> 6) & 0x3F];
    out[o++] = '=';
  }
  out[o] = '\0';
  return o;
}

// ---------------------------------------------------------------------
//  Schedule sync (v1 safe sync, and v0)
// ---------------------------------------------------------------------
static void startSchedule(const String &line) {
  receivingSchedule = true;
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
//  Other commands
// ---------------------------------------------------------------------
static void handleHello() {
  // Last field: the packet payload, so the app knows when to cut its messages into pieces.
  String reply = "HELLO|" + String(PROTOCOL_VERSION) + "|" + DEVICE_NAME + "|" +
                 String(activityCount) + "|" + String(storageCountNotes()) + "|" +
                 String(currentPayload());
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
  noteFile = storageOpenNoteForReading(id);
  if (!noteFile) {
    sendLine("ERR|NOTE|" + idText);
    return;
  }
  uint32_t bytes = (uint32_t)noteFile.size();
  noteId = id;
  noteSeq = 0;
  noteSum = 0;
  // "D|12345|" + base64 must fit in one packet: 4 base64 characters per 3 raw bytes.
  noteChunkBytes = ((currentPayload() - 8) / 4) * 3;
  if (noteChunkBytes > NOTE_CHUNK_BYTES) noteChunkBytes = NOTE_CHUNK_BYTES;
  if (noteChunkBytes < 3) noteChunkBytes = 3;
  noteChunks = (bytes + noteChunkBytes - 1) / noteChunkBytes;
  sendingNote = true;
  sendLine("DATA_START|" + String(id) + "|" + String(bytes) + "|" + String(noteChunks));
  // The chunks are sent by pumpNoteTransfer(), one per loop().
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

static void stopNoteTransfer() {
  if (noteFile) noteFile.close();
  sendingNote = false;
}

// Sends the next "D|seq|base64" chunk, or DATA_END after the last one.
static void pumpNoteTransfer() {
  if (!bleConnected) {
    Serial.println("Note transfer stopped: app disconnected.");
    stopNoteTransfer();
    return;
  }

  if (noteSeq < noteChunks) {
    uint8_t raw[NOTE_CHUNK_BYTES];
    size_t n = noteFile.read(raw, noteChunkBytes);
    if (n == 0) {
      // Could not read (card removed?). The app will see missing chunks
      // and can ask again with NOTE_GET.
      Serial.println("Note transfer: read error.");
      sendLine("ERR|NOTE|" + String(noteId));
      stopNoteTransfer();
      return;
    }
    for (size_t i = 0; i < n; i++) noteSum += raw[i];

    char b64[4 * ((NOTE_CHUNK_BYTES + 2) / 3) + 1];   // 161 bytes
    base64Encode(raw, n, b64);

    char msg[MAX_MESSAGE_LEN + 1];
    snprintf(msg, sizeof(msg), "D|%lu|%s", (unsigned long)noteSeq, b64);
    sendLine(String(msg), false);   // not logged: there are thousands
    noteSeq++;
  } else {
    sendLine("DATA_END|" + String(noteId) + "|" + String(noteSum & 0xFFFF));
    stopNoteTransfer();
  }
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
  else {
    String shortCmd = cmd;
    if (shortCmd.length() > 150) shortCmd = shortCmd.substring(0, 150);
    sendLine("ERR|UNKNOWN|" + shortCmd);
  }
}

static void handleLine(String line) {
  line.trim();
  if (line.length() == 0) return;
  Serial.print("RX: ");
  Serial.println(line);

  String cmd = field(line, 0);

  if (receivingSchedule && !isCommand(cmd)) {
    // Inside a schedule transfer, anything that is not a command is an
    // activity line ("Monday|Morning|Walk|green").
    addScheduleLine(line);
    return;
  }
  handleCommand(cmd, line);
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
  txChar->addDescriptor(new BLE2902());

  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("BLE advertising started as \"" DEVICE_NAME "\".");
}

void protocolLoop() {
  // A schedule transfer that stopped halfway is thrown away after a while.
  if (receivingSchedule && millis() - lastScheduleLineMs > SCHEDULE_RX_TIMEOUT_MS) {
    receivingSchedule = false;
    Serial.println("Schedule transfer timed out; old schedule kept.");
  }

  // While a note is being sent, send one chunk per loop() and leave the
  // other messages in the queue (the app waits for DATA_END anyway).
  if (sendingNote) {
    pumpNoteTransfer();
    return;
  }

  static RxItem item;
  int handled = 0;
  while (handled < 10 && xQueueReceive(rxQueue, &item, 0) == pdTRUE) {
    handled++;
    if (item.kind == RX_KIND_DISCONNECT) {
      Serial.println("BLE disconnected; advertising again.");
      partialLine = "";
      if (receivingSchedule) {
        receivingSchedule = false;
        Serial.println("Schedule transfer interrupted; old schedule kept.");
      }
      continue;
    }
    if (item.text[0] == '+') {
      // A piece of a longer message: keep it (untrimmed) until the last piece arrives.
      if (partialLine.length() < 600) partialLine += String(item.text + 1);
      continue;
    }
    String line = partialLine + String(item.text);
    partialLine = "";
    handleLine(line);
    if (sendingNote) break;   // start sending the note on the next loop()
  }
}

bool protocolIsConnected() {
  return bleConnected;
}

bool protocolIsBusy() {
  return sendingNote || receivingSchedule;
}
