// =====================================================================
//  pwr_wifi.cpp  -  WiFiManager setup page + MQTT over TLS + encryption
// =====================================================================
//  Libraries (Tools -> Manage Libraries):
//    PubSubClient                      MQTT client
//    WiFiManager   (tzapu)             the PWR-Setup hotspot and page
//  Part of the ESP32 core: WiFi, WiFiClientSecure, Preferences, mbedTLS.
//
//  Everything runs in the main task (setup() / loop()). The MQTT
//  callback runs inside mqtt.loop(), called from wifiLoop(); it only
//  decrypts the line and puts it in the protocol queue.
// =====================================================================
#include "pwr_wifi.h"
#include "pwr_config.h"

#if PWR_USE_WIFI

#include <vector>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <esp_wifi.h>

#include "pwr_crypto.h"
#include "pwr_protocol.h"

// Saved on the device (NVS / Preferences), never in the code.
// The home Wi-Fi name + password are saved by WiFiManager itself.
static const char *PREFS_NAMESPACE = "pwr-wifi";

struct WifiSettings {
  char     host[64];
  uint16_t port;
  char     user[64];
  char     pass[64];
  char     code[13];   // 12 characters, upper case, no dashes ("" = not set)
};

static WifiSettings cfg;
static bool    ready = false;    // broker host + valid pairing code known
static char    topicApp[32];     // pwr/<id>/app    app -> device
static char    topicDev[32];     // pwr/<id>/dev    device -> app
static char    topicStatus[32];  // pwr/<id>/status online / offline (retained)
static char    clientId[32];
static uint8_t e2eKey[E2E_KEY_LEN];

static WiFiClientSecure tls;
static PubSubClient mqtt(tls);
static WiFiManager wm;

// Setup page fields (made once, when the page is opened).
static WiFiManagerParameter *pHost = nullptr;
static WiFiManagerParameter *pPort = nullptr;
static WiFiManagerParameter *pUser = nullptr;
static WiFiManagerParameter *pPass = nullptr;
static WiFiManagerParameter *pCode = nullptr;

static bool     portalOpen = false;
static uint32_t portalOpenedMs = 0;
static bool     settingsSaved = false;

static bool     online = false;          // connected to the broker, subscribed
static uint32_t nextMqttTryMs = 0;
static uint32_t mqttBackoffMs = MQTT_RETRY_MIN_MS;
static uint32_t lastWifiTryMs = 0;
static bool     warnedNoCert = false;

// ---------------------------------------------------------------------
//  Settings
// ---------------------------------------------------------------------

// "mqtts://abc.emqxsl.com:8883/" -> "abc.emqxsl.com"
static void cleanHost(const char *in, char *outText, size_t outSize) {
  const char *p = in;
  while (*p == ' ') p++;
  const char *scheme = strstr(p, "://");
  if (scheme != nullptr) p = scheme + 3;
  size_t n = 0;
  while (*p && *p != ' ' && *p != '/' && *p != ':' && n + 1 < outSize) outText[n++] = *p++;
  outText[n] = '\0';
}

static void loadSettings() {
  Preferences prefs;
  prefs.begin(PREFS_NAMESPACE, false);   // false: creates the namespace the first time
  String host = prefs.getString("host", PWR_MQTT_DEFAULT_HOST);
  cfg.port = prefs.getUShort("port", PWR_MQTT_DEFAULT_PORT);
  String user = prefs.getString("user", "");
  String pass = prefs.getString("pass", "");
  String code = prefs.getString("code", "");
  prefs.end();

  strlcpy(cfg.host, host.c_str(), sizeof(cfg.host));
  strlcpy(cfg.user, user.c_str(), sizeof(cfg.user));
  strlcpy(cfg.pass, pass.c_str(), sizeof(cfg.pass));
  if (!pairingCodeNormalize(code.c_str(), cfg.code)) cfg.code[0] = '\0';
  if (cfg.port == 0) cfg.port = PWR_MQTT_DEFAULT_PORT;
}

