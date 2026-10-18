// =====================================================================
//  pwr_recorder.h  -  record a voice note from the INMP441 microphone
// =====================================================================
#pragma once

#include <Arduino.h>
#include "pwr_buttons.h"

// Result of one press of the RECORD button.
const int RECORD_SAVED     = 0;   // a note was saved
const int RECORD_TOO_SHORT = 1;   // released before RECORD_MIN_MS: nothing saved
const int RECORD_NO_SD     = 2;   // no microSD card
const int RECORD_ERROR     = 3;   // microphone or file error

// Start the I2S microphone (call once in setup). The microphone keeps
// running all the time so it is already "awake" when the button is pressed.
bool recorderBegin();

// Records while `button` is held (max RECORD_MAX_MS) into /notes/<id>.wav.
// This function BLOCKS until the button is released. It updates the screen.
// unixTime is stored with the note (0 if the clock is not set).
// Returns one of the RECORD_... values; savedId gets the note id.
int recorderRecordWhileHeld(DebouncedButton &button, uint32_t unixTime, int &savedId);
