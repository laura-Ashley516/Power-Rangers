// Printable schedule: the whole week, or one day.
// Uses the browser's print (iPad: share sheet → Print). Layout lives in css/styles.css (@media print).
//
// Track: A - Interface

import { $ } from './ui-kit.js';
import { weekStart, formatShortDate, dateForDay, formatLongDate } from './ui-week.js';

function stamp(title) {
  $('printTitle').textContent = title;
  $('printDate').textContent = `· printed ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

export function printWeek(showView) {
  const monday = weekStart();
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  stamp(`My week · ${formatShortDate(monday)} – ${formatShortDate(sunday)}`);
  document.body.classList.add('printing-week');
  document.body.classList.remove('printing-day');
  showView('weekly');
  setTimeout(() => window.print(), 50);
}

export function printDay() {
  const day = $('dailySelect2').value;
  stamp(`My day · ${formatLongDate(dateForDay(day))}`);
  document.body.classList.add('printing-day');
  document.body.classList.remove('printing-week');
  setTimeout(() => window.print(), 50);
}

window.addEventListener('afterprint', () => document.body.classList.remove('printing-week', 'printing-day'));
