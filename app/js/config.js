// Shared constants. Change values here, not in the other files.

export const APP_VERSION = '0.4.0';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const PERIODS = ['Morning', 'Afternoon', 'Evening'];

// Energy levels. `load` encodes the client's balance rules (client meeting, PD D):
//   max 5 greens a day · 1 yellow = 2 to 3 greens · 1 red (+ 30 min rest) = 1 to 2 greens.
// With these weights and DAY_LOAD_LIMIT = 5.5:
//   5 greens = 5 (ok), 6 greens = 6 (too much)
//   1 yellow + 3 greens = 5.5 (ok), 1 yellow + 4 greens = 6.5 (too much)
//   1 red + 2 greens = 5.5 (ok), 1 red + 3 greens = 6.5 (too much)
//   1 red + 1 yellow = 6 (too much), 2 reds = 7 (too much)
export const ENERGY = {
  green: { label: 'Easy', shape: '□', load: 1 },
  yellow: { label: 'Moderate', shape: '●', load: 2.5 },
  red: { label: 'High', shape: '◇', load: 3.5 },
};
export const DAY_LOAD_LIMIT = 5.5;

// The reminder device holds at most this many activities (firmware MAX_ACTIVITIES).
export const MAX_DEVICE_ACTIVITIES = 35;

// Voice
export const DEFAULT_SPEECH_MODEL = 'Xenova/whisper-tiny.en';
export const MAX_RECORDING_SECONDS = 20;
