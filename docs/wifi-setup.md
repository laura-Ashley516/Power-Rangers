# Wi-Fi relay: setup guide (Nov 2026)

One person, about 15 minutes, done once. After this the planner and the reminder device talk over Wi-Fi by themselves: the planner's automatic copy on the device, voice notes picked up without pressing Sync, and Sync from plain Safari (no Bluefy).

## What the relay is, and what it can see

The iPad and the device cannot talk directly over home Wi-Fi (Safari blocks it), so both connect to a **relay** on the internet (an MQTT broker) and leave messages for each other there.

| | |
|---|---|
| **What travels** | Her week, voice notes, the planner copy, all **end-to-end encrypted** on the iPad and on the device (AES-256-GCM, key made from the pairing code). The relay never has the pairing code. |
| **What the relay can see** | That a planner and a device are connected, when, and how much data passes. A random-looking topic id. Not one word of her week or her voice. |
| **What protects it** | TLS to the relay (the device checks the relay's certificate), a username and password per side, and the end-to-end encryption. A message not sealed with the pairing code is ignored. |
| **The secret** | The **pairing code** (12 letters, e.g. `ABCD-EFGH-JKLM`) is the key. Keep it on a card with the device, never in the repo, chat or email. |
| **Cost** | Free tier, spending limit set to **$0** (never billed). |
| **Honest wording** | "Nothing readable is sent online": encrypted data does pass through the relay. |

## Which relay: EMQX Serverless (recommended)

| Option | Private account | Free | Notes |
|---|---|---|---|
| **EMQX Serverless** | Yes | 1 M session-minutes + 1 GB / month, spend limit 0 | TLS only, username/password required. Two clients online all month ≈ 86 400 min: far under the limit |
| HiveMQ Cloud (Serverless) | Yes | Free plan (check the pricing page) | Same steps; WebSocket port is usually 8884: type `host:8884` in the planner |
| `broker.emqx.io` (public test broker) | No | Yes | Quick tests only: no password, anyone can post to it (our messages stay encrypted, but it has no guarantee of service) |

The device already trusts the root certificates of EMQX (DigiCert), HiveMQ and any Let's Encrypt relay (ISRG), and Amazon: **no certificate step is needed** (`firmware/pwr_device/pwr_config.h`).

## Steps

### 1. Create the relay (team account)
1. Sign up on EMQX Cloud with the **team email** (not a personal one).
2. Create a **Serverless** deployment (any region close to Ottawa, e.g. US East). Set the **spending limit to $0**.
3. In the deployment's overview, note the **address** (host, like `abc123.ala.us-east-1.emqxsl.com`) and the ports: **8883** (MQTT over TLS, for the device) and **8084** (WebSocket over TLS, for the planner).
4. In authentication / access control, add **two users**: `pwr-app` and `pwr-device`, each with its own long password (keep them in a password manager, never in the repo or chat).

### 2. The planner (on her iPad, with a helper)
1. Reminder device → "How the planner reaches the device" → **Wi-Fi**.
2. **Relay address:** the host from step 1.3 (just the host; the planner adds `wss://…:8084/mqtt`).
3. **Relay username / password:** `pwr-app` and its password.
4. **New code** → write the pairing code on a card kept with the device. **Save Wi-Fi setup**, then **Test the connection** ("Relay reached…").

### 3. The device (once)
1. Switch it on. The first time (or holding **NEXT + DONE** while switching on) it opens a Wi-Fi network called **PWR-Setup**; the status line says "Join PWR-Setup".
2. On the iPad, join **PWR-Setup**; the setup page opens.
3. Choose her **home Wi-Fi** and type its password. Then: **broker host** = the same host, **port** 8883, **username** `pwr-device` + its password, **pairing code** = the code from the card. Save.
4. The device joins her Wi-Fi and the relay; the status line shows connected. On the Serial Monitor (team only): `E2E self-test: PASS`.

### 4. Check
1. In the planner, **Sync now**: "Synced at …". The top bar shows **"Copy on the device · <time>"**.
2. Record a voice note on the device; within a few minutes (planner open) the week shows "1 change is waiting for your OK".

## If something goes wrong
- "The broker refused the username or password": retype them (planner: `pwr-app`; device: `pwr-device`).
- "No answer from the broker": check the host, and that the iPad has internet.
- Device not connecting: Serial Monitor shows why (Wi-Fi password, host, certificate). A relay signed by a root not in the list: add its root certificate to `PWR_MQTT_CA_CERT` in `pwr_config.h`.
- Lost pairing code: make a **New code** in the planner and enter it again on the device (PWR-Setup). Nothing is lost: the planner copy is re-sent at the next Sync.
