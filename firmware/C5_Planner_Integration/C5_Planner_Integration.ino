#include <LittleFS.h>
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <esp_wifi.h>
#include <esp_random.h>
#include <time.h>
#include <sys/time.h>
#include "pwr_config.h"
#include "pwr_crypto.h"
#include "pwr_voice_c5.h"
#include "pwr_display_c5.h"

// ============ CONFIGURATION ============

#if __has_include("pwr_local.h")
#include "pwr_local.h"
#else
constexpr const char* BROKER = "";
constexpr const char* PAIRING_CODE = "";
#endif
const uint16_t BROKER_PORT = 8883;

const unsigned long WIFI_RETRY = 10000;
const unsigned long MQTT_RETRY = 5000;

char topicStatus[96];

// ============ SCHEDULE STORAGE ============

const char* SCHEDULE_FILE = "/schedule.txt";
static ScheduleDisplay scheduleDisplay;
const char* SCHEDULE_TEMP = "/schedule.tmp";
const char* SCHEDULE_BACKUP = "/schedule.prev";


bool storageReady = false;
bool receivingSchedule = false;

int expectedActivities = 0;
int receivedActivities = 0;
int storedActivities = 0;

unsigned long lastSchedulePacket = 0;

File scheduleTemp;

String partialMessage;

// ============ OBJECTS ============

WiFiManager wifiManager;
WiFiClientSecure secureClient;
PubSubClient mqtt(secureClient);

// ============ VARIABLES ============

uint8_t encryptionKey[32];

char clientID[64];
char topicApp[96];
char topicDevice[96];

bool wifiWasConnected = false;
bool identityReady = false;

unsigned long lastWifiRetry = 0;
unsigned long lastMqttRetry = 0;

uint32_t acceptedMessages = 0;
uint32_t rejectedMessages = 0;
uint32_t sentMessages = 0;

// ============ MEMORY ============

void printMemory() {

  Serial.println("\n===== MEMORY =====");

  Serial.printf("Free heap: %u bytes\n",
                ESP.getFreeHeap());

  Serial.printf("Minimum free heap: %u bytes\n",
                ESP.getMinFreeHeap());

  Serial.printf("Largest free block: %u bytes\n",
                ESP.getMaxAllocHeap());

  Serial.printf("Accepted messages: %u\n",
                acceptedMessages);

  Serial.printf("Rejected messages: %u\n",
                rejectedMessages);

  Serial.printf("Sent messages: %u\n",
                sentMessages);
}

// ============ GENERATE TEST IDENTITY ============

void generateIdentity() {

  char normalizedCode[13];
  char topicID[13];

  if (!pairingCodeNormalize(
        PAIRING_CODE, normalizedCode)) {

    Serial.println("Invalid pairing code.");
    return;
  }

  if (!pairingTopicId(normalizedCode, topicID)) {
    Serial.println("Topic generation failed.");
    return;
  }

  if (!e2eDeriveKey(
        normalizedCode, encryptionKey)) {

    Serial.println("Key derivation failed.");
    return;
  }

  snprintf(clientID, sizeof(clientID),
           "PWR-C5-%s", topicID);

  snprintf(topicApp, sizeof(topicApp),
           "pwr/%s/app", topicID);

  snprintf(topicDevice, sizeof(topicDevice),
           "pwr/%s/dev", topicID);

  snprintf(topicStatus, sizeof(topicStatus),
           "pwr/%s/status", topicID);

  identityReady = true;

  Serial.println("Planner pairing initialized.");
}

void printIdentity() {

  if (!identityReady) {
    Serial.println("Pairing not initialized.");
    return;
  }

  Serial.println("\n===== PLANNER CONNECTION =====");

  Serial.printf("APP_TOPIC=%s\n", topicApp);
  Serial.printf("DEVICE_TOPIC=%s\n", topicDevice);
  Serial.printf("STATUS_TOPIC=%s\n", topicStatus);
}

// ============ ENCRYPT AND SEND ============

bool sendEncrypted(const char* message) {

  if (!mqtt.connected()) {
    return false;
  }

  char encrypted[400];

  size_t length = e2eSealToText(
    encryptionKey,
    topicDevice,
    (const uint8_t*)message,
    strlen(message),
    encrypted,
    sizeof(encrypted)
  );

  if (length == 0) {
    Serial.println("Encryption failed.");
    return false;
  }

  bool success = mqtt.publish(
    topicDevice,
    (const uint8_t*)encrypted,
    length,
    false
  );

  if (success) {

    sentMessages++;


  } else {

    Serial.println("MQTT publish failed.");
  }

  return success;
}


