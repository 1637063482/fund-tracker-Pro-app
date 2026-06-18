// 工具处理器 — 每个 handler 返回 { output, pendingActions }，无副作用
import { buildProxyUrl, buildAllOriginsUrl } from '../proxy';
import { fetchSerperSearch, fetchTavilySearch, fetchExaSearch } from '../search-engines';
import { formatCashFlows } from '../market-data';
import { fetchFinancialNews } from '../financial-news';
import { collection, query, where, orderBy, limit, getDocs, getDoc, setDoc, doc } from 'firebase/firestore';
import { themeColors, getThemeColor } from './colors';

// ============================================================================
// 相对时间词正则
// ============================================================================
const RELATIVE_TIME_RE = /(?:[今明后昨](?:天|日|晚|早|晨|儿)|(?:本|上|下|下下)(?:个)?(?:周|礼拜|星期)[一二三四五六日天]?|(?:本|上|下|下下)(?:个)?(?:月|季度|半年|年)|(?:过)[几两三](?:天|周|个月)|(?:年|月|季|周)(?:初|末|底)|[一二三四五六七八九十两叁\d]+\s*(?:天|周|个月|年|小时)后|近期|短期内)/;

// ============================================================================
// 工具 1: 单基实时净值
// ============================================================================
const handleGetRealtimeFundData = async (ctx) => {
  try {
    const targetUrl = `https://danjuanfunds.com/djapi/fund/${ctx.args.fundCode}`;
    const fetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
      ? buildProxyUrl(ctx.settings, targetUrl)
      : buildAllOriginsUrl(targetUrl);
    const res = await fetch(fetchUrl, { cache: 'no-store' });
    const data = await res.json();
    const actualData = ctx.settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
    if (actualData?.data) {
      const fd = actualData.data;
      const der = fd.fund_derived || {};
      // 基金元数据（零额外 HTTP 成本，API 已返回）
      const typeDesc = fd.type_desc || '';
      const riskLevel = fd.risk_level || '';
      const totShare = fd.totshare || '';
      const manager = fd.manager_name || '';
      // 最大回撤（从 sec_header_base_data 提取）
      const secData = fd.sec_header_base_data || [];
      const maxDrawdown = secData.find(d => d.data_name?.includes('回撤'))?.data_value_str || '';
      const fundSize = secData.find(d => d.data_name?.includes('规模'))?.data_value_str || totShare;
      // 费率
      const rates = fd.fund_rates || {};
      const subFee = rates.subscribe_rate != null ? parseFloat(rates.subscribe_rate) : null;
      const subDiscount = rates.subscribe_discount != null ? parseFloat(rates.subscribe_discount) : (rates.discount != null ? parseFloat(rates.discount) : 1);
      const effectiveFee = subFee != null ? (subFee * subDiscount).toFixed(2) + '%' : '';

      let meta = [];
      if (typeDesc) meta.push(typeDesc);
      if (riskLevel) meta.push('风险' + riskLevel + '/5');
      if (fundSize) meta.push(fundSize.includes('亿') ? fundSize : fundSize + '亿' + (fundSize.includes('亿') ? '' : ''));
      if (manager) meta.push('经理:' + manager);
      if (maxDrawdown) meta.push('最大回撤:' + maxDrawdown);
      if (effectiveFee) meta.push('申购费:' + effectiveFee);
      const metaStr = meta.join(' | ');

      const output = `【基金名称】${fd.fd_name} (${fd.fd_code})
${metaStr ? '【基金概况】' + metaStr + '\n' : ''}【最新净值】${der.unit_nav || '未知'} (更新日期: ${der.end_date || '未知'})
【近1月】${der.nav_grl1m || '--'}% | 【近3月】${der.nav_grl3m || '--'}% | 【近6月】${der.nav_grl6m || '--'}%
【近1年】${der.nav_grl1y || '--'}% (同类排名: ${der.srank_l1y || '未知'}) | 【近3年】${der.nav_grl3y || '--'}% (同类排名: ${der.srank_l3y || '未知'})
【成立以来】${der.nav_grbase || '--'}%`;
      return { output, pendingActions: [] };
    }
    return { output: '未查询到该基金数据，可能是代码错误或退市。', pendingActions: [] };
  } catch (e) {
    console.error('金融API调用失败', e);
    return { output: '接口报错，请降级使用网页搜索工具去雪球获取数据。', pendingActions: [] };
  }
};

// ============================================================================
// 工具 2: 批量基金数据
// ============================================================================
const handleGetBatchFundData = async (ctx) => {
  try {
    const promises = (ctx.args.fundCodes || []).map(async (code) => {
      const targetUrl = `https://danjuanfunds.com/djapi/fund/${code}`;
      const fetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
        ? buildProxyUrl(ctx.settings, targetUrl)
        : buildAllOriginsUrl(targetUrl);
      try {
        const res = await fetch(fetchUrl, { cache: 'no-store' });
        const data = await res.json();
        const actualData = ctx.settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
        return { code, actualData, success: true };
      } catch { return { code, success: false }; }
    });
    const results = await Promise.all(promises);
    let output = '【批量数据获取结果】\n';
    results.forEach(item => {
      if (item.success && item.actualData?.data) {
        const fd = item.actualData.data;
        const der = fd.fund_derived || {};
        const typeDesc = fd.type_desc || '';
        const riskLevel = fd.risk_level || '';
        const totShare = fd.totshare || '';
        const secData = fd.sec_header_base_data || [];
        const maxDrawdown = secData.find(d => d.data_name?.includes('回撤'))?.data_value_str || '';
        const meta = [typeDesc, riskLevel ? 'R' + riskLevel : '', totShare, maxDrawdown].filter(Boolean).join(' | ');
        output += `- ${fd.fd_name}(${fd.fd_code}) | ${meta} | 净值 ${der.unit_nav || '--'} (${der.end_date || '--'}) | 近1月 ${der.nav_grl1m || '--'}% | 近1年 ${der.nav_grl1y || '--'}%\n`;
      } else {
        output += `- 代码 ${item.code}: 数据抓取失败、代码错误或已退市。\n`;
      }
    });
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: '批量查询参数异常，请降级使用单只查询或文字说明。', pendingActions: [] };
  }
};

