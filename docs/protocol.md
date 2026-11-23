# Device protocol (app ↔ device, Bluetooth and Wi-Fi)

This file is the **contract** between the software and hardware teams. If both sides follow it, they can work in parallel: software tests against the fake device built into the app, hardware tests with a simple sender.

**Rule:** change this file first (in a pull request reviewed by one person from each team), then the code.

## Bluetooth connection

| Item | Value |
|---|---|
| Device name | `PWR Reminder` (the app finds the device by its service UUID, so the first-try name also works) |
| Service UUID | `12345678-1234-1234-1234-1234567890ab` |
| RX characteristic (app → device, write) | `12345678-1234-1234-1234-1234567890ac` |
| TX characteristic (device → app, notify) | `12345678-1234-1234-1234-1234567890ad` |

- Every message is **one line of UTF-8 text**, at most **180 bytes**. No newline character is sent.
- **Small packets:** a Bluetooth packet may be smaller than a message (the minimum is 20 bytes). The device reports its current packet payload in `HELLO`. A message longer than one packet is cut into pieces: **every piece except the last starts with `+`**, and the receiver glues the pieces back together (without the `+`) before reading the message. Both sides do this. `HELLO|1` itself is never cut. Pieces are cut between characters, never inside one.
- Fields are separated by `|`. Activity names must not contain `|` (the app replaces it with `/`).
- The app waits for the reply to a command before sending the next command (except inside a schedule transfer, where it sends lines one after the other with a short pause).
- Unknown commands are answered with `ERR|UNKNOWN|<command>`.

## v1 commands

### Hello (sent first, after connecting)
```
app → HELLO|1
dev → HELLO|1|<deviceName>|<scheduleCount>|<notesCount>|<payload>
```
`<payload>` = largest message that fits in one Bluetooth packet right now (packet size − 3, between 20 and 180). A device that answers `ERR|UNKNOWN|HELLO` (or nothing within 2 s) is treated as **v0** (see below).

### Clock
```
app → TIME|<unixSeconds>|<utcOffsetMinutes>
dev → OK|TIME
```
Sent at every sync. The device uses it to time-stamp voice notes and to know which day it is.

### Safe schedule sync
```
app → SCHEDULE_START|<count>
app → Monday|Morning|Walk|green          (count lines: day|period|name|energy)
app → SCHEDULE_END|<count>
dev → SCHEDULE_RECEIVED|<count>          (success)
dev → ERR|SCHEDULE|<receivedCount>       (count mismatch: nothing replaced)
```
- Day: `Monday` … `Sunday`. Period: `Morning` / `Afternoon` / `Evening`. Energy: `green` / `yellow` / `red`.
- The device stores incoming lines in a **temporary list**. Only when `SCHEDULE_END|<count>` matches the number of lines received does it **replace** its schedule, **save it to microSD** (`/schedule.txt`, one line per activity) and show it.
- If the connection drops mid-transfer, the old schedule stays.
- Maximum 35 activities (the app warns before sending more).

### Backup restore (device → app)
```
app → BACKUP_GET
dev → BACKUP_START|<count>
dev → B|Monday|Morning|Walk|green        (count lines)
dev → BACKUP_END|<count>
```
Used when the app is **empty** (e.g. browser data erased). **An empty app never sends a schedule to a device that still has one:** it offers to restore instead.

### Voice notes
```
app → NOTES_LIST
dev → NOTE|<id>|<unixSeconds>|<bytes>    (one per waiting note)
dev → NOTES_END|<n>

app → NOTE_GET|<id>
dev → DATA_START|<id>|<bytes>|<chunks>
dev → D|<seq>|<base64>                   (seq = 0 … chunks-1; raw bytes per chunk = ((payload − 8) / 4) × 3, max 120, so each D line fits in one packet)
dev → DATA_END|<id>|<sum16>              (sum of all raw bytes, modulo 65536)

app → NOTE_DEL|<id>                      (only after the app has checked size, every seq and sum16)
dev → OK|DEL|<id>
```
- `<id>` is a short number chosen by the device (e.g. `7`). The file is `/notes/<id>.wav` on the microSD.
- **Audio format:** WAV, **IMA ADPCM** (format `0x11`, 4 bits per sample), mono, **8 000 Hz**, blocks of 256 bytes (505 samples), with a `fact` chunk giving the real number of samples. Maximum **15 s** (≈ 60 KB, about 4× smaller than plain 16-bit). The app unpacks it (`app/js/voice/wav.js`) and resamples to 16 kHz for Whisper. Plain 16-bit PCM WAV is also accepted. Tested: Whisper understood 4/4 compressed sample notes word for word.
- If anything is missing or the sum is wrong, the app simply asks `NOTE_GET|<id>` again. The note is only deleted after `NOTE_DEL`.
- The device sends chunks with a small pause (≈ 10 ms) so the phone/iPad can keep up.

