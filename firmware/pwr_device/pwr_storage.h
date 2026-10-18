// =====================================================================
//  pwr_storage.h  -  microSD card: schedule file + voice notes
// =====================================================================
//  Files on the card:
//    /schedule.txt      one activity per line: Monday|Morning|Walk|green
//    /notes/<id>.wav    a voice note (WAV, 16-bit, mono, 8000 Hz)
//    /notes/<id>.txt    unix time when the note was recorded (0 = clock not set)
//    /notes/next.txt    the id the next note will get
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

// Voice notes
int  storageCountNotes();
int  storageListNotes(NoteInfo *out, int maxNotes);   // sorted by id, returns how many
bool storageNoteExists(int id);
File storageOpenNoteForReading(int id);
File storageCreateNoteFile(int &idOut);   // new /notes/<id>.wav, open for writing
bool storageCommitNote(int id, uint32_t unixTime);   // after recording: save time, advance id
void storageDiscardNote(int id);          // remove a note that was too short
bool storageDeleteNote(int id);           // NOTE_DEL: remove .wav and .txt
