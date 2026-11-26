
#pragma once

#include <Arduino.h>
#include <PubSubClient.h>
#include <LittleFS.h>
#include <ESP_I2S.h>
#include <Preferences.h>
#include <mbedtls/base64.h>
#include <time.h>

// Functions and objects in main sketch
extern bool sendEncrypted(const char* message);
extern bool storageReady;
extern PubSubClient mqtt;

// ============ MICROPHONE CONFIGURATION ============

static const int VOICE_BCLK = 0;
static const int VOICE_WS = 1;
static const int VOICE_SD = 24;

static const uint32_t VOICE_RATE = 16000;
static const uint32_t VOICE_SECONDS = 5;

static const uint32_t VOICE_SAMPLES =
    VOICE_RATE * VOICE_SECONDS;

static const uint32_t VOICE_FILE_BYTES =
    44 + VOICE_SAMPLES * 2;

static const size_t VOICE_CHUNK = 120;
static const uint32_t VOICE_BATCH_MAX = 32;

static I2SClass voiceI2S;
static Preferences voicePrefs;

static bool voiceReady = false;
static bool voiceRecording = false;

static int32_t voiceRaw[512];
static int16_t voicePCM[256];

// ============ TRANSFER STATE ============

static File voiceTransferFile;

static bool voiceTransferring = false;

static uint32_t voiceTransferID = 0;
static uint32_t voiceTransferSeq = 0;
static uint32_t voiceTransferSum = 0;
static uint32_t voiceTransferSize = 0;
static uint32_t voiceTransferChunks = 0;
static uint32_t voiceTransferBytes = 0;

static uint32_t voiceLastPacket = 0;
static uint32_t voiceCompletedID = 0;
static uint32_t voiceBatchStart = 0;
static uint32_t voiceBatchEnd = 0;
static bool voiceBatchTransfer = false;
static uint32_t voiceBatchNote = 0;
static uint32_t voiceBatchNext = 0;

// ============ FILE HELPERS ============

static String voicePath(uint32_t id) {

  char path[40];

  snprintf(
    path,
    sizeof(path),
    "/note_%06lu.wav",
    (unsigned long)id
  );

  return String(path);
}

static uint32_t voiceFileID(String name) {

  int slash = name.lastIndexOf('/');

  if (slash >= 0) {
    name = name.substring(slash + 1);
  }

  if (!name.startsWith("note_") ||
      !name.endsWith(".wav")) {

    return 0;
  }

  String number = name.substring(
    5, name.length() - 4
  );

  if (number.length() == 0) return 0;

  for (size_t i = 0; i < number.length(); i++) {
    if (!isDigit(number[i])) return 0;
  }

  return strtoul(number.c_str(), nullptr, 10);
}

// ============ WAV HEADER ============

static void voicePut16(
    uint8_t* buffer,
    uint16_t value) {

  buffer[0] = value & 0xFF;
  buffer[1] = (value >> 8) & 0xFF;
}

static void voicePut32(
    uint8_t* buffer,
    uint32_t value) {

  buffer[0] = value & 0xFF;
  buffer[1] = (value >> 8) & 0xFF;
  buffer[2] = (value >> 16) & 0xFF;
  buffer[3] = (value >> 24) & 0xFF;
}

static bool voiceWriteHeader(
    File& file,
    uint32_t samples) {

  uint8_t header[44] = {0};

  uint32_t dataBytes = samples * 2;

  memcpy(header, "RIFF", 4);
  voicePut32(header + 4, 36 + dataBytes);

  memcpy(header + 8, "WAVE", 4);
  memcpy(header + 12, "fmt ", 4);

  voicePut32(header + 16, 16);
  voicePut16(header + 20, 1);
  voicePut16(header + 22, 1);

  voicePut32(header + 24, VOICE_RATE);
  voicePut32(header + 28, VOICE_RATE * 2);

  voicePut16(header + 32, 2);
  voicePut16(header + 34, 16);

  memcpy(header + 36, "data", 4);

  voicePut32(header + 40, dataBytes);

  if (!file.seek(0)) return false;

  return file.write(header, 44) == 44;
}

