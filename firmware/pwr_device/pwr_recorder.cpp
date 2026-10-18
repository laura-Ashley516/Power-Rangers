// =====================================================================
//  pwr_recorder.cpp  -  INMP441 microphone -> WAV file on the microSD
// =====================================================================
//  Audio format (see docs/protocol.md): WAV, IMA ADPCM (format 0x11), mono, 8000 Hz.
//  IMA ADPCM stores each sample in 4 bits instead of 16, so a note is about 4x smaller
//  and 4x faster to send over Bluetooth. The app unpacks it (app/js/voice/wav.js).
//  Layout: blocks of 256 bytes = 4-byte header (first sample + step index) + 252 bytes
//  holding 504 more samples (two 4-bit codes per byte, low half first) = 505 samples.
//
//  The INMP441 sends each sample as a 32-bit word with the 24-bit audio
//  in the top bits. We shift it down to 16 bits (with a small gain, see
//  MIC_SHIFT in pwr_config.h) and clip it to the 16-bit range.
//
//  This uses the "legacy" I2S driver (driver/i2s.h) of ESP32 Arduino
//  core 2.0.x.
// =====================================================================
#include "pwr_recorder.h"
#include "pwr_config.h"
#include "pwr_storage.h"
#include "pwr_display.h"

#include <driver/i2s.h>

static const i2s_port_t MIC_PORT = I2S_NUM_0;

// INMP441 with its L/R pin tied to GND sends on the LEFT channel.
// If recordings are silent, try I2S_CHANNEL_FMT_ONLY_RIGHT here
// (some ESP32 core versions swap left and right).
static const i2s_channel_fmt_t MIC_CHANNEL_FORMAT = I2S_CHANNEL_FMT_ONLY_LEFT;

const int DMA_BUF_COUNT = 8;
const int DMA_BUF_LEN   = 256;          // samples per DMA buffer
const int READ_SAMPLES  = 256;          // samples read per i2s_read() call

static bool micOk = false;
static int32_t rawSamples[READ_SAMPLES];   // 32-bit words from the mic
static int16_t pcmSamples[READ_SAMPLES];   // 16-bit samples before compression

const uint32_t WAV_HEADER_BYTES   = 60;     // RIFF + fmt (20 bytes) + fact + data headers
const uint16_t ADPCM_BLOCK_BYTES  = 256;
const uint16_t ADPCM_BLOCK_SAMPLES = (ADPCM_BLOCK_BYTES - 4) * 2 + 1;   // 505

// ---------------------------------------------------------------------
//  IMA ADPCM encoder (the standard tables; the app uses the same ones)
// ---------------------------------------------------------------------
static const int16_t STEP_TABLE[89] = {
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
};
static const int8_t INDEX_TABLE[8] = { -1, -1, -1, -1, 2, 4, 6, 8 };

static int32_t adpcmPredicted = 0;   // the decoder's idea of the last sample
static int     adpcmIndex = 0;       // position in STEP_TABLE (carries over between blocks)
static int16_t blockSamples[ADPCM_BLOCK_SAMPLES];
static int     blockFill = 0;
static uint8_t blockBytes[ADPCM_BLOCK_BYTES];

// Turn one sample into a 4-bit code, updating the predictor exactly like the decoder will.
static uint8_t adpcmEncodeSample(int16_t sample) {
  int32_t diff = (int32_t)sample - adpcmPredicted;
  uint8_t code = 0;
  if (diff < 0) { code = 8; diff = -diff; }
  int32_t step = STEP_TABLE[adpcmIndex];
  int32_t delta = step >> 3;
  if (diff >= step) { code |= 4; diff -= step; delta += step; }
  step >>= 1;
  if (diff >= step) { code |= 2; diff -= step; delta += step; }
  step >>= 1;
  if (diff >= step) { code |= 1; delta += step; }
  adpcmPredicted += (code & 8) ? -delta : delta;
  if (adpcmPredicted > 32767) adpcmPredicted = 32767;
  if (adpcmPredicted < -32768) adpcmPredicted = -32768;
  adpcmIndex += INDEX_TABLE[code & 7];
  if (adpcmIndex < 0) adpcmIndex = 0;
  if (adpcmIndex > 88) adpcmIndex = 88;
  return code;
}