int countStoredActivities() {

  File file = LittleFS.open(SCHEDULE_FILE, "r");

  if (!file) return 0;

  int count = 0;

  while (file.available()) {

    String line = file.readStringUntil('\n');
    line.trim();

    if (line.length() > 0) {
      count++;
    }
  }

  file.close();

  return count;
}


// ============ INITIALIZE STORAGE ============

void setupStorage() {

  // Never automatically format existing data.
  storageReady = LittleFS.begin(false);

  if (!storageReady) {

    Serial.println("LittleFS mount failed.");
    return;
  }

  // Recover previous schedule after interrupted commit.
  if (!LittleFS.exists(SCHEDULE_FILE) &&
       LittleFS.exists(SCHEDULE_BACKUP)) {

    LittleFS.rename(
      SCHEDULE_BACKUP,
      SCHEDULE_FILE
    );
  }

  // Discard unfinished incoming schedule.
  LittleFS.remove(SCHEDULE_TEMP);

  storedActivities = countStoredActivities();

  Serial.println("LittleFS ready.");

  Serial.printf(
    "Stored activities: %d\n",
    storedActivities
  );

  Serial.printf(
    "Available storage: %u bytes\n",
    LittleFS.totalBytes() - LittleFS.usedBytes()
  );
}


// ============ CANCEL INCOMPLETE TRANSFER ============

void abortSchedule() {

  if (scheduleTemp) {
    scheduleTemp.close();
  }

  if (storageReady) {
    LittleFS.remove(SCHEDULE_TEMP);
  }

  receivingSchedule = false;

  expectedActivities = 0;
  receivedActivities = 0;
  partialMessage = "";
}


// ============ START RECEIVING SCHEDULE ============

void startSchedule(int count) {

  abortSchedule();

  if (!storageReady ||
      count < 0 ||
      count > MAX_ACTIVITIES) {

    sendEncrypted("ERR|SCHEDULE|invalid");
    return;
  }

  scheduleTemp = LittleFS.open(
    SCHEDULE_TEMP, "w"
  );

  if (!scheduleTemp) {

    sendEncrypted("ERR|SCHEDULE|storage");
    return;
  }

  expectedActivities = count;
  receivedActivities = 0;

  receivingSchedule = true;
  lastSchedulePacket = millis();

  Serial.printf(
    "\nReceiving %d activities...\n",
    count
  );
}


// ============ RECEIVE INDIVIDUAL ACTIVITY ============

void receiveActivity(const String& line) {

  if (!receivingSchedule) return;

  if (receivedActivities >= expectedActivities ||
      line.length() > 240 ||
      line.indexOf('\n') >= 0 ||
      line.indexOf('\r') >= 0) {

    abortSchedule();
    sendEncrypted("ERR|SCHEDULE|invalid");
    return;
  }

  int separators = 0;

  for (unsigned int i = 0; i < line.length(); i++) {

    if (line[i] == '|') {
      separators++;
    }
  }

  // Protocol v1 requires four fields.
  if (separators != 3) {

    abortSchedule();
    sendEncrypted("ERR|SCHEDULE|format");
    return;
  }

  size_t written = scheduleTemp.print(line);
  size_t newline = scheduleTemp.print('\n');

  if (written != line.length() || newline != 1) {

    abortSchedule();
    sendEncrypted("ERR|SCHEDULE|write");
    return;
  }

  receivedActivities++;
  lastSchedulePacket = millis();

  Serial.printf(
    "Activity %d/%d saved: %s\n",
    receivedActivities,
    expectedActivities,
    line.c_str()
  );
}


// ============ COMMIT COMPLETE SCHEDULE ============

