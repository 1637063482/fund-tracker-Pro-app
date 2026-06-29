// 工具处理器 — 每个 handler 返回 { output, pendingActions }，无副作用
import { buildProxyUrl, buildAllOriginsUrl } from '../proxy';
import { fetchSerperSearch, fetchTavilySearch, fetchExaSearch } from '../search-engines';
import { formatCashFlows } from '../market-data';
import { fetchFinancialNews } from '../financial-news';
import { collection, query, where, orderBy, limit, getDocs, getDoc, setDoc, doc } from 'firebase/firestore';
import { themeColors, getThemeColor } from './colors';

// ── 权重贡献辅助: JS 预计算各因子加权贡献 ──
const DEFAULT_MAX_SCORES = { F1a: 20, F1b: 15, F2: 25, F3: 25, F4: 15 };

/**
 * @param {number} baseScore — JS 决策树输出的基础分
 * @param {string} factorKey — 'F1a'|'F1b'|'F2'|'F3'|'F4'
 * @param {Object} settings — ctx.settings (含 tunedMaxScores)
 * @returns {{text: string, contribution: number}} 格式化文本 + 数值
 */
function formatWeightedContribution(baseScore, factorKey, settings) {
  const defaultMax = DEFAULT_MAX_SCORES[factorKey] || 25;
  const tuned = settings?.tunedMaxScores?.[factorKey];
  const weight = tuned != null ? tuned : defaultMax;
  const contribution = baseScore * weight / defaultMax;
  if (tuned != null && tuned !== defaultMax) {
    return {
      text: ` | 权重${defaultMax}→${tuned} 贡献: ${contribution.toFixed(1)}(ⓘ权重变化引起的贡献差异属正常,以今日为准)`,
      contribution
    };
  }
  return {
    text: ` | 贡献: ${contribution.toFixed(1)}`,
    contribution
  };
}
import { classifyF1a, classifyF1b, classifyF2, classifyF4, classifyBondF1, classifyBondF2, classifyFundScore, classifyFundType, allocateByScore } from '../../quant/scoring-tree';
import { parseConstitutionToPrior, buildBLViews, blackLittermanPosterior, calcCurrentWeights } from '../../quant/bl-calibration';
import { fetchDanjuanIndexValuation, fetchBondSpread, fetchTencentQuotes } from '../data-fetcher';
import { computeBacktest, formatBacktestReport, metaVigilanceCheck } from '../../quant/backtest';
import { logDecisionTree, logVRCalc, logFundScore } from '../../quant/quantLogger';

// 共享：O-U 均值回归 OLS 拟合（供 risk_metrics 和 ou_half_life 共用）

// ============================================================================
// 多指数K线数据合并 — 辅助函数
// ============================================================================

/**
 * 合并多指数日K线数据为统一 marketData 结构
 * 腾讯日K格式: [dateStr, open, close, high, low, volume, ...]
 * @param {Array[]} shKlines — 上证(sh000001)日K数组
 * @param {Array[]} [cybKlines] — 创业板(sz399006)日K数组，可选
 * @param {Array[]} [szKlines] — 深成指(sz399001)日K数组，可选
 * @returns {Object} — {dateStr: {shClose, cybClose?, szClose?}}
 */
export function mergeMultiIndexKlines(shKlines, cybKlines, szKlines) {
  const result = {};

  // 构建各指数按日期索引
  const shMap = buildCloseMap(shKlines);
  const cybMap = buildCloseMap(cybKlines);
  const szMap = buildCloseMap(szKlines);

  // 合并：以上证日期为主轴（必选），创业板和深成指按日期合并
  for (const dateStr of Object.keys(shMap)) {
    const entry = { shClose: shMap[dateStr] };
    if (cybMap[dateStr] != null) entry.cybClose = cybMap[dateStr];
    if (szMap[dateStr] != null) entry.szClose = szMap[dateStr];
    result[dateStr] = entry;
  }

  return result;
}

/** 从K线数组中提取 {dateStr: closePrice} */
function buildCloseMap(klines) {
  if (!klines || !Array.isArray(klines) || klines.length === 0) return {};
  const map = {};
  for (const k of klines) {
    if (!Array.isArray(k) || k.length < 3) continue;
    const dateStr = String(k[0]).trim();
    const close = parseFloat(k[2]);
    if (dateStr && !isNaN(close)) {
      map[dateStr] = close;
    }
  }
  return map;
}

/**
 * 拉取单指数K线数据
 * @param {string} code — sh000001 / sz399006 / sz399001
 * @param {Object} settings
 * @param {number} days — 历史天数
 * @returns {Promise<Array[]>} K线数组
 */
