# firmware/

ESP32 code for the portable reminder device (display, buttons, vibration, microphone + microSD, Bluetooth, Wi-Fi).

The Bluetooth and Wi-Fi messages must follow [docs/protocol.md](../docs/protocol.md). Change the protocol there first, together with the software team, then in the code.

> **Earlier sketches:** the first-try sketch (v0 protocol, display only) was removed from `main` by the team; the sketch below reuses its display code and look. The team's touch-screen sketch from `main` (ILI9341 + XPT2046 touch, Oct 23) is kept in [`device_sketch_v1/`](device_sketch_v1/) as a reference, renamed and with the client's name replaced (privacy rule: no names in the code, and the Bluetooth name is visible to anyone nearby).

## The sketch: `pwr_device/`

Arduino needs the folder name to match the `.ino` name, so open **`firmware/pwr_device/pwr_device.ino`** in the Arduino IDE. All the other files in the folder open as tabs.

| File | What it does |
|---|---|
| `pwr_device.ino` | `setup()` and `loop()`: buttons, which day is shown, reminders, recording, screen refresh |
| `pwr_config.h` | **All pins, timings and limits in one place** (period start times, reminder lead, vibration pattern, audio settings…) |
| `pwr_schedule.h/.cpp` | The activity list (max 35) and reading one `day\|period\|name\|energy` line (also legacy `day\|name\|energy`) |
| `pwr_clock.h/.cpp` | Software clock set by `TIME\|unix\|offsetMinutes`; gives today's day and the local time |
| `pwr_storage.h/.cpp` | microSD: `/schedule.txt`, `/quiet.txt`, `/notes/<id>.wav`, `/notes/<id>.txt` (time stamp), `/notes/next.txt` (next id), planner copy `/state.bin`, `/state.prev`, `/state.txt` |
| `pwr_display.h/.cpp` | Everything drawn on the ILI9341 (day page, reminder view, status line, recording screen, messages) |
| `pwr_buttons.h/.cpp` | Debounced buttons (INPUT_PULLUP, pressed = LOW) |
| `pwr_vibration.h/.cpp` | Gentle vibration pulses without blocking `loop()` |
| `pwr_recorder.h/.cpp` | INMP441 microphone (legacy `driver/i2s.h`) → 16-bit 8 kHz mono WAV |
| `pwr_protocol.h/.cpp` | BLE server, queue of incoming lines (Bluetooth and Wi-Fi), every protocol command, voice-note and planner-copy transfers |
| `pwr_wifi.h/.cpp` | Wi-Fi: the `PWR-Setup` page (WiFiManager), MQTT over TLS (PubSubClient), reconnecting |
| `pwr_crypto.h/.cpp` | Pairing code → topic id and key, AES-256-GCM end-to-end encryption, boot self-test |
| `pwr_base64.h/.cpp` | base64 encoder and decoder |
| `pwr_app.h` | The few functions in `pwr_device.ino` that the Bluetooth / Wi-Fi code calls |

Pins: see [hardware/wiring/pins.md](../hardware/wiring/pins.md) (proposed — check against the circuit).

## Build and flash (Arduino IDE 2)

1. **Board support:** *Tools → Board → Boards Manager*, install **"esp32" by Espressif Systems, version 2.0.x** (2.0.17 recommended; at least 2.0.3). Version 3.x changed the BLE and I2S APIs and is **not** tested.
2. **Libraries:** *Tools → Manage Libraries*, install
   - **Adafruit GFX Library**
   - **Adafruit ILI9341** (also installs Adafruit BusIO)

   - **PubSubClient** (MQTT, version 2.8 or newer)
   - **WiFiManager** by **tzapu** (version 2.0.x; not the other libraries with a similar name)

   Already included with the ESP32 core (nothing to install): **BLE** (`BLEDevice.h`…), **SD**, **FS**, **SPI**, **`driver/i2s.h`**, **WiFi**, **WiFiClientSecure**, **Preferences**, **mbedTLS** (encryption).

   **Bluetooth only:** set `PWR_USE_WIFI` to `0` in `pwr_config.h`. Then PubSubClient and WiFiManager are not needed.
3. **Board settings:**
   - *Board:* **ESP32 Dev Module**
   - *Partition Scheme:* **Huge APP (3MB No OTA/1MB SPIFFS)** — Bluetooth + Wi-Fi + TLS + SD + graphics do not fit in the default 1.2 MB app partition.
   - *Upload speed:* 921600 (lower to 115200 if uploads fail).
4. Open `firmware/pwr_device/pwr_device.ino`, select the port, click **Upload**.
5. Open the *Serial Monitor* at **115200 baud**: every received (`RX:`) and sent (`TX:`) message is printed, with `(Wi-Fi)` when it went over Wi-Fi (voice-note and planner-copy chunks are not, there are thousands).
6. **Boot self-test:** right after start the Serial Monitor shows `E2E self-test: PASS`. It encrypts `HELLO|3` with the test vector of docs/protocol.md and decrypts it back. `FAIL` means the encryption will not match the app: do not use Wi-Fi until it passes.

