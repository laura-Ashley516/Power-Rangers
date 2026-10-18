// =====================================================================
//  pwr_device.ino  -  the client's portable reminder device (ESP32)
// =====================================================================
//  What it does:
//   - Shows the day's activities, colour-coded by energy (green/yellow/red).
//   - NEXT button: show the next day.  DONE button: stop a reminder /
//     go back to today.  RECORD button: hold to record a voice note.
//   - Gentle vibration before a block (Morning / Afternoon / Evening)
//     that has activities, once the app has set the clock.
//   - Talks to the web app over Bluetooth Low Energy (docs/protocol.md).
//   - Keeps the schedule and the voice notes on a microSD card.
//
//  Files in this folder (Arduino opens them as tabs):
//   pwr_config.h      all pins, timings and limits
//   pwr_schedule.*    the activity list and how to read one line
//   pwr_clock.*       software clock set by the app (TIME message)
//   pwr_storage.*     microSD: /schedule.txt and /notes/
//   pwr_display.*     drawing on the ILI9341 screen
//   pwr_buttons.*     debounced buttons
//   pwr_vibration.*   vibration motor pulses
//   pwr_recorder.*    INMP441 microphone -> WAV file
//   pwr_protocol.*    Bluetooth server and all protocol commands
//   pwr_app.h         functions below that the Bluetooth code calls
//
//  Board: "ESP32 Dev Module", ESP32 Arduino core 2.0.x (see firmware/README.md).
// =====================================================================

// Library headers (listed here too so the Arduino IDE finds the libraries).
#include <SPI.h>
#include <FS.h>
#include <SD.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <BLEDevice.h>

#include "pwr_config.h"
#include "pwr_schedule.h"
#include "pwr_clock.h"
#include "pwr_storage.h"
#include "pwr_display.h"
#include "pwr_buttons.h"
#include "pwr_vibration.h"
#include "pwr_recorder.h"
#include "pwr_protocol.h"
#include "pwr_app.h"

// ---------------------------------------------------------------------
//  Buttons
// ---------------------------------------------------------------------
DebouncedButton nextButton(PIN_BTN_NEXT);
DebouncedButton doneButton(PIN_BTN_DONE);
DebouncedButton recordButton(PIN_BTN_RECORD);

// ---------------------------------------------------------------------
//  Screen state
// ---------------------------------------------------------------------
int  shownDay = 0;               // 0 = Monday ... 6 = Sunday
bool screenDirty = true;         // true = redraw the day page
bool messageShowing = false;     // a full-screen message is on screen
uint32_t messageStartMs = 0;
uint32_t lastButtonMs = 0;       // last time any button was pressed
uint32_t lastAutoRotateMs = 0;
int  lastTodayIndex = -1;        // to notice a new day (or a new clock)
int  notesWaiting = 0;

DeviceStatus shownStatus;        // what the status line shows right now

// ---------------------------------------------------------------------
//  Reminder state
// ---------------------------------------------------------------------
int  reminderPeriod = -1;        // -1 = no reminder; else 0..2
int  reminderDay = 0;
bool reminderShown = false;      // reminder view on screen (NEXT hides it)
int  reminderBuzzes = 0;         // how many times we buzzed for it
uint32_t lastBuzzMs = 0;
long remindedOnDay[NUM_PERIODS] = {-1, -1, -1};   // day number of the last reminder per block

// ---------------------------------------------------------------------
//  Called by the Bluetooth code (see pwr_app.h)
// ---------------------------------------------------------------------
void appScheduleChanged() {
  if (clockIsSet() && reminderPeriod < 0) shownDay = clockTodayIndex();
  messageShowing = false;
  screenDirty = true;
}

void appClockChanged() {
  lastTodayIndex = -1;   // updateToday() will jump to today's page
}

void appNotesChanged() {
  notesWaiting = storageCountNotes();
}

// ---------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------
void showMessage(const char *line1, const char *line2) {
  displayMessage(line1, line2);
  messageShowing = true;
  messageStartMs = millis();
}

void startReminder(int day, int period) {
  Serial.printf("Reminder: %s %s\n", dayName(day), periodName(period));
  reminderPeriod = period;
  reminderDay = day;
  reminderBuzzes = 1;
  lastBuzzMs = millis();
  reminderShown = true;
  shownDay = day;
  messageShowing = false;
  screenDirty = true;
  vibrationBuzz();
}

void stopReminder() {
  reminderPeriod = -1;
  reminderShown = false;
  vibrationStop();
  screenDirty = true;
}

// ---------------------------------------------------------------------
//  Recording a voice note (RECORD button held)
// ---------------------------------------------------------------------
void recordVoiceNote() {
  if (protocolIsBusy()) {
    // A note is being sent to the app right now (uses the SD card).
    showMessage("Busy", "Try again soon");
    return;
  }
  if (!storageReady()) storageBegin();   // maybe the card was inserted later
  if (!storageReady()) {
    showMessage("No SD card", "Cannot record");
    return;
  }

  vibrationStop();   // the motor must not run (or be heard) while recording

  int id = -1;
  int result = recorderRecordWhileHeld(recordButton, clockNowUnix(), id);
  lastButtonMs = millis();

  if (result == RECORD_SAVED) {
    notesWaiting = storageCountNotes();
    String waiting = String(notesWaiting) + (notesWaiting == 1 ? " note waiting" : " notes waiting");
    showMessage("Note saved", waiting.c_str());
  } else if (result == RECORD_TOO_SHORT) {
    // Short press: ignored. Nothing was drawn, nothing to redraw.
  } else if (result == RECORD_NO_SD) {
    showMessage("No SD card", "Cannot record");
  } else {
    showMessage("Could not record", "Check the microphone");
  }
}