async function fetchIndexKlines(code, settings, days) {
  const kUrl = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},day,,,${days},`;
  const kFUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
    ? buildProxyUrl(settings, kUrl) : buildAllOriginsUrl(kUrl);
  const res = await fetch(kFUrl, { cache: 'no-store' });
  const data = await res.json();
  return data?.data?.[code]?.day || data?.data?.[code]?.qfqday || [];
}
const computeOU = (navs) => {
  const Y = navs.slice(1), X = navs.slice(0, -1), n = Y.length;
  const sX = X.reduce((a, b) => a + b, 0), sY = Y.reduce((a, b) => a + b, 0);
  const sXY = X.reduce((a, b, i) => a + b * Y[i], 0), sX2 = X.reduce((a, b) => a + b * b, 0);
  const d = n * sX2 - sX * sX;
  if (Math.abs(d) < 1e-12) return null;
  const b = (n * sXY - sX * sY) / d, a = (sY - b * sX) / n;
  const theta = (b < 1 && b > 0) ? -Math.log(Math.max(b, 0.001)) : 0;
  const mu = b < 1 ? a / (1 - b) : navs[navs.length - 1];
  const hl = theta > 0 ? Math.log(2) / theta : Infinity;
  const residuals = Y.map((y, i) => y - a - b * X[i]);
  const sig = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / (n - 2));
  const devStd = sig > 0 ? (navs[navs.length - 1] - mu) / (sig / Math.sqrt(1 - b * b)) : 0;
  const hlLabel = hl === Infinity ? '无' : hl.toFixed(0) + '天';
  const sigLabel = hl === Infinity ? '无均值回归特征' : Math.abs(devStd) > 2 ? (devStd > 0 ? '高于均值2σ' : '低于均值2σ') : Math.abs(devStd) > 1 ? (devStd > 0 ? '高于均值1σ' : '低于均值1σ') : '均值附近';
  return { b, a, theta, mu, hl, devStd, hlLabel, sigLabel };
};

// 共享工具：从东方财富翻页拉取基金净值序列（API每页固定20条,无视pageSize）
const fetchFundNavPages = async (fundCode, targetCount, settings) => {
  let allData = [];
  for (let page = 1; page <= Math.ceil(targetCount / 20) + 1; page++) {
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${fundCode}&pageIndex=${page}&pageSize=120`;
    const fUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, url) : buildAllOriginsUrl(url);
    try {
      const res = await fetch(fUrl, { cache: 'no-store' });
      const raw = await res.text();
      let d;
      try { d = JSON.parse(raw); } catch { d = JSON.parse(JSON.parse(raw).contents); }
      const pageData = (d?.Data?.LSJZList || []).map(item => ({ date: item.FSRQ, nav: parseFloat(item.DWJZ) })).filter(item => !isNaN(item.nav));
      if (pageData.length === 0) break;
      allData = allData.concat(pageData);
      if (allData.length >= targetCount) break;
    } catch { break; }
  }
  return allData.reverse();
};

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
      if (fundSize) meta.push(fundSize.includes('亿') ? fundSize : fundSize + '亿' + (fundSize.includes('亿') ? '' : ''));
      if (manager) meta.push('经理:' + manager);
      if (maxDrawdown) meta.push('最大回撤:' + maxDrawdown);
      if (effectiveFee) meta.push('申购费:' + effectiveFee);
      const metaStr = meta.join(' | ');

      let output = `【基金名称】${fd.fd_name} (${fd.fd_code})\n`
        + `【基金类型】${typeDesc || '未知'}${riskLevel ? ' | 风险等级:' + riskLevel + '/5' : ''}\n`
        + `${metaStr ? '【基金概况】' + metaStr + '\n' : ''}【最新净值】${der.unit_nav || '未知'} (更新日期: ${der.end_date || '未知'})
【近1月】${der.nav_grl1m || '--'}% | 【近3月】${der.nav_grl3m || '--'}% | 【近6月】${der.nav_grl6m || '--'}%
【近1年】${der.nav_grl1y || '--'}% (同类排名: ${der.srank_l1y || '未知'}) | 【近3年】${der.nav_grl3y || '--'}% (同类排名: ${der.srank_l3y || '未知'})
【成立以来】${der.nav_grbase || '--'}%`;

      // 季报前十大持仓（从东方财富 fundf10 拉取）
      try {
        const hldUrl = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${ctx.args.fundCode}&topline=10`;
        const hldFUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
          ? buildProxyUrl(ctx.settings, hldUrl) : buildAllOriginsUrl(hldUrl);
        const hldRes = await fetch(hldFUrl, { signal: AbortSignal.timeout(8000) });
        const hldRaw = await hldRes.text();
        let hldText = ctx.settings.proxyMode === 'custom' ? hldRaw : (() => {
          try { return JSON.parse(hldRaw).contents; } catch { return hldRaw; }
        })();
        // 解析 HTML 表格行：<td>代码</td><td>名称</td>...<td>占净值%</td>
        const rowRe = /<tr[^>]*>[\s\S]*?<td[^>]*>\s*(\d{6})\s*<\/td>[\s\S]*?<td[^>]*>\s*<a[^>]*>([^<]+)<\/a>\s*<\/td>[\s\S]*?<td[^>]*>([\d.]+)%\s*<\/td>/gi;
        const holdings = [];
        let m;
        while ((m = rowRe.exec(hldText)) !== null) {
          holdings.push({ code: m[1], name: m[2].trim(), weight: parseFloat(m[3]) });
        }
        if (holdings.length > 0) {
          const top5 = holdings.slice(0, 10);
          output += `\n\n【前十大持仓(季报)】\n${top5.map(h => `  ${h.code} ${h.name} | ${h.weight.toFixed(1)}%`).join('\n')}`;
          const totalWeight = top5.reduce((s, h) => s + h.weight, 0);
          output += `\n  合计占净值: ${totalWeight.toFixed(1)}%`;
        }
      } catch (e) { /* 季报数据不可用 */ }

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
    const records = await fetchFundNavPages(ctx.args.fundCode, 40, ctx.settings);
    if (records.length > 0) {
      const dates = records.map(r => r.date.substring(5));
      const navs = records.map(r => r.nav);
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
    const formatted = items.map(n => '【' + (n.time||'未知时间') + '】' + n.title + '\n' + (n.content ? '  > ' + n.content : '') + (n.url ? '\n  🔗 ' + n.url : '')).join('\n\n');
    const output = '[系统物理防伪探针] 现在的真实时间是 ' + ctx.fullDateTimeStr + '。以上为' + source + '实时快讯的结构化数据。\n\n' + formatted;
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: '新浪财经快讯接口异常: ' + e.message + '。请改用搜索工具获取资讯。', pendingActions: [] };
  }
};

// ============================================================================
// 工具: fetch_article_content — 深度阅读
// ============================================================================
import { fetchArticleBatch } from '../article-fetcher';

const handleFetchArticleContent = async (ctx) => {
  try {
    const urls = (ctx.args.urls || []).slice(0, 3);
    if (urls.length === 0) return { output: '请提供至少1个URL。', pendingActions: [] };
    const results = await fetchArticleBatch(urls, ctx.settings);
    if (results.length === 0) return { output: '所有URL提取失败。可能原因: 网站反爬/超时/格式不支持。请用其他搜索工具获取替代信息。', pendingActions: [] };
    let output = `【深度阅读 — ${results.length}/${urls.length}篇提取成功】\n`;
    for (const r of results) {
      output += `\n📄 来源: ${r.url}\n${r.content}\n---\n`;
    }
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: `文章提取异常: ${e.message}`, pendingActions: [] };
  }
};

// ============================================================================
// 工具: worker_web_search — Worker 自主搜索+提取全文
// ============================================================================
const handleWorkerWebSearch = async (ctx) => {
  try {
    const { query, numResults = 3 } = ctx.args;
    if (!query) return { output: '请提供搜索关键词。', pendingActions: [] };
    const proxyUrl = (ctx.settings?.customProxyUrl || ctx.settings?.cfWorkerUrl || '').trim();
    if (!proxyUrl) return { output: 'Worker未配置。请在Settings中填写CF Worker URL。', pendingActions: [] };
    const base = proxyUrl.split('?')[0].replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (ctx.settings.workerSecret) headers['Authorization'] = `Bearer ${ctx.settings.workerSecret}`;
    const res = await fetch(`${base}/api/worker/search`, {
      method: 'POST', headers,
      body: JSON.stringify({ query, numResults: Math.min(numResults, 5) }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      return { output: `Worker 搜索 "${query}" 无结果。可能原因: 关键词过于具体/目标网站不可达/Serper Key未配置。请尝试换关键词或使用 google_macro_search。`, pendingActions: [] };
    }
    let output = `【Worker自搜 — "${query}" — ${data.results.length}篇全文】\n`;
    for (const r of data.results) {
      output += `\n📄 ${r.title}\n🔗 ${r.url}\n${r.content}\n---\n`;
    }
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: `Worker自搜异常: ${e.message}。降级使用 google_macro_search 或 tavily_news_search。`, pendingActions: [] };
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
  // 逐点 MACD，记录 DIF 序列用于背离检测
  let ema12v = closes.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let ema26v = closes.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  let dea = 0, dif = 0, macdBar = 0;
  const difHistory = [];  // [{dif, close, date}]
  for (let i = 26; i < closes.length; i++) {
    const k12 = 2 / 13, k26 = 2 / 27;
    ema12v = closes[i] * k12 + ema12v * (1 - k12);
    ema26v = closes[i] * k26 + ema26v * (1 - k26);
    dif = ema12v - ema26v;
    dea = dif * (2 / 10) + dea * (1 - 2 / 10);
    macdBar = (dif - dea) * 2;
    difHistory.push({ dif, macdBar, close: closes[i], date: klineData[i]?.date });
  }
  // 背离检测（近30根）
  let topDivergence = false, bottomDivergence = false;
  if (difHistory.length >= 30) {
    const recent = difHistory.slice(-30);
    // 顶背离：收盘价创新高 但 DIF 未创新高
    const maxClose = Math.max(...recent.map(d => d.close));
    const maxCloseIdx = recent.findIndex(d => d.close === maxClose);
    const difAtMaxClose = recent[maxCloseIdx]?.dif || 0;
    const maxDIFEarlier = Math.max(...recent.slice(0, Math.max(0, maxCloseIdx - 3)).map(d => d.dif));
    topDivergence = maxCloseIdx > 15 && difAtMaxClose < maxDIFEarlier;
    // 底背离：收盘价创新低 但 DIF 未创新低
    const minClose = Math.min(...recent.map(d => d.close));
    const minCloseIdx = recent.findIndex(d => d.close === minClose);
    const difAtMinClose = recent[minCloseIdx]?.dif || 0;
    const minDIFEarlier = Math.min(...recent.slice(0, Math.max(0, minCloseIdx - 3)).map(d => d.dif));
    bottomDivergence = minCloseIdx > 15 && difAtMinClose > minDIFEarlier;
  }
  return { dif: dif.toFixed(3), dea: dea.toFixed(3), macdBar: macdBar.toFixed(3), topDivergence, bottomDivergence, macdBarHistory: difHistory.map(d => d.macdBar) };
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
    if (/^\d{6}$/.test(code)) code = (code.startsWith('00') || code.startsWith('5') || code.startsWith('68') || code.startsWith('01')) ? 'sh'+code : 'sz'+code;
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

		      let rsiInfo = null, macdInfo = null, bbInfo = null;
	      if ((period === 'day' || period === 'week') && n >= 14) {
	        const atrInfo = calcATR(bars);
	        rsiInfo = calcRSI(bars);
	        macdInfo = calcMACD(bars);
	        bbInfo = calcBollingerBands(bars);
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

      // ── F1a 周线预判（上证周K,用真正的周线MACD）──
      if (period === "week" && code === "sh000001" && n >= 14) {
        try {
          const wCloses = bars.map(b => b.close);
          const wMA20 = wCloses.length >= 20 ? wCloses.slice(-20).reduce((a,b)=>a+b,0)/20 : wCloses.reduce((a,b)=>a+b,0)/wCloses.length;
          const lp = wCloses[wCloses.length-1];

          // 内联拉取 PE 分位（通过共享 data-fetcher）
          let pePercentile = null;
          try {
            const valItems = await fetchDanjuanIndexValuation(ctx.settings);
            const shItem = (valItems || []).find(i => {
              const ic = (i.index_code || i.code || '').toUpperCase();
              return ic === '000001' || ic === 'SH000001' || ic === 'CSI000001' || (i.name || '').includes('上证');
            });
            if (shItem) pePercentile = parseFloat(shItem.pe_percentile || shItem.pePercentile);
          } catch (e) { /* 保持 null，classifyF1a 自动跳过依赖 PE 的档位 */ }

          // 内联拉取月K位置
          let monthlyPosition = undefined, monthlyTopDivergence = false;
          try {
            const mUrl = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=sh000001,month,,,12,`;
            const mFUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
              ? buildProxyUrl(ctx.settings, mUrl) : buildAllOriginsUrl(mUrl);
            const mRes = await fetch(mFUrl, { signal: AbortSignal.timeout(8000) });
            const mData = await mRes.json();
            const mBars = (mData?.data?.['sh000001']?.month || []).map(k => ({
              open: parseFloat(k[1]), close: parseFloat(k[2]), high: parseFloat(k[3]), low: parseFloat(k[4])
            })).filter(b => !isNaN(b.close));
            if (mBars.length >= 6) {
              const mCloses = mBars.map(b => b.close);
              const mSMA = mCloses.reduce((a,b)=>a+b,0)/mCloses.length;
              const mVariance = mCloses.reduce((s,c)=>s+(c-mSMA)**2,0)/mCloses.length;
              const mStd = Math.sqrt(mVariance);
              const mUpper = mSMA + 2*mStd, mLower = mSMA - 2*mStd;
              if (lp >= mUpper*0.95) monthlyPosition = 'upper';
              else if (lp <= mLower*1.05) monthlyPosition = 'lower';
              else monthlyPosition = 'middle';
              monthlyTopDivergence = monthlyPosition === 'upper' && (macdInfo?.topDivergence || false);
            }
          } catch (e) { /* 保持 undefined */ }

          const hasWeeklyBollingerSqueeze = bbInfo?.squeeze?.includes("极窄") || (bbInfo?.bandwidth && parseFloat(bbInfo.bandwidth) < 2.5);
          // 周K高位滞涨：价格在布林上轨85%以上 + MACD柱缩量（当前柱 < 近5根均值的30%）
          let weeklyHighStall = false;
          if (bbInfo && lp >= parseFloat(bbInfo.upper) * 0.85 && macdInfo?.macdBarHistory?.length >= 5) {
            const recentBars = macdInfo.macdBarHistory.slice(-5);
            const avgRecentBar = recentBars.reduce((a, b) => a + Math.abs(b), 0) / recentBars.length;
            weeklyHighStall = avgRecentBar > 0.001 && Math.abs(parseFloat(macdInfo.macdBar)) < avgRecentBar * 0.3;
          }

          const r = classifyF1a({
            price: lp, dailyMA20: wMA20, dailyMA60: wMA20,
            weeklyMA20: wMA20,
            weeklyMACDGoldenCross: macdInfo?.dif > macdInfo?.dea && macdInfo?.dea > 0,
            weeklyMACDDeadCross: macdInfo?.dif < macdInfo?.dea && macdInfo?.dea < 0,
            weeklyTopDivergence: macdInfo?.topDivergence || false,
            weeklyBottomDivergence: macdInfo?.bottomDivergence || rsiInfo?.divergence?.includes("底背离") || false,
            weeklyBollinger: bbInfo ? { upper: bbInfo.upper, middle: bbInfo.middle, lower: bbInfo.lower,
              bandwidth: bbInfo.bandwidth, bwPercentile: bbInfo.bwPercentile, squeeze: hasWeeklyBollingerSqueeze } : null,
            pePercentile,
            monthlyPosition,
            monthlyTopDivergence,
            dailyCenterUp: false, dailyCenterDown: false,
            weeklyHighStall,
            dailyMA20Turning: false
          });
          logDecisionTree('F1a 上证宏观赔率 [周线·正版]', { price: lp, pePercentile, monthlyPosition, weeklyTopDivergence: macdInfo?.topDivergence }, r);
          const f1aWkCtx = formatWeightedContribution(r.baseScore, 'F1a', ctx.settings);
          output += `\n\n【上证 F1a 周线预判(真实周线MACD)】\n档位: ${r.category}\n基础分: ${r.baseScore}/20 (可调范围 ${r.scoreRange[0]}-${r.scoreRange[1]})${f1aWkCtx.text}\n置信度: ${r.confidence}\n关键信号: ${r.keySignals.join(" / ")}`;
          if (r.overrides) output += `\n⚠️ 覆盖标记: ${JSON.stringify(r.overrides)}`;
        } catch(e) {}
      }

      // ── 决策树打分（日线：上证→F1a+F2+Markov, 创业板→F1b+F2）──
      if (period === "day" && n >= 20 && (code === "sh000001" || code === "sz399006")) {
        try {
          const closes2 = bars.map(b => b.close);
          const dMA20 = closes2.length >= 20 ? closes2.slice(-20).reduce((a,b)=>a+b,0)/20 : closes2.reduce((a,b)=>a+b,0)/closes2.length;
          const dMA60 = closes2.length >= 60 ? closes2.slice(-60).reduce((a,b)=>a+b,0)/60 : dMA20;
          const lp = closes2[closes2.length-1];
          const isSH = code === "sh000001";

          if (isSH) {
            const r5 = closes2.slice(-5);
            const o5 = closes2.slice(-10, -5).length > 0 ? closes2.slice(-10, -5) : closes2.slice(-5, -1);
            const dUp = r5.reduce((a,b)=>a+b,0)/r5.length > o5.reduce((a,b)=>a+b,0)/o5.length;
            let dTurn = false;
            if (closes2.length >= 25) {
              const ms = [];
              for (let i=19;i<closes2.length;i++) ms.push(closes2.slice(i-19,i+1).reduce((a,b)=>a+b,0)/20);
              if (ms.length>=3) dTurn = ms[ms.length-1] >= ms[ms.length-2] && ms[ms.length-2] <= ms[ms.length-3];
            }
            const r = classifyF1a({
              price:lp, dailyMA20:dMA20, dailyMA60:dMA60, weeklyMA20: null,
              weeklyMACDGoldenCross: macdInfo?.dif > macdInfo?.dea && macdInfo?.dea > 0,
              weeklyMACDDeadCross: macdInfo?.dif < macdInfo?.dea,
              weeklyTopDivergence: macdInfo?.topDivergence || false, weeklyBottomDivergence: macdInfo?.bottomDivergence || rsiInfo?.divergence?.includes("底背离") || false,
              weeklyBollinger: bbInfo ? { upper: bbInfo.upper, middle: bbInfo.middle, lower: bbInfo.lower,
                bandwidth: bbInfo.bandwidth, bwPercentile: bbInfo.bwPercentile,
                squeeze: bbInfo.squeeze?.includes("极窄") || (bbInfo.bandwidth && parseFloat(bbInfo.bandwidth) < 2.5) } : null,
              pePercentile: null, monthlyPosition: undefined, monthlyTopDivergence: false,
              dailyCenterUp:dUp, dailyCenterDown:!dUp, weeklyHighStall: false, dailyMA20Turning:dTurn
            });
            logDecisionTree('F1a 上证宏观赔率 [日线·近似]', { price:lp, dailyMA20:dMA20, dailyMA60:dMA60 }, r);
            const f1aDayCtx = formatWeightedContribution(r.baseScore, 'F1a', ctx.settings);
            output += `\n\n【上证 F1a 日线近似(以周线为准)】\n档位: ${r.category}\n基础分: ${r.baseScore}/20 (可调范围 ${r.scoreRange[0]}-${r.scoreRange[1]})${f1aDayCtx.text}\n置信度: ${r.confidence}\n关键信号: ${r.keySignals.join(" / ")} | 日线MACD作周线代理\n📋 多周期一致性: 日线与周线方向矛盾(日≥12+周<8 或 日<9+周≥14)→标注多周期背离`;
            if (r.overrides) output += `\n⚠️ 覆盖标记: ${JSON.stringify(r.overrides)}`;
          } else {
            // 计算 synchWithSH + 相关系数：内联拉取上证K线
            let synchWithSH = false;
            let correlationWithSH = null;
            try {
              const shUrl = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=sh000001,day,,,25,`;
              const shFUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl
                ? buildProxyUrl(ctx.settings, shUrl) : buildAllOriginsUrl(shUrl);
              const shRes = await fetch(shFUrl, { signal: AbortSignal.timeout(8000) });
              const shData = await shRes.json();
              const shBars = (shData?.data?.['sh000001']?.day || []).map(k => parseFloat(k[2])).filter(v => !isNaN(v));
              // 方向同步判定
              if (shBars.length >= 5 && closes2.length >= 5) {
                const shDir = shBars[shBars.length - 1] > shBars[shBars.length - 5] ? 'up' : 'down';
                const cybDir = closes2[closes2.length - 1] > closes2[closes2.length - 5] ? 'up' : 'down';
                synchWithSH = shDir === cybDir;
              }
              // Pearson 相关系数（近20日日收益率）
              if (shBars.length >= 10 && closes2.length >= 10) {
                const n = Math.min(shBars.length, closes2.length, 21);
                const shClose = shBars.slice(-n);
                const cybClose = closes2.slice(-n);
                const shRet = [], cybRet = [];
                for (let i = 1; i < n; i++) {
                  shRet.push((shClose[i] - shClose[i-1]) / shClose[i-1]);
                  cybRet.push((cybClose[i] - cybClose[i-1]) / cybClose[i-1]);
                }
                const m = shRet.length;
                const meanSh = shRet.reduce((a, b) => a + b, 0) / m;
                const meanCyb = cybRet.reduce((a, b) => a + b, 0) / m;
                let num = 0, denomSh = 0, denomCyb = 0;
                for (let i = 0; i < m; i++) {
                  const dSh = shRet[i] - meanSh;
                  const dCyb = cybRet[i] - meanCyb;
                  num += dSh * dCyb;
                  denomSh += dSh * dSh;
                  denomCyb += dCyb * dCyb;
                }
                const denom = Math.sqrt(denomSh * denomCyb);
                correlationWithSH = denom > 0 ? Math.round(num / denom * 100) / 100 : 0;
              }
            } catch (e) {}

            // 日K MACD 顶背离实时检测（来自 calcMACD 30日背离检测）
            const dailyTopDiv = macdInfo?.topDivergence || false;
            const dailyBotDiv = macdInfo?.bottomDivergence || false;
            const r = classifyF1b({
              price:lp, dailyMA60:dMA60, weeklyMA20: null,
              weeklyMACD:{dif:macdInfo?.dif||0,dea:macdInfo?.dea||0,goldenCross:macdInfo?.dif>macdInfo?.dea&&macdInfo?.dea>0,topDivergence:false,bottomDivergence:rsiInfo?.divergence?.includes("底背离")||dailyBotDiv},
              bollinger: bbInfo?{...bbInfo,squeeze:bbInfo.squeeze?.includes("极窄")}:null,
              dailyTopDivergence:dailyTopDiv, synchWithSH,
              correlationWithSH
            });
            logDecisionTree('F1b 双创风格校验', { price:lp, dailyMA60:dMA60, synchWithSH, correlationWithSH, dailyTopDivergence:dailyTopDiv }, r);
            const f1bCtx = formatWeightedContribution(r.baseScore, 'F1b', ctx.settings);
            output += `\n\n【创业板 F1b 决策树计算】\n档位: ${r.category}\n基础分: ${r.baseScore}/15 (可调范围 ${r.scoreRange[0]}-${r.scoreRange[1]})${f1bCtx.text}\n置信度: ${r.confidence}\n关键信号: ${r.keySignals.join(" / ")}`;
            if (r.overrides) output += `\n⚠️ 覆盖标记: ${JSON.stringify(r.overrides)}`;
          }

          // F2
          if (bbInfo && bars.length >= 5) {
            const dv20 = dMA20>0?((lp-dMA20)/dMA20*100):0;
            const dv60 = dMA60>0?((lp-dMA60)/dMA60*100):0;
            const tb = bbInfo && lp <= parseFloat(bbInfo.lower)*1.01;
            let dd=0; for (let i=bars.length-1;i>=0&&bars[i].close<bars[i].open;i--)dd++;
            const lb=bars[bars.length-1];
            const amp=lb.open>0?((lb.high-lb.low)/lb.open*100):0;
            const tp=lb.close<lb.open&&(lb.close-lb.low)<(lb.high-lb.open)*0.3;
            const vols=bars.slice(-5).map(b=>b.volume).filter(v=>v>0);
            const vUp=vols.length>=2&&vols[vols.length-1]>vols.slice(0,-1).reduce((a,b)=>a+b,0)/(vols.length-1);

            // 深V：日K长下影阳线 + 前日阴线
            const prevBar = bars.length >= 2 ? bars[bars.length - 2] : null;
            const todayLowerShadow = lb.open > 0 ? (Math.min(lb.open, lb.close) - lb.low) / lb.open * 100 : 0;
            const todayEntity = lb.open > 0 ? Math.abs((lb.close - lb.open) / lb.open * 100) : 0;
            const deepV = lb.close >= lb.open && todayLowerShadow > Math.max(todayEntity * 1.5, 0.8)
              && prevBar && prevBar.close < prevBar.open;
            // 分时企稳：振幅<1.5% 或收阳+下影占振幅>60%
            const intraStable = amp < 1.5 || (lb.close >= lb.open && todayLowerShadow > amp * 0.6);
            // 跌幅收窄：连跌≥3+最近3日跌幅逐日缩小。dd<3→undefined避免误判
            let declineNarrowing;
            if (dd >= 3) { const l3=bars.slice(-3); const dr=l3.map(b=>b.open>0?(b.close-b.open)/b.open*100:0); declineNarrowing=dr[2]>dr[1]&&dr[1]>dr[0]&&dr[0]<0; }

            const r=classifyF2({deviation20d:dv20,deviation60d:dv60,isChuangYe:!isSH,touchBollLower:tb,consecutiveDownDays:dd,deepV,volumeUp:vUp,intradayStable:intraStable,declineNarrowing,amplitude:amp,topPattern:tp,rsiBottomDivergence:rsiInfo?.divergence?.includes("底背离"),bollLowerRSILow:tb&&(rsiInfo?.rsi||50)<30});
            logDecisionTree(`F2 微观反转 [${isSH?"上证":"创业板"}]`, {deviation20d:dv20,deviation60d:dv60,isChuangYe:!isSH,deepV,volumeUp:vUp,consecutiveDownDays:dd}, r);
            const f2Ctx = formatWeightedContribution(r.baseScore, 'F2', ctx.settings);
            output += `\n\n【${isSH?"上证":"创业板"} F2 决策树计算】\n档位: ${r.category}\n基础分: ${r.baseScore}/25 (可调范围 ${r.scoreRange[0]}-${r.scoreRange[1]})${f2Ctx.text}\n置信度: ${r.confidence}\n关键信号: ${r.keySignals.join(" / ")}`;
            if (r.overrides) output += `\n⚠️ 覆盖标记: ${JSON.stringify(r.overrides)}`;
          }

          // Markov (上证>=60)
          if (isSH && bars.length >= 60) {
            try {
              const rets=[]; for (let i=1;i<bars.length;i++) if (bars[i-1].close>0) rets.push((bars[i].close-bars[i-1].close)/bars[i-1].close);
              if (rets.length>=50) {
                const T=rets.length,sr=[...rets].sort((a,b)=>a-b);
                const q1=sr[Math.floor(T*0.25)],q3=sr[Math.floor(T*0.75)];
                const lo=rets.filter(r=>r>=q1&&r<=q3),hi=rets.filter(r=>r<q1||r>q3);
                const muM=[lo.length>0?lo.reduce((a,b)=>a+b,0)/lo.length:0,hi.length>0?hi.reduce((a,b)=>a+b,0)/hi.length:0];
                const sigM=[lo.length>0?Math.sqrt(lo.reduce((s,r)=>s+(r-muM[0])**2,0)/lo.length):0.005,hi.length>0?Math.sqrt(hi.reduce((s,r)=>s+(r-muM[1])**2,0)/hi.length):0.015];
                const al=Array.from({length:T},()=>[0,0]);
                for(let k=0;k<2;k++){const d=(rets[0]-muM[k])/sigM[k];al[0][k]=0.5*Math.exp(-0.5*d*d)/(Math.sqrt(2*Math.PI)*sigM[k]);}
                let sM=al[0][0]+al[0][1];if(sM>0)al[0]=al[0].map(v=>v/sM);
                for(let t=1;t<T;t++){for(let j=0;j<2;j++){let sm=0;for(let i=0;i<2;i++)sm+=al[t-1][i]*(i===j?0.9:0.1);const d=(rets[t]-muM[j])/sigM[j];al[t][j]=sm*Math.exp(-0.5*d*d)/(Math.sqrt(2*Math.PI)*sigM[j]);}sM=al[t][0]+al[t][1];if(sM>0)al[t]=al[t].map(v=>v/sM);}
                const p=al[T-1];
                output += `\n\n【Markov 机制转移预判】\n低波制式=${(p[0]*100).toFixed(0)}% 高波制式=${(p[1]*100).toFixed(0)}% | 低波μ=${(muM[0]*100).toFixed(2)}% 高波μ=${(muM[1]*100).toFixed(2)}%`;
              }
            } catch(e){}
          }
        } catch (e) {}
      }

      // ── 纯债 F1/F2 预判（国债ETF日K）──
      if (period === "day" && (code === "sh511260" || code === "sh511090") && n >= 20) {
        try {
          const bCloses = bars.map(b => b.close);
          const bMA20 = bCloses.length >= 20 ? bCloses.slice(-20).reduce((a,b)=>a+b,0)/20 : bCloses.reduce((a,b)=>a+b,0)/bCloses.length;
          const bMA60 = bCloses.length >= 60 ? bCloses.slice(-60).reduce((a,b)=>a+b,0)/60 : bMA20;
          const bLP = bCloses[bCloses.length-1];
          const bMonthlyPos = bLP > bMA60 * 1.05 ? 'upper' : bLP < bMA60 * 0.95 ? 'lower' : 'middle';

          // 从Worker获取实时收益率数据（非阻塞）
          let bondYieldData = { yield10Y: null, yield10YChange: null };
          try {
            const wUrl = (ctx.settings?.customProxyUrl || ctx.settings?.cfWorkerUrl || '').trim();
            if (wUrl) {
              const base = wUrl.split('?')[0].replace(/\/+$/, '');
              const headers = {};
              if (ctx.settings.workerSecret) headers['Authorization'] = `Bearer ${ctx.settings.workerSecret}`;
              const yRes = await fetch(`${base}/api/bond-yields`, { headers, signal: AbortSignal.timeout(5000) });
              if (yRes.ok) {
                const yData = await yRes.json();
                if (yData.y10 != null) bondYieldData.yield10Y = yData.y10;
              }
            }
          } catch (e) { /* 收益率获取失败不影响主流程 */ }

          const bondF1 = classifyBondF1({
            price: bLP,
            weeklyMA20: bMA20,
            monthlyMA60: bMA60,
            weeklyBollinger: bbInfo ? { upper: bbInfo.upper, middle: bbInfo.middle, lower: bbInfo.lower, bandwidth: bbInfo.bandwidth } : null,
            yield10Y: bondYieldData.yield10Y,
            yield10YChange: bondYieldData.yield10YChange,
            monthlyPosition: bMonthlyPos
          });
          logDecisionTree('纯债 F1 宏观利率水位', { price: bLP, monthlyPosition: bMonthlyPos, yield10Y: bondYieldData.yield10Y }, bondF1);
          output += `\n\n【纯债 F1 决策树计算】\n档位: ${bondF1.category}\n基础分: ${bondF1.baseScore}/50 (可调范围 ${bondF1.scoreRange[0]}-${bondF1.scoreRange[1]})\n置信度: ${bondF1.confidence}`;

          // F2 股债跷跷板 — 自动拉取 A 股涨跌 + 信用利差（全自动，无需 LLM 补充）
          const bChange = bars.length >= 2 && bars[bars.length-2].close > 0
            ? (bLP - bars[bars.length-2].close) / bars[bars.length-2].close * 100 : 0;
          let stockChange = 0, vr = 1.0, creditDir = 'stable';
          try {
            // 拉取上证指数最新涨跌幅
            const shQuote = await fetchTencentQuotes('sh000001', ctx.settings);
            if (shQuote) {
              const shParts = shQuote.split('~');
              if (shParts.length > 32) {
                const shPrice = parseFloat(shParts[3]);
                const shPrevClose = parseFloat(shParts[4]);
                if (shPrevClose > 0) stockChange = (shPrice - shPrevClose) / shPrevClose * 100;
              }
            }
          } catch(e) { /* 保持 stockChange=0 */ }
          try {
            // 拉取信用利差方向
            const spread = await fetchBondSpread(ctx.settings);
            if (spread) creditDir = spread.direction;
          } catch(e) { /* 保持 stable */ }
          // VR 从 F3 预判块读取（已在上下文中），此处尝试从 Firestore 近5日成交额定额
          try {
            const { db, userId, appId } = ctx.firestoreContext || {};
            if (db && userId && appId) {
              const sinceD = new Date(); sinceD.setDate(sinceD.getDate() - 14);
              const vrQ = query(collection(db, 'artifacts', appId, 'users', userId, 'scoring_snapshots'),
                where('date', '>=', sinceD.toISOString().split('T')[0]), orderBy('date', 'desc'), limit(6));
              const vrSnap = await getDocs(vrQ);
              const today = new Date().toISOString().split('T')[0];
              const recentT = [];
              vrSnap.forEach(doc => { const d = doc.data(); if (d.turnoverYi && d.date !== today) recentT.push(d.turnoverYi); });
              if (recentT.length >= 3) {
                const avg5 = recentT.slice(0,5).reduce((a,b)=>a+b,0)/Math.min(recentT.length,5);
                // 今日成交额需要从上下文取，此处用最近值近似；VR 仅作近似值供 JS 预判
                vr = recentT[0] / avg5;
              }
            }
          } catch(e) { /* 保持 vr=1.0 */ }
          const bondF2 = classifyBondF2({
            stockChange,
            bondETFChange: bChange,
            VR: vr,
            creditSpreadDirection: creditDir
          });
          logDecisionTree('纯债 F2 股债跷跷板', { stockChange, bondETFChange: bChange, VR: vr, creditSpreadDirection: creditDir }, bondF2);
          output += `\n\n【纯债 F2 决策树计算 — 全自动】\n档位: ${bondF2.category}\n基础分: ${bondF2.baseScore}/50 (可调范围 ${bondF2.scoreRange[0]}-${bondF2.scoreRange[1]})\n置信度: ${bondF2.confidence}\n输入: A股${stockChange>=0?'+':''}${stockChange.toFixed(2)}% | 国债ETF${bChange>=0?'+':''}${bChange.toFixed(2)}% | VR≈${vr.toFixed(2)} | 利差=${creditDir}`;
        } catch(e) {}
      }

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
    let f4Out = '';
    try {
      const gd = (pct, threshold = 0.1) => pct > threshold ? 'up' : pct < -threshold ? 'down' : 'stable';
      let rmb='stable',cu='stable',oil='stable',gold='stable';
      for (const p of parts) {
        const pm = p.match(/\(([+-]?[\d.]+)%\)/);
        const pct = pm ? parseFloat(pm[1]) : 0;
        if (p.includes('USDCNY')) rmb = pct > 0.15 ? 'down' : pct < -0.15 ? 'up' : 'stable';
        else if (p.includes('黄金')||p.includes('AU')) gold = gd(pct, 0.1);
        else if (p.includes('铜')||p.includes('CU')) cu = gd(pct, 0.2);
        else if (p.includes('原油')||p.includes('SC')||p.includes('油')) oil = gd(pct, 0.3);
      }

      // 内联获取信用利差方向（通过共享 data-fetcher）
      let creditSpread = 'stable';
      try {
        const spread = await fetchBondSpread(ctx.settings);
        if (spread) creditSpread = spread.direction;
      } catch (e) { /* 保持 'stable' */ }

      const fr = classifyF4({ rmb, copper: cu, oil, gold, creditSpread });
      logDecisionTree('F4 跨资产确认', { rmb, 铜: cu, 油: oil, 金: gold, 信用利差: creditSpread }, fr);
      const f4Ctx = formatWeightedContribution(fr.baseScore, 'F4', ctx.settings);
      f4Out = `\n\n【F4 跨资产决策树计算】\n档位: ${fr.category}\n基础分: ${fr.baseScore}/15 (可调范围 ${fr.scoreRange[0]}-${fr.scoreRange[1]})${f4Ctx.text}\n信号: RMB=${rmb} 铜=${cu} 油=${oil} 金=${gold} 利差=${creditSpread}`;
      if (fr.overrides) f4Out += `\n⚠️ 覆盖标记: ${JSON.stringify(fr.overrides)}`;
    } catch(e){}
    return {
      output: `【国内跨资产宏观快照】\n${parts.join('\n')}\n\n📌 USD/CNY↑=人民币贬值 | 铜↑=复苏 | 原油↑=通胀 | 黄金↑=避险\n👉 隔夜外盘(美股/VIX)数据已在上下文中注入,直接读取即可,无需重复调用。${f4Out}`,
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
      const spread = await fetchBondSpread(ctx.settings);
      if (spread) {
        const { govPct, corpPct, spreadVal } = spread;
        const signal = spreadVal>0.05 ? '🔥 信用利差大幅收窄' : spreadVal>0.01 ? '✅ 温和收窄' : spreadVal<-0.05 ? '🚨 大幅走阔' : spreadVal<-0.01 ? '⚠️ 温和走阔' : '➖ 稳定';
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
    // M2 同比
    try {
      const m2Url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_M2&columns=ALL&pageNumber=1&pageSize=1&sortColumns=REPORT_DATE&sortTypes=-1`;
      let m2FetchUrl = buildProxyUrl(ctx.settings, m2Url);
      if (ctx.settings.proxyMode !== 'custom' || !ctx.settings.customProxyUrl) m2FetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(m2Url)}`;
      const m2Res = await fetch(m2FetchUrl, { cache: 'no-store' });
      const m2Raw = await m2Res.text();
      let m2d; try { m2d=JSON.parse(m2Raw); } catch(e) { if(m2Raw.includes('contents')){ const w=JSON.parse(m2Raw); m2d=typeof w.contents==='string'?JSON.parse(w.contents):w.contents; } }
      const m2Item = m2d?.result?.data?.[0];
      if (m2Item) indicators.push(`M2 同比: ${m2Item.BASIC_CURRENCY||m2Item.M2||'未知'}% | 日期: ${m2Item.REPORT_DATE||'未知'}`);
    } catch(e) {}
    // 社融增量
    try {
      const sfUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_ECONOMY_SOCIAL_FINANCING&columns=ALL&pageNumber=1&pageSize=1&sortColumns=REPORT_DATE&sortTypes=-1`;
      let sfFetchUrl = buildProxyUrl(ctx.settings, sfUrl);
      if (ctx.settings.proxyMode !== 'custom' || !ctx.settings.customProxyUrl) sfFetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(sfUrl)}`;
      const sfRes = await fetch(sfFetchUrl, { cache: 'no-store' });
      const sfRaw = await sfRes.text();
      let sfd; try { sfd=JSON.parse(sfRaw); } catch(e) { if(sfRaw.includes('contents')){ const w=JSON.parse(sfRaw); sfd=typeof w.contents==='string'?JSON.parse(w.contents):w.contents; } }
      const sfItem = sfd?.result?.data?.[0];
      if (sfItem) indicators.push(`社融增量: ${sfItem.SOCIAL_FINANCING||sfItem.TOTAL_AMOUNT||'未知'}亿元 | 日期: ${sfItem.REPORT_DATE||'未知'}`);
    } catch(e) {}
    return { output: `【宏观经济指标快照】\n\n${indicators.join('\n\n')}\n\n📌 CPI<2%=低通胀 | PMI>50=经济扩张 | M2↑=宽货币 | 社融↑=宽信用`, pendingActions: [] };
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
    const q = query(snapshotsRef, where('date', '>=', sinceDate.toISOString().split('T')[0]), orderBy('date', 'desc'), limit(10));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return { output: `近 ${days} 天内无历史打分记录。动量修正=0，滞回锁定不触发。`, pendingActions: [] };
    let output = `【打分快照查询结果 — 近 ${days} 天历史】\n`;
    output += `格式: 日期 | 权益分(F1a/F1b/F2/F3/F4→最终) | 固收分 | CIO | 量价 | P&L\n`;
    snapshot.forEach(doc => {
      const s = doc.data();
      const timeStr = s.createdAt ? new Date(s.createdAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
      let line = `\n${s.date}${timeStr ? ' '+timeStr : ''} | `;
      if (s.equity) {
        const f1a = s.equity.F1a ?? (s.equity.F1 != null ? Math.round(s.equity.F1 * 20/35) : '?');
        const f1b = s.equity.F1b ?? (s.equity.F1 != null ? Math.round(s.equity.F1 * 15/35) : '?');
        line += `权益 F1a=${f1a}/20 F1b=${f1b}/15 F2=${s.equity.F2} F3=${s.equity.F3} F4=${s.equity.F4}→${s.equity.final}`;
        if (s.equity.f3Flags) line += `(${s.equity.f3Flags})`;
        if (s.equity.turnoverYi) line += ` | 成交${s.equity.turnoverYi}亿 ↑${s.equity.upCount??'?'}/↓${s.equity.downCount??'?'}`;
      }
      if (s.bond) line += ` | 固收 F1=${s.bond.F1} F2=${s.bond.F2}→${s.bond.final}`;
      if (s.verdict) {
        const el = s.verdict.equityHysteresis ? '🔒权益' : '';
        const bl = s.verdict.bondHysteresis ? '🔒固收' : '';
        const hyst = (el || bl) ? ` ${el}${el&&bl?' ':''}${bl}` : (s.verdict.hysteresisActive ? ' 🔒滞回' : '');
        line += ` | CIO:${s.verdict.equityAction}${s.verdict.bondAction?' '+s.verdict.bondAction:''}${hyst}`;
      }
      if (s.totalValue) line += ` | 市值${(s.totalValue/10000).toFixed(1)}万`;
      if (s.totalProfit != null) {
        const sign = s.totalProfit >= 0 ? '+' : '';
        line += ` 盈亏${sign}${Math.round(s.totalProfit).toLocaleString()}`;
      }
      if (s.overallXirr != null) line += ` XIRR=${(s.overallXirr*100).toFixed(1)}%`;
      if (s.northbound?.totalNet != null) {
        const nb = s.northbound;
        const nbDir = nb.totalNet >= 0 ? '流入' : '流出';
        line += ` | 北向: ${nbDir}${Math.abs(nb.totalNet).toFixed(0)}亿`;
      }
      output += line + '\n';
    });
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: `打分快照查询异常: ${e.message}。跳过动量修正。`, pendingActions: [] };
  }
};

const handleStoreScoringSnapshot = async (ctx) => {
  // 直接写 Firestore（不依赖 pendingAction 链路）
  const { db, userId, appId } = ctx.firestoreContext || {};
  if (db && userId && appId) {
    try {
      const safeDate = (ctx.args.date || new Date().toISOString().split('T')[0]).replace(/\//g, '-');
      const snapRef = doc(db, 'artifacts', appId, 'users', userId, 'scoring_snapshots', safeDate);
      const eqRaw = ctx.args.equity || null;
      // 规范化 F1a/F1b 拆分（兼容 LLM 只传 F1 的旧格式）
      let equity = eqRaw;
      if (eqRaw && (eqRaw.F1a == null || eqRaw.F1b == null)) {
        const f1total = eqRaw.F1 ?? ((eqRaw.F1a ?? 0) + (eqRaw.F1b ?? 0));
        equity = {
          ...eqRaw,
          F1a: eqRaw.F1a ?? Math.round(f1total * 20 / 35),
          F1b: eqRaw.F1b ?? Math.round(f1total * 15 / 35),
          F1: f1total
        };
      }
      await setDoc(snapRef, {
        date: safeDate,
        createdAt: new Date().toISOString(),
        equity,
        bond: ctx.args.bond || null,
        verdict: ctx.args.verdict || null,
        totalValue: ctx.args.totalValue ?? null,
        totalProfit: ctx.args.totalProfit ?? null,
        overallXirr: ctx.args.overallXirr ?? null,
        turnoverYi: ctx.args.equity?.turnoverYi ?? null,
        upCount: ctx.args.equity?.upCount ?? null,
        downCount: ctx.args.equity?.downCount ?? null,
        northbound: ctx.args.northbound || null  // { shNet, szNet, totalNet } 北向资金
      }, { merge: true });
    } catch (e) {
      console.warn('[打分快照] Firestore 写入失败:', e.message);
    }

    // Track B: 自适应引擎 — 静默执行，不干扰 LLM 的 run_backtest
    try {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - 90);  // 90天 ≈ 60交易日, 确保 OLS 能积累 ≥30 条样本
      const snapshotsRef = collection(db, 'artifacts', appId, 'users', userId, 'scoring_snapshots');
      const q = query(snapshotsRef,
        where('date', '>=', sinceDate.toISOString().split('T')[0]),
        orderBy('date', 'asc'),
        limit(60));
      const snapshot = await getDocs(q);
      const scoreHistory = [];
      snapshot.forEach(doc => {
        const s = doc.data();
        if (s.equity) scoreHistory.push({ date: s.date, equity: s.equity, bond: s.bond || null });
      });

      if (scoreHistory.length >= 10) {
        // 并行拉取三指数K线，构建完整 marketData
        const klineDays = 120;
        const [shRes, cybRes, szRes] = await Promise.allSettled([
          fetchIndexKlines('sh000001', ctx.settings, klineDays),
          fetchIndexKlines('sz399006', ctx.settings, klineDays),
          fetchIndexKlines('sz399001', ctx.settings, klineDays)
        ]);
        const shKlines = shRes.status === 'fulfilled' ? shRes.value : [];
        const cybKlines = cybRes.status === 'fulfilled' ? cybRes.value : [];
        const szKlines = szRes.status === 'fulfilled' ? szRes.value : [];

        const marketData = mergeMultiIndexKlines(shKlines, cybKlines, szKlines);

        const { runAutoTune } = await import('../../quant/auto-tuner');
        runAutoTune({ db, userId, appId }, ctx.settings, scoreHistory, marketData)
          .catch(e => console.warn('[AutoTune] 静默失败:', e.message));

        // Track B2: Meta-Vigilance — 静默自检，不干扰 LLM
        try {
          const mvResult = metaVigilanceCheck(scoreHistory, marketData, 15);
          if (mvResult.warning) {
            // 写入 Firestore 告警标记，下次对话通过 alerts 注入
            const settingsRef = doc(db, 'artifacts', appId, 'users', userId, 'settings', 'general');
            await setDoc(settingsRef, {
              metaVigilanceWarning: mvResult.message,
              metaVigilanceAt: new Date().toISOString()
            }, { merge: true });
          }
        } catch (e) { /* Meta-Vigilance 失败不影响主流程 */ }
      }
    } catch (e) { /* Track B 失败不影响主流程 */ }
  }
  return {
    output: '【系统提示】打分快照已保存到云端存储。',
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
    // 根据基金名称推断合适基准（纯债→国债指数，QDII→纳指，其余→上证）
    const fundName = (ctx.args.fundName || ctx.portfolioStats?.computedFundsWithMetrics?.find(f => (f.fundCode || '').trim() === fundCode)?.name || '');
    const getDefaultBenchmark = (name) => {
      if (name.includes('债') || name.includes('货币')) return 'sh000012';
      if (name.toLowerCase().includes('qdii') || name.includes('纳斯达克') || name.includes('标普')) return 'us.IXIC';
      return 'sh000001';
    };
    const benchmarkCode = ctx.args.benchmark || getDefaultBenchmark(fundName);

    // 获取基金历史净值（翻页,API每页固定20条）
    const navList = await fetchFundNavPages(fundCode, 120, ctx.settings);
    if (navList.length < 10) return { output: `净值数据不足（仅${navList.length}日，需≥10日），无法计算风险指标。`, pendingActions: [] };
    const dataNote = navList.length < 30 ? ` ⚠️仅${navList.length}个交易日,统计估计不稳定` : '';

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

    let output = `【基金 ${fundCode} 风险指标 — ${navList.length}个交易日】${dataNote}\n\n`;
    output += `📈 收益指标\n`;
    output += `年化收益: ${(annualReturn*100).toFixed(2)}% | 年化波动: ${(annualVol*100).toFixed(2)}% | Sharpe: ${sharpe.toFixed(2)}\n\n`;
    output += `📉 风险指标\n`;
    output += `最大回撤(MDD): -${(mdd*100).toFixed(2)}% (${mddStart}→${mddEnd}) | 恢复天数: ${recoveryDays}天\n\n`;
    // 上行/下行捕获率 + Jensen's alpha
    let upCapture = 0, downCapture = 0, jensensAlpha = 0;
    if (benchmarkReturns.length > 0) {
      const minLen = Math.min(dailyReturns.length, benchmarkReturns.length);
      const fundR = dailyReturns.slice(-minLen), bmR = benchmarkReturns.slice(-minLen);
      let upFund = 0, upBm = 0, upN = 0, downFund = 0, downBm = 0, downN = 0;
      for (let i = 0; i < minLen; i++) {
        if (bmR[i] > 0) { upFund += fundR[i]; upBm += bmR[i]; upN++; }
        else if (bmR[i] < 0) { downFund += fundR[i]; downBm += bmR[i]; downN++; }
      }
      upCapture = upN > 0 && upBm > 0 ? (upFund / upBm * 100) : 0;
      downCapture = downN > 0 && downBm < 0 ? (downFund / downBm * 100) : 0;
      // Jensen's alpha: β = Cov(fund,benchmark) / Var(benchmark)，复用上方 fundR/bmR/minLen
      let beta = 0;
      {
        const mf = fundR.reduce((a,b)=>a+b,0)/minLen, mb = bmR.reduce((a,b)=>a+b,0)/minLen;
        let covFB = 0, varB = 0;
        for (let i = 0; i < minLen; i++) { covFB += (fundR[i]-mf)*(bmR[i]-mb); varB += (bmR[i]-mb)**2; }
        beta = varB > 0 ? covFB / varB : 0;
      }
      jensensAlpha = excessReturn; // 简化：超额收益即 alpha（基准已调整）
    }

    if (benchmarkReturns.length > 0) {
      output += `⚖️ vs ${benchmarkCode} 基准\n`;
      output += `超额收益: ${excessReturn >= 0 ? '+' : ''}${(excessReturn*100).toFixed(2)}% | 跟踪误差: ${(trackingError*100).toFixed(2)}% | IR: ${ir.toFixed(2)}\n`;
      output += `上行捕获: ${upCapture.toFixed(0)}% | 下行捕获: ${downCapture.toFixed(0)}% | α(年化): ${(jensensAlpha*100).toFixed(2)}%\n`;
    }

    // ── VaR / CVaR ──
    const sortedR = [...dailyReturns].sort((a, b) => a - b);
    const paramVaR95 = meanReturn - 1.645 * Math.sqrt(variance);
    const paramVaR99 = meanReturn - 2.326 * Math.sqrt(variance);
    const hIdx95 = Math.max(0, Math.floor(sortedR.length * 0.05));
    const hIdx99 = Math.max(0, Math.floor(sortedR.length * 0.01));
    const histVaR95 = sortedR[hIdx95], histVaR99 = sortedR[hIdx99];
    const t95 = sortedR.filter(r => r <= histVaR95);
    const cVaR95 = t95.length > 0 ? t95.reduce((a, b) => a + b, 0) / t95.length : histVaR95;
    const t99 = sortedR.filter(r => r <= histVaR99);
    const cVaR99 = t99.length > 0 ? t99.reduce((a, b) => a + b, 0) / t99.length : histVaR99;
    const fundV = (ctx.portfolioStats?.computedFundsWithMetrics || []).find(f => (f.fundCode || '').trim() === fundCode)?.currentValue || 0;
    const fmtAmt = (rate) => fundV <= 0 ? '' : ` (约${rate >= 0 ? '+' : ''}${Math.round(fundV * rate).toLocaleString()}元)`;
    const varSt = (pct) => { const a = Math.abs(pct * 100); return a < 1 ? '🟢 安全' : a < 2 ? '🟡 关注' : '🔴 警戒'; };
    output += `\n\n🛡️ 风险预算 (VaR/CVaR)\n`;
    output += `参数法 VaR(95%): ${(paramVaR95*100).toFixed(2)}%${fmtAmt(paramVaR95)} | ${varSt(paramVaR95)}\n`;
    output += `历史法 VaR(95%): ${(histVaR95*100).toFixed(2)}%${fmtAmt(histVaR95)}\n`;
    output += `CVaR(95%): ${(cVaR95*100).toFixed(2)}%${fmtAmt(cVaR95)}\n`;
    output += `历史法 VaR(99%): ${(histVaR99*100).toFixed(2)}%${fmtAmt(histVaR99)} | CVaR(99%): ${(cVaR99*100).toFixed(2)}%${fmtAmt(cVaR99)}`;

    // ── O-U 半衰期（共享 computeOU）──
    if (navList.length >= 20) {
      try {
        const navs = navList.map(p => p.nav).filter(v => v > 0);
        if (navs.length >= 20) {
          const ou = computeOU(navs);
          if (ou) {
            output += `\n\n📐 均值回归 (O-U)\n长期均值: ${ou.mu.toFixed(4)} | 当前: ${navs[navs.length-1].toFixed(4)} | 偏离: ${ou.devStd.toFixed(2)}σ\n半衰期: ${ou.hlLabel} | ${ou.sigLabel}`;
          }
        }
      } catch (e) {}
    }

    return { output, pendingActions: [] };
  } catch (e) {
    return { output: `风险指标计算异常: ${e.message}`, pendingActions: [] };
  }
};


// ============================================================================
// 工具: run_portfolio_optimization
// ============================================================================
// 共享：拉取净值序列→协方差矩阵（供 B-L 和 compute_covariance 复用）
const computeCovMatrix = async (codes, settings) => {
  const results = await Promise.all(codes.map(async (code) => {
    try {
      const records = await fetchFundNavPages(code, 60, settings);
      return { code, navs: records.map(r => r.nav) };
    } catch { return { code, navs: [] }; }
  }));
  const valid = results.filter(r => r.navs.length >= 20);
  if (valid.length < 2) return null;
  const minLen = Math.min(...valid.map(r => r.navs.length));
  const aligned = valid.map(r => r.navs.slice(-minLen));
  const dailyReturns = [];
  for (let t = 1; t < minLen; t++)
    dailyReturns.push(aligned.map(n => n[t - 1] > 0 ? (n[t] - n[t - 1]) / n[t - 1] : 0));
  const N = valid.length, T = dailyReturns.length, lambda = 0.94;
  // 去均值
  const mu = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    for (let t = 0; t < T; t++) mu[i] += dailyReturns[t][i];
    mu[i] /= T;
  }
  let cov = Array.from({ length: N }, () => new Array(N).fill(0));
  const warmup = Math.min(20, T);
  for (let t = 0; t < warmup; t++) {
    const r = dailyReturns[t];
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        cov[i][j] += (r[i] - mu[i]) * (r[j] - mu[j]) / warmup;
  }
  for (let t = warmup; t < T; t++) {
    const r = dailyReturns[t];
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        cov[i][j] = lambda * cov[i][j] + (1 - lambda) * (r[i] - mu[i]) * (r[j] - mu[j]);
  }
  return { covMatrix: cov, fundCodes: valid.map(r => r.code) };
};

const handleRunPortfolioOptimization = async (ctx) => {
  try {
    const { funds = [], constitution = '' } = ctx.args;
    if (funds.length < 2) return { output: '至少需要2只基金。', pendingActions: [] };

    // 1. 宪法先验
    const prior = parseConstitutionToPrior(constitution);

    // 2. 当前大类权重
    const currentWeights = calcCurrentWeights(funds);

    // 3. 从AI打分构建观点（统一使用 classifyFundType，优先资产配置比例）
    const equityScores = funds.filter(f => classifyFundType(f) === 'equity');
    const bondScores = funds.filter(f => classifyFundType(f) === 'bond');
    const avgEquityScore = equityScores.length > 0
      ? equityScores.reduce((s, f) => s + (f.equityScore || 50), 0) / equityScores.length
      : 50;
    const avgBondScore = bondScores.length > 0
      ? bondScores.reduce((s, f) => s + (f.score || f.fundScore || f.equityScore || 50), 0) / bondScores.length
      : 50;
    const equityVerdict = equityScores.find(f => f.verdict === 'BLACK_LIST') ? 'BLACK_LIST' :
      (funds.find(f => f.verdict)?.verdict || 'HOLD_STRATEGY');

    const scoreGap = Math.abs(avgEquityScore - avgBondScore);
    const viewsWeak = scoreGap < 15;

    const scoring = {
      equity: { final: avgEquityScore, verdict: equityVerdict },
      bond: bondScores.length > 0 ? { final: avgBondScore, verdict: 'HOLD_STRATEGY' } : null
    };
    const metaAccuracy = ctx.settings?.omegaAccuracy || 0.5;
    const blViews = buildBLViews(scoring, prior, currentWeights, metaAccuracy);

    // 4. 拉取协方差矩阵（≥2只基金时始终拉取，有/无观点都需要）
    const codes = funds.map(f => f.fundCode || '').filter(Boolean);
    let covResult = null;
    if (codes.length >= 2) {
      covResult = await computeCovMatrix(codes, ctx.settings);
    }

    // 5. B-L 后验：始终基于协方差做均值-方差优化（无观点时用均衡收益）
    const portfolioTotal = ctx.portfolioStats?.totalCurrentValue || 100000;
    let blResult;
    if (covResult) {
      // 始终跑 B-L——有观点用后验，无观点用 Π=τΣw_prior 做风险加权
      blResult = blackLittermanPosterior(prior, blViews.views, covResult.covMatrix, covResult.fundCodes, funds);
    } else {
      // 协方差数据不足 → 降级为等权
      const eq = {};
      for (const f of funds) {
        const cls = classifyName(f.fundName);
        const clsFunds = funds.filter(ff => classifyName(ff.fundName) === cls).length;
        eq[f.fundCode || f.fundName] = prior[cls] / Math.max(1, clsFunds);
      }
      blResult = { optimalWeights: eq, status: '协方差数据不足，降级为等权分配', conditionNumber: 0 };
    }

    // BLACK_LIST 穿透：标记清零（由 allocateByScore 处理）
    const blackCodes = funds.filter(f => f.verdict === 'BLACK_LIST').map(f => f.fundCode || f.fundName || '');

    // 基金评分：逐只计算个基质量分（从 LLM 传入的指标中提取）
    const fundScores = funds.map(f => {
      const scoreInput = {
        sharpe: f.sharpe,
        ir: f.ir,
        annualReturn: f.annualReturn,
        mdd: f.mdd,
        upCapture: f.upCapture,
        downCapture: f.downCapture,
        ranking: f.ranking,
        verdict: f.verdict,
        feeRate: f.feeRate,
        isShortTerm: f.isShortTerm,
        volatility: f.volatility
      };
      const score = classifyFundScore(scoreInput);
      logFundScore(f.fundCode || f.fundName, f.fundName || f.fundCode, scoreInput, score);
      return {
        fundCode: f.fundCode || '',
        fundName: f.fundName || '',
        score
      };
    });

    // 同类内按基金分加权 → 替代等权
    const scoredWeights = allocateByScore(blResult.optimalWeights, fundScores, blackCodes);

    // 6. 格式化输出
    let output = `【B-L 组合优化 — ${prior.label}】\n`;
    output += `先验: 固收${(prior.bond * 100).toFixed(0)}% 权益${(prior.equity * 100).toFixed(0)}% 现金${(prior.cash * 100).toFixed(0)}%\n`;
    output += `当前: 固收${(currentWeights.bond * 100).toFixed(0)}% 权益${(currentWeights.equity * 100).toFixed(0)}% 现金${(currentWeights.cash * 100).toFixed(0)}%\n`;
    output += `观点: ${blViews.summary}\n`;
    output += `Ω校准: ${metaAccuracy > 0 ? (metaAccuracy * 100).toFixed(0) + '%' : '默认'}\n`;

    if (viewsWeak && blViews.views.length === 0) {
      output += `\n⚠️ 观点强度不足：权益${avgEquityScore.toFixed(0)} vs 固收${avgBondScore.toFixed(0)}仅差${scoreGap.toFixed(0)}分(<15)。\n`;
    }
    if (blackCodes.length > 0) {
      output += `🚨 黑名单已清零点权重: ${blackCodes.join(', ')}\n`;
    }

    output += `\n状态: ${blResult.status}\n`;
    output += `同类内按基金分加权分配（F1收益动量+F2风险调整+F3基准相对+F4成本纪律）:\n`;
    output += `基金名称 | 基金分 | 目标% | 当前% | 调仓建议\n`;

    for (const f of funds) {
      const code = f.fundCode || f.fundName || '';
      const fs = fundScores.find(s => s.fundCode === code);
      const fundScore = fs?.score?.baseScore ?? '?';
      const optW = scoredWeights[code] ?? 0;
      const curW = f.currentWeight || 0;
      const delta = optW - curW;
      const deltaAmt = Math.round(delta * portfolioTotal);
      const absDelta = Math.abs(delta);
      let signal;
      if (absDelta < 0.005) signal = '➖ 维持';
      else if (delta > 0) signal = `📈 +${(delta * 100).toFixed(1)}% (+${deltaAmt.toLocaleString()}元)`;
      else signal = `📉 ${(delta * 100).toFixed(1)}% (${Math.abs(deltaAmt).toLocaleString()}元)`;
      const blackTag = blackCodes.includes(code) ? ' 🚨BLACK' : '';
      const scoreTag = typeof fundScore === 'number' ? `${fundScore}分` : '?';
      output += `  ${(f.fundName || code).padEnd(20)} | ${scoreTag.padStart(4)} | ${(optW * 100).toFixed(1).padStart(5)}% | ${(curW * 100).toFixed(1).padStart(5)}% | ${signal}${blackTag}\n`;
    }

    if (blResult.conditionNumber > 0 && blResult.conditionNumber < 1e10) {
      output += `\n📐 协方差条件数: ${blResult.conditionNumber.toExponential(2)} (数值稳定)`;
    }

    return { output, pendingActions: [] };
  } catch (e) { return { output: `B-L优化异常: ${e.message}`, pendingActions: [] }; }
};

// ============================================================================
// 工具: compute_covariance
// ============================================================================
const handleComputeCovariance = async (ctx) => {
  try {
    const codes = (ctx.args.fundCodes || []).slice(0, 15);
    if (codes.length < 2) return { output: '至少需要2只基金代码。', pendingActions: [] };
    const result = await computeCovMatrix(codes, ctx.settings);
    if (!result) return { output: '净值数据不足（需≥20个交易日）。', pendingActions: [] };
    const { covMatrix: cov, fundCodes } = result;
    const N = fundCodes.length, T = '未知';
    let output = `【EWMA 协方差矩阵 (λ=0.94, 去均值)】\n`;
    const eqW = 1 / N;
    const totalVar = cov.reduce((s, row, i) => { let ws = 0; for (let j = 0; j < N; j++) ws += eqW * row[j]; return s + eqW * ws; }, 0);
    let sumMRC = 0;
    for (let i = 0; i < N; i++) {
      let mrc = 0; for (let j = 0; j < N; j++) mrc += eqW * cov[i][j];
      const contrib = totalVar > 0 ? (eqW * mrc / totalVar * 100) : 0;
      sumMRC += contrib;
      output += `${fundCodes[i]}: ${contrib.toFixed(1)}% (波动${(Math.sqrt(Math.max(0, cov[i][i])) * 100).toFixed(1)}%)\n`;
    }
    output += `\n集中度检测: ${sumMRC > 0 && (sumMRC > 110 || sumMRC < 90) ? `⚠️ 总和${sumMRC.toFixed(0)}%(期望100%)` : '✅ 正常'}`;
    return { output, pendingActions: [] };
  } catch (e) { return { output: `协方差异常: ${e.message}`, pendingActions: [] }; }
};

// ============================================================================
// 工具: compute_ou_half_life
// ============================================================================
const handleComputeOUHalfLife = async (ctx) => {
  try {
    const code = ctx.args.fundCode;
    const records = await fetchFundNavPages(code, 120, ctx.settings);
    const navs = records.map(r => r.nav);
    if (navs.length < 20) return { output: `数据不足(仅${navs.length}日,需≥20日)。`, pendingActions: [] };
    const ou = computeOU(navs);
    if (!ou) return { output: '数据过于平稳,无法拟合。', pendingActions: [] };
    let output = `【O-U 半衰期 — ${code}】\n`;
    output += `长期均值μ: ${ou.mu.toFixed(4)} | 当前: ${navs[navs.length-1].toFixed(4)} | 偏离: ${ou.devStd.toFixed(2)}σ\n`;
    output += `回归速度θ: ${ou.theta.toFixed(4)} | 半衰期: ${ou.hlLabel} | ${ou.sigLabel}`;
    return { output, pendingActions: [] };
  } catch (e) { return { output: `O-U异常: ${e.message}`, pendingActions: [] }; }
};

// ============================================================================
// 工具: run_markov_regime
// ============================================================================
const handleRunMarkovRegime = async (ctx) => {
  try {
    const code = ctx.args.code || 'sh000001';
    const days = Math.min(ctx.args.days || 120, 250);
    const url = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},day,,,${days},`;
    const fUrl = ctx.settings.proxyMode === 'custom' && ctx.settings.customProxyUrl ? buildProxyUrl(ctx.settings, url) : buildAllOriginsUrl(url);
    const res = await fetch(fUrl, { cache: 'no-store' });
    const d = await res.json();
    const kd = d?.data?.[code]?.day || d?.data?.[code]?.qfqday || [];
    if (kd.length < 60) return { output: 'K线数据不足(<60根)。', pendingActions: [] };
    const cl = kd.map(k => parseFloat(k[2])).filter(v => !isNaN(v));
    const rets = [];
    for (let i=1;i<cl.length;i++) if (cl[i-1]>0) rets.push((cl[i]-cl[i-1])/cl[i-1]);
    if (rets.length<50) return { output: '收益率序列不足。', pendingActions: [] };
    const T=rets.length,sr=[...rets].sort((a,b)=>a-b);
    const q1=sr[Math.floor(T*0.25)],q3=sr[Math.floor(T*0.75)];
    const lo=rets.filter(r=>r>=q1&&r<=q3),hi=rets.filter(r=>r<q1||r>q3);
    const mu=[lo.length>0?lo.reduce((a,b)=>a+b,0)/lo.length:0,hi.length>0?hi.reduce((a,b)=>a+b,0)/hi.length:0];
    const sig=[lo.length>0?Math.sqrt(lo.reduce((s,r)=>s+(r-mu[0])**2,0)/lo.length):0.005,hi.length>0?Math.sqrt(hi.reduce((s,r)=>s+(r-mu[1])**2,0)/hi.length):0.015];
    const al=Array.from({length:T},()=>[0,0]);
    for(let k=0;k<2;k++){const dd=(rets[0]-mu[k])/sig[k];al[0][k]=0.5*Math.exp(-0.5*dd*dd)/(Math.sqrt(2*Math.PI)*sig[k]);}
    let s=al[0][0]+al[0][1];if(s>0)al[0]=al[0].map(v=>v/s);
    for(let t=1;t<T;t++){for(let j=0;j<2;j++){let sm=0;for(let i=0;i<2;i++)sm+=al[t-1][i]*(i===j?0.9:0.1);const dd=(rets[t]-mu[j])/sig[j];al[t][j]=sm*Math.exp(-0.5*dd*dd)/(Math.sqrt(2*Math.PI)*sig[j]);}s=al[t][0]+al[t][1];if(s>0)al[t]=al[t].map(v=>v/s);}
    const lp=al[T-1];
    const dom=lp[0]>lp[1]?'低波制式':'高波制式';
    let output = `【Markov 机制转移 — ${code} (${T}日)】\n`;
    output += `低波制式=${(lp[0]*100).toFixed(0)}% 高波制式=${(lp[1]*100).toFixed(0)}% | 主导: ${dom}\n`;
    output += `低波 μ=${(mu[0]*100).toFixed(2)}% σ=${(sig[0]*100).toFixed(2)}% | 高波 μ=${(mu[1]*100).toFixed(2)}% σ=${(sig[1]*100).toFixed(2)}%`;
    return { output, pendingActions: [] };
  } catch (e) { return { output: `Markov异常: ${e.message}`, pendingActions: [] }; }
};

