// 共享数据拉取工具——统一超时、错误兜底、GBK 解码
// 供 handlers.js 和 market-data.js 使用，消除内联 fetch 重复
import { buildProxyUrl, buildAllOriginsUrl, reportProxyFailure, reportProxySuccess, rateLimitedFetch } from './proxy';
import { fetchTavilySearch, fetchSerperSearch } from './search-engines';

const FETCH_TIMEOUT = 10000;

// 带超时的 fetch
const fetchWithTimeout = async (url, options = {}, timeout = FETCH_TIMEOUT) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
};

// 从 qt.gtimg.cn 拉取实时行情（GBK 编码）
// codes: 如 'sh000001,sz399001,sz399006'
export const fetchTencentQuotes = async (codes, settings) => {
  try {
    const url = `https://qt.gtimg.cn/q=${codes}`;
    const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, url) : url; // qt.gtimg.cn 通常直连可达，不做 CORS 代理
    const res = await fetchWithTimeout(fetchUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    reportProxySuccess();
    return new TextDecoder('gbk').decode(buf);
  } catch (e) {
    console.warn(`[data-fetcher] 腾讯行情拉取失败 (${codes}):`, e.message);
    reportProxyFailure();
    return null;
  }
};

// 从新浪拉取 GBK 数据
export const fetchSinaGBK = async (url) => {
  try {
    const res = await fetchWithTimeout(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } });
    const buf = await res.arrayBuffer();
    return new TextDecoder('gbk').decode(buf);
  } catch (e) {
    console.warn(`[data-fetcher] 新浪数据拉取失败:`, e.message);
    return null;
  }
};

// 从蛋卷 API 拉取指数估值（PE/PB 分位）
// 使用 DJ API（与 handleGetIndexValuation 同源），字段: { index_code, pe_percentile, pb_percentile, ... }
export const fetchDanjuanIndexValuation = async (settings) => {
  try {
    const url = 'https://danjuanfunds.com/djapi/index_eva/dj?page=1&size=200';
    const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, url) : buildAllOriginsUrl(url);
    const res = await fetchWithTimeout(fetchUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch {
      if (raw.includes('contents')) {
        const wrapped = JSON.parse(raw);
        data = typeof wrapped.contents === 'string' ? JSON.parse(wrapped.contents) : wrapped.contents;
      }
    }
    reportProxySuccess();
    return data?.data?.items || [];
  } catch (e) {
    console.warn('[data-fetcher] 蛋卷估值拉取失败:', e.message);
    reportProxyFailure();
    return [];
  }
};

