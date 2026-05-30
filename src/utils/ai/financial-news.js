// 多源财经快讯聚合器 — 新浪财经 + 搜索兜底，并行拉取去重合并
import { buildProxyUrl } from './proxy';
import { fetchTavilySearch, fetchSerperSearch } from './search-engines';

// 新浪财经栏目：免费、无需认证、结构化 JSON
const SINA_LID_MAP = {
  macro:  [
    { lid: 2509, label: '综合财经' },
    { lid: 2516, label: '要闻' },
    { lid: 2511, label: '全球' },
    { lid: 2514, label: '国际' },
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

  return (data?.result?.data || []).map(item => ({
    title: (item.title || '').replace(/<[^>]+>/g, '').trim(),
    content: (item.intro || '').replace(/<[^>]+>/g, '').trim(),
    time: item.ctime ? new Date(parseInt(item.ctime) * 1000).toISOString().replace('T', ' ').substring(0, 19) : '',
    source: '新浪',
  }));
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
      const text = await fetchSerperSearch(settings.serperApiKey, query + ' (site:cls.cn OR site:wallstreetcn.com)', 'qdr:d');
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
// 主入口：并行聚合
// ========================
export async function fetchFinancialNews(settings, topic = 'market', limit = 12) {
  // 新浪 + 搜索 并行
  const [sinaItems, searchItems] = await Promise.all([
    fetchAllSina(settings, topic, limit),
    fetchSearchNews(settings, topic),
  ]);

  // 去重合并（标题相似度简单去重）
  const seen = new Set();
  for (const item of sinaItems) seen.add(item.title);
  const allItems = [...sinaItems];

  for (const item of searchItems) {
    if (!seen.has(item.title) && allItems.length < limit + 4) {
      seen.add(item.title);
      allItems.push(item);
    }
  }

  allItems.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  const final = allItems.slice(0, limit);

  if (final.length > 0) {
    console.log('[财经快讯] 聚合 ' + final.length + ' 条（新浪 ' + sinaItems.length + ' + 搜索 ' + searchItems.length + '）');
  }

  return { source: '多源聚合', items: final };
}
