// 搜索引擎适配器模块：统一封装 Tavily、Exa、Serper，优先经 Worker 代理转发
import { buildProxyUrl } from './proxy';

// Worker 代理通用调用
const callWorkerProxy = async (settings, endpoint, body) => {
  const proxyUrl = (settings?.customProxyUrl || settings?.cfWorkerUrl || '').trim();
  if (!proxyUrl) return null;
  try {
    const base = proxyUrl.split('?')[0].replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (settings.workerSecret) headers['Authorization'] = `Bearer ${settings.workerSecret}`;
    const res = await fetch(`${base}${endpoint}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.items || [];
  } catch (e) {
    console.warn(`[Worker代理] ${endpoint} 失败:`, e.message);
    return null;
  }
};

const formatSearchItems = (items) => {
  if (!items || items.length === 0) return '';
  return items.map(r =>
    `【标题】${r.title}\n【发布时间】${r.time || '近期'}\n【摘要】${r.content}\n【链接】${r.url || ''}`
  ).join('\n\n---\n');
};

export const fetchTavilySearch = async (apiKey, query, searchType = "news", settings = {}, timeRange = "d1", maxResults = 6) => {
  if (!apiKey && !settings?.cfWorkerUrl) return "";
  try {
    // Worker 代理优先
    const items = await callWorkerProxy(settings, '/api/proxy/tavily', {
      query, days: timeRange === 'd1' ? 1 : timeRange === 'w1' ? 7 : timeRange === 'd3' ? 3 : 1, maxResults
    });
    if (items && items.length > 0) return formatSearchItems(items);

    // 兜底: 直连
    const targetUrl = 'https://api.tavily.com/search';
    const bodyPayload = {
      api_key: apiKey, query,
      search_depth: "advanced", max_results: Math.max(maxResults, 6),
      topic: "news",
      days: timeRange === "d1" ? 1 : (timeRange === "w1" ? 7 : (timeRange === "d3" ? 3 : 1)),
      include_domains: ["cls.cn", "wallstreetcn.com", "jin10.com", "yicai.com", "stcn.com", "caixin.com"],
      exclude_domains: ["eastmoney.com", "baidu.com", "zhihu.com"]
    };
    const fetchUrl = buildProxyUrl(settings, targetUrl);
    const res = await fetch(fetchUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyPayload) });
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return data.results.map(r => `【发布时间】${r.published_date || '近期'}\n【信息源】${r.url}\n【标题】${r.title}\n【量化摘要】${r.content}`).join('\n\n---\n');
    }
    return "";
  } catch (e) { return ""; }
};

export const fetchExaSearch = async (apiKey, query, settings = {}, maxResults = 3) => {
  if (!apiKey && !settings?.cfWorkerUrl) return "";
  try {
    // Worker 代理优先
    const items = await callWorkerProxy(settings, '/api/proxy/exa', { query, maxResults });
    if (items && items.length > 0) return formatSearchItems(items);

    // 兜底: 直连
    const targetUrl = 'https://api.exa.ai/search';
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const fetchUrl = buildProxyUrl(settings, targetUrl);
    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        query, numResults: maxResults, useAutoprompt: true,
        startPublishedDate: sixMonthsAgo.toISOString(),
        contents: { highlights: { numSentences: 5, highlightsPerUrl: 3, query } }
      })
    });
    if (!res.ok) throw new Error(`Exa HTTP ${res.status}`);
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return data.results.map(r => {
        const pubDate = r.publishedDate ? r.publishedDate.split('T')[0] : '近期';
        const hlText = (r.highlights && r.highlights.length > 0)
          ? r.highlights.map(hl => `> ${hl}`).join('\n')
          : '未提取到高亮核心摘要';
        return `【发布时间】${pubDate}\n【文献标题】${r.title}\n【核心提取】\n${hlText}`;
      }).join('\n\n---\n');
    }
    return "";
  } catch (e) {
    console.warn("Exa 引擎执行失败:", e);
    return "";
  }
};

export const fetchSerperSearch = async (apiKey, query, timeRange = "qdr:d", maxResults = 6, settings) => {
  if (!apiKey && !settings?.cfWorkerUrl) return "";
  try {
    // Worker 代理优先
    const items = await callWorkerProxy(settings, '/api/proxy/serper', { query, timeRange, num: maxResults });
    if (items && items.length > 0) return formatSearchItems(items);

    // 兜底: 直连
    const bodyPayload = { q: query, num: maxResults };
    if (timeRange && timeRange !== "all") bodyPayload.tbs = timeRange;
    const serperUrl = 'https://google.serper.dev/search';
    const fetchUrl = settings ? buildProxyUrl(settings, serperUrl) : serperUrl;
    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify(bodyPayload)
    });
    const data = await res.json();
    if (data.organic && data.organic.length > 0) {
      return data.organic.map(r => `【发布时间】${r.date || '未知'}\n【网页标题】${r.title}\n【摘要】${r.snippet}`).join('\n\n---\n');
    }
    return "";
  } catch (e) { return ""; }
};
