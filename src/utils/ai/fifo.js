// FIFO 风控模块：基于先进先出原则计算赎回惩罚费 + 持仓分层分析
export const calculate7DayPenalty = (transactions, currentDateStr) => {
  const analysis = analyzeHoldingPeriods(transactions, currentDateStr, [7]);
  const lockedAmount = analysis.tiers[0]?.amount || 0;
  return {
    lockedAmount: Number(lockedAmount.toFixed(2)),
    penaltyFee: Number((lockedAmount * 0.015).toFixed(2))
  };
};

// 持仓分层分析：将当前持仓按买入批次拆分为不同持有天数区间
// breakpoints: 自定义天数阈值数组，如 [7, 30, 180, 365]，默认 [7, 30, 180, 365]
// 返回每个区间的金额汇总，供 AI 精确计算阶梯赎回费
export const analyzeHoldingPeriods = (transactions, currentDateStr, breakpoints = [7, 30, 180, 365]) => {
  const result = {
    tiers: [],       // [{maxDays, amount, label}]
    totalHolding: 0  // 当前总持仓金额
  };

  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    return result;
  }

  // 规范化阈值：去重、排序
  const bp = [...new Set(breakpoints)].filter(b => b > 0).sort((a, b) => a - b);
  if (bp.length === 0) return result;

  let buyLots = [];
  const nowTimestamp = new Date(currentDateStr).getTime();

  // 1. 先进先出抵扣：用卖出记录消耗买入批次
  for (const tx of transactions) {
    const amount = Number(tx.amountRaw) || 0;
    if (amount <= 0) continue;
    const action = String(tx.type || '').toLowerCase().trim();
    const rawDate = tx.date || '';

    if (action === 'buy') {
      buyLots.push({ amount, date: rawDate });
    } else if (action === 'sell') {
      let sellAmount = amount;
      while (sellAmount > 0 && buyLots.length > 0) {
        if (buyLots[0].amount <= sellAmount) {
          sellAmount -= buyLots[0].amount;
          buyLots.shift();
        } else {
          buyLots[0].amount -= sellAmount;
          sellAmount = 0;
        }
      }
    }
  }

  // 2. 按自定义阈值分层
  const tiers = [];
  for (let i = 0; i < bp.length; i++) {
    const prev = i === 0 ? 0 : bp[i - 1];
    const max = bp[i];
    tiers.push({ minDays: prev, maxDays: max, amount: 0, rateIndex: i, label: `${prev}-${max} 天` });
  }
  // 最后一档：大于最大阈值
  tiers.push({ minDays: bp[bp.length - 1], maxDays: Infinity, amount: 0, rateIndex: bp.length, label: `> ${bp[bp.length - 1]} 天` });

  const DAY_MS = 24 * 60 * 60 * 1000;
  let totalHolding = 0;

  for (const lot of buyLots) {
    if (!lot.date) continue;
    const lotTimestamp = new Date(lot.date).getTime();
    const days = Math.floor((nowTimestamp - lotTimestamp) / DAY_MS);
    totalHolding += lot.amount;

    let placed = false;
    for (const tier of tiers) {
      if (days < tier.maxDays) {
        tier.amount += lot.amount;
        placed = true;
        break;
      }
    }
    if (!placed) tiers[tiers.length - 1].amount += lot.amount;
  }

  // 清理空档
  result.tiers = tiers.filter(t => t.amount > 0);
  result.totalHolding = Number(totalHolding.toFixed(2));

  return result;
};
