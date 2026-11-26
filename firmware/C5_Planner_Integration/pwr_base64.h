// =====================================================================
//  pwr_base64.h  -  base64 text <-> bytes (standard alphabet, '=' padding)
// =====================================================================
//  Used for voice-note chunks (D lines), planner copy chunks (S lines)
//  and the encrypted Wi-Fi messages (docs/protocol.md).
// =====================================================================
#pragma once

#include <Arduino.h>

// Room needed for the text of len bytes (without the final '\0').
inline size_t base64EncodedLen(size_t len) { return 4 * ((len + 2) / 3); }

// out must have room for base64EncodedLen(len) + 1 characters. Returns the text length.
size_t base64Encode(const uint8_t *in, size_t len, char *out);

// Decodes len characters. Returns the number of bytes written to out,
// or -1 if the text is not valid base64 or does not fit in outMax bytes.
int base64Decode(const char *in, size_t len, uint8_t *out, size_t outMax);
