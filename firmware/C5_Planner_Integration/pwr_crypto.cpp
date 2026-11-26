// =====================================================================
//  pwr_crypto.cpp  -  SHA-256 + AES-256-GCM with mbedTLS (ESP32 core)
// =====================================================================
//  Only called from the main task (setup() / loop()).
// =====================================================================
#include "pwr_crypto.h"
#include "pwr_base64.h"

#include "mbedtls/gcm.h"
#include "mbedtls/md.h"

// esp_fill_random(): in esp_system.h on core 2.0.x (ESP-IDF 4.4), in esp_random.h on newer cores.
#if __has_include("esp_random.h")
#include "esp_random.h"
#endif
#include "esp_system.h"

static const char CODE_LETTERS[] = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no 0/O, 1/I

// Longest line we ever encrypt or decrypt (lines are at most 180 bytes, see pwr_config.h).
static const size_t E2E_MAX_LINE = 256;

static bool sha256(const uint8_t *in, size_t len, uint8_t *out32) {
  const mbedtls_md_info_t *info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (info == nullptr) return false;
  return mbedtls_md(info, in, len, out32) == 0;
}

bool pairingCodeNormalize(const char *in, char *out13) {
  size_t n = 0;
  out13[0] = '\0';
  if (in == nullptr) return false;
  for (const char *p = in; *p; p++) {
    char c = *p;
    if (c >= 'a' && c <= 'z') c = c - 'a' + 'A';
    bool letterOrDigit = (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    if (!letterOrDigit) continue;            // dashes, spaces... are ignored (like the app)
    if (strchr(CODE_LETTERS, c) == nullptr) return false;
    if (n >= 12) return false;               // too long
    out13[n++] = c;
  }
  out13[n] = '\0';
  return n == 12;
}

bool pairingTopicId(const char *code12, char *out13) {
  uint8_t hash[32];
  if (!sha256((const uint8_t *)code12, strlen(code12), hash)) return false;
  for (int i = 0; i < 6; i++) snprintf(out13 + 2 * i, 3, "%02x", hash[i]);
  out13[12] = '\0';
  return true;
}

bool e2eDeriveKey(const char *code12, uint8_t *key32) {
  char text[40];
  int n = snprintf(text, sizeof(text), "pwr-e2e-key|%s", code12);
  if (n <= 0 || n >= (int)sizeof(text)) return false;
  return sha256((const uint8_t *)text, (size_t)n, key32);
}

size_t e2eSealToText(const uint8_t *key32, const char *topic,
                     const uint8_t *plain, size_t len,
                     char *outText, size_t outMax,
                     const uint8_t *fixedIv) {
  static uint8_t sealed[E2E_MAX_LINE + E2E_OVERHEAD];
  if (len > E2E_MAX_LINE) return 0;
  size_t sealedLen = len + E2E_OVERHEAD;
  if (outMax < base64EncodedLen(sealedLen) + 1) return 0;

  uint8_t *iv = sealed;
  uint8_t *cipher = sealed + E2E_IV_LEN;
  uint8_t *tag = sealed + E2E_IV_LEN + len;
  if (fixedIv != nullptr) memcpy(iv, fixedIv, E2E_IV_LEN);
  else esp_fill_random(iv, E2E_IV_LEN);   // true random while Wi-Fi or Bluetooth is on

  mbedtls_gcm_context ctx;
  mbedtls_gcm_init(&ctx);
  int rc = mbedtls_gcm_setkey(&ctx, MBEDTLS_CIPHER_ID_AES, key32, 256);
  if (rc == 0) {
    rc = mbedtls_gcm_crypt_and_tag(&ctx, MBEDTLS_GCM_ENCRYPT, len,
                                   iv, E2E_IV_LEN,
                                   (const unsigned char *)topic, strlen(topic),
                                   plain, cipher,
                                   E2E_TAG_LEN, tag);
  }
  mbedtls_gcm_free(&ctx);
  if (rc != 0) return 0;
  return base64Encode(sealed, sealedLen, outText);
}

bool e2eOpenText(const uint8_t *key32, const char *topic,
                 const char *text, size_t textLen,
                 uint8_t *plainOut, size_t plainMax, size_t &plainLen) {
  static uint8_t sealed[E2E_MAX_LINE + E2E_OVERHEAD];
  plainLen = 0;
  int n = base64Decode(text, textLen, sealed, sizeof(sealed));
  if (n < (int)E2E_OVERHEAD) return false;
  size_t len = (size_t)n - E2E_OVERHEAD;
  if (len > plainMax) return false;

  mbedtls_gcm_context ctx;
  mbedtls_gcm_init(&ctx);
  int rc = mbedtls_gcm_setkey(&ctx, MBEDTLS_CIPHER_ID_AES, key32, 256);
  if (rc == 0) {
    rc = mbedtls_gcm_auth_decrypt(&ctx, len,
                                  sealed, E2E_IV_LEN,
                                  (const unsigned char *)topic, strlen(topic),
                                  sealed + E2E_IV_LEN + len, E2E_TAG_LEN,
                                  sealed + E2E_IV_LEN, plainOut);
  }
  mbedtls_gcm_free(&ctx);
  if (rc != 0) return false;   // MBEDTLS_ERR_GCM_AUTH_FAILED: wrong key, wrong topic or changed bytes
  plainLen = len;
  return true;
}

// ---------------------------------------------------------------------
//  Self-test with the test vector of docs/protocol.md:
//    code ABCD-EFGH-JKLM -> <id> 3f63d25fcb89
//    key  37fa3af32f5084438220beda2088be4565ebbef889252d743fc88230aae0d7d3
//    line "HELLO|3", topic "pwr/3f63d25fcb89/app", IV 000102030405060708090a0b
//    sealed bytes 000102030405060708090a0bd4a8a89d03e6dbbb11c7f9bdaa3631bbcd8985ab3d43c9
//    MQTT payload AAECAwQFBgcICQoL1KionQPm27sRx/m9qjYxu82Jhas9Q8k=
// ---------------------------------------------------------------------
bool e2eSelfTest() {
  static const uint8_t EXPECTED_KEY[32] = {
    0x37, 0xfa, 0x3a, 0xf3, 0x2f, 0x50, 0x84, 0x43, 0x82, 0x20, 0xbe, 0xda, 0x20, 0x88, 0xbe, 0x45,
    0x65, 0xeb, 0xbe, 0xf8, 0x89, 0x25, 0x2d, 0x74, 0x3f, 0xc8, 0x82, 0x30, 0xaa, 0xe0, 0xd7, 0xd3
  };
  static const uint8_t TEST_IV[12] = {
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b
  };
  const char *expectedPayload = "AAECAwQFBgcICQoL1KionQPm27sRx/m9qjYxu82Jhas9Q8k=";
  const char *topic = "pwr/3f63d25fcb89/app";
  const char *line = "HELLO|3";

  bool ok = true;
  char code[13];
  char id[13];
  uint8_t key[32];

  if (!pairingCodeNormalize("ABCD-EFGH-JKLM", code) || strcmp(code, "ABCDEFGHJKLM") != 0) {
    Serial.println("E2E self-test: pairing code check failed.");
    ok = false;
  }
  if (!pairingTopicId("ABCDEFGHJKLM", id) || strcmp(id, "3f63d25fcb89") != 0) {
    Serial.println("E2E self-test: topic id check failed.");
    ok = false;
  }
  if (!e2eDeriveKey("ABCDEFGHJKLM", key) || memcmp(key, EXPECTED_KEY, 32) != 0) {
    Serial.println("E2E self-test: key check failed.");
    ok = false;
  }

  char payload[80];
  size_t n = e2eSealToText(EXPECTED_KEY, topic, (const uint8_t *)line, strlen(line),
                           payload, sizeof(payload), TEST_IV);
  if (n == 0 || strcmp(payload, expectedPayload) != 0) {
    Serial.printf("E2E self-test: encrypt gave \"%s\".\n", n ? payload : "(error)");
    ok = false;
  }

  uint8_t plain[16];
  size_t plainLen = 0;
  bool opened = e2eOpenText(EXPECTED_KEY, topic, expectedPayload, strlen(expectedPayload),
                            plain, sizeof(plain), plainLen);
  if (!opened || plainLen != strlen(line) || memcmp(plain, line, plainLen) != 0) {
    Serial.println("E2E self-test: decrypt check failed.");
    ok = false;
  }

  // The same payload on the OTHER topic must be refused (AAD = topic).
  if (e2eOpenText(EXPECTED_KEY, "pwr/3f63d25fcb89/dev", expectedPayload, strlen(expectedPayload),
                  plain, sizeof(plain), plainLen)) {
    Serial.println("E2E self-test: a message on the wrong topic was accepted.");
    ok = false;
  }

  Serial.println(ok ? "E2E self-test: PASS" : "E2E self-test: FAIL");
  return ok;
}
