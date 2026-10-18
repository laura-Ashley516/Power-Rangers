// Small shared helpers for the interface: element lookup, escaping, toast, modal.
// Moved from the first-try planner with the same behaviour.

import { ENERGY } from './config.js';

export const $ = (id) => document.getElementById(id);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const energyLabel = (e) => (ENERGY[e] || ENERGY.green).label;
export const shape = (e) => (ENERGY[e] || ENERGY.green).shape;

let toastTimer;
export function toast(msg, ms = 2600) {
  $('toast').textContent = msg;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), ms);
}

// Form modal. onSubmit receives FormData; return false to keep the modal open.
export function showModal(title, body, onSubmit, { submitLabel = 'Save' } = {}) {
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" role="presentation"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><h2 id="modalTitle">${title}</h2><form id="modalForm">${body}<div class="modal-actions"><button type="button" id="cancelModal">Cancel</button><button class="primary" type="submit">${submitLabel}</button></div></form></div></div>`;
  $('cancelModal').onclick = () => (root.innerHTML = '');
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target.classList.contains('modal-backdrop')) root.innerHTML = ''; });
  $('modalForm').onsubmit = (e) => { e.preventDefault(); if (onSubmit(new FormData(e.target)) !== false) root.innerHTML = ''; };
  root.querySelector('input,select')?.focus();
}

// Free-form modal (no form). Returns the dialog element so the caller can wire buttons.
export function showPanelModal(title, html) {
  const root = $('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" role="presentation"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="panelModalTitle"><h2 id="panelModalTitle">${title}</h2>${html}</div></div>`;
  return root.querySelector('.modal');
}

export function closeModal() { $('modalRoot').innerHTML = ''; }
