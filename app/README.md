# app/ — the planner (offline-first web app)

Runs in a browser on the client's iPad (Bluefy, for Bluetooth) or a laptop (Chrome / Edge). Everything stays on the user's device: their week, their voice notes, and the speech model.

**Run it:** see [docs/run-and-test.md](../docs/run-and-test.md). Short version, from this folder:

```bash
python3 -m http.server 8000
```
then open http://localhost:8000 (add `?nosw` while developing so old files are not cached).

**Test it:** `node tests/run.js` (rules, 38 voice sentences, backup lines, Bluetooth protocol against the demo device).

## Files

| File | Job | Track |
|---|---|---|
| `index.html` | The page | A |
| `css/styles.css` | Styles (first-try styles + additions at the bottom), print layout | A |
| `js/ui-week.js` | Weekly board, week navigation, energy bar (no numbers), Suggestions panel, split, legend | A |
| `js/ui-daily.js` | One day, at the bottom of the week page: day strip, Morning / Afternoon / Evening groups, a picture per activity, "Now" (replaces the Today screen, v0.10) | A |
| `js/icons.js` | The picture of each activity (from its name, or chosen) | A |
| `js/tutorial.js` | First-use tutorial, Home Screen steps, loading the planner in the icon | A |
| `js/reminders.js` | Reminders on the iPad, same rule as the device (`rules.remindersFor`) | A |
| `js/i18n.js`, `js/i18n-fr.js` | French / English: `t('English text')`; French texts (check: `node tools/i18n-check.mjs`) | shared |
| `js/ui-library.js` | Activity library and "add activity" forms | A |
| `js/print.js` | Print the week or one day | A |
| `js/ui-kit.js` | Small helpers: toast, modal, escaping | A |
| `js/store.js` | Saving, data versions, permanent-storage request, backup file, device backup lines | B |
| `js/device.js` | **Only** file that talks Bluetooth ([docs/protocol.md](../docs/protocol.md)); real device + demo device | B |
| `js/ui-device.js` | Reminder device page: connect, Sync now (send week / restore, collect voice notes) | B |
| `sw.js`, `manifest.json`, `icons/` | Offline-first, home-screen icon | B |
| `js/rules.js` | The client's energy rules; **every change goes through `applyChange()`** | C |
| `js/voice/parser.js` | Text → calendar changes, matched to the user's activity library | C |
| `js/voice/transcribe.js`, `js/voice/whisper-worker.js` | Whisper, local speech → text (in a background thread) | C |
| `js/voice/notes.js` | Voice notes stored on the device + the pipeline (text → parser → rules → calendar → change log, undo) | C |
| `js/voice/recorder.js` | Record with the iPad microphone (stops by itself after 2 s of silence), or type instead | C |
| `js/photo.js`, `js/photo-parse.js` | Add from a photo: prepare the image (Otsu), read it (Tesseract, EN + FR), understand it, she ticks what to add. Python twin: `tools/photo_to_schedule.py` | C |
| `js/voice/inbox.js` | Voice notes page: recent changes + undo, "to sort", banner on the week | C |
| `js/config.js` | Shared constants (days, energy weights, limits) | shared |
| `js/context.js` | Live state shared by all screens; `commit()` saves and redraws | shared |
| `js/main.js` | Starts the app and wires buttons, drag & drop, offline mode | shared |
| `tests/` | `run.js`, `sentences.js`, `audio/` sample voice notes (device format: 8 kHz WAV) | C |

Tracks: **A** Interface · **B** Data + device · **C** Rules + voice.
