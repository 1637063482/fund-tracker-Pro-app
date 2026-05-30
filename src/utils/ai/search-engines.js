// 搜索引擎适配器：Tavily、Exa、Serper
import { buildProxyUrl } from './proxy';

export const fetchTavilySearch = async (apiKey, query, searchType = "news", settings = {}, timeRange = "d1") => {
  if (!apiKey) return "";
  try {
    const targetUrl = 'https://api.tavily.com/search';
    const bodyPayload = {
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 4,
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

export const fetchExaSearch = async (apiKey, query, settings = {}) => {
  if (!apiKey) return "";
  try {
    const targetUrl = 'https://api.exa.ai/search';

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const fetchUrl = buildProxyUrl(settings, targetUrl);

    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        query,
        numResults: 2,
        useAutoprompt: true,
        startPublishedDate: sixMonthsAgo.toISOString(),
        contents: {
          highlights: { numSentences: 5, highlightsPerUrl: 3, query }
        }
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

export const fetchSerperSearch = async (apiKey, query, timeRange = "qdr:d") => {
  if (!apiKey) return "";
  try {
    const bodyPayload = { q: query, num: 4 };
    if (timeRange && timeRange !== "all") {
      bodyPayload.tbs = timeRange;
    }

    const res = await fetch('https://google.serper.dev/search', {
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
