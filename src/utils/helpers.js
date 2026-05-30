import { isHolidayToday } from './holidayCalendar';

// 安全的四则运算求值器（不依赖 eval / new Function）
const safeMathEval = (s) => {
  s = s.replace(/\s/g, '');
  let i = 0;

  const expr = () => {
    let left = term();
    while (i < s.length) {
      if (s[i] === '+') { i++; left += term(); }
      else if (s[i] === '-') { i++; left -= term(); }
      else break;
    }
    return left;
  };

  const term = () => {
    let left = factor();
    while (i < s.length) {
      if (s[i] === '*') { i++; left *= factor(); }
      else if (s[i] === '/') { i++; const divisor = factor(); left = divisor === 0 ? 0 : left / divisor; }
      else break;
    }
    return left;
  };

  const factor = () => {
    if (i >= s.length) return 0;
    if (s[i] === '(') { i++; const val = expr(); if (i < s.length && s[i] === ')') i++; return val; }
    if (s[i] === '-') { i++; return -factor(); }
    if (s[i] === '+') { i++; return factor(); }
    let start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    if (start === i) return 0;
    return parseFloat(s.slice(start, i));
  };

  const result = expr();
  return isNaN(result) || !isFinite(result) ? 0 : result;
};

export const evaluateExpression = (expr) => {
  if (typeof expr !== 'string') return expr || 0;
  let toEval = expr.trim();
  if (toEval.startsWith('=')) toEval = toEval.substring(1);
  if (!toEval) return 0;
  if (!/^[0-9+\-*/().\s]*$/.test(toEval)) return isNaN(parseFloat(expr)) ? 0 : parseFloat(expr);
  try {
    const result = safeMathEval(toEval);
    return isNaN(result) || !isFinite(result) ? 0 : Number(result.toFixed(2));
  } catch (e) {
    return isNaN(parseFloat(expr)) ? 0 : parseFloat(expr);
  }
};

export const calculateXIRR = (cashFlows) => {
  const flows = cashFlows.map(cf => ({ amount: cf.amount, date: new Date(cf.date) })).filter(cf => !isNaN(cf.date.getTime()));
  if (flows.length < 2) return 0;
  
  flows.sort((a, b) => a.date - b.date);

  const hasPositive = flows.some(f => f.amount > 0);
  const hasNegative = flows.some(f => f.amount < 0);
  if (!hasPositive || !hasNegative) return 0;

  const d0 = flows[0].date;
  if (flows[flows.length - 1].date - d0 === 0) return 0;

  const xnpv = (rate) => {
    if (rate <= -1) return NaN;
    return flows.reduce((sum, cf) => {
      const years = (cf.date - d0) / 86400000 / 365.0;
      return sum + cf.amount / Math.pow(1 + rate, years);
    }, 0);
  };

  let low = -0.999999;
  let high = 10000;   
  let rate = 0;
  for (let i = 0; i < 100; i++) {
    rate = (low + high) / 2;
    let val = xnpv(rate);
    if (Math.abs(val) < 0.00001 || (high - low) < 0.000001) break;
    if (val > 0) low = rate; else high = rate;
  }
  return rate;
};

export const formatMoney = (val) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(val);
export const formatPercent = (val) => new Intl.NumberFormat('zh-CN', { style: 'percent', minimumFractionDigits: 2 }).format(val);

// 🌟 升级版：支持法定节假日拦截的交易时间校验
export const checkIsTradingTime = () => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const hours = now.getHours();
  const minutes = now.getMinutes();

  if (isHolidayToday(now)) return false;

  const time = hours * 100 + minutes;
  const isMorning = time >= 930 && time <= 1130;
  const isAfternoon = time >= 1300 && time < 1500;

  return isMorning || isAfternoon;
};

// ============================================================================
// 🔍 底层资产穿透与全局集中度引擎 (X-Ray)
// ============================================================================

// 1. 提取单只基金的前十大重仓 (支持股/债双擎)
export const extractFundHoldings = (profile) => {
  if (!profile || !profile.fund_position) return [];
  const holdings = [];
  const { stock_list, bond_list } = profile.fund_position;

  // 提取股票重仓
  if (Array.isArray(stock_list)) {
    stock_list.forEach(item => {
      holdings.push({
        name: item.name,
        symbol: item.symbol,
        percent: parseFloat(item.percent) || 0,
        type: 'stock'
      });
    });
  }

  // 提取债券重仓
  if (Array.isArray(bond_list)) {
    bond_list.forEach(item => {
      holdings.push({
        name: item.name,
        symbol: item.symbol || item.name, // 债券有时未提供代码，用名称兜底
        percent: parseFloat(item.percent) || 0,
        type: 'bond'
      });
    });
  }

  // 按持仓权重降序排列
  return holdings.sort((a, b) => b.percent - a.percent);
};

// ============================================================================
// 🔍 机构级 FOF 穿透雷达引擎 (Dual-Core X-Ray)
// ============================================================================

// 删掉之前的硬编码常量配置！

// 🌟 FOF 双核重构版：直接接收云端传来的 fofDictionary
export const calculatePortfolioXRay = (activeFunds, fofDictionary, portfolioTotalValue) => {
  let trueEquityTotalValue = 0; 
  const sectorMap = {};         

  if (!activeFunds || activeFunds.length === 0 || portfolioTotalValue <= 0) {
    return { aggregatedHoldings: [], warnings: [], trueEquityTotalValue: 0, equityExposureRate: 0 };
  }

  activeFunds.forEach(fund => {
    if (fund.currentValue <= 0 || fund.isArchived || !fund.fundCode) return;

    // 🌟 核心：直接使用传进来的动态字典
    const dictConfig = fofDictionary[fund.fundCode];
    if (!dictConfig || dictConfig.equityRatio <= 0) return;

    const fundEquityValue = fund.currentValue * dictConfig.equityRatio;
    trueEquityTotalValue += fundEquityValue;

    if (dictConfig.sectors) {
        Object.entries(dictConfig.sectors).forEach(([sectorName, ratio]) => {
          const sectorValue = fundEquityValue * ratio;
          if (!sectorMap[sectorName]) sectorMap[sectorName] = 0;
          sectorMap[sectorName] += sectorValue;
        });
    }
  });

  if (trueEquityTotalValue === 0) {
    return { aggregatedHoldings: [], warnings: [], trueEquityTotalValue: 0, equityExposureRate: 0 };
  }

  const aggregatedHoldings = Object.entries(sectorMap)
    .map(([name, value]) => ({
      name, symbol: name, type: 'sector', value: value,
      globalPercent: (value / trueEquityTotalValue) * 100 
    }))
    .sort((a, b) => b.globalPercent - a.globalPercent);

  const warnings = aggregatedHoldings.filter(h => h.globalPercent >= 30);

  return { 
    aggregatedHoldings, warnings, trueEquityTotalValue,
    equityExposureRate: (trueEquityTotalValue / portfolioTotalValue) * 100 
  };
};