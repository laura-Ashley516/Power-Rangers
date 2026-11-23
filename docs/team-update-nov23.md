# Team update: planner v0.10 + device firmware v3 (Nov 23, 2026)

Branch: `aridj/project-structure` (pushed). Everything from `main`, `day-1`, `my_week_my_way` and `feature/opening-page-preference` is merged into it. Test site (the client's Home Screen icon): v0.10 published.

## What is new

### Planner (app/)
- **Week | One day** switch at the top. One day is a simple day view like a phone planner: day strip, Morning / Afternoon / Evening groups, a line drawing per activity, the time ("10:00 → 11:00"), and the energy shape with its word ("★ High"). The **Today** screen is gone.
- **Opening page** setting (from the opening-page branch) kept: now **Week / One day**; an older "Today" choice opens One day.
- **Times:** an activity can have a clock time (forms, voice, photo, device).
- **Split into parts** from any activity card.
- **Energy:** bar without numbers (green → yellow → red), real red, shapes circle / triangle / **solid black star** / pause ("more points = more energy"), legend on screen and on paper.
- **Suggestions** button next to New activity, closed until opened.
- **French / English** everywhere (English by default; French for public users). `node tools/i18n-check.mjs` lists any text without French.
- **Voice:** one tap **"Yes, do it"** before anything changes; device notes wait for **"Do them"** on the week; stops after 4 s of silence; 15 s max (same as the device); the more accurate speech model by default; French voice commands.
- **Add from a photo:** reads a photo of a paper schedule (on the iPad, EN + FR), she ticks what to add. Python version: `tools/photo_to_schedule.py`.
- **Reminders on the iPad** with the same rule as the device (60 min before; no reminder at the start time).
- **Automatic backup:** a few seconds after each change, the whole planner is copied to the device (when it can be reached without her doing anything). A new or emptied planner offers to put it back. Top bar: "Saved on this iPad · 10:42 · Copy on the device · 10:42".
- **Demo mode** for Design Day (her own planner stays apart), **first-use tutorial** with Home Screen steps.
- Tests: **212 checks**, `node app/tests/run.js`.

### Device (firmware/pwr_device, protocol v3)
- **Wi-Fi** through a relay (MQTT over TLS), same commands as Bluetooth; **end-to-end encryption** (AES-256-GCM, key from the pairing code) with a self-test at boot.
- **Clock time** per activity and its own reminder; **quiet times** (no buzz during church, music lesson…).
- Keeps the **planner copy** (`/state.bin` + the previous one).
- **Compiles** (from scratch, no warnings in our code) for the **ESP32-C5** (core 3.3.12) and the classic ESP32 (core 2.0.17), Huge APP partition: `tools/compile-firmware.sh c5`. **Not run on a board yet.**
- The touch-screen sketch from `main` is kept in `firmware/device_sketch_v1/` (renamed, client name removed).

### Docs
- `docs/protocol.md` v2/v3 · `docs/wifi-setup.md` (relay, step by step) · `docs/research-p3.md` (power, voice, "Hey Cal", backup, Design Day update plan).

## Next steps

| # | What | Who (role) | When |
|---|---|---|---|
| 1 | **Set the ESP32-C5 pins** in `firmware/pwr_device/pwr_config.h` from the real wiring (the C5 has GPIO 0–28 only), flash, check the Serial Monitor: `E2E self-test: PASS` and free memory | Hardware | Next week |
| 2 | **Create the Wi-Fi relay** (EMQX Serverless, team email, spending limit $0, users `pwr-app` and `pwr-device`), then set up the planner and the device: `docs/wifi-setup.md`. Passwords never in the repo or chat | One person | Before Design Day |
| 3 | Test on the board: Bluetooth sync, Wi-Fi sync, a voice note from the device, reminders with times, quiet times, the planner copy (`STATE_*`) | Hardware + app | After 1–2 |
| 4 | **Battery test** with Wi-Fi on (test T2); then the power plan in `docs/research-p3.md` §1 (screen off, 80 MHz) | Hardware | After 3 |
| 5 | Try v0.10 on a real iPad (the test site): One day, voice "Yes, do it", photo, tutorial, French | App | This week |
| 6 | **"Hey Cal"**: openWakeWord in the app + microWakeWord on the C5, trained on the same "Hey Cal" data. Feedback on the comparison doc first | Team | After Design Day? |
| 7 | **Privacy on `main`:** the client's name is still in `main` (the touch sketch's file name, its Bluetooth name, and two old HTML files). Merge this branch into `main` (pull request) or rename them there | Whoever owns `main` | Soon |
| 8 | Decide what to do with the Flutter apps (`pwr/`, `my_week_my_way/`): the team chose the web app (PWA) on Oct 25 | Team | Next meeting |
| 9 | Design Day: Settings → About shows **0.10.0** on her iPad (else "Check for updates"), then **Sync** once so the device gets its first copy; try one voice note | Team | Design Day |
| 10 | Deliverables: use `docs/research-p3.md`, this update and the test results for PD H / the final report | Docs | Ongoing |

## Decisions already made (Nov 23)
Voice stays for everyone, the device is her fallback · nothing readable sent online · 4 s silence · 15 s max · one tap to confirm · one language per planner, English default · more accurate speech model · no reminder at start time · line drawings, not emoji · One day as a switch at the top · energy word on One day cards (item 13 A) · photo reading for other users · firmware: compile first, then Wi-Fi · backups automatic · relay: EMQX Serverless.
