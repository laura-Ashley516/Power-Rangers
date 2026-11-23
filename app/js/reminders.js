// Reminders on the iPad, the same as the device's (client feedback, Nov 2026: "in-app reminders that match
// the device reminders").
//
// Same rule as the firmware (pwr_config.h): a reminder `lead` minutes (Settings, default 60) before
//  - each time of day that has activities today (Morning 9:00, Afternoon 13:00, Evening 18:00), and
//  - each activity with its own clock time (firmware protocol v2).
// Activities with "Reminder on the device" off are left out. During a quiet time the banner still shows,
// but without vibration.
// Shown as a calm banner at the top of the planner, with one "OK" button; it never blocks anything.
// Limits (see docs/research-p3.md): a web app only runs while it is open. Reminders when the planner is
// closed would need a push server (iPadOS 16.4+, Home Screen app); the reminder device covers that.
//
// Track: A - Interface

import { ctx } from './context.js';
import { remindersFor } from './rules.js';
import { $, esc, dayName, dateKey } from './ui-kit.js';
import { scheduleFor } from './ui-week.js';
import { iconFor } from './icons.js';
import { t, tPeriod, clock } from './i18n.js';

const SEEN_KEY = 'pwr-reminders-seen';
const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch (e) { return {}; } };
const markSeen = (id) => {
  const s = seen();
  const today = dateKey(new Date());
  Object.keys(s).forEach((k) => { if (!k.startsWith(today)) delete s[k]; }); // keep only today's
  s[id] = 1;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) { /* */ }
};

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

let shown = null;

function show(r, { buzz = true } = {}) {
  const el = $('reminderBanner');
  if (!el) return;
  shown = r;
  const when = r.time ? clock(r.time) : `${tPeriod(r.period).toLowerCase()} (${clock(hhmm(r.start))})`;
  el.innerHTML = `<div class="reminder"><span class="reminder-bell" aria-hidden="true">🔔</span><div><strong>${esc(t('Coming up: {when}', { when }))}</strong><div class="reminder-items">${r.items.map((a) => `<span class="rem-item"><span class="rem-icon e-${esc(a.energy)}">${iconFor(a)}</span> ${esc(a.name)}</span>`).join('')}</div></div><button type="button" class="primary" id="reminderOk">${t('OK')}</button></div>`;
  $('reminderOk').onclick = () => { markSeen(dateKey(new Date()) + ':' + r.id); el.innerHTML = ''; shown = null; checkReminders(); };
  // Vibrate (where the browser can) only after she has used the page: browsers block it before that.
  if (buzz && !r.quiet && navigator.userActivation?.hasBeenActive) navigator.vibrate?.([300, 300, 300, 300, 300]);
}

export function checkReminders() {
  const el = $('reminderBanner');
  if (!el) return;
  if (ctx.state.settings.appReminders === false) { el.innerHTML = ''; shown = null; return; }
  if (shown) return; // one at a time, until she presses OK
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = dateKey(now);
  const done = seen();
  const due = remindersFor(scheduleFor(0), dayName(now), ctx.state.library, Number(ctx.state.settings.lead) || 60)
    .find((r) => mins >= r.at && mins < r.start && !done[today + ':' + r.id]);
  if (due) show(due);
}

// Draw the banner again (e.g. after the language changed), without vibrating.
export function redrawReminder() { if (shown) show(shown, { buzz: false }); }

export function startReminders() {
  checkReminders();
  setInterval(checkReminders, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkReminders(); });
}