// Compress the 505 samples in blockSamples (padding with silence) and write 256 bytes.
static bool writeAdpcmBlock(File &f) {
  for (int i = blockFill; i < ADPCM_BLOCK_SAMPLES; i++) blockSamples[i] = 0;
  adpcmPredicted = blockSamples[0];
  blockBytes[0] = blockSamples[0] & 0xFF;
  blockBytes[1] = (blockSamples[0] >> 8) & 0xFF;
  blockBytes[2] = (uint8_t)adpcmIndex;
  blockBytes[3] = 0;
  for (int i = 0; i < ADPCM_BLOCK_BYTES - 4; i++) {
    uint8_t lo = adpcmEncodeSample(blockSamples[1 + 2 * i]);
    uint8_t hi = adpcmEncodeSample(blockSamples[2 + 2 * i]);
    blockBytes[4 + i] = lo | (hi << 4);
  }
  blockFill = 0;
  return f.write(blockBytes, ADPCM_BLOCK_BYTES) == ADPCM_BLOCK_BYTES;
}

// ---------------------------------------------------------------------
//  WAV header helpers (all numbers in a WAV file are little-endian)
// ---------------------------------------------------------------------
static void putU16(uint8_t *p, uint16_t v) {
  p[0] = v & 0xFF;
  p[1] = (v >> 8) & 0xFF;
}

static void putU32(uint8_t *p, uint32_t v) {
  p[0] = v & 0xFF;
  p[1] = (v >> 8) & 0xFF;
  p[2] = (v >> 16) & 0xFF;
  p[3] = (v >> 24) & 0xFF;
}

// Writes the 60-byte IMA ADPCM WAV header at the current position of the file.
static void writeWavHeader(File &f, uint32_t dataBytes, uint32_t totalSamples) {
  uint8_t h[WAV_HEADER_BYTES];
  memcpy(h + 0, "RIFF", 4);
  putU32(h + 4, WAV_HEADER_BYTES - 8 + dataBytes);   // size of everything after these 8 bytes
  memcpy(h + 8, "WAVE", 4);
  memcpy(h + 12, "fmt ", 4);
  putU32(h + 16, 20);                                // size of the fmt section
  putU16(h + 20, 0x11);                              // 0x11 = IMA ADPCM
  putU16(h + 22, 1);                                 // mono
  putU32(h + 24, MIC_SAMPLE_RATE);
  putU32(h + 28, (MIC_SAMPLE_RATE * ADPCM_BLOCK_BYTES) / ADPCM_BLOCK_SAMPLES);   // bytes per second
  putU16(h + 32, ADPCM_BLOCK_BYTES);                 // block size
  putU16(h + 34, 4);                                 // 4 bits per sample
  putU16(h + 36, 2);                                 // 2 extra bytes follow:
  putU16(h + 38, ADPCM_BLOCK_SAMPLES);               //   samples per block
  memcpy(h + 40, "fact", 4);
  putU32(h + 44, 4);
  putU32(h + 48, totalSamples);                      // real number of samples (no padding)
  memcpy(h + 52, "data", 4);
  putU32(h + 56, dataBytes);
  f.write(h, WAV_HEADER_BYTES);
}

// ---------------------------------------------------------------------
//  Microphone
// ---------------------------------------------------------------------
bool recorderBegin() {
  i2s_config_t cfg;
  memset(&cfg, 0, sizeof(cfg));
  cfg.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX);
  cfg.sample_rate = MIC_SAMPLE_RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;   // INMP441 needs 32-bit frames
  cfg.channel_format = MIC_CHANNEL_FORMAT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = 0;                          // default interrupt priority
  cfg.dma_buf_count = DMA_BUF_COUNT;
  cfg.dma_buf_len = DMA_BUF_LEN;
  cfg.use_apll = false;

  esp_err_t err = i2s_driver_install(MIC_PORT, &cfg, 0, NULL);
  if (err != ESP_OK) {
    Serial.printf("Mic: i2s_driver_install failed (%d)\n", (int)err);
    micOk = false;
    return false;
  }

  i2s_pin_config_t pins;
  memset(&pins, 0, sizeof(pins));
  pins.mck_io_num = I2S_PIN_NO_CHANGE;   // no master clock needed
  pins.bck_io_num = PIN_MIC_SCK;
  pins.ws_io_num = PIN_MIC_WS;
  pins.data_out_num = I2S_PIN_NO_CHANGE; // we only receive
  pins.data_in_num = PIN_MIC_SD;

  err = i2s_set_pin(MIC_PORT, &pins);
  if (err != ESP_OK) {
    Serial.printf("Mic: i2s_set_pin failed (%d)\n", (int)err);
    micOk = false;
    return false;
  }

  micOk = true;
  Serial.println("Mic: I2S started.");
  return true;
}

