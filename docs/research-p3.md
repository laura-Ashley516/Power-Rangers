# Prototype 3: research notes and recommendations (Nov 2026)

Items from the change list that needed more information before being built. Each one says **what we know**, **the options**, and **what we recommend**. Numbers marked *(measure)* must be checked on our own hardware.

---

## 1. Power management on the reminder device (item 11, "give me more info first")

**Why it matters:** the device must last a full waking day (constraint: ≥ 16 h). A reminder that never arrives because the battery is empty is worse than no reminder.

**Where the current goes** (ESP32 datasheet values; screen and motor *(measure)* with a USB power meter):

| Part / mode | Current (about) | How long per day (normal day) |
|---|---|---|
| ESP32 Wi-Fi on, sending | 100–240 mA | a few seconds per sync |
| ESP32 Bluetooth connected, CPU at 240 MHz | 40–70 mA | while connected |
| ESP32 CPU on, radio off ("modem sleep") | 20–30 mA at 80 MHz | most of the day today |
| ESP32 light sleep (wakes on a button or a timer in a few ms) | ~0.8 mA | could be most of the day |
| ESP32 deep sleep | ~0.01 mA | not usable: it forgets the screen and restarts |
| 2.8" TFT backlight | tens of mA *(measure)* | today: always on |
| Vibration motor | 50–100 mA *(measure)* | ~1 s per reminder |
| INMP441 microphone | ~1.4 mA | only while recording |

**The biggest wins, in order:**
1. **Screen backlight off** after 30 s without a button press (wake on any button or a reminder). Needs the backlight pin on a transistor (one GPIO). Probably the largest single saving.
2. **CPU at 80 MHz** instead of 240 MHz (`setCpuFrequencyMhz(80)`): enough for the screen and buttons.
3. **Radio only when needed:** Bluetooth advertising slower when not connected; Wi-Fi on only to sync (the app syncs on demand), then off.
4. **Light sleep between events:** wake on a button (GPIO wake-up) or on a timer set to the next reminder. Bluetooth can stay connected in light sleep with the ESP-IDF power manager, but that is harder in Arduino; a simpler first step is light sleep only while not connected.
5. **Battery gauge:** read the battery voltage through a divider on an ADC pin, show it on the status line, and warn below 20 %.

**Estimate (to replace with measurements):** today ≈ 60–100 mA all day → a 1 000 mAh cell lasts about 10–16 h. With 1 + 2 + 3: ≈ 25–35 mA → ~30 h. With 4 as well: several days.

**Recommendation:** do 1, 2 and 5 first (small code, big effect, easy to test with test T2), then measure; do 4 only if T2 still fails. **Nothing has been changed in the firmware yet.**

---

## 2. Voice notes that do not work on her iPad (items 13, 14, 25)

**How it works now:** the microphone (iPad or device) records → **the iPad** turns speech into text (Whisper, a speech model of about 40 MB that runs in the browser) → the parser turns the text into changes.

**Important:** recording on the device does **not** remove the iPad step: the device's notes are also understood on the iPad. So if Whisper cannot run on her iPad, device notes will fail too.

**Likely causes on her iPad** (to check at Design Day with the diagnosis line the planner already shows under a failed recording):
- Older iPad / iPadOS: the speech model needs WebAssembly and about 300–500 MB of free memory; older iPads close the page or stop.
- Microphone permission blocked for the site (Settings → Safari → Microphone, or the "aA" menu → Website Settings).
- Low Power Mode or a long first download stopped (the model downloads once).
- She pressed once and waited: before v0.10, recording only stopped with a second press (now it stops by itself after 2 s of silence).

