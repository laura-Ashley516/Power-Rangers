// The planner's live state, shared by all screens.
//
// Screens read ctx.state and change it only through commit() (whole new state)
// or change() (one schedule change, checked by rules.js). Both save and redraw.

import { save } from './store.js';
import { applyChange } from './rules.js';
import { toast } from './ui-kit.js';

export const ctx = {
  state: null,
  weekOffset: 0,
  weekSchedules: {},     // other weeks are kept in memory while browsing (as in the first try)
  selectedActivity: null,
  renderers: [],         // functions called after every commit
};

export function onRender(fn) { ctx.renderers.push(fn); }

export function render() {
  ctx.renderers.forEach((fn) => fn());
}

export function commit(newState) {
  ctx.state = newState;
  const ok = save(ctx.state);
  const badge = document.getElementById('offlineBadge');
  if (badge) badge.textContent = ok ? '● Saved locally' : 'Save unavailable';
  render();
}

// Apply one change through the rules. Returns the rules result ({ ok, message, warnings, undo, itemId }).
export function change(c, { silent = false } = {}) {
  const result = applyChange(ctx.state, c);
  if (result.ok) {
    ctx.selectedActivity = null;
    commit(result.state);
  }
  if (!silent) {
    const msg = result.ok && result.warnings.length ? `${result.message} Note: ${result.warnings[0]}` : result.message;
    toast(msg, result.warnings.length ? 4200 : 2600);
  }
  return result;
}