void finishSchedule(int count) {

  if (!receivingSchedule) {

    sendEncrypted("ERR|SCHEDULE|no_transfer");
    return;
  }

  if (count != expectedActivities ||
      receivedActivities != expectedActivities) {

    char response[64];

    snprintf(
      response,
      sizeof(response),
      "ERR|SCHEDULE|%d",
      receivedActivities
    );

    abortSchedule();
    sendEncrypted(response);

    return;
  }

  scheduleTemp.flush();
  scheduleTemp.close();

  // Preserve the previous valid schedule.
  if (LittleFS.exists(SCHEDULE_FILE)) {

    LittleFS.remove(SCHEDULE_BACKUP);

    if (!LittleFS.rename(
          SCHEDULE_FILE,
          SCHEDULE_BACKUP)) {

      abortSchedule();
      sendEncrypted("ERR|SCHEDULE|backup");
      return;
    }
  }

  // Promote completed temporary file.
  if (!LittleFS.rename(
        SCHEDULE_TEMP,
        SCHEDULE_FILE)) {

    if (LittleFS.exists(SCHEDULE_BACKUP)) {

      LittleFS.rename(
        SCHEDULE_BACKUP,
        SCHEDULE_FILE
      );
    }

    abortSchedule();
    sendEncrypted("ERR|SCHEDULE|commit");
    return;
  }

  storedActivities = receivedActivities;
  scheduleDisplay.scheduleChanged();

  receivingSchedule = false;
  expectedActivities = 0;
  receivedActivities = 0;

  char response[64];

  snprintf(
    response,
    sizeof(response),
    "SCHEDULE_RECEIVED|%d",
    storedActivities
  );

  sendEncrypted(response);

  Serial.println("\nSchedule saved permanently!");

  Serial.printf(
    "Stored activities: %d\n",
    storedActivities
  );
}


// ============ PRINT STORED SCHEDULE ============

void printSchedule() {

  Serial.println("\n===== STORED SCHEDULE =====");

  if (!storageReady) {

    Serial.println("Storage unavailable.");
    return;
  }

  File file = LittleFS.open(
    SCHEDULE_FILE, "r"
  );

  if (!file) {

    Serial.println("No saved schedule.");
    return;
  }

  while (file.available()) {

    Serial.println(
      file.readStringUntil('\n')
    );
  }

  file.close();

  Serial.printf(
    "\nTotal activities: %d\n",
    storedActivities
  );
}


// ============ RESTORE SCHEDULE TO PLANNER ============

void sendScheduleBackup() {

  char response[64];

  snprintf(
    response,
    sizeof(response),
    "BACKUP_START|%d",
    storedActivities
  );

  if (!sendEncrypted(response)) return;

  File file = LittleFS.open(
    SCHEDULE_FILE, "r"
  );

  if (file) {

    while (file.available()) {

      String line = file.readStringUntil('\n');

      line.trim();

      if (line.length() == 0) continue;

      String message = "B|" + line;

      if (!sendEncrypted(message.c_str())) {

        file.close();
        return;
      }

      delay(15);
    }

    file.close();
  }

  snprintf(
    response,
    sizeof(response),
    "BACKUP_END|%d",
    storedActivities
  );

  sendEncrypted(response);

  Serial.println("Schedule backup sent.");
}




// ============ RECEIVE AND DECRYPT ============