## Wi-Fi setup (once per device)

Wi-Fi goes through an MQTT broker on the internet (see [docs/wifi-plan.md](../docs/wifi-plan.md)). Every message is end-to-end encrypted with the pairing code, so the broker only sees scrambled text.

1. **Broker certificate:** paste the broker's CA certificate into `PWR_MQTT_CA_CERT` in `pwr_config.h` (it is public, not a secret). For a first test with a public test broker (demo data only) you can instead set `PWR_MQTT_INSECURE` to `1`: the certificate is then not checked. Without either, the device does not connect and says so on the Serial Monitor.
2. Upload. With no saved Wi-Fi (or no broker / pairing code), the device opens a hotspot **`PWR-Setup`** and the status line shows "Join PWR-Setup".
3. On the iPad or a phone, join `PWR-Setup` (no password). The setup page opens (or go to `http://192.168.4.1`).
4. Pick the home Wi-Fi and type its password. Fill in: broker address (e.g. `abc123.emqxsl.com`, without `mqtts://`), port (`8883`), broker username and password, and the **pairing code** shown in the planner (`ABCD-EFGH-JKLM`). Save.
5. The hotspot closes when the device joins the home Wi-Fi. The Serial Monitor shows `MQTT: online.` and the status line "Connected".
6. **To change anything later:** hold **NEXT + DONE** while switching the device on. The setup page opens again with the saved values (type the home Wi-Fi again too, then Save).

- The hotspot closes by itself after 10 minutes. Bluetooth keeps working the whole time.
- The broker settings and the pairing code are saved on the device (Preferences), never in the code. The repo is public: never put real passwords in `pwr_config.h`.
- The device reconnects by itself (Wi-Fi every 30 s, broker after 2 s, 4 s, 8 s … up to 60 s). It publishes `online` (retained) on `pwr/<id>/status`; the broker publishes `offline` when the device disappears (last will).

**microSD:** format as **FAT32**. The device creates `/notes/` by itself. Without a card everything still works except saving the schedule and recording (the status line shows "No SD card").

## Compile check (Nov 23, 2026)

The firmware **compiles with no errors and no warnings in our code** (`--warnings all`) for both boards:

| Board | Core | Partition | Flash used | RAM (globals) |
|---|---|---|---|---|
| **ESP32-C5** (new board) | 3.3.12 | Huge APP (3 MB) | 1.84 MB (58 %) | 63 KB (19 %) |
| ESP32 Dev Module (classic) | 2.0.17 | Huge APP (3 MB) | 1.88 MB (59 %) | 69 KB (21 %) |

Run it yourself: `tools/compile-firmware.sh c5` (or `classic`); it builds from scratch (`--clean`), so warnings are never hidden by a cached build.

