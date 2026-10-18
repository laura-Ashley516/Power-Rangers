# Decisions

What we decided and why. Status: ✅ decided · 🧪 depends on a test · ⏳ later.

| # | Decision | Why | Status |
|---|---|---|---|
| 1 | The planner is a **web app**, hosted free on GitHub Pages at a URL that never changes | $0, easy to update, works on iPad and laptop with the same code | ✅ |
| 2 | **Offline-first**: app files stored on the client's device, updates applied automatically on the next open | Works without internet, no reinstall | 🧪 T1 (does Bluefy support it?) |
| 3 | On iPad the app runs in **Bluefy**; laptop Chrome is the fallback | Safari and Chrome on iPad have no Web Bluetooth | 🧪 T1 |
| 4 | Voice notes are **recorded on the device away from home** and processed when it syncs at home | The device has no Wi-Fi; notes don't need to be instant | ✅ |
| 5 | **No cloud AI** (no Claude / ChatGPT calls) | The client's voice and schedule are personal health data; no internet or API key needed; $0 | ✅ |
| 6 | Speech → text with **Whisper running locally** in the app; text → action with a **parser matched to the client's activity library** | Private, free, does not depend on the client's iPad model, predictable and testable | 🧪 T2 (speed in Bluefy) |
| 7 | Every change (drag & drop, voice, restore) goes through **one rule check** | Same energy rules for every input | ✅ |
| 8 | The client's schedule is kept in **3 places**: the app, the device's microSD, the weekly printout | Browser data can be erased; the device restores it | ✅ |
| 9 | Change from PD D: **no Python backend**; everything runs in JavaScript in the browser | Matches the first-try code; nothing to host | ✅ |
| 10 | Change from PD D: the "AI suggestions" assistant is **out of scope for now** | Focus on voice → calendar | ✅ |
| 11 | How the client is told about voice changes | — | ⏳ |
| 12 | One integrator reviews and merges pull requests (backup: repo owner) | One person keeps `main` working | ✅ |
| 13 | Energy rules as one "load" score: green 1, yellow 2.5, red 3.5, limit 5.5 per day (see `app/js/config.js`) | Encodes all of the client's balance rules in one number; easy to tune | ✅ first version |
| 14 | Voice changes are applied directly, then shown: banner on the week, "new" marks, change list with Undo, "to sort" list | The client doesn't confirm each change but can see and undo them | ⏳ first version, to validate with the client |
| 15 | The browser's built-in dictation is **not** used | On Apple devices it can send audio to Apple; Whisper keeps it on the device | ✅ |
| 16 | Whisper "tiny" English by default, "base" selectable in Settings | tiny: ~40 MB, fast; base: more accurate, slower | 🧪 T2 |

## Questions for the next client meeting
- Is your home device the iPad or the laptop?
- Do you ever speak French to it, or only English?
- Is it OK to tap an icon that opens the planner, even if it is technically a website?
