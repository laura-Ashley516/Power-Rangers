# Bluetooth protocol (app ↔ device)

This file is the **contract** between the software and hardware teams. If both sides follow it, they can work in parallel: software tests against the fake device built into the app, hardware tests with a simple sender.

**Rule:** change this file first (in a pull request reviewed by one person from each team), then the code.

## Connection

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
