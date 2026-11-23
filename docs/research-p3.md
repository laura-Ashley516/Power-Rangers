# Prototype 3: research notes and recommendations (Nov 2026)

> **Team decisions (Nov 23):** voice stays for everyone, and for the client the reminder device is the fallback; nothing is sent online (no cloud speech, no Apple dictation pushed by us); recording stops after **4 s** of silence; longest note **15 s** on both the iPad and the device; voice changes wait for **one tap ("Yes, do it")**; one language per planner (English by default, French for the public); the **more accurate** speech model by default; no reminder at the start time; calm line drawings instead of emoji; One day is a switch at the top of the schedule; photo reading is for other users; firmware: **compile and test first**, then Wi-Fi; backups **automatic**, never her job.

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

**Recommendation:** at Design Day, try Whisper on her iPad once (2 min).

**Decided (Nov 23):** nothing goes online, so B/C/D are not offered by the planner. For her, the reminder device is the fallback. **Important:** the device records, but the *understanding* still happens on the iPad (Whisper). If Whisper cannot run on her iPad at all, device notes will also wait in "Voice notes" without being understood. If that happens, the honest options are: a newer iPad, the small model (40 MB, Settings → Voice understanding), or understanding the device's notes on the laptop at a visit.

---

## 3. "Hey Cal": start listening by voice, like Siri or Alexa (item 15)

**What a wake word needs:** the microphone open **all the time** and a very small model that only recognises "Hey Cal" / "Hé Cal", on the iPad or on the device. On the iPad a web page can only listen **while it is open and on screen** (iPadOS stops the microphone in the background or when the screen locks), whatever engine we choose.

**Privacy of each option** ("nothing sent online"):

| Option | Audio leaves the iPad? | Anything else online? | Account? | French? | Notes |
|---|---|---|---|---|---|
| **Picovoice Porcupine (Web)** | **No**: detection runs in the page | Yes: the *AccessKey* is checked with Picovoice's server (licence and usage counts, no audio) | Yes (free personal tier; we cannot create it for you) | Yes | Easiest: "Hey Cal" trained in their console in minutes |
| **openWakeWord** (open source, Apache 2.0) | **No** | **Nothing** | No | Train our own model | We train "Hey Cal" ourselves (a free Colab notebook makes synthetic voices); runs in the browser with ONNX Runtime Web. A few days of work, fully private |
| **Vosk (vosk-browser)** with a 2-word grammar | **No** | Nothing (model downloaded once, ~40 MB) | No | Yes (French model) | Small speech recogniser told to listen only for "hey cal"; more false alarms than a true wake-word model |
| TensorFlow.js speech commands (transfer learning) | No | Nothing | No | Any (we record examples) | Trained in the browser from ~50 recordings of her saying it; less accurate with noise |
| Web Speech API / Siri | **Yes** | — | No | Yes | Breaks the privacy rule |

**On the device:** our ESP32 (classic) is too small for any of these. **microWakeWord** (open source, used by Home Assistant) or Espressif **WakeNet** run on an **ESP32-S3**; custom words in WakeNet are a paid Espressif service, microWakeWord can be trained ourselves. That means a new board.

**Answer to "does Picovoice respect privacy?":** the audio does, nothing you say leaves the iPad. But it is not *completely* offline: the key is checked with Picovoice over the internet, and it needs an account. **So no, it is not the only option:** **openWakeWord** is the fully private one (no account, nothing online), at the cost of training the "Hey Cal" model ourselves.

**Recommendation:** openWakeWord in the planner (switch in Settings, "Listen for Hey Cal", only while the planner is open); keep the hold-to-record button on the device for Prototype 3; consider an ESP32-S3 + microWakeWord for a later device.

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

**Done in v0.10 (decision Nov 23: automatic, never her job, data never at risk):** the planner copies **itself, whole** (all weeks, activities, settings) to the device's microSD **a few seconds after each change**, whenever the device can be reached without her doing anything (Wi-Fi set up, or Bluetooth already connected), and at every Sync. Over Wi-Fi the copy is **end-to-end encrypted** with the pairing code (the online relay only sees scrambled bytes). The device keeps that copy and the one before it. A new or emptied planner (new iPad, Safari cleared, new icon) offers to **put her planner back from the device** at the first Sync. The top bar says "Copy on the device · 10:42". Needs the v3 firmware.

---

## 5. Updating her planner at Design Day without losing anything (item 18)

**How updates work:** the planner is a website with an offline copy. When she opens it with internet, the new version downloads in the background and switches over by itself when she is not in the middle of something. **Her week is not part of the update**: it stays in the iPad's storage for that web address, and the planner converts older saves (with a safety copy made "before an update").

**What can lose her data (and must be avoided):**
- **Changing the web address** (another site or domain): the new address has empty storage. → Keep the same address forever after Design Day.
- **Moving to the Home Screen icon**: the icon has its own storage, separate from Safari. → Save a backup first, load it in the icon (the v0.10 tutorial and the icon's first screen do this).
- Clearing Safari's history and website data.

**Her Home Screen icon is already set up**, so the best way is to make the update reach her by itself, and only *check* it at Design Day:
- **Before Design Day:** publish v0.10 to the **same address** her icon opens (tools/publish-test-site.sh). The next time she opens the icon with internet, the update downloads in the background and switches over by itself when she is not in the middle of something; a safety copy is made "before an update". Nothing for her to do.
- **At Design Day:** Settings → About shows the version (0.10.0). If it is older, press "Check for updates" (one tap). Then a Sync so the device gets its first full copy.
- **Never** change the address, and never ask her to delete and re-add the icon (the icon's storage would go with it).

**Fallback plan, if anything looks wrong (15 minutes with her, iPad in hand):**
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
