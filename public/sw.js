// PWA Service Worker：离线缓存策略 — 预缓存静态资源 + 网络优先回退缓存，支持推送通知
const CACHE_NAME = 'fund-tracker-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // 逐文件缓存，失败不阻塞 SW 激活（asset 缺失时跳过，核心代理功能不受影响）
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// ── 东财数据 Service Worker 代理 — 浏览器直连，零外部依赖，无 CORS 限制 ──
// 拦截 /api/em-proxy?url=<encoded_url>，转发到东财并附加完整 CORS 响应头
// 优势：东财看到用户真实 IP（非机房 IP），不触发 JSONP 检测（非 <script> 注入）
const EM_PROXY_PATH = '/api/em-proxy';
const EM_DOMAINS = ['push2.eastmoney.com', 'push2his.eastmoney.com', 'fundmobapi.eastmoney.com', 'api.fund.eastmoney.com'];

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ── AI API 反向代理 — SW 直连，绕过浏览器 CORS 限制 ──
  if (url.pathname === '/api/ai-proxy' && event.request.method === 'POST') {
    event.respondWith((async () => {
      try {
        const { url: targetUrl, headers: reqHeaders, body } = await event.request.json();
        if (!targetUrl) throw new Error('Missing target URL');
        if (!body) throw new Error('Missing request body');

        const swHeaders = new Headers();
        swHeaders.set('Content-Type', 'application/json');
        if (reqHeaders?.Authorization) swHeaders.set('Authorization', reqHeaders.Authorization);
        if (reqHeaders?.accept) swHeaders.set('Accept', reqHeaders.accept);
        if (reqHeaders?.['anthropic-version']) swHeaders.set('anthropic-version', reqHeaders['anthropic-version']);
        swHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

        const swReq = new Request(targetUrl, {
          method: 'POST',
          headers: swHeaders,
          body: JSON.stringify(body)
        });

        const res = await fetch(swReq);
        const resBody = await res.arrayBuffer();

        return new Response(resBody, {
          status: res.status,
          statusText: res.statusText,
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, anthropic-version, anthropic-beta'
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: `AI proxy failed: ${e.message}` }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    })());
    return;
  }

  // ── 东财 SW 代理路由 ──
  if (url.pathname === EM_PROXY_PATH && url.searchParams.has('url')) {
    event.respondWith((async () => {
      try {
        const targetUrlStr = url.searchParams.get('url');
        const targetUrl = new URL(targetUrlStr);

        // 域名白名单
        if (!EM_DOMAINS.some(d => targetUrl.hostname.includes(d))) {
          return new Response('Forbidden: domain not allowed', { status: 403 });
        }

        // 🌟 push2.eastmoney.com Referer：使用 quote.eastmoney.com 模拟东财自家网页的 API 调用
        // 东财网页 JS 调用 push2 API 时发送的 Referer 即 quote 域名，WAF 将此视为合法来源
        let referer = 'https://quote.eastmoney.com/';
        let ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        if (targetUrl.hostname.includes('fundmobapi')) {
          ua = 'Mozilla/5.0 (Linux; Android 12; SM-G998B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.127 Mobile Safari/537.36 EastMoney/6.6.8';
        } else if (targetUrl.pathname.includes('/stock/get')) {
          // 北向资金端点：需要沪深港通页面 Referer
          referer = 'https://data.eastmoney.com/hsgt/index.html';
        }

        const swReq = new Request(targetUrl, {
          method: 'GET',
          headers: new Headers({
            'User-Agent': ua,
            'Referer': referer,
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
            'Cache-Control': 'no-cache'
          })
        });

        const res = await fetch(swReq);
        const body = await res.arrayBuffer();

        // 构造跨域可读响应
        return new Response(body, {
          status: res.status,
          statusText: res.statusText,
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
          }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'SW proxy failed', details: e.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    })());
    return;
  }

  // Network-First for HTML navigation: ensures fresh index.html after updates
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-First for static assets (JS/CSS/images have hashed filenames)
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// ── Push Notification ──
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    const { title, body, icon, tag, data } = payload;
    event.waitUntil(
      self.registration.showNotification(title || 'Fund Tracker Pro', {
        body: body || '',
        icon: icon || '/icon-192.png',
        badge: '/icon-192.png',
        tag: tag || 'ft-alert',
        data: data || {},
        requireInteraction: true,
        vibrate: [200, 100, 200]
      })
    );
  } catch (e) {
    // fallback: plain text
    event.waitUntil(
      self.registration.showNotification('Fund Tracker Pro', {
        body: event.data.text(),
        icon: '/icon-192.png'
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 如果已有打开的窗口 → 聚焦
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // 否则打开新窗口
      if (clients.openWindow) {
        return clients.openWindow('/');
      }
    })
  );
});
