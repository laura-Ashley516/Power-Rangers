// =====================================================================
//  pwr_crypto.h  -  pairing code, topic id and end-to-end encryption
// =====================================================================
//  docs/protocol.md, "Privacy (v3, Nov 2026): end-to-end encryption":
//    <id>  = SHA-256(12 code characters), first 6 bytes as lower-case hex
//    key   = SHA-256("pwr-e2e-key|" + 12 code characters), AES-256-GCM
//    sealed bytes = 12-byte random IV | ciphertext | 16-byte tag
//    MQTT payload = the sealed bytes as base64 text ('=' padding)
//    additional authenticated data = the topic name
//  Uses mbedTLS, which is part of the ESP32 core (nothing to install).
// =====================================================================
#pragma once

#include <Arduino.h>

const size_t E2E_KEY_LEN  = 32;
const size_t E2E_IV_LEN   = 12;
const size_t E2E_TAG_LEN  = 16;
const size_t E2E_OVERHEAD = E2E_IV_LEN + E2E_TAG_LEN;   // 28 bytes around the line

// "abcd-efgh-jklm" -> "ABCDEFGHJKLM" (out needs 13 chars).
// Returns false if it is not 12 characters of ABCDEFGHJKLMNPQRSTUVWXYZ23456789.
bool pairingCodeNormalize(const char *in, char *out13);

// Topic id: "3f63d25fcb89" for "ABCDEFGHJKLM" (out needs 13 chars).
bool pairingTopicId(const char *code12, char *out13);

// Encryption key from the 12 code characters.
bool e2eDeriveKey(const char *code12, uint8_t *key32);

// Encrypt one line and write the MQTT payload (base64 text + '\0') into outText.
// fixedIv = nullptr for a random IV (always, except in the self-test).
// Returns the text length, or 0 on error (outText too small...).
size_t e2eSealToText(const uint8_t *key32, const char *topic,
                     const uint8_t *plain, size_t len,
                     char *outText, size_t outMax,
                     const uint8_t *fixedIv = nullptr);

// Decode + decrypt one MQTT payload. Returns false if it is not valid base64,
// too short, too long for plainMax, or does not authenticate (wrong key/topic).
bool e2eOpenText(const uint8_t *key32, const char *topic,
                 const char *text, size_t textLen,
                 uint8_t *plainOut, size_t plainMax, size_t &plainLen);

// Checks the test vector of docs/protocol.md. Prints PASS / FAIL on Serial.
bool e2eSelfTest();
