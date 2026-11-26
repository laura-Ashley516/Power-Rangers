# ESP32-C5-340X planner

Open C5_Planner_Integration.ino in Arduino IDE. Select ESP32C5 Dev Module, Arduino-ESP32 3.3.12, 4 MB flash, and Huge APP. Keep flash erase disabled to retain LittleFS and touch calibration. Install WiFiManager, PubSubClient, GFX Library for Arduino, Adafruit GFX, and XPT2046_Touchscreen.

Copy pwr_local.example.h to pwr_local.h and enter the MQTT host and planner pairing code locally. Git ignores that file. The sketch uses TLS and the public CA in pwr_config.h. Configure Wi-Fi through the setup portal and select Wi-Fi in the planner. The C5 supports schedule sync and batched voice notes. Full planner backups require protocol v3.

| Peripheral | C5 GPIO |
|---|---|
| Display SCK and touch T_CLK | 6 |
| Display MOSI and touch T_DIN | 5 |
| Display CS | 10 |
| Display DC | 4 |
| Display RESET | 8 |
| Touch T_CS | 9 |
| Touch T_DO | 23 |
| Microphone BCLK, WS, and SD | 0, 1, and 24 |

Leave display SDO and touch IRQ disconnected. Use a common ground and the display module's rated supply. Tap to start touch calibration or send C in Serial Monitor at 115200 baud. The device saves calibration across restarts.