// 从东方财富拉取涨跌家数（JSONP 优先，代理降级）
export const fetchEastMoneyBreadth = async (settings) => {
  const emUrl = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001,0.399001&fields=f104,f105,f106';
  // 策略1: JSONP 原生绕过
  try {
    const result = await new Promise((resolve, reject) => {
      const cb = `jq${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); delete window[cb]; reject(new Error('JSONP timeout')); }, 8000);
      window[cb] = (data) => { clearTimeout(timer); script.remove(); delete window[cb]; resolve(data); };
      script.onerror = () => { clearTimeout(timer); script.remove(); delete window[cb]; reject(new Error('JSONP load error')); };
      script.src = `${emUrl}&cb=${cb}&_=${Date.now()}`;
      document.head.appendChild(script);
    });
    if (result?.data?.diff) return result;
  } catch (e) { /* fall through */ }

  // 策略2: 代理降级
  try {
    const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, emUrl) : buildAllOriginsUrl(emUrl);
    const res = await fetchWithTimeout(fetchUrl);
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = JSON.parse(JSON.parse(raw).contents); }
    if (data?.data?.diff) return data;
  } catch (e) { console.warn('[data-fetcher] 东财涨跌家数拉取失败:', e.message); }
  return null;
};

// 获取信用利差方向 — 国债指数(000012) vs 企债指数(000013)
// 返回 { govPct, corpPct, spreadVal, direction: 'narrow'|'stable'|'widen' }, 失败返回 null
export const fetchBondSpread = async (settings) => {
  try {
    const text = await fetchTencentQuotes('sh000012,sh000013', settings);
    if (!text) throw new Error('empty response');
    const bondMap = {};
    text.split(';').filter(l => l.includes('v_sh')).forEach(line => {
      const arr = line.substring(line.indexOf('="') + 2, line.length - 1).split('~');
      if (arr.length < 5) return;
      const code = arr[2], price = parseFloat(arr[3]), prevClose = parseFloat(arr[4]) || 0;
      const pct = prevClose > 0 ? (price - prevClose) / prevClose * 100 : 0;
      if (code) bondMap[code] = pct;
    });
    const govPct = bondMap['000012'] ?? 0;
    const corpPct = bondMap['000013'] ?? 0;
    const spreadVal = corpPct - govPct;
    let direction = 'stable';
    if (spreadVal > 0.05) direction = 'narrow';
    else if (spreadVal < -0.05) direction = 'widen';
    return { govPct, corpPct, spreadVal, direction };
  } catch (e) {
    console.warn('[data-fetcher] 信用利差拉取失败:', e.message);
    return null;
  }
};

// 北向资金（沪深股通）— 日度净流入/净流出 + 累计
// API: push2.eastmoney.com/api/qt/stock/get
// 沪股通: secid=1.000001, 深股通: secid=0.399001
// 字段: f136=沪买入累计 f137=沪净流入日 f138=沪买入日 f139=沪卖出日 f140=沪净流入日(alt)
// v1.7.1+ 修复: 多级代理降级 (custom → allorigins → codetabs) + Worker 并发控制
const _fetchNBWithFallback = async (secid, settings) => {
  const baseUrl = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f136,f137,f138,f139,f140`;
  const fetchUrls = [];
  if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
    fetchUrls.push({ url: buildProxyUrl(settings, baseUrl), label: 'custom' });
  }
  fetchUrls.push(
    { url: `https://corsproxy.io/?${encodeURIComponent(baseUrl)}`, label: 'corsproxy' },
    { url: buildAllOriginsUrl(baseUrl), label: 'allorigins' },
    { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(baseUrl)}`, label: 'codetabs' }
  );

  for (const { url, label } of fetchUrls) {
    try {
      const timeoutMs = label === 'custom' ? 8000 : label === 'corsproxy' ? 12000 : 10000;
      const res = label === 'custom'
        ? await rateLimitedFetch(url, { signal: AbortSignal.timeout(timeoutMs) })
        : await fetchWithTimeout(url, {}, timeoutMs);

      if (res.ok) {
        let data;
        if (label === 'custom') {
          try { data = await res.json(); } catch { continue; }
        } else if (label === 'corsproxy') {
          // corsproxy.io 直接返回 JSON，不包裹在 .contents 中
          try { data = await res.json(); } catch { continue; }
        } else {
          const raw = await res.text();
          try {
            const wrapped = JSON.parse(raw);
            data = wrapped.contents ? (typeof wrapped.contents === 'string' ? JSON.parse(wrapped.contents) : wrapped.contents) : wrapped;
          } catch { continue; }
        }
        if (data?.data) {
          reportProxySuccess();
          return {
            netInflowDay: (data.data.f137 || 0) / 1e8,
            buyDay: (data.data.f138 || 0) / 1e8,
            sellDay: (data.data.f139 || 0) / 1e8,
          };
        }
      }
      reportProxyFailure();
    } catch (e) { /* 继续下一个代理 */ }
  }
  return null;
};

export const fetchNorthboundData = async (settings) => {
  try {
    const results = {};
    // 沪股通
    const shData = await _fetchNBWithFallback('1.000001', settings);
    if (shData) results.sh = shData;

    // 深股通（延迟 300ms 避免同域并发限流）
    if (shData) {
      await new Promise(r => setTimeout(r, 300));
      try {
        const szData = await _fetchNBWithFallback('0.399001', settings);
        if (szData) results.sz = szData;
      } catch (e) { /* 深股通单独容错 */ }
    }

    if (results.sh || results.sz) {
      const totalNet = (results.sh?.netInflowDay || 0) + (results.sz?.netInflowDay || 0);
      results.totalNetInflow = totalNet;
      results.direction = totalNet > 10 ? 'significant_inflow' : totalNet < -10 ? 'significant_outflow'
        : totalNet > 2 ? 'modest_inflow' : totalNet < -2 ? 'modest_outflow' : 'neutral';
      return results;
    }
    return null;
  } catch (e) {
    console.warn('[data-fetcher] 北向资金拉取失败:', e.message);
    return null;
  }
};

// 行业资金流向（通过 Worker 代理获取）
export const fetchSectorCapitalFlow = async (settings) => {
  try {
    const workerUrl = settings.cfWorkerUrl || '';
    const workerSecret = settings.workerSecret || '';
    if (!workerUrl) throw new Error('No CF Worker URL configured');

    const url = `${workerUrl}/api/sector-capital-flow${workerSecret ? `?key=${workerSecret}` : ''}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Worker HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch (e) {
    console.warn('[data-fetcher] 行业资金流向拉取失败:', e.message);
    return null;
  }
};

// ============================================================================
// 国债收益率 — 1Y/2Y/5Y/10Y
// ============================================================================

/**
 * 从东财 datacenter API 响应中解析国债收益率（纯函数，可测试）
 * @param {Object} apiResponse - 东财 datacenter-web 原始响应
 * @returns {Object} - { y1, y2, y5, y10, spread_10_2 } 或空对象
 */
export function parseBondYieldData(apiResponse) {
  if (!apiResponse?.result?.data) return {};

  const yields = {};
  for (const row of apiResponse.result.data) {
    const abbr = row.BOND_ABBR || '';
    const code = String(row.BOND_CODE || '');
    // 只取国债：名称含"国债" 或 代码以 1 开头
    // 无代码/无名称时默认保留（东财 yield report 主体就是国债）
    const isTreasury = !abbr && !code
      || abbr.includes('国债') || code.startsWith('1');
    // 明确排除政策行债/地方债
    const isExcluded = abbr.includes('农发') || abbr.includes('国开')
      || abbr.includes('铁道') || abbr.includes('地方');
    if (!isTreasury || isExcluded) continue;

    const yieldVal = parseFloat(row.BOND_YIELD);
    if (isNaN(yieldVal)) continue;

    // 兼容不同字段名：YEAR / TERM / BOND_YEAR
    const term = row.YEAR ?? row.TERM ?? row.BOND_YEAR;
    if (term == null) continue;

    const t = parseInt(term);
    if (t === 1) yields.y1 = yieldVal;
    else if (t === 2) yields.y2 = yieldVal;
    else if (t === 5) yields.y5 = yieldVal;
    else if (t === 10) yields.y10 = yieldVal;
    else if (t === 30) yields.y30 = yieldVal;
  }

  if (yields.y10 != null && yields.y2 != null) {
    yields.spread_10_2 = Math.round((yields.y10 - yields.y2) * 100) / 100;
  }

  return yields;
}

/**
 * 获取中国国债收益率曲线数据（1Y/2Y/5Y/10Y）
 * 策略1: 东财 datacenter-web 直连
 * 策略2: CORS 代理降级
 * 策略3: 搜索（Tavily/Serper）提取
 * 失败返回 null（不影响主流程）
 */
export const fetchBondYields = async (settings) => {
  // 尝试多个 Worker URL 来源
  const urls = [
    settings?.customProxyUrl,
    settings?.cfWorkerUrl,
    // 兜底：已知部署的 Worker
    'https://my-cors-proxy.wh1637063482.workers.dev'
  ].filter(Boolean);

  for (const workerUrl of urls) {
    try {
      const base = workerUrl.split('?')[0].replace(/\/+$/, '');
      const headers = {};
      if (settings?.workerSecret) headers['Authorization'] = `Bearer ${settings.workerSecret}`;
      const res = await fetch(`${base}/api/bond-yields`, { headers, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const json = await res.json();
        if (json.y10 != null) return json;
      }
    } catch (e) { /* 降级到下一个URL */ }
  }

  return null;
}

/** parseBondYieldData 已在之前定义 */

/**
 * 从搜索文本中提取国债收益率（纯函数，可测试）
 * 处理中文/英文混合的收益率表述
 */
export function parseYieldText(text) {
  if (!text) return {};

  const yields = {};
  const patterns = [
    { term: 1, re: /[1一]年[期]?(?:国债)?[^0-9]*?[收收率率]*?[约为报]*?\s*([0-9]+\.[0-9]+)%/ },
    { term: 2, re: /[2二]年[期]?(?:国债)?[^0-9]*?[收收率率]*?[约为报]*?\s*([0-9]+\.[0-9]+)%/ },
    { term: 5, re: /[5五]年[期]?(?:国债)?[^0-9]*?[收收率率]*?[约为报]*?\s*([0-9]+\.[0-9]+)%/ },
    { term: 10, re: /10年[期]?(?:国债)?[^0-9]*?[收收率率]*?[约为报]*?\s*([0-9]+\.[0-9]+)%/ },
    { term: 1, re: /\b1[Yy][^0-9]*?(?:yield|收益率)?[^0-9]*?([0-9]+\.[0-9]+)%?/ },
    { term: 2, re: /\b2[Yy][^0-9]*?(?:yield|收益率)?[^0-9]*?([0-9]+\.[0-9]+)%?/ },
    { term: 5, re: /\b5[Yy][^0-9]*?(?:yield|收益率)?[^0-9]*?([0-9]+\.[0-9]+)%?/ },
    { term: 10, re: /\b10[Yy][^0-9]*?(?:yield|收益率)?[^0-9]*?([0-9]+\.[0-9]+)%?/ },
    { special: 'spread', re: /[期期]限利差[^0-9\-]*?([\-0-9]+\.[0-9]+)%?/ },
  ];

  for (const p of patterns) {
    const m = text.match(p.re);
    if (m) {
      const val = parseFloat(m[1]);
      if (!isNaN(val)) {
        if (p.special === 'spread') yields.spread_10_2 = val;
        else if (p.term === 1) yields.y1 = val;
        else if (p.term === 2) yields.y2 = val;
        else if (p.term === 5) yields.y5 = val;
        else if (p.term === 10) yields.y10 = val;
      }
    }
  }

  if (yields.spread_10_2 == null && yields.y10 != null && yields.y2 != null) {
    yields.spread_10_2 = Math.round((yields.y10 - yields.y2) * 100) / 100;
  }
  return yields;
}

// ============================================================================
// 宏观数据 — M2增速 + 制造业PMI
// ============================================================================

/**
 * 从搜索文本中提取 M2 增速和 PMI（纯函数，可测试）
 * @param {string} text - 搜索返回的文本内容
 * @returns {Object} - { m2Growth, pmiManuf } 或空对象
 */
export function parseMacroData(text) {
  if (!text) return {};
  const result = {};

  // M2 增速模式
  const m2Patterns = [
    /[Mm]2[^0-9]*?[同]?[比]?[增]?[速]?[率]?[^0-9]*?([0-9]+\.[0-9]+)%/,
    /广义货币[^0-9]*?[Mm]2[\s\S]*?同比[增]?[长]?[^0-9]*?([0-9]+\.[0-9]+)%/,
    /广义货币[^0-9]*?[Mm]2[\s\S]*?[增]?[速]?[率]?[^0-9]*?([0-9]+\.[0-9]+)%/,
    /[Mm]2[增][速][^0-9]*?([0-9]+\.[0-9]+)%/,
    /[Mm]2[^0-9]*?grew[^0-9]*?([0-9]+\.[0-9]+)%/,
    /[Mm]2[^0-9]*?growth[^0-9]*?([0-9]+\.[0-9]+)%/,
  ];
  for (const re of m2Patterns) {
    const m = text.match(re);
    if (m) {
      const val = parseFloat(m[1]);
      if (!isNaN(val) && val > 0 && val < 50) { result.m2Growth = val; break; }
    }
  }

  // PMI 模式
  const pmiPatterns = [
    /制造业[Pp][Mm][Ii][^0-9]*?([0-9]+\.[0-9]+)%?/,
    /[制][造][业][Pp][Mm][Ii][^0-9]*?([0-9]+\.[0-9]+)/,
    /官方[制][造][业][Pp][Mm][Ii][^0-9]*?([0-9]+\.[0-9]+)/,
    /Manufacturing[^0-9]*?PMI[^0-9]*?(\d+\.?\d*)/,
    /PMI[^0-9]*?stands[^0-9]*?(\d+\.?\d*)/,
  ];
  for (const re of pmiPatterns) {
    const m = text.match(re);
    if (m) {
      const val = parseFloat(m[1]);
      if (!isNaN(val) && val > 20 && val < 70) { result.pmiManuf = val; break; }
    }
  }

  return result;
}

/** 通过搜索获取 M2/PMI 宏观数据 */
async function searchMacroData(settings) {
  // M2 搜索（月度数据，搜当月或上月）
  const now = new Date();
  const ym = now.getFullYear() + '年' + (now.getMonth() + 1) + '月';
  const m2Query = `中国 M2 同比增速 最新 ${ym}`;
  const pmiQuery = `中国 制造业 PMI 最新 ${ym}`;

  async function searchOne(query) {
    if (settings.tavilyApiKey || settings.cfWorkerUrl) {
      const txt = await fetchTavilySearch(settings.tavilyApiKey, query, 'news', settings, 'w1', 3);
      if (txt) return txt;
    }
    if (settings.serperApiKey || settings.cfWorkerUrl) {
      return await fetchSerperSearch(settings.serperApiKey, query, 'qdr:w', 3, settings);
    }
    return '';
  }

  // 并行搜索 M2 和 PMI
  const [m2Text, pmiText] = await Promise.all([
    searchOne(m2Query),
    searchOne(pmiQuery),
  ]);

  const combined = [m2Text, pmiText].filter(Boolean).join('\n\n');
  return combined ? parseMacroData(combined) : null;
}

/**
 * 获取宏观数据（M2增速 + 制造业PMI）
 * Worker优先（服务端拉取），失败返回 null
 */
export const fetchMacroData = async (settings) => {
  // 策略1: CF Worker（服务端，无客户端搜索消耗）
  const urls = [
    settings?.customProxyUrl,
    settings?.cfWorkerUrl,
    'https://my-cors-proxy.wh1637063482.workers.dev'
  ].filter(Boolean);

  for (const workerUrl of urls) {
    try {
      const base = workerUrl.split('?')[0].replace(/\/+$/, '');
      const headers = {};
      if (settings?.workerSecret) headers['Authorization'] = `Bearer ${settings.workerSecret}`;
      const res = await fetch(`${base}/api/macro-data`, { headers, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const json = await res.json();
        if (json.pmiManuf != null || json.m2Growth != null) return json;
      }
    } catch (e) { /* 降级到搜索 */ }
  }

  // 策略2: 客户端搜索兜底
  try {
    return await searchMacroData(settings);
  } catch (e) {
    console.warn('[data-fetcher] 宏观数据获取失败:', e.message);
    return null;
  }
};

// ============================================================================
// 市场集中度 — 权重股 vs 等权
// ============================================================================

/**
 * 获取市场集中度（TOP50大市值股加权 vs 等权）
 * 正值 → 大市值跑赢，权重股强拉指数；负值 → 大市值跑输，中小盘占优
 * 通过 Worker 获取，失败返回 null
 */
export const fetchMarketConcentration = async (settings) => {
  const urls = [
    settings?.customProxyUrl,
    settings?.cfWorkerUrl,
    'https://my-cors-proxy.wh1637063482.workers.dev'
  ].filter(Boolean);

  for (const workerUrl of urls) {
    try {
      const base = workerUrl.split('?')[0].replace(/\/+$/, '');
      const headers = {};
      if (settings?.workerSecret) headers['Authorization'] = `Bearer ${settings.workerSecret}`;
      const res = await fetch(`${base}/api/market-concentration`, { headers, signal: AbortSignal.timeout(10000) });
      if (res.ok) return await res.json();
    } catch (e) { /* 降级到下一个URL */ }
  }
  return null;
};
