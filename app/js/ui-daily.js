// One day at a time, with roomy blocks (the week board in large type).
//
// Track: A - Interface

import { PERIODS } from './config.js';
import { ctx } from './context.js';
import { checkDay } from './rules.js';
import { renderCard, dateForDay, formatLongDate, budgetHtml } from './ui-week.js';
import { $, dateKey } from './ui-kit.js';

export function renderDaily() {
  const day = $('dailySelect2').value;
  $('dailyTitle').textContent = day;
  const date = dateForDay(day);
  $('dailyDateLabel').textContent = formatLongDate(date);
  $('dailyBudget').innerHTML = `<div class="panel" style="padding:12px 14px;margin:0"><strong style="display:block;margin-bottom:4px">Energy for ${day}</strong>${budgetHtml(checkDay(ctx.state.schedule, day))}</div>`;
  $('dailySlots').innerHTML = PERIODS.map((period) => {
    const list = ctx.state.schedule[day][period] || [];
    return `<div class="daily-slot"><h3>${period}<span class="muted" style="font-size:.75em;font-weight:600">${list.length ? `${list.length} activit${list.length > 1 ? 'ies' : 'y'}` : 'Free'}</span></h3><div class="slot" data-day="${day}" data-period="${period}" aria-label="${day} ${period}. Drop here.">${list.map((a, i) => renderCard(a, day, period, i, 'scheduled')).join('') || '<div class="slot-hint">Free. Tap to add an activity.</div>'}</div></div>`;
  }).join('');
}