### Clock time of an activity (v2, Nov 2026)
```
app → Monday|Morning|Physio|yellow|10:30   (a 5th field: HH:MM, 24 h, local time)
dev → B|Monday|Morning|Physio|yellow|10:30 (backup lines carry it too)
```
- Sent **only to devices that answer `HELLO|2`**. A v1 device would read `10:30` as the energy, so it never gets the 5th field.
- The device shows it on the card (`10:30 Physio`) and reminds `REMINDER_LEAD_MIN` before that time. Activities **without** a time keep the block reminder (before 9:00 / 13:00 / 18:00), sent only if the block has at least one activity without a time.
- Within a time of day, the app sends activities with a time first, in time order.
- The planner shows the same reminders while it is open (`app/js/reminders.js`, rule in `rules.remindersFor`).

### Quiet times (v2, firmware done Nov 2026, not yet run on the board)
```
app → QUIET_START|<n>
app → Q|Sunday|Morning                  (n lines: day|period)
app → QUIET_END|<n>
dev → QUIET_RECEIVED|<n>
```
- Sent right after a schedule sync, **only to devices that answer `HELLO|2`**. v1 devices never receive it (they would answer `ERR|UNKNOWN`).
- Count mismatch: `ERR|QUIET|<received>` and the old list stays (like the schedule). Saved in `/quiet.txt`.
- During a quiet block the device does **not vibrate or beep**. A reminder that falls in it is shown on the screen at once, and its buzz waits until the block ends.
- The list replaces the previous one (send all blocks every time). Saved on the microSD like the schedule.

### Automatic backup of the whole planner on the device (v3, Nov 2026)
Her data must never be at risk and she should never have to make a backup herself. So the app keeps a **full copy of the planner** (all weeks, activities, settings) on the device's microSD, automatically: a few seconds after each change when the device is reachable, and at every Sync. The device does not read it: it stores bytes.
```
app → STATE_START|<bytes>|<chunks>|<unixSeconds>
app → S|<seq>|<base64>                   (seq = 0 … chunks-1, same chunk size rule as voice notes, max 120 raw bytes)
app → STATE_END|<sum16>                  (sum of all raw bytes, modulo 65536)
dev → STATE_SAVED|<bytes>                (or ERR|STATE|<reason>: nothing replaced)

app → STATE_GET
dev → STATE_NONE                         (no copy yet)
   or STATE_DATA|<bytes>|<chunks>|<unixSeconds>, then S|<seq>|<base64> lines, then STATE_DATA_END|<sum16>
```
- `<bytes>` = the planner as JSON, **gzip-compressed** by the app (typically 5–30 KB). Maximum 256 KB.
- The device writes `/state.tmp`, checks size and sum, keeps the previous copy as `/state.prev`, then renames to `/state.bin` (time in `/state.txt`). A transfer that stops halfway changes nothing.
- Only for devices that answer `HELLO|3`. Over Wi-Fi the lines are end-to-end encrypted like every other message (see below).
- The app uses it to restore: when the planner is empty (new iPad, Safari cleared, new Home Screen icon) it offers "Restore your planner from the device".

## Wi-Fi (through an MQTT broker)

Same commands as above, carried by MQTT instead of Bluetooth (why: [wifi-plan.md](wifi-plan.md)). The app connects with **MQTT over secure WebSocket** (`wss://…`); the device connects to the **same broker** with **MQTT over TLS** (port 8883 on most brokers).

