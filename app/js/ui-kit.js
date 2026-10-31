// Small shared helpers for the interface: element lookup, escaping, toast (with Undo), modal,
// the order of the days on screen, and today's date key.

import { DAYS, ENERGY, PERIODS, PERIOD_TIMES } from './config.js';

export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const energyLabel = (e) => (ENERGY[e] || ENERGY.green).label;
// Monochrome line icon instead of the 🔒 emoji (NN/g: icons need text; COGA: avoid busy icon sets).
export const CARD_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5h6M9 10h6M9 14h4"/></svg>';
export const QUIET_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8.5 17H5l1.5-2V11a5.5 5.5 0 0 1 8.4-4.7M17.5 11v4l1.5 2h-6M10 20a2 2 0 0 0 4 0M3 3l18 18"/></svg>';
export const LOCK = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
export const shape = (e) => (ENERGY[e] || ENERGY.green).shape;

// Days in screen order. The client's kitchen calendar starts on Sunday; Settings can change it.
export function orderedDays(weekStart = 'Sunday') {
  const i = Math.max(0, DAYS.indexOf(weekStart));
  return [...DAYS.slice(i), ...DAYS.slice(0, i)];
}

export const dayName = (date) => DAYS[(date.getDay() + 6) % 7];
export const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Which block of the day it is now: index into PERIODS, -1 before the morning, 3 after the evening.
export function currentPeriodIndex(now = new Date()) {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < PERIOD_TIMES.Morning.start - 2) return -1;      // before ~7 am: the day has not started
  return PERIODS.findIndex((p) => h < PERIOD_TIMES[p].end) === -1 ? 3 : PERIODS.findIndex((p) => h < PERIOD_TIMES[p].end);
}

// Message at the bottom. "Undo" in it is a shortcut: Undo is always in the top bar too, so nothing she can act on
// is lost when the message hides itself (WCAG 2.2.1). It stays 8 s (plain messages 4 s) so it never covers the calendar for long.
let toastTimer;
export function toast(msg, ms = 4000, action = null) {
  const el = $('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" id="toastAction">${esc(action.label)}</button><button type="button" class="toast-close" id="toastClose" aria-label="Close message">Close</button>` : ''}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  if (action) {
    $('toastAction').onclick = () => { el.classList.add('hidden'); action.run(); };
    $('toastClose').onclick = () => el.classList.add('hidden');
  }
  toastTimer = setTimeout(() => el.classList.add('hidden'), action ? Math.max(ms, 8000) : ms);
}

// Form modal. onSubmit receives FormData; return false to keep the modal open.
export function showModal(title, body, onSubmit, { submitLabel = 'Save' } = {}) {
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" role="presentation"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><h2 id="modalTitle">${title}</h2><form id="modalForm">${body}<div class="modal-actions"><button type="button" id="cancelModal">Cancel</button><button class="primary" type="submit">${submitLabel}</button></div></form></div></div>`;
  $('cancelModal').onclick = closeModal;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
  $('modalForm').onsubmit = (e) => { e.preventDefault(); if (onSubmit(new FormData(e.target)) !== false) closeModal(); };
  root.querySelector('input:not([type=radio]),select,textarea')?.focus();
}

// Free-form modal (no form). Returns the dialog element so the caller can wire buttons.
export function showPanelModal(title, html) {
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" role="presentation"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="panelModalTitle"><h2 id="panelModalTitle">${title}</h2>${html}</div></div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop')) closeModal(); });
  return root.querySelector('.modal');
}

export function closeModal() { $('modalRoot').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modalRoot')?.innerHTML) closeModal(); });

// Energy picker used in the activity forms: four big labelled choices (shape + word + colour).
export function energyPicker(name, selected = 'green') {
  return `<fieldset class="field" style="border:0;padding:0;margin:0"><legend style="font-size:.85em;font-weight:750;margin-bottom:5px">Energy</legend><div class="energy-options">${['green', 'yellow', 'red', 'rest'].map((e) => `<label class="e-${e}"><input type="radio" name="${name}" value="${e}" ${e === selected ? 'checked' : ''}><span class="shape" aria-hidden="true">${shape(e)}</span>${energyLabel(e)}</label>`).join('')}</div></fieldset>`;
}
