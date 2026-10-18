# ESP32 pin assignments

> **Status: PROPOSED — check against the circuit before wiring.**
> These are the values in `firmware/pwr_device/pwr_config.h`. If the circuit uses different pins, change them **there** (one place) and update this table in the same pull request.

Board: ESP32 DevKit (ESP32-WROOM-32, Arduino board "ESP32 Dev Module"). All signals are 3.3 V.

## Pin table

| Part | Signal | ESP32 GPIO | Notes |
|---|---|---|---|
| ILI9341 TFT | SCK | 18 | Hardware SPI (VSPI), shared with microSD |
| ILI9341 TFT | MOSI (SDI) | 23 | Shared with microSD |
| ILI9341 TFT | MISO (SDO) | 19 | Shared with microSD (the TFT does not really need it) |
| ILI9341 TFT | CS | 5 | Same as the first-try sketch |
| ILI9341 TFT | DC | 2 | Same as the first-try sketch. GPIO 2 is a boot strapping pin (and the on-board LED on many boards) — it works, but it must not be pulled HIGH by the circuit at boot |
| ILI9341 TFT | RST | 4 | Same as the first-try sketch |
| ILI9341 TFT | LED (backlight) | 3.3 V | Through the module's resistor. A PWM pin could dim it later (light sensitivity) |
| microSD | CS | 21 | Separate chip select on the same SPI bus |
| microSD | SCK / MOSI / MISO | 18 / 23 / 19 | Shared with the TFT |
| INMP441 mic | SCK (BCLK) | 26 | I2S bit clock |
| INMP441 mic | WS (LRCL) | 25 | I2S word select |
| INMP441 mic | SD (data out) | 33 | Input only on the ESP32 side |
| INMP441 mic | L/R | GND | Selects the left channel (the code reads the left channel) |
| INMP441 mic | VDD / GND | 3.3 V / GND | Not 5 V |
| RECORD button | — | 32 | To GND, internal pull-up, pressed = LOW. Hold to record (max 15 s) |
| NEXT button | — | 27 | To GND, internal pull-up, pressed = LOW. Shows the next day |
| DONE button | — | 14 | To GND, internal pull-up, pressed = LOW. Stops the reminder / back to today. GPIO 14 toggles briefly at boot: harmless for a button to GND |
| Vibration motor | transistor base/gate | 13 | **Never drive the motor directly from the pin.** Use an NPN transistor (e.g. 2N2222 + ~1 kΩ base resistor) or a logic-level N-MOSFET, a flyback diode (1N4148) across the motor, and a 10 kΩ pull-down on the base/gate so it stays off during boot |

## Pins to avoid

- GPIO 6–11: connected to the flash chip.
- GPIO 0, 12, 15: boot strapping pins (GPIO 12 HIGH at boot breaks booting).
- GPIO 34–39: input only, no internal pull-up (fine for the mic data line, not for buttons without external resistors).
- GPIO 1 / 3: USB serial (used for uploading and the Serial monitor).

## Things to check on the real hardware

- **Shared SPI bus:** some ILI9341 boards with an SD slot do not release MISO when the SD card is not selected. If the SD card is not detected while the screen is connected, test the SD card alone first.
- **Mic channel:** if recordings are silent, the L/R pin and the code must agree. Try `I2S_CHANNEL_FMT_ONLY_RIGHT` in `pwr_recorder.cpp` (some ESP32 core versions swap left/right).
- **Motor current:** measure it; a coin vibration motor is usually 60–100 mA at 3 V, too much for a GPIO pin (max ~20 mA safe).
