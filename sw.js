const CACHE = 'precrias-v3';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/apple-touch-icon.svg',
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      return Promise.allSettled(ASSETS.map(url => c.add(url).catch(() => {})));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  if (e.request.url.includes('firebasejs') || e.request.url.includes('firestore') || e.request.url.includes('googleapis.com/identitytoolkit')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type !== 'opaque') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

/* ══════════════════════════════════════════
   PERSISTENT NOTIFICATIONS
   Notifications that work even when app is closed
══════════════════════════════════════════ */

function openNotifDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('NervNotifs', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('scheduled'))
        db.createObjectStore('scheduled', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror = () => rej(req.error);
  });
}

async function getPendingNotifs() {
  const db = await openNotifDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('scheduled', 'readonly');
    const req = tx.objectStore('scheduled').getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = () => rej(req.error);
  });
}

async function clearFiredNotifs(ids) {
  const db = await openNotifDB();
  const tx = db.transaction('scheduled', 'readwrite');
  const store = tx.objectStore('scheduled');
  for (const id of ids) store.delete(id);
}

async function fireScheduledNotifs() {
  try {
    const notifs = await getPendingNotifs();
    const now = Date.now();
    const fired = [];
    for (const n of notifs) {
      if (n.fireAt <= now) {
        await self.registration.showNotification(n.title, {
          body: n.body,
          icon: './icons/icon.svg',
          badge: './icons/icon.svg',
          tag: n.tag || 'nerv-' + n.id,
          vibrate: [200, 100, 200],
          requireInteraction: true,
          data: { url: './' }
        });
        fired.push(n.id);
      }
    }
    if (fired.length) await clearFiredNotifs(fired);
  } catch (e) {
    console.warn('SW fireScheduledNotifs:', e);
  }
}

self.addEventListener('message', async e => {
  if (e.data && e.data.type === 'SHOW_NOTIF') {
    await self.registration.showNotification(e.data.title, {
      body: e.data.body,
      icon: './icons/icon.svg',
      badge: './icons/icon.svg',
      tag: e.data.tag || 'nerv-alert',
      vibrate: [200, 100, 200],
      requireInteraction: e.data.persist || false,
      data: { url: './' }
    });
  }

  if (e.data && e.data.type === 'SCHEDULE_NOTIF') {
    try {
      const db = await openNotifDB();
      const tx = db.transaction('scheduled', 'readwrite');
      tx.objectStore('scheduled').put({
        title: e.data.title,
        body: e.data.body,
        tag: e.data.tag,
        fireAt: e.data.fireAt
      });
    } catch (err) {
      console.warn('SW schedule error:', err);
    }
  }

  if (e.data && e.data.type === 'CHECK_SCHEDULED') {
    await fireScheduledNotifs();
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cls => {
      for (const c of cls) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return clients.openWindow(e.notification.data?.url || './');
    })
  );
});

self.addEventListener('periodicsync', e => {
  if (e.tag === 'nerv-check-alerts') {
    e.waitUntil(fireScheduledNotifs());
  }
});
