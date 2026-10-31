# Wi-Fi sync plan (Prototype 2)

> **Team decision (Oct 25):** the planner stays a web app (PWA). The device syncs over **Wi-Fi**, so the iPad can use the planner in plain **Safari** (no Bluefy). **Bluetooth stays as plan B** (it already works with Bluefy and with Chrome/Edge on a laptop).
>
> **Status (Oct 25):** app side done (v0.5.0): `MqttTransport` in `app/js/device-wifi.js`, Wi-Fi setup + pairing code on the Reminder device page, messages in [protocol.md](protocol.md#wi-fi-through-an-mqtt-broker). Tested with a pretend Wi-Fi device on a local broker ([run-and-test.md](run-and-test.md) §6). **Next:** a real broker account, the firmware side, end-to-end encryption.

## Why not a native iPad app
- Apps installed with a free Apple account stop opening after **7 days** and must be reinstalled from a Mac. This is the same for Flutter, Swift, React Native and Capacitor ([Apple](https://developer.apple.com/support/compare-memberships/)).
- TestFlight and the App Store need the Apple Developer Program ($99 USD/year). Still worth asking the TA whether uOttawa has a team we can join.

## Why the iPad can't talk to the ESP32 directly over home Wi-Fi
The planner is served over **HTTPS** (GitHub Pages). Safari and Chrome **block** an HTTPS page from calling a plain `http://192.168.x.x` device ("mixed content"), and the ESP32 cannot get a trusted HTTPS certificate for a local address. So the app and the device need a **meeting point on the internet**: an MQTT broker.

## No new board needed
The current board (**ESP32 Dev Module**, classic ESP32) already has **2.4 GHz Wi-Fi**. Almost every home router broadcasts 2.4 GHz. The ESP32-C5 (5 GHz) would only help if the client's router has 2.4 GHz turned off, and it would force the firmware onto ESP32 core 3.x (new Bluetooth and microphone APIs). → Check the client's router at Client Meet 3 before buying anything.

## How it works

```
iPad (Safari, planner PWA)                       Reminder device (ESP32)
  mqtt.js over secure WebSocket (wss)              PubSubClient over TLS (port 8883)
              \                                     /
               \---->  MQTT broker (cloud)  <------/
                       topics: pwr/<pairId>/to-device
                               pwr/<pairId>/to-app
```

- **Same messages as Bluetooth.** Every line in [protocol.md](protocol.md) (`HELLO`, `TIME`, `SCHEDULE_START` …, `BACKUP_GET`, voice notes) travels unchanged as one MQTT message. In the app this is one new class, `MqttTransport`, next to `BleTransport` and `FakeTransport` in `app/js/device.js`; `DeviceLink`, the rules and the UI don't change. Messages can be up to 180 bytes, or bigger over Wi-Fi (the device says so in `HELLO`).
- **Private:** every message is **encrypted on the iPad and on the device** (AES-GCM) with a key shared once at pairing. The broker only sees scrambled bytes, so the "nothing personal leaves the device in readable form" promise still holds.
- **Pairing (once):** the app makes a random pairing code (pairId + key) and shows it. It goes into the device at setup (see below).
- **Wi-Fi setup on the device (once):** the device opens a setup hotspot `PWR-Setup` (WiFiManager library). The client or a helper joins it from the iPad and types the home Wi-Fi name, password and pairing code. Saved on the device.
- **Battery:** Wi-Fi uses much more power than Bluetooth. The device turns Wi-Fi on only to sync (button "Sync", plus a check every N minutes when at home), then turns it off.
- **Away from home:** no change. Voice notes are saved on the microSD and sent at the next sync.

### Broker (free)
| Option | Free tier | Notes |
|---|---|---|
| **EMQX Serverless** (recommended) | 1 million session minutes + 1 GB traffic per month; spend limit 0 = never billed ([EMQX pricing](https://docs.emqx.com/en/cloud/latest/price/pricing.html)) | TLS + WebSocket. Two clients online all month ≈ 86 400 min, far under the limit |
| HiveMQ Cloud | Free serverless plan no longer listed on the [pricing page](https://www.hivemq.com/pricing/) | Check before using |
| Firebase Realtime Database | Spark plan, 100 connections ([limits](https://firebase.google.com/docs/database/usage/limits)) | Not MQTT; would need a different transport |

A team member creates the broker account (team email, not personal) and puts the broker address in `app/js/config.js` and `firmware/pwr_device/pwr_config.h`. Device/app passwords never go into the public repo.

## Who does what (2 weeks: Oct 26 → Client Meet 3, week of Nov 8)

| Week | Software (app) | Hardware (firmware) | Docs |
|---|---|---|---|
| 1 (reading week) | `MqttTransport` + encryption + pairing screen; test against the demo device and a test broker | Wi-Fi + WiFiManager + PubSubClient on the ESP32, same protocol lines; keep BLE behind a switch in `pwr_config.h` | PD F: design constraints (Apple, browsers, battery, privacy) |
| 2 | End-to-end: iPad Safari ↔ broker ↔ ESP32 (sync, clock, voice note); setup checklist | Reminders (screen + vibration) checked on the real board; battery test | PD F: Prototype 2 tests + results · PD G: economics (3-year income statement, NPV break-even) + 2 intellectual properties · Client Meet 3 slides + questions |

**Go / no-go (end of week 1):** if Wi-Fi sync is not working by Nov 1, Prototype 2 is shown with Bluetooth (Bluefy), which already works, and Wi-Fi moves to Prototype 3.

## Questions for Client Meet 3
- Is your home Wi-Fi on all day? Do you know your Wi-Fi name and password, or who set it up?
- Is it OK if the schedule goes through an online service in encrypted form (nobody can read it)?
- Where will the device charge at night? (It syncs best at home.)
