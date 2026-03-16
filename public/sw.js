const CACHE_NAME = 'fund-tracker-v1';
const ASSETS = [
  '',
  'index.html',
  'manifest.json'
];

 安装时预缓存基础文件
self.addEventListener('install', (event) = {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) = cache.addAll(ASSETS))
  );
});

 拦截请求，优先使用缓存
self.addEventListener('fetch', (event) = {
  event.respondWith(
    caches.match(event.request).then((response) = {
      return response  fetch(event.request);
    })
  );
});