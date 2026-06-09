// 工具处理器 — 每个 handler 返回 { output, pendingActions }，无副作用
import { buildProxyUrl, buildAllOriginsUrl } from '../proxy';
import { fetchSerperSearch, fetchTavilySearch, fetchExaSearch } from '../search-engines';
import { formatCashFlows } from '../market-data';
import { fetchFinancialNews } from '../financial-news';
import { collection, query, where, orderBy, limit, getDocs, setDoc, doc } from 'firebase/firestore';
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
// 工具 7: 历史K线 (多周期OHLC)
// ============================================================================
const handleGetMarketHistoricalIntraday = async (ctx) => {
  try {
    let code = (ctx.args.code || '').toLowerCase();
    if (/^\d{6}$/.test(code)) code = (code === '000001' || code.startsWith('5')) ? 'sh'+code : 'sz'+code;
    const period = (ctx.args.period || 'day').toLowerCase();
    const count = Math.min(ctx.args.count || (period === 'day' ? 60 : period === 'week' ? 20 : 12), 100);
    const targetUrl = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},${period},,,${count},`;
    const fetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl ? buildProxyUrl(ctx.settings, targetUrl) : buildAllOriginsUrl(targetUrl);
    const res = await fetch(fetchUrl, { cache: 'no-store' });
    const resData = await res.json();
    const klineData = resData?.data?.[code]?.[period] || resData?.data?.[code]?.[`qfq${period}`];
    const periodLabel = { day: '日K(60日)', week: '周K(20周)', month: '月K(12月)' }[period] || `${period}K`;
    let output = `【${ctx.args.code} ${periodLabel}，共 ${count} 根 OHLC 微观结构数据】\n(注：实体/影线百分比基准为当日开盘价)\n`;
    if (klineData && Array.isArray(klineData)) {
      let maxHigh = -Infinity, minLow = Infinity, upBars = 0, downBars = 0, totalBody = 0, totalShadow = 0;
      klineData.forEach(day => {
        const open = parseFloat(day[1]), close = parseFloat(day[2]), high = parseFloat(day[3]), low = parseFloat(day[4]);
        if (high > maxHigh) maxHigh = high;
        if (low < minLow) minLow = low;
        if (close >= open) upBars++; else downBars++;
        totalBody += Math.abs((close - open) / open);
        totalShadow += (high - Math.max(open, close)) / open + (Math.min(open, close) - low) / open;
      });
      const n = klineData.length;
      output += `📊 统计: 区间[${minLow.toFixed(2)}~${maxHigh.toFixed(2)}] | 振幅${((maxHigh-minLow)/minLow*100).toFixed(1)}% | 阳线${upBars}/${n} 阴线${downBars}/${n} | 均实体${(totalBody/n*100).toFixed(1)}% 均影线${(totalShadow/n*100).toFixed(1)}%\n\n逐根OHLC:\n`;
      klineData.forEach(day => {
        const date=day[0], open=parseFloat(day[1]), close=parseFloat(day[2]), high=parseFloat(day[3]), low=parseFloat(day[4]);
        const ampPct = (high-low)/open*100, bodyPct = (close-open)/open*100, upperPct = (high-Math.max(open,close))/open*100, lowerPct = (Math.min(open,close)-low)/open*100;
        const barType = close >= open ? '阳' : '阴';
        output += `- [${date}] 开:${open} 高:${high} 低:${low} 收:${close} | ${barType}线 振幅${ampPct.toFixed(2)}% 实体${bodyPct>0?'+'+bodyPct.toFixed(2):bodyPct.toFixed(2)}% 上影${upperPct.toFixed(2)}% 下影${lowerPct.toFixed(2)}%\n`;
      });
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
// 工具 13: FOF 字典写入
// ============================================================================
const handleUpdateFofDictionary = async (ctx) => {
  return {
    output: '【系统提示】FOF 穿透字典入库单据已生成。请在回复中提示用户点击卡片确认写入云端。',
    pendingActions: [{ ...ctx.args, toolType: 'fof_dict' }]
  };
};

// ============================================================================
// 工具 14: 持仓穿透 — 双源（蛋卷 + 东方财富）+ 行业预分类
// ============================================================================

// 股票名 → 申万一级行业映射（覆盖 A 股 top 持仓中的高频股票，约 80 只）
const STOCK_SECTOR_MAP = {
  '贵州茅台': '食品饮料', '五粮液': '食品饮料', '泸州老窖': '食品饮料', '山西汾酒': '食品饮料',
  '宁德时代': '电力设备', '比亚迪': '汽车', '阳光电源': '电力设备', '隆基绿能': '电力设备',
  '中国平安': '非银金融', '招商银行': '银行', '兴业银行': '银行', '工商银行': '银行', '建设银行': '银行',
  '迈瑞医疗': '医药生物', '药明康德': '医药生物', '恒瑞医药': '医药生物', '片仔癀': '医药生物',
  '美的集团': '家用电器', '格力电器': '家用电器', '海尔智家': '家用电器',
  '立讯精密': '电子', '海康威视': '计算机', '中芯国际': '电子', '韦尔股份': '电子', '兆易创新': '电子',
  '中国石油': '石油石化', '中国石化': '石油石化', '中国海油': '石油石化',
  '紫金矿业': '有色金属', '洛阳钼业': '有色金属', '赣锋锂业': '有色金属', '天齐锂业': '有色金属',
  '牧原股份': '农林牧渔', '温氏股份': '农林牧渔', '海大集团': '农林牧渔', '新希望': '农林牧渔',
  '万华化学': '基础化工', '恒力石化': '石油石化', '荣盛石化': '石油石化',
  '长江电力': '公用事业', '中国核电': '公用事业', '华能国际': '公用事业',
  '中国建筑': '建筑装饰', '中国中铁': '建筑装饰', '中国交建': '建筑装饰',
  '顺丰控股': '交通运输', '中远海控': '交通运输', '京沪高铁': '交通运输', '大秦铁路': '交通运输',
  '伊利股份': '食品饮料', '海天味业': '食品饮料', '金龙鱼': '农林牧渔', '双汇发展': '食品饮料',
  '中兴通讯': '通信', '中国联通': '通信', '中际旭创': '通信', '新易盛': '通信',
  '万科A': '房地产', '保利发展': '房地产', '招商蛇口': '房地产',
  '中国神华': '煤炭', '陕西煤业': '煤炭', '兖矿能源': '煤炭', '中煤能源': '煤炭',
  '中国中免': '商贸零售', '永辉超市': '商贸零售', '王府井': '商贸零售',
  '东方财富': '非银金融', '中信证券': '非银金融', '华泰证券': '非银金融',
  '三一重工': '机械设备', '中联重科': '机械设备', '徐工机械': '机械设备',
  '金山办公': '计算机', '科大讯飞': '计算机', '用友网络': '计算机',
  '北方华创': '电子', '中微公司': '电子', '寒武纪': '电子',
  '宝钢股份': '钢铁', '鞍钢股份': '钢铁',
  '通威股份': '电力设备', '天合光能': '电力设备', '晶澳科技': '电力设备', '晶科能源': '电力设备',
  '航发动力': '国防军工', '中航沈飞': '国防军工', '中国船舶': '国防军工', '中航西飞': '国防军工',
  '福耀玻璃': '汽车', '长城汽车': '汽车', '上汽集团': '汽车', '长安汽车': '汽车',
  '中国移动': '通信', '中国电信': '通信', '中国广核': '公用事业',
  '恒生电子': '计算机', '广联达': '计算机', '深信服': '计算机',
  '爱尔眼科': '医药生物', '泰格医药': '医药生物', '智飞生物': '医药生物', '长春高新': '医药生物',
  '分众传媒': '传媒', '芒果超媒': '传媒', '三七互娱': '传媒',
  '青岛啤酒': '食品饮料', '洋河股份': '食品饮料', '古井贡酒': '食品饮料',
  '国电南瑞': '电力设备', '特变电工': '电力设备', '思源电气': '电力设备',
  '汇川技术': '机械设备', '先导智能': '机械设备', '杰瑞股份': '机械设备',
  '中航光电': '国防军工', '中国重工': '国防军工', '中航机电': '国防军工',
  '杭州银行': '银行', '宁波银行': '银行', '平安银行': '银行',
  '韦尔股份': '电子', '澜起科技': '电子', '卓胜微': '电子', '圣邦股份': '电子',
  '药明生物': '医药生物', '百济神州': '医药生物', '信达生物': '医药生物',
  '腾讯控股': '传媒', '阿里巴巴': '商贸零售', '美团': '社会服务', '快手': '传媒',
};

function classifyStock(name) {
  if (STOCK_SECTOR_MAP[name]) return STOCK_SECTOR_MAP[name];
  for (const [stockName, sector] of Object.entries(STOCK_SECTOR_MAP)) {
    if (name.includes(stockName) || stockName.includes(name)) return sector;
  }
  return '其他';
}

const handleGetFundHoldingsPenetration = async (ctx) => {
  try {
    const fundCode = ctx.args.fundCode;
    let actualData = null;

    // ── 数据源 1：蛋卷基金 ──
    try {
      const targetUrl = `https://danjuanfunds.com/djapi/fund/${fundCode}`;
      const fetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
        ? buildProxyUrl(ctx.settings, targetUrl)
        : buildAllOriginsUrl(targetUrl);
      const res = await fetch(fetchUrl, { cache: 'no-store' });
      const data = await res.json();
      actualData = ctx.settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
    } catch (e) {
      console.warn(`[穿透] 蛋卷 API 失败: ${e.message}`);
    }

    // ── 数据源 2：东方财富（全代理模式均尝试，不再限于 custom）──
    try {
      const hasStock = actualData?.data?.fund_position?.stock_list?.length > 0;
      const hasBond = actualData?.data?.fund_position?.bond_list?.length > 0;
      if (!hasStock && !hasBond) {
        const fakeDeviceId = Math.random().toString(36).substring(2, 15);
        const emUrl = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${fundCode}&deviceid=${fakeDeviceId}&plat=Android&product=EFund&version=6.6.8`;
        const emFetchUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
          ? buildProxyUrl(ctx.settings, emUrl)
          : buildAllOriginsUrl(emUrl);
        const emRes = await fetch(emFetchUrl, { cache: 'no-store' });
        if (emRes.ok) {
          const raw = await emRes.text();
          let emData;
          try { emData = JSON.parse(raw); } catch { emData = JSON.parse(JSON.parse(raw).contents); }
          if (emData?.Datas && !emData.ErrCode) {
            // JZBL 直接 parseFloat，东方财富已返回正确百分比值（如 "0.99"=0.99%, "1.46"=1.46%）
            // 东方财富自带行业分类 (INDEXCODE/INDEXNAME)，优先使用
            const stock_list = (emData.Datas.fundStocks || []).map(s => ({
              name: s.GPJC,
              code: s.GPDM || '',
              percent: parseFloat(s.JZBL) || 0,
              sector: s.INDEXNAME || '',           // API 自带申万行业
              changeType: s.PCTNVCHGTYPE || '',     // 调仓方向: 新增/增持/减持/不变
              changePct: s.PCTNVCHG || ''           // 调仓幅度
            }));
            const bond_list = (emData.Datas.fundbonds || []).map(b => ({
              name: b.ZQMC,
              code: b.ZQDM || '',
              percent: parseFloat(b.ZJZBL) || 0  // 债券用 ZJZBL（占净值比例）
            }));
            if (!actualData) actualData = { data: {} };
            if (!actualData.data) actualData.data = {};
            actualData.data.fund_position = { stock_list, bond_list, source: 'eastmoney' };
          }
        }
      }
    } catch (e) {
      console.warn(`[穿透] 东方财富 API 失败: ${e.message}`);
    }

    // ── 解析业绩基准，提取权益仓位锚点 ──
    const parseBenchmark = (bm) => {
      if (!bm) return null;
      // 匹配沪深300/中证500/中证800/创业板/上证等权益指数及其权重
      const equityIndices = /(?:沪深300|中证[58]00|创业板|科创[5慧]0|上证[5慧]0|恒生|标普|纳斯达克)/;
      let equityPct = 0;
      // 模式: 指数名×权重% 或 指数名收益率×权重%
      const matches = bm.matchAll(/(?:[中沪深创科上恒标纳][一-龥\d]+(?:指数)?)(?:收益率)?[×xX]\s*(\d+(?:\.\d+)?)\s*%/g);
      for (const m of matches) {
        const idxName = m[0];
        if (equityIndices.test(idxName)) {
          equityPct += parseFloat(m[1]);
        }
      }
      return equityPct > 0 ? equityPct / 100 : null;
    };

    // ── 构建输出 ──
    const benchmark = actualData?.data?.performance_bench_mark || '';
    const benchmarkEquity = parseBenchmark(benchmark);
    const fundPosition = actualData?.data?.fund_position;
    if (fundPosition) {
      const stocks = fundPosition.stock_list || [];
      const bonds = fundPosition.bond_list || [];
      const stockPercent = stocks.reduce((sum, s) => sum + (parseFloat(s.percent) || 0), 0);
      const bondPercent = bonds.reduce((sum, b) => sum + (parseFloat(b.percent) || 0), 0);
      const sourceLabel = fundPosition.source === 'eastmoney' ? '东方财富' : '蛋卷基金';
      const typeDesc = actualData?.data?.type_desc || '';

      let output = `【基金 ${fundCode} 底层穿透（数据源: ${sourceLabel}, 来自最新季报/年报）】\n`;
      output += `⚠️ 以下百分比均为「占基金净值比例」(JZBL)，不是占股票市值比。\n`;
      if (typeDesc) output += `基金类型: ${typeDesc}\n`;
      if (benchmark) {
        output += `业绩基准: ${benchmark}`;
        if (benchmarkEquity) output += ` → 权益仓位锚≈${(benchmarkEquity * 100).toFixed(0)}%`;
        output += '\n';
      }

      if (stocks.length > 0) {
        // 行业分布：优先用东方财富 API 自带分类，其次用本地 STOCK_SECTOR_MAP
        const getSector = (s) => s.sector || classifyStock(s.name);
        const sectors = {};
        for (const s of stocks) {
          const sec = getSector(s);
          sectors[sec] = (sectors[sec] || 0) + s.percent;
        }
        const sectorSummary = Object.entries(sectors)
          .sort((a, b) => b[1] - a[1])
          .map(([n, p]) => `${n}${p.toFixed(1)}%`)
          .join('、');

        output += `\n【股票持仓 (${stocks.length}只)】\n`;
        output += `前十大占净值比合计: ${stockPercent.toFixed(2)}%（⚠️ 占净值比例，非占股票市值比）\n`;
        output += `【申万行业分布】${sectorSummary}\n\n`;
        // 检查是否有调仓信息（东方财富 API 专有）
        const hasChanges = stocks.some(s => s.changeType);
        output += '【股票明细】\n' + stocks.map(s => {
          const sec = getSector(s);
          const code = s.code ? `(${s.code})` : '';
          let changeStr = '';
          if (s.changeType && s.changeType !== '不变') {
            const arrow = s.changeType === '增持' ? '📈' : s.changeType === '减持' ? '📉' : '🆕';
            const pctChange = s.changePct ? ` ${s.changePct}%` : '';
            changeStr = ` ${arrow}${s.changeType}${pctChange}`;
          }
          return `- ${s.name}${code}: ${s.percent.toFixed(2)}% → ${sec}${changeStr}`;
        }).join('\n') + '\n\n';
        if (hasChanges) {
          output += '📈增持 📉减持 🆕新增 — 调仓方向反映基金经理最新观点\n\n';
        }

        // equityRatio：优先用业绩基准解析，其次 type_desc，最后前十大占比推断
        let equityRatioHint;
        if (benchmarkEquity) {
          equityRatioHint = benchmarkEquity.toFixed(2);  // 业绩基准最准
        } else if (typeDesc.includes('股票') || typeDesc.includes('偏股')) equityRatioHint = '0.85';
        else if (typeDesc.includes('混合') && !typeDesc.includes('偏债')) equityRatioHint = '0.65';
        else if (typeDesc.includes('灵活')) equityRatioHint = '0.50';
        else if (typeDesc.includes('债') || typeDesc.includes('固收')) equityRatioHint = '0.20';
        else if (typeDesc.includes('指数') || typeDesc.includes('ETF')) equityRatioHint = '0.95';
        else if (typeDesc.includes('货币')) equityRatioHint = '0.00';
        else equityRatioHint = (stockPercent / 100).toFixed(2);

        // 前十大集中度
        const estEquity = parseFloat(equityRatioHint);
        if (estEquity > 0.05 && stockPercent > 0) {
          const concentration = stockPercent / (estEquity * 100);
          const concLabel = concentration > 0.8 ? '高度集中' : concentration > 0.5 ? '中等集中' : '持股分散';
          output += `权益仓位锚≈${(estEquity * 100).toFixed(0)}%（${benchmarkEquity ? '来自业绩基准' : '来自类型推断'}），前十大占权益约${(concentration * 100).toFixed(0)}%（${concLabel}）\n`;
        } else if (estEquity <= 0.05) {
          output += `权益仓位锚≈${(estEquity * 100).toFixed(0)}%（纯债/货币型）\n`;
        }

        output += `👉 请调 update_fof_dictionary 入库。equityRatio=${equityRatioHint}。`;
      } else if (bonds.length > 0) {
        output += `【债券持仓 (${bonds.length}只)】占净值比合计: ${bondPercent.toFixed(2)}%\n`;
        output += bonds.map(b => `- ${b.name}: ${b.percent.toFixed(2)}%`).join('\n') + '\n';
        output += '👉 纯债/货币基金，禁止入库 FOF 字典。';
      } else {
        output += '【未发现持仓数据】该基金可能为纯债/货币型或季报未披露。禁止入库字典。';
      }
      return { output, pendingActions: [] };
    }

    return { output: `基金 ${fundCode} 暂无底层持仓数据。可能原因：纯债/货币基金不披露前十大、季报未更新、或接口暂不可用。`, pendingActions: [] };
  } catch (e) {
    console.error(`[穿透] 异常: ${e.message}`);
    return { output: `持仓穿透查询异常: ${e.message}`, pendingActions: [] };
  }
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
      output: `【跨资产宏观快照】\n${parts.join('\n')}\n\n📌 USD/CNY上行=人民币贬值 | 铜价上行=经济复苏 | 原油上行=通胀压力 | 黄金上行=避险`,
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
      let line = `\n${s.date} | `;
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
// HANDLER_MAP — 策略模式映射表
// ============================================================================
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
  ['update_fof_dictionary', handleUpdateFofDictionary],
  ['get_fund_holdings_penetration', handleGetFundHoldingsPenetration],
  ['get_fund_transaction_history', handleGetFundTransactionHistory],
  ['get_index_valuation', handleGetIndexValuation],
  ['get_cross_asset_data', handleGetCrossAssetData],
  ['get_bond_market_data', handleGetBondMarketData],
  ['get_macro_data', handleGetMacroData],
  ['get_recent_scores', handleGetRecentScores],
  ['store_scoring_snapshot', handleStoreScoringSnapshot],
]);
