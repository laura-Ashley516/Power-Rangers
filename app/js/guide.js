// The one-page guide (Help screen and printable). Research: about 1 in 3 people needed more than one
// training session with a new memory aid, and a printed quick guide helps (Ramirez-Hernandez 2022).
// Keep it short: 8 steps, plain words. (v0.10: One day, shapes, photo, French.)
//
// Track: A - Interface

import { $, esc } from './ui-kit.js';
import { t } from './i18n.js';

export const guideSteps = () => [
  { title: t('Your week.'), text: t('The planner opens on your week. Each day is a column; Morning, Afternoon and Evening are the rows. The bar under each day fills as the day gets busy: green, then yellow, then red.') },
  { title: t('One day.'), text: t('At the bottom of the week, “One day” shows one day simply, with a picture for each activity. On today, “Now” shows what is happening now. Tap a day in the strip to see another day.') },
  { title: t('Add an activity.'), text: t('Press “New activity”, or drag one of “My activities” into a day (with a finger: press for a moment, then move). Or tap it, then tap the day. You can add a time (for example 10:30). Activities you add are for that week only; to repeat one every week, tap it and tick “Every week”.') },
  { title: t('Move, split or remove.'), text: t('Drag an activity to another day. Or tap it: choose a new day or time, split it into smaller parts, or remove it. “Undo” at the top puts things back.') },
  { title: t('Energy shapes.'), text: t('More points = more energy: circle = Easy (green), triangle = Moderate (yellow), black star = High (red), pause sign = Rest. “Suggestions”, next to “New activity”, shows notes when a day has more than your rules; open and hide it when you want.') },
  { title: t('Voice and photo.'), text: t('“Voice note”: say what to change, in English or French. “Add from a photo”: take a picture of a paper schedule; nothing is added until you choose.') },
  { title: t('Paper.'), text: t('“Print” (top of the screen) prints the whole week. In One day, “Print this day” prints one day in large letters.') },
  { title: t('The reminder device.'), text: t('Tap “Reminder device”, then “Sync now”. It sends your week to the device and brings back your voice notes. The planner shows the same reminders while it is open.') },
];

export function renderGuide() {
  const el = $('guideSteps');
  if (el) el.innerHTML = guideSteps().map((g) => `<li><div><strong>${esc(g.title)}</strong>${esc(g.text)}</div></li>`).join('');
}
