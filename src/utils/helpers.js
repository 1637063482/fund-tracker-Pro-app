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