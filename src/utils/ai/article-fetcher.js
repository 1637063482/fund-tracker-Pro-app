// 网页全文提取层 — Jina AI Reader (免费 1000次/天, 经Worker代理处理CORS)
// LLM 从搜索结果中选择 URL → 调用此工具 → 获得完整 Markdown 正文
// https://jina.ai/reader

import { buildProxyUrl } from './proxy';

const MAX_CHARS = 3000;
const TIMEOUT = 12000;

export const fetchArticleContent = async (url, settings = {}) => {
  if (!url || !url.startsWith('http')) return null;
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, jinaUrl) : jinaUrl;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    const res = await fetch(fetchUrl, {
      signal: ctrl.signal,
      headers: { 'Accept': 'text/markdown' }
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text.length > MAX_CHARS ? text.substring(0, MAX_CHARS) + '\n\n...(截断)' : text;
  } catch (e) {
    console.warn(`[article-fetcher] 提取失败 ${url}:`, e.message);
    return null;
  }
};

export const fetchArticleBatch = async (urls, settings = {}) => {
  const limited = urls.slice(0, 3);
  const results = [];
  for (const url of limited) {
    const content = await fetchArticleContent(url, settings);
    if (content) results.push({ url, content });
    // Jina 免费版限流: 请求间隔 800ms
    if (limited.indexOf(url) < limited.length - 1) {
      await new Promise(r => setTimeout(r, 800));
    }
  }
  return results;
};