// ============================================================================
// 工具 3: 历史净值序列
// ============================================================================
const handleGetFundHistoryData = async (ctx) => {
  try {
    const targetUrl = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${ctx.args.fundCode}&pageIndex=1&pageSize=30`;
    const fetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
      ? buildProxyUrl(ctx.settings, targetUrl)
      : buildAllOriginsUrl(targetUrl);
    const res = await fetch(fetchUrl, { cache: 'no-store' });
    const data = await res.json();
    const actualData = ctx.settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
    if (actualData?.Data?.LSJZList) {
      const list = actualData.Data.LSJZList.reverse();
      const dates = list.map(item => item.FSRQ.substring(5));
      const navs = list.map(item => parseFloat(item.DWJZ));
      return {
        output: `【成功获取近30日净值】\n日期序列: [${dates.join(',')}]\n净值序列: [${navs.join(',')}]\n👉 请直接使用这些数组数据，利用你的 QuickChart 生成图片能力为用户绘制走势图！`,
        pendingActions: []
      };
    }
    return { output: '获取历史净值失败，请告知用户无法画图。', pendingActions: [] };
  } catch (e) {
    return { output: '时序接口报错，停止尝试画图。', pendingActions: [] };
  }
};

// ============================================================================
// 工具 4: 多基金横向对比
// ============================================================================
const handleGetFundComparison = async (ctx) => {
  const fundCodes = (ctx.args.fundCodes || []).slice(0, 5);
  if (fundCodes.length < 2) return { output: '至少需要2只基金代码才能对比。', pendingActions: [] };
  try {
    const fundDataList = await Promise.all(fundCodes.map(async (code) => {
      const targetUrl = `https://danjuanfunds.com/djapi/fund/${code}`;
      const fetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
        ? buildProxyUrl(ctx.settings, targetUrl)
        : buildAllOriginsUrl(targetUrl);
      try {
        const res = await fetch(fetchUrl, { cache: 'no-store' });
        const data = await res.json();
        const actualData = ctx.settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
        if (!actualData?.data) return null;
        const d = actualData.data;
        const der = d.fund_derived || {};
        const rates = d.fund_rates || {};
        const shareStr = String(d.totshare || '0');
        const shareYi = parseFloat(shareStr.replace(/[^0-9.]/g, '')) || 0;
        const nav = parseFloat(der.unit_nav) || 0;
        const subRate = rates.subscribe_rate != null ? parseFloat(rates.subscribe_rate) : null;
        const discount = rates.subscribe_discount != null ? parseFloat(rates.subscribe_discount) : (rates.discount != null ? parseFloat(rates.discount) : 1);
        const typeDesc = d.type_desc || '';
        let mgmtFee = '~1.50%';
        if (typeDesc.includes('货币')) mgmtFee = '~0.25%';
        else if (typeDesc.includes('债') || typeDesc.includes('固收')) mgmtFee = '~0.60%';
        else if (typeDesc.includes('指数') || typeDesc.includes('ETF') || typeDesc.includes('联接')) mgmtFee = '~0.50%';
        else if (typeDesc.includes('混合') && !typeDesc.includes('偏股')) mgmtFee = '~1.20%';
        return {
          code, name: d.fd_name, type: typeDesc, nav,
          returns: { m1: parseFloat(der.nav_grl1m)||0, m3: parseFloat(der.nav_grl3m)||0, m6: parseFloat(der.nav_grl6m)||0, y1: parseFloat(der.nav_grl1y)||0, y3: parseFloat(der.nav_grl3y)||0, base: parseFloat(der.nav_grbase)||0 },
          rank: { y1: der.srank_l1y || 'N/A', y3: der.srank_l3y || 'N/A' },
          manager: d.manager_name || 'N/A', company: d.trup_name || 'N/A',
          foundDate: d.found_date || 'N/A', riskLevel: d.risk_level || 'N/A',
          subscribeFee: subRate != null ? (subRate * discount).toFixed(2)+'%' : 'N/A', mgmtFee,
          size: nav > 0 ? ((shareYi * nav).toFixed(2) + '亿') : 'N/A',
          maxDrawdown: actualData?.data?.sec_header_base_data?.find(d => d.data_name?.includes('回撤'))?.data_value_str || 'N/A',
          fundSize: actualData?.data?.sec_header_base_data?.find(d => d.data_name?.includes('规模'))?.data_value_str || '',
          volatility: 0, percentile: 50, equityRatio: 'N/A', sectors: 'N/A'
        };
      } catch { return null; }
    }));
    const validFunds = fundDataList.filter(Boolean);
    if (validFunds.length < 2) return { output: '至少需要2只有效基金数据才能对比。', pendingActions: [] };
    const navSeries = await Promise.all(validFunds.map(async (f) => {
      try {
        const targetUrl = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${f.code}&pageIndex=1&pageSize=30`;
        const fetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
          ? buildProxyUrl(ctx.settings, targetUrl) : buildAllOriginsUrl(targetUrl);
        const res = await fetch(fetchUrl, { cache: 'no-store' });
        const data = await res.json();
        const actualData = ctx.settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
        return (actualData?.Data?.LSJZList || []).map(item => parseFloat(item.DWJZ)).filter(v => !isNaN(v)).reverse();
      } catch { return []; }
    }));
    validFunds.forEach((f, i) => {
      const navs = navSeries[i] || [];
      if (navs.length >= 5) {
        const dailyReturns = [];
        for (let j = 1; j < navs.length; j++) dailyReturns.push((navs[j] - navs[j-1]) / navs[j-1]);
        const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
        const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
        f.volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
        const minNav = Math.min(...navs), maxNav = Math.max(...navs);
        f.percentile = maxNav > minNav ? ((f.nav - minNav) / (maxNav - minNav)) * 100 : 50;
        let peak = navs[0], mdd = 0;
        for (const n of navs) { if (n > peak) peak = n; const dd = (peak - n) / peak; if (dd > mdd) mdd = dd; }
        f.maxDrawdown = (mdd * 100).toFixed(2) + '%';
      }
      f.sharpeProxy = f.volatility > 0 ? ((f.returns.y1 - 2.0) / f.volatility).toFixed(2) : 'N/A';
      f.volatility = f.volatility.toFixed(2) + '%';
      f.percentile = f.percentile.toFixed(0) + '%';
    });
    let output = '【多基金横向对比报告】\n\n';
    const cols = validFunds.map(f => (f.name||'').length > 10 ? f.name.substring(0,9)+'..' : f.name).join(' | ');
    output += `指标 | ${cols}\n---|---|---\n代码 | ${validFunds.map(f=>f.code).join(' | ')}\n`;
    output += `类型 | ${validFunds.map(f=>f.type).join(' | ')}\n基金经理 | ${validFunds.map(f=>f.manager).join(' | ')}\n`;
    output += `最新净值 | ${validFunds.map(f=>f.nav).join(' | ')}\n`;
    output += `近1月 | ${validFunds.map(f=>(f.returns.m1>0?'+':'')+f.returns.m1.toFixed(2)+'%').join(' | ')}\n`;
    output += `近3月 | ${validFunds.map(f=>(f.returns.m3>0?'+':'')+f.returns.m3.toFixed(2)+'%').join(' | ')}\n`;
    output += `近6月 | ${validFunds.map(f=>(f.returns.m6>0?'+':'')+f.returns.m6.toFixed(2)+'%').join(' | ')}\n`;
    output += `近1年 | ${validFunds.map(f=>(f.returns.y1>0?'+':'')+f.returns.y1.toFixed(2)+'%').join(' | ')}\n`;
    output += `近3年 | ${validFunds.map(f=>(f.returns.y3>0?'+':'')+f.returns.y3.toFixed(2)+'%').join(' | ')}\n`;
    output += `最大回撤(30日) | ${validFunds.map(f=>f.maxDrawdown).join(' | ')}\n`;
    output += `波动率(年化) | ${validFunds.map(f=>f.volatility).join(' | ')}\n`;
    output += `Sharpe估 | ${validFunds.map(f=>f.sharpeProxy).join(' | ')}\n`;
    output += `申购费率 | ${validFunds.map(f=>f.subscribeFee).join(' | ')}\n`;
    // 相关性矩阵
    if (navSeries.every(n => n.length >= 20)) {
      output += '\n【相关性矩阵】\n';
      const names = validFunds.map(f => f.name.length > 8 ? f.name.substring(0,7)+'..' : f.name);
      output += '          ' + names.join('    ') + '\n';
      for (let i = 0; i < validFunds.length; i++) {
        const row = [names[i]];
        for (let j = 0; j < validFunds.length; j++) {
          if (i === j) { row.push('1.00'); continue; }
          const a = navSeries[i], b = navSeries[j], n = Math.min(a.length, b.length);
          const aS = a.slice(0,n), bS = b.slice(0,n);
          const mA = aS.reduce((s,v)=>s+v,0)/n, mB = bS.reduce((s,v)=>s+v,0)/n;
          let cov=0, vA=0, vB=0;
          for (let k=0; k<n; k++) { const da=aS[k]-mA, db=bS[k]-mB; cov+=da*db; vA+=da*da; vB+=db*db; }
          row.push(vA>0&&vB>0 ? (cov/Math.sqrt(vA*vB)).toFixed(2) : 'N/A');
        }
        output += row.join('  ') + '\n';
      }
    }
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: '基金对比引擎异常: ' + e.message, pendingActions: [] };
  }
};

// ============================================================================
// 工具 5: 财经快讯
// ============================================================================
const handleGetFinancialNews = async (ctx) => {
  try {
    const topic = ctx.args.topic || 'market';
    const { source, items } = await fetchFinancialNews(ctx.settings, topic, 12);
    if (items.length === 0) return { output: '新浪财经快讯API暂不可用。请改用搜索工具获取资讯。', pendingActions: [] };
    const formatted = items.map(n => '【' + (n.time||'未知时间') + '】' + n.title + '\n' + (n.content ? '  > ' + n.content.substring(0,200) : '')).join('\n\n');
    const output = '[系统物理防伪探针] 现在的真实时间是 ' + ctx.fullDateTimeStr + '。以上为' + source + '实时快讯的结构化数据。\n\n' + formatted;
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: '新浪财经快讯接口异常: ' + e.message + '。请改用搜索工具获取资讯。', pendingActions: [] };
  }
};

// ============================================================================
// 工具 6: 搜索工具 (google_macro_search / tavily_news_search / exa_research)
// ============================================================================
const handleSearchTools = async (ctx) => {
  try {
    const toolName = ctx.toolName;
    let rawQuery = (ctx.args.query || '').trim();
    let finalQuery = rawQuery.replace(/202\d年/g,'').replace(/\d{1,2}月\d{1,2}日/g,'').replace(/今天|今日|昨天|最新|近期/g,'').trim();
    let searchRes = '';
    if (toolName === 'google_macro_search') {
      const tr = ctx.args.timeRange || 'qdr:w';
      searchRes = await fetchSerperSearch(ctx.settings.serperApiKey, finalQuery + ' (site:cls.cn OR site:wallstreetcn.com OR site:jin10.com OR site:yicai.com)', tr, ctx.settings.searchResultCount, ctx.settings);
    } else if (toolName === 'tavily_news_search') {
      const recency = ctx.args.recency || 'd1';
      if (!/快讯|突发|政策|新闻|异动/.test(finalQuery)) finalQuery += ' 最新消息';
      searchRes = await fetchTavilySearch(ctx.settings.tavilyApiKey, finalQuery, 'news', ctx.settings, recency, ctx.settings.searchResultCount);
    } else if (toolName === 'exa_research') {
      if (!/研报|分析|解读|展望|策略|报告/.test(finalQuery)) finalQuery += ' 研报 分析 展望';
      searchRes = await fetchExaSearch(ctx.settings.exaApiKey, finalQuery, ctx.settings);
    }
    if (!searchRes && ctx.settings.serperApiKey && toolName !== 'google_macro_search') {
      searchRes = await fetchSerperSearch(ctx.settings.serperApiKey, finalQuery + ' (site:cls.cn OR site:wallstreetcn.com OR site:stcn.com)', 'qdr:w', ctx.settings.searchResultCount, ctx.settings);
    }
    const timeWarning = '[系统物理防伪探针] 现在的真实时间是 ' + ctx.fullDateTimeStr + '。请严格核对以下搜索结果中的【发布时间】！\n\n';
    const output = searchRes ? (timeWarning + searchRes) : '未检索到精确数据。请使用专用API工具获取数据。';
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: '搜索接口异常，请尝试用专用API工具替代搜索。', pendingActions: [] };
  }
};

// ============================================================================
// ============================================================================
// 指标计算器 — ATR / RSI / MACD / Volume Profile
// ============================================================================
function calcEMA(values, period) {
  if (values.length < period) return values.length > 0 ? values.reduce((a,b)=>a+b,0)/values.length : 0;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

function calcATR(klineData, period = 14) {
  if (klineData.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < klineData.length; i++) {
    const h = klineData[i].high, l = klineData[i].low, prevC = klineData[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  const atr = calcEMA(trs, period);
  const lastClose = klineData[klineData.length - 1].close;
  return { atr, atrPct: lastClose > 0 ? (atr / lastClose * 100) : 0 };
}

function calcRSI(klineData, period = 14) {
  if (klineData.length < period + 1) return { rsi: 50 };
  const changes = [];
  for (let i = 1; i < klineData.length; i++) changes.push(klineData[i].close - klineData[i - 1].close);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i]; else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period; avgLoss /= period;
  const rsiSeq = [];
  for (let i = period; i < changes.length; i++) {
    if (changes[i] > 0) { avgGain = (avgGain * (period - 1) + changes[i]) / period; avgLoss = (avgLoss * (period - 1)) / period; }
    else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) + Math.abs(changes[i])) / period; }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsiSeq.push({ rsi: 100 - 100 / (1 + rs), date: klineData[i + 1].date });
  }
  const last = rsiSeq.length > 0 ? rsiSeq[rsiSeq.length - 1].rsi : 50;
  const recentRSI = rsiSeq.slice(-5).map(r => r.rsi);
  // 底背离检测：近5日价格低点 vs RSI低点
  const last5Prices = klineData.slice(-5).map(d => d.close);
  const priceMin = Math.min(...last5Prices);
  const priceMinIdx = last5Prices.indexOf(priceMin);
  const rsiAtPriceMin = recentRSI[priceMinIdx];
  const rsiEarlier = recentRSI.slice(0, priceMinIdx);
  const divergence = rsiEarlier.length > 0 && rsiAtPriceMin > Math.min(...rsiEarlier) ? '疑似底背离(价格新低但RSI未新低)' : '';
  return { rsi: Math.round(last * 10) / 10, recentRSI, divergence };
}

function calcMACD(klineData) {
  if (klineData.length < 26) return {};
  const closes = klineData.map(d => d.close);
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  // 逐点 MACD 用于输出最新值
  let ema12v = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let ema26v = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  let dea = 0, dif = 0, macdBar = 0;
  for (let i = 26; i < closes.length; i++) {
    const k12 = 2 / 13, k26 = 2 / 27;
    ema12v = closes[i] * k12 + ema12v * (1 - k12);
    ema26v = closes[i] * k26 + ema26v * (1 - k26);
    dif = ema12v - ema26v;
    dea = dif * (2 / 10) + dea * (1 - 2 / 10);
    macdBar = (dif - dea) * 2;
  }
  return { dif: dif.toFixed(3), dea: dea.toFixed(3), macdBar: macdBar.toFixed(3) };
}

function calcBollingerBands(klineData, period = 20) {
  if (klineData.length < period) return null;
  const closes = klineData.slice(-period).map(d => d.close);
  const sma = closes.reduce((a, b) => a + b, 0) / period;
  const variance = closes.reduce((s, c) => s + (c - sma) ** 2, 0) / period;
  const stddev = Math.sqrt(variance);
  const upper = sma + 2 * stddev;
  const lower = sma - 2 * stddev;
  const bandwidth = sma > 0 ? ((upper - lower) / sma * 100) : 0;
  // Check historical bandwidth range for squeeze detection
  let bwMin = bandwidth, bwMax = bandwidth;
  for (let i = period; i <= klineData.length; i++) {
    const slice = klineData.slice(i - period, i);
    if (slice.length < period) continue;
    const c = slice.map(d => d.close);
    const s = c.reduce((a, b) => a + b, 0) / period;
    const v = c.reduce((a, b) => a + (b - s) ** 2, 0) / period;
    const sd = Math.sqrt(v);
    const bw = s > 0 ? ((s + 2*sd - (s - 2*sd)) / s * 100) : 0;
    if (bw < bwMin) bwMin = bw;
    if (bw > bwMax) bwMax = bw;
  }
  const bwPercentile = bwMax > bwMin ? ((bandwidth - bwMin) / (bwMax - bwMin) * 100) : 50;
  return {
    middle: sma.toFixed(1), upper: upper.toFixed(1), lower: lower.toFixed(1),
    bandwidth: bandwidth.toFixed(2), bwPercentile: bwPercentile.toFixed(0),
    squeeze: bandwidth < 1.5 ? '⚠️带宽极窄，变盘窗口临近' : (bandwidth < 2.5 ? '带宽偏窄' : '正常')
  };
}

function calcVolumeProfile(klineData, currentPrice) {
  if (klineData.length < 60) return '';
  const zones = {};
  let totalVol = 0;
  for (const d of klineData) {
    const vol = d.volume || 0;
    if (vol <= 0) continue;
    totalVol += vol;
    // 按 2% 宽度分桶
    const bucket = d.close > 0 ? Math.round(d.close / (d.close * 0.02)) * (d.close * 0.02) : Math.round(d.close);
    const key = bucket.toFixed(0);
    zones[key] = (zones[key] || 0) + vol;
  }
  if (Object.keys(zones).length === 0) return '';
  const sorted = Object.entries(zones).sort((a, b) => b[1] - a[1]);
  const poc = parseFloat(sorted[0][0]);
  // 70% 成交量区间
  let cumVol = 0;
  const vaPrices = [];
  for (const [p, v] of sorted) { cumVol += v; vaPrices.push(parseFloat(p)); if (cumVol / totalVol > 0.7) break; }
  const vaLow = Math.min(...vaPrices);
  const vaHigh = Math.max(...vaPrices);
  const pos = currentPrice > vaHigh ? '上方' : currentPrice < vaLow ? '下方' : '内部';
  return `POC(最大成交量价): ${poc} | VA(70%成交量): ${vaLow}-${vaHigh} | 当前价在VA${pos}`;
}

// ============================================================================
// 工具 7: 历史K线 (多周期OHLC + 量化指标)
// ============================================================================
const handleGetMarketHistoricalIntraday = async (ctx) => {
  try {
    let code = (ctx.args.code || '').toLowerCase();
    if (/^\d{6}$/.test(code)) code = (code === '000001' || code.startsWith('5')) ? 'sh'+code : 'sz'+code;
    const period = (ctx.args.period || 'day').toLowerCase();
    const count = Math.min(ctx.args.count || (period === 'day' ? 60 : period === 'week' ? 20 : 12), 250);
    const targetUrl = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},${period},,,${count},`;
    const fetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl ? buildProxyUrl(ctx.settings, targetUrl) : buildAllOriginsUrl(targetUrl);
    const res = await fetch(fetchUrl, { cache: 'no-store' });
    const resData = await res.json();
    const klineData = resData?.data?.[code]?.[period] || resData?.data?.[code]?.[`qfq${period}`];
    const periodLabel = { day: '日K', week: '周K', month: '月K' }[period] || `${period}K`;
    let output = `【${ctx.args.code} ${periodLabel}，共 ${count} 根】\n`;
    if (klineData && Array.isArray(klineData)) {
      // 解析 K 线
      const bars = [];
      for (const day of klineData) {
        const open = parseFloat(day[1]), close = parseFloat(day[2]), high = parseFloat(day[3]), low = parseFloat(day[4]);
        if (isNaN(open)) continue;
        bars.push({ date: day[0], open, close, high, low, volume: parseFloat(day[5]) || 0 });
      }
      const n = bars.length;
      if (n === 0) { output += '暂无历史K线数据。\n'; return { output, pendingActions: [] }; }

      let maxHigh = -Infinity, minLow = Infinity, upBars = 0, downBars = 0, totalBody = 0, totalShadow = 0;
      for (const b of bars) {
        if (b.high > maxHigh) maxHigh = b.high;
        if (b.low < minLow) minLow = b.low;
        if (b.close >= b.open) upBars++; else downBars++;
        totalBody += Math.abs((b.close - b.open) / b.open);
        totalShadow += (b.high - Math.max(b.open, b.close)) / b.open + (Math.min(b.open, b.close) - b.low) / b.open;
      }
      const hasVol = bars.some(b => b.volume > 0);
      output += `📊 统计: 区间[${minLow.toFixed(2)}~${maxHigh.toFixed(2)}] | 振幅${((maxHigh-minLow)/minLow*100).toFixed(1)}% | 阳${upBars}/${n} 阴${downBars}/${n} | 均实体${(totalBody/n*100).toFixed(1)}% 均影线${(totalShadow/n*100).toFixed(1)}%`;
      if (hasVol) {
        const avgVol = bars.reduce((s, b) => s + b.volume, 0) / bars.filter(b => b.volume > 0).length;
        output += ` | 均量${(avgVol/10000).toFixed(0)}万手`;
      }
      output += '\n';

	      // ── 量化指标（日线+周线均计算）──
	      if ((period === 'day' || period === 'week') && n >= 14) {
	        const atrInfo = calcATR(bars);
	        const rsiInfo = calcRSI(bars);
	        const macdInfo = calcMACD(bars);
	        const bbInfo = calcBollingerBands(bars);
	        const lastPrice = bars[n - 1].close;
	        const label = period === 'week' ? '周线' : '';
	        output += `\n【${label}量化指标】\n`;
	        output += `ATR(14): ${atrInfo.atr.toFixed(3)} (${atrInfo.atrPct.toFixed(2)}%) | 1.5×ATR=${(atrInfo.atr*1.5).toFixed(3)}\n`;
	        output += `RSI(14): ${rsiInfo.rsi} | 近5根: [${rsiInfo.recentRSI.join(', ')}]`;
	        if (rsiInfo.divergence) output += ` | ⚠️ ${rsiInfo.divergence}`;
	        output += '\n';
	        if (macdInfo.dif) {
	          output += `MACD(12,26,9): DIF=${macdInfo.dif} DEA=${macdInfo.dea} 柱=${macdInfo.macdBar}`;
	          if (period === 'week') {
	            const dif = parseFloat(macdInfo.dif), dea = parseFloat(macdInfo.dea);
	            if (dif > dea) output += ' | 🟢金叉状态';
	            else output += ' | 🔴死叉状态';
	          }
	          output += '\n';
	        }
	        if (bbInfo) {
	          output += `布林带(20,2): 上轨=${bbInfo.upper} 中轨=${bbInfo.middle} 下轨=${bbInfo.lower} | 带宽${bbInfo.bandwidth}%(${bbInfo.squeeze}) | 1年分位${bbInfo.bwPercentile}%\n`;
	        }
	        // 筹码分布（仅日线≥120根）
	        if (period === 'day' && n >= 120 && hasVol) {
	          const vp = calcVolumeProfile(bars, lastPrice);
	          if (vp) output += `【年筹码】${vp}\n`;
	        }
	      }

      // 逐根 OHLC（只展示最近 30 根，控制输出长度）
      const showBars = bars.slice(-30);
      output += `\n逐根OHLC(最近${showBars.length}根):\n`;
      for (const b of showBars) {
        const ampPct = (b.high-b.low)/b.open*100, bodyPct = (b.close-b.open)/b.open*100;
        const upperPct = (b.high-Math.max(b.open,b.close))/b.open*100, lowerPct = (Math.min(b.open,b.close)-b.low)/b.open*100;
        const barType = b.close >= b.open ? '阳' : '阴';
        const volStr = b.volume > 0 ? ` 量${(b.volume/10000).toFixed(0)}万` : '';
        output += `- [${b.date}] 开:${b.open} 高:${b.high} 低:${b.low} 收:${b.close} | ${barType} 幅${ampPct.toFixed(1)}% 体${bodyPct>0?'+'+bodyPct.toFixed(1):bodyPct.toFixed(1)}% 影${upperPct.toFixed(1)}/${lowerPct.toFixed(1)}%${volStr}\n`;
      }
    } else {
      output += '暂无历史K线数据。\n';
    }
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: 'K线数据库调用异常。', pendingActions: [] };
  }
};

// ============================================================================
// 工具 8: 生成趋势图表
// ============================================================================
const handleGenerateTrendChart = async (ctx) => {
  try {
    const cleanTitle = (ctx.args.title || '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    let rawLabels = ctx.args.labels || [];
    if (typeof rawLabels === 'string') { try { rawLabels = JSON.parse(rawLabels.replace(/'/g,'"')); } catch { rawLabels = rawLabels.replace(/[\[\]]/g,'').split(','); } }
    const safeLabels = (Array.isArray(rawLabels) ? rawLabels : []).map(l => String(l).trim().substring(0,16));
    const globalChartType = ctx.args.chartType || 'line';
    const enableDualAxis = ctx.args.enableDualAxis === true;
    let rawDatasets = ctx.args.datasets || [];
    if (typeof rawDatasets === 'string') { try { rawDatasets = JSON.parse(rawDatasets.replace(/'/g,'"')); } catch { rawDatasets = []; } }
    const safeDatasets = [];
    if (Array.isArray(rawDatasets) && rawDatasets.length > 0) {
      rawDatasets.forEach((ds, index) => {
        let rData = ds.data || [];
        if (typeof rData === 'string') { try { rData = JSON.parse(rData); } catch { rData = rData.replace(/[\[\]]/g,'').split(','); } }
        const sData = (Array.isArray(rData) ? rData : []).map(d => {
          if (d === null || d === 'null' || d === '' || String(d).trim() === '-' || String(d).trim() === '—') return null;
          const num = parseFloat(String(d).replace(/[^\d.-]/g,''));
          return isNaN(num) ? null : num;
        });
        if (sData.length === 0) return;
        const autoTheme = themeColors[index % themeColors.length];
        let theme = autoTheme;
        if (ds.color) { try { theme = getThemeColor(ds.color) || autoTheme; } catch {} }
        const dsChartType = ds.chartType || globalChartType;
        const isScatter = dsChartType === 'scatter';
        const showPoints = ds.showPoints !== undefined ? ds.showPoints : (safeLabels.length <= 30);
        const enableFill = ds.fill === true;
        const yAxisIndex = enableDualAxis ? (ds.yAxisIndex || 0) : 0;
        safeDatasets.push({
          label: (ds.label||'').length > 20 ? ds.label.substring(0,19)+'...' : (ds.label||`资产 ${index+1}`),
          data: isScatter ? sData.map((v,i) => ({ x: safeLabels[i]||i, y: v })) : sData,
          type: dsChartType === 'area' ? 'line' : dsChartType,
          ...(dsChartType === 'area' || enableFill ? { fill: true, backgroundColor: enableFill ? theme.bg : 'transparent' } : { fill: false }),
          borderColor: theme.solid, backgroundColor: dsChartType === 'bar' || dsChartType === 'scatter' ? theme.solid : (enableFill ? theme.bg : theme.solid),
          lineTension: isScatter ? 0 : 0.2, borderWidth: dsChartType === 'bar' ? 0 : 2,
          pointBackgroundColor: '#ffffff', pointBorderColor: theme.solid, pointBorderWidth: isScatter ? 2 : 1.5,
          pointRadius: isScatter ? 5 : (showPoints ? 3 : 0), pointHoverRadius: isScatter ? 7 : 5,
          yAxisID: enableDualAxis ? `y-axis-${yAxisIndex}` : 'y-axis-0', spanGaps: false,
        });
      });
    }
    if (safeDatasets.length === 0) throw new Error('解析后无有效绘图数据');
    const calcYRange = (datasets, axisId) => {
      let min = Infinity, max = -Infinity;
      datasets.forEach(ds => {
        if (ds.yAxisID !== axisId) return;
        const vals = (ds.type === 'scatter' ? ds.data.map(d => d.y) : ds.data).filter(v => v !== null && !isNaN(v));
        if (vals.length === 0) return;
        const dsMin = Math.min(...vals), dsMax = Math.max(...vals);
        if (dsMin < min) min = dsMin;
        if (dsMax > max) max = dsMax;
      });
      if (min === Infinity) return { yMin: 0, yMax: 1 };
      const range = max - min, pad = range === 0 ? 0.5 : range * 0.15;
      return { yMin: parseFloat((min - pad).toFixed(4)), yMax: parseFloat((max + pad).toFixed(4)) };
    };
    const leftRange = calcYRange(safeDatasets, 'y-axis-0');
    const rightRange = enableDualAxis ? calcYRange(safeDatasets, 'y-axis-1') : null;
    let annotations = [], annotationLegend = [], colorIdx = 0;
    let safeBands = ctx.args.horizontalBands, safeLines = ctx.args.horizontalLines;
    if (typeof safeBands === 'string') { try { safeBands = JSON.parse(safeBands.replace(/'/g,'"')); } catch { safeBands = []; } }
    if (typeof safeLines === 'string') { try { safeLines = JSON.parse(safeLines.replace(/'/g,'"')); } catch { safeLines = []; } }
    if (Array.isArray(safeBands)) {
      safeBands.forEach(band => {
        const bandMin = parseFloat(band.yMin), bandMax = parseFloat(band.yMax);
        if (!isNaN(bandMin) && !isNaN(bandMax)) {
          const theme = (band.color && getThemeColor(band.color)) || themeColors[colorIdx % themeColors.length];
          annotations.push({ type:'box', xScaleID:'x-axis-0', yScaleID:'y-axis-0', yMin:bandMin, yMax:bandMax, backgroundColor:theme.bg, borderColor:theme.solid, borderWidth:1, drawTime:'beforeDatasetsDraw' });
          if (band.label) {
            annotations.push({ type:'line', mode:'horizontal', scaleID:'y-axis-0', value:(bandMin+bandMax)/2, borderColor:'transparent', borderWidth:0, label:{ enabled:true, content:band.label, position:'right', backgroundColor:theme.solid, fontColor:'#ffffff', fontSize:11, xPadding:6, yPadding:4, cornerRadius:4 } });
            annotationLegend.push({ label:band.label, color:theme.solid, bg:theme.bg, isBand:true });
          }
          if (bandMin < leftRange.yMin) leftRange.yMin = bandMin;
          if (bandMax > leftRange.yMax) leftRange.yMax = bandMax;
          colorIdx++;
        }
      });
    }
    if (Array.isArray(safeLines)) {
      safeLines.forEach(line => {
        const lineVal = parseFloat(line.value);
        if (!isNaN(lineVal)) {
          const theme = themeColors[colorIdx % themeColors.length];
          annotations.push({ type:'line', mode:'horizontal', scaleID:'y-axis-0', value:lineVal, borderColor:theme.solid, borderWidth:2, borderDash:[6,4] });
          annotationLegend.push({ label:line.label||String(lineVal), color:theme.solid, bg:'transparent', isBand:false });
          if (lineVal < leftRange.yMin) leftRange.yMin = lineVal;
          if (lineVal > leftRange.yMax) leftRange.yMax = lineVal;
          colorIdx++;
        }
      });
    }
    // 竖直线
    let safeVLines = ctx.args.verticalLines;
    if (typeof safeVLines === 'string') { try { safeVLines = JSON.parse(safeVLines.replace(/'/g,'"')); } catch { safeVLines = []; } }
    if (Array.isArray(safeVLines)) {
      safeVLines.forEach(vLine => {
        const theme = (vLine.color && getThemeColor(vLine.color)) || themeColors[colorIdx % themeColors.length];
        annotations.push({ type:'line', mode:'vertical', scaleID:'x-axis-0', value:String(vLine.value).trim(), borderColor:theme.solid, borderWidth:2, borderDash:vLine.dashed!==false?[6,4]:[], label:vLine.label?{ enabled:true, content:vLine.label, position:'top', backgroundColor:theme.solid, fontColor:'#ffffff', fontSize:10, xPadding:6, yPadding:4, cornerRadius:4 }:undefined });
        if (vLine.label) annotationLegend.push({ label:vLine.label, color:theme.solid, bg:'transparent', isBand:false });
        colorIdx++;
      });
    }
    const chartConfig = {
      type: globalChartType === 'scatter' ? 'line' : (globalChartType === 'area' ? 'line' : globalChartType),
      data: { labels: safeLabels, datasets: safeDatasets },
      options: {
        layout: { padding: { top: 10, right: 65, bottom: 20, left: 10 } },
        title: { display: true, text: cleanTitle, fontSize: 16, fontColor: '#374151', padding: 20 },
        tooltips: { mode: 'index', intersect: false },
        legend: { display: safeDatasets.length > 1 || annotationLegend.length > 0, position: 'bottom', labels: { boxWidth: 14, padding: 20, fontColor: '#4b5563', fontSize: 12 } },
        scales: {
          xAxes: [{ id:'x-axis-0', type: globalChartType === 'scatter' ? 'linear' : 'category', ticks: { autoSkip: true, maxRotation: 45, minRotation: 0, fontColor: '#6b7280' } }],
          yAxes: [{ id:'y-axis-0', position:'left', ticks: { suggestedMin: leftRange.yMin, suggestedMax: leftRange.yMax, fontColor: '#6b7280', padding: 10 } }].concat(enableDualAxis && rightRange ? [{ id:'y-axis-1', position:'right', gridLines: { display: false, drawBorder: false }, ticks: { suggestedMin: rightRange.yMin, suggestedMax: rightRange.yMax, fontColor: '#9ca3af', padding: 10 } }] : [])
        },
        annotation: annotations.length > 0 ? { annotations } : undefined,
      },
    };
    const chartHeight = safeDatasets.length > 5 ? 520 : 420;
    const configStr = JSON.stringify(chartConfig);
    let getUrl = `https://quickchart.io/chart?c=${encodeURIComponent(configStr)}&bkg=white&w=800&h=${chartHeight}&f=webp&devicePixelRatio=1`;
    let finalChartUrl = getUrl;
    if (getUrl.length > 3500) {
      try {
        const qcPayload = { chart: chartConfig, width: 800, height: chartHeight, backgroundColor: 'white', format: 'webp', devicePixelRatio: 1 };
        const qcRes = await fetch('https://quickchart.io/chart/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(qcPayload) });
        const qcData = await qcRes.json();
        if (qcData.success && qcData.url) finalChartUrl = qcData.url;
      } catch (e) { console.error('POST失败，退回GET:', e.message); }
    }
    let output = `图表已成功生成。请在最终回复中直接使用这行 Markdown 展示图表：\n![${cleanTitle}](${finalChartUrl})`;
    if (annotationLegend.length > 0) {
      output += '\n\n📐 图表中的标注元素：\n' + annotationLegend.map(a => `- ${a.isBand ? '🟦 色带' : '📏 辅助线'} "${a.label}" (色码: ${a.color})`).join('\n');
    }
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: '图表生成失败，请用文字表格代替说明。', pendingActions: [] };
  }
};

// ============================================================================
// 工具 9: JS 沙箱执行
// ============================================================================
const handleExecuteJavascript = async (ctx) => {
  try {
    const workerCode = `self.onmessage = function(e) {
      try { const result = (function() { ${ctx.args.code} })(); self.postMessage({ success: true, result: result }); }
      catch (err) { self.postMessage({ success: false, error: err.message }); }
    };`;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);
    const finalResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { worker.terminate(); URL.revokeObjectURL(workerUrl); reject(new Error('超时(5s)')); }, 5000);
      worker.onmessage = (e) => { clearTimeout(timeout); worker.terminate(); URL.revokeObjectURL(workerUrl); e.data.success ? resolve(e.data.result) : reject(new Error(e.data.error)); };
      worker.onerror = (err) => { clearTimeout(timeout); worker.terminate(); URL.revokeObjectURL(workerUrl); reject(new Error(err.message)); };
      worker.postMessage({});
    });
    let output = typeof finalResult === 'object' && finalResult !== null ? JSON.stringify(finalResult, null, 2) : String(finalResult);
    return { output: `代码执行成功！沙盒返回的绝对精确结果为:\n${output}\n👉 请将此结果无缝融入你的最终分析报告中。`, pendingActions: [] };
  } catch (e) {
    return { output: `你写的代码执行报错了: ${e.message}。请检查语法逻辑，修复后重新调用执行！`, pendingActions: [] };
  }
};

// ============================================================================
// 工具 10: 记账
// ============================================================================
const handleUpdateLedger = async (ctx) => {
  const actionsList = ctx.args.actions ? ctx.args.actions : (ctx.args.fundCode ? [ctx.args] : []);
  return {
    output: `【系统提示】成功捕获 ${actionsList.length} 条记账指令，UI端将自动生成调仓卡片。🚨 强制指令：请你立刻继续完成刚才的宏观分析与调仓逻辑报告，并在报告末尾顺便告知用户调仓卡片已生成！`,
    pendingActions: actionsList.map(act => ({ ...act, toolType: 'ledger' }))
  };
};

// ============================================================================
// 工具 11: 待办管理
// ============================================================================
const handleManagePlanTodo = async (ctx) => {
  const plansList = ctx.args.plans || [];
  for (const plan of plansList) {
    if (plan.condition && RELATIVE_TIME_RE.test(plan.condition)) {
      return { output: `【系统拦截】写入失败："${plan.fundName||'未命名'}" 的 condition 字段中检测到相对时间词。请转换为绝对物理日期（如"5/28"）后重新调用。违规内容："${plan.condition}"`, pendingActions: [] };
    }
  }
  return {
    output: `【系统提示】成功捕获 ${plansList.length} 条待办指令(增/删/改)。请立刻继续输出你的建议，并在末尾提醒用户点击卡片确认授权。`,
    pendingActions: plansList.map(plan => ({ ...plan, toolType: 'todo' }))
  };
};

// ============================================================================
// 工具 12: 备忘录写入
// ============================================================================
const handleUpdateDecisionMemo = async (ctx) => {
  if (ctx.args.coreLogic && RELATIVE_TIME_RE.test(ctx.args.coreLogic)) {
    return { output: `【系统拦截】写入失败："${ctx.args.targetName||''}" 的 coreLogic 字段中检测到相对时间词。请转换为绝对物理日期后重新调用。违规内容："${ctx.args.coreLogic}"`, pendingActions: [] };
  }
  return {
    output: '【系统提示】该战略研判已成功生成记忆卡片。请继续回答用户的问题，并告知用户你已将此结论记录在备忘录中。',
    pendingActions: [{ ...ctx.args, toolType: 'memo' }]
  };
};

// ============================================================================
// 工具 15: 交易流水查询
// ============================================================================
const handleGetFundTransactionHistory = async (ctx) => {
  try {
    const fundCode = (ctx.args.fundCode || '').trim();
    const fund = (ctx.portfolioStats?.computedFundsWithMetrics || []).find(f => (f.fundCode || '').trim() === fundCode);
    if (!fund) return { output: `未找到代码为 ${fundCode} 的基金持仓记录。`, pendingActions: [] };
    const cashFlowStr = formatCashFlows(fund.transactions);
    return { output: `【${fund.name} (${fund.fundCode}) 完整历史交易流水】\n${cashFlowStr}\n\n当前持仓市值: ${fund.currentValue} 元 | 累计盈亏: ${fund.profit} 元 | 净本金: ${fund.netInvested} 元`, pendingActions: [] };
  } catch (e) {
    return { output: `查询交易流水失败: ${e.message}`, pendingActions: [] };
  }
};

// ============================================================================
// 工具 16: 指数估值
// ============================================================================
const handleGetIndexValuation = async (ctx) => {
  try {
    const codes = (ctx.args.codes || '000300').split(',').map(c => c.trim()).filter(Boolean);
    if (codes.length === 0 || codes.length > 8) return { output: codes.length === 0 ? '请指定指数代码。' : '单次最多查询8个指数。', pendingActions: [] };
    const nameMap = { '000300':'沪深300','000016':'上证50','000905':'中证500','399006':'创业板指','000922':'中证红利','000001':'上证指数','399001':'深证成指','000688':'科创50','399673':'创业板50','000852':'中证1000','000903':'中证100','931009':'全指消费' };
    const evaUrl = `https://danjuanfunds.com/djapi/index_eva/dj?page=1&size=200`;
    let evaFetchUrl = buildProxyUrl(ctx.settings, evaUrl);
    if (ctx.settings.proxyMode !== 'custom' || !ctx.settings.customProxyUrl) evaFetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(evaUrl)}`;
    let evaItems = [];
    try { const res = await fetch(evaFetchUrl, { cache: 'no-store' }); const raw = await res.text(); let d; try { d=JSON.parse(raw); } catch(e) { if(raw.includes('contents')){ const w=JSON.parse(raw); d=typeof w.contents==='string'?JSON.parse(w.contents):w.contents; } } evaItems = d?.data?.items || []; } catch(e) {}
    const findByCode = (code) => evaItems.find(item => { const ic = (item.index_code||'').toUpperCase(); const c=code.toUpperCase(); return ic===c || ic==='SH'+c || ic==='SZ'+c || ic==='CSI'+c; });
    const toQtCode = (code) => (code==='000001'||code.startsWith('000')||code.startsWith('5')||code.startsWith('6')||code.startsWith('9'))?'sh'+code:'sz'+code;
    const qtCodes = codes.map(c=>toQtCode(c)).join(',');
    const priceUrl = `https://qt.gtimg.cn/q=${qtCodes}`;
    let priceFetchUrl = buildProxyUrl(ctx.settings, priceUrl);
    if (ctx.settings.proxyMode !== 'custom' || !ctx.settings.customProxyUrl) priceFetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(priceUrl)}`;
    const priceMap = {};
    try {
      const pRes = await fetch(priceFetchUrl, { cache: 'no-store' });
      let text;
      if (ctx.settings.proxyMode === 'custom') { text = new TextDecoder('gbk').decode(await pRes.arrayBuffer()); }
      else { const wrapped=await pRes.json(); const raw=wrapped.contents||''; if(raw.includes('�')){ try{ text=new TextDecoder('gbk').decode(new Uint8Array(raw.split('').map(c=>c.charCodeAt(0)))); }catch(e){ text=raw; } } else { text=raw; } }
      (text||'').split(';').filter(l=>l.includes('v_')).forEach(line => {
        const dataArr = line.substring(line.indexOf('="')+2, line.length-1).split('~');
        if (dataArr.length < 5) return;
        const rawCode = dataArr[2], price = parseFloat(dataArr[3]), prevClose = parseFloat(dataArr[4])||0, pct = prevClose>0 ? (price-prevClose)/prevClose*100 : 0;
        if (rawCode && !isNaN(price)) priceMap[rawCode] = { price, pct };
      });
    } catch(e) {}
    const results = codes.map(code => {
      const name = nameMap[code] || code;
      const eva = findByCode(code);
      const qt = priceMap[code];
      const parts = [`${name}(${code})`];
      if (qt && !isNaN(qt.price)) parts.push(`现价: ${qt.price.toFixed(2)}`, (qt.pct ? `涨跌: ${qt.pct>0?'+':''}${qt.pct.toFixed(2)}%` : ''));
      if (eva) {
        const pe = eva.pe != null && eva.pe !== 0 ? parseFloat(eva.pe) : null;
        const pb = eva.pb != null ? parseFloat(eva.pb) : null;
        const pePct = eva.pe_percentile != null ? parseFloat(eva.pe_percentile)*100 : null;
        const pbPct = eva.pb_percentile != null ? parseFloat(eva.pb_percentile)*100 : null;
        const divYield = eva.yeild != null ? parseFloat(eva.yeild) : null;
        const roe = eva.roe != null && eva.roe !== 0 ? parseFloat(eva.roe) : null;
        const evaType = eva.eva_type || '';
        if (pe && pe > 0) parts.push(`PE(TTM): ${pe.toFixed(2)}`);
        if (pePct !== null) parts.push(`PE分位: ${pePct.toFixed(1)}%`);
        if (pb && pb > 0) parts.push(`PB: ${pb.toFixed(2)}`);
        if (pbPct !== null) parts.push(`PB分位: ${pbPct.toFixed(1)}%`);
        if (roe && roe > 0) parts.push(`ROE: ${(roe*100).toFixed(2)}%`);
        if (divYield && divYield > 0) parts.push(`股息率: ${(divYield*100).toFixed(2)}%`);
        if (evaType === 'low') parts.push('【蛋卷评估: 低估】');
        else if (evaType === 'mid') parts.push('【蛋卷评估: 正常估值】');
        else if (evaType === 'high') parts.push('【蛋卷评估: 高估】');
      } else {
        parts.push('【估值数据未找到】');
      }
      return parts.join(' | ');
    });
    return { output: `【指数估值快照】\n\n${results.join('\n')}`, pendingActions: [] };
  } catch (e) {
    return { output: '指数估值数据获取失败: ' + e.message, pendingActions: [] };
  }
};

// ============================================================================
// 工具 17: 跨资产数据
// ============================================================================
const handleGetCrossAssetData = async (ctx) => {
  try {
    const fxUrl = `https://qt.gtimg.cn/q=fxUSDCNY,fxEURCNY,spAU9999`;
    let fetchUrl = buildProxyUrl(ctx.settings, fxUrl);
    if (ctx.settings.proxyMode !== 'custom' || !ctx.settings.customProxyUrl) fetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(fxUrl)}`;
    const res = await fetch(fetchUrl, { cache: 'no-store' });
    let text;
    if (ctx.settings.proxyMode === 'custom') { text = new TextDecoder('gbk').decode(await res.arrayBuffer()); }
    else { const wrapped=await res.json(); const raw=wrapped.contents||''; text=raw.includes('�') ? (()=>{ try{ return new TextDecoder('gbk').decode(new Uint8Array(raw.split('').map(c=>c.charCodeAt(0)))); }catch(e){ return raw; } })() : raw; }
    const parts = [];
    (text||'').split(';').filter(l=>l.includes('v_')).forEach(line => {
      const dataArr = line.substring(line.indexOf('="')+2,line.length-1).split('~');
      if (dataArr.length<5) return;
      const name = dataArr[1], price = parseFloat(dataArr[3]), prevClose = parseFloat(dataArr[4])||0, pct = prevClose>0 ? (price-prevClose)/prevClose*100 : 0;
      if (name && !isNaN(price)) parts.push(`${name}: ${(name.includes('黄金')?price.toFixed(2):price.toFixed(4))} (${pct>0?'+':''}${pct.toFixed(2)}%)`);
    });
    // 期货
    try {
      const futUrl = `https://hq.sinajs.cn/list=nf_CU0,nf_SC0`;
      let futFetchUrl = buildProxyUrl(ctx.settings, futUrl);
      if (ctx.settings.proxyMode !== 'custom' || !ctx.settings.customProxyUrl) futFetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(futUrl)}`;
      const futRes = await fetch(futFetchUrl, { cache: 'no-store' });
      let futText;
      if (ctx.settings.proxyMode === 'custom') { futText = new TextDecoder('gbk').decode(await futRes.arrayBuffer()); }
      else { const w=await futRes.json(); const r=w.contents||''; futText=r.includes('�') ? (()=>{ try{ return new TextDecoder('gbk').decode(new Uint8Array(r.split('').map(c=>c.charCodeAt(0)))); }catch(e){ return r; } })() : r; }
      (futText||'').split(';').filter(l=>l.includes('hq_str_nf_')).forEach(line => {
        const arr = line.substring(line.indexOf('="')+2,line.length-1).split(',');
        if (arr.length<7) return;
        const name = (arr[0]||'').replace('连续','主力');
        let price = parseFloat(arr[5]); if (!price) price = parseFloat(arr[2]); if (!price) price = parseFloat(arr[6]);
        const prevClose = parseFloat(arr[6])||0, pct = prevClose>0 ? (price-prevClose)/prevClose*100 : 0;
        if (name && !isNaN(price) && price>0) parts.push(`${name}: ${price.toFixed(2)} (${pct>0?'+':''}${pct.toFixed(2)}%)`);
      });
    } catch(e) { parts.push('期货数据暂时获取失败'); }
    return {
      output: `【国内跨资产宏观快照】\n${parts.join('\n')}\n\n📌 USD/CNY↑=人民币贬值 | 铜↑=复苏 | 原油↑=通胀 | 黄金↑=避险\n👉 隔夜外盘(美股/VIX)数据已在上下文中注入,直接读取即可,无需重复调用。`,
      pendingActions: []
    };
  } catch (e) {
    return { output: '跨资产数据获取失败: ' + e.message, pendingActions: [] };
  }
};

// ============================================================================
// 工具 18: 债市数据
// ============================================================================
const handleGetBondMarketData = async (ctx) => {
  try {
    const parts = [];
    try {
      const spreadUrl = `https://qt.gtimg.cn/q=sh000012,sh000013`;
      let sFetchUrl = buildProxyUrl(ctx.settings, spreadUrl);
      if (ctx.settings.proxyMode !== 'custom' || !ctx.settings.customProxyUrl) sFetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(spreadUrl)}`;
      const sRes = await fetch(sFetchUrl, { cache: 'no-store' });
      let text;
      if (ctx.settings.proxyMode === 'custom') { text = new TextDecoder('gbk').decode(await sRes.arrayBuffer()); }
      else { const w=await sRes.json(); const r=w.contents||''; text=r.includes('�') ? (()=>{ try{ return new TextDecoder('gbk').decode(new Uint8Array(r.split('').map(c=>c.charCodeAt(0)))); }catch(e){ return r; } })() : r; }
      const bondMap = {};
      (text||'').split(';').filter(l=>l.includes('v_sh')).forEach(line => {
        const arr = line.substring(line.indexOf('="')+2,line.length-1).split('~');
        if (arr.length<5) return;
        const code = arr[2], price = parseFloat(arr[3]), prevClose = parseFloat(arr[4])||0, pct = prevClose>0 ? (price-prevClose)/prevClose*100 : 0;
        if (code) bondMap[code] = pct;
      });
      const govPct = bondMap['000012'] ?? 0, corpPct = bondMap['000013'] ?? 0;
      if (bondMap['000012'] !== undefined) {
        const spread = corpPct - govPct;
        const signal = spread>0.05 ? '🔥 信用利差大幅收窄' : spread>0.01 ? '✅ 温和收窄' : spread<-0.05 ? '🚨 大幅走阔' : spread<-0.01 ? '⚠️ 温和走阔' : '➖ 稳定';
        parts.push(`【信用利差】\n国债指数(000012): ${govPct>0?'+':''}${govPct.toFixed(2)}% | 企债指数(000013): ${corpPct>0?'+':''}${corpPct.toFixed(2)}%\n利差方向: ${signal}`);
      }
    } catch(e) { parts.push('信用利差数据暂不可用'); }
    parts.push('\n📌 国债ETF价格数据(511260/511090)已在大盘雷达中注入，请结合分析。');
    return { output: `【债市深度数据 — 信用定价】\n${parts.join('\n')}`, pendingActions: [] };
  } catch (e) {
    return { output: '债市数据获取失败: ' + e.message, pendingActions: [] };
  }
};

// ============================================================================
// 工具 19: 宏观指标
// ============================================================================
const handleGetMacroData = async (ctx) => {
  try {
    const indicators = [];
    try {
      const cpiUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_CPI&columns=ALL&pageNumber=1&pageSize=1&sortColumns=REPORT_DATE&sortTypes=-1`;
      let fetchUrl = buildProxyUrl(ctx.settings, cpiUrl);
      if (ctx.settings.proxyMode !== 'custom' || !ctx.settings.customProxyUrl) fetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(cpiUrl)}`;
      const res = await fetch(fetchUrl, { cache: 'no-store' });
      const raw = await res.text();
      let d; try { d=JSON.parse(raw); } catch(e) { if(raw.includes('contents')){ const w=JSON.parse(raw); d=typeof w.contents==='string'?JSON.parse(w.contents):w.contents; } }
      const item = d?.result?.data?.[0];
      if (item) indicators.push(`CPI 同比: ${item.NATIONAL_SAME||item.CPI_GR||item.CPI_SAME||'未知'}% | 日期: ${item.REPORT_DATE||'未知'}`);
    } catch(e) {}
    try {
      const pmiUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_PMI&columns=ALL&pageNumber=1&pageSize=1&sortColumns=REPORT_DATE&sortTypes=-1`;
      let fetchUrl = buildProxyUrl(ctx.settings, pmiUrl);
      if (ctx.settings.proxyMode !== 'custom' || !ctx.settings.customProxyUrl) fetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(pmiUrl)}`;
      const res = await fetch(fetchUrl, { cache: 'no-store' });
      const raw = await res.text();
      let d; try { d=JSON.parse(raw); } catch(e) { if(raw.includes('contents')){ const w=JSON.parse(raw); d=typeof w.contents==='string'?JSON.parse(w.contents):w.contents; } }
      const item = d?.result?.data?.[0];
      if (item) { const pmi = parseFloat(item.PMI_GR||item.PMI||item.MAKE_INDEX||item.MANUFACTURING_PMI); if (!isNaN(pmi)) indicators.push(`制造业 PMI: ${pmi} | ${pmi>50?'扩张':pmi<50?'收缩':'荣枯线'} | 日期: ${item.REPORT_DATE||'未知'}`); }
    } catch(e) {}
    indicators.push('M2 同比: 需联网搜索获取 | 广义货币供应量');
    return { output: `【宏观经济指标快照】\n\n${indicators.join('\n\n')}\n\n📌 CPI<2%=低通胀 | PMI>50=经济扩张`, pendingActions: [] };
  } catch (e) {
    return { output: '宏观数据获取失败: ' + e.message, pendingActions: [] };
  }
};

// ============================================================================
// 工具 20-21: 打分快照相关
// ============================================================================
const handleGetRecentScores = async (ctx) => {
  const days = ctx.args.days || 5;
  if (!ctx.firestoreContext?.db || !ctx.firestoreContext?.userId || !ctx.firestoreContext?.appId) {
    return { output: '【系统提示】打分快照存储未就绪，跳过动量修正。', pendingActions: [] };
  }
  try {
    const { db, userId, appId } = ctx.firestoreContext;
    const sinceDate = new Date(); sinceDate.setDate(sinceDate.getDate() - Math.max(days, 30));
    const snapshotsRef = collection(db, 'artifacts', appId, 'users', userId, 'scoring_snapshots');
    const q = query(snapshotsRef, where('date', '>=', sinceDate.toISOString().split('T')[0]), orderBy('date', 'desc'), limit(Math.min(days, 30)));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return { output: `近 ${days} 天内无历史打分记录。动量修正=0，滞回锁定不触发。`, pendingActions: [] };
    let output = `【打分快照查询结果 — 近 ${days} 天历史】\n`;
    output += `格式: 日期 | 权益分(F1/F2/F3/F4→最终) | 固收分 | CIO | 量价 | P&L\n`;
    snapshot.forEach(doc => {
      const s = doc.data();
      const timeStr = s.createdAt ? new Date(s.createdAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      let line = `\n${s.date}${timeStr ? ' '+timeStr : ''} | `;
      if (s.equity) {
        line += `权益 F1=${s.equity.F1} F2=${s.equity.F2} F3=${s.equity.F3} F4=${s.equity.F4}→${s.equity.final}`;
        if (s.equity.f3Flags) line += `(${s.equity.f3Flags})`;
        if (s.equity.turnoverYi) line += ` | 成交${s.equity.turnoverYi}亿 ↑${s.equity.upCount??'?'}/↓${s.equity.downCount??'?'}`;
      }
      if (s.bond) line += ` | 固收 F1=${s.bond.F1} F2=${s.bond.F2}→${s.bond.final}`;
      if (s.verdict) line += ` | CIO:${s.verdict.equityAction}${s.verdict.bondAction?' '+s.verdict.bondAction:''}${s.verdict.hysteresisActive?' 🔒滞回':''}`;
      if (s.totalValue) line += ` | 市值${(s.totalValue/10000).toFixed(1)}万`;
      if (s.totalProfit != null) {
        const sign = s.totalProfit >= 0 ? '+' : '';
        line += ` 盈亏${sign}${Math.round(s.totalProfit).toLocaleString()}`;
      }
      if (s.overallXirr != null) line += ` XIRR=${(s.overallXirr*100).toFixed(1)}%`;
      output += line + '\n';
    });
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: `打分快照查询异常: ${e.message}。跳过动量修正。`, pendingActions: [] };
  }
};

const handleStoreScoringSnapshot = async (ctx) => {
  return {
    output: '【系统提示】打分快照已自动保存到云端存储。',
    pendingActions: [{ ...ctx.args, toolType: 'score_record', createdAt: new Date().toISOString() }]
  };
};

// ============================================================================
// ============================================================================
// 工具 22: 基金风险指标 — Sharpe / MDD / IR / 跟踪误差
// ============================================================================
const handleGetFundRiskMetrics = async (ctx) => {
  try {
    const fundCode = ctx.args.fundCode;
    const benchmarkCode = ctx.args.benchmark || 'sh000001'; // 默认上证

    // 获取基金历史净值
    const fundUrl = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${fundCode}&pageIndex=1&pageSize=120`;
    const fundFetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
      ? buildProxyUrl(ctx.settings, fundUrl) : buildAllOriginsUrl(fundUrl);
    const fundRes = await fetch(fundFetchUrl, { cache: 'no-store' });
    const fundRaw = await fundRes.text();
    let fundData;
    try { fundData = JSON.parse(fundRaw); } catch { fundData = JSON.parse(JSON.parse(fundRaw).contents); }
    const navList = (fundData?.Data?.LSJZList || []).map(item => ({
      date: item.FSRQ,
      nav: parseFloat(item.DWJZ)
    })).reverse();
    if (navList.length < 20) return { output: '净值数据不足（<20日），无法计算风险指标。', pendingActions: [] };

    // 获取基准 K 线
    let benchmarkReturns = [];
    try {
      const bmCode = benchmarkCode.startsWith('sh') || benchmarkCode.startsWith('sz') ? benchmarkCode : 'sh' + benchmarkCode;
      const bmUrl = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=${bmCode},day,,,120,`;
      const bmFetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
        ? buildProxyUrl(ctx.settings, bmUrl) : buildAllOriginsUrl(bmUrl);
      const bmRes = await fetch(bmFetchUrl, { cache: 'no-store' });
      const bmData = await bmRes.json();
      const bmKline = bmData?.data?.[bmCode]?.day || bmData?.data?.[bmCode]?.qfqday || [];
      const bmCloses = bmKline.map(d => parseFloat(d[2])).filter(v => !isNaN(v));
      for (let i = 1; i < bmCloses.length; i++) {
        if (bmCloses[i - 1] > 0) benchmarkReturns.push((bmCloses[i] - bmCloses[i - 1]) / bmCloses[i - 1]);
      }
    } catch (e) { /* 基准失败不影响主要计算 */ }

    // 计算日收益率
    const dailyReturns = [];
    for (let i = 1; i < navList.length; i++) {
      if (navList[i - 1].nav > 0) dailyReturns.push((navList[i].nav - navList[i - 1].nav) / navList[i - 1].nav);
    }
    if (dailyReturns.length < 10) return { output: '日收益率序列不足（<10日）。', pendingActions: [] };
    const n = dailyReturns.length;
    const daysPerYear = 252;

    // 年化收益率
    const firstNav = navList[0].nav, lastNav = navList[navList.length - 1].nav;
    const years = n / daysPerYear;
    const annualReturn = years > 0 ? (Math.pow(lastNav / firstNav, 1 / years) - 1) : 0;

    // 年化波动率
    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / n;
    const variance = dailyReturns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / n;
    const annualVol = Math.sqrt(variance) * Math.sqrt(daysPerYear);

    // Sharpe 比率（无风险利率按 2%）
    const riskFree = 0.02;
    const sharpe = annualVol > 0 ? ((annualReturn - riskFree) / annualVol) : 0;

    // 最大回撤 MDD
    let peak = navList[0].nav, mdd = 0, mddStart = '', mddEnd = '';
    for (const point of navList) {
      if (point.nav > peak) peak = point.nav;
      const dd = (peak - point.nav) / peak;
      if (dd > mdd) { mdd = dd; mddEnd = point.date; }
    }
    // 找 MDD 起点
    let foundPeak = false;
    for (const point of navList) {
      if (point.nav / (1 - mdd) >= peak * 0.99 && !foundPeak) { mddStart = point.date; foundPeak = true; }
    }

    // 回撤恢复天数
    let recoveryDays = 0;
    const mddEndIdx = navList.findIndex(p => p.date === mddEnd);
    if (mddEndIdx >= 0) {
      for (let i = mddEndIdx + 1; i < navList.length; i++) {
        recoveryDays++;
        if (navList[i].nav >= peak) break;
      }
    }

    // vs 基准：超额收益 + 跟踪误差 + IR
    let excessReturn = 0, trackingError = 0, ir = 0;
    if (benchmarkReturns.length > 0) {
      const minLen = Math.min(dailyReturns.length, benchmarkReturns.length);
      const fundR = dailyReturns.slice(-minLen), bmR = benchmarkReturns.slice(-minLen);
      const excess = fundR.map((r, i) => r - bmR[i]);
      const meanExcess = excess.reduce((a, b) => a + b, 0) / excess.length;
      excessReturn = meanExcess * daysPerYear;
      const excessVar = excess.reduce((s, r) => s + Math.pow(r - meanExcess, 2), 0) / excess.length;
      trackingError = Math.sqrt(excessVar) * Math.sqrt(daysPerYear);
      ir = trackingError > 0 ? excessReturn / trackingError : 0;
    }

    let output = `【基金 ${fundCode} 风险指标 — ${navList.length}个交易日】\n\n`;
    output += `📈 收益指标\n`;
    output += `年化收益: ${(annualReturn*100).toFixed(2)}% | 年化波动: ${(annualVol*100).toFixed(2)}% | Sharpe: ${sharpe.toFixed(2)}\n\n`;
    output += `📉 风险指标\n`;
    output += `最大回撤(MDD): -${(mdd*100).toFixed(2)}% (${mddStart}→${mddEnd}) | 恢复天数: ${recoveryDays}天\n\n`;
    if (benchmarkReturns.length > 0) {
      output += `⚖️ vs ${benchmarkCode} 基准\n`;
      output += `超额收益: ${excessReturn >= 0 ? '+' : ''}${(excessReturn*100).toFixed(2)}% | 跟踪误差: ${(trackingError*100).toFixed(2)}% | IR: ${ir.toFixed(2)}\n`;
      output += `IR评估: `;
      if (ir > 1.0) output += '✅ IR>1.0 持续超额能力显著';
      else if (ir > 0.5) output += '✅ IR>0.5 具备超额能力';
      else if (ir > 0) output += '⚠️ IR偏低,超额不稳定';
      else output += '❌ IR≤0 跑输基准';
      output += '\n';
    }
    output += `\n👉 MDD用于击球区设定：若历史MDD=-${(mdd*100).toFixed(0)}%,击球区下沿应≥${(mdd*50).toFixed(1)}%。`;

    return { output, pendingActions: [] };
  } catch (e) {
    return { output: `风险指标计算异常: ${e.message}`, pendingActions: [] };
  }
};

// HANDLER_MAP — 策略模式映射表
// ============================================================================

// I. 深度微观结构探测器 — 调Worker做数据降维，返回定性信号
const handleGetMarketMicrostructure = async (ctx) => {
  const { settings } = ctx;
  // 优先使用自定义代理Worker（microstructure端点部署在my-cors-proxy）
  // customProxyUrl格式: "https://xxx.workers.dev/?url={{url}}" → 剥离?url=模板
  const proxyUrl = (settings?.customProxyUrl || '').trim();
  const cfUrl = (settings?.cfWorkerUrl || '').trim();
  const workerUrl = proxyUrl || cfUrl;
  if (!workerUrl) {
    return { output: '❌ 未配置 Worker URL（自定义代理或巡检大脑至少填一个），无法查询微观结构数据。', pendingActions: [] };
  }
  try {
    // 剥离可能存在的模板参数 (?url={{url}}) 和尾部斜杠
    const base = workerUrl.split('?')[0].replace(/\/+$/, '');
    const res = await fetch(base + '/api/market-microstructure');
    if (!res.ok) throw new Error('Worker returned ' + res.status);
    const data = await res.json();

    // 压缩为精炼文本注入 AI — 只提供原始数据，不做定性判断
    let output = '【深度微观结构探测】\n';
    // 银行间流动性
    if (data.liquidity?.ON_level != null) {
      output += `├ 隔夜利率(GC001): ${data.liquidity.ON_rate?.toFixed(3)}% | 水位: ${data.liquidity.ON_level} (日变${data.liquidity.ON_change_bp ?? '?'}bp)\n`;
    }
    if (data.liquidity?.DR007_proxy_level != null) {
      output += `├ 7日利率(GC007): ${data.liquidity.DR007_proxy_rate?.toFixed(3)}% | 水位: ${data.liquidity.DR007_proxy_level} (日变${data.liquidity.DR007_change_bp ?? '?'}bp)\n`;
    }
    // 期指基差 — 只给原始数据
    for (const [key, fut] of Object.entries(data.derivatives || {})) {
      if (fut.settlement != null) {
        output += `├ 期指${key}: 结算${fut.settlement?.toFixed(1)} vs 现货${fut.spotClose?.toFixed(1)} | 基差${fut.basisPct ?? 'N/A'} | 成交${(fut.volume/10000).toFixed(0)}万手 持仓${(fut.openInterest/10000).toFixed(0)}万手\n`;
      }
    }
    output += `└ 旗标: ${data.overall_signal || 'N/A'}`;
    output += `\n\n📌 以上为原始数据。涨跌家数/涨跌比请从上下文【市场真实情绪】中读取，此处仅提供流动性+期指维度。请自行结合F1-F4全维度做独立判定。`;

    return { output, pendingActions: [] };
  } catch (e) {
    return { output: `⚠️ 微观结构数据获取失败: ${e.message}。继续按标准流程分析，不做熔断。`, pendingActions: [] };
  }
};

export const HANDLER_MAP = new Map([
  ['get_realtime_fund_data', handleGetRealtimeFundData],
  ['get_batch_fund_data', handleGetBatchFundData],
  ['get_fund_history_data', handleGetFundHistoryData],
  ['get_fund_comparison', handleGetFundComparison],
  ['get_financial_news', handleGetFinancialNews],
  ['google_macro_search', handleSearchTools],
  ['tavily_news_search', handleSearchTools],
  ['exa_research', handleSearchTools],
  ['get_market_historical_intraday', handleGetMarketHistoricalIntraday],
  ['generate_trend_chart', handleGenerateTrendChart],
  ['execute_javascript', handleExecuteJavascript],
  ['update_ledger', handleUpdateLedger],
  ['manage_plan_todo', handleManagePlanTodo],
  ['update_decision_memo', handleUpdateDecisionMemo],
  ['get_fund_transaction_history', handleGetFundTransactionHistory],
  ['get_index_valuation', handleGetIndexValuation],
  ['get_cross_asset_data', handleGetCrossAssetData],
  ['get_bond_market_data', handleGetBondMarketData],
  ['get_macro_data', handleGetMacroData],
  ['get_recent_scores', handleGetRecentScores],
  ['store_scoring_snapshot', handleStoreScoringSnapshot],
  ['get_fund_risk_metrics', handleGetFundRiskMetrics],
  ['get_market_microstructure', handleGetMarketMicrostructure],
]);
