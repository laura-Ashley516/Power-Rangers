# Software plan

> **Status (Oct 17, project-structure branch):** a first complete version of every phase exists so the team can adjust it: the app is split into modules (Phase 0), rules / safe saving / backup / offline mode (Phase 1), protocol v1 + demo device (Phase 2), voice pipeline with Whisper (Phase 3), and firmware v1 (not compiled yet). Tested on laptop Chrome and with `node app/tests/run.js`; nothing tested on an iPad or the real device yet. See [run-and-test.md](run-and-test.md).

Guiding rules: one offline-first web app · everything stays on the client's device · every change goes through one rule check · small files, one job each, so 2–3 people can work at the same time.

## Phase 0 — Setup + tests
1. Repo setup: folders, protect `main`, labels (`software`, `hardware`, `good first task`).
2. **Split the planner HTML into the `app/` files with no behaviour change.** One person, before anyone else edits the app.
3. Publish on GitHub Pages.

Quick tests (one person each, 2–3 h, result posted in a GitHub Issue):

| Test | Question |
|---|---|
| T1 Bluefy | Bluetooth to the ESP32? Printing? Opens offline? Home-screen icon? Keeps data? |
| T2 Whisper | Runs in Bluefy / Safari / Chrome? Load time? Time for a 15 s clip? tiny or base? |
| T3 Bluetooth audio | Time to send 100 KB? (with a hardware teammate) |

**Decision point 1:** Bluefy or laptop · Whisper size · audio format and clip length.

## Phase 1 — Solid core (Prototype 2)
- `rules.js`: max 5 greens · 1 yellow = 2–3 greens · 1 red + 30 min rest = 1–2 greens · ≤ 1 red per day · locked appointments. Tested with sample schedules.
- `store.js`: data versions, permanent-storage request, backup file save / load.
- `sw.js`: offline-first, silent update on next open.
- Client feedback: pre-filled week from the previous week, locked appointments, printout layout.
- Specs: 7 days visible without scrolling, 3 blocks per day, ≤ 3 clicks per task, contrast ≥ 7:1.

## Phase 2 — Device link v2 (with hardware)
- Freeze [protocol.md](protocol.md) v1 together.
- `device.js` implements it, plus a **fake device** in code so software can test without hardware.
- Empty-app protection: restore from the device, never wipe it.

## Phase 3 — Voice pipeline
- `parser.js` + 30–50 test sentences, target ≥ 90 % (pure text, can start during Phase 1).
- `transcribe.js`: Whisper loaded once and cached, one clip at a time, silent clips ignored, the client's activity names as hints.
- Pipeline: notes → text → actions → rule check → calendar → change log.
- `inbox.js`: notes not understood, with playback.

## Phase 4 — Integration + client
- End-to-end test with the real device; test with real recordings of the client's voice.
- Setup checklist for the client visit (Bluefy, URL, Whisper download, pairing).
- Fixes and user-manual material.

## Tracks (who can work in parallel)

| Track | Files |
|---|---|
| A — Interface | `ui-*.js`, `print.js`, CSS |
| B — Data + device | `store.js`, `sw.js`, `device.js`, `protocol.md` |
| C — Rules + voice | `rules.js`, `voice/*`, `tests/` |

With 2 people, B and C merge and voice starts after the rules.

## Risks

| If… | Then… |
|---|---|
| Bluefy fails T1 | Laptop Chrome becomes the home device, no code change |
| Whisper too slow | "tiny" model, or process while charging |
| Bluetooth audio too slow | Shorter or more compressed clips |
| Parser too rigid | Small local language model as a later bonus |
