// === my-cors-proxy.js 彻底隐身版 ===
let cachedXueqiuCookie = '';

export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie, x-api-key, accept",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 鉴权：量化端点 + 微观结构端点验证 API Key（通过 Authorization header 或 ?key= 查询参数）
    const QUANT_ROUTES = [
      '/api/quant/covariance', '/api/quant/black-litterman', '/api/quant/ou-half-life',
      '/api/quant/markov-regime', '/api/quant/monte-carlo', '/api/market-microstructure',
      '/api/us-treasury', '/api/news', '/api/worker/search',
      '/api/proxy/rsshub', '/api/proxy/tavily', '/api/proxy/exa', '/api/proxy/serper',
      '/api/sector-capital-flow',
      '/api/bond-yields',
      '/api/macro-data',
      '/api/market-concentration'
    ];
    if (QUANT_ROUTES.some(r => url.pathname === r)) {
      const authHeader = request.headers.get('Authorization') || '';
      const urlKey = url.searchParams.get('key') || '';
      const providedKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : urlKey;
      // 从环境变量读取 API Key（兼容 CF Worker secrets 和 wrangler.toml vars）
      const validKey = (typeof API_KEY !== 'undefined' ? API_KEY :
                        typeof SECRET !== 'undefined' ? SECRET :
                        typeof SYNC_SECRET !== 'undefined' ? SYNC_SECRET : null);
      if (validKey && providedKey !== validKey) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Provide ?key=<API_KEY> or Authorization: Bearer <API_KEY>' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 深度微观结构探测器（独立路由，不走代理）──
    if (request.method === 'GET' && url.pathname === '/api/market-microstructure') {
      try {
        const result = await this.fetchMicrostructure();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, overall_signal: '数据获取失败' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 行业资金流向（东财Push2行业板块资金流，需CORS代理）──
    if (request.method === 'GET' && url.pathname === '/api/sector-capital-flow') {
      try {
        const result = await this.fetchSectorCapitalFlow();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 中国国债收益率曲线（Worker 服务端拉取 chinabond/East Money，无 CORS 限制）──
    if (request.method === 'GET' && url.pathname === '/api/bond-yields') {
      try {
        const result = await this.fetchCNBondYields();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, y1: null, y2: null, y5: null, y10: null }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 宏观数据（M2增速 + 制造业PMI，服务端拉取）──
    if (request.method === 'GET' && url.pathname === '/api/macro-data') {
      try {
        const result = await this.fetchMacroData();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, m2Growth: null, pmiManuf: null }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 市场集中度（TOP50大市值股 vs 等权，指示权重股强拉/砸盘）──
    if (request.method === 'GET' && url.pathname === '/api/market-concentration') {
      try {
        const result = await this.fetchMarketConcentration();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, concentrationRatio: null }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 美国利率与美元指数（Worker 直连 Yahoo Finance，国内不可达）──
    if (request.method === 'GET' && url.pathname === '/api/us-treasury') {
      try {
        const result = await this.fetchUSTreasury();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 量化引擎：协方差矩阵（EWMA）──
    if (request.method === 'POST' && url.pathname === '/api/quant/covariance') {
      try {
        const body = await request.json();
        const result = this.computeCovariance(body);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 量化引擎：Black-Litterman 后验优化 ──
    if (request.method === 'POST' && url.pathname === '/api/quant/black-litterman') {
      try {
        const body = await request.json();
        const result = this.computeBlackLitterman(body);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 量化引擎：O-U 均值回归半衰期 ──
    if (request.method === 'POST' && url.pathname === '/api/quant/ou-half-life') {
      try {
        const body = await request.json();
        const result = this.computeOUHalfLife(body);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 量化引擎：Markov 机制转移 — 市场状态概率 ──
    if (request.method === 'POST' && url.pathname === '/api/quant/markov-regime') {
      try {
        const body = await request.json();
        const result = this.computeMarkovRegime(body);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 量化引擎：蒙特卡洛模拟 — 未来N种路径 ──
    if (request.method === 'POST' && url.pathname === '/api/quant/monte-carlo') {
      try {
        const body = await request.json();
        const result = this.computeMonteCarlo(body);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── 新闻策略代理端点（LLM指定搜索策略，Worker并行执行+处理+去重）──

    // 0. 聚合端点 — LLM 指定 sources + query, Worker 并行拉取+去重+排序
    if (request.method === 'POST' && url.pathname === '/api/news') {
      try {
        const { query, sources, limit = 12 } = await request.json();
        if (!sources || sources.length === 0) throw new Error('Missing sources');
        const allItems = [];
        const tasks = sources.map(async (src) => {
          if (src.startsWith('rsshub:')) {
            const route = src.slice(7);
            return await proxyRSSHub(route, Math.ceil(limit / sources.length));
          }
          if (src.startsWith('sina:')) {
            const topic = src.slice(5);
            const lids = { macro:[2509,2516], market:[2510,2515], bond:[2512,2509], fund:[2513,2509] };
            const results = await Promise.all((lids[topic]||[2509]).map(l => proxySina(l, Math.ceil(limit / sources.length / 2))));
            return results.flat();
          }
          if (src === 'tavily' && query) return await proxyTavily(query, 1, Math.ceil(limit / sources.length));
          if (src === 'serper' && query) return await proxySerper(query, 'qdr:d', Math.ceil(limit / sources.length));
          if (src === 'exa' && query) return await proxyExa(query, Math.ceil(limit / sources.length));
          return [];
        });
        const results = await Promise.all(tasks);
        for (const batch of results) allItems.push(...batch);

        // 去重合并排序
        const seen = new Set();
        const deduped = [];
        for (const item of allItems) {
          if (!seen.has(item.title) && deduped.length < limit + 4) { seen.add(item.title); deduped.push(item); }
        }
        deduped.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
        return new Response(JSON.stringify({
          source: `Worker聚合(${sources.length}源)`, count: Math.min(deduped.length, limit), items: deduped.slice(0, limit)
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // ── 单源代理端点（LLM精细控制单个源时使用）──

    // 1. RSSHub 代理 — LLM 指定 route
    if (request.method === 'POST' && url.pathname === '/api/proxy/rsshub') {
      try {
        const { route, limit = 8 } = await request.json();
        if (!route) throw new Error('Missing route');
        const items = await proxyRSSHub(route, limit);
        return new Response(JSON.stringify({ items }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 2. Tavily 搜索代理 — LLM 指定 query + days
    if (request.method === 'POST' && url.pathname === '/api/proxy/tavily') {
      try {
        const { query, days = 1, maxResults = 6 } = await request.json();
        if (!query) throw new Error('Missing query');
        const items = await proxyTavily(query, days, maxResults);
        return new Response(JSON.stringify({ items }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 3. Exa 深度研报代理 — LLM 指定 query
    if (request.method === 'POST' && url.pathname === '/api/proxy/exa') {
      try {
        const { query, maxResults = 3 } = await request.json();
        if (!query) throw new Error('Missing query');
        const items = await proxyExa(query, maxResults);
        return new Response(JSON.stringify({ items }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── Worker 自主搜索+内容提取（新增，不动现有搜索链路）──
    // LLM 告诉 Worker 搜什么，Worker 搜索→取URL→提取正文→处理→返回
    if (request.method === 'POST' && url.pathname === '/api/worker/search') {
      try {
        const { query, numResults = 3 } = await request.json();
        if (!query) throw new Error('Missing query');
        const results = await this.workerSearch(query, numResults);
        return new Response(JSON.stringify({ query, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 4. Serper (Google) 搜索代理 — LLM 指定 query + timeRange
    if (request.method === 'POST' && url.pathname === '/api/proxy/serper') {
      try {
        const { query, timeRange = 'qdr:d', num = 6 } = await request.json();
        if (!query) throw new Error('Missing query');
        const items = await proxySerper(query, timeRange, num);
        return new Response(JSON.stringify({ items }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const targetUrlStr = url.searchParams.get('url');

    if (!targetUrlStr) {
      return new Response('Missing parameter: url', { status: 400, headers: corsHeaders });
    }

    try {
      const targetUrl = new URL(targetUrlStr);
      
      const allowedDomains = [
        'gtimg.cn', 'sina.com.cn', 'sinajs.cn', 'xueqiu.com',
        '163.com', '1234567.com.cn', 'eastmoney.com', 'danjuanfunds.com',
        'api.exa.ai', 'api.tavily.com', 'google.serper.dev', 'baidu.com', '10jqka.com.',
        'baidubce.com','quickchart.io',
        'cls.cn', 'jin10.com', // 财经快讯 API
        'r.jina.ai' // Jina Reader 全文提取
      ];
      const isAllowed = allowedDomains.some(domain => targetUrl.hostname.includes(domain));
      if (!isAllowed) {
        return new Response(`Forbidden: Target domain not in whitelist`, { status: 403, headers: corsHeaders });
      }

      let referer = 'https://finance.sina.com.cn/'; 
      let charset = 'GBK'; 
      let isXueqiu = false;
      let userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

      if (targetUrl.hostname.includes('gtimg.cn')) {
        referer = 'https://finance.qq.com/';
      } else if (targetUrl.hostname.includes('fundmobapi.eastmoney.com')) {
        referer = ''; 
        charset = 'UTF-8';
        userAgent = 'Mozilla/5.0 (Linux; Android 12; SM-G998B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.127 Mobile Safari/537.36 EastMoney/6.6.8';
      } else if (targetUrl.hostname.includes('api.fund.eastmoney.com')) {
        referer = 'http://fundf10.eastmoney.com/';
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('danjuanfunds.com')) {
        referer = 'https://danjuanfunds.com/';
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('sinajs.cn') || targetUrl.hostname.includes('sina.com.cn')) {
        referer = 'https://finance.sina.com.cn/'; 
      } else if (targetUrl.hostname.includes('xueqiu.com')) {
        referer = 'https://xueqiu.com/';
        charset = 'UTF-8';
        isXueqiu = true;
      } else if (targetUrl.hostname.includes('163.com')) {
        referer = 'https://money.163.com/';
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('api.exa.ai') || targetUrl.hostname.includes('api.tavily.com') || targetUrl.hostname.includes('google.serper.dev')) {
        referer = '';
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('push2.eastmoney.com')) {
        // 🌟 针对东财 push2 API：必须模拟网页内部 XHR 请求
        // 使用 quote.eastmoney.com 域名作为 Referer + Origin，匹配东财网页 JS 的请求模式
        // 空 Referer 会被东财 WAF 检测到异常行为特征而拒绝连接（502）
        referer = 'https://quote.eastmoney.com/';
        charset = 'UTF-8';
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      } else if (targetUrl.hostname.includes('np-listapi.eastmoney.com')) {
        // 东财快讯 API：必须模拟真实浏览器 Referer
        referer = 'https://www.eastmoney.com/';
        charset = 'UTF-8';
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      } else if (targetUrl.hostname.includes('cls.cn')) {
        // 财联社快讯 API：需要正确的 Referer 和现代浏览器 UA
        referer = 'https://www.cls.cn/telegraph';
        charset = 'UTF-8';
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      } else if (targetUrl.hostname.includes('1234567.com.cn') || targetUrl.hostname.includes('eastmoney.com')) {
        // 兜底逻辑：其他的东财接口（如基金、资讯）依然使用 fund 作为 referer
        referer = 'https://fund.eastmoney.com/';
        charset = 'UTF-8';
      }
      else if (targetUrl.hostname.includes('baidu.com')) {
        referer = 'https://finance.baidu.com/';
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('10jqka.com.cn')) {
        referer = 'http://q.10jqka.com.cn/';
        charset = 'GBK'; // 🌟 核心修复：同花顺是老牌网站，必须指定 GBK 防乱码
      }

      const executeRequest = async (useCache = true) => {
        let currentCookie = request.headers.get('Cookie') || '';

        if (isXueqiu) {
          if (!cachedXueqiuCookie || !useCache) {
            const xqRes = await fetch('https://xueqiu.com/', { headers: { 'User-Agent': userAgent } });
            const setCookieHeader = xqRes.headers.get('set-cookie') || '';
            const match = setCookieHeader.match(/xq_a_token=([^;]+)/);
            if (match) cachedXueqiuCookie = `xq_a_token=${match[1]};`;
          }
          currentCookie = currentCookie ? `${currentCookie}; ${cachedXueqiuCookie}` : cachedXueqiuCookie;
        }

        // 🚨 核心修复：严禁全盘透传前端 Headers！
        // 只挑选安全的 Header 透传，绝对不能带入 PWA 的 Origin 和 Host
        const safeHeaders = new Headers();
        const allowedClientHeaders =['content-type', 'authorization', 'x-api-key']; // 移除了 accept，交由下方统一定义
        for (const [key, value] of request.headers.entries()) {
            if (allowedClientHeaders.includes(key.toLowerCase())) {
                safeHeaders.set(key, value);
            }
        }
        
        safeHeaders.set('User-Agent', userAgent);
        if (currentCookie) safeHeaders.set('Cookie', currentCookie);
        if (referer) safeHeaders.set('Referer', referer);

        // 针对东财 push2 接口：同时设置 Origin 匹配 Referer，模拟网页 XHR 请求
        // Origin 是标准请求头（非 Sec-Fetch-*），CF Worker fetch 可以合法设置
        if (targetUrl.hostname.includes('push2.eastmoney.com')) {
          safeHeaders.set('Origin', 'https://quote.eastmoney.com');
        }

        // 🌟 浏览器指纹模拟：仅设置安全请求头，严禁伪造 Sec-Fetch-* 系列
        // Fetch Metadata Headers (Sec-Fetch-*) 是浏览器自动附加的，服务端代理绝不能设置
        // 伪造这些头会导致目标站点的 WAF (如 Cloudflare) 检测到不一致而拦截请求
        safeHeaders.set('Accept', 'application/json, text/plain, */*');
        safeHeaders.set('Accept-Language', 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
        safeHeaders.set('Cache-Control', 'no-cache');
        safeHeaders.set('Pragma', 'no-cache');

        const fetchOptions = {
          method: request.method,
          headers: safeHeaders
        };

        if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
            fetchOptions.body = request.body;
        }

        return await fetch(new Request(targetUrl, fetchOptions));
      };

      let response = await executeRequest(true);

      if (isXueqiu && (response.status === 400 || response.status === 403)) {
        cachedXueqiuCookie = ''; 
        response = await executeRequest(false); 
      }

      const newResponse = new Response(response.body, response);
      Object.keys(corsHeaders).forEach(key => newResponse.headers.set(key, corsHeaders[key]));

      if (charset === 'GBK') {
         newResponse.headers.set('Content-Type', 'text/plain;charset=GBK');
      } else {
         newResponse.headers.set('Content-Type', 'application/json;charset=UTF-8');
      }

      return newResponse;

    } catch (e) {
      return new Response(JSON.stringify({ error: 'Proxy fetch failed', details: e.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' }
      });
    }
  },

  // ============================================================================
  // 纯 JS 矩阵工具（N≤20，精度足够，无外部依赖）
  // ============================================================================
  _matrixMultiply(A, B) {
    const m = A.length, n = B[0].length, p = B.length;
    const C = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let i = 0; i < m; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < p; k++)
          C[i][j] += A[i][k] * B[k][j];
    return C;
  },
  _matrixTranspose(A) {
    return A[0].map((_, j) => A.map(row => row[j]));
  },
  _matrixInverse(A) {
    const n = A.length;
    let M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
    for (let i = 0; i < n; i++) {
      let pivot = M[i][i];
      if (Math.abs(pivot) < 1e-12) {
        for (let k = i + 1; k < n; k++) {
          if (Math.abs(M[k][i]) > 1e-12) { [M[i], M[k]] = [M[k], M[i]]; pivot = M[i][i]; break; }
        }
      }
      if (Math.abs(pivot) < 1e-12) throw new Error('Matrix is singular');
      for (let j = 0; j < 2 * n; j++) M[i][j] /= pivot;
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const factor = M[k][i];
        for (let j = 0; j < 2 * n; j++) M[k][j] -= factor * M[i][j];
      }
    }
    return M.map(row => row.slice(n));
  },
  _checkConditionNumber(A) {
    const n = A.length;
    let trace = 0;
    for (let i = 0; i < n; i++) trace += Math.abs(A[i][i]);
    if (trace < 1e-12) return Infinity;
    const diag = A.map((row, i) => [row[i]]);
    const maxDiag = Math.max(...diag.map(d => Math.abs(d[0])));
    return maxDiag / (trace / n);
  },

  // ============================================================================
  // 量化引擎：EWMA 协方差矩阵
  // POST body: { dailyReturns: [[r1,r2,...], ...], lambda: 0.94 }
  // ============================================================================
  computeCovariance(body) {
    const { dailyReturns, lambda = 0.94 } = body || {};
    if (!dailyReturns || !Array.isArray(dailyReturns) || dailyReturns.length < 10) {
      return { error: 'dailyReturns must be an array with at least 10 rows' };
    }
    const T = dailyReturns.length;
    const N = dailyReturns[0].length;
    if (N < 2 || N > 30) return { error: 'Asset count must be 2-30' };

    // 初始化：前20天等权
    let cov = Array.from({ length: N }, () => new Array(N).fill(0));
    const warmup = Math.min(20, T);
    for (let t = 0; t < warmup; t++) {
      const r = dailyReturns[t];
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++)
          cov[i][j] += r[i] * r[j] / warmup;
    }

    // EWMA 递推
    for (let t = warmup; t < T; t++) {
      const r = dailyReturns[t];
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++)
          cov[i][j] = lambda * cov[i][j] + (1 - lambda) * r[i] * r[j];
    }

    const condNum = this._checkConditionNumber(cov);
    let method = 'EWMA';
    if (condNum > 1e12) {
      const avgVar = cov.reduce((s, row, i) => s + row[i], 0) / N;
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++)
          cov[i][j] = i === j ? cov[i][i] * 0.8 + avgVar * 0.2 : cov[i][j] * 0.5;
      method = 'EWMA+LedoitWolf(收缩)';
    }

    return {
      covMatrix: cov,
      conditionNumber: condNum,
      method,
      assetCount: N,
      observations: T,
      lambda
    };
  },

  // ============================================================================
  // 量化引擎：Black-Litterman 后验优化
  // POST body: { covMatrix, priorWeights: [w1,...], views, riskAversion, constraints }
  // ============================================================================
  computeBlackLitterman(body) {
    const { covMatrix, priorWeights, views = [], riskAversion = 2.5, constraints = {} } = body || {};
    if (!covMatrix || !priorWeights) return { error: 'covMatrix and priorWeights are required' };
    const N = priorWeights.length;
    if (N < 2 || N > 20) return { error: 'Asset count must be 2-20' };

    const tau = 1 / (covMatrix.length * 12);  // τ 标量——观测数越多τ越小

    // 1. 均衡收益 Π = λΣw_prior
    const w = priorWeights.map(v => [v]);
    const SigmaW = this._matrixMultiply(covMatrix, w);
    const Pi = SigmaW.map(row => [row[0] * riskAversion]);

    // 2. 无观点 → 直接返回均衡权重
    if (!views || views.length === 0) {
      const eqWeights = priorWeights.map(w => parseFloat(w.toFixed(4)));
      return {
        posteriorReturns: Pi.map(row => parseFloat(row[0].toFixed(4))),
        optimalWeights: eqWeights,
        equilibriumReturns: Pi.map(row => parseFloat(row[0].toFixed(4))),
        viewCount: 0,
        diagnostics: { conditionNumber: this._checkConditionNumber(covMatrix), tau, noViews: true }
      };
    }

    // 3. 构建 P 矩阵 (K×N) 和 Q 向量 (K×1)、Ω 矩阵 (K×K)
    const K = Math.min(views.length, 10);  // 最多10个观点
    const P = Array.from({ length: K }, () => new Array(N).fill(0));
    const Q = Array.from({ length: K }, () => [0]);
    const Omega = Array.from({ length: K }, () => new Array(K).fill(0));

    for (let k = 0; k < K; k++) {
      const v = views[k] || {};
      const assetIdx = Math.min(v.assetIndex || 0, N - 1);
      P[k][assetIdx] = 1;
      Q[k][0] = v.outperformance || 0;
      const omegaVal = v.confidence ? (1 / v.confidence - 1) * 0.1 : 0.2;
      Omega[k][k] = Math.max(0.01, omegaVal);
    }

    // 4. B-L 后验: E(R) = [(τΣ)⁻¹ + P'Ω⁻¹P]⁻¹[(τΣ)⁻¹Π + P'Ω⁻¹Q]
    const tauSigma = covMatrix.map(row => row.map(v => v * tau));
    const tauSigmaInv = this._matrixInverse(tauSigma);
    const OmegaInv = this._matrixInverse(Omega);
    const PT = this._matrixTranspose(P);
    const PTOmegaInv = this._matrixMultiply(PT, OmegaInv);
    const PTOmegaInvP = this._matrixMultiply(PTOmegaInv, P);

    const M1 = tauSigmaInv.map((row, i) => row.map((v, j) => v + PTOmegaInvP[i][j]));
    const M1Inv = this._matrixInverse(M1);

    const tauSigmaInvPi = this._matrixMultiply(tauSigmaInv, Pi);
    const PTOmegaInvQ = this._matrixMultiply(PTOmegaInv, Q);
    const M2 = tauSigmaInvPi.map((row, i) => [row[0] + PTOmegaInvQ[i][0]]);

    const posteriorReturns = this._matrixMultiply(M1Inv, M2);

    // 5. 无约束最优权重: w* = (λΣ)⁻¹ E(R)
    const lambdaSigmaInv = covMatrix.map((row, i) =>
      row.map((v, j) => i === j && v < 1e-12 ? 1 / 0.0001 : 0)
    );
    let lambdaSigmaInvFull;
    try {
      const lambdaSigma = covMatrix.map(row => row.map(v => v * riskAversion));
      lambdaSigmaInvFull = this._matrixInverse(lambdaSigma);
    } catch {
      lambdaSigmaInvFull = lambdaSigmaInv;
    }

    const unconstrained = this._matrixMultiply(lambdaSigmaInvFull, posteriorReturns);
    let optimalWeights = unconstrained.map(row => row[0]);
    const sumW = optimalWeights.reduce((a, b) => a + b, 0);
    if (Math.abs(sumW) > 0.001) optimalWeights = optimalWeights.map(w => w / sumW);

    // 6. 约束应用
    const maxSingle = constraints.maxSingleWeight || 0.20;
    const maxEquity = constraints.maxEquityWeight || 0.60;
    const minCash = constraints.minCashWeight || 0.05;
    for (let i = 0; i < N; i++) optimalWeights[i] = Math.max(0, Math.min(maxSingle, optimalWeights[i]));
    const totalW = optimalWeights.reduce((a, b) => a + b, 0);
    if (totalW > 0) optimalWeights = optimalWeights.map(w => w / totalW * (1 - minCash));

    return {
      posteriorReturns: posteriorReturns.map(row => parseFloat(row[0].toFixed(4))),
      optimalWeights: optimalWeights.map(w => parseFloat(w.toFixed(4))),
      equilibriumReturns: Pi.map(row => parseFloat(row[0].toFixed(4))),
      viewCount: K,
      diagnostics: {
        conditionNumber: this._checkConditionNumber(covMatrix),
        tau
      }
    };
  },

  // ============================================================================
  // 量化引擎：O-U 均值回归过程 — 半衰期估计
  // POST body: { navSeries: [1.5, 1.52, ...] }
  // dX_t = θ(μ - X_t)dt + σ dW_t, 离散化: X_{t+1} = a + b·X_t + ε_t
  // ============================================================================
  computeOUHalfLife(body) {
    const { navSeries } = body || {};
    if (!navSeries || !Array.isArray(navSeries) || navSeries.length < 30) {
      return { error: 'navSeries must be an array with at least 30 observations' };
    }
    const X = navSeries.filter(v => !isNaN(v) && v > 0);
    if (X.length < 30) return { error: 'Not enough valid NAV observations (need ≥30)' };

    // 离散化 OLS: X_{t+1} = a + b·X_t + ε_t
    const Y = X.slice(1);
    const X_lag = X.slice(0, -1);
    const n = Y.length;
    const sumX = X_lag.reduce((s, v) => s + v, 0);
    const sumY = Y.reduce((s, v) => s + v, 0);
    const sumXY = X_lag.reduce((s, v, i) => s + v * Y[i], 0);
    const sumX2 = X_lag.reduce((s, v) => s + v * v, 0);

    const denominator = n * sumX2 - sumX * sumX;
    if (Math.abs(denominator) < 1e-12) return { error: 'NAV series too flat for O-U estimation' };

    const b = (n * sumXY - sumX * sumY) / denominator;
    const a = (sumY - b * sumX) / n;

    // 残差标准差
    const residuals = Y.map((y, i) => y - a - b * X_lag[i]);
    const sigma = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / (n - 2));

    // O-U 参数
    const dt = 1; // 每日
    const theta = b < 1 && b > 0 ? -Math.log(Math.max(b, 0.001)) / dt : 0;
    const mu = b < 1 ? a / (1 - b) : X[X.length - 1];
    const halfLife = theta > 0 ? Math.log(2) / theta : Infinity;

    // 当前偏离
    const lastPrice = X[X.length - 1];
    const deviation = lastPrice - mu;
    const deviationStd = sigma > 0 ? deviation / (sigma / Math.sqrt(1 - b * b)) : 0;

    // 解读
    let signal = '中性';
    if (halfLife === Infinity || theta <= 0) {
      signal = '⚠️ 无均值回归特征(随机游走/趋势)';
    } else if (Math.abs(deviationStd) > 2) {
      signal = deviationStd > 0 ? '高于均值2σ以上' : '低于均值2σ以上';
    } else if (Math.abs(deviationStd) > 1) {
      signal = deviationStd > 0 ? '⚠️ 偏高(1-2σ)' : '💧 偏低(1-2σ)';
    } else {
      signal = '✅ 在均值附近(±1σ内)';
    }

    return {
      mu: parseFloat(mu.toFixed(4)),
      theta: parseFloat(theta.toFixed(6)),
      halfLifeDays: halfLife === Infinity ? null : parseFloat(halfLife.toFixed(1)),
      sigma: parseFloat(sigma.toFixed(6)),
      lastPrice: parseFloat(lastPrice.toFixed(4)),
      deviation: parseFloat(deviation.toFixed(4)),
      deviationStd: parseFloat(deviationStd.toFixed(2)),
      signal,
      observations: n
    };
  },

  // ============================================================================
  // 量化引擎：Markov 机制转移模型 — Hamilton 滤波
  // POST body: { returns: [0.001, -0.003, ...], nStates: 2 }
  // 2状态模型: 状态0=低波动/震荡, 状态1=高波动/趋势
  // ============================================================================
  computeMarkovRegime(body) {
    const { returns, nStates = 2 } = body || {};
    if (!returns || !Array.isArray(returns) || returns.length < 60) {
      return { error: 'returns must be an array with at least 60 observations' };
    }
    const T = returns.length;
    const K = Math.min(nStates, 3);

    // ── 初始化：按波动率高低分状态 ──
    const sorted = [...returns].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(T * 0.25)];
    const q3 = sorted[Math.floor(T * 0.75)];

    let mu = [], sigma = [];
    if (K === 2) {
      const low = returns.filter(r => r >= q1 && r <= q3);
      const high = returns.filter(r => r < q1 || r > q3);
      mu = [low.length > 0 ? low.reduce((a,b)=>a+b,0)/low.length : q1*0.5,
            high.length > 0 ? high.reduce((a,b)=>a+b,0)/high.length : q3*0.5];
      sigma = [low.length > 0 ? Math.sqrt(low.reduce((s,r)=>s+(r-mu[0])**2,0)/low.length) : 0.005,
               high.length > 0 ? Math.sqrt(high.reduce((s,r)=>s+(r-mu[1])**2,0)/high.length) : 0.015];
    } else {
      const lo = returns.filter(r => r < q1);
      const mid = returns.filter(r => r >= q1 && r <= q3);
      const hi = returns.filter(r => r > q3);
      mu = [lo.length>0?lo.reduce((a,b)=>a+b,0)/lo.length:-0.01,
            mid.length>0?mid.reduce((a,b)=>a+b,0)/mid.length:0.001,
            hi.length>0?hi.reduce((a,b)=>a+b,0)/hi.length:0.015];
      sigma = [lo.length>0?Math.sqrt(lo.reduce((s,r)=>s+(r-mu[0])**2,0)/lo.length):0.015,
               mid.length>0?Math.sqrt(mid.reduce((s,r)=>s+(r-mu[1])**2,0)/mid.length):0.005,
               hi.length>0?Math.sqrt(hi.reduce((s,r)=>s+(r-mu[2])**2,0)/hi.length):0.015];
    }

    // ── 转移矩阵（初始先验：90%概率留在当前状态）──
    let P = Array.from({length:K}, (_,i) =>
      Array.from({length:K}, (_,j) => i===j ? 0.90 : 0.10/(K-1))
    );

    // ── EM 迭代（简化版：5轮足够收敛）──
    for (let iter = 0; iter < 5; iter++) {
      // E-step: 前向-后向算法
      const xi = Array.from({length:T}, () => new Array(K).fill(0));
      const gamma = Array.from({length:T}, () => new Array(K).fill(0));

      // 前向
      const alpha = Array.from({length:T}, () => new Array(K).fill(0));
      for (let k = 0; k < K; k++) {
        const diff = (returns[0] - mu[k]) / Math.max(sigma[k], 0.001);
        alpha[0][k] = (1/K) * Math.exp(-0.5*diff*diff) / (Math.sqrt(2*Math.PI)*Math.max(sigma[k],0.001));
      }
      let scale0 = alpha[0].reduce((a,b)=>a+b,0);
      if (scale0 > 0) alpha[0] = alpha[0].map(v => v/scale0);

      for (let t = 1; t < T; t++) {
        for (let j = 0; j < K; j++) {
          let sum = 0;
          for (let i = 0; i < K; i++) sum += alpha[t-1][i] * P[i][j];
          const diff = (returns[t] - mu[j]) / Math.max(sigma[j], 0.001);
          alpha[t][j] = sum * Math.exp(-0.5*diff*diff) / (Math.sqrt(2*Math.PI)*Math.max(sigma[j],0.001));
        }
        const scale = alpha[t].reduce((a,b)=>a+b,0);
        if (scale > 0) alpha[t] = alpha[t].map(v => v/scale);
      }

      // 后向
      const beta = Array.from({length:T}, () => new Array(K).fill(1));
      for (let t = T-2; t >= 0; t--) {
        for (let i = 0; i < K; i++) {
          let sum = 0;
          for (let j = 0; j < K; j++) {
            const diff = (returns[t+1] - mu[j]) / Math.max(sigma[j], 0.001);
            const density = Math.exp(-0.5*diff*diff) / (Math.sqrt(2*Math.PI)*Math.max(sigma[j],0.001));
            sum += P[i][j] * density * beta[t+1][j];
          }
          beta[t][i] = sum;
        }
        const scale = beta[t].reduce((a,b)=>a+b,0);
        if (scale > 0) beta[t] = beta[t].map(v => v/scale);
      }

      // 平滑概率
      for (let t = 0; t < T; t++) {
        let sum = 0;
        for (let k = 0; k < K; k++) { gamma[t][k] = alpha[t][k] * beta[t][k]; sum += gamma[t][k]; }
        if (sum > 0) gamma[t] = gamma[t].map(v => v/sum);
      }

      // M-step: 更新转移矩阵
      const newP = Array.from({length:K}, () => new Array(K).fill(0));
      for (let i = 0; i < K; i++) {
        let denom = 0;
        for (let t = 0; t < T-1; t++) {
          for (let j = 0; j < K; j++) {
            const diff = (returns[t+1] - mu[j]) / Math.max(sigma[j], 0.001);
            const density = Math.exp(-0.5*diff*diff) / (Math.sqrt(2*Math.PI)*Math.max(sigma[j],0.001));
            const num = gamma[t][i] * P[i][j] * density * beta[t+1][j];
            const den = beta[t][i] > 0 ? beta[t][i] : 1;
            newP[i][j] += num / den;
          }
        }
        for (let j = 0; j < K; j++) { denom += newP[i][j]; }
        if (denom > 0) for (let j = 0; j < K; j++) newP[i][j] /= denom;
      }
      P = newP;
    }

    // ── 稳态概率 ──
    let steadyState = new Array(K).fill(1/K);
    for (let iter = 0; iter < 100; iter++) {
      const next = new Array(K).fill(0);
      for (let j = 0; j < K; j++)
        for (let i = 0; i < K; i++)
          next[j] += steadyState[i] * P[i][j];
      steadyState = next;
    }

    // ── 当前状态判定 ──
    const lastProbs = { filtered: null, smoothed: null };
    // 重新跑一次前向滤波得当前概率
    const fwd = Array.from({length:T}, () => new Array(K).fill(0));
    for (let k = 0; k < K; k++) {
      const diff = (returns[0] - mu[k]) / Math.max(sigma[k], 0.001);
      fwd[0][k] = (1/K) * Math.exp(-0.5*diff*diff) / (Math.sqrt(2*Math.PI)*Math.max(sigma[k],0.001));
    }
    let s = fwd[0].reduce((a,b)=>a+b,0);
    if (s > 0) fwd[0] = fwd[0].map(v => v/s);
    for (let t = 1; t < T; t++) {
      for (let j = 0; j < K; j++) {
        let sum = 0;
        for (let i = 0; i < K; i++) sum += fwd[t-1][i] * P[i][j];
        const diff = (returns[t] - mu[j]) / Math.max(sigma[j], 0.001);
        fwd[t][j] = sum * Math.exp(-0.5*diff*diff) / (Math.sqrt(2*Math.PI)*Math.max(sigma[j],0.001));
      }
      const scale = fwd[t].reduce((a,b)=>a+b,0);
      if (scale > 0) fwd[t] = fwd[t].map(v => v/scale);
    }
    lastProbs.filtered = fwd[T-1];

    // ── 状态标签 ──
    const stateLabels = [];
    for (let k = 0; k < K; k++) {
      const vol = sigma[k];
      const ret = mu[k];
      if (K === 2) {
        stateLabels[k] = vol > 0.01 ? (ret > 0 ? '🐂 牛市(高波动+正收益)' : '🐻 熊市(高波动+负收益)')
                                    : '⚪ 震荡(低波动)';
      } else {
        stateLabels[k] = k === 0 ? (ret < 0 ? '🐻 熊市' : '⚪ 低波动') :
                         k === 1 ? '⚪ 震荡' : '🐂 牛市';
      }
    }

    // 当前主导状态
    const domIdx = lastProbs.filtered.indexOf(Math.max(...lastProbs.filtered));
    const dominantState = stateLabels[domIdx];

    // 预期持续天数
    const expectedDuration = P.map((row, i) => {
      const diag = row[i];
      return diag < 1 ? parseFloat((1 / (1 - diag)).toFixed(1)) : null;
    });

    return {
      states: stateLabels.map((label, i) => ({
        label, mu: parseFloat(mu[i].toFixed(4)),
        sigma: parseFloat(sigma[i].toFixed(4)),
        steadyProb: parseFloat(steadyState[i].toFixed(3)),
        expectedDurationDays: expectedDuration[i]
      })),
      currentProbs: lastProbs.filtered.map((p, i) => ({
        state: stateLabels[i],
        probability: parseFloat(p.toFixed(3))
      })),
      dominantState,
      transitionMatrix: P.map(row => row.map(v => parseFloat(v.toFixed(3)))),
      observations: T
    };
  },

  // ============================================================================
  // 量化引擎：蒙特卡洛模拟
  // POST body: { covMatrix, weights, initialValue, horizonDays, numSims, drawdownThresholds }
  // ============================================================================
  computeMonteCarlo(body) {
    const { covMatrix, weights, initialValue = 100000, horizonDays = 60,
            numSims = 5000, drawdownThresholds = [0.05, 0.10, 0.15] } = body || {};
    if (!covMatrix || !weights) return { error: 'covMatrix and weights are required' };
    const N = weights.length;
    if (N < 1 || N > 20) return { error: 'Asset count must be 1-20' };
    if (horizonDays > 252) return { error: 'Horizon max 252 days' };

    // ── Cholesky 分解 (L·L' = Σ) ──
    const L = Array.from({length:N}, () => new Array(N).fill(0));
    for (let i = 0; i < N; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = covMatrix[i][j];
        for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        if (i === j) {
          L[i][j] = sum > 0 ? Math.sqrt(sum) : 0;
        } else {
          L[i][j] = L[j][j] > 0 ? sum / L[j][j] : 0;
        }
      }
    }

    // ── 模拟（用确定性种子保证可复现）──
    const sims = Math.min(numSims, 10000);
    const finalValues = new Array(sims);
    const maxDrawdowns = new Array(sims);

    // 简易 PRNG（Mulberry32）
    const mulberry32 = (seed) => {
      return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    };
    // Box-Muller 正态
    const randn = (prng) => {
      const u1 = prng();
      const u2 = prng();
      return Math.sqrt(-2 * Math.log(Math.max(u1, 0.0001))) * Math.cos(2 * Math.PI * u2);
    };

    for (let s = 0; s < sims; s++) {
      const seed = 42 + s * 137;
      const rng = mulberry32(seed);
      let value = initialValue;
      let peak = initialValue;
      let mdd = 0;

      for (let d = 0; d < horizonDays; d++) {
        // 生成相关随机向量: L × z
        const z = Array.from({length:N}, () => randn(rng));
        const correlated = new Array(N).fill(0);
        for (let i = 0; i < N; i++)
          for (let j = 0; j < N; j++)
            correlated[i] += L[i][j] * z[j];

        // 组合日收益率 = w' × r
        let dailyReturn = 0;
        for (let i = 0; i < N; i++)
          dailyReturn += weights[i] * correlated[i];

        value *= (1 + dailyReturn);
        if (value > peak) peak = value;
        const dd = (peak - value) / peak;
        if (dd > mdd) mdd = dd;
      }
      finalValues[s] = value;
      maxDrawdowns[s] = mdd;
    }

    // ── 统计 ──
    finalValues.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);

    const percentile = (arr, p) => arr[Math.max(0, Math.floor(arr.length * p))];
    const mean = finalValues.reduce((a, b) => a + b, 0) / sims;
    const totalReturn = (mean - initialValue) / initialValue;

    // 回撤概率
    const ddProbs = {};
    for (const threshold of drawdownThresholds) {
      const count = maxDrawdowns.filter(d => d >= threshold).length;
      ddProbs[`${(threshold*100).toFixed(0)}%`] = parseFloat((count / sims * 100).toFixed(1));
    }

    // VaR at horizon
    const var95End = initialValue - percentile(finalValues, 0.05);
    const var99End = initialValue - percentile(finalValues, 0.01);

    return {
      initialValue,
      horizonDays,
      simulations: sims,
      expectedFinalValue: parseFloat(mean.toFixed(0)),
      expectedReturn: parseFloat((totalReturn * 100).toFixed(2)) + '%',
      worstCase: {
        p5: parseFloat(percentile(finalValues, 0.05).toFixed(0)),
        p1: parseFloat(percentile(finalValues, 0.01).toFixed(0)),
        var95End: parseFloat(var95End.toFixed(0)),
        var99End: parseFloat(var99End.toFixed(0))
      },
      bestCase: {
        p95: parseFloat(percentile(finalValues, 0.95).toFixed(0)),
        p99: parseFloat(percentile(finalValues, 0.99).toFixed(0))
      },
      drawdownProbabilities: ddProbs
    };
  },

  // ============================================================================
  // 深度微观结构探测器：聚合多源数据 → 降维为定性信号 → 喂给 AI
  // 不依赖 KV，纯外部 API 聚合
  // ============================================================================
  async fetchMicrostructure() {
    const result = {
      liquidity: {},
      derivatives: {},
      repo_rates: {},
      market_breadth: null,
      overall_signal: ''
    };

    // ── 并行抓取 3 路数据（涨跌家数由大盘雷达注入，此处不重复拉取）──
    // Sina 返回 GBK 编码，必须用 TextDecoder 解码，否则中文乱码导致名称匹配失败
    const fetchSinaGBK = async (url) => {
      const r = await fetch(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } });
      const buf = await r.arrayBuffer();
      return new TextDecoder('gbk').decode(buf);
    };
    const [sinaIndices, sinaFutures, sinaRepo] = await Promise.allSettled([
      fetchSinaGBK('https://hq.sinajs.cn/list=sh000001,sz399001,sh000300,sh000016,sh000905,sh000852,sh000688').catch(() => ''),
      fetchSinaGBK('https://hq.sinajs.cn/list=CFF_RE_IM0,CFF_RE_IF0,CFF_RE_IC0').catch(() => ''),
      fetchSinaGBK('https://hq.sinajs.cn/list=sh204001,sh204007').catch(() => '')
    ]);


    // 1. 回购利率
    if (sinaRepo.status === 'fulfilled' && sinaRepo.value) {
      const lines = sinaRepo.value.split(';').filter(l => l.includes('hq_str_'));
      for (const line of lines) {
        const m = line.match(/var hq_str_\w+="([^"]+)"/);
        if (!m) continue;
        const p = m[1].split(',');
        if (p.length < 6) continue;
        const name = p[0], open = parseFloat(p[1]) || 0, prevClose = parseFloat(p[2]) || 0,
              current = parseFloat(p[3]) || 0, high = parseFloat(p[4]) || 0, low = parseFloat(p[5]) || 0,
              change = current - prevClose;
        result.repo_rates[name] = { name, current, prevClose, high, low, change, open };
        if (name === 'GC001') {
          result.liquidity.ON_rate = current;
          result.liquidity.ON_change_bp = Math.round(change * 100);
          let level = current < 1.5 ? '宽松' : current < 2.0 ? '中性' : current < 2.5 ? '偏紧' : '紧缩';
          if (Math.abs(change) > 0.30) level = change > 0 ? '急剧收紧' : '急剧放松';
          result.liquidity.ON_level = level;
        }
        if (name === 'GC007') {
          result.liquidity.DR007_proxy_rate = current;
          result.liquidity.DR007_change_bp = Math.round(change * 100);
          let level = current < 1.7 ? '宽松' : current < 2.2 ? '中性' : current < 2.8 ? '偏紧' : '紧缩';
          if (Math.abs(change) > 0.30) level = change > 0 ? '急剧收紧' : '急剧放松';
          result.liquidity.DR007_proxy_level = level;
        }
      }
    }

    // 2. 指数现货（仅用于计算基差，不对外输出）
    const spots = {};
    if (sinaIndices.status === 'fulfilled' && sinaIndices.value) {
      const lines = sinaIndices.value.split(';').filter(l => l.includes('hq_str_'));
      for (const line of lines) {
        const m = line.match(/var hq_str_\w+="([^"]+)"/);
        if (!m) continue;
        const p = m[1].split(',');
        if (p.length < 6) continue;
        const name = p[0];
        const key = name.includes('上证综') || name.includes('上证指') ? 'SH' :
                    name.includes('沪深300') ? 'HS300' : name.includes('上证50') ? 'SZ50' :
                    name.includes('中证500') ? 'ZZ500' : name.includes('中证1000') ? 'ZZ1000' :
                    name.includes('科创') ? 'STAR50' : name.includes('深证') ? 'SZ' : null;
        if (key) spots[key] = { current: parseFloat(p[3]) || 0, prevClose: parseFloat(p[2]) || 0,
                                high: parseFloat(p[4]) || 0, low: parseFloat(p[5]) || 0 };
      }
    }

    // 3. 期指基差
    if (sinaFutures.status === 'fulfilled' && sinaFutures.value) {
      const lines = sinaFutures.value.split(';').filter(l => l.includes('hq_str_'));
      for (const line of lines) {
        const m = line.match(/var hq_str_\w+="([^"]+)"/);
        if (!m) continue;
        const p = m[1].split(',');
        if (p.length < 8) continue;
        // 名称在最后几个字段，从后往前扫找包含"股指期货"的中文名
        let name = '';
        for (let j = p.length - 1; j >= Math.max(0, p.length - 6); j--) {
          if (p[j] && /[一-龥]/.test(p[j])) { name = p[j]; break; }
        }
        const settlement = parseFloat(p[1]) || 0,
              vol = parseInt(p[4]) || 0, oi = parseInt(p[6]) || 0;
        const spotKey = name.includes('中证1000') ? 'ZZ1000' : name.includes('沪深300') ? 'HS300' :
                        name.includes('中证500') ? 'ZZ500' : null;
        const futKey  = name.includes('中证1000') ? 'IM' : name.includes('沪深300') ? 'IF' :
                        name.includes('中证500') ? 'IC' : null;
        if (!spotKey || !futKey) continue;
        const spot = spots[spotKey];
        const basis = spot ? settlement - spot.current : null;
        const basisPct = spot && spot.current > 0 ? (basis / spot.current * 100) : null;
        result.derivatives[futKey] = { name, settlement, spotClose: spot?.current || null, basis,
          basisPct: basisPct !== null ? basisPct.toFixed(2) + '%' : null, volume: vol, openInterest: oi };
      }
    }

    // 4. 综合信号 — 幅度分级 + 趋势检测 + VIX交叉验证
    // 设计原则：区分"日常波动"和"真正危机"，避免频繁假阳性导致LLM丧失信任
    const now = new Date();
    const dayOfMonth = now.getDate();
    const month = now.getMonth() + 1;
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const isQuarterEnd = (month === 3 || month === 6 || month === 9 || month === 12) && dayOfMonth >= lastDayOfMonth - 1;

    // ── VIX 快速拉取用于交叉验证 ──
    let vixValue = null;
    try {
      const vixRes = await fetch('https://qt.gtimg.cn/q=us.VIX');
      if (vixRes.ok) {
        const vixText = new TextDecoder('gbk').decode(await vixRes.arrayBuffer());
        const vixMatch = vixText.match(/v_us\.VIX="[^"]*~[^"]*~[^"]*~([\d.]+)/);
        if (vixMatch) vixValue = parseFloat(vixMatch[1]);
      }
    } catch (e) { /* VIX不可用不影响 */ }
    result.vix = vixValue;

    const warnings = [];
    const signalGrades = []; // 幅度分级信息，供前端展示
    const onLvl = result.liquidity.ON_level || '', d7Lvl = result.liquidity.DR007_proxy_level || '';

    // ── 流动性收紧判定 ──
    const gc001Rate = result.liquidity.ON_rate || 0;
    const gc001Change = result.liquidity.ON_change_bp || 0;
    const gc001Tight = isQuarterEnd ? (gc001Rate > 4.0) : (gc001Rate > 2.5);
    const gc001Surge = gc001Change > 50; // 日变>50bp = 急剧变化
    const liquidityTight = onLvl.includes('收紧') || d7Lvl.includes('收紧');
    if (liquidityTight || gc001Tight) {
      const tag = isQuarterEnd && gc001Rate > 2.5 && gc001Rate <= 4.0
        ? '资金面偏紧(季末效应,已放宽阈值)' : '资金面紧缩';
      // 急剧变化加权
      const weight = gc001Surge ? 2 : 1;
      warnings.push(tag);
      if (weight > 1) warnings.push('GC001急剧变化');
    }

    // ── 期指基差：分品种阈值 + 幅度分级 + 量能加权 ──
    // VIX>30 → 全球恐慌 → 所有阈值减半（更敏感）
    const vixMultiplier = (vixValue && vixValue > 30) ? 0.5 : 1.0;
    const imBasis = result.derivatives.IM?.basisPct || null;
    const ifBasis = result.derivatives.IF?.basisPct || null;
    const icBasis = result.derivatives.IC?.basisPct || null;
    const imVol = result.derivatives.IM?.volume || 0;
    const ifVol = result.derivatives.IF?.volume || 0;
    const icVol = result.derivatives.IC?.volume || 0;
    const imOI = result.derivatives.IM?.openInterest || 0;
    const ifOI = result.derivatives.IF?.openInterest || 0;
    const icOI = result.derivatives.IC?.openInterest || 0;

    const basisCheck = (basisPct, futKey, threshold, vol, oi) => {
      if (!basisPct) return null;
      const bps = parseFloat(basisPct);
      const absBps = Math.abs(bps);
      const volWeight = (vol > 150000 || oi > 150000) ? 1.3 : 1.0;
      const effectiveThreshold = (threshold * vixMultiplier) / volWeight;
      if (bps < -effectiveThreshold) {
        // 幅度分级：基差>阈值2× → warning计数翻倍 + 加标签
        const severity = absBps > threshold * 2.0 ? 2 : 1;
        const sevLabel = severity > 1 ? '极端贴水' : '深度贴水';
        const vixLabel = vixMultiplier < 1.0 ? '(VIX>30,阈值减半)' : '';
        const volLabel = volWeight > 1.0 ? '放量' : '';
        const tag = [volLabel, futKey, sevLabel, vixLabel].filter(Boolean).join('');
        return { tag, severity };
      }
      return null;
    };
    const addBasisWarning = (result) => {
      if (!result) return;
      warnings.push(result.tag);
      if (result.severity > 1) warnings.push(result.tag.replace('极端贴水','极端确认')); // 幅度加倍=多计1次warning
      signalGrades.push(result);
    };
    addBasisWarning(basisCheck(imBasis, 'IM', 1.2, imVol, imOI));
    addBasisWarning(basisCheck(ifBasis, 'IF', 0.6, ifVol, ifOI));
    addBasisWarning(basisCheck(icBasis, 'IC', 1.0, icVol, icOI));

    // ── 基差日间变化趋势（期货今日结算 vs 昨结算）──
    const imSettlement = result.derivatives.IM?.settlement || 0;
    const ifSettlement = result.derivatives.IF?.settlement || 0;
    const icSettlement = result.derivatives.IC?.settlement || 0;
    // 从原始期货数据读昨结算
    let imPrevSettle = 0, ifPrevSettle = 0, icPrevSettle = 0;
    if (sinaFutures.status === 'fulfilled' && sinaFutures.value) {
      const flines = sinaFutures.value.split(';').filter(l => l.includes('hq_str_'));
      for (const line of flines) {
        const m = line.match(/var hq_str_\w+="([^"]+)"/);
        if (!m) continue;
        const p = m[1].split(',');
        if (p.length < 8) continue;
        const prevSettle = parseFloat(p[2]) || 0;
        let name = '';
        for (let j = p.length - 1; j >= Math.max(0, p.length - 6); j--) {
          if (p[j] && /[一-龥]/.test(p[j])) { name = p[j]; break; }
        }
        if (name.includes('中证1000')) imPrevSettle = prevSettle;
        else if (name.includes('沪深300')) ifPrevSettle = prevSettle;
        else if (name.includes('中证500')) icPrevSettle = prevSettle;
      }
    }
    // 日间变化>0.3% → 贴水在加速扩大
    const trendCheck = (settle, prevSettle, futKey) => {
      if (!settle || !prevSettle || prevSettle <= 0) return null;
      const pctDrop = (prevSettle - settle) / prevSettle * 100;
      if (pctDrop > 0.3) return { tag: `${futKey}基差加速扩大(+${pctDrop.toFixed(1)}%)`, severity: 1 };
      return null;
    };
    const trends = [trendCheck(imSettlement, imPrevSettle, 'IM'),
                    trendCheck(ifSettlement, ifPrevSettle, 'IF'),
                    trendCheck(icSettlement, icPrevSettle, 'IC')].filter(Boolean);
    for (const t of trends) warnings.push(t.tag);

    // ── 信号聚合（幅度加权后）──
    const totalWarnings = warnings.length;
    const tight = onLvl.includes('收紧') || d7Lvl.includes('收紧') || gc001Tight;
    const loose = onLvl === '宽松' && d7Lvl === '宽松' && !gc001Tight;

    if (totalWarnings >= 4) {
      result.overall_signal = '🚨 fatal';
      result.signal_detail = '多维度极端信号共振';
    } else if (totalWarnings >= 2) {
      result.overall_signal = '🚨 fatal';
      result.signal_detail = '至少2个独立维度过阈值';
    } else if (totalWarnings === 1) {
      result.overall_signal = '⚠️ warn';
      result.signal_detail = warnings[0];
    } else if (loose && !tight) {
      result.overall_signal = '✅ clear';
      result.signal_detail = '流动性宽松+期指基差正常';
    } else {
      result.overall_signal = '⚪ neutral';
      result.signal_detail = '各项指标在正常范围';
    }
    result.warnings = warnings;
    result.warning_count = totalWarnings;
    result.signal_grades = signalGrades;
    result.vix = vixValue;
    result.timestamp = now.toISOString();
    return result;
  },

  // ── 行业资金流向（东财Push2行业板块资金流数据）──
  async fetchSectorCapitalFlow() {
    try {
      const url = `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=56&po=1&np=1&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87`;
      const res = await fetch(url, {
        headers: {
          'Referer': 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.data?.diff) {
        const sectors = Object.values(data.data.diff).map(s => ({
          code: s.f12,
          name: s.f14,
          pct: s.f3 != null ? s.f3 / 100 : null,
          mainForceNet: s.f62 != null ? (s.f62 / 1e8).toFixed(1) : null,
          mainForceRatio: s.f184 != null ? (s.f184 / 10).toFixed(1) : null,
          superLargeNet: s.f66 != null ? (s.f66 / 1e8).toFixed(1) : null,
          superLargeRatio: s.f69 != null ? (s.f69 / 10).toFixed(1) : null,
          largeNet: s.f72 != null ? (s.f72 / 1e8).toFixed(1) : null,
          smallNet: s.f75 != null ? (s.f75 / 1e8).toFixed(1) : null,
        }));

        // 按主力净流入排序（已经按fid=f62降序，取前5和后5）
        const top5 = sectors.filter(s => s.mainForceNet !== null).slice(0, 5);
        const bottom5 = sectors.filter(s => s.mainForceNet !== null).slice(-5).reverse();

        return {
          total: sectors.length,
          top5,
          bottom5,
          timestamp: new Date().toISOString()
        };
      }
      return { total: 0, top5: [], bottom5: [], note: 'data format unexpected' };
    } catch (e) {
      return { total: 0, top5: [], bottom5: [], error: e.message };
    }
  },

  // ── 美国利率与美元指数（从 Yahoo Finance 获取，CF Worker 全球网络可达）──
  async fetchUSTreasury() {
    const result = { us10y: null, us2y: null, dxy: null, vix: null, updatedAt: new Date().toISOString() };
    try {
      // 并行拉取美10Y (^TNX), 美2Y (^TWO), 美元指数 (DX-Y.NYB)
      const symbols = ['^TNX', '^TWO', 'DX-Y.NYB'];
      const fetches = symbols.map(async (sym) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
          const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (!res.ok) return null;
          const data = await res.json();
          const meta = data?.chart?.result?.[0]?.meta;
          return meta ? { symbol: sym, price: meta.regularMarketPrice } : null;
        } catch (e) { return null; }
      });
      const results = await Promise.all(fetches);
      for (const r of results) {
        if (!r) continue;
        if (r.symbol === '^TNX') result.us10y = r.price;
        else if (r.symbol === '^TWO') result.us2y = r.price;
        else if (r.symbol === 'DX-Y.NYB') result.dxy = r.price;
      }
    } catch (e) {
      console.warn('[us-treasury] Yahoo Finance 拉取失败:', e.message);
    }
    // VIX 降级：尝试从 Yahoo 获取
    try {
      const vixRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=5d', {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (vixRes.ok) {
        const vixData = await vixRes.json();
        result.vix = vixData?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
      }
    } catch (e) { /* VIX 降级失败 */ }
    // 全为 null → 标记不可用
    if (result.us10y == null && result.us2y == null && result.dxy == null && result.vix == null) {
      result.error = 'us_treasury_unavailable';
    }
    return result;
  },

  // ── Worker 自主搜索+内容提取 ──
  async workerSearch(query, numResults = 3) {
    const results = [];

    // 步骤1: 搜索 (Serper → Google 结果)
    let searchResults = [];
    const serperKey = (typeof SERPER_API_KEY !== 'undefined' ? SERPER_API_KEY : null);
    if (serperKey) {
      try {
        const sRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
          body: JSON.stringify({ q: query, num: numResults + 2, gl: 'cn', hl: 'zh-CN' }),
          signal: AbortSignal.timeout(10000)
        });
        if (sRes.ok) {
          const sData = await sRes.json();
          searchResults = (sData.organic || []).slice(0, numResults + 2);
        }
      } catch (e) { /* search failed, results stays empty */ }
    }

    // 步骤2: 对每个搜索结果URL提取正文（串行+间隔, 避免Jina 429限流）
    const urlsToFetch = searchResults.map(r => r.link).filter(Boolean).slice(0, numResults);
    const fetched = [];
    for (let idx = 0; idx < urlsToFetch.length; idx++) {
      const url = urlsToFetch[idx];
      if (idx > 0) await new Promise(r => setTimeout(r, 800)); // Jina 免费版限流间隔
      try {
        const jinaUrl = `https://r.jina.ai/${url}`;
        const res = await fetch(jinaUrl, {
          signal: AbortSignal.timeout(12000),
          headers: { 'Accept': 'text/markdown' }
        });
        if (!res.ok) return null;
        const text = await res.text();
        const clean = text.replace(/^\[.*?\]\(.*?\)\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
        return {
          url,
          title: searchResults[idx]?.title || '',
          content: clean.substring(0, 3000),
          length: clean.length
        };
      } catch { fetched.push(null); }
    }

    // 步骤3: 过滤+排序（有内容的优先）
    for (const item of fetched) {
      if (item && item.content.length > 200) results.push(item);
    }
    results.sort((a, b) => b.length - a.length);
    return results;
  },

  // ── 中国国债收益率曲线（服务端拉取，无 CORS 限制）──
  async fetchCNBondYields() {
    const result = { y1: null, y2: null, y5: null, y10: null, y30: null, spread_10_2: null, source: null };

    // 策略1: 中债信息网 API（非交易日可能空，保留作为可能通路）
    try {
      const bizDay = new Date();
      bizDay.setDate(bizDay.getDate() - 1);
      while (bizDay.getDay() === 0 || bizDay.getDay() === 6) bizDay.setDate(bizDay.getDate() - 1);
      const ds = bizDay.toISOString().split('T')[0];
      const cbRes = await fetch('https://yield.chinabond.com.cn/cbweb-mn/yc/searchYc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
        body: `locale=zh_CN&ycType=0&startDate=${ds}&endDate=${ds}`,
        signal: AbortSignal.timeout(3000)
      });
      if (cbRes.ok) {
        const data = JSON.parse(await cbRes.text());
        if (data && data.length > 0) {
          for (const bond of data) {
            if (!bond.yc) continue;
            for (const pt of bond.yc) {
              const term = parseInt(pt[0]), y = parseFloat(pt[1]);
              if (term === 1) result.y1 = y;
              else if (term === 2) result.y2 = y;
              else if (term === 5) result.y5 = y;
              else if (term === 10) result.y10 = y;
            }
          }
          if (result.y10 != null) {
            result.source = 'chinabond';
            result.updatedAt = ds;
            if (result.y2 != null) result.spread_10_2 = Math.round((result.y10 - result.y2) * 100) / 100;
            return result;
          }
        }
      }
    } catch (e) { /* 降级到下一个策略 */ }

    // 策略2: Investing.com 抓取中国国债收益率
    try {
      const urls = [
        'https://www.investing.com/rates-bonds/china-10-year-bond-yield',
        'https://www.investing.com/rates-bonds/china-2-year-bond-yield',
        'https://www.investing.com/rates-bonds/china-5-year-bond-yield',
        'https://www.investing.com/rates-bonds/china-30-year-bond-yield',
      ];
      const fetchPage = async (url) => {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(5000)
        });
        return res.ok ? await res.text() : '';
      };
      // 从页面HTML中提取收益率（Investing.com 格式）
      const extractYield = (html) => {
        // 匹配: data-test="instrument-price-last" 或 span class="text-2xl"
        const m = html.match(/data-test="instrument-price-last"[^>]*>([^<]+)</);
        if (m) return parseFloat(m[1].replace(/,/g, ''));
        const m2 = html.match(/class="[^"]*text-2xl[^"]*"[^>]*>([^<]+)</);
        if (m2) return parseFloat(m2[1].replace(/,/g, ''));
        return null;
      };

      const [html10, html2, html5, html30] = await Promise.all(urls.map(fetchPage));
      const y10 = html10 ? extractYield(html10) : null;
      const y2 = html2 ? extractYield(html2) : null;
      const y5 = html5 ? extractYield(html5) : null;
      const y30 = html30 ? extractYield(html30) : null;

      if (y10 != null) { result.y10 = y10; result.source = 'investing'; }
      if (y2 != null) result.y2 = y2;
      if (y5 != null) result.y5 = y5;
      if (y30 != null) result.y30 = y30;
      if (result.y10 != null) {
        if (result.y2 != null) result.spread_10_2 = Math.round((result.y10 - result.y2) * 100) / 100;
        return result;
      }
    } catch (e) { /* 降级 */ }

    // 策略3: 美债收益率作为跨资产参考（非中国数据但有信号价值）
    try {
      const usResult = await this.fetchUSTreasury();
      if (usResult.us10y != null) {
        result.y10 = usResult.us10y;
        result.y2 = usResult.us2y;
        if (usResult.us2y != null) result.spread_10_2 = Math.round((usResult.us10y - usResult.us2y) * 100) / 100;
        result.source = 'us_treasury_fallback';
        result._note = '中国国债数据暂不可用，以美债收益率为跨资产参考';
        return result;
      }
    } catch (e) { /* 全部失败 */ }

    return result;
  },

  // ── 宏观数据（M2增速 + 制造业PMI）──
  async fetchMacroData() {
    const result = { m2Growth: null, pmiManuf: null, source: null };

    // 策略1: PMI 通过东财数据中台获取（已确认可用）
    try {
      const pmiRes = await fetch(
        'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_PMI&columns=ALL&pageNumber=1&pageSize=1&sortTypes=-1&sortColumns=REPORT_DATE',
        { signal: AbortSignal.timeout(8000) }
      );
      if (pmiRes.ok) {
        const pmiData = await pmiRes.json();
        const latest = pmiData?.result?.data?.[0];
        if (latest && latest.MAKE_INDEX != null) {
          result.pmiManuf = latest.MAKE_INDEX;
          result.source = 'eastmoney';
        }
      }
    } catch (e) { /* PMI降级 */ }

    // 策略2: M2 通过 Worker 搜索获取（服务端，不消耗客户端轮次）
    try {
      const query = '中国 M2 同比增速 最新';
      const serperKey = (typeof SERPER_API_KEY !== 'undefined' ? SERPER_API_KEY : null);
      const tavilyKey = (typeof TAVILY_API_KEY !== 'undefined' ? TAVILY_API_KEY : null);

      let searchText = '';
      // Tavily
      if (tavilyKey) {
        try {
          const tRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: tavilyKey, query, search_depth: 'basic', include_answer: true, max_results: 3 }),
            signal: AbortSignal.timeout(10000)
          });
          if (tRes.ok) {
            const tData = await tRes.json();
            searchText = tData.answer || tData.results?.map(r => r.content).join('\n') || '';
          }
        } catch (e) { /* tavily失败 */ }
      }
      // Serper 补充
      if (!searchText && serperKey) {
        try {
          const sRes = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-KEY': serperKey },
            body: JSON.stringify({ q: query, num: 3, gl: 'cn', hl: 'zh-CN' }),
            signal: AbortSignal.timeout(10000)
          });
          if (sRes.ok) {
            const sData = await sRes.json();
            searchText = (sData.organic || []).map(r => r.snippet || '').join('\n');
          }
        } catch (e) { /* serper失败 */ }
      }
      // 从文本提取M2
      if (searchText) {
        const m2Match = searchText.match(/[Mm]2[^0-9]*?[同]?[比]?[增]?[速]?[率]?[^0-9]*?([0-9]+\.[0-9]+)%/);
        if (m2Match) {
          const val = parseFloat(m2Match[1]);
          if (!isNaN(val) && val > 0 && val < 50) {
            result.m2Growth = val;
            if (!result.source) result.source = 'search';
          }
        }
      }
    } catch (e) { /* M2搜索降级 */ }

    return result;
  },

  // ── 市场集中度（TOP50大市值股加权 vs 等权，判断权重股强拉/砸盘）──
  async fetchMarketConcentration() {
    const result = { weightedAvg: null, equalAvg: null, concentrationRatio: null, sampleCount: 0, topStocks: [] };
    try {
      // 通过东财板块 BK0712（沪深300）获取前50大市值成分股
      const emUrl = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=50&po=1&np=1&fltt=2&invt=2&fid=f20&fs=b:BK0712&fields=f12,f14,f2,f20,f3';
      const res = await fetch(emUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return result;
      const data = await res.json();
      const stocks = data?.data?.diff || [];
      if (stocks.length < 10) return result;

      const totalMcap = stocks.reduce((s, st) => s + Math.abs(st.f20 || 0), 0);
      let weightedSum = 0, equalSum = 0;
      const topNames = [];
      for (const st of stocks) {
        const change = parseFloat(st.f3 || 0);
        const mcap = Math.abs(st.f20 || 0);
        weightedSum += change * (mcap / totalMcap);
        equalSum += change;
        if (topNames.length < 5) topNames.push(st.f14);
      }

      result.weightedAvg = Math.round(weightedSum * 100) / 100;
      result.equalAvg = Math.round(equalSum / stocks.length * 100) / 100;
      result.concentrationRatio = Math.round((weightedSum - equalSum / stocks.length) * 100) / 100;
      result.sampleCount = stocks.length;
      result.topStocks = topNames;
    } catch (e) { /* 全部失败 */ }
    return result;
  },

};

// ── 新闻代理函数（LLM 自主决定查询内容，Worker 清洗+缓存）──

async function proxyRSSHub(route, limit = 8) {
  try {
    const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent('https://rsshub.app/' + route)}&api_key=free&count=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const d = await res.json();
    if (d.status !== 'ok' || !d.items) return [];
    return d.items.slice(0, limit).map(i => ({
      title: (i.title || '').replace(/<[^>]*>/g, '').trim(),
      content: (i.description || '').replace(/<[^>]*>/g, '').trim().substring(0, 500),
      time: i.pubDate || '',
      url: i.link || ''
    }));
  } catch { return []; }
}

async function proxyTavily(query, days = 1, maxResults = 6) {
  try {
    const key = (typeof TAVILY_API_KEY !== 'undefined' ? TAVILY_API_KEY : null);
    if (!key) return [];
    const body = {
      api_key: key, query,
      search_depth: 'advanced', max_results: maxResults,
      topic: 'news', days,
      include_domains: ['cls.cn', 'wallstreetcn.com', 'jin10.com', 'yicai.com', 'stcn.com', 'caixin.com']
    };
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.results || []).slice(0, maxResults).map(r => ({
      title: r.title || '',
      content: (r.content || '').substring(0, 500),
      time: r.published_date || '', url: r.url || ''
    }));
  } catch { return []; }
}

async function proxyExa(query, maxResults = 3) {
  try {
    const key = (typeof EXA_API_KEY !== 'undefined' ? EXA_API_KEY : null);
    if (!key) return [];
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ query, numResults: maxResults, useAutoprompt: true, startPublishedDate: sixMonthsAgo.toISOString() }),
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.results || []).slice(0, maxResults).map(r => ({
      title: r.title || '',
      content: (r.text || r.snippet || '').substring(0, 600),
      time: r.publishedDate || '', url: r.url || ''
    }));
  } catch { return []; }
}

async function proxySina(lid, limit = 6) {
  try {
    const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${lid}&k=&num=${limit}&page=1&r=${Math.random()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const d = await res.json();
    const DAY = 86400000; const now = Date.now();
    const items = (d?.result?.data || []).map(i => ({
      title: (i.title || '').replace(/<[^>]*>/g, '').trim(),
      content: (i.intro || '').replace(/<[^>]*>/g, '').trim().substring(0, 500),
      url: i.url || '',
      time: i.ctime ? new Date(parseInt(i.ctime) * 1000).toISOString().replace('T', ' ').substring(0, 19) : '',
      source: '新浪'
    })).filter(i => i.time);
    const recent = items.filter(i => now - new Date(i.time).getTime() < DAY);
    return recent.length >= 3 ? recent : items.slice(0, limit);
  } catch { return []; }
}

async function proxySerper(query, timeRange = 'qdr:d', num = 6) {
  try {
    const key = (typeof SERPER_API_KEY !== 'undefined' ? SERPER_API_KEY : null);
    if (!key) return [];
    const body = { q: query, num };
    if (timeRange && timeRange !== 'all') body.tbs = timeRange;
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.organic || []).slice(0, num).map(r => ({
      title: r.title || '',
      content: (r.snippet || '').substring(0, 500),
      time: r.date || '', url: r.link || ''
    }));
  } catch { return []; }
}