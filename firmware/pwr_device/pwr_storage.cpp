// =====================================================================
//  pwr_storage.cpp  -  microSD card (same SPI bus as the display)
// =====================================================================
//  IMPORTANT: only call these functions from loop()/setup() (the main
//  task). The display uses the same SPI bus, so SD and screen must
//  never be used at the same time from two different tasks.
// =====================================================================
#include "pwr_storage.h"
#include <SPI.h>

static bool sdOk = false;
static int nextNoteId = 1;

static const char *SCHEDULE_FILE = "/schedule.txt";
static const char *SCHEDULE_TMP  = "/schedule.tmp";
static const char *NOTES_DIR     = "/notes";
static const char *NEXT_ID_FILE  = "/notes/next.txt";

static String wavPath(int id)  { return String(NOTES_DIR) + "/" + String(id) + ".wav"; }
static String timePath(int id) { return String(NOTES_DIR) + "/" + String(id) + ".txt"; }

// Older ESP32 cores return "/notes/7.wav" from File::name(), newer ones "7.wav".
// This keeps only the part after the last '/'.
static String baseName(const char *path) {
  String s = path;
  int slash = s.lastIndexOf('/');
  if (slash >= 0) s = s.substring(slash + 1);
  return s;
}

// "7.wav" -> 7. Returns -1 if the name is not <number>.wav
static int idFromWavName(const String &name) {
  if (!name.endsWith(".wav")) return -1;
  String num = name.substring(0, name.length() - 4);
  if (num.length() == 0) return -1;
  for (unsigned int i = 0; i < num.length(); i++) {
    if (!isDigit(num.charAt(i))) return -1;
  }
  return num.toInt();
}

static String readSmallFile(const String &path) {
  File f = SD.open(path, FILE_READ);
  if (!f) return "";
  String s = f.readStringUntil('\n');
  f.close();
  s.trim();
  return s;
}

static bool writeSmallFile(const String &path, const String &text) {
  File f = SD.open(path, FILE_WRITE);   // FILE_WRITE replaces the old content
  if (!f) return false;
  size_t written = f.print(text);
  f.close();
  return written == text.length();
}

bool storageBegin() {
  if (sdOk) return true;
  SD.end();   // harmless if it was never mounted; needed before a retry
  if (!SD.begin(PIN_SD_CS, SPI, SD_SPI_FREQUENCY)) {
    Serial.println("SD: no card (or wiring problem). Storage disabled.");
    sdOk = false;
    return false;
  }
  if (SD.cardType() == CARD_NONE) {
    Serial.println("SD: no card inserted.");
    SD.end();
    sdOk = false;
    return false;
  }
  sdOk = true;
  Serial.printf("SD: card mounted, %llu MB\n", SD.cardSize() / (1024ULL * 1024ULL));

  if (!SD.exists(NOTES_DIR)) SD.mkdir(NOTES_DIR);

  // Next note id: from next.txt, but always bigger than any note on the card.
  nextNoteId = readSmallFile(NEXT_ID_FILE).toInt();
  if (nextNoteId < 1) nextNoteId = 1;
  NoteInfo list[MAX_NOTES_LISTED];
  int n = storageListNotes(list, MAX_NOTES_LISTED);
  for (int i = 0; i < n; i++) {
    if (list[i].id >= nextNoteId) nextNoteId = list[i].id + 1;
  }
  Serial.printf("SD: %d note(s) waiting, next id %d\n", n, nextNoteId);
  return true;
}

bool storageReady() {
  return sdOk;
}

// ---------------------------------------------------------------------
//  Schedule
// ---------------------------------------------------------------------
bool storageLoadSchedule() {
  if (!sdOk) return false;

  const char *path = SCHEDULE_FILE;
  if (!SD.exists(path)) {
    // A power cut during saving could leave only the temporary file.
    if (SD.exists(SCHEDULE_TMP)) path = SCHEDULE_TMP;
    else {
      Serial.println("SD: no saved schedule yet.");
      return false;
    }
  }

  File f = SD.open(path, FILE_READ);
  if (!f) return false;

  activityCount = 0;
  while (f.available() && activityCount < MAX_ACTIVITIES) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;
    Activity a;
    if (parseActivityLine(line, a)) schedule[activityCount++] = a;
  }
  f.close();
  Serial.printf("SD: loaded %d activities from %s\n", activityCount, path);
  return true;
}