**Wi-Fi relay:** the device trusts the root certificates of the common relays (EMQX, HiveMQ, Let's Encrypt, Amazon), so setting up a relay needs only its host name. Step by step: [docs/wifi-setup.md](../docs/wifi-setup.md). The default 1.2 MB app partition is **too small** (Bluetooth + Wi-Fi + TLS): always choose **Huge APP**.

**Before flashing the C5:** the pins in `pwr_config.h` are the classic ESP32's. The C5 has GPIO 0–28 only (no 32 / 33) and different SPI pins: set the C5 pins from the real wiring (a build message reminds you). Compiling does not test the hardware: the boot self-test (`E2E self-test: PASS`), free memory, Bluetooth + Wi-Fi together and the microphone still need the board.

## How it behaves

- **Day page:** header with the day name ("TODAY" tag when it is today), sections Morning / Afternoon / Evening, pastel cards (green / yellow / red), footer with the number of activities and the next day, status line (connected or not, notes waiting or "No SD card", local time).
- **Buttons:** NEXT shows the next day. DONE stops a reminder, otherwise goes back to today. RECORD: hold to record (max 15 s), release to stop; presses shorter than 0.5 s are ignored. After 2 minutes without a button press the screen goes back to today (`RETURN_TO_TODAY_MS`). The old automatic 10 s day rotation can be turned back on with `AUTO_ROTATE_MS`.
- **Reminders (only once the app has set the clock):** 60 min before Morning (09:00), Afternoon (13:00) or Evening (18:00), if that block has activities today: 3 × 300 ms pulses, repeated every 5 min, at most 3 times, and the screen shows that block with "Coming up" until DONE is pressed.
- **Bluetooth:** the BLE callback only puts the line in a queue; `loop()` does the work and sends the replies (10 ms pause after each notification). A voice note is sent one chunk per `loop()`, so the buttons keep working during a transfer (≈ 25–30 s for a 15 s note).
- **Wi-Fi:** each MQTT message is decrypted and put in the **same queue**, marked "Wi-Fi". The same code handles it, and the reply goes back on the transport the command came from (a voice note or planner copy is sent on the transport that asked for it). Over Wi-Fi there are no `+` pieces and `HELLO` reports a payload of 1024. A message that does not decrypt (wrong pairing code) is ignored and logged.
- **Planner copy (v3):** the app sends its whole planner (`STATE_START`, `S` lines, `STATE_END`). The device writes `/state.tmp`, checks size, every piece and the sum, keeps the old copy as `/state.prev`, then renames to `/state.bin`. A transfer that stops halfway (or 30 s without a line) changes nothing. `STATE_GET` sends it back, one piece per `loop()`. Max 256 KB. The device never reads the content.
- **Schedule sync:** lines go to a temporary list; the schedule is replaced (and saved to `/schedule.txt`) only when `SCHEDULE_END|<count>` matches. If the connection drops, or nothing arrives for 30 s, the old schedule stays.

## Audio format

WAV, **IMA ADPCM** (4 bits per sample, about 4× smaller than plain 16-bit), mono, 8000 Hz, max 15 s (~60 KB), 60-byte header (RIFF + fmt + fact + data), blocks of 256 bytes / 505 samples. The INMP441 gives 32-bit words; the code keeps the top bits with a ×4 gain (`MIC_SHIFT = 14`, lower = louder), clips to 16 bits, then compresses each block while recording. The app unpacks it (`app/js/voice/wav.js`); the same encoder is tested in `app/tests/run.js`.

**Bluetooth packet size:** messages longer than one packet are sent in pieces starting with `+` (see docs/protocol.md). The packet size is read from the connection (`getPeerMTU`) and reported in `HELLO`; voice-note chunks are sized to fit one packet.

## Not tested yet (written without compiling on the real board)

This code has **not been compiled with the ESP32 core nor run on hardware**. Expect small fixes on the first build. In particular, check:

- **It compiles** with ESP32 core 2.0.x, PubSubClient and WiFiManager, and fits in flash (use the Huge APP partition). Also build once with `PWR_USE_WIFI 0`.
- **Memory with Bluetooth + Wi-Fi + TLS together.** This is tight on a classic ESP32. The Serial Monitor prints `Free memory` when the broker connection works. If the TLS connection fails with a memory error, or the board resets, test with `PWR_USE_WIFI 0`, then talk to the team (plan B: Bluetooth only, or Wi-Fi only).
- **Boot self-test** prints `PASS` on the board (mbedTLS on core 2.0.x).
- **Wi-Fi setup page:** the five extra fields are on the Wi-Fi page, values are saved, and the hotspot closes after Save. NEXT + DONE at power-on opens it again.
- **Broker connection:** with the real CA certificate (not only `PWR_MQTT_INSECURE 1`), the retained `online` / `offline` on `pwr/<id>/status`, and reconnecting after the router is switched off and on.
- **Messages both ways with the planner** over Wi-Fi (end-to-end encrypted): HELLO, sync, quiet times, backup, voice notes, planner copy.
- **PubSubClient sends with QoS 0** (it cannot publish with QoS 1). It receives with QoS 1. On a working connection nothing is lost; the app re-asks if a transfer is incomplete.
- **Pauses:** connecting to the broker (TLS) blocks `loop()` for a few seconds; buttons and the screen wait meanwhile. This only happens at start-up and after the connection is lost.
- **Planner copy** of 30 KB and more over Bluetooth and Wi-Fi: speed, no lost `S` lines (the queue holds 48 lines), `/state.prev` kept.
- **BLE packet size:** messages up to 180 bytes need the app (Bluefy / Chrome) to negotiate a bigger MTU. If replies arrive cut at 20 bytes, the MTU exchange did not happen.
- **Voice-note transfer speed and reliability** with 10 ms between chunks (does the iPad drop notifications?). The app re-asks with `NOTE_GET` if the sum is wrong.
- **Microphone:** left/right channel (`MIC_CHANNEL_FORMAT` in `pwr_recorder.cpp`), loudness (`MIC_SHIFT`), any click at the start.
- **SD card and TFT on the same SPI bus** (see the note in `hardware/wiring/pins.md`).
- **Time zone sign:** the device expects `TIME|<unix>|<offset>` with local = UTC + offset (Ottawa summer = `-240`). JavaScript's `getTimezoneOffset()` has the opposite sign, so the app must send `-new Date().getTimezoneOffset()`.
- **Reminder timing** over a full day, and the clock drift of the ESP32 without a sync (a few seconds per day is expected).
- While recording (up to 15 s) Bluetooth and Wi-Fi messages wait in the queue; the app may time out if it talks to the device at that moment.
- **Wi-Fi + Bluetooth together** need Wi-Fi modem sleep (the ESP32 default). Do not add `WiFi.setSleep(false)`: the board would reset.
- Over Wi-Fi a line longer than 200 bytes is ignored (logged). The protocol allows 180, so this should never happen.
