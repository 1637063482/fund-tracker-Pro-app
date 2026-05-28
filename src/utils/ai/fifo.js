// FIFO 先进先出 7天惩罚费风控拦截
export const calculate7DayPenalty = (transactions, currentDateStr) => {
  if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
    return { lockedAmount: 0, penaltyFee: 0 };
  }

  let buyLots = [];

  // 1. 历史回溯：先进先出抵扣
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

  // 2. 结算未满 7 天的锁定金额
  let lockedAmount = 0;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const nowTimestamp = new Date(currentDateStr).getTime();

  for (const lot of buyLots) {
    if (!lot.date) continue;
    const lotTimestamp = new Date(lot.date).getTime();
    if (nowTimestamp - lotTimestamp < SEVEN_DAYS_MS) {
      lockedAmount += lot.amount;
    }
  }

  return {
    lockedAmount: Number(lockedAmount.toFixed(2)),
    penaltyFee: Number((lockedAmount * 0.015).toFixed(2))
  };
};
