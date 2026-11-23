// "Add from a photo" (client feedback, Nov 2026): take or choose a photo of a paper schedule, an appointment
// card or a note; the planner reads the text and proposes activities. Nothing is added until she ticks and
// presses "Add".
//
// Steps:
//  1. Prepare the picture (on this iPad): make it smaller if it is huge, grey, and black-and-white with a
//     threshold chosen from the picture itself (Otsu's method), which makes printed and handwritten text
//     easier to read.
//  2. Read the text: Tesseract (open-source text recognition, English + French), run in the browser.
//     It downloads once (about 15 MB), then works without internet. The photo never leaves the iPad.
//  3. Understand the text: photo-parse.js (days, times, activities; sentences go to the voice parser).
//  4. She checks the list, unticks what is wrong, and adds the rest in one step (one Undo).
// The same steps exist in Python for the team (tools/photo_to_schedule.py): its text can be pasted here.
//
// Track: C - Rules + voice

import { ctx, change, undo } from './context.js';
import { uid } from './store.js';
import { $, esc, showPanelModal, closeModal, toast } from './ui-kit.js';
import { parsePhotoText } from './photo-parse.js';
import { t } from './i18n.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let tesseractLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  tesseractLoading = tesseractLoading || new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = TESSERACT;
    sc.onload = () => resolve(window.Tesseract);
    sc.onerror = () => { tesseractLoading = null; reject(new Error(t('The text reader could not be downloaded. Check the internet connection (needed the first time only).'))); };
    document.head.appendChild(sc);
  });
  return tesseractLoading;
}

// Otsu's threshold: the grey level that best separates dark (ink) from light (paper).
export function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, level = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; level = i; }
  }
  return level;
}

async function prepare(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < px.length; i += 4) {
    const y = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = y;
    hist[y]++;
  }
  const level = otsu(hist, px.length / 4);
  for (let i = 0; i < px.length; i += 4) { const v = px[i] > level ? 255 : 0; px[i] = px[i + 1] = px[i + 2] = v; }
  g.putImageData(data, 0, 0);
  return c;
}

export function openPhoto() {
  const modal = showPanelModal(t('Add from a photo'), `
    <p>${t('Take a picture of a paper schedule, an appointment card or a note. The planner reads it and shows what it found. Nothing is added until you choose.')}</p>
    <div class="row" style="margin:12px 0"><label class="file-button primary-file"><input id="photoInput" type="file" accept="image/*"><span>📷 ${t('Take or choose a photo')}</span></label></div>
    <img id="photoPreview" class="photo-preview hidden" alt="">
    <div id="photoStatus" class="notice" role="status" aria-live="polite">${t('The photo stays on this iPad.')}</div>
    <details id="photoTextBox"><summary>${t('The text that was read (you can fix it, or paste text)')}</summary>
      <textarea id="photoText" rows="6" placeholder="${esc(t('e.g.\nMonday\n10:30 Physio\nAfternoon: groceries'))}"></textarea>
      <div class="modal-actions" style="justify-content:flex-start"><button type="button" id="photoUnderstand">${t('Read this text')}</button></div>
    </details>
    <div id="photoResults"></div>
    <div class="modal-actions"><button type="button" id="photoClose">${t('Close')}</button><button type="button" class="primary hidden" id="photoAdd">${t('Add the ticked activities')}</button></div>`);
  const status = $('photoStatus');
  let results = [];

  const understand = () => {
    const text = $('photoText').value;
    results = parsePhotoText(text, { library: ctx.state.library, schedule: ctx.state.schedule, now: new Date(), newId: uid });
    const ok = results.filter((r) => r.ok);
    $('photoResults').innerHTML = results.length ? `<h3 style="margin-top:14px">${t('What I found')}</h3><ul class="balance-list">${results.map((r, i) => r.ok
      ? `<li><label><input type="checkbox" data-photo="${i}" checked><span><b>${esc(r.summary)}</b><small>“${esc(r.line)}”</small></span></label></li>`
      : `<li class="todo"><span>${t('Not used:')} “${esc(r.line)}” <small>${esc(r.reason)}</small></span></li>`).join('')}</ul>` : `<p class="muted">${t('No activity found in this text.')}</p>`;
    $('photoAdd').classList.toggle('hidden', !ok.length);
    status.textContent = ok.length ? t('Untick anything that is wrong, then add.') : t('Nothing to add. Fix the text above, or try a clearer photo.');
  };

  $('photoInput').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $('photoPreview').src = URL.createObjectURL(file);
    $('photoPreview').classList.remove('hidden');
    try {
      status.textContent = t('Preparing the picture…');
      const canvas = await prepare(file);
      status.textContent = t('Getting the text reader ready (first time only, about 15 MB)…');
      const T = await loadTesseract();
      const worker = await T.createWorker(['eng', 'fra'], 1, {
        logger: (m) => { if (m.status === 'recognizing text') status.textContent = t('Reading the text… {p} %', { p: Math.round((m.progress || 0) * 100) }); },
      });
      const { data } = await worker.recognize(canvas);
      await worker.terminate();
      $('photoText').value = data.text.trim();
      $('photoTextBox').open = true;
      understand();
    } catch (err) {
      status.textContent = t('The photo could not be read: {error}', { error: err.message || String(err) });
      $('photoTextBox').open = true;
    }
  };
  $('photoUnderstand').onclick = understand;
  $('photoClose').onclick = closeModal;
  $('photoAdd').onclick = () => {
    const chosen = [...modal.querySelectorAll('[data-photo]:checked')].map((x) => results[Number(x.dataset.photo)]).filter((r) => r?.ok);
    if (!chosen.length) { toast(t('Nothing ticked.')); return; }
    const r = change({ type: 'batch', changes: chosen.map((x) => ({ ...x.change, silentNotice: true })) }, { silent: true });
    closeModal();
    if (r.ok) toast(t(chosen.length > 1 ? '{n} activities added from the photo.' : '{n} activity added from the photo.', { n: chosen.length }), 8000, { label: t('Undo'), run: undo });
    else toast(r.message);
  };
}