void onMessage(char* topic, byte* payload, unsigned int length) {

  if (strcmp(topic, topicApp) != 0) return;

  uint8_t plaintext[257];
  size_t plainLength = 0;

  bool success = e2eOpenText(
    encryptionKey,
    topicApp,
    (const char*)payload,
    length,
    plaintext,
    sizeof(plaintext) - 1,
    plainLength
  );

  if (!success) {
    rejectedMessages++;
    Serial.println("REJECTED: Authentication failed.");
    return;
  }

  plaintext[plainLength] = '\0';
  acceptedMessages++;

  String command = String((char*)plaintext);

  // ============ REASSEMBLE LONG MESSAGES ============

  if (command.startsWith("+")) {

    partialMessage += command.substring(1);

    if (partialMessage.length() > 240) {
      partialMessage = "";            // discard the oversized buffer
      abortSchedule();
      sendEncrypted("ERR|MESSAGE|length");
    }

    return;
  }

  if (partialMessage.length() > 0) {
    command = partialMessage + command;
    partialMessage = "";
  }

  if (command.length() > 240) {
    abortSchedule();
    sendEncrypted("ERR|MESSAGE|length");
    return;
  }

  Serial.println("Decrypted: " + command);

  // ============ HELLO ============

  if (command.startsWith("HELLO|")) {

    char response[96];

    snprintf(
      response,
      sizeof(response),
      "HELLO|1|PWR C5 Reminder|%d|%d|180|NOTE_BATCH",
      storedActivities,
      voiceNoteCount()
    );

    sendEncrypted(response);
    Serial.println("Planner handshake successful.");
  }

  // ============ TIME ============

  else if (command.startsWith("TIME|")) {

    int separator = command.indexOf('|', 5);

    if (separator < 0) {
      sendEncrypted("ERR|TIME|format");
      return;
    }

    long long unixTime = atoll(command.substring(5, separator).c_str());
    int offsetMinutes = command.substring(separator + 1).toInt();

    if (unixTime < 1700000000LL) {
      sendEncrypted("ERR|TIME|range");
      return;
    }

    struct timeval tv;
    tv.tv_sec = (time_t)unixTime;
    tv.tv_usec = 0;

    if (settimeofday(&tv, nullptr) == 0) {
      scheduleDisplay.setUtcOffset(offsetMinutes);
      Serial.printf("UTC offset: %d minutes\n", offsetMinutes);
      sendEncrypted("OK|TIME");
      Serial.println("Time synchronized.");
    } else {
      sendEncrypted("ERR|TIME|set");
    }
  }

  // ============ START / FINISH SCHEDULE ============

  else if (command.startsWith("SCHEDULE_START|")) {
    startSchedule(command.substring(15).toInt());
  }

  else if (command.startsWith("SCHEDULE_END|")) {
    finishSchedule(command.substring(13).toInt());
  }

  // ============ BACKUP ============

  else if (command == "BACKUP_GET") {
    sendScheduleBackup();
  }

  // ============ VOICE NOTES ============

  else if (command == "NOTES_LIST") {
    sendVoiceNoteList();
  }

  else if (command.startsWith("NOTE_BATCH|")) {
    unsigned long id, first, count;
    char extra;
    if (sscanf(command.c_str(), "NOTE_BATCH|%lu|%lu|%lu%c",
               &id, &first, &count, &extra) != 3 || count == 0 || count > VOICE_BATCH_MAX) {
      sendEncrypted("ERR|NOTE|batch");
    } else {
      startVoiceTransfer(id, first, count);
    }
  }

  else if (command.startsWith("NOTE_GET|")) {
    uint32_t id = strtoul(command.substring(9).c_str(), nullptr, 10);
    startVoiceTransfer(id);
  }

  else if (command.startsWith("NOTE_DEL|")) {
    uint32_t id = strtoul(command.substring(9).c_str(), nullptr, 10);
    acknowledgeVoiceNote(id);
  }

  // ============ RECEIVE ACTIVITIES ============
  // Must come after all named commands, otherwise it swallows them.

  else if (receivingSchedule) {
    receiveActivity(command);
  }

  // ============ UNKNOWN COMMAND ============

  else {
    Serial.println("Unsupported command: " + command);
    sendEncrypted("ERR|NOT_IMPLEMENTED");
  }
}



// ============ WIFI ============

void setupWiFi() {

  WiFi.mode(WIFI_STA);
  WiFi.persistent(true);
  WiFi.setAutoReconnect(true);

  esp_wifi_set_band_mode(WIFI_BAND_MODE_AUTO);

  wifiManager.setConfigPortalBlocking(false);
  wifiManager.setConfigPortalTimeout(180);

  wifiManager.autoConnect(
    "PWR-Setup", "PWRsetup123"
  );
}

// ============ MQTT ============

void setupMQTT() {

  secureClient.setCACert(PWR_MQTT_CA_CERT);
  secureClient.setHandshakeTimeout(15);

  if (*BROKER) mqtt.setServer(BROKER, BROKER_PORT);
  mqtt.setCallback(onMessage);

  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(5);

  if (!mqtt.setBufferSize(2048)) {
    Serial.println("MQTT buffer allocation failed.");
  }
}

void connectMQTT() {
  if (!*BROKER || !*PAIRING_CODE) return;

  if (!identityReady) {
    Serial.println("Pairing not ready.");
    return;
  }

  if (time(nullptr) < 1700000000) {
    Serial.println("Waiting for network time...");
    return;
  }

  Serial.println("Connecting to MQTT...");

  bool connected = mqtt.connect(
    clientID,
    topicStatus,
    1,
    true,
    "offline"
  );

  if (!connected) {

    Serial.printf(
      "MQTT connection failed: %d\n",
      mqtt.state()
    );

    secureClient.stop();
    return;
  }

  if (!mqtt.subscribe(topicApp, 1)) {

    Serial.println("Subscription failed.");

    mqtt.disconnect();
    secureClient.stop();
    return;
  }

  if (!mqtt.publish(topicStatus, "online", true)) {

    Serial.println("Status publication failed.");

    mqtt.disconnect();
    secureClient.stop();
    return;
  }

  Serial.println("Secure MQTT connected!");
  Serial.println("Device available to planner.");

  printMemory();
  printIdentity();
}