// ============ STORAGE COUNT ============

static int voiceNoteCount() {

  if (!storageReady) return 0;

  File root = LittleFS.open("/");

  if (!root) return 0;

  int count = 0;

  File file = root.openNextFile();

  while (file) {

    if (!file.isDirectory() &&
        voiceFileID(file.name()) != 0 &&
        file.size() > 44) {

      count++;
    }

    file.close();

    file = root.openNextFile();
  }

  root.close();

  return count;
}

// ============ INITIALIZATION ============

static void setupVoice() {

  if (!storageReady) {

    Serial.println("Voice storage unavailable.");
    return;
  }

  if (!voicePrefs.begin("pwr-notes", false)) {

    Serial.println("Voice preferences failed.");
    return;
  }

  // Recover ID counter and remove incomplete recordings.
  uint32_t nextID =
      voicePrefs.getULong("nextID", 1);

  File root = LittleFS.open("/");

  if (root) {

    File file = root.openNextFile();

    while (file) {

      String name = file.name();

      if (!name.startsWith("/")) {
        name = "/" + name;
      }

      uint32_t id = voiceFileID(name);

      if (id >= nextID) {
        nextID = id + 1;
      }

      file.close();

      if (name.startsWith("/note_") &&
          name.endsWith(".wav.tmp")) {

        LittleFS.remove(name.c_str());
      }

      file = root.openNextFile();
    }

    root.close();
  }

  voicePrefs.putULong("nextID", nextID);

  voiceI2S.setPins(
    VOICE_BCLK,
    VOICE_WS,
    -1,
    VOICE_SD
  );

  if (!voiceI2S.begin(
        I2S_MODE_STD,
        VOICE_RATE,
        I2S_DATA_BIT_WIDTH_32BIT,
        I2S_SLOT_MODE_STEREO)) {

    Serial.println("Microphone initialization failed.");
    return;
  }

  voiceReady = true;

  Serial.println("Microphone ready.");

  Serial.printf(
    "Pending voice notes: %d\n",
    voiceNoteCount()
  );
}

// ============ RECORD AUDIO ============

static void recordVoiceNote() {

  if (!voiceReady ||
      !storageReady ||
      voiceRecording ||
      voiceTransferring) {

    Serial.println("Recorder unavailable or busy.");
    return;
  }

  size_t freeSpace =
      LittleFS.totalBytes() - LittleFS.usedBytes();

  if (freeSpace < VOICE_FILE_BYTES + 32768) {

    Serial.println("Not enough recording storage.");
    return;
  }

  uint32_t id =
      voicePrefs.getULong("nextID", 1);

  // Reserve the ID before recording.
  if (voicePrefs.putULong("nextID", id + 1) !=
      sizeof(uint32_t)) {

    Serial.println("Could not reserve recording ID.");
    return;
  }

  String finalPath = voicePath(id);
  String tempPath = finalPath + ".tmp";

  File file = LittleFS.open(
    tempPath.c_str(), "w"
  );

  if (!file) {

    Serial.println("Recording file creation failed.");
    return;
  }

  voiceRecording = true;

  if (!voiceWriteHeader(file, 0)) {

    file.close();
    LittleFS.remove(tempPath.c_str());

    voiceRecording = false;
    return;
  }

  Serial.printf(
    "\nRecording note %lu for 5 seconds...\n",
    (unsigned long)id
  );

  uint32_t recorded = 0;

  uint32_t started = millis();

  bool success = true;

  while (recorded < VOICE_SAMPLES) {

    if (millis() - started > 15000) {

      success = false;
      Serial.println("Recording timeout.");
      break;
    }

    size_t bytesRead = voiceI2S.readBytes(
      (char*)voiceRaw,
      sizeof(voiceRaw)
    );

    size_t frames = bytesRead / 8;

    if (frames == 0) {
      delay(1);
      continue;
    }

    size_t outputSamples = 0;

    for (size_t i = 0; i < frames; i++) {

      if (recorded + outputSamples >=
          VOICE_SAMPLES) {

        break;
      }

      int32_t sample = voiceRaw[i * 2] >> 14;

      sample = constrain(
        sample, -32768, 32767
      );

      voicePCM[outputSamples++] =
          (int16_t)sample;
    }

    size_t required = outputSamples * 2;

    if (file.write(
          (uint8_t*)voicePCM,
          required) != required) {

      success = false;
      Serial.println("Audio write failed.");
      break;
    }

    recorded += outputSamples;

    delay(1);
  }

  if (recorded != VOICE_SAMPLES) {
    success = false;
  }

  if (success) {
    success = voiceWriteHeader(file, recorded);
  }

  file.flush();
  file.close();

  voiceRecording = false;

  if (!success) {

    LittleFS.remove(tempPath.c_str());

    Serial.println("Incomplete recording discarded.");

    return;
  }

  if (LittleFS.exists(finalPath.c_str()) ||
      !LittleFS.rename(
        tempPath.c_str(),
        finalPath.c_str())) {

    Serial.println("Recording commit failed.");

    return;
  }

  Serial.println("Recording saved permanently.");

  Serial.printf(
    "ID: %lu | Samples: %lu | Bytes: %lu\n",
    (unsigned long)id,
    (unsigned long)recorded,
    (unsigned long)(44 + recorded * 2)
  );

  Serial.printf(
    "Pending recordings: %d\n",
    voiceNoteCount()
  );
}

