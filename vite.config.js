// Vite build configuration: React plugin, path aliases, proxy, PWA and mobile build optimization
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'http'
import https from 'https'
import tls from 'tls'

// ── 系统代理 + DoH DNS 解析 ──
// 根因链：公司 DNS 劫持 → 198.18.0.x 假 IP → Node.js 直连假 IP 被拒
// 修复：阿里 DoH 解析真实 IP → 通过用户本地代理 (FlClash:7890) 的 CONNECT 隧道直连真实 IP
const SYSTEM_PROXY = (() => {
  if (process.env.HTTPS_PROXY) return process.env.HTTPS_PROXY;
  if (process.env.HTTP_PROXY) return process.env.HTTP_PROXY;
  if (process.env.https_proxy) return process.env.https_proxy;
  if (process.env.http_proxy) return process.env.http_proxy;
  return null;
})();

const dnsCache = new Map(); // hostname → { ip, ts }

const resolveRealIP = (hostname) => {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.ts < 300000) return Promise.resolve(cached.ip); // 5min cache

  // 阿里云 DoH（国内可达，Google DNS 被墙）
  return new Promise((resolve, reject) => {
    const dohUrl = `https://dns.alidns.com/resolve?name=${hostname}&type=A`;
    https.get(dohUrl, { headers: { 'Accept': 'application/dns-json' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const ip = JSON.parse(d).Answer?.[0]?.data;
          if (ip) {
            dnsCache.set(hostname, { ip, ts: Date.now() });
            resolve(ip);
          } else { reject(new Error(`No A record for ${hostname}`)); }
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
};

// 通过本地代理的 CONNECT 隧道发起 HTTPS 请求
const proxyFetch = async (targetUrlStr) => {
  const target = new URL(targetUrlStr);
  const targetHost = target.hostname;
  const targetPort = target.port || 443;

  // 解析真实 IP（绕过公司 DNS 劫持）
  let connectHost = targetHost;
  try {
    connectHost = await resolveRealIP(targetHost);
    console.log(`[em-proxy] ${targetHost} → ${connectHost}`);
  } catch (e) {
    console.warn(`[em-proxy] DoH resolve failed for ${targetHost}, using hostname:`, e.message);
    // fallback: 使用 hostname（系统代理可能自己解析）
  }

  return new Promise((resolve, reject) => {
    if (!SYSTEM_PROXY) {
      // 无代理：直接 Node.js 原生 fetch（不走隧道）
      fetch(targetUrlStr, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
          'Referer': 'https://quote.eastmoney.com/',
        },
        signal: AbortSignal.timeout(10000),
      }).then(resolve).catch(reject);
      return;
    }

    const proxy = new URL(SYSTEM_PROXY);
    const timer = setTimeout(() => reject(new Error('Proxy timeout (12s)')), 12000);

    const conReq = http.request({
      hostname: proxy.hostname,
      port: proxy.port || 3128,
      method: 'CONNECT',
      path: `${connectHost}:${targetPort}`,
    });

    conReq.on('connect', (conRes, socket) => {
      clearTimeout(timer);
      if (conRes.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT returned ${conRes.statusCode}`));
        return;
      }

      // TLS 握手（通过代理隧道）
      const tlsSocket = tls.connect({
        socket,
        servername: targetHost, // SNI 用真实域名（非 IP）
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
      }, () => {
        // TLS 握手成功，发送 HTTP 请求
        const requestLines = [
          `GET ${target.pathname}${target.search} HTTP/1.1`,
          `Host: ${targetHost}`,
          'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept: application/json, text/plain, */*',
          'Accept-Language: zh-CN,zh;q=0.9,en;q=0.7',
          'Accept-Encoding: gzip, deflate, br',
          'Referer: https://quote.eastmoney.com/',
          'Cache-Control: no-cache',
          'Connection: close',
          '', ''
        ];
        tlsSocket.write(requestLines.join('\r\n'));
      });

      // 读取响应
      const chunks = [];
      tlsSocket.on('data', c => chunks.push(c));
      tlsSocket.on('end', () => {
        const full = Buffer.concat(chunks);
        const headerEnd = full.indexOf('\r\n\r\n');
        const headStr = full.slice(0, headerEnd).toString('utf-8');
        const body = full.slice(headerEnd + 4);

        const statusMatch = headStr.match(/HTTP\/\d\.\d (\d+)/);
        const status = statusMatch ? parseInt(statusMatch[1]) : 502;

        resolve({
          ok: status >= 200 && status < 400,
          status,
          arrayBuffer: () => Promise.resolve(body),
          text: () => Promise.resolve(body.toString('utf-8')),
        });
      });

      tlsSocket.on('error', (e) => {
        reject(new Error(`TLS/HTTP error: ${e.message}`));
      });
    });

    conReq.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`CONNECT failed: ${e.message}`));
    });
    conReq.end();
  });
};

// 通过系统代理的 CONNECT 隧道发起任意 HTTP(S) 请求（GET/POST 通用）
const proxyAwareRequest = async (targetUrlStr, method = 'GET', headers = {}, body = null) => {
  if (!SYSTEM_PROXY) {
    const opts = { method, headers, signal: AbortSignal.timeout(120000) };
    if (body != null) opts.body = JSON.stringify(body);
    return fetch(targetUrlStr, opts);
  }

  const target = new URL(targetUrlStr);
  const targetPort = target.port || 443;
  const proxy = new URL(SYSTEM_PROXY);
  const timer = setTimeout(() => Promise.reject(new Error('Proxy timeout (12s)')), 12000);

  return new Promise((resolve, reject) => {
    const conReq = http.request({
      hostname: proxy.hostname,
      port: proxy.port || 3128,
      method: 'CONNECT',
      path: `${target.hostname}:${targetPort}`,
    });

    conReq.on('connect', (conRes, socket) => {
      clearTimeout(timer);
      if (conRes.statusCode !== 200) {
        reject(new Error(`Proxy CONNECT returned ${conRes.statusCode}`));
        return;
      }

      const tlsSocket = tls.connect({ socket, servername: target.hostname, rejectUnauthorized: false, minVersion: 'TLSv1.2' }, () => {
        const bodyStr = body ? JSON.stringify(body) : '';
        const requestLines = [
          `${method} ${target.pathname}${target.search} HTTP/1.1`,
          `Host: ${target.hostname}`,
          ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
          'Connection: close',
          ...(bodyStr ? ['Content-Length: ' + Buffer.byteLength(bodyStr), '', bodyStr] : ['', ''])
        ];
        tlsSocket.write(requestLines.join('\r\n'));
      });

      const chunks = [];
      tlsSocket.on('data', c => chunks.push(c));
      tlsSocket.on('end', () => {
        const full = Buffer.concat(chunks);
        const headerEnd = full.indexOf('\r\n\r\n');
        const headStr = full.slice(0, headerEnd).toString('utf-8');
        const resBody = full.slice(headerEnd + 4);
        const statusMatch = headStr.match(/HTTP\/\d\.\d (\d+)/);
        resolve({
          ok: statusMatch ? parseInt(statusMatch[1]) >= 200 && parseInt(statusMatch[1]) < 400 : false,
          status: statusMatch ? parseInt(statusMatch[1]) : 502,
          arrayBuffer: () => Promise.resolve(resBody),
          text: () => Promise.resolve(resBody.toString('utf-8')),
          json: () => Promise.resolve(JSON.parse(resBody.toString('utf-8'))),
        });
      });
      tlsSocket.on('error', e => { clearTimeout(timer); reject(e); });
    });
    conReq.on('error', e => { clearTimeout(timer); reject(e); });
    conReq.end();
  });
};
// 同源请求 → Vite 中间件读取目标 URL → 服务端直连 AI API → 返回 CORS 响应
// 对应 public/sw.js 中的 /api/ai-proxy 端点，两者路径一致
const aiProxyMiddleware = () => {
  return {
    name: 'ai-proxy-middleware',
    configureServer(server) {
      server.middlewares.use('/api/ai-proxy', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Anthropic-Version, Anthropic-Beta');
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405; res.end('Method Not Allowed'); return;
        }

        // 读取请求体
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const { url: targetUrl, headers: reqHeaders, body } = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
        if (!targetUrl) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing target URL' })); return; }
        if (!body) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing request body' })); return; }

        try {
          const fetchHeaders = { 'Content-Type': 'application/json' };
          if (reqHeaders?.Authorization) fetchHeaders['Authorization'] = reqHeaders.Authorization;
          if (reqHeaders?.Accept) fetchHeaders['Accept'] = reqHeaders.Accept;
          if (reqHeaders?.['anthropic-version']) fetchHeaders['anthropic-version'] = reqHeaders['anthropic-version'];
          if (reqHeaders?.['anthropic_beta']) fetchHeaders['anthropic-beta'] = reqHeaders['anthropic_beta'];

          const response = await proxyAwareRequest(targetUrl, 'POST', fetchHeaders, body);

          const responseBody = await response.arrayBuffer();

          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Content-Type', 'application/json;charset=UTF-8');
          res.statusCode = response.status;
          res.end(Buffer.from(responseBody));
        } catch (e) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json;charset=UTF-8');
          res.statusCode = 502;
          res.end(JSON.stringify({ error: `AI proxy failed: ${e.message}` }));
        }
      });
    }
  };
};

// ── 东财数据本地代理中间件 ──
const emProxyMiddleware = () => {
  return {
    name: 'em-proxy-middleware',
    configureServer(server) {
      server.middlewares.use('/api/em-proxy', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          res.statusCode = 405; res.end('Method Not Allowed'); return;
        }

        const targetUrl = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!targetUrl) {
          res.statusCode = 400; res.end(JSON.stringify({ error: 'Missing url' })); return;
        }

        let targetHost;
        try { targetHost = new URL(targetUrl).hostname; } catch {
          res.statusCode = 400; res.end(JSON.stringify({ error: 'Invalid URL' })); return;
        }

        const allowed = ['eastmoney.com', 'gtimg.cn', 'sina.com.cn', 'sinajs.cn',
          '10jqka.com.cn', '163.com', 'cls.cn', 'jin10.com'];
        if (!allowed.some(d => targetHost.includes(d))) {
          res.statusCode = 403; res.end(JSON.stringify({ error: 'Domain not allowed' })); return;
        }

        try {
          const response = await proxyFetch(targetUrl);
          const body = await response.arrayBuffer();

          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Content-Type', 'application/json;charset=UTF-8');
          res.statusCode = response.status;
          res.end(Buffer.from(body));
        } catch (e) {
          console.warn(`[em-proxy] ${targetHost} 失败:`, e.message);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Content-Type', 'application/json;charset=UTF-8');
          res.statusCode = 502;
          res.end(JSON.stringify({ error: 'Proxy fetch failed', details: e.message }));
        }
      });
    }
  };
};

export default defineConfig({
  base: './',
  plugins: [react(), emProxyMiddleware(), aiProxyMiddleware()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.js'],
    include: ['src/test/**/*.test.{js,jsx}']
  }
})