// ============================================================================
// 工具: run_monte_carlo
// ============================================================================
const handleRunMonteCarlo = async (ctx) => {
  try {
    const codes = (ctx.args.fundCodes || []).slice(0, 10);
    const wts = ctx.args.weights || codes.map(() => 1/codes.length);
    const horizon = Math.min(ctx.args.horizonDays || 60, 252);
    const sims = Math.min(ctx.args.numSims || 3000, 5000);
    const initVal = ctx.args.initialValue || (ctx.portfolioStats?.totalCurrentValue || 100000);
    const results = await Promise.all(codes.map(async (code) => {
      try {
        const records = await fetchFundNavPages(code, 120, ctx.settings);
        return { code, navs: records.map(r => r.nav) };
      } catch { return { code, navs: [] }; }
    }));
    const valid = results.filter(r => r.navs.length >= 30);
    if (valid.length < 1) return { output: '净值数据不足。', pendingActions: [] };
    const minLen = Math.min(...valid.map(r => r.navs.length));
    const aligned = valid.map(r => r.navs.slice(-minLen));
    const dailyRets = [];
    for (let t=1;t<minLen;t++) dailyRets.push(aligned.map(n=>n[t-1]>0?(n[t]-n[t-1])/n[t-1]:0));
    const mode = ctx.args.mode || 'var'; // 'var'=保守零漂移 | 'projection'=带历史μ
    const N=valid.length,T=dailyRets.length;
    // 去均值协方差 + 漂移项
    const mu = new Array(N).fill(0);
    for (let i=0;i<N;i++){for(let t=0;t<T;t++)mu[i]+=dailyRets[t][i];mu[i]/=T;}
    let cov=Array.from({length:N},()=>new Array(N).fill(0));
    for(let t=0;t<T;t++){const r=dailyRets[t];for(let i=0;i<N;i++)for(let j=0;j<N;j++)cov[i][j]+=(r[i]-mu[i])*(r[j]-mu[j])/T;}
    const portfolioMu = mode === 'projection' ? mu.reduce((s,m,i)=>s+wts[i]*m,0) : 0;
    const L=Array.from({length:N},()=>new Array(N).fill(0));
    for(let i=0;i<N;i++){for(let j=0;j<=i;j++){let s=cov[i][j];for(let k=0;k<j;k++)s-=L[i][k]*L[j][k];if(i===j)L[i][j]=s>0?Math.sqrt(s):0;else L[i][j]=L[j][j]>0?s/L[j][j]:0;}}
    const mb32=(seed)=>{return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};};
    const rn=(prng)=>{const u1=Math.max(prng(),0.0001),u2=prng();return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);};
    const fv=new Array(sims),md=new Array(sims);
    for(let s=0;s<sims;s++){const rng=mb32(42+s*137);let v=initVal,pk=initVal,mdd=0;
      for(let d=0;d<horizon;d++){const z=Array.from({length:N},()=>rn(rng));const cor=new Array(N).fill(0);for(let i=0;i<N;i++)for(let j=0;j<N;j++)cor[i]+=L[i][j]*z[j];let dr=portfolioMu;for(let i=0;i<N;i++)dr+=wts[i]*cor[i];v*=(1+dr);if(v>pk)pk=v;const dd=(pk-v)/pk;if(dd>mdd)mdd=dd;}
      fv[s]=v;md[s]=mdd;}
    fv.sort((a,b)=>a-b);md.sort((a,b)=>a-b);
    const pct=(a,p)=>a[Math.max(0,Math.floor(a.length*p))];
    const mean=fv.reduce((a,b)=>a+b,0)/sims;
    const modeLabel = mode === 'projection' ? '终值推演(含μ)' : '压力测试(保守)';
    let output = `【蒙特卡洛 ${modeLabel} — ${sims}条${horizon}日路径】\n`;
    output += `初始: ${initVal.toLocaleString()}元 → 预期终值: ${mean.toFixed(0)}元 (${((mean/initVal-1)*100).toFixed(1)}%)\n`;
    output += `最坏5%: ${pct(fv,0.05).toFixed(0)} | 中位数: ${pct(fv,0.5).toFixed(0)} | 最好5%: ${pct(fv,0.95).toFixed(0)}\n`;
    output += `VaR(95%): ${(initVal-pct(fv,0.05)).toFixed(0)}元\n`;
    if (mode === 'projection') output += `⚠️ 含历史μ(${(portfolioMu*100).toFixed(2)}%/日)，VaR可能偏乐观。压力测试请用mode=var。\n`;
    for(const t of[0.05,0.10,0.15]) output += `>${(t*100).toFixed(0)}%回撤概率: ${(md.filter(d=>d>=t).length/sims*100).toFixed(1)}%\n`;
    return { output, pendingActions: [] };
  } catch (e) { return { output: `蒙特卡洛异常: ${e.message}`, pendingActions: [] }; }
};