// Topics, key and broker address from the settings.
static void applySettings() {
  if (online) {
    mqtt.publish(topicStatus, "offline", true);
    mqtt.disconnect();
    online = false;
    protocolTransportLost(SRC_WIFI);
  }
  ready = false;
  if (cfg.code[0] == '\0') {
    Serial.println("Wi-Fi: no pairing code yet (open the PWR-Setup page).");
    return;
  }
  if (cfg.host[0] == '\0') {
    Serial.println("Wi-Fi: no broker address yet (open the PWR-Setup page).");
    return;
  }
  char id[13];
  if (!pairingTopicId(cfg.code, id) || !e2eDeriveKey(cfg.code, e2eKey)) {
    Serial.println("Wi-Fi: could not compute the topic id / key.");
    return;
  }
  snprintf(topicApp, sizeof(topicApp), "pwr/%s/app", id);
  snprintf(topicDev, sizeof(topicDev), "pwr/%s/dev", id);
  snprintf(topicStatus, sizeof(topicStatus), "pwr/%s/status", id);
  snprintf(clientId, sizeof(clientId), "pwr-dev-%s", id);
  mqtt.setServer(cfg.host, cfg.port);   // keeps a pointer to cfg.host (static, fine)
  nextMqttTryMs = 0;
  mqttBackoffMs = MQTT_RETRY_MIN_MS;
  ready = true;
  Serial.printf("Wi-Fi: broker %s:%u, topics pwr/%s/...\n", cfg.host, (unsigned)cfg.port, id);
}

// True if WiFiManager (or an earlier WiFi.begin) saved a home Wi-Fi.
// Needs the Wi-Fi driver started (WiFi.mode).
static bool hasSavedWifi() {
  wifi_config_t conf;
  memset(&conf, 0, sizeof(conf));
  if (esp_wifi_get_config(WIFI_IF_STA, &conf) != ESP_OK) return false;
  return conf.sta.ssid[0] != 0;
}

// ---------------------------------------------------------------------
//  Setup hotspot (WiFiManager, non-blocking: the device keeps working)
// ---------------------------------------------------------------------

// Called by WiFiManager when the setup page is saved.
static void onSettingsSaved() {
  if (pHost == nullptr) return;
  char host[64];
  cleanHost(pHost->getValue(), host, sizeof(host));
  int port = atoi(pPort->getValue());
  if (port <= 0 || port > 65535) port = PWR_MQTT_DEFAULT_PORT;
  char code[13];
  bool codeOk = pairingCodeNormalize(pCode->getValue(), code);

  Preferences prefs;
  prefs.begin(PREFS_NAMESPACE, false);
  prefs.putString("host", host);
  prefs.putUShort("port", (uint16_t)port);
  prefs.putString("user", pUser->getValue());
  prefs.putString("pass", pPass->getValue());
  if (codeOk) prefs.putString("code", code);
  prefs.end();

  if (!codeOk) Serial.println("Wi-Fi setup: pairing code not valid (12 characters like ABCD-EFGH-JKLM); old code kept.");
  Serial.println("Wi-Fi setup: settings saved.");
  settingsSaved = true;
}

static void makeParameters() {
  if (pHost != nullptr) return;
  char portText[8];
  snprintf(portText, sizeof(portText), "%u", (unsigned)cfg.port);
  char codeText[16] = "";
  if (cfg.code[0] != '\0') {
    snprintf(codeText, sizeof(codeText), "%.4s-%.4s-%.4s", cfg.code, cfg.code + 4, cfg.code + 8);
  }
  // The values are copied by WiFiManagerParameter, the labels are not (they are literals).
  pHost = new WiFiManagerParameter("pwr_host", "Broker address (e.g. abc123.emqxsl.com)", cfg.host, 63);
  pPort = new WiFiManagerParameter("pwr_port", "Broker port (MQTT over TLS, usually 8883)", portText, 5);
  pUser = new WiFiManagerParameter("pwr_user", "Broker username", cfg.user, 63);
  pPass = new WiFiManagerParameter("pwr_pass", "Broker password", cfg.pass, 63, "type='password'");
  pCode = new WiFiManagerParameter("pwr_code", "Pairing code (shown in the planner, ABCD-EFGH-JKLM)", codeText, 15);
  wm.addParameter(pHost);
  wm.addParameter(pPort);
  wm.addParameter(pUser);
  wm.addParameter(pPass);
  wm.addParameter(pCode);
}

