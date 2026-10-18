// Reminder device page: connect, Sync now, demo device.
// Sync = hello → set clock → send the week (or restore it if this app is empty) → collect voice notes → understand them.
//
// Track: B - Data + device

import { MAX_DEVICE_ACTIVITIES } from './config.js';
import { ctx, commit } from './context.js';
import { BleTransport, FakeTransport, DeviceLink } from './device.js';
import { scheduleToLines, linesToSchedule, isScheduleEmpty } from './store.js';
import { $, esc, toast } from './ui-kit.js';
import { saveNote } from './voice/notes.js';
import { toPlayableWav, wavInfo, encodeImaAdpcmWav } from './voice/wav.js';
import { processAll, renderVoiceView, updateCount } from './voice/inbox.js';

let link = null;

const useDemo = () => !!ctx.state.settings.demoDevice;

function setConnected(on, msg) {
  $('deviceStatus').textContent = msg;
  $('deviceDot').classList.toggle('on', on);
  $('deviceBadge').textContent = on ? 'Connected' : 'Not connected';
  $('deviceBadge').classList.toggle('good', on);
}

export async function connect() {
  const transport = useDemo() ? new FakeTransport() : new BleTransport();
  if (!useDemo() && !BleTransport.supported()) {
    setConnected(false, 'Bluetooth is not available in this browser');
    toast('On iPad, open the planner in the Bluefy browser. On a laptop, use Chrome or Edge. Or turn on the demo device in Settings.', 5000);
    return null;
  }
  try {
    $('deviceStatus').textContent = 'Searching for the reminder device…';
    await transport.connect();
    transport.onDisconnect = () => { link = null; setConnected(false, 'Device disconnected'); };
    link = new DeviceLink(transport);
    const hi = await link.hello();
    link.info = hi;
    setConnected(true, `Connected to ${transport.name}${hi.version ? '' : ' (first-try firmware: schedule only)'}`);
    toast('Reminder device connected.');
    return link;
  } catch (err) {
    link = null;
    setConnected(false, err.name === 'NotFoundError' ? 'No device selected' : 'Connection failed: ' + err.message);
    return null;
  }
}

export function disconnect() {
  link?.t.disconnect();
  link = null;
  setConnected(false, 'Not connected');
}

// Keep the screen on during a sync: a web app pauses when the iPad goes to sleep.
async function keepAwake() {
  try { return await navigator.wakeLock?.request('screen'); } catch (e) { return null; }
}

export async function sync() {
  const out = $('syncStatus');
  const lock = await keepAwake();
  try { await runSync(out); } finally { lock?.release?.().catch(() => {}); }
}

async function runSync(out) {
  if (!link || !link.t.connected) {
    out.textContent = 'Connecting…';
    if (!(await connect())) { out.textContent = 'Not synced. Connect the device first.'; return; }
  }
  try {
    const info = await link.hello(); // also refreshes counts and the packet size
    await link.setTime();
    out.textContent = 'Syncing… please keep this screen open and the device close by.';

    // 1. Week: send it, unless this app is empty and the device still has a copy (then restore).
    let weekMsg = '';
    if (isScheduleEmpty(ctx.state.schedule) && info.scheduleCount > 0) {
      if (confirm(`This planner is empty, but the device still has ${info.scheduleCount} activities. Restore them from the device?`)) {
        const lines = await link.getBackup();
        const { schedule, library } = linesToSchedule(lines, ctx.state.library);
        commit({ ...ctx.state, schedule, library });
        weekMsg = `Restored ${lines.length} activities from the device.`;
      } else {
        weekMsg = 'Nothing sent: the empty planner did not overwrite the device.';
      }
    } else {
      const lines = scheduleToLines(ctx.state.schedule);
      if (lines.length > MAX_DEVICE_ACTIVITIES) {
        weekMsg = `The device holds ${MAX_DEVICE_ACTIVITIES} activities; this week has ${lines.length}. Only the first ${MAX_DEVICE_ACTIVITIES} were sent. `;
        lines.length = MAX_DEVICE_ACTIVITIES;
      }
      out.textContent = 'Sending your week…';
      await link.sendSchedule(lines);
      weekMsg += `Week sent (${lines.length} activities).`;
    }

    // 2. Voice notes: copy each one, check it, then let the device delete it.
    const notes = await link.listNotes();
    let collected = 0;
    for (const n of notes) {
      const bytes = await link.getNote(n.id, (p) => { out.textContent = `Collecting voice note ${collected + 1} of ${notes.length}… ${Math.round(p * 100)} % (keep this screen open)`; });
      const audio = toPlayableWav(bytes.buffer); // unpack the device's compressed audio
      await saveNote({ source: 'device', bytes: audio.buffer, mime: audio.mime, recordedAt: n.time ? n.time * 1000 : Date.now() });
      await link.deleteNote(n.id);
      collected++;
    }
    const time = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    out.textContent = `Synced at ${time}. ${weekMsg}${collected ? ` ${collected} voice note${collected > 1 ? 's' : ''} collected.` : ''}`;
    renderDemoPanel();
    updateCount();

    // 3. Understand the new notes (can take a moment the first time: the speech model downloads once).
    if (collected) {
      toast('Listening to the voice notes from the device… keep this screen open.', 4000);
      const lock = await keepAwake();
      const done = await processAll().finally(() => lock?.release?.().catch(() => {}));
      const added = done.filter((n) => n?.status === 'applied' || n?.status === 'partly').length;
      toast(added ? 'Voice notes added to your calendar. See “Voice notes” for details.' : 'Voice notes saved. Some need sorting in “Voice notes”.', 5000);
      renderVoiceView();
    }
  } catch (err) {
    out.textContent = 'Sync stopped: ' + err.message + ' Nothing was lost; try again.';
  }
}

// ---------- demo device panel ----------

export function renderDemoPanel() {
  const body = $('demoDeviceBody');
  if (!useDemo()) { body.innerHTML = '<p class="muted">Off. Turn on “Demo device” in Settings to test without hardware.</p>'; return; }
  body.innerHTML = `
    <p><strong>On.</strong> Connect and Sync now use the pretend device. It keeps ${FakeTransport.storedCount()} activities and ${FakeTransport.notes.length} voice note${FakeTransport.notes.length === 1 ? '' : 's'} waiting.</p>
    <div class="row"><label class="file-button"><input id="demoNoteInput" type="file" accept="audio/*"><span>Put a recording on the demo device</span></label>
    <button class="small" id="demoClearBtn">Erase the demo device's week</button></div>
    <p class="muted">Use any audio file (e.g. a voice memo saying “Add laundry on Friday morning”). Then Sync now: the app collects it like a real device note.</p>`;
  $('demoNoteInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let bytes = await file.arrayBuffer();
    const info = wavInfo(bytes);
    // A plain 16-bit WAV is compressed like the real device does, so the demo follows the same path.
    if (info && info.format === 1 && info.channels === 1) bytes = encodeImaAdpcmWav(new Int16Array(bytes, info.data.offset, info.data.size >> 1), info.sampleRate);
    FakeTransport.addRecording(bytes);
    toast(`“${esc(file.name)}” is waiting on the demo device.`);
    renderDemoPanel();
  };
  $('demoClearBtn').onclick = () => { FakeTransport.clearSchedule(); toast('Demo device week erased.'); renderDemoPanel(); };
}
