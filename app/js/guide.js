// The one-page guide (Help screen and printable). Research: about 1 in 3 people needed more than one
// training session with a new memory aid, and a printed quick guide helps (Ramirez-Hernandez 2022).
// Keep it short: 8 steps, plain words.
//
// Track: A - Interface

import { $, esc } from './ui-kit.js';

export const guideSteps = () => [
  { title: 'Your week.', text: 'The planner opens on your week. Each day is a column; Morning, Afternoon and Evening are the rows. The bar under each day shows how much energy it uses (for example 4½ of 5½).' },
  { title: 'Today.', text: 'Tap “Today” to see only what is now and what is next. Under each activity, “Remember” lists what to bring or do.' },
  { title: 'Add an activity.', text: 'Above the calendar, the “My activities” box holds your usual activities. Drag one into a day (with a finger: press for a moment, then move). Or tap it, then tap the day. Activities you add are for that week only. To repeat one every week, tap it and tick “Every week”. Activities with two arrows in a circle come back every week; when you move, change or remove one, choose “This week only” or “Every week”.' },
  { title: 'Move or remove.', text: 'Drag an activity to another day. Or tap it: you can choose a new day or remove it. “Undo” at the top puts things back.' },
  { title: 'Later this week.', text: 'Things to do when there is energy wait at the bottom of the week. Drag one onto a day when ready.' },
  { title: 'Energy colours.', text: '□ Easy (green) · ● Moderate (yellow) · ◇ High (red) · ◠ Rest. A short note appears when a day has more than your rules allow. Under “More”, “Suggest a lighter week” offers moves; nothing changes until you choose.' },
  { title: 'Paper.', text: '“Print” (top of the screen) prints the whole week. On Today, “Print tomorrow” prints the next day in large letters.' },
  { title: 'The reminder device.', text: 'Tap “Reminder device”, then “Sync now”. It sends your week to the device and brings back your voice notes.' },
];

export function renderGuide() {
  const el = $('guideSteps');
  if (el) el.innerHTML = guideSteps().map((g) => `<li><div><strong>${esc(g.title)}</strong>${esc(g.text)}</div></li>`).join('');
}