// ============ LOCAL SERIAL LIST ============

static void printVoiceNotes() {

  Serial.println("\n===== SAVED VOICE NOTES =====");

  if (!storageReady) return;

  File root = LittleFS.open("/");

  if (!root) return;

  File file = root.openNextFile();

  while (file) {

    if (voiceFileID(file.name()) != 0) {

      Serial.printf(
        "%s | %u bytes\n",
        file.name(),
        (unsigned int)file.size()
      );
    }

    file.close();
    file = root.openNextFile();
  }

  root.close();

  Serial.printf(
    "Total notes: %d\n",
    voiceNoteCount()
  );
}

// ============ SEND NOTE LIST ============

static void sendVoiceNoteList() {

  if (!storageReady) {

    sendEncrypted("ERR|NOTES|storage");
    return;
  }

  File root = LittleFS.open("/");

  if (!root) {

    sendEncrypted("ERR|NOTES|storage");
    return;
  }

  int count = 0;

  File file = root.openNextFile();

  while (file) {

    uint32_t id = voiceFileID(file.name());

    if (id != 0 && file.size() > 44) {

      char message[100];

      snprintf(
        message,
        sizeof(message),
        "NOTE|%lu|0|%u",
        (unsigned long)id,
        (unsigned int)file.size()
      );

      if (!sendEncrypted(message)) {

        file.close();
        root.close();

        return;
      }

      count++;
    }

    file.close();
    file = root.openNextFile();
  }

  root.close();

  char message[40];

  snprintf(
    message,
    sizeof(message),
    "NOTES_END|%d",
    count
  );

  sendEncrypted(message);

  Serial.printf(
    "Planner requested notes: %d available\n",
    count
  );
}

// ============ CANCEL TRANSFER ============

static void abortVoiceTransfer() {

  if (voiceTransferFile) {
    voiceTransferFile.close();
  }

  voiceTransferring = false;
  voiceTransferID = 0;
  voiceCompletedID = 0;
}

// ============ START AUDIO TRANSFER ============

