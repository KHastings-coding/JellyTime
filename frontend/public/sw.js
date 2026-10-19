// Bump when the caching rules change; activate deletes every other cache.
const CACHE = 'jt-v2';

// PWA lifecycle handlers
self.addEventListener('install', event => {
  event.waitUntil(
    self.skipWaiting()
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
    console.log('Service Worker activated and old caches cleared');
  })());
});

// Fetch: network-first for API and pages, cache-first for hashed assets
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // API requests and the app page itself: network-first, so a new deploy shows up
  // on the next open (the page names the current hashed bundle)
  if (url.pathname.startsWith('/api/') ||
      url.pathname === '/' ||
      request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets: cache-first (bundle filenames change on every build)
  if (url.pathname.startsWith('/static/') ||
      url.pathname.startsWith('/icon-') ||
      url.pathname === '/manifest.json') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else: network-first
  event.respondWith(networkFirst(request));
});

// Network first strategy - try network, fallback to cache
async function networkFirst(request) {
  const networkResponse = await fetch(request).catch(() => null);

  const cached = caches.match(request);
  return networkResponse || cached;
}

// Cache first strategy for static assets
async function cacheFirst(request) {
  const response = await caches.match(request);
  if (response) return response;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const clone = networkResponse.clone();
      const cache = caches.open(CACHE).then(cache => {
        cache.put(request, clone);
      });
      await cache; // wait for cache write
      return networkResponse;
    }
  } catch (error) {
    console.error('Network fetch error:', error);
  }

  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// Handle messages from main thread - request permissions and fullscreen
self.addEventListener('message', async event => {
  if (event.data?.action === 'initFullscreen') {
    // Request notifications permission on first launch
    if ('Notification' in self && self.Notification.permission === 'default') {
      self.Notification.requestPermission();
    }

    // Android Chrome needs to fetch VAPID key and subscribe when available
    try {
      const vapidResponse = await fetch('/api/push/vapid-key');
      if (vapidResponse.ok) {
        const vapidData = await vapidResponse.json();

        // Subscribe using authenticator tokens for Android 9+
        if ('pushManager' in self.registration) {
          const pushManager = self.registration.pushManager;
          try {
            const subscription = await pushManager.getSubscription();
            console.log('Current push subscription:', subscription);

            // Only subscribe if no existing subscription
            if (!subscription && 'subscribe' in pushManager) {
              const sub = await pushManager.subscribe({
                publicKey: vapidData.publicKey,
                authenticator: true,
              });
              console.log('Push subscription created on Android:', sub?.endpoint);
            }
          } catch (subErr) {
            console.error('Subscribe error:', subErr);
          }
        }
      }
    } catch (err) {
      console.error('VAPID init error:', err);
    }
  }
});

self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'JellyTime', {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'chore-pending',
      renotify: true,
      data: { url: data.url || '/parent/chores' },
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
