// Printable schedule: the whole week (a table: days across, Morning / Afternoon / Evening down)
// or one day (bigger text). The print layout is its own hidden block (#printArea), kept up to date
// after every change, so printing never depends on how the screen looks.
// Uses the browser's print (iPad: share sheet → Print). Styles: css/styles.css (@media print).
//
// Track: A - Interface

import { DAYS, PERIODS } from './config.js';
import { ctx } from './context.js';
import { $, esc, shape, energyLabel } from './ui-kit.js';
import { weekStart, formatShortDate, dateForDay, formatLongDate } from './ui-week.js';

const printedOn = () => new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function activity(a) {
  return `<div class="p-act ${a.energy}"><span class="p-shape">${shape(a.energy)}</span> ${esc(a.name)}${a.fixed ? ' <span class="p-lock">(fixed)</span>' : ''}</div>`;
}

function legend() {
  return `<div class="p-legend">${['green', 'yellow', 'red'].map((e) => `<span class="p-act ${e}"><span class="p-shape">${shape(e)}</span> ${energyLabel(e)}</span>`).join('')}<span class="p-printed">Printed ${printedOn()}</span></div>`;
}

function weekTable() {
  const monday = weekStart();
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const head = DAYS.map((d, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return `<th>${d}<br><small>${formatShortDate(date)}</small></th>`;
  }).join('');
  const rows = PERIODS.map((p) => `<tr><th class="p-period">${p}</th>${DAYS.map((d) => `<td>${(ctx.state.schedule[d][p] || []).map(activity).join('')}</td>`).join('')}</tr>`).join('');
  return `<section class="print-week"><h1>My week · ${formatShortDate(monday)} – ${formatShortDate(sunday)}</h1><table class="p-table"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>${legend()}</section>`;
}

function dayTable() {
  const day = $('dailySelect2')?.value || 'Monday';
  const rows = PERIODS.map((p) => {
    const list = ctx.state.schedule[day][p] || [];
    return `<tr><th class="p-period">${p}</th><td>${list.length ? list.map(activity).join('') : '<span class="p-empty">Free</span>'}</td></tr>`;
  }).join('');
  return `<section class="print-day"><h1>${esc(formatLongDate(dateForDay(day)))}</h1><table class="p-table p-day"><tbody>${rows}</tbody></table>${legend()}</section>`;
}

export function renderPrintArea() {
  const el = $('printArea');
  if (el) el.innerHTML = weekTable() + dayTable();
}

function print(mode) {
  renderPrintArea();
  document.body.classList.toggle('printing-day', mode === 'day');
  setTimeout(() => window.print(), 50);
}

export const printWeek = () => print('week');
export const printDay = () => print('day');

window.addEventListener('afterprint', () => document.body.classList.remove('printing-day'));