static void startVoiceTransfer(uint32_t id, uint32_t first = 0, uint32_t count = 0) {

  abortVoiceTransfer();
  voiceBatchTransfer = count != 0;
  if (first == 0) {
    voiceBatchNote = voiceBatchTransfer ? id : 0;
    voiceBatchNext = 0;
  }

  if (!storageReady || id == 0) {

    sendEncrypted("ERR|NOTE|invalid");
    return;
  }

  String path = voicePath(id);

  voiceTransferFile = LittleFS.open(
    path.c_str(), "r"
  );

  if (!voiceTransferFile) {

    sendEncrypted("ERR|NOTE|missing");
    return;
  }

  voiceTransferSize = voiceTransferFile.size();

  voiceTransferChunks =
      (voiceTransferSize + VOICE_CHUNK - 1)
      / VOICE_CHUNK;

  if (first >= voiceTransferChunks ||
      (voiceBatchTransfer && (voiceBatchNote != id || first > voiceBatchNext)) ||
      (first != 0 && !voiceTransferFile.seek(first * VOICE_CHUNK))) {
    abortVoiceTransfer();
    sendEncrypted("ERR|NOTE|range");
    return;
  }

  voiceBatchStart = first;
  voiceBatchEnd = voiceBatchTransfer
      ? first + min(count, voiceTransferChunks - first)
      : voiceTransferChunks;
  voiceTransferID = id;
  voiceTransferSeq = first;
  voiceTransferSum = 0;
  voiceTransferBytes = first * VOICE_CHUNK;

  char message[100];

  snprintf(
    message,
    sizeof(message),
    "DATA_START|%lu|%lu|%lu",
    (unsigned long)id,
    (unsigned long)voiceTransferSize,
    (unsigned long)voiceTransferChunks
  );

  if (!sendEncrypted(message)) {

    abortVoiceTransfer();
    return;
  }

  voiceTransferring = true;
  voiceLastPacket = millis();

  if (voiceBatchTransfer) {
    if (first == 0) {
      Serial.printf("Batch header published for note %lu, chunks %lu-%lu.\n",
                    (unsigned long)id, (unsigned long)first, (unsigned long)(voiceBatchEnd - 1));
    }
    return;
  }

  Serial.printf(
    "\nSending note %lu: %lu bytes, %lu chunks\n",
    (unsigned long)id,
    (unsigned long)voiceTransferSize,
    (unsigned long)voiceTransferChunks
  );
}

// ============ NONBLOCKING AUDIO TRANSFER ============

