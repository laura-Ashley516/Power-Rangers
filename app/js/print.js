// Printable schedule: the whole week (a table: days across, Morning / Afternoon / Evening down),
// one day (bigger text, e.g. "Print tomorrow" for the fridge or the pocket), or the one-page guide.
// The client is "a paper person" with a colour printer: paper stays a first-class output. The print layout is its own hidden block (#printArea), kept up to date
// after every change, so printing never depends on how the screen looks.
// Uses the browser's print (iPad: share sheet → Print). Styles: css/styles.css (@media print).
//
// Track: A - Interface

import { DAYS, PERIODS } from './config.js';
import { ctx } from './context.js';
import { $, esc, shape, energyLabel, orderedDays } from './ui-kit.js';
import { guideSteps } from './guide.js';
import { weekStart, formatShortDate, dateForDay, formatLongDate } from './ui-week.js';

const printedOn = () => new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function activity(a) {
  const steps = a.steps?.length ? `<br><small>☐ ${a.steps.map(esc).join(' ☐ ')}</small>` : '';
  return `<div class="p-act ${a.energy}"><span class="p-shape">${shape(a.energy)}</span> ${esc(a.name)}${a.fixed ? ' <span class="p-lock">(every week)</span>' : ''}${steps}</div>`;
}

function legend() {
  return `<div class="p-legend">${['green', 'yellow', 'red', 'rest'].map((e) => `<span class="p-act ${e}"><span class="p-shape">${shape(e)}</span> ${energyLabel(e)}</span>`).join('')}<span class="p-printed">Printed ${printedOn()}</span></div>`;
}

function weekTable() {
  const monday = weekStart();
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const DAYS = orderedDays(ctx.state.settings.weekStart);
  const head = DAYS.map((d, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return `<th>${d}<br><small>${formatShortDate(date)}</small></th>`;
  }).join('');
  const rows = PERIODS.map((p) => `<tr><th class="p-period">${p}</th>${DAYS.map((d) => `<td>${(ctx.state.schedule[d][p] || []).map(activity).join('')}</td>`).join('')}</tr>`).join('');
  const later = (ctx.state.leftovers || []).length ? `<p style="margin-top:6px"><b>Later this week:</b> ${ctx.state.leftovers.map((a) => `${shape(a.energy)} ${esc(a.name)}`).join(' · ')}</p>` : '';
  return `<section class="print-week"><h1>My week · ${formatShortDate(monday)} – ${formatShortDate(sunday)}</h1><table class="p-table"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>${later}${legend()}</section>`;
}

let dayToPrint = null;
function dayTable() {
  const day = dayToPrint || $('dailySelect2')?.value || 'Monday';
  const rows = PERIODS.map((p) => {
    const list = ctx.state.schedule[day][p] || [];
    return `<tr><th class="p-period">${p}</th><td>${list.length ? list.map(activity).join('') : '<span class="p-empty">Free</span>'}</td></tr>`;
  }).join('');
  return `<section class="print-day"><h1>${esc(formatLongDate(dateForDay(day)))}</h1><table class="p-table p-day"><tbody>${rows}</tbody></table>${legend()}</section>`;
}

function guidePage() {
  return `<section class="print-guide"><h1>How to use My Week, My Way</h1><ol>${guideSteps().map((g) => `<li><b>${esc(g.title)}</b> ${esc(g.text)}</li>`).join('')}</ol></section>`;
}

// Appointment card, pocket size, large letters: questions with space for answers, what to bring.
let cardId = null;
function appointmentCard() {
  if (!cardId) return '';
  let found = null;
  for (const d of DAYS) for (const p of PERIODS) { const a = ctx.state.schedule[d][p].find((x) => x.id === cardId); if (a) found = { a, d, p }; }
  if (!found) return '';
  const { a, d, p } = found;
  const qs = (a.questions || []).map((q) => `<li>${esc(q)}<div class="p-answer"></div></li>`).join('');
  const bring = (a.steps || []).map((s) => `<li>☐ ${esc(s)}</li>`).join('');
  return `<section class="print-card"><h1>${esc(a.name)}</h1><p class="p-when">${esc(formatLongDate(dateForDay(d)))} · ${p}</p>${qs ? `<h2>Questions to ask</h2><ol>${qs}</ol>` : ''}${bring ? `<h2>Bring</h2><ul>${bring}</ul>` : ''}<h2>What was said</h2><div class="p-answer tall"></div></section>`;
}

export function renderPrintArea() {
  const el = $('printArea');
  if (el) el.innerHTML = weekTable() + dayTable() + guidePage() + appointmentCard();
}

function print(mode) {
  renderPrintArea();
  document.body.classList.remove('printing-day', 'printing-week', 'printing-guide', 'printing-card');
  document.body.classList.add('printing-' + mode);
  setTimeout(() => window.print(), 50);
}

export const printWeek = () => print('week');
export const printDay = (day = null) => { dayToPrint = typeof day === 'string' ? day : null; print('day'); };
export const printGuide = () => print('guide');
export const printAppointment = (id) => { cardId = id; print('card'); };

window.addEventListener('afterprint', () => { dayToPrint = null; cardId = null; document.body.classList.remove('printing-day', 'printing-week', 'printing-guide', 'printing-card'); });
