// The planner's live state, shared by all screens.
//
// Screens read ctx.state and change it only through commit() (whole new state)
// or change() (one schedule change, checked by rules.js). Both save and redraw.
// Every change() can be undone: the last 20 are kept, and the toast offers "Undo" (research: COGA,
// users must be able to reverse mistakes without fear).

import { save } from './store.js';
import { applyChange } from './rules.js';
import { toast } from './ui-kit.js';

export const ctx = {
  state: null,
  weekOffset: 0,
  weekSchedules: {},     // other weeks are kept in memory while browsing (as in the first try)
  selectedActivity: null,
  placing: null,         // tap-to-place: { kind: 'library' | 'leftover', id, name }
  renderers: [],         // functions called after every commit
  undoStack: [],         // reverse changes, newest last
};

export function onRender(fn) { ctx.renderers.push(fn); }

export function render() {
  ctx.renderers.forEach((fn) => fn());
}

export function commit(newState) {
  ctx.state = newState;
  const ok = save(ctx.state);
  const badge = document.getElementById('offlineBadge');
  if (badge) badge.textContent = ok ? 'Saved on this iPad' : 'Could not save';
  render();
}

// Apply one change through the rules. Returns the rules result ({ ok, message, warnings, undo, itemId }).
export function change(c, { silent = false, undoable = true } = {}) {
  const result = applyChange(ctx.state, c);
  if (result.ok) {
    ctx.selectedActivity = null;
    if (undoable && result.undo) ctx.undoStack = [...ctx.undoStack, result.undo].slice(-20);
    commit(result.state);
  }
  if (!silent) {
    const msg = result.ok && result.warnings.length ? `${result.message} Note: ${result.warnings[0]}` : result.message;
    toast(msg, result.warnings.length || result.notice ? 5000 : 2800, result.ok && undoable && result.undo ? { label: 'Undo', run: undo } : null);
  }
  return result;
}

export function undo() {
  const last = ctx.undoStack.pop();
  if (!last) { toast('Nothing to undo.'); return; }
  const r = applyChange(ctx.state, { ...last, force: true });
  if (r.ok) { commit(r.state); toast('Undone.'); } else toast(r.message);
}
