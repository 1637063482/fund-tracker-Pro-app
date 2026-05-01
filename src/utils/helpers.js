export const evaluateExpression = (expr) => {
  if (typeof expr !== 'string') return expr || 0;
  let toEval = expr.trim();
  if (toEval.startsWith('=')) toEval = toEval.substring(1);
  if (!toEval) return 0;
  if (!/^[0-9+\-*/().\s]*$/.test(toEval)) return isNaN(parseFloat(expr)) ? 0 : parseFloat(expr);
  try {
    const result = new Function('"use strict";return (' + toEval + ')')();
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
  const day = now.getDay();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  // 1. A股铁律：周末绝对休市
  if (day === 0 || day === 6) return false;

  // 2. A股铁律：法定节假日休市 (读取 App.jsx 预热的全局缓存)
  try {
    const targetYear = now.getFullYear();
    const cacheKey = `HOLIDAY_CN_${targetYear}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const holidayData = JSON.parse(cached);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const checkDateStr = `${targetYear}-${mm}-${dd}`;

      // 如果今天是法定休息日，直接返回 false
      const holiday = holidayData.find(h => h.date === checkDateStr);
      if (holiday && holiday.isOffDay) return false; 
    }
  } catch (e) {
    console.warn("节假日校验失败，降级为基础时间校验", e);
  }

  // 3. 正常工作日的交易时间段校验 (9:30-11:30, 13:00-15:00)
  const time = hours * 100 + minutes;
  const isMorning = time >= 930 && time <= 1130;
  const isAfternoon = time >= 1300 && time < 1500; // 15:00 准点后算作收盘

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

// 2. 全盘穿透合并与集中度熔断核算
export const calculatePortfolioXRay = (activeFunds, fundProfiles, portfolioTotalValue) => {
  // 防御性拦截：如果没有持仓或总市值为 0，直接返回空
  if (!activeFunds || activeFunds.length === 0 || portfolioTotalValue <= 0) {
    return { aggregatedHoldings: [], warnings: [] };
  }

  const holdingMap = {};

  activeFunds.forEach(fund => {
    // 只要有市值、未归档、且有基金代码，就强制拉去穿透！
    if (fund.currentValue <= 0 || fund.isArchived || !fund.fundCode) return;

    const profile = fundProfiles[fund.fundCode];
    if (!profile) return; // 尚未抓取到详情的暂不统计

    const holdings = extractFundHoldings(profile);

    holdings.forEach(h => {
      // 🧮 核心算法：该标的在你全盘中的绝对暴露金额
      const valueInFund = fund.currentValue * (h.percent / 100);
      const key = h.symbol || h.name; // 优先用代码聚合，防止同名异码

      if (!holdingMap[key]) {
        holdingMap[key] = {
          name: h.name,
          symbol: h.symbol,
          type: h.type,
          totalValue: 0,
          funds: [] // 追溯标记：记录是你手里的哪几只基金买了它
        };
      }

      holdingMap[key].totalValue += valueInFund;
      holdingMap[key].funds.push({
        fundName: fund.name,
        fundCode: fund.fundCode,
        value: valueInFund,
        fundWeight: h.percent // 在单只基金内的原始权重
      });
    });
  });

  // 转换为数组，计算全局权重，并按绝对暴露金额降序
  const aggregatedHoldings = Object.values(holdingMap)
    .map(h => ({
      ...h,
      globalPercent: (h.totalValue / portfolioTotalValue) * 100
    }))
    .sort((a, b) => b.totalValue - a.totalValue);

  // 🚨 集中度熔断预警：单一底层资产全局暴露度 >= 5% (基于你稳健保守的偏好设定)
  const warnings = aggregatedHoldings.filter(h => h.globalPercent >= 5);

  return { aggregatedHoldings, warnings };
};