static void processVoiceTransfer() {

  if (!voiceTransferring) return;

  if (!mqtt.connected()) {
    Serial.printf("Transfer interrupted at chunk %lu/%lu. Recording retained.\n",
                  (unsigned long)voiceTransferSeq,
                  (unsigned long)voiceTransferChunks);
    abortVoiceTransfer();
    return;
  }

  // Give the planner and MQTT time to process each packet.
  if (millis() - voiceLastPacket < 50) {
    return;
  }

  voiceLastPacket = millis();

  if (voiceTransferSeq >= voiceBatchEnd) {

    voiceTransferFile.close();

    if (voiceTransferBytes != min(voiceTransferSize, uint32_t(voiceBatchEnd * VOICE_CHUNK))) {

      abortVoiceTransfer();

      sendEncrypted("ERR|NOTE|size");

      return;
    }

    char message[80];

    if (voiceBatchTransfer) {
      snprintf(message, sizeof(message), "DATA_BATCH_END|%lu|%lu|%lu",
               (unsigned long)voiceTransferID, (unsigned long)voiceBatchStart,
               (unsigned long)voiceTransferSum);
      if (!sendEncrypted(message)) {
        abortVoiceTransfer();
        return;
      }
      if (voiceBatchStart == 0) {
        Serial.printf("Batch end published for note %lu, chunks %lu-%lu.\n",
                      (unsigned long)voiceTransferID, (unsigned long)voiceBatchStart,
                      (unsigned long)(voiceBatchEnd - 1));
      }
      voiceBatchNext = max(voiceBatchNext, voiceBatchEnd);
      voiceTransferring = false;
      if (voiceBatchEnd == voiceTransferChunks && voiceBatchNext == voiceTransferChunks) {
        voiceCompletedID = voiceTransferID;
        Serial.printf("Finished sending note %lu in batches. Waiting for planner acknowledgement.\n",
                      (unsigned long)voiceTransferID);
      }
      return;
    }

    snprintf(
      message,
      sizeof(message),
      "DATA_END|%lu|%lu",
      (unsigned long)voiceTransferID,
      (unsigned long)voiceTransferSum
    );

    if (!sendEncrypted(message)) {

      abortVoiceTransfer();
      return;
    }

    voiceCompletedID = voiceTransferID;
    voiceTransferring = false;

    Serial.println("\n===== TRANSFER SUMMARY =====");

    Serial.printf("Note ID: %lu\n",
              (unsigned long)voiceTransferID);

    Serial.printf("Expected bytes: %lu\n",
              (unsigned long)voiceTransferSize);

    Serial.printf("Sent bytes: %lu\n",
              (unsigned long)voiceTransferBytes);

    Serial.printf("Total chunks: %lu\n",
              (unsigned long)voiceTransferChunks);

    Serial.printf("Sent chunks: %lu\n",
              (unsigned long)voiceTransferSeq);

    Serial.printf("Checksum: %lu\n",
              (unsigned long)voiceTransferSum);

    Serial.printf("Free heap: %u bytes\n",
              ESP.getFreeHeap());

    Serial.printf("Minimum heap: %u bytes\n",
              ESP.getMinFreeHeap());

    Serial.println("DATA_END published locally.");
    Serial.println("Waiting for planner acknowledgement.");

    return;
  }

  uint8_t raw[VOICE_CHUNK];

  size_t remaining =
      voiceTransferSize - voiceTransferBytes;

  size_t required = min(
    remaining, VOICE_CHUNK
  );

  size_t bytesRead = voiceTransferFile.read(
    raw, required
  );

  if (bytesRead != required ||
      bytesRead == 0) {

    abortVoiceTransfer();

    sendEncrypted("ERR|NOTE|read");

    return;
  }

  unsigned char base64[165];

  size_t base64Length = 0;

  int result = mbedtls_base64_encode(
    base64,
    sizeof(base64),
    &base64Length,
    raw,
    bytesRead
  );

  if (result != 0) {

    Serial.printf("Base64 encoding failed: %d\n", result);
    abortVoiceTransfer();
    return;
  }

  base64[base64Length] = '\0';

  char message[180];

  snprintf(
    message,
    sizeof(message),
    "D|%lu|%s",
    (unsigned long)voiceTransferSeq,
    (char*)base64
  );

  if (!sendEncrypted(message)) {

    abortVoiceTransfer();
    return;
  }

  for (size_t i = 0; i < bytesRead; i++) {

    voiceTransferSum =
        (voiceTransferSum + raw[i]) & 0xFFFF;
  }

  voiceTransferBytes += bytesRead;
  voiceTransferSeq++;

  if (voiceTransferSeq % 100 == 0) {

    Serial.printf(
      "Audio progress: %lu/%lu chunks\n",
      (unsigned long)voiceTransferSeq,
      (unsigned long)voiceTransferChunks
    );
  }
}

// ============ ACKNOWLEDGE AND DELETE ============

static void acknowledgeVoiceNote(uint32_t id) {

  if (!storageReady || id == 0) {

    sendEncrypted("ERR|DEL|invalid");
    return;
  }

  String path = voicePath(id);

  // Repeated acknowledgement for an already removed file.
  if (!LittleFS.exists(path.c_str())) {

    char response[60];

    snprintf(
      response, sizeof(response),
      "OK|DEL|%lu",
      (unsigned long)id
    );

    sendEncrypted(response);

    return;
  }

  // Do not delete a note that has not finished transferring.
  if (voiceTransferring ||
      id != voiceCompletedID) {

    sendEncrypted("ERR|DEL|not_transferred");
    return;
  }

  if (!LittleFS.remove(path.c_str())) {

    sendEncrypted("ERR|DEL|storage");
    return;
  }

  voiceCompletedID = 0;
  voiceBatchNote = 0;
  voiceBatchNext = 0;

  char response[60];

  snprintf(
    response,
    sizeof(response),
    "OK|DEL|%lu",
    (unsigned long)id
  );

  sendEncrypted(response);

  Serial.printf(
    "Note %lu acknowledged and deleted.\n",
    (unsigned long)id
  );
}
