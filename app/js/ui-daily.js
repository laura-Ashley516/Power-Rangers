// Daily view: one day at a time. Moved from the first-try planner.
//
// Track: A - Interface

import { PERIODS } from './config.js';
import { ctx } from './context.js';
import { renderCard, dateForDay, formatLongDate } from './ui-week.js';
import { $ } from './ui-kit.js';

export function renderDaily() {
  const day = $('dailySelect2').value;
  $('dailyTitle').textContent = day;
  $('dailyDateLabel').textContent = formatLongDate(dateForDay(day));
  const root = $('dailySlots');
  root.innerHTML = '';
  PERIODS.forEach((period) => {
    const box = document.createElement('div');
    box.className = 'daily-slot';
    const list = ctx.state.schedule[day][period] || [];
    box.innerHTML = `<h3>${period}</h3><div class="slot" data-day="${day}" data-period="${period}" aria-label="${day} ${period} drop zone">${list.length ? list.map((a, i) => renderCard(a, day, period, i)).join('') : '<div class="slot-hint">No activities scheduled.</div>'}</div>`;
    root.appendChild(box);
  });
}