**Options:**
| Option | Works offline | Privacy | Effort |
|---|---|---|---|
| A. Keep Whisper, add the smaller multilingual model and test on her iPad | yes | stays on the iPad | small |
| B. **iPad dictation**: in "Type instead", tap the microphone on the iPad keyboard; iPadOS turns speech into text (often on the iPad itself), then our parser does the rest | mostly | Apple's dictation | **none: it already works** |
| C. Web Speech API (Safari's speech recognition) | no | audio goes to Apple | medium |
| D. Send the audio to a server (or a cloud speech service) | no | audio leaves the iPad | large, and against "nothing sent online" |

**Recommendation:** at Design Day, try Whisper on her iPad once (2 min). If it fails, show her **B**: it needs no new code and works on every iPad. We can make "Type instead" more visible with a microphone hint (a small change).

---

## 3. "Hey Cal": start listening by voice, like Siri or Alexa (item 15)

**What a wake word needs:** the microphone open **all the time** and a very small model that only recognises "Hey Cal" / "Hé Cal", on the iPad or on the device.

**On the iPad (the planner):**
- A web page can only listen **while it is open and on screen**; iPadOS stops the microphone when the planner is in the background or the screen locks. So "Hey Cal" would work only while the planner is open, like a kitchen display.
- **Picovoice Porcupine** (Web SDK) runs a custom wake word in the browser, offline, in English **and** French. The phrase "Hey Cal" is trained in their online console in minutes. It needs a free *AccessKey*, which needs an account (free for personal / non-commercial use; **you or the team must create it**, we cannot do it for you). Then about a day of work: switch in Settings ("Listen for Hey Cal"), wake word → the same recording window as the Voice note button, which then stops by itself.
- Battery: an always-open microphone uses the iPad battery while the planner is open; a switch lets her turn it off.

**On the device:**
- Our ESP32 (classic) has no wake-word engine that we can use. Espressif's WakeNet runs on the **ESP32-S3**, and custom words ("Hey Cal") are a paid Espressif service; a few free English words exist ("Hi ESP").
- Option for a later version: ESP32-S3 board + WakeNet with a free preset word, or keep the **hold-to-record button** (simplest for her, no false triggers, no battery cost).

**Recommendation:** iPad: Porcupine, only while the planner is open, with an on/off switch (needs the free account first). Device: keep the button for Prototype 3.

---

## 4. Saving and syncing: what happens today, and what to add (item 17)

**What exists today:**
- Every change is saved **at once** on the iPad (browser storage), and the planner asks the iPad to keep it permanently.
- **Safety copies:** one a day (last 7) and one before each update, restore, reset or backup load (Settings → Keep my schedule safe → Restore).
- **Backup file** (Settings → Save backup) to the Files app / iCloud Drive; **Load backup** brings it back.
- **The device keeps a copy** of the week (microSD); an empty planner offers to restore from it.
- **New in v0.10:** the top bar says "Saved on this iPad · 10:42 · Device: up to date / not sent yet", so she can see her changes are kept and whether the device has them.

**Risks that remain:**
1. Safari can clear a website's storage after weeks without use (the Home Screen icon avoids this; the tutorial shows how).
2. The iPad itself is lost or reset: only a backup file or the device copy remains.
3. Nothing backs up on its own to somewhere outside the iPad.

**Suggestions (small to large):**
- **A.** A gentle monthly prompt "Save a backup of your planner?" (one tap, saves the file); and show "Last backup: 12 days ago" in Settings. *Small.*
- **B.** Sync automatically when the planner opens if the device is in reach (Wi-Fi), so the device copy is always recent. *Medium, needs the Wi-Fi firmware.*
- **C.** Encrypted cloud copy through the same relay as Wi-Fi sync (the pairing code is the key), restored on a new iPad with the code. *Large; privacy review needed.*

**Recommendation:** A now (before Design Day); B after the Wi-Fi firmware is on the device.

---

## 5. Updating her planner at Design Day without losing anything (item 18)

**How updates work:** the planner is a website with an offline copy. When she opens it with internet, the new version downloads in the background and switches over by itself when she is not in the middle of something. **Her week is not part of the update**: it stays in the iPad's storage for that web address, and the planner converts older saves (with a safety copy made "before an update").

**What can lose her data (and must be avoided):**
- **Changing the web address** (another site or domain): the new address has empty storage. → Keep the same address forever after Design Day.
- **Moving to the Home Screen icon**: the icon has its own storage, separate from Safari. → Save a backup first, load it in the icon (the v0.10 tutorial and the icon's first screen do this).
- Clearing Safari's history and website data.

**Plan for Design Day (15 minutes with her, iPad in hand):**
1. Before touching anything: Settings → **Save backup** (file in Files). Also check the device has the week (Sync now).
2. Open the planner at the **same address** with internet; wait for "The planner was updated (version 0.10.0)" (or Settings → Check for updates).
3. Check her week is there (it will be; a safety copy was made automatically).
4. Run the tutorial with her; if she wants the app-like icon: Share → **Add to Home Screen** → open the icon → **Load my planner** (the file from step 1).
5. Try voice once (see §2). Turn on "Reminders on this iPad too" if she wants them.
6. From then on, updates arrive by themselves whenever she opens the planner with internet: **no visit needed**.

**Before Design Day, we must:** publish v0.10 to the same test-site address (tools/publish-test-site.sh), test steps 1–4 on an iPad with a copy of a real-looking week, and bring a printed copy of these steps.

---

## 6. A real app (item 12) and the tutorial

A store app (App Store) needs an Apple Developer account (paid yearly), a native or wrapped build, and Apple's review: not doable for Prototype 3. The planner is already a **Home Screen web app** (full screen, own icon, works offline). v0.10 adds a **first-use tutorial** that shows the planner and, on an iPad, walks through *Add to Home Screen* with the backup-and-load step so her week moves with her. If a store app is needed later, the same code can be wrapped (e.g. Capacitor) without rewriting it.
