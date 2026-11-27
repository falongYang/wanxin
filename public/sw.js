/* 晚信 Service Worker（M6 PWA）
   策略：带 hash 的静态资源 cache-first（永不重复下载），
   index.html network-first（保新），/api/ 永不缓存。
   注册处仅在生产构建启用（dev 不受影响）。 */
const CACHE = 'wanxin-v1'
const STATIC = self.location.pathname.replace(/sw\.js$/, '')

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(STATIC + 'index.html')).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.pathname.includes('/api/')) return
  if (url.origin !== self.location.origin) return
  const isHashed = /-[A-Za-z0-9_-]{8}\.(js|css|png)$/.test(url.pathname)
  if (isHashed || /\.(png|webmanifest)$/.test(url.pathname)) {
    // 静态资源：cache-first，命中后静默补网（不做，hash 资源不变）
    event.respondWith(
      caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put(event.request, copy))
        return response
      }).catch(() => hit))
    )
    return
  }
  // 页面与同源导航：network-first，离线时回退缓存
  event.respondWith(
    fetch(event.request).then(response => {
      if (event.request.mode === 'navigate') {
        const copy = response.clone()
        caches.open(CACHE).then(cache => cache.put(STATIC + 'index.html', copy))
      }
      return response
    }).catch(() => caches.match(STATIC + 'index.html'))
  )
})
