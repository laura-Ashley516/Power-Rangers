# firmware/

ESP32 code for the portable reminder device (display, buttons, vibration, microphone + microSD, Bluetooth).

The Bluetooth messages must follow [docs/protocol.md](../docs/protocol.md). Change the protocol there first, together with the software team, then in the code.

> **First try:** `accessible_scheduler_esp32_compact.ino` at the repo root is the team's first-try sketch (v0 protocol, display only). It is kept as a reference and is not changed. The new sketch below reuses its display code and look.

## The sketch: `pwr_device/`

Arduino needs the folder name to match the `.ino` name, so open **`firmware/pwr_device/pwr_device.ino`** in the Arduino IDE. All the other files in the folder open as tabs.

| File | What it does |
|---|---|
| `pwr_device.ino` | `setup()` and `loop()`: buttons, which day is shown, reminders, recording, screen refresh |
| `pwr_config.h` | **All pins, timings and limits in one place** (period start times, reminder lead, vibration pattern, audio settings…) |
| `pwr_schedule.h/.cpp` | The activity list (max 35) and reading one `day\|period\|name\|energy` line (also legacy `day\|name\|energy`) |
| `pwr_clock.h/.cpp` | Software clock set by `TIME\|unix\|offsetMinutes`; gives today's day and the local time |
| `pwr_storage.h/.cpp` | microSD: `/schedule.txt`, `/notes/<id>.wav`, `/notes/<id>.txt` (time stamp), `/notes/next.txt` (next id) |
| `pwr_display.h/.cpp` | Everything drawn on the ILI9341 (day page, reminder view, status line, recording screen, messages) |
| `pwr_buttons.h/.cpp` | Debounced buttons (INPUT_PULLUP, pressed = LOW) |
| `pwr_vibration.h/.cpp` | Gentle vibration pulses without blocking `loop()` |
| `pwr_recorder.h/.cpp` | INMP441 microphone (legacy `driver/i2s.h`) → 16-bit 8 kHz mono WAV |
| `pwr_protocol.h/.cpp` | BLE server, queue of incoming lines, every protocol command, base64 encoder, voice-note transfer |
| `pwr_app.h` | The few functions in `pwr_device.ino` that the Bluetooth code calls |

Pins: see [hardware/wiring/pins.md](../hardware/wiring/pins.md) (proposed — check against the circuit).

## Build and flash (Arduino IDE 2)

1. **Board support:** *Tools → Board → Boards Manager*, install **"esp32" by Espressif Systems, version 2.0.x** (2.0.17 recommended; at least 2.0.3). Version 3.x changed the BLE and I2S APIs and is **not** tested.
2. **Libraries:** *Tools → Manage Libraries*, install
   - **Adafruit GFX Library**
   - **Adafruit ILI9341** (also installs Adafruit BusIO)

   Already included with the ESP32 core (nothing to install): **BLE** (`BLEDevice.h`…), **SD**, **FS**, **SPI**, **`driver/i2s.h`**.
3. **Board settings:**
   - *Board:* **ESP32 Dev Module**
   - *Partition Scheme:* **Huge APP (3MB No OTA/1MB SPIFFS)** — Bluetooth + SD + graphics may not fit in the default 1.2 MB app partition.
   - *Upload speed:* 921600 (lower to 115200 if uploads fail).
4. Open `firmware/pwr_device/pwr_device.ino`, select the port, click **Upload**.
5. Open the *Serial Monitor* at **115200 baud**: every received (`RX:`) and sent (`TX:`) message is printed (voice-note chunks are not, there are thousands).

**microSD:** format as **FAT32**. The device creates `/notes/` by itself. Without a card everything still works except saving the schedule and recording (the status line shows "No SD card").

## How it behaves

- **Day page:** header with the day name ("TODAY" tag when it is today), sections Morning / Afternoon / Evening, pastel cards (green / yellow / red), footer with the number of activities and the next day, status line (connected or not, notes waiting or "No SD card", local time).
- **Buttons:** NEXT shows the next day. DONE stops a reminder, otherwise goes back to today. RECORD: hold to record (max 15 s), release to stop; presses shorter than 0.5 s are ignored. After 2 minutes without a button press the screen goes back to today (`RETURN_TO_TODAY_MS`). The old automatic 10 s day rotation can be turned back on with `AUTO_ROTATE_MS`.
- **Reminders (only once the app has set the clock):** 60 min before Morning (09:00), Afternoon (13:00) or Evening (18:00), if that block has activities today: 3 × 300 ms pulses, repeated every 5 min, at most 3 times, and the screen shows that block with "Coming up" until DONE is pressed.
- **Bluetooth:** the BLE callback only puts the line in a queue; `loop()` does the work and sends the replies (10 ms pause after each notification). A voice note is sent one chunk per `loop()`, so the buttons keep working during a transfer (≈ 25–30 s for a 15 s note).
- **Schedule sync:** lines go to a temporary list; the schedule is replaced (and saved to `/schedule.txt`) only when `SCHEDULE_END|<count>` matches. If the connection drops, or nothing arrives for 30 s, the old schedule stays.

## Audio format

WAV, **IMA ADPCM** (4 bits per sample, about 4× smaller than plain 16-bit), mono, 8000 Hz, max 15 s (~60 KB), 60-byte header (RIFF + fmt + fact + data), blocks of 256 bytes / 505 samples. The INMP441 gives 32-bit words; the code keeps the top bits with a ×4 gain (`MIC_SHIFT = 14`, lower = louder), clips to 16 bits, then compresses each block while recording. The app unpacks it (`app/js/voice/wav.js`); the same encoder is tested in `app/tests/run.js`.

**Bluetooth packet size:** messages longer than one packet are sent in pieces starting with `+` (see docs/protocol.md). The packet size is read from the connection (`getPeerMTU`) and reported in `HELLO`; voice-note chunks are sized to fit one packet.

## Not tested yet (written without compiling on the real board)

This code has **not been compiled with the ESP32 core nor run on hardware**. Expect small fixes on the first build. In particular, check:

- **It compiles** with ESP32 core 2.0.x and fits in flash (use the Huge APP partition).
- **BLE packet size:** messages up to 180 bytes need the app (Bluefy / Chrome) to negotiate a bigger MTU. If replies arrive cut at 20 bytes, the MTU exchange did not happen.
- **Voice-note transfer speed and reliability** with 10 ms between chunks (does the iPad drop notifications?). The app re-asks with `NOTE_GET` if the sum is wrong.
- **Microphone:** left/right channel (`MIC_CHANNEL_FORMAT` in `pwr_recorder.cpp`), loudness (`MIC_SHIFT`), any click at the start.
- **SD card and TFT on the same SPI bus** (see the note in `hardware/wiring/pins.md`).
- **Time zone sign:** the device expects `TIME|<unix>|<offset>` with local = UTC + offset (Ottawa summer = `-240`). JavaScript's `getTimezoneOffset()` has the opposite sign, so the app must send `-new Date().getTimezoneOffset()`.
- **Reminder timing** over a full day, and the clock drift of the ESP32 without a sync (a few seconds per day is expected).
- While recording (up to 15 s) Bluetooth messages wait in the queue; the app may time out if it talks to the device at that moment.
