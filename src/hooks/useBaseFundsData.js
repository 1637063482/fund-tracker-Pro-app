// 基金基础数据计算 Hook：汇总每只基金的净投入、持仓市值、盈亏、XIRR 与简单收益率等核心指标
import { useMemo } from 'react';
import { evaluateExpression } from '../utils/helpers';

export function useBaseFundsData(funds, fundNavs, xirrMap) {
  return useMemo(() => {
    const globalPreCashFlows = [];

    const baseFundsData = funds.map(f => {
      let totalInvested = 0;
      let realizedReturns = 0;
      let cashFlowsForXirr = [];

      (f.transactions || []).forEach(t => {
        const rawAmt = evaluateExpression(t.amountRaw);
        const inferredType = t.type || (rawAmt < 0 ? 'buy' : 'sell');

        let amt = Math.round(Math.abs(rawAmt) * 100) / 100;

        if (inferredType === 'buy' || inferredType === 'fee') {
          totalInvested += amt;
          cashFlowsForXirr.push({ date: t.date, amount: -amt });
          globalPreCashFlows.push({ date: t.date, amount: -amt });
        } else if (inferredType === 'sell' || inferredType === 'dividend_cash') {
          realizedReturns += amt;
          cashFlowsForXirr.push({ date: t.date, amount: amt });
          globalPreCashFlows.push({ date: t.date, amount: amt });
        } else if (inferredType === 'dividend_reinvest') {
        }
      });

      let currentVal = 0;
      if (f.isArchived) {
        currentVal = 0;
      } else if (f.mode === 'auto') {
        const navObj = fundNavs[f.fundCode];
        const nav = navObj ? navObj.nav : (f.lastNav || 0);
        currentVal = (Number(f.shares) || 0) * nav;
        if (currentVal === 0 && f.currentValueRaw) {
          const oldVal = evaluateExpression(f.currentValueRaw);
          if (!isNaN(oldVal)) currentVal = oldVal;
        }
      } else {
        currentVal = evaluateExpression(f.currentValueRaw) || 0;
      }

      currentVal = Math.round(currentVal * 100) / 100;

      if (currentVal > 0) {
        cashFlowsForXirr.push({ date: new Date().toISOString().split('T')[0], amount: currentVal });
      }

      const profit = currentVal + realizedReturns - totalInvested;
      const simpleReturn = totalInvested === 0 ? 0 : profit / totalInvested;
      const netInvested = Math.max(0, totalInvested - realizedReturns);
      return { ...f, xirr: xirrMap[f.id] || 0, profit, simpleReturn, totalInvested, netInvested, currentValue: currentVal, _flows: cashFlowsForXirr };
    });

    const totalCurrentValue = baseFundsData.reduce((sum, f) => sum + f.currentValue, 0);
    const finalTotalCurrentValue = Math.round(totalCurrentValue * 100) / 100;

    if (finalTotalCurrentValue > 0) {
      globalPreCashFlows.push({
        date: new Date().toISOString().split('T')[0],
        amount: finalTotalCurrentValue,
        isTerminal: true
      });
    }

    const preXirrPayloads = baseFundsData.map(f => ({ id: f.id, flows: f._flows }));
    return { baseFundsData, preXirrPayloads, globalPreCashFlows };
  }, [funds, fundNavs, xirrMap]);
}
