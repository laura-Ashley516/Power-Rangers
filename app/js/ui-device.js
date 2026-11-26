// Reminder device page: connect (Bluetooth or Wi-Fi), Sync now, Wi-Fi setup, demo device.
// Sync = hello → set clock → send the week (or restore it if this app is empty) → collect voice notes → understand them.
//
// Track: B - Data + device

import { MAX_DEVICE_ACTIVITIES } from './config.js';
import { ctx, commit } from './context.js';
import { BleTransport, FakeTransport, DeviceLink } from './device.js';
import { MqttTransport, newPairingCode, normalizeCode } from './device-wifi.js';
import { scheduleToLines, linesToSchedule, isScheduleEmpty, quietLines, deviceSignature, packState, unpackState, keepSafetyCopy, isDemo, backupSig } from './store.js';
import { t, fmtTime, fmtDate } from './i18n.js';
import { $, esc, toast } from './ui-kit.js';
import { scheduleFor } from './ui-week.js';
import { saveNote } from './voice/notes.js';
import { toPlayableWav, wavInfo, encodeImaAdpcmWav } from './voice/wav.js';
import { processAll, renderVoiceView, updateCount, refreshWaiting } from './voice/inbox.js';

let link = null;
let deviceBusy = false;
export const isDeviceBusy = () => deviceBusy;

async function withDevice(operation, onBusy = () => undefined) {
  if (deviceBusy) return onBusy();
  deviceBusy = true;
  try {
    const locks = useWifi() ? globalThis.navigator?.locks : null;
    if (locks) {
      return await locks.request('pwr-device', { ifAvailable: true }, (lock) =>
        lock ? operation() : onBusy());
    }
    return await operation();
  } finally {
    deviceBusy = false;
  }
}

const useDemo = () => !!ctx.state.settings.demoDevice;
const useWifi = () => !useDemo() && ctx.state.settings.connection === 'wifi';

function makeTransport() {
  if (useDemo()) return new FakeTransport();
  if (useWifi()) return new MqttTransport(ctx.state.settings.wifi);
  return new BleTransport();
}

function setConnected(on, msg) {
  $('deviceStatus').textContent = msg;
  $('deviceDot').classList.toggle('on', on);
  $('deviceBadge').textContent = on ? t('Connected') : t('Not connected');
  $('deviceBadge').classList.toggle('good', on);
}

export function connect() {
  return withDevice(connectDevice, () => {
    $('syncStatus').textContent = t('The reminder device is busy. Try again in a moment.');
  });
}

async function connectDevice() {
  const transport = makeTransport();
  if (!useDemo() && !useWifi() && !BleTransport.supported()) {
    setConnected(false, t('Bluetooth is not available in this browser'));
    toast(t('On iPad, use Wi-Fi (see “How the planner reaches the device”) or open the planner in Bluefy. On a laptop, use Chrome or Edge.'), 5000);
    return null;
  }
  try {
    $('deviceStatus').textContent = useWifi() ? t('Reaching the device over Wi-Fi…') : t('Searching for the reminder device…');
    await transport.connect();
    transport.onDisconnect = () => { link = null; setConnected(false, t('Device disconnected')); };
    if (useWifi() && transport.deviceOnline === false) {
      transport.disconnect();
      setConnected(false, t('The device is offline'));
      toast(t('The device is not on Wi-Fi right now. Switch it on (or press Sync on it) and try again.'), 5000);
      return null;
    }
    link = new DeviceLink(transport);
    const hi = await link.hello();
    link.info = hi;
    setConnected(true, t('Connected to {name}', { name: transport.name }) + (hi.version ? '' : t(' (first-try firmware: schedule only)')));
    toast(t('Reminder device connected.'));
    return link;
  } catch (err) {
    link = null;
    transport.disconnect?.();
    setConnected(false, err.name === 'NotFoundError' ? t('No device selected') : t('Connection failed: {error}', { error: err.message }));
    return null;
  }
}

export function disconnect() {
  link?.t.disconnect();
  link = null;
  setConnected(false, t('Not connected'));
}

// Keep the screen on during a sync: a web app pauses when the iPad goes to sleep.
async function keepAwake() {
  try { return await navigator.wakeLock?.request('screen'); } catch (e) { return null; }
}

export async function sync() {
  const out = $('syncStatus');
  return withDevice(async () => {
    const lock = await keepAwake();
    try { await runSync(out); } finally { lock?.release?.().catch(() => {}); }
  }, () => {
    out.textContent = t('The reminder device is busy. Try again in a moment.');
  });
}

