// Shared constants. Change values here, not in the other files.

export const APP_VERSION = '0.10.0';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const PERIODS = ['Morning', 'Afternoon', 'Evening'];

// When each block starts and ends (24 h clock). Same start times as the reminder device
// (firmware pwr_config.h: 09:00 / 13:00 / 18:00), so "now" means the same thing on both.
export const PERIOD_TIMES = {
  Morning: { start: 9, end: 13, icon: '☀', label: '9 am – 1 pm' },
  Afternoon: { start: 13, end: 18, icon: '◐', label: '1 pm – 6 pm' },
  Evening: { start: 18, end: 22, icon: '☾', label: '6 pm – 10 pm' },
};

// Energy levels. `load` encodes the client's balance rules (client meeting, PD D):
//   max 5 greens a day · 1 yellow = 2 to 3 greens · 1 red (+ 30 min rest) = 1 to 2 greens.
// With these weights and DAY_LOAD_LIMIT = 5.5:
//   5 greens = 5 (ok), 6 greens = 6 (too much)
//   1 yellow + 3 greens = 5.5 (ok), 1 yellow + 4 greens = 6.5 (too much)
//   1 red + 2 greens = 5.5 (ok), 1 red + 3 greens = 6.5 (too much)
//   1 red + 1 yellow = 6 (too much), 2 reds = 7 (too much)
// Rest blocks cost nothing (load 0). They are sent to the device as "green" so older firmware shows them.
// Shapes (client feedback, Nov 2026): the more points a shape has, the more energy it takes.
//   circle (no points) = Easy · triangle (3 points) = Moderate · star (5 points) = High · pause sign = Rest.
// The star is solid black so a High activity stands out on screen and on paper (TA idea, client email Nov 21).
// `shape` is the text version (lists, select menus); ui-kit.shape() draws the same shapes as small pictures.
export const ENERGY = {
  green: { label: 'Easy', shape: '●', load: 1 },
  yellow: { label: 'Moderate', shape: '▲', load: 2.5 },
  red: { label: 'High', shape: '★', load: 3.5 },
  rest: { label: 'Rest', shape: '‖', load: 0 },
};
export const DAY_LOAD_LIMIT = 5.5;
export const REST_AFTER_RED_MIN = 30; // the client's rule: a red activity needs 30 minutes of rest

// The reminder device holds at most this many activities (firmware MAX_ACTIVITIES).
export const MAX_DEVICE_ACTIVITIES = 35;

// Voice
// The more accurate model (team decision, Nov 2026): slower and ~80 MB, downloaded once.
export const DEFAULT_SPEECH_MODEL = 'Xenova/whisper-base.en';
// Same longest note as the reminder device (firmware RECORD_MAX_MS = 15 s): team decision, Nov 2026.
export const MAX_RECORDING_SECONDS = 15;
// The recording stops by itself after this much silence once she has started speaking (client feedback, Nov 16).
// 4 s, not 2: people with a brain injury often pause mid-sentence to find a word (team decision, Nov 2026).
export const SILENCE_STOP_SECONDS = 4;

// Optional clock time of an activity ("10:30"): the time of day (Morning…) follows from it.
export function periodOfTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2]) / 60;
  return h < PERIOD_TIMES.Morning.end ? 'Morning' : h < PERIOD_TIMES.Afternoon.end ? 'Afternoon' : 'Evening';
}
