// =====================================================================
//  pwr_storage.h  -  microSD card: schedule file + voice notes
// =====================================================================
//  Files on the card:
//    /schedule.txt      one activity per line: Monday|Morning|Walk|green
//    /notes/<id>.wav    a voice note (WAV, 16-bit, mono, 8000 Hz)
//    /notes/<id>.txt    unix time when the note was recorded (0 = clock not set)
//    /notes/next.txt    the id the next note will get
//    /state.bin         v3: the app's full planner copy (gzip bytes, the device does not read it)
//    /state.prev        v3: the copy before that one
//    /state.txt         v3: unix time sent with the copy (STATE_START)
//    /state.tmp         v3: a copy being received (only renamed when complete)
//
//  If there is no card, every function fails safely (returns false / 0)
//  and the rest of the device keeps working.
// =====================================================================
#pragma once

#include <Arduino.h>
#include <FS.h>
#include <SD.h>
#include "pwr_schedule.h"

struct NoteInfo {
  int      id;
  uint32_t unixTime;   // when it was recorded (0 = unknown)
  uint32_t bytes;      // size of the .wav file
};

const int MAX_NOTES_LISTED = 60;

// Mount the card (call once in setup, after the display is started).
// Can be called again later to retry if the card was missing.
bool storageBegin();
bool storageReady();

// Schedule
bool storageLoadSchedule();   // fills schedule[] / activityCount
bool storageSaveSchedule();   // writes schedule[] to /schedule.txt
bool storageLoadQuiet();      // v2: fills quietBlocks from /quiet.txt
bool storageSaveQuiet();      // v2: writes quietBlocks to /quiet.txt

// Voice notes
int  storageCountNotes();
int  storageListNotes(NoteInfo *out, int maxNotes);   // sorted by id, returns how many
bool storageNoteExists(int id);
File storageOpenNoteForReading(int id);
File storageCreateNoteFile(int &idOut);   // new /notes/<id>.wav, open for writing
bool storageCommitNote(int id, uint32_t unixTime);   // after recording: save time, advance id
void storageDiscardNote(int id);          // remove a note that was too short
bool storageDeleteNote(int id);           // NOTE_DEL: remove .wav and .txt

// v3 planner copy (STATE_START / S / STATE_END, STATE_GET).
bool storageStateBeginWrite();                          // (re)creates /state.tmp, open for writing
bool storageStateWrite(const uint8_t *data, size_t n);  // append to /state.tmp
void storageStateAbortWrite();                          // close and remove /state.tmp
// Close /state.tmp, check its size, keep /state.bin as /state.prev, rename, write /state.txt.
bool storageStateCommit(uint32_t expectedBytes, uint32_t unixTime);
bool storageStateInfo(uint32_t &bytes, uint32_t &unixTime);   // false = no copy yet
File storageOpenStateForReading();                            // /state.bin (or /state.prev)