static void openPortal() {
  makeParameters();
  // Only the Wi-Fi page (the broker fields and the pairing code are on it too).
  // No "update" (firmware upload) on an open hotspot, no "exit": the page closes
  // after a successful save, or after WIFI_SETUP_OPEN_MS.
  static std::vector<const char *> menu = {"wifi"};
  wm.setMenu(menu);
  wm.setSaveParamsCallback(onSettingsSaved);
  wm.setSaveConfigCallback(onSettingsSaved);   // also after "Save" + Wi-Fi connected (harmless twice)
  wm.setConfigPortalBlocking(false);
  wm.startConfigPortal(PWR_SETUP_AP_NAME);     // returns at once in non-blocking mode
  portalOpen = true;
  portalOpenedMs = millis();
  Serial.println("Wi-Fi: setup hotspot \"" PWR_SETUP_AP_NAME "\" is open. Join it, then open http://192.168.4.1");
}

static void closePortal(bool alreadyClosed) {
  if (!alreadyClosed) wm.stopConfigPortal();
  portalOpen = false;
  WiFi.mode(WIFI_STA);
  if (hasSavedWifi()) {
    if (WiFi.status() != WL_CONNECTED) WiFi.begin();   // the saved network
    lastWifiTryMs = millis();
    Serial.println("Wi-Fi: setup closed; using the saved network.");
  } else {
    WiFi.mode(WIFI_OFF);   // nothing to connect to: save power (Bluetooth still works)
    Serial.println("Wi-Fi: setup closed without a network; Wi-Fi off until the next setup.");
  }
}

// ---------------------------------------------------------------------
//  MQTT
// ---------------------------------------------------------------------

// One message from the app: base64 text -> decrypt -> protocol queue.
static void onMqttMessage(char *topic, uint8_t *payload, unsigned int length) {
  if (strcmp(topic, topicApp) != 0) return;
  static uint8_t plain[RX_LINE_BUFFER + 1];
  size_t n = 0;
  if (!e2eOpenText(e2eKey, topicApp, (const char *)payload, length, plain, RX_LINE_BUFFER, n)) {
    Serial.printf("Wi-Fi: a message (%u bytes) did not decrypt (wrong pairing code, too long or not encrypted); ignored.\n",
                  length);
    return;
  }
  protocolQueueLine(SRC_WIFI, (const char *)plain, n);
}

static void markOffline() {
  if (!online) return;
  online = false;
  protocolTransportLost(SRC_WIFI);   // a half-received schedule / planner copy is dropped
}

static bool connectBroker() {
#if !PWR_MQTT_INSECURE
  if (PWR_MQTT_CA_CERT[0] == '\0') {
    if (!warnedNoCert) {
      warnedNoCert = true;
      Serial.println("Wi-Fi: PWR_MQTT_CA_CERT is empty in pwr_config.h, so the device does not connect to the broker.");
      Serial.println("       Paste the broker's CA certificate, or (test broker only) set PWR_MQTT_INSECURE to 1.");
    }
    return false;
  }
#endif
  Serial.printf("MQTT: connecting to %s:%u...\n", cfg.host, (unsigned)cfg.port);
  const char *user = cfg.user[0] ? cfg.user : nullptr;
  const char *pass = (cfg.user[0] && cfg.pass[0]) ? cfg.pass : nullptr;
  // Last will: the broker publishes "offline" (retained) if we vanish without saying goodbye.
  bool ok = mqtt.connect(clientId, user, pass, topicStatus, 1, true, "offline");
  if (!ok) {
    Serial.printf("MQTT: failed (state %d).\n", mqtt.state());
    return false;
  }
  mqtt.subscribe(topicApp, 1);
  mqtt.publish(topicStatus, "online", true);   // retained
  online = true;
  Serial.printf("MQTT: online. Free memory: %u bytes.\n", (unsigned)ESP.getFreeHeap());
  return true;
}

