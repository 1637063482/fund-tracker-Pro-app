// 通用工具函数集：安全数学求值、资金格式化、百分比格式化、XIRR 年化收益计算、交易时间判定
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
  let high = 10;  // 上限 1000%，覆盖任何真实基金年化收益   
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
// 🔍 全盘资产配置 X-Ray — 从用户填写的 assetAllocation 计算权益/固收敞口
// ============================================================================
export const calculatePortfolioXRay = (activeFunds, portfolioTotalValue) => {
  let totalEquity = 0, totalBond = 0, totalCash = 0, totalFund = 0, totalOther = 0;

  if (!activeFunds || activeFunds.length === 0 || portfolioTotalValue <= 0) {
    return { totalEquity, totalBond, totalCash, totalFund, totalOther, equityExposureRate: 0, bondExposureRate: 0 };
  }

  activeFunds.forEach(fund => {
    if (fund.currentValue <= 0 || fund.isArchived) return;
    const alloc = fund.assetAllocation;
    if (!alloc || Object.values(alloc).every(v => v === '' || v == null)) return;
    const stock = parseFloat(alloc.stock) || 0;
    const bond = parseFloat(alloc.bond) || 0;
    const cash = parseFloat(alloc.cash) || 0;
    const fnd = parseFloat(alloc.fund) || 0;
    const other = parseFloat(alloc.other) || 0;
    const weight = fund.currentValue / portfolioTotalValue;
    totalEquity += fund.currentValue * (stock + fnd) / 100;
    totalBond += fund.currentValue * bond / 100;
    totalCash += fund.currentValue * cash / 100;
    totalFund += fund.currentValue * fnd / 100;
    totalOther += fund.currentValue * other / 100;
  });

  return {
    totalEquity, totalBond, totalCash, totalFund, totalOther,
    equityExposureRate: portfolioTotalValue > 0 ? (totalEquity / portfolioTotalValue) * 100 : 0,
    bondExposureRate: portfolioTotalValue > 0 ? (totalBond / portfolioTotalValue) * 100 : 0
  };
};