// ============ CONNECTION MANAGEMENT ============

void processConnections() {

  wifiManager.process();

  if (WiFi.status() != WL_CONNECTED) {

    if (wifiWasConnected) {

      wifiWasConnected = false;

      mqtt.disconnect();
      secureClient.stop();

      Serial.println("WiFi disconnected.");
    }

    if (!wifiManager.getConfigPortalActive() &&
        millis() - lastWifiRetry >= WIFI_RETRY) {

      lastWifiRetry = millis();

      WiFi.reconnect();
    }

    return;
  }

  if (!wifiWasConnected) {

    wifiWasConnected = true;

    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());

    if (!identityReady) {
      generateIdentity();
    }

    configTime(
      0, 0,
      "pool.ntp.org",
      "time.nist.gov"
    );
  }

  if (!mqtt.connected()) {

    if (millis() - lastMqttRetry >= MQTT_RETRY) {

      lastMqttRetry = millis();

      connectMQTT();
    }

    return;
  }

  mqtt.loop();
}

// ============ SETUP ============

void setup() {

  Serial.begin(115200);
  delay(2000);

  Serial.println("\nPWR C5 Planner Voice Sync");

  if (!e2eSelfTest()) {

    Serial.println("Encryption self-test failed.");

    while (true) {
      delay(1000);
    }
  }

  setupStorage();
  scheduleDisplay.begin();
  scheduleDisplay.update(SCHEDULE_FILE, storageReady);
  setupVoice();
  setupWiFi();
  setupMQTT();
  if (!*BROKER || !*PAIRING_CODE) Serial.println("Set broker and pairing code in pwr_local.h to enable planner sync.");


  Serial.println("\nM - Memory information");
  Serial.println("I - Test connection details");
  Serial.println("P - Send encrypted device message");
  Serial.println("D - Disconnect MQTT");
  Serial.println("W - Disconnect WiFi");
  Serial.println("S - Print stored schedule");
  Serial.println("R - Record a voice note");
  Serial.println("L - List saved voice notes");
  Serial.println("N - Next schedule page or day");
  Serial.println("T - Show today, V - Show the week, C - Calibrate touch");
}

// ============ LOOP ============


void loop() {

  processConnections();
  processVoiceTransfer();

  // Discard interrupted schedule transfers.
  if (receivingSchedule &&
      (!mqtt.connected() ||
       millis() - lastSchedulePacket > 15000)) {

    Serial.println("Schedule transfer interrupted.");
    abortSchedule();
  }

  if (!mqtt.connected()) {
    partialMessage = "";
  }

  if (Serial.available()) {

    char command = Serial.read();

    switch (command) {

      case 'N':
        scheduleDisplay.next();
        break;

      case 'T':
        scheduleDisplay.today();
        break;

      case 'V':
        scheduleDisplay.week();
        break;

      case 'C':
        scheduleDisplay.calibrate();
        break;

      case 'M':
        printMemory();
        break;

      case 'I':
        printIdentity();
        break;

      case 'P':
        sendEncrypted("HELLO_FROM_ESP32");
        break;

      case 'S':
        printSchedule();
        break;

      case 'D':

        if (mqtt.connected()) {
          mqtt.publish(topicStatus, "offline", true);
        }

        mqtt.disconnect();
        secureClient.stop();

        lastMqttRetry = millis();

        break;

      case 'W':

        if (mqtt.connected()) {
          mqtt.publish(topicStatus, "offline", true);
        }

        mqtt.disconnect();
        secureClient.stop();

        WiFi.disconnect(false, false);

        break;
      case 'R':

        if (!receivingSchedule) {
          recordVoiceNote();
        } else {
          Serial.println("Schedule sync in progress.");
        }

        break;

      case 'L':

        printVoiceNotes();

        break;
    }
  }

  if (!receivingSchedule && !voiceTransferring) {
    scheduleDisplay.update(SCHEDULE_FILE, storageReady);
  }

  delay(5);
}