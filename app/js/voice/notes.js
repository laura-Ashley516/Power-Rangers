// Voice notes: storage on this device (IndexedDB) and the pipeline
//   recording -> Whisper text -> parser -> rules check -> calendar -> change log (with undo).
// Notes come from the iPad microphone (recorder.js) or from the reminder device at sync (ui-device.js).
//
// Track: C - Rules + voice

import { t } from '../i18n.js';
import { ctx, commit } from '../context.js';
import { applyChange, findItem } from '../rules.js';
import { uid } from '../store.js';
import { parse } from './parser.js';
import { transcribe } from './transcribe.js';

// ---------- storage ----------

const DB_NAME = 'pwr-voice';
const STORE = 'notes';
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result?.result ?? result);
    tx.onerror = () => reject(tx.error);
  });
}

const listeners = new Set();
export function onNotesChanged(fn) { listeners.add(fn); }
const changed = () => listeners.forEach((fn) => fn());

export async function allNotes() {
  const notes = await run('readonly', (s) => s.getAll());
  return (notes || []).sort((a, b) => (b.recordedAt || b.receivedAt) - (a.recordedAt || a.receivedAt));
}
export const getNote = (id) => run('readonly', (s) => s.get(id));
export async function deleteNote(id) { await run('readwrite', (s) => s.delete(id)); changed(); }
async function updateNote(id, patch) {
  const note = await getNote(id);
  if (!note) return null;
  const next = { ...note, ...patch };
  await run('readwrite', (s) => s.put(next));
  changed();
  return next;
}

// bytes: ArrayBuffer (stored as-is; Blobs in IndexedDB are unreliable on some iPad browsers)
export async function saveNote({ source, bytes, mime, recordedAt }) {
  const note = { id: uid(), source, bytes, mime, recordedAt: recordedAt || Date.now(), receivedAt: Date.now(), status: 'new', transcript: '', results: [] };
  await run('readwrite', (s) => s.put(note));
  changed();
  return note;
}

// ---------- understanding ----------

// Voice changes wait for her OK (client decision, Nov 2026: "make her confirm, in one click").
// planText() only understands and checks the words; nothing changes until applyPlan() runs, which happens
// when she presses the one "Yes, do it" button. Used by voice notes (iPad and device) and typed commands.
// A plan is plain data (stored with the note), so a device note can wait for her OK until she opens the planner.
export function planText(text, { now = new Date() } = {}) {
  const parsed = parse(text, { library: ctx.state.library, schedule: ctx.state.schedule, now, newId: uid });
  let state = ctx.state;
  return parsed.map((p) => {
    if (!p.ok) return { ok: false, text: p.text, reason: p.reason };
    const r = applyChange(state, p.change); // a dry run on a copy: does it fit? (the real one is applyPlan)
    if (!r.ok) return { ok: false, text: p.text || text, reason: r.message };
    state = r.state;
    return { ok: true, summary: p.summary, change: p.change, warnings: r.warnings };
  });
}

// Apply the understood part of a plan, as ONE change (one Undo). Returns the results to show.
export function applyPlan(plan, { noteId = null, heard = '' } = {}) {
  let state = ctx.state;
  const results = [];
  for (const p of plan) {
    if (!p.ok) { results.push(p); continue; }
    const r = applyChange(state, p.change);
    if (!r.ok) { results.push({ ok: false, text: p.summary, reason: r.message }); continue; }
    state = r.state;
    if (r.itemId && p.change.type !== 'remove') {
      const f = findItem(state.schedule, r.itemId);
      if (f) f.item.voiceNew = true;
    }
    const entry = { id: uid(), at: Date.now(), noteId, heard, summary: p.summary, message: r.message, warnings: r.warnings, undo: r.undo, undone: false };
    state.changeLog = [entry, ...(state.changeLog || [])].slice(0, 50);
    results.push({ ok: true, summary: p.summary, message: r.message, notice: r.notice, warnings: r.warnings, changeId: entry.id });
  }
  if (state !== ctx.state) commit(state);
  return results;
}

// Understand and apply at once (kept for the tests and the team's tools).
export function applyText(text, opts = {}) { return applyPlan(planText(text, opts), { ...opts, heard: text }); }

export function undoChange(entryId) {
  const entry = ctx.state.changeLog.find((e) => e.id === entryId);
  if (!entry || entry.undone) return { ok: false, message: t('Already undone.') };
  const r = applyChange(ctx.state, entry.undo);
  if (!r.ok) return r;
  r.state.changeLog = r.state.changeLog.map((e) => (e.id === entryId ? { ...e, undone: true } : e));
  commit(r.state);
  return { ok: true, message: t('Undone: {what}.', { what: entry.summary }) };
}

const statusFor = (results) => {
  const ok = results.filter((r) => r.ok).length;
  return ok === results.length ? 'applied' : ok ? 'partly' : 'to-sort';
};

export async function processNote(id) {
  let note = await getNote(id);
  if (!note) return null;
  await updateNote(id, { status: 'transcribing', error: '' });
  let text;
  try {
    // In French the multilingual model of the same size is used (the ".en" models only know English).
    const fr = ctx.state.settings.lang === 'fr';
    const model = fr ? ctx.state.settings.speechModel.replace(/\.en$/, '') : ctx.state.settings.speechModel;
    text = await transcribe(note.bytes, model, fr ? 'french' : null);
  } catch (e) {
    return updateNote(id, { status: 'error', error: e.message });
  }
  if (!text) return updateNote(id, { status: 'empty', transcript: '' });
  // Understood, not applied: it waits for her OK ("confirm").
  const plan = planText(text, { now: new Date(note.recordedAt || note.receivedAt) });
  return updateNote(id, { status: plan.some((p) => p.ok) ? 'confirm' : 'to-sort', transcript: text, plan, results: plan.filter((p) => !p.ok) });
}

// Her OK for one note: apply what was understood (one Undo per change in Voice notes).
export async function confirmNote(id) {
  const note = await getNote(id);
  if (!note || note.status !== 'confirm') return null;
  const results = applyPlan(note.plan || [], { noteId: id, heard: note.transcript });
  return updateNote(id, { status: statusFor(results), results, plan: [] });
}

// "Do them": her OK for every note waiting for it, oldest first.
export async function confirmAll() {
  const waiting = (await allNotes()).filter((n) => n.status === 'confirm').reverse();
  const out = [];
  for (const n of waiting) out.push(await confirmNote(n.id));
  return out;
}
export const confirmCount = async () => (await allNotes()).filter((n) => n.status === 'confirm').reduce((k, n) => k + (n.plan || []).filter((p) => p.ok).length, 0);

// Run the pipeline on every note that has not been processed yet, one at a time.
export async function processWaiting(onEach) {
  const waiting = (await allNotes()).filter((n) => n.status === 'new' || n.status === 'transcribing').reverse(); // oldest first
  const done = [];
  for (const n of waiting) {
    onEach?.(n, done.length, waiting.length);
    done.push(await processNote(n.id));
  }
  return done;
}

// For notes "to sort": try again with words the user (or a helper) corrected.
export async function retryWithText(id, text) {
  const note = await getNote(id);
  if (!note) return null;
  // She (or a helper) typed the words and pressed "Try again": that press is her OK.
  const results = applyPlan(planText(text, { now: new Date(note.recordedAt || note.receivedAt) }), { noteId: id, heard: text });
  return updateNote(id, { status: statusFor(results), transcript: text, results, plan: [] });
}

export const pendingCount = async () => (await allNotes()).filter((n) => ['new', 'transcribing', 'confirm', 'to-sort', 'partly', 'error'].includes(n.status)).length;
