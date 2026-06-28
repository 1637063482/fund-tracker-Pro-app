// Cloudflare Worker — 新闻资讯专用聚合器
// 部署: wrangler deploy (或通过 Dashboard 粘贴)
// 环境变量: SYNC_SECRET (鉴权密钥, 与 my-cors-proxy 共用)
//           TAVILY_API_KEY (可选, 搜索增强)
//           SERPER_API_KEY (可选, 搜索增强)

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── 鉴权 ──
    if (url.pathname.startsWith('/api/news')) {
      const authHeader = request.headers.get('Authorization') || '';
      const urlKey = url.searchParams.get('key') || '';
      const providedKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : urlKey;
      const validKey = env.SYNC_SECRET || env.SECRET || env.API_KEY;
      if (validKey && providedKey !== validKey) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } else {
      return new Response('Not Found', { status: 404, headers: corsHeaders });
    }

    // ── 参数解析 ──
    const topic = url.searchParams.get('topic') || 'market';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '12'), 20);
    const cacheKey = `news:${topic}:${limit}`;

    // ── 缓存 (Cache API, 5分钟) ──
    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    // ── 聚合 ──
    const results = await aggregateNews(env, topic, limit);
    const response = new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
    });

    // 写入缓存 (克隆因为 Response body 只能读一次)
    const toCache = response.clone();
    await cache.put(request, toCache);

    return response;
  }
};

// ========================
// 新闻源配置
// ========================

const RSSHUB_ROUTES = {
  macro: ['gov/pbc/goutongjiaoliu', 'gov/csrc/news', 'cls/telegraph'],
  market: ['cls/telegraph', 'wallstreetcn/latest', 'jin10/latest'],
  bond: ['cls/telegraph'],
  fund: ['cls/telegraph'],
};

const SINA_LIDS = {
  macro:  [2509, 2516, 2511, 2514],
  market: [2510, 2515, 2509],
  bond:   [2512, 2509],
  fund:   [2513, 2509],
};

async function aggregateNews(env, topic, limit) {
  const items = [];

  // 1. RSSHub 源 (并行)
  const routes = RSSHUB_ROUTES[topic] || RSSHUB_ROUTES.market;
  const rssPromises = routes.map(route => fetchRSSHub(route));
  const rssResults = await Promise.all(rssPromises);
  for (const batch of rssResults) {
    items.push(...batch);
  }

  // 2. 新浪财经 (并行)
  const lids = SINA_LIDS[topic] || SINA_LIDS.market;
  const sinaPromises = lids.map(lid => fetchSinaFeed(lid, Math.ceil(limit / lids.length)));
  const sinaResults = await Promise.all(sinaPromises);
  for (const batch of sinaResults) {
    items.push(...batch);
  }

  // 3. 搜索增强 (条件)
  if (env.TAVILY_API_KEY) {
    try {
      const tavItems = await fetchTavily(env.TAVILY_API_KEY, topic);
      items.push(...tavItems);
    } catch (e) { /* ignore */ }
  }
  if (env.SERPER_API_KEY) {
    try {
      const serpItems = await fetchSerper(env.SERPER_API_KEY, topic);
      items.push(...serpItems);
    } catch (e) { /* ignore */ }
  }

  // 去重合并
  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    if (!seen.has(item.title) && deduped.length < limit + 4) {
      seen.add(item.title);
      deduped.push(item);
    }
  }
  deduped.sort((a, b) => (b.time || '').localeCompare(a.time || ''));

  return {
    source: 'Worker聚合(RSSHub+新浪+搜索)',
    count: Math.min(deduped.length, limit),
    items: deduped.slice(0, limit)
  };
}

// ========================
// RSSHub (通过 rss2json 转 JSON)
// ========================
async function fetchRSSHub(route) {
  try {
    const rssUrl = `https://rsshub.app/${route}`;
    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&api_key=free&count=8`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok' || !data.items) return [];
    return data.items.slice(0, 8).map(item => ({
      title: stripHtml(item.title || ''),
      content: stripHtml(item.description || '').substring(0, 400),
      time: item.pubDate || '',
      source: `RSSHub-${route.split('/')[0]}`
    }));
  } catch (e) {
    console.warn(`[RSSHub] ${route}: ${e.message}`);
    return [];
  }
}

// ========================
// 新浪财经 (免费 JSON API)
// ========================
async function fetchSinaFeed(lid, limit) {
  try {
    const url = `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${lid}&k=&num=${limit}&page=1&r=${Math.random()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const now = Date.now();
    const DAY = 86400000;
    const items = (data?.result?.data || [])
      .map(item => ({
        title: stripHtml(item.title || ''),
        content: stripHtml(item.intro || '').substring(0, 300),
        time: item.ctime ? new Date(parseInt(item.ctime) * 1000).toISOString().replace('T', ' ').substring(0, 19) : '',
        source: '新浪'
      }))
      .filter(item => item.time);
    const recent = items.filter(i => now - new Date(i.time).getTime() < DAY);
    return recent.length >= 3 ? recent : items.slice(0, limit);
  } catch (e) {
    console.warn(`[Sina] lid=${lid}: ${e.message}`);
    return [];
  }
}

// ========================
// Tavily (需要 API Key)
// ========================
const TOPIC_KEYWORDS = {
  macro:  '中国 央行 货币政策 降准降息 宏观经济 CPI PMI',
  market: 'A股 大盘 行情 异动 最新',
  bond:   '中国 债券市场 信用债 利率债',
  fund:   '公募基金 最新 新闻',
};

async function fetchTavily(apiKey, topic) {
  const query = TOPIC_KEYWORDS[topic] || TOPIC_KEYWORDS.market;
  const body = {
    api_key: apiKey,
    query,
    search_depth: 'advanced',
    max_results: 5,
    topic: 'news',
    days: 1,
    include_domains: ['cls.cn', 'wallstreetcn.com', 'jin10.com', 'yicai.com', 'stcn.com', 'caixin.com'],
  };
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).slice(0, 4).map(r => ({
    title: r.title || '',
    content: (r.content || '').substring(0, 400),
    time: r.published_date || '',
    source: 'Tavily'
  }));
}

// ========================
// Serper (Google Search, 需要 API Key)
// ========================
async function fetchSerper(apiKey, topic) {
  const query = TOPIC_KEYWORDS[topic] || TOPIC_KEYWORDS.market;
  const body = {
    q: `${query} site:cls.cn OR site:wallstreetcn.com OR site:jin10.com OR site:stcn.com`,
    num: 6,
    tbs: 'qdr:d'
  };
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.organic || []).slice(0, 5).map(r => ({
    title: r.title || '',
    content: (r.snippet || '').substring(0, 300),
    time: r.date || '',
    source: 'Google',
    url: r.link || ''
  }));
}

function stripHtml(str) {
  return (str || '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, '').trim();
}
