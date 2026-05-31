// 投资组合统计 Hook：基于基金数据计算饼图、持仓占比、资产配置、排名等衍生分析指标
import { useMemo } from 'react';

export function usePortfolioStats(baseFundsData, settings, overallXirr, globalPreCashFlows, xirrMap, fundProfiles) {
  return useMemo(() => {
    if (!baseFundsData) return { pieData: [], contributionPieData: [], assetAllocationData: [], rankedByXirr: [], rankedBySimpleReturn: [], rankedByProfit: [], computedFundsWithMetrics: [], alpha: 0 };

    const baseFunds = baseFundsData.map(f => ({ ...f, xirr: xirrMap[f.id] || 0 }));

    const portfolioTotalCurrentValue = baseFunds.reduce((sum, f) => sum + f.currentValue, 0);
    const portfolioTotalInvested = baseFunds.reduce((sum, f) => sum + f.totalInvested, 0);
    const portfolioTotalProfit = baseFunds.reduce((sum, f) => sum + f.profit, 0);
    const overallSimpleReturn = portfolioTotalInvested === 0 ? 0 : portfolioTotalProfit / portfolioTotalInvested;

    const computedFundsWithMetrics = baseFunds.map(f => {
      const holdingWeight = portfolioTotalCurrentValue === 0 ? 0 : (f.currentValue / portfolioTotalCurrentValue);
      let profitWeight = 0;

      if (portfolioTotalProfit > 0 && f.profit > 0) {
        profitWeight = f.profit / portfolioTotalProfit;
      } else if (portfolioTotalProfit < 0 && f.profit < 0) {
        profitWeight = f.profit / portfolioTotalProfit;
      }
      const contribution = portfolioTotalInvested === 0 ? 0 : f.profit / portfolioTotalInvested;

      return { ...f, holdingWeight, profitWeight, contribution };
    });

    const pieData = computedFundsWithMetrics
      .filter(f => f.currentValue > 0 && !f.isArchived)
      .map(f => ({ name: f.name, value: f.currentValue }))
      .sort((a, b) => b.value - a.value);

    const contributionPieData = computedFundsWithMetrics
      .filter(f => f.contribution > 0)
      .map(f => ({ name: f.name, value: f.contribution }))
      .sort((a, b) => b.value - a.value);

    const assetAllocation = {};
    computedFundsWithMetrics.forEach(f => {
      if (f.currentValue <= 0 || f.isArchived) return;
      const profile = fundProfiles[f.fundCode];
      let category = "其他偏股/未分类";
      if (profile && profile.op_fund && profile.op_fund.fund_tags) {
        const typeTag = profile.op_fund.fund_tags.find(t => t.category === "1");
        if (typeTag) category = typeTag.name;
        else if (profile.type_desc) category = profile.type_desc;
      } else if (f.name.includes("债")) {
        category = "债券型";
      }
      assetAllocation[category] = (assetAllocation[category] || 0) + f.currentValue;
    });
    const assetAllocationData = Object.keys(assetAllocation).map(k => ({ name: k, value: assetAllocation[k] })).sort((a, b) => b.value - a.value);

    const rankedByXirr = [...computedFundsWithMetrics].filter(f => f.transactions.length > 0).sort((a, b) => b.xirr - a.xirr);
    const rankedBySimpleReturn = [...computedFundsWithMetrics].filter(f => f.transactions.length > 0).sort((a, b) => b.simpleReturn - a.simpleReturn);
    const rankedByProfit = [...computedFundsWithMetrics].filter(f => f.transactions.length > 0).sort((a, b) => b.profit - a.profit);

    const netTotalInvested = Math.max(0, portfolioTotalCurrentValue - portfolioTotalProfit);
    const safeTargetAmount = Number(settings.targetAmount) || 0;
    const gap = Math.max(0, safeTargetAmount - portfolioTotalProfit);
    const today = new Date();
    const target = new Date(settings.targetDate);
    const monthsLeft = Math.max(1, (target.getFullYear() - today.getFullYear()) * 12 + target.getMonth() - today.getMonth());
    let projectedAssets = portfolioTotalCurrentValue;
    if (overallXirr > 0 && monthsLeft > 0) {
      projectedAssets = portfolioTotalCurrentValue * Math.pow(1 + overallXirr, monthsLeft / 12);
    }

    const targetAnnualRate = Number(settings.targetAnnualRate) || 5;
    let expectedDailyProfit = 0;
    let daysToBreakEven = null;
    let baselineValue = 0;

    globalPreCashFlows.forEach(cf => {
      if (cf.amount < 0) {
        const days = (new Date() - new Date(cf.date)) / (1000 * 60 * 60 * 24);
        const years = Math.max(0, days / 365);
        baselineValue += Math.abs(cf.amount) * Math.pow(1 + (targetAnnualRate / 100), years);
      } else if (cf.amount > 0 && !cf.isTerminal) {
        baselineValue -= cf.amount;
      }
    });

    baselineValue = Math.max(0, baselineValue);
    const deviationAmount = portfolioTotalCurrentValue - baselineValue;

    const alpha = overallXirr - (targetAnnualRate / 100);

    return {
      totalInvested: netTotalInvested,
      totalCurrentValue: Math.round(portfolioTotalCurrentValue * 100) / 100,
      overallXirr,
      totalProfit: Math.round(portfolioTotalProfit * 100) / 100,
      overallSimpleReturn,
      pieData,
      contributionPieData,
      assetAllocationData,
      rankedByXirr,
      rankedBySimpleReturn,
      rankedByProfit,
      computedFundsWithMetrics,
      alpha,
      gap, monthsLeft, requiredMonthly: gap / monthsLeft,
      safeTargetAmount, targetAnnualRate,
      projectedAssets, daysToBreakEven, expectedDailyProfit,
      baselineValue, deviationAmount
    };
  }, [baseFundsData, settings, overallXirr, globalPreCashFlows, xirrMap, fundProfiles]);
}