async function runSync(out) {
  if (!link || !link.t.connected) {
    out.textContent = t('Connecting…');
    if (!(await connectDevice())) { out.textContent = t('Not synced. Connect the device first.'); return; }
  }
  try {
    const info = await link.hello(); // also refreshes counts and the packet size
    await link.setTime();
    out.textContent = useWifi() ? t('Syncing over Wi-Fi… please keep this screen open.') : t('Syncing… please keep this screen open and the device close by.');

    // 0. v3: an untouched planner (new iPad, Safari cleared, new Home Screen icon) and a copy on the device:
    //    offer to put her planner back, before anything is sent.
    let restored = false;
    if ((info.version || 0) >= 3 && !ctx.state.touched) {
      const copy = await link.getState().catch(() => null);
      if (copy && confirm(t('Your planner has a copy on the device (saved {date}). Put it back on this iPad?', { date: fmtDate(new Date(copy.savedAt), { month: 'long', day: 'numeric' }) }))) {
        keepSafetyCopy(ctx.state, 'before a restore');
        const state = await unpackState(copy.bytes);
        commit({ ...state, touched: true });
        restored = true;
      }
    }

    // 1. Week: send it, unless this app is empty and the device still has a copy (then restore).
    let weekMsg = '';
    if (ctx.weekOffset === 0 && isScheduleEmpty(ctx.state.schedule) && info.scheduleCount > 0) {
      if (confirm(t('This planner is empty, but the device still has {n} activities. Restore them from the device?', { n: info.scheduleCount }))) {
        const lines = await link.getBackup();
        const { schedule, library } = linesToSchedule(lines, ctx.state.library);
        commit({ ...ctx.state, schedule, library });
        weekMsg = t('Restored {n} activities from the device.', { n: lines.length });
      } else {
        weekMsg = t('Nothing sent: the empty planner did not overwrite the device.');
      }
    } else {
      const lines = scheduleToLines(scheduleFor(0)); // always this week, even while another week is on screen
      if (lines.length > MAX_DEVICE_ACTIVITIES) {
        weekMsg = t('The device holds {max} activities; this week has {n}. Only the first {max} were sent.', { max: MAX_DEVICE_ACTIVITIES, n: lines.length }) + ' ';
        lines.length = MAX_DEVICE_ACTIVITIES;
      }
      out.textContent = t('Sending your week…');
      // Clock times go as a 5th field only to firmware that understands them (protocol v2).
      const timed = scheduleToLines(scheduleFor(0), { times: (info.version || 0) >= 2 }).slice(0, lines.length);
      await link.sendSchedule(timed);
      commit({ ...ctx.state, deviceSync: { at: Date.now(), sig: deviceSignature({ schedule: scheduleFor(0) }) } });
      weekMsg += t('Week sent ({n} activities).', { n: lines.length });
      const quiet = quietLines(scheduleFor(0), ctx.state.library);
      if (quiet.length && (await link.sendQuiet(quiet))) weekMsg += ' ' + t(quiet.length > 1 ? '{n} quiet times sent.' : '{n} quiet time sent.', { n: quiet.length });
    }

    // 1b. v3: the full copy of the planner on the device (also done automatically after changes).
    if ((info.version || 0) >= 3) {
      await link.sendState(await packState(ctx.state));
      ctx.state.deviceBackup = { at: Date.now(), sig: backupSig(ctx.state) };
      if (restored) weekMsg = t('Your planner was put back from the device.') + ' ' + weekMsg;
    }

    // 2. Voice notes: copy each one, check it, then let the device delete it.
    const collected = await collectNotes(link, (i, n, p) => { out.textContent = t('Collecting voice note {i} of {n}… {p} % (keep this screen open)', { i, n, p }); });
    out.textContent = `${t('Synced at {time}.', { time: fmtTime(new Date()) })} ${weekMsg}${collected ? ' ' + t(collected > 1 ? '{n} voice notes collected.' : '{n} voice note collected.', { n: collected }) : ''}`;
    renderDemoPanel();
    updateCount();

    // 3. Understand the new notes (can take a moment the first time: the speech model downloads once).
    if (collected) {
      toast(t('Listening to the voice notes from the device… keep this screen open.'), 4000);
      const lock = await keepAwake();
      const done = await processAll().finally(() => lock?.release?.().catch(() => {}));
      const waiting = done.filter((n) => n?.status === 'confirm').length;
      toast(waiting ? t('Voice notes understood. Press “Do them” on the week to make the changes.') : t('Voice notes saved. Some need sorting in “Voice notes”.'), 6000);
      refreshWaiting();
      renderVoiceView();
    }
  } catch (err) {
    out.textContent = t('Sync stopped: {error} Nothing was lost; try again.', { error: err.message });
  }
}

