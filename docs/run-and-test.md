# Run and test

## 1. On a laptop (quickest)

```bash
cd app
python3 -m http.server 8000
```

Open **http://localhost:8000/?nosw** in Chrome. (`?nosw` turns off offline caching while you develop, so you always see your latest code. Without it, the app works offline and updates on the next open.)

## 2. Automatic tests

```bash
cd app
node tests/run.js
```

Checks the client's energy rules, 38 sentences for the voice parser (target ≥ 90 %), the device backup lines, and the whole Bluetooth protocol against the demo device. Add new sentences to `tests/sentences.js` whenever the parser misunderstands something.

## 3. Without hardware: the demo device

Settings → **Demo device** on. Then Reminder device page:
1. **Put a recording on the demo device** (any audio file, or one from `app/tests/audio/`).
2. **Sync now**: the app sends the week, sets the clock, collects the note, checks it, and Whisper turns it into calendar changes.
3. See **Voice notes** for what changed (with Undo) and what is "to sort".

The first time, the speech model downloads (about 40 MB; Settings → "Download the speech model now" does it in advance). After that it works offline.

## 4. Voice from the microphone

Top of the page → **Voice note** → Start recording / Stop. Or **Type instead** to test the parser without speaking.

## 5. On an iPad

The iPad needs a real `https://` address (microphone, Bluetooth and offline mode all require it):
- the repo is private, so GitHub Pages needs either a public repo, a separate public repo for the site, or Netlify / Cloudflare Pages (free);
- open the address in **Bluefy** (free, App Store) to use Bluetooth. Safari works for everything except Bluetooth.

**Things to check on the iPad (tests T1–T3):** Bluetooth to the ESP32 · printing · opening in airplane mode · home-screen icon · "Storage on this device" message in Settings · microphone recording in Bluefy · Whisper speed · time to transfer one voice note.

## 6. The device

See [firmware/README.md](../firmware/README.md) and [hardware/wiring/pins.md](../hardware/wiring/pins.md). The firmware has **not been compiled yet**.

## What has been verified so far (Oct 17)
- Laptop Chrome: planner, drag & drop, typed voice commands, banner / "new" marks / undo, offline cache of all app files.
- Whisper (tiny) in the browser: the 4 sample notes in `tests/audio/` were transcribed word for word, 1–5 s each.
- Full chain with sample notes: 3 notes added to the calendar, "Remember to call my sister" kept aside to sort.
- Protocol: `node tests/run.js` (hello, clock, safe sync, backup, note transfer + checksum, delete).

## Not verified yet
- Anything on an iPad, in Bluefy, or with the real ESP32.
- The firmware build.
- Printing layout on paper.