// ============================================================================
// 工具: run_backtest — 评分回测
// ============================================================================
const handleRunBacktest = async (ctx) => {
  try {
    const days = ctx.args.days || 60;
    const { db, userId, appId } = ctx.firestoreContext || {};
    if (!db || !userId) return { output: "回测需要Firestore连接。", pendingActions: [] };
    const sinceDate = new Date(); sinceDate.setDate(sinceDate.getDate() - days);
    const snapshotsRef = collection(db, "artifacts", appId, "users", userId, "scoring_snapshots");
    const q = query(snapshotsRef, where("date", ">=", sinceDate.toISOString().split("T")[0]), orderBy("date", "asc"), limit(days));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return { output: `近${days}天内无历史打分记录。先积累至少5次打分。`, pendingActions: [] };
    const scoreHistory = [];
    snapshot.forEach(doc => { const s = doc.data(); if (s.equity?.final != null) scoreHistory.push({ date: s.date, equity: s.equity, bond: s.bond || null }); });
    if (scoreHistory.length < 5) return { output: `仅${scoreHistory.length}条打分记录,需≥5条。继续积累。`, pendingActions: [] };
    const klineDays = 320;
    const [shRes, cybRes, szRes] = await Promise.allSettled([
      fetchIndexKlines('sh000001', ctx.settings, klineDays),
      fetchIndexKlines('sz399006', ctx.settings, klineDays),
      fetchIndexKlines('sz399001', ctx.settings, klineDays)
    ]);
    const shKlines = shRes.status === 'fulfilled' ? shRes.value : [];
    if (shKlines.length < 20) return { output: "市场K线数据不足。", pendingActions: [] };
    const cybKlines = cybRes.status === 'fulfilled' ? cybRes.value : [];
    const szKlines = szRes.status === 'fulfilled' ? szRes.value : [];

    // 先用纯函数合并收盘价
    const marketData = mergeMultiIndexKlines(shKlines, cybKlines, szKlines);
    // 再补充涨跌幅（需要开盘价）
    for (const k of shKlines) {
      const date = k[0];
      if (marketData[date]) {
        const close = parseFloat(k[2]), open = parseFloat(k[1]);
        marketData[date].shPct = open > 0 ? (close - open) / open : 0;
      }
    }
    for (const k of cybKlines) {
      const date = k[0];
      if (marketData[date]) {
        const close = parseFloat(k[2]), open = parseFloat(k[1]);
        marketData[date].cybPct = open > 0 ? (close - open) / open : 0;
      }
    }
    for (const k of szKlines) {
      const date = k[0];
      if (marketData[date]) {
        const close = parseFloat(k[2]), open = parseFloat(k[1]);
        marketData[date].szPct = open > 0 ? (close - open) / open : 0;
      }
    }
    const result = computeBacktest(scoreHistory, marketData, [1, 3, 5, 10, 20]);
    let report = formatBacktestReport(result);

    // 保存 Ω 到 Firestore（双写：独立文档 + settings/general 随设置加载）
    if (result.omegaSuggestion && db && userId) {
      try {
        const omegaData = {
          omegaAccuracy: result.omegaSuggestion.rawAccuracy,
          omegaRecommended: result.omegaSuggestion.recommendedOmega,
          omegaSamples: result.overview.totalPredictions,
          omegaUpdatedAt: new Date().toISOString()
        };
        const omegaRef = doc(db, 'artifacts', appId, 'users', userId, 'settings', 'backtest_omega');
        const generalRef = doc(db, 'artifacts', appId, 'users', userId, 'settings', 'general');
        await Promise.all([
          setDoc(omegaRef, omegaData, { merge: true }),
          setDoc(generalRef, omegaData, { merge: true })
        ]);
        report += '\n\n✅ Ω已保存,后续对话自动注入+B-L自动使用。';
      } catch(e) { report += '\n\n⚠️ Ω保存失败,但回测结果仍有效。'; }
    }

    return { output: report, pendingActions: [] };
  } catch (e) { return { output: `回测异常: ${e.message}`, pendingActions: [] }; }
};
// HANDLER_MAP — 策略模式映射表

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
    const res = await fetch(base + '/api/market-microstructure', {
      signal: AbortSignal.timeout(8000),
      headers: ctx.settings.workerSecret ? { 'Authorization': `Bearer ${ctx.settings.workerSecret}` } : {}
    });
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