| Item | Value |
|---|---|
| Pairing code | 12 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown as `ABCD-EFGH-JKLM`. Made by the app, typed into the device once |
| `<id>` | SHA-256 of the 12 characters (upper case, **no dashes**, UTF-8), first **6 bytes** as **lower-case hex** (12 characters). Example: code `ABCD-EFGH-JKLM` → hash of `ABCDEFGHJKLM` |
| App → device | topic `pwr/<id>/app` |
| Device → app | topic `pwr/<id>/dev` |
| Device presence | topic `pwr/<id>/status`, **retained**: the device publishes `online` after connecting and sets its **last will** to `offline` (also retained) |
| QoS | 1 for everything |

- **One MQTT message = one protocol line.** No `+` pieces: in `HELLO` the device reports a `<payload>` of `1024` (or its real MQTT buffer size minus 64), so the app never needs to cut messages.
- Voice note chunks keep the same `D|<seq>|<base64>` format (max 120 raw bytes per line), so the note code is shared with Bluetooth.
- The app waits up to **6 s** for `HELLO` over Wi-Fi. If the device does not answer, the app says the device is offline (there is no v0 over Wi-Fi).
- **Device setup (once):** if it has no saved Wi-Fi, the device opens a setup hotspot **`PWR-Setup`** (WiFiManager) with fields: home Wi-Fi name + password, broker host, broker port, broker username + password, pairing code.
- **Prototype 2:** the device stays connected while it is switched on at home. **Later (battery):** connect only for a sync (Sync button or every N minutes), then turn Wi-Fi off.
- **Privacy (v3, Nov 2026): end-to-end encryption.** "Nothing readable is sent online": every message on `pwr/<id>/app` and `pwr/<id>/dev` is encrypted on the iPad and on the device, so the broker (and anyone on a public broker) only sees scrambled bytes. The `status` topic stays plain text (`online` / `offline`, nothing personal).
  - Key: **SHA-256** of the UTF-8 text `pwr-e2e-key|` + the 12 code characters (upper case, no dashes) → 32 bytes, **AES-256-GCM**.
  - Sealed bytes = **12-byte random IV** ‖ **ciphertext** ‖ **16-byte tag**; the MQTT payload is these bytes as **base64 text** (standard alphabet, `=` padding), so both MQTT libraries carry it as a plain string. Additional authenticated data = the **topic name** (UTF-8), so a message cannot be replayed on the other topic.
  - Plaintext = one protocol line (UTF-8), exactly as over Bluetooth. A message that does not decrypt is ignored (and logged on the device's serial port).
  - **Test vector:** code `ABCD-EFGH-JKLM` → `<id>` = `3f63d25fcb89`, key = `37fa3af32f5084438220beda2088be4565ebbef889252d743fc88230aae0d7d3`. Line `HELLO|3` on topic `pwr/3f63d25fcb89/app` with IV `000102030405060708090a0b` → sealed bytes `000102030405060708090a0bd4a8a89d03e6dbbb11c7f9bdaa3631bbcd8985ab3d43c9` → MQTT payload `AAECAwQFBgcICQoL1KionQPm27sRx/m9qjYxu82Jhas9Q8k=`.
  - Device side: mbedTLS `mbedtls_gcm_*` (part of the ESP32 core); random IV from `esp_fill_random`.
- **Testing:** a public test broker (e.g. `wss://broker.emqx.io:8084/mqtt`, no password) is fine with **demo data only**: anyone can read a public broker. `tools/wifi-fake-device.mjs` is a pretend device that answers over Wi-Fi exactly like the firmware should.

## v0 — what the first-try code does (still accepted)

```
SCHEDULE_START
Monday|Morning|Walk|green
...
SCHEDULE_END
→ SCHEDULE_RECEIVED
```
- Legacy `day|name|energy` lines are placed in the morning.
- **Problem:** `SCHEDULE_START` (without a count) erases the device's schedule immediately; if the transfer stops halfway, the device's copy is lost. v1 fixes this.
- The v1 firmware still accepts v0 so older app versions keep working.
