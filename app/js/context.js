// The planner's live state, shared by all screens.
//
// Screens read ctx.state and change it only through commit() (whole new state)
// or change() (one schedule change, checked by rules.js). Both save and redraw.
// Every change() can be undone: the last 20 are kept, and the toast offers "Undo" (research: COGA,
// users must be able to reverse mistakes without fear).

import { save } from './store.js';
import { applyChange } from './rules.js';
import { toast } from './ui-kit.js';
import { t } from './i18n.js';

export const ctx = {
  state: null,
  weekOffset: 0,
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
  ctx.saveFailed = !save(ctx.state); // shown in the top bar ("Saved on this iPad · 10:42")
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
    const msg = result.ok && result.warnings.length ? `${result.message} ${t('Note:')} ${result.warnings[0]}` : result.message;
    toast(msg, result.warnings.length || result.notice ? 5000 : 2800, result.ok && undoable && result.undo ? { label: t('Undo'), run: undo } : null);
  }
  return result;
}

// Changes that do not go through the rules (editing or deleting one of "My activities", a photo import):
// the whole planner as it was is kept, so Undo can put it back.
export function snapshotUndo() {
  ctx.undoStack = [...ctx.undoStack, { type: 'snapshot', state: JSON.parse(JSON.stringify(ctx.state)) }].slice(-20);
}

export function undo() {
  const last = ctx.undoStack.pop();
  if (!last) { toast(t('Nothing to undo.')); return; }
  if (last.type === 'snapshot') { commit(last.state); toast(t('Undone.')); return; }
  const r = applyChange(ctx.state, { ...last, force: true });
  if (r.ok) { commit(r.state); toast(t('Undone.')); } else toast(r.message);
}