bool storageSaveSchedule() {
  if (!sdOk) return false;

  // Write to a temporary file first, then swap it in. If the power is cut
  // while writing, the old /schedule.txt is still complete.
  File f = SD.open(SCHEDULE_TMP, FILE_WRITE);
  if (!f) {
    Serial.println("SD: cannot write schedule.");
    return false;
  }
  for (int i = 0; i < activityCount; i++) {
    const Activity &a = schedule[i];
    f.print(dayName(a.day));    f.print('|');
    f.print(periodName(a.period)); f.print('|');
    f.print(a.name);            f.print('|');
    f.print(energyName(a.energy));
    f.print('\n');
  }
  f.close();

  if (SD.exists(SCHEDULE_FILE)) SD.remove(SCHEDULE_FILE);
  if (!SD.rename(SCHEDULE_TMP, SCHEDULE_FILE)) {
    Serial.println("SD: rename of schedule file failed.");
    return false;
  }
  Serial.printf("SD: saved %d activities.\n", activityCount);
  return true;
}

// ---------------------------------------------------------------------
//  Voice notes
// ---------------------------------------------------------------------
int storageListNotes(NoteInfo *out, int maxNotes) {
  if (!sdOk) return 0;
  File dir = SD.open(NOTES_DIR);
  if (!dir || !dir.isDirectory()) return 0;

  // 1) Collect id + size of every <number>.wav
  int n = 0;
  File f = dir.openNextFile();
  while (f && n < maxNotes) {
    if (!f.isDirectory()) {
      int id = idFromWavName(baseName(f.name()));
      if (id > 0) {
        out[n].id = id;
        out[n].bytes = (uint32_t)f.size();
        out[n].unixTime = 0;
        n++;
      }
    }
    f.close();
    f = dir.openNextFile();
  }
  if (f) f.close();
  dir.close();

  // 2) Sort by id (simple insertion sort, the list is short).
  for (int i = 1; i < n; i++) {
    NoteInfo key = out[i];
    int j = i - 1;
    while (j >= 0 && out[j].id > key.id) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = key;
  }

  // 3) Read the time stamps (after the directory is closed, so we never
  //    have many files open at once).
  for (int i = 0; i < n; i++) {
    String t = readSmallFile(timePath(out[i].id));
    out[i].unixTime = (uint32_t)strtoul(t.c_str(), nullptr, 10);
  }
  return n;
}

int storageCountNotes() {
  if (!sdOk) return 0;
  static NoteInfo list[MAX_NOTES_LISTED];
  return storageListNotes(list, MAX_NOTES_LISTED);
}

bool storageNoteExists(int id) {
  if (!sdOk || id < 1) return false;
  return SD.exists(wavPath(id));
}

File storageOpenNoteForReading(int id) {
  if (!sdOk || id < 1) return File();
  return SD.open(wavPath(id), FILE_READ);
}

File storageCreateNoteFile(int &idOut) {
  idOut = -1;
  if (!sdOk) return File();
  if (!SD.exists(NOTES_DIR)) SD.mkdir(NOTES_DIR);
  idOut = nextNoteId;
  File f = SD.open(wavPath(idOut), FILE_WRITE);
  if (!f) {
    Serial.println("SD: cannot create note file.");
    idOut = -1;
  }
  return f;
}

bool storageCommitNote(int id, uint32_t unixTime) {
  if (!sdOk) return false;
  bool ok = writeSmallFile(timePath(id), String(unixTime));
  nextNoteId = id + 1;
  writeSmallFile(NEXT_ID_FILE, String(nextNoteId));
  Serial.printf("SD: note %d saved (time %lu)\n", id, (unsigned long)unixTime);
  return ok;
}

void storageDiscardNote(int id) {
  if (!sdOk || id < 1) return;
  SD.remove(wavPath(id));
  SD.remove(timePath(id));
}

bool storageDeleteNote(int id) {
  if (!sdOk || id < 1) return false;
  if (SD.exists(wavPath(id)))  SD.remove(wavPath(id));
  if (SD.exists(timePath(id))) SD.remove(timePath(id));
  return !SD.exists(wavPath(id));
}
