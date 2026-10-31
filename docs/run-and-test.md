# Run and test

## 1. On a laptop (quickest)

`python3 tools/dev-server.py` serves `app/` on http://localhost:8000 with caching off (every reload runs the latest code). Add `?nosw` to the address to switch the offline cache off while developing.


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

### Publishing the test site
The test site is a separate **public** repository that only holds a copy of `app/` (this repo stays private). To update it after changing the app:

```bash
tools/publish-test-site.sh <public-repo-url>
```

It copies `app/`, refuses to publish if a word from your local `.private-names` file appears (that file is never committed), then pushes. Bump `APP_VERSION` in `app/js/config.js` and `CACHE` in `app/sw.js` when you publish a new version, so devices pick up the update.

## 6. Wi-Fi sync without hardware

Needs Node 18+. Everything runs on your computer (private, no internet needed).

```
cd tools
npm install
node wifi-test.mjs            # automatic end-to-end test (12 checks)
```

To try it in the planner by hand:
1. `node local-broker.mjs` (keep it running).
2. Open the planner at `http://localhost:8000` → **Reminder device** → *How the planner reaches the device*: **Wi-Fi** → **New code**, relay address `ws://localhost:18884` → **Save**.
3. In a second terminal: `PWR_BROKER=mqtt://localhost:18883 node wifi-fake-device.mjs <the pairing code> --note ../app/tests/audio/add-groceries.wav`
4. **Sync now**: the week goes to the pretend device and its voice note comes back into the calendar. Stop the pretend device (Ctrl+C) and **Connect** again: the planner says the device is offline.

On the published site (https) the relay address must be `wss://…` (a real broker, see [wifi-plan.md](wifi-plan.md)).

## 7. The device

See [firmware/README.md](../firmware/README.md) and [hardware/wiring/pins.md](../hardware/wiring/pins.md). The firmware has **not been compiled yet**.

## What has been verified so far
- Laptop Chrome: planner, drag & drop, typed voice commands, banner / "new" marks / undo, offline cache of all app files.
- Whisper (tiny) in the browser: the 4 sample notes in `tests/audio/` were transcribed word for word, 1–5 s each.
- Full chain with sample notes: 3 notes added to the calendar, "Remember to call my sister" kept aside to sort.
- Protocol: `node tests/run.js` (hello, clock, safe sync, backup, note transfer + checksum, delete).
- v0.6 (Oct 31): `node app/tests/run.js` 96/96 (client week within her rules, ≤ 3 a day, later-this-week, lighter week never moves fixed routines, split over days, 13/13 voice sentences about her own activities). In the planner (iPad landscape 1180×820 and portrait 820×1180 sizes): the whole week fits on screen; mouse drag, touch press-and-drag, tap-then-tap, Undo, card menu, tray, lighter week, split, Today done/steps/check-in, dim theme.
- Wi-Fi (Oct 25): `tools/wifi-test.mjs` passes 12/12 on a local broker; in the planner (laptop Chrome), Wi-Fi sync sent the week, collected a voice note and added it to the calendar; a switched-off device shows as offline.

## Not verified yet
- Anything on an iPad, in Bluefy, or with the real ESP32.
- Wi-Fi with a real online broker (the test computer could not reach public brokers) and with the ESP32 firmware (not written yet).
- The firmware build.
- Printing layout on paper.
