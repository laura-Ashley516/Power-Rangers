// Service worker: offline-first.
// - Keeps the app's own files on the device, so the planner opens without internet.
// - Keeps the speech library (from jsDelivr) too; the Whisper model files are cached by the library itself.
// - Updates: a new version installs in the background and is used the next time the planner is opened.
//   Change CACHE when you publish a new version.
//
// Track: B - Data + device

const CACHE = 'pwr-app-0.4.4';
const RUNTIME = 'pwr-runtime';
const APP_FILES = [
  './', './index.html', './manifest.json', './css/styles.css',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './js/main.js', './js/config.js', './js/context.js', './js/store.js', './js/rules.js', './js/ui-kit.js',
  './js/ui-week.js', './js/ui-daily.js', './js/ui-library.js', './js/ui-device.js', './js/print.js', './js/device.js',
  './js/voice/parser.js', './js/voice/transcribe.js', './js/voice/whisper-worker.js', './js/voice/notes.js',
  './js/voice/recorder.js', './js/voice/inbox.js', './js/voice/wav.js',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' = always fetch fresh files from the network, never an older copy the browser kept.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' })))));
  // No skipWaiting(): the new version waits until the planner is closed, so nothing changes mid-use.
});

// The page's "Use it now" button asks the waiting version to take over.
self.addEventListener('message', (event) => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App files: from the device first, then the network.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match('./index.html'))),
    );
    return;
  }

  // Speech library (jsDelivr): use the saved copy, refresh it in the background when online.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      const network = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || network;
    }));
  }
  // Everything else (e.g. the model files from Hugging Face) is handled by the browser and the speech library's own cache.
});
