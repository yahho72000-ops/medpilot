// オフラインでも動くように、アプリ本体を iPhone に保存しておく仕組み
// アプリを更新したら VERSION を上げる（開いたときに自動で入れ替わる）

const VERSION = 'medpilot-0.7.2';
const FILES = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/main.js',
  './js/util.js',
  './js/db.js',
  './js/crypto.js',
  './js/store.js',
  './js/model.js',
  './js/labs.js',
  './js/router.js',
  './js/ui.js',
  './js/actions.js',
  './js/meds.js',
  './js/clinical.js',
  './js/notify.js',
  './js/nutrition.js',
  './js/nutriUI.js',
  './js/handoff.js',
  './js/backup.js',
  './js/demo.js',
  './js/screens/common.js',
  './js/screens/menu.js',
  './js/screens/er.js',
  './js/screens/inpatient.js',
  './js/screens/lab.js',
  './js/screens/culture.js',
  './js/screens/summary.js',
  './js/summary.js',
  './js/screens/graph.js',
  './js/screens/handoff.js',
  './js/screens/followup.js',
  './js/screens/settings.js',
  './js/screens/lock.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
