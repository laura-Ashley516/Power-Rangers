// Appointment card: before the visit, up to 3 questions and what to bring; after it, a short note.
// Why: a review of 42 studies found that question lists help patients ask more and get more information
// (Sansoni, Grootemaat & Duncan, Patient Educ Couns 2015). The client finds forms stressful, so questions
// can be tapped from suggestions, there are at most 3, and the card prints as a pocket card (she carries notes).
//
// Track: A - Interface

import { DAYS, PERIODS } from './config.js';
import { ctx, change } from './context.js';
import { SUGGESTED_QUESTIONS } from './store.js';
import { $, esc, shape, showPanelModal, closeModal, toast } from './ui-kit.js';
import { printAppointment } from './print.js';
import { t, tDay, tPeriod } from './i18n.js';

const MAX_Q = 3;

function find(id) {
  for (const d of DAYS) for (const p of PERIODS) {
    const a = ctx.state.schedule[d][p].find((x) => x.id === id);
    if (a) return { a, d, p };
  }
  return null;
}

export function openAppointmentCard(id) {
  const where = find(id);
  if (!where) return;
  const { a, d, p } = where;
  const qs = [...(a.questions || [])];
  while (qs.length < MAX_Q) qs.push('');
  const modal = showPanelModal(`${shape(a.energy)} ${esc(a.name)}`, `
    <p class="muted">${tDay(d)} · ${tPeriod(p)}</p>
    <h3 style="margin-top:16px">${t('Questions to ask (up to 3)')}</h3>
    <div class="q-list">${qs.map((q, i) => `<input class="q-input" id="q${i}" maxlength="120" value="${esc(q)}" aria-label="${t('Question {n}', { n: i + 1 })}" placeholder="${t('Question {n}', { n: i + 1 })}">`).join('')}</div>
    <p class="muted" style="margin-top:8px;font-size:var(--fs-s)">${t('Tap one to add it:')}</p>
    <div class="q-suggestions">${SUGGESTED_QUESTIONS.map((q) => `<button type="button" class="small" data-suggest="${esc(t(q))}">${esc(t(q))}</button>`).join('')}</div>
    <div class="field" style="margin-top:16px"><label for="apBring">${t('What to bring (one per line)')}</label><textarea id="apBring">${esc((a.steps || []).join('\n'))}</textarea></div>
    <div class="field" style="margin-top:16px"><label for="apAfter">${t('After the visit: what was said')}</label><textarea id="apAfter" placeholder="${esc(t('For example: new exercise, come back in 2 weeks'))}">${esc(a.afterNote || '')}</textarea></div>
    <div class="modal-actions"><button type="button" id="apPrint">${t('Print the card')}</button><button type="button" id="apCancel">${t('Cancel')}</button><button type="button" class="primary" id="apSave">${t('Save')}</button></div>`);
  modal.querySelectorAll('[data-suggest]').forEach((b) => (b.onclick = () => {
    const empty = [...modal.querySelectorAll('.q-input')].find((x) => !x.value.trim());
    if (!empty) { toast(t('Already 3 questions. Clear one first.')); return; }
    empty.value = b.dataset.suggest;
  }));
  const read = () => ({
    questions: [...modal.querySelectorAll('.q-input')].map((x) => x.value.trim()).filter(Boolean).slice(0, MAX_Q),
    steps: $('apBring').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8),
    afterNote: $('apAfter').value.trim(),
  });
  // Read the fields BEFORE closing: closing removes them from the page.
  const save = () => { const fields = read(); closeModal(); change({ type: 'update', id, fields }); };
  $('apCancel').onclick = closeModal;
  $('apSave').onclick = save;
  $('apPrint').onclick = () => { save(); printAppointment(id); };
}

// The part shown on Today for an appointment: questions and the after-visit note.
export function appointmentToday(a) {
  const q = a.questions?.length ? `<div class="ap-today"><strong>${t('Questions to ask')}</strong><ol>${a.questions.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : '';
  const after = a.afterNote ? `<div class="ap-today"><strong>${t('After the visit')}</strong><p>${esc(a.afterNote)}</p></div>` : '';
  return `${q}${after}<button type="button" class="small" data-appointment="${esc(a.id)}" style="margin-top:10px">${a.questions?.length || a.afterNote ? t('Open the appointment card') : t('Prepare: questions and what to bring')}</button>`;
}