// ── 行业资金流向 — 调用Worker获取东财行业板块主力资金流向数据 ──
const handleGetSectorCapitalFlow = async (ctx) => {
  const { settings } = ctx;
  const cfUrl = (settings?.cfWorkerUrl || settings?.customProxyUrl || '').trim();
  if (!cfUrl) {
    return { output: '❌ 未配置 Worker URL，无法查询行业资金流向。请在设置中配置巡检大脑Worker地址。', pendingActions: [] };
  }
  try {
    const base = cfUrl.split('?')[0].replace(/\/+$/, '');
    const res = await fetch(base + '/api/sector-capital-flow', {
      signal: AbortSignal.timeout(8000),
      headers: settings.workerSecret ? { 'Authorization': `Bearer ${settings.workerSecret}` } : {}
    });
    if (!res.ok) throw new Error('Worker返回状态码 ' + res.status);
    const data = await res.json();

    if (!data?.top5 || data.top5.length === 0) {
      return { output: '⚠️ 行业资金流向数据暂不可用（可能非交易时段或数据获取异常）。', pendingActions: [] };
    }

    let output = '【行业资金流向（东财行业分类）】\n';
    output += `共${data.total}个行业板块\n\n`;
    output += `📈 主力净流入 TOP5:\n`;
    for (const s of data.top5) {
      output += `  ${s.name}: 主力净流入${s.mainForceNet}亿`;
      if (s.mainForceRatio) output += ` (占比${s.mainForceRatio}‰)`;
      if (s.pct != null) output += ` | 涨幅${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(2)}%`;
      output += '\n';
    }
    output += `\n📉 主力净流出 TOP5:\n`;
    for (const s of data.bottom5) {
      output += `  ${s.name}: 主力净流出${Math.abs(parseFloat(s.mainForceNet)).toFixed(1)}亿`;
      if (s.mainForceRatio) output += ` (占比${s.mainForceRatio}‰)`;
      if (s.pct != null) output += ` | 涨幅${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(2)}%`;
      output += '\n';
    }
    output += '\n💡 分析提示：主力净流入/流出=超大单+大单，反映机构资金态度。结合北向资金和行业涨幅综合判断当日资金主线。';
    return { output, pendingActions: [] };
  } catch (e) {
    return { output: `⚠️ 行业资金流向获取失败: ${e.message}。`, pendingActions: [] };
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
  ['fetch_article_content', handleFetchArticleContent],
  ['worker_web_search', handleWorkerWebSearch],
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
  ['get_sector_capital_flow', handleGetSectorCapitalFlow],
  ['run_portfolio_optimization', handleRunPortfolioOptimization],
  ['compute_covariance', handleComputeCovariance],
  ['compute_ou_half_life', handleComputeOUHalfLife],
  ['run_markov_regime', handleRunMarkovRegime],
  ['run_monte_carlo', handleRunMonteCarlo],
  ['run_backtest', handleRunBacktest],
]);