// ---------------------------------------------------------------------
//  Buttons
// ---------------------------------------------------------------------
void handleButtons() {
  nextButton.update();
  doneButton.update();
  recordButton.update();

  if (recordButton.wasPressed()) {
    recordVoiceNote();   // blocks until the button is released
  }

  if (nextButton.wasPressed()) {
    lastButtonMs = millis();
    messageShowing = false;
    reminderShown = false;          // leave the reminder view (it buzzes again later)
    shownDay = (shownDay + 1) % NUM_DAYS;
    screenDirty = true;
  }

  if (doneButton.wasPressed()) {
    lastButtonMs = millis();
    if (reminderPeriod >= 0) {
      stopReminder();               // acknowledged: no more buzzing
    } else if (messageShowing) {
      messageShowing = false;       // close the message
    } else if (clockIsSet()) {
      shownDay = clockTodayIndex(); // back to today
    }
    screenDirty = true;
  }
}

// ---------------------------------------------------------------------
//  Which day to show
// ---------------------------------------------------------------------
void updateToday() {
  if (clockIsSet()) {
    int today = clockTodayIndex();

    // New clock or midnight: show today's page.
    if (today != lastTodayIndex) {
      lastTodayIndex = today;
      if (reminderPeriod < 0) shownDay = today;
      screenDirty = true;
    }

    // After browsing with NEXT, come back to today by itself.
    if (RETURN_TO_TODAY_MS > 0 && AUTO_ROTATE_MS == 0 && reminderPeriod < 0 &&
        shownDay != today && millis() - lastButtonMs > RETURN_TO_TODAY_MS) {
      shownDay = today;
      screenDirty = true;
    }
  }

  // Optional: the first-try behaviour (change day every few seconds).
  if (AUTO_ROTATE_MS > 0 && reminderPeriod < 0 && !messageShowing &&
      millis() - lastAutoRotateMs >= AUTO_ROTATE_MS) {
    lastAutoRotateMs = millis();
    shownDay = (shownDay + 1) % NUM_DAYS;
    screenDirty = true;
  }
}

// ---------------------------------------------------------------------
//  Reminders (only when the clock is set)
// ---------------------------------------------------------------------
void updateReminders() {
  if (!clockIsSet()) return;

  int today = clockTodayIndex();
  int minutes = clockMinutesOfDay();
  long dayNumber = clockDayNumber();

  // Start a reminder when we enter the "lead" window before a block.
  for (int p = 0; p < NUM_PERIODS; p++) {
    int start = periodStartMinutes(p);
    int remindAt = start - REMINDER_LEAD_MIN;
    bool inWindow = (minutes >= remindAt && minutes < start);
    if (inWindow && remindedOnDay[p] != dayNumber && countActivities(today, p) > 0) {
      remindedOnDay[p] = dayNumber;   // only once per block per day
      startReminder(today, p);
    }
  }

  // Buzz again every few minutes until DONE (at most REMINDER_MAX_BUZZES).
  if (reminderPeriod >= 0 && reminderBuzzes < REMINDER_MAX_BUZZES &&
      millis() - lastBuzzMs >= REMINDER_REPEAT_MS) {
    reminderBuzzes++;
    lastBuzzMs = millis();
    reminderShown = true;
    shownDay = reminderDay;
    messageShowing = false;
    screenDirty = true;
    vibrationBuzz();
  }
}

// ---------------------------------------------------------------------
//  Screen
// ---------------------------------------------------------------------
void updateScreen() {
  if (messageShowing) {
    if (millis() - messageStartMs < MESSAGE_SHOW_MS) return;   // keep the message
    messageShowing = false;
    screenDirty = true;
  }

  DeviceStatus st;
  st.connected = protocolIsConnected();
  st.sdOk = storageReady();
  st.notesWaiting = notesWaiting;
  st.minutesOfDay = clockMinutesOfDay();

  if (screenDirty) {
    bool isToday = clockIsSet() && shownDay == clockTodayIndex();
    displayDay(shownDay, isToday, reminderShown ? reminderPeriod : -1);
    displayStatus(st);
    shownStatus = st;
    screenDirty = false;
    return;
  }

  bool statusChanged = st.connected != shownStatus.connected ||
                       st.sdOk != shownStatus.sdOk ||
                       st.notesWaiting != shownStatus.notesWaiting ||
                       st.minutesOfDay != shownStatus.minutesOfDay;
  if (statusChanged) {
    displayStatus(st);
    shownStatus = st;
  }
}

// ---------------------------------------------------------------------
//  setup() and loop()
// ---------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\nPWR Reminder (pwr_device) starting...");

  // Keep the SD card de-selected while the screen starts on the shared SPI bus.
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);

  vibrationBegin();
  nextButton.begin();
  doneButton.begin();
  recordButton.begin();

  displayBegin();
  displaySplash("Scheduler", "Starting...");

  if (storageBegin()) {
    storageLoadSchedule();
  }
  notesWaiting = storageCountNotes();

  if (!recorderBegin()) {
    Serial.println("Microphone not available; recording disabled.");
  }

  protocolBegin();

  lastButtonMs = millis();
  lastAutoRotateMs = millis();
  screenDirty = true;
}

void loop() {
  protocolLoop();      // Bluetooth messages (and voice-note chunks)
  handleButtons();
  updateToday();
  updateReminders();
  vibrationUpdate();
  updateScreen();
  delay(2);            // tiny pause; lets the other tasks run
}