// ---------- demo device panel ----------

export function renderDemoPanel() {
  const body = $('demoDeviceBody');
  if (!useDemo()) { body.innerHTML = `<p class="muted">${t('Off. Turn on “Demo device” in Settings to test without hardware.')}</p>`; return; }
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
    toast(t('“{name}” is waiting on the demo device.', { name: file.name }));
    renderDemoPanel();
  };
  $('demoClearBtn').onclick = () => { FakeTransport.clearSchedule(); toast(t('Demo device week erased.')); renderDemoPanel(); };
}

// ---------- connection choice + Wi-Fi setup ----------

const saveSettings = (changes) => commit({ ...ctx.state, settings: { ...ctx.state.settings, ...changes } });

export function renderConnection() {
  const s = ctx.state.settings;
  $('connectionSelect').value = s.connection === 'wifi' ? 'wifi' : 'bluetooth';
  $('wifiPanel').classList.toggle('hidden', s.connection !== 'wifi');
  $('deviceHelp').textContent = useDemo()
    ? t('The demo device is on (Settings): Connect and Sync use the pretend device.')
    : s.connection === 'wifi'
      ? t('Works in any browser, including Safari on iPad. The device must be switched on and connected to Wi-Fi.')
      : t('On iPad, open this planner in the Bluefy browser to use Bluetooth. On a laptop, use Chrome or Edge.');
  const w = s.wifi || {};
  $('wifiCodeShow').textContent = normalizeCode(w.code) || '—';
  // Fill the fields only when not being typed in.
  if (document.activeElement?.closest?.('#wifiPanel') == null) {
    $('wifiCode').value = w.code || '';
    $('wifiBroker').value = w.broker || '';
    $('wifiUser').value = w.username || '';
    $('wifiPass').value = w.password || '';
  }
}

function readWifiForm() {
  const typed = $('wifiCode').value.trim();
  const code = normalizeCode(typed);
  if (typed && !code) { toast(t('The pairing code has 12 letters and digits, like ABCD-EFGH-JKLM.')); return null; }
  return { code, broker: $('wifiBroker').value.trim(), username: $('wifiUser').value.trim(), password: $('wifiPass').value };
}

function saveWifi() {
  const wifi = readWifiForm();
  if (!wifi) return null;
  disconnect();
  saveSettings({ wifi });
  return wifi;
}

async function testWifi() {
  const wifi = saveWifi();
  if (!wifi) return;
  const out = $('wifiStatus');
  out.textContent = t('Testing…');
  const tr = new MqttTransport(wifi);
  try {
    await tr.connect();
    out.textContent = tr.deviceOnline === true ? t('Relay reached. The device is online: you can Sync now.')
      : tr.deviceOnline === false ? t('Relay reached. The device is offline right now (switched off or not on Wi-Fi).')
        : t('Relay reached. The device has not connected with this pairing code yet.');
  } catch (err) {
    out.textContent = err.message;
  } finally { tr.disconnect(); }
}

export function wireConnection() {
  $('connectionSelect').onchange = (e) => { disconnect(); saveSettings({ connection: e.target.value }); renderConnection(); };
  $('wifiNewCode').onclick = () => {
    if (normalizeCode(ctx.state.settings.wifi?.code) && !confirm(t('Make a new pairing code? The device will need the new code too.'))) return;
    $('wifiCode').value = newPairingCode();
    saveWifi();
    renderConnection();
    toast(t('New pairing code made. Type it into the device setup page.'));
  };
  $('wifiSave').onclick = () => { if (saveWifi()) { renderConnection(); toast(t('Wi-Fi setup saved.')); } };
  $('wifiTest').onclick = testWifi;
}

// ---------- Automatic copy of the planner on the device (v3) ----------
// Team decision, Nov 2026: backups must be automatic, she should never have to deal with them, and her data
// must never be at risk. A few seconds after a change, when the device can be reached without her doing
// anything (Wi-Fi set up, the demo device, or Bluetooth already connected), the whole planner is copied to it.
// Over Wi-Fi it is end-to-end encrypted (device-wifi.js); the device keeps the copy and the one before it.
let backupTimer = null;
const BACKUP_DELAY_MS = 20000;