// ---------------------------------------------------------------------
//  Public functions
// ---------------------------------------------------------------------
void wifiBegin(bool openSetup) {
  loadSettings();

#if PWR_MQTT_INSECURE
  tls.setInsecure();
  Serial.println("Wi-Fi: TLS certificate NOT checked (PWR_MQTT_INSECURE = 1). Test broker only.");
#else
  if (PWR_MQTT_CA_CERT[0] != '\0') tls.setCACert(PWR_MQTT_CA_CERT);
#endif
  if (!mqtt.setBufferSize(MQTT_BUFFER_SIZE)) Serial.println("MQTT: not enough memory for the buffer.");
  mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
  mqtt.setSocketTimeout(MQTT_SOCKET_TIMEOUT_S);
  mqtt.setCallback(onMqttMessage);

  applySettings();

  WiFi.mode(WIFI_STA);   // starts the Wi-Fi driver (needed by hasSavedWifi)
  bool saved = hasSavedWifi();
  if (openSetup || !saved || !ready) {
    if (openSetup) Serial.println("Wi-Fi: NEXT + DONE held at power-on: opening the setup page.");
    openPortal();
  } else {
    WiFi.begin();          // the network saved by WiFiManager
    lastWifiTryMs = millis();
    Serial.println("Wi-Fi: connecting to the saved network...");
  }
}

void wifiLoop() {
  if (portalOpen) {
    bool done = wm.process();   // serves the setup page; true = saved and connected
    if (settingsSaved) {
      settingsSaved = false;
      loadSettings();
      applySettings();
    }
    if (done || millis() - portalOpenedMs >= WIFI_SETUP_OPEN_MS) closePortal(done);
    return;                     // no MQTT while the setup page is open
  }
  if (!ready) return;

  if (WiFi.status() != WL_CONNECTED) {
    markOffline();
    // The ESP32 core reconnects by itself; ask again now and then in case it gave up.
    if (WiFi.getMode() != WIFI_OFF && millis() - lastWifiTryMs >= WIFI_RETRY_MS) {
      lastWifiTryMs = millis();
      WiFi.reconnect();
    }
    return;
  }

  if (!mqtt.connected()) {
    markOffline();
    if ((int32_t)(millis() - nextMqttTryMs) < 0) return;   // wait (backoff)
    if (connectBroker()) {
      mqttBackoffMs = MQTT_RETRY_MIN_MS;
    } else {
      nextMqttTryMs = millis() + mqttBackoffMs;
      mqttBackoffMs = mqttBackoffMs * 2;
      if (mqttBackoffMs > MQTT_RETRY_MAX_MS) mqttBackoffMs = MQTT_RETRY_MAX_MS;
    }
    return;
  }

  mqtt.loop();   // receives messages (onMqttMessage) and keeps the connection alive
}

bool wifiIsOnline() {
  return online && mqtt.connected();
}

bool wifiSetupOpen() {
  return portalOpen;
}

int wifiPayload() {
  int p = (int)MQTT_BUFFER_SIZE - 64;
  return p > WIFI_PAYLOAD ? WIFI_PAYLOAD : p;
}

bool wifiSendLine(const char *line, size_t len) {
  if (!online || !mqtt.connected()) return false;
  if (len > (size_t)MAX_MESSAGE_LEN) len = MAX_MESSAGE_LEN;
  static char text[((MAX_MESSAGE_LEN + E2E_OVERHEAD + 2) / 3) * 4 + 1];   // base64 of IV + line + tag
  size_t n = e2eSealToText(e2eKey, topicDev, (const uint8_t *)line, len, text, sizeof(text));
  if (n == 0) return false;
  return mqtt.publish(topicDev, (const uint8_t *)text, (unsigned int)n, false);
}

#else  // PWR_USE_WIFI == 0: Bluetooth only

void wifiBegin(bool) {}
void wifiLoop() {}
bool wifiIsOnline() { return false; }
bool wifiSetupOpen() { return false; }
int  wifiPayload() { return 0; }
bool wifiSendLine(const char *, size_t) { return false; }

#endif
