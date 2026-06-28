// 财经快讯聚合模块：新浪免费快讯 + RSSHub实时电报 + 搜索引擎兜底，去重合并后供 AI 引用
import { buildProxyUrl } from './proxy';
import { fetchTavilySearch, fetchSerperSearch } from './search-engines';
import { debugLog } from '../debugLog';

// RSSHub 源 — 免费、实时、结构化（通过 rss2json.com 代理转 JSON）
const RSSHUB_SOURCES = {
  macro: [
    { route: 'gov/pbc/goutongjiaoliu', label: '央行沟通', icon: '🏦' },
    { route: 'gov/csrc/news', label: '证监会', icon: '📜' },
    { route: 'cls/telegraph', label: '财联社', icon: '⚡' },
  ],
  market: [
    { route: 'cls/telegraph', label: '财联社电报', icon: '⚡' },
    { route: 'wallstreetcn/latest', label: '华尔街见闻', icon: '📰' },
    { route: 'jin10/latest', label: '金十数据', icon: '📊' },
  ],
  bond: [
    { route: 'cls/telegraph', label: '财联社', icon: '⚡' },
  ],
  fund: [
    { route: 'cls/telegraph', label: '财联社', icon: '⚡' },
  ],
};

async function fetchRSSHubFeed(settings, route, limit = 8) {
  try {
    const rssUrl = `https://rsshub.app/${route}`;
    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&api_key=free&count=${limit}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(apiUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok' || !data.items) return [];
    return data.items.slice(0, limit).map(item => ({
      title: (item.title || '').replace(/<[^>]*>/g, '').trim(),
      content: (item.description || '').replace(/<[^>]*>/g, '').trim().substring(0, 400),
      time: item.pubDate || '',
      ts: item.pubDate ? new Date(item.pubDate).getTime() : 0,
      source: `RSSHub-${route.split('/')[0]}`,
    }));
  } catch (e) {
    console.warn(`[RSSHub] ${route} 拉取失败:`, e.message);
    return [];
  }
}

// 新浪财经栏目：免费、无需认证、结构化 JSON
const SINA_LID_MAP = {
  macro:  [
    { lid: 2509, label: '综合财经' },
    { lid: 2516, label: '要闻' },
   { lid: 2511, label: '全球' },
    { lid: 2514, label: '国际' },
    { lid: 2510, label: 'A股' },
    { lid: 2512, label: '债券' },
  ],
  market: [
    { lid: 2510, label: 'A股' },
    { lid: 2515, label: '港股' },
    { lid: 2509, label: '综合' },
  ],
  bond:   [
    { lid: 2512, label: '债券' },
    { lid: 2509, label: '综合' },
  ],
  fund:   [
    { lid: 2513, label: '基金' },
    { lid: 2509, label: '综合' },
  ],
};

// ========================
// 新浪财经
// ========================
function buildSinaUrl(lid, limit) {
  return `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${lid}&k=&num=${limit}&page=1&r=${Math.random()}`;
}

async function fetchSinaFeed(settings, lid, limit) {
  const targetUrl = buildSinaUrl(lid, limit);
  const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
    ? buildProxyUrl(settings, targetUrl)
    : targetUrl;

  const res = await fetch(fetchUrl, { cache: 'no-store' });
  if (!res.ok) return [];

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { return []; }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  let items = (data?.result?.data || [])
    .map(item => ({
      title: (item.title || '').replace(/<[^>]+>/g, '').trim(),
      content: (item.intro || '').replace(/<[^>]+>/g, '').trim(),
      url: item.url || '',
      time: item.ctime ? new Date(parseInt(item.ctime) * 1000).toISOString().replace('T', ' ').substring(0, 19) : '',
      ts: item.ctime ? parseInt(item.ctime) * 1000 : 0,
      source: '新浪',
    }))
    .filter(item => item.ts > 0);
  // 优先保留 24h 内，不足时放宽到 72h
  const recent = items.filter(i => now - i.ts < DAY);
  if (recent.length >= 3) return recent;
  return items.filter(i => now - i.ts < 3 * DAY);
}

async function fetchAllSina(settings, topic, limit) {
  const sources = SINA_LID_MAP[topic] || SINA_LID_MAP.market;
  const perSource = Math.ceil(limit / sources.length);
  const results = await Promise.all(sources.map(s => fetchSinaFeed(settings, s.lid, perSource)));
  const seen = new Set();
  const merged = [];
  for (const list of results) {
    for (const item of list) {
      if (!seen.has(item.title)) { seen.add(item.title); merged.push(item); }
    }
  }
  merged.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  return merged.slice(0, limit);
}

// ========================
// 搜索聚合
// ========================
const SEARCH_TOPIC_MAP = {
  macro:  '中国 央行 货币政策 降准降息 宏观经济 最新政策',
  market: 'A股 大盘 行情 异动 原因 最新',
  bond:   '中国 债券市场 信用债 利率债 最新',
  fund:   '公募基金 最新 新闻',
};

async function fetchSearchNews(settings, topic) {
  const query = SEARCH_TOPIC_MAP[topic] || SEARCH_TOPIC_MAP.market;
  const items = [];

  // Tavily 为主
  if (settings.tavilyApiKey) {
    try {
      const text = await fetchTavilySearch(settings.tavilyApiKey, query, 'news', settings, 'd1');
      if (text) {
        // 解析 Tavily 返回的文本为条目
        const blocks = text.split('---').filter(b => b.trim());
        for (const block of blocks) {
          const titleMatch = block.match(/【标题】(.+)/);
          const contentMatch = block.match(/【量化摘要】(.+)/);
          const timeMatch = block.match(/【发布时间】(.+)/);
          if (titleMatch) {
            items.push({
              title: titleMatch[1].trim(),
              content: (contentMatch ? contentMatch[1].trim() : '').substring(0, 300),
              time: timeMatch ? timeMatch[1].trim() : '',
              source: 'Tavily',
            });
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  // Serper 补充
  if (settings.serperApiKey && items.length < 4) {
    try {
      const text = await fetchSerperSearch(settings.serperApiKey, query + ' (site:cls.cn OR site:wallstreetcn.com)', 'qdr:d', 4, settings);
      if (text) {
        const blocks = text.split('\n\n---\n');
        for (const block of blocks) {
          const titleMatch = block.match(/【网页标题】(.+)/);
          const snippetMatch = block.match(/【摘要】(.+)/);
          if (titleMatch) {
            items.push({
              title: titleMatch[1].trim(),
              content: (snippetMatch ? snippetMatch[1].trim() : '').substring(0, 300),
              time: '',
              source: 'Google',
            });
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  return items;
}

// ========================
// 主入口：Worker策略聚合优先 → 客户端兜底
// LLM 通过 topic 隐含指定搜索策略, Worker 并行拉取+处理+去重
// ========================
export async function fetchFinancialNews(settings, topic = 'market', limit = 12) {
  // Worker 策略聚合（单次请求，Worker 做所有脏活）
  const proxyUrl = (settings?.customProxyUrl || settings?.cfWorkerUrl || '').trim();
  if (proxyUrl) {
    try {
      const base = proxyUrl.split('?')[0].replace(/\/+$/, '');
      const headers = { 'Content-Type': 'application/json' };
      if (settings.workerSecret) headers['Authorization'] = `Bearer ${settings.workerSecret}`;
      const topicQuery = { macro: '央行 货币政策 宏观经济', market: 'A股 大盘 行情', bond: '债券市场 信用债', fund: '公募基金' };
      const res = await fetch(`${base}/api/news`, {
        method: 'POST', headers,
        body: JSON.stringify({
          query: topicQuery[topic] || topicQuery.market,
          sources: [`rsshub:cls/telegraph`, `sina:${topic}`, 'tavily'],
          limit
        }),
        signal: AbortSignal.timeout(12000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.items?.length > 0) {
          debugLog(`[财经快讯] Worker策略聚合 ${data.items.length}条`);
          return { source: data.source, items: data.items };
        }
      }
    } catch (e) { console.warn('[财经快讯] Worker不可用,降级:', e.message); }
  }

  // 兜底: 客户端聚合
  const rssSources = RSSHUB_SOURCES[topic] || RSSHUB_SOURCES.market;
  const rssPromises = rssSources.map(s => fetchRSSHubFeed(settings, s.route, Math.ceil(limit / rssSources.length)));
  const [sinaItems, ...rssResults] = await Promise.all([fetchAllSina(settings, topic, limit), ...rssPromises, fetchSearchNews(settings, topic)]);
  const searchItems = rssResults.pop(); const rssItems = rssResults.flat();
  const seen = new Set(); const allItems = [];
  for (const src of [{ items: rssItems, prio: 1 }, { items: sinaItems, prio: 2 }, { items: searchItems, prio: 3 }]) {
    for (const item of src.items) {
      if (!seen.has(item.title) && allItems.length < limit + 4) { seen.add(item.title); allItems.push(item); }
    }
  }
  allItems.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  debugLog(`[财经快讯] 客户端聚合 ${allItems.slice(0, limit).length}条`);
  return { source: '多源聚合(客户端)', items: allItems.slice(0, limit) };
}