const wifiReady = () => ctx.state.settings.connection === 'wifi' && ctx.state.settings.wifi?.broker && normalizeCode(ctx.state.settings.wifi?.code);

export function scheduleAutoBackup() {
  if (isDemo() || !ctx.state.touched || (link?.t.connected && link.version < 3)) return;
  if (ctx.state.deviceBackup?.sig === backupSig(ctx.state)) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(runAutoBackup, BACKUP_DELAY_MS);
}

async function quietLink() {
  if (link?.t.connected) return link;
  if (!useDemo() && !wifiReady()) return null; // Bluetooth needs her tap to connect: wait for the next Sync
  const transport = makeTransport();
  try {
    await transport.connect();
    if (useWifi() && transport.deviceOnline === false) { transport.disconnect(); return null; }
    const l = new DeviceLink(transport);
    l.info = await l.hello();
    link = l;
    transport.onDisconnect = () => { if (link === l) link = null; };
    return l;
  } catch (error) {
    transport.disconnect();
    throw error;
  }
}

export async function runAutoBackup() {
  if (isDemo() || !ctx.state.touched) return false;
  return withDevice(async () => {
    try {
      const l = await quietLink();
      if (!l || l.version < 3) return false;
      const sig = backupSig(ctx.state);
      if (ctx.state.deviceBackup?.sig === sig) return true;
      await l.sendState(await packState(ctx.state));
      ctx.state.deviceBackup = { at: Date.now(), sig };
      renderBackupLine();
      return true;
    } catch (error) {
      console.warn('Automatic copy to the device not done this time:', error.message);
      return false;
    }
  }, () => {
    scheduleAutoBackup();
    return false;
  });
}

// The save line in the top bar shows when the device last got a copy (main.js draws the rest).
export function renderBackupLine() { document.dispatchEvent(new CustomEvent('pwr-backup')); }

// Copy every voice note waiting on the device, check it, then let the device delete it. Returns how many.
async function collectNotes(l, onProgress) {
  console.log("[SYNC] Requesting note list");
  const notes = await l.listNotes();
  console.log("[SYNC] Available notes:", notes);

  let collected = 0;
  for (const n of notes) {
    console.log(`[SYNC] Starting note ${n.id}`);

    try {
      const bytes = await l.getNote(n.id, (p) => {
        onProgress?.(collected + 1, notes.length, Math.round(p * 100));
      });

      console.log(`[SYNC] Note ${n.id} received`);
      console.log("[SYNC] Received bytes:", bytes.length);

      const audio = toPlayableWav(bytes.buffer);
      console.log("[SYNC] WAV conversion successful");

      await saveNote({
        source: 'device',
        bytes: audio.buffer,
        mime: audio.mime,
        recordedAt: n.time ? n.time * 1000 : Date.now()
      });
      console.log(`[SYNC] Note ${n.id} saved locally`);

      console.log("[SYNC] Sending deletion request");
      await l.deleteNote(n.id);
      console.log(`[SYNC] Note ${n.id} acknowledged`);

      collected++;
      console.log(`[SYNC] Completed ${collected}/${notes.length} notes`);
    } catch (error) {
      console.error(`[SYNC] Failed on note ${n.id}:`, error);
      throw error;
    }
  }

  return collected;
}

// ---------- Voice notes from the device, picked up by themselves over Wi-Fi (team decision, Nov 2026) ----------
// While the planner is open and Wi-Fi is set up, it looks for new notes on the device every few minutes, so she
// never has to press Sync: they are understood on this iPad and wait for her one-tap OK ("Do them" on the week).
const NOTE_CHECK_MS = 3 * 60 * 1000;
let pickupStarted = false;
export function startNotePickup() {
  if (pickupStarted) return;
  pickupStarted = true;
  const check = async () => {
    if (document.visibilityState !== 'visible' || isDemo() || !wifiReady()) return;
    await withDevice(async () => {
      const wakeLock = await keepAwake();
      try {
        const l = await quietLink();
        if (!l || l.version < 1) return;
        if (await collectNotes(l)) {
          updateCount();
          await processAll();
          refreshWaiting();
          renderVoiceView();
        }
      } catch (error) {
        console.warn('Voice notes not picked up this time:', error.message);
      } finally {
        wakeLock?.release?.().catch(() => {});
      }
    });
  };
  setInterval(check, NOTE_CHECK_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(check, 5000); });
  setTimeout(check, 15000);
}
