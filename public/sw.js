const CACHE = 'apt-mgr-v2'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(
  // Drop the old cache, which held signed-in pages and auth redirects
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
))

// Only cache immutable static assets. Pages, RSC payloads and auth routes always go to the
// network so login/logout and redirects are never served stale.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)
  if (url.origin !== self.location.origin) return
  if (!url.pathname.startsWith('/_next/static/') && url.pathname !== '/icon.svg') return
  e.respondWith(
    caches.match(e.request).then(cached => cached ?? fetch(e.request).then(r => {
      if (r.ok) {
        const clone = r.clone()
        caches.open(CACHE).then(c => c.put(e.request, clone))
      }
      return r
    }))
  )
})

// Web push: show the alert, and open (or focus) the app on click.
self.addEventListener('push', e => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data ? e.data.text() : '' } }
  e.waitUntil(self.registration.showNotification(data.title || 'Apartment Manager', {
    body: data.body || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag,
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin)
  if (target.origin !== self.location.origin) return
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.navigate(target.href).then(c => (c || client).focus())
        }
      }
      return self.clients.openWindow(target.href)
    })
  )
})