// Throw away audio that piled up in the DMA buffers while we were not
// recording, so the note starts "now" and not a quarter second ago.
static void drainOldAudio() {
  for (int i = 0; i < DMA_BUF_COUNT * 2; i++) {
    size_t bytesRead = 0;
    i2s_read(MIC_PORT, rawSamples, sizeof(rawSamples), &bytesRead, 0);
    if (bytesRead == 0) break;
  }
}

// 32-bit INMP441 word -> 16-bit PCM sample (with gain and clipping).
static int16_t convertSample(int32_t raw) {
  int32_t v = raw >> MIC_SHIFT;
  if (v > 32767) v = 32767;
  if (v < -32768) v = -32768;
  return (int16_t)v;
}

// ---------------------------------------------------------------------
//  Recording
// ---------------------------------------------------------------------
int recorderRecordWhileHeld(DebouncedButton &button, uint32_t unixTime, int &savedId) {
  savedId = -1;

  if (!storageReady()) return RECORD_NO_SD;
  if (!micOk) return RECORD_ERROR;

  int id = -1;
  File f = storageCreateNoteFile(id);
  if (!f) return RECORD_ERROR;

  // Placeholder header: sizes are fixed once we know the length.
  writeWavHeader(f, 0, 0);
  adpcmIndex = 0;
  blockFill = 0;
  uint32_t blocksWritten = 0;

  drainOldAudio();

  const uint32_t maxSamples = (MIC_SAMPLE_RATE * RECORD_MAX_MS) / 1000;
  uint32_t samplesWritten = 0;
  uint32_t startMs = millis();
  uint32_t shownSeconds = 0;
  bool screenShown = false;   // the "Recording..." screen appears after RECORD_MIN_MS,
                              // so a short accidental tap changes nothing on screen
  bool writeError = false;

  while (true) {
    button.update();
    if (!button.isDown()) break;               // released -> stop
    if (samplesWritten >= maxSamples) break;   // 15 s limit

    size_t bytesRead = 0;
    i2s_read(MIC_PORT, rawSamples, sizeof(rawSamples), &bytesRead, pdMS_TO_TICKS(100));
    int count = bytesRead / sizeof(int32_t);
    if (count > 0) {
      if ((uint32_t)count > maxSamples - samplesWritten) count = maxSamples - samplesWritten;
      for (int i = 0; i < count; i++) {
        blockSamples[blockFill++] = convertSample(rawSamples[i]);
        if (blockFill == ADPCM_BLOCK_SAMPLES) {          // a full block: compress and write it
          if (!writeAdpcmBlock(f)) { writeError = true; break; }
          blocksWritten++;
        }
      }
      if (writeError) {
        Serial.println("Mic: SD write failed, stopping.");
        break;
      }
      samplesWritten += count;
    }

    uint32_t elapsedMs = millis() - startMs;
    if (!screenShown && elapsedMs >= RECORD_MIN_MS) {
      displayRecordingStart();   // shows "0s"
      screenShown = true;
    }
    uint32_t seconds = elapsedMs / 1000;
    if (screenShown && seconds != shownSeconds) {
      shownSeconds = seconds;
      displayRecordingSeconds(seconds);
    }
  }

  uint32_t durationMs = millis() - startMs;

  // Wait for the release if we stopped because of the 15 s limit, so the
  // same long press does not start a second recording.
  while (button.isDown()) {
    button.update();
    delay(5);
  }
  button.wasPressed();   // clear any old events
  button.wasReleased();

  // Write the last, partly filled block, then patch the header with the real sizes.
  if (!writeError && blockFill > 0) {
    if (writeAdpcmBlock(f)) blocksWritten++; else writeError = true;
  }
  uint32_t dataBytes = blocksWritten * ADPCM_BLOCK_BYTES;
  f.seek(0);
  writeWavHeader(f, dataBytes, samplesWritten);
  f.close();

  if (writeError) {
    storageDiscardNote(id);
    return RECORD_ERROR;
  }
  if (durationMs < RECORD_MIN_MS) {
    storageDiscardNote(id);
    Serial.println("Mic: press too short, note discarded.");
    return RECORD_TOO_SHORT;
  }

  storageCommitNote(id, unixTime);
  savedId = id;
  Serial.printf("Mic: note %d saved, %lu bytes of audio, %lu ms\n",
                id, (unsigned long)dataBytes, (unsigned long)durationMs);
  return RECORD_SAVED;
}
