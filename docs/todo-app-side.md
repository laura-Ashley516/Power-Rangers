# App side: what is left to do (updated Nov 27 2026, planner 0.10.2)

The planner code is finished for now. What is left needs a person, an account or the real device.
Hardware (pins, flashing, the device's own code) is the hardware team's part and is not listed here.

## To do now
- [ ] **Train "Hey Cal"** (about 1 hour, free, no coding): follow `docs/hey-cal-training.md`, get `hey_cal.onnx`.
      Then the planner gets one small update (model file + one line in `app/models/wake/word.json`) and is published again.
- [ ] **Create the private Wi-Fi relay** (about 15 minutes, free, team email): follow `docs/wifi-setup.md` step 1.
      EMQX Cloud Serverless, spending limit $0, two users `pwr-app` and `pwr-device`. Passwords in a password manager only.
      If it asks for a credit card: stop, use HiveMQ Cloud's free plan instead.
- [ ] **Enter the relay in her planner** (`docs/wifi-setup.md` step 2): address, `pwr-app` + password, New code, write the code on a card, Test the connection.
- [ ] **Give the hardware team** the relay address, the `pwr-device` password and the pairing code (in person or a password manager, never in the repo, chat or email).
- [ ] **Check her iPad has 0.10.2**: Settings → Check for updates (or switch to another app and back). The planner shows "The planner was updated (version 0.10.2)".

## To test on the real iPad
- [ ] Settings → Voice understanding → Listen for "Hey Cal" → allow the microphone → say "Hey Jarvis" (test word until "Hey Cal" is trained). The voice-note window should open and record.
- [ ] Turn the setting off again after the test if she does not want it.
- [ ] iPad reminders still come (automatic: on until a reminder device is synced).

## When the hardware team has a flashed device
- [ ] Sync over Bluetooth (Bluefy) and over Wi-Fi: "Synced at …", top bar shows "Copy on the device".
- [ ] Record a voice note on the device: the week shows "1 change is waiting for your OK" within a few minutes, with the planner open.
- [ ] After the first device sync, iPad reminders switch off by themselves (no double reminders).

## Later (ask before each)
- [ ] After "Hey Cal" works: test it with 10–20 voices, including French speakers; tune the threshold if needed.
- [ ] Merge the project-structure branch into `main` with a pull request (team review first).

## Done (0.10.2)
- Hey Cal listening in the planner (test word for now), runs on the iPad, nothing sent online.
- Wi-Fi: week, quiet times, planner copy sent encrypted; voice notes from the device received and understood (tested end to end with a pretend device).
- iPad reminders automatic, no double reminders with the device.
- Design check: no side stripes, clearer headings, French complete.
