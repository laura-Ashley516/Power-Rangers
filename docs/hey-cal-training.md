# "Hey Cal": how it works and how to train the real word (Nov 2026)

## What is done (planner v0.10.2)
- Settings → Voice understanding → **Listen for "Hey Cal"** (off until turned on). Say the word and the voice-note window opens and starts recording; it stops by itself after 4 s of silence, then she confirms with one tap.
- Runs **on the iPad** with [openWakeWord](https://github.com/dscripka/openWakeWord) (free, open source) through onnxruntime-web 1.20.1. **Nothing is sent online** (after the first download, it works offline).
- Listens **only while the planner is open and on screen** (iPadOS stops the microphone otherwise). A small label at the top says "Listening for …"; tapping it turns listening off. It pauses while any window is open.
- Until "Hey Cal" is trained, it listens for the free test word **"Hey Jarvis"**, and says so.
- Checked: "Hey Jarvis" scores 0.999 (detected), an ordinary sentence scores 0.000; about 3 ms of work per 80 ms of sound on a laptop browser.
- The reminder device (ESP32-WROOM) does **not** listen for the word: its chip is too small. Its record button stays.

## Train the real "Hey Cal" model (free, about 1 hour, no coding)
1. Open openWakeWord's free training notebook on Google Colab (link in their README, "Training New Models"): https://colab.research.google.com/drive/1q1oe2zOyZp7UsB3jJiQ1IFn8z5YfjwEb?usp=sharing . You need a Google account (free).
2. Top menu: **Runtime → Change runtime type → T4 GPU** (free) → Save.
3. In the first form, set the target phrase to **`hey cal`**. If it offers a spelling field, also try `hey kal` (it helps the computer voices say it the way we do).
4. **Runtime → Run all.** It makes thousands of computer voices saying "hey cal", mixes in noise and other speech, and trains the small model (about 45–60 minutes). Keep the tab open.
5. At the end it downloads a file such as **`hey_cal.onnx`** (about 200 KB). If it gives `.tflite` only, run the cell that exports ONNX.
6. Send the file to the team (not public). In the repo, put it in `app/models/wake/` and change `app/models/wake/word.json` to:
   ```json
   { "file": "hey_cal.onnx", "label": "Hey Cal", "test": false }
   ```
7. Test before publishing: record 10–20 people saying "Hey Cal" (quiet room and TV on) and 10 minutes of normal talk. It should catch most "Hey Cal"s and almost never go off by itself. If it goes off too often, raise the threshold (`threshold` in `app/js/voice/wakeword-core.js`, 0.5 → 0.6); if it misses, lower it (0.4).

**French:** openWakeWord's training voices are English only. "Hey Cal" is a name, so French speakers say almost the same thing ("Hé Cal"); one model for both is the simplest. Test it with French speakers in step 7.

## Licences
- openWakeWord code: Apache 2.0. The shared models (`melspectrogram.onnx`, `embedding_model.onnx`) come from its release v0.5.1.
- The ready-made test word "Hey Jarvis" is licensed **CC BY-NC-SA 4.0** (non-commercial): fine for this student project; replace it with our own "Hey Cal" before any commercial use.
- A model we train ourselves is ours.
- onnxruntime-web: MIT.
