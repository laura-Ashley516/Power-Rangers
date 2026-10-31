# Decisions

What we decided and why. Status: ✅ decided · 🧪 depends on a test · ⏳ later.

| # | Decision | Why | Status |
|---|---|---|---|
| 1 | The planner is a **web app**, hosted free on GitHub Pages at a URL that never changes | $0, easy to update, works on iPad and laptop with the same code | ✅ |
| 2 | **Offline-first**: app files stored on the client's device, updates applied automatically on the next open | Works without internet, no reinstall | 🧪 T1 (does Bluefy support it?) |
| 3 | On iPad the app runs in **Bluefy**; laptop Chrome is the fallback | Safari and Chrome on iPad have no Web Bluetooth | 🧪 T1 |
| 4 | Voice notes are **recorded on the device away from home** and processed when it syncs at home | The device has no Wi-Fi; notes don't need to be instant | ✅ |
| 5 | **No cloud AI** (no Claude / ChatGPT calls) | The client's voice and schedule are personal health data; no internet or API key needed; $0 | ✅ |
| 6 | Speech → text with **Whisper running locally** in the app; text → action with a **parser matched to the client's activity library** | Private, free, does not depend on the client's iPad model, predictable and testable | 🧪 T2 (speed in Bluefy) |
| 7 | Every change (drag & drop, voice, restore) goes through **one rule check** | Same energy rules for every input | ✅ |
| 8 | The client's schedule is kept in **3 places**: the app, the device's microSD, the weekly printout | Browser data can be erased; the device restores it | ✅ |
| 9 | Change from PD D: **no Python backend**; everything runs in JavaScript in the browser | Matches the first-try code; nothing to host | ✅ |
| 10 | Change from PD D: the "AI suggestions" assistant is **out of scope for now** | Focus on voice → calendar | ✅ |
| 11 | How the client is told about voice changes | — | ⏳ |
| 12 | One integrator reviews and merges pull requests (backup: repo owner) | One person keeps `main` working | ✅ |
| 13 | Energy rules as one "load" score: green 1, yellow 2.5, red 3.5, limit 5.5 per day (see `app/js/config.js`) | Encodes all of the client's balance rules in one number; easy to tune | ✅ first version |
| 14 | Voice changes are applied directly, then shown: banner on the week, "new" marks, change list with Undo, "to sort" list | The client doesn't confirm each change but can see and undo them | ⏳ first version, to validate with the client |
| 15 | The browser's built-in dictation is **not** used | On Apple devices it can send audio to Apple; Whisper keeps it on the device | ✅ |
| 16 | Whisper "tiny" English by default, "base" selectable in Settings | tiny: ~40 MB, fast; base: more accurate, slower | 🧪 T2 |
| 17 | **No native iPad app** (Flutter / Swift) for now; the planner stays a web app | Free Apple installs stop opening after 7 days; TestFlight / App Store need $99 USD/year | ✅ (ask the TA about a uOttawa Apple team) |
| 18 | Device sync moves to **Wi-Fi through an MQTT broker**, same protocol lines, encrypted end to end; **Bluetooth stays as plan B**. Replaces #3 (Bluefy) once it works | iPad uses plain Safari; Bluefy test passed, so Bluetooth is a safe fallback. See [wifi-plan.md](wifi-plan.md) | 🧪 go / no-go Nov 1 |
| 19 | Keep the current ESP32 (no ESP32-C5) | It already has 2.4 GHz Wi-Fi; the C5 would mean porting the firmware to core 3.x | ✅ unless the client's router is 5 GHz only |
| 20 | **Today screen first**: Now / Next in large type, what to remember, tomorrow | Memory loss: 1–3 items at a time (W3C COGA); step lists help (INCOG 2.0) | ✅ v0.6, to validate with the client |
| 21 | **Example week built from her real activities** (≤ 3 a day, all within her rules), generic names | Client asked for a pre-filled week she can edit; generic labels so others can use it | ✅ v0.6 |
| 22 | **Drag and drop for everything**: her activities, the week, "Later this week"; touch = short press then drag; tap-then-tap as the alternative | Client asked for drag and drop; scrolling must still work on iPad; 2-tap alternative for accessibility | ✅ v0.6 |
| 23 | **Rest is never added for her**: a reminder of her 30-min rule after a high activity, rest added only on her tap | "I don't want forced relaxation" (meeting 1) vs "1 red + 30 min rest" (meeting 2) | ✅ v0.6 · ask 30 min or 1 h |
| 24 | **Week starts on Sunday** by default; energy shown as "4½ of 5½", never % | Her kitchen calendar; she finds percentages hard | ✅ v0.6 |
| 25 | **Look matches the device**: olive / cream / terracotta, sage / sand / terracotta energy, text ≥ 7:1, Atkinson Hyperlegible, Dim theme | One product feel; light sensitivity; contrast spec | ✅ v0.6 |
| 26 | **"Suggest a lighter week"** is rule-based (no AI service), shows every move and changes nothing until she applies it | She is fine with the team using AI but does not want to use AI herself; stays offline and predictable | ✅ v0.6 |
| 27 | **Drag and drop from an always-visible "My activities" box into the calendar is a core requirement: never remove or hide it.** The planner opens on the week (main page); the week is a timetable: days across, Morning / Afternoon / Evening down, one box per day and time | The client asked for it (meeting 2) and the team made it the top priority (Oct 31). Guarded by automatic checks in `app/tests/run.js` ("Drag and drop (required)") | ✅ v0.7 · permanent |
| 28 | **Appointment card** (v0.8): up to 3 questions (tap suggestions), what to bring, a note after the visit; prints as a pocket card | Question lists help patients ask more and get more information (42-study review, Sansoni et al. 2015); she finds forms stressful and carries paper notes | ✅ app · to try at Client Meet 3 |
| 29 | **Quiet times** (v0.8): no vibration or beep during chosen activities (church and music lesson by default); reminders wait until after | TA suggestion (meeting 1: no notifications during church); noise sensitivity | ✅ app · ⏳ firmware (protocol v2 `QUIET`) |
| 30 | **No tracking** (v0.8.1): the energy check-in, the 7-day pattern and "Mark done" are removed, and old check-in / done data is deleted. Steps show as a plain "Remember" list. The planner only helps her plan (her energy rules for planning stay) | The client does not want the app to track her or reassure her; she wants help to schedule | ✅ permanent |

## Questions for the next client meeting
- Is your home device the iPad or the laptop?
- Do you ever speak French to it, or only English?
- Is it OK to tap an icon that opens the planner, even if it is technically a website?
- Is your home Wi-Fi 2.4 GHz (most routers are)? Is it OK if the schedule goes through an online service, encrypted?
- Rest after a high activity: 30 minutes or about 1 hour? Energy of the exercise class, music lesson, vacuuming, floors, appointments?
