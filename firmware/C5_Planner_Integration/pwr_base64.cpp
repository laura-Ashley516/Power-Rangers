// =====================================================================
//  pwr_base64.cpp  -  our own small base64 encoder and decoder
// =====================================================================
#include "pwr_base64.h"

static const char BASE64_TABLE[] =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

size_t base64Encode(const uint8_t *in, size_t len, char *out) {
  size_t o = 0;
  size_t i = 0;
  // Every 3 input bytes (24 bits) become 4 characters of 6 bits each.
  while (i + 3 <= len) {
    uint32_t v = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8) | in[i + 2];
    out[o++] = BASE64_TABLE[(v >> 18) & 0x3F];
    out[o++] = BASE64_TABLE[(v >> 12) & 0x3F];
    out[o++] = BASE64_TABLE[(v >> 6) & 0x3F];
    out[o++] = BASE64_TABLE[v & 0x3F];
    i += 3;
  }
  size_t rest = len - i;
  if (rest == 1) {
    uint32_t v = (uint32_t)in[i] << 16;
    out[o++] = BASE64_TABLE[(v >> 18) & 0x3F];
    out[o++] = BASE64_TABLE[(v >> 12) & 0x3F];
    out[o++] = '=';
    out[o++] = '=';
  } else if (rest == 2) {
    uint32_t v = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8);
    out[o++] = BASE64_TABLE[(v >> 18) & 0x3F];
    out[o++] = BASE64_TABLE[(v >> 12) & 0x3F];
    out[o++] = BASE64_TABLE[(v >> 6) & 0x3F];
    out[o++] = '=';
  }
  out[o] = '\0';
  return o;
}

// One character -> its 6-bit value, or -1.
static int base64Value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

int base64Decode(const char *in, size_t len, uint8_t *out, size_t outMax) {
  if (len % 4 != 0) return -1;   // the app always pads with '='
  size_t o = 0;
  for (size_t i = 0; i < len; i += 4) {
    bool last = (i + 4 == len);
    int a = base64Value(in[i]);
    int b = base64Value(in[i + 1]);
    if (a < 0 || b < 0) return -1;
    // '=' is only allowed at the very end: "xx==" or "xxx=".
    bool pad2 = last && in[i + 2] == '=' && in[i + 3] == '=';
    bool pad1 = last && !pad2 && in[i + 3] == '=';
    int c = pad2 ? 0 : base64Value(in[i + 2]);
    int d = (pad1 || pad2) ? 0 : base64Value(in[i + 3]);
    if (c < 0 || d < 0) return -1;
    uint32_t v = ((uint32_t)a << 18) | ((uint32_t)b << 12) | ((uint32_t)c << 6) | (uint32_t)d;
    size_t n = pad2 ? 1 : (pad1 ? 2 : 3);
    if (o + n > outMax) return -1;
    out[o++] = (uint8_t)(v >> 16);
    if (n > 1) out[o++] = (uint8_t)(v >> 8);
    if (n > 2) out[o++] = (uint8_t)v;
  }
  return (int)o;
}
