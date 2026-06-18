// 基金指标统一计算 Hook：合并 useBaseFundsData + usePortfolioStats
// XIRR 同步计算，消除 setTimeout(0) + setXirrMap 导致的双重重算
// v2: 分层 useMemo —— AI 参数等无关 settings 字段不再触发全量 XIRR 重算
import { useMemo } from 'react';
import { evaluateExpression, calculateXIRR } from '../utils/helpers';

export function useFundMetrics(funds, fundNavs, settings, fundProfiles) {
  const safeFunds = funds || [];
  const safeNavs = fundNavs || {};
  const safeSettings = settings || {};
  const safeProfiles = fundProfiles || {};
  // 提取真正影响组合计算的 settings 字段，避免 AI 参数（temperature、
  // maxOutputTokens、reasoningEffort、aiProvider 等）变更触发全量重算
  const targetAmount = safeSettings.targetAmount;
  const targetDate = safeSettings.targetDate;
  const targetAnnualRate = safeSettings.targetAnnualRate;

  // ━━━ 第一层：基金基础指标 + XIRR + 全盘汇总 + 衍生指标 ━━━
  // 仅依赖 funds / fundNavs / fundProfiles，不受 AI 参数等 settings 变更影响
  const baseResult = useMemo(() => {
    const globalCashFlows = [];

    // ── 第一步：逐只基金基础指标 + XIRR ──
    const baseFunds = safeFunds.map(f => {
      let totalInvested = 0;
      let realizedReturns = 0;
      const cashFlows = [];

      (f.transactions || []).forEach(t => {
        const rawAmt = evaluateExpression(t.amountRaw);
        const inferredType = t.type || (rawAmt < 0 ? 'buy' : 'sell');
        const amt = Math.round(Math.abs(rawAmt) * 100) / 100;

        if (inferredType === 'buy' || inferredType === 'fee') {
          totalInvested += amt;
          cashFlows.push({ date: t.date, amount: -amt });
          globalCashFlows.push({ date: t.date, amount: -amt });
        } else if (inferredType === 'sell' || inferredType === 'dividend_cash') {
          realizedReturns += amt;
          cashFlows.push({ date: t.date, amount: amt });
          globalCashFlows.push({ date: t.date, amount: amt });
        }
        // dividend_reinvest: no cash flow
      });

      // 当前市值
      let currentVal = 0;
      if (f.isArchived) {
        currentVal = 0;
      } else if (f.mode === 'auto') {
        const navObj = safeNavs[f.fundCode];
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

      // 终值加入现金流用于 XIRR
      if (currentVal > 0) {
        cashFlows.push({ date: new Date().toISOString().split('T')[0], amount: currentVal });
      }

      const profit = currentVal + realizedReturns - totalInvested;
      const simpleReturn = totalInvested === 0 ? 0 : profit / totalInvested;
      const netInvested = Math.max(0, totalInvested - realizedReturns);
      const xirr = calculateXIRR(cashFlows);

      return { ...f, xirr, profit, simpleReturn, totalInvested, netInvested, currentValue: currentVal };
    });

    // ── 第二步：全盘汇总 ──
    const portfolioTotalCurrentValue = baseFunds.reduce((sum, f) => sum + f.currentValue, 0);
    const portfolioTotalInvested = baseFunds.reduce((sum, f) => sum + f.totalInvested, 0);
    const portfolioTotalProfit = baseFunds.reduce((sum, f) => sum + f.profit, 0);
    const overallSimpleReturn = portfolioTotalInvested === 0 ? 0 : portfolioTotalProfit / portfolioTotalInvested;

    // 全盘 XIRR（含终值）
    const finalTotalCurrentValue = Math.round(portfolioTotalCurrentValue * 100) / 100;
    if (finalTotalCurrentValue > 0) {
      globalCashFlows.push({
        date: new Date().toISOString().split('T')[0],
        amount: finalTotalCurrentValue,
        isTerminal: true
      });
    }
    const overallXirr = calculateXIRR(globalCashFlows);

    // ── 第三步：衍生指标（持股占比、贡献度、排名、资产配置等） ──
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

    // 饼图数据
    const pieData = computedFundsWithMetrics
      .filter(f => f.currentValue > 0 && !f.isArchived)
      .map(f => ({ name: f.name, value: f.currentValue }))
      .sort((a, b) => b.value - a.value);

    const contributionPieData = computedFundsWithMetrics
      .filter(f => f.contribution > 0)
      .map(f => ({ name: f.name, value: f.contribution }))
      .sort((a, b) => b.value - a.value);

    // 大类资产配置
    const assetAllocation = {};
    computedFundsWithMetrics.forEach(f => {
      if (f.currentValue <= 0 || f.isArchived) return;
      const profile = safeProfiles[f.fundCode];
      let category = "其他偏股/未分类";
      if (profile?.op_fund?.fund_tags) {
        const typeTag = profile.op_fund.fund_tags.find(t => t.category === "1");
        if (typeTag) category = typeTag.name;
        else if (profile.type_desc) category = profile.type_desc;
      } else if (f.name.includes("债")) {
        category = "债券型";
      }
      assetAllocation[category] = (assetAllocation[category] || 0) + f.currentValue;
    });
    const assetAllocationData = Object.keys(assetAllocation)
      .map(k => ({ name: k, value: assetAllocation[k] }))
      .sort((a, b) => b.value - a.value);

    // 排名
    const rankedByXirr = [...computedFundsWithMetrics].filter(f => f.transactions?.length > 0).sort((a, b) => b.xirr - a.xirr);
    const rankedBySimpleReturn = [...computedFundsWithMetrics].filter(f => f.transactions?.length > 0).sort((a, b) => b.simpleReturn - a.simpleReturn);
    const rankedByProfit = [...computedFundsWithMetrics].filter(f => f.transactions?.length > 0).sort((a, b) => b.profit - a.profit);

    const netTotalInvested = Math.max(0, portfolioTotalCurrentValue - portfolioTotalProfit);

    return {
      baseFunds,
      globalCashFlows,
      portfolioTotalCurrentValue,
      overallXirr,
      portfolioTotalProfit,
      overallSimpleReturn,
      pieData,
      contributionPieData,
      assetAllocationData,
      rankedByXirr,
      rankedBySimpleReturn,
      rankedByProfit,
      computedFundsWithMetrics,
      netTotalInvested,
    };
  }, [funds, fundNavs, fundProfiles]);

  // ━━━ 第二层：目标规划 + 最终合并 ━━━
  // 仅在 baseResult 或三个目标设定字段变化时重算。
  // AI 参数（temperature / maxOutputTokens / reasoningEffort 等）变更
  // 不会穿透第一层，此处仅执行轻量算术运算。
  const result = useMemo(() => {
    const {
      baseFunds,
      globalCashFlows,
      portfolioTotalCurrentValue,
      overallXirr,
      portfolioTotalProfit,
      overallSimpleReturn,
      pieData,
      contributionPieData,
      assetAllocationData,
      rankedByXirr,
      rankedBySimpleReturn,
      rankedByProfit,
      computedFundsWithMetrics,
      netTotalInvested,
    } = baseResult;

    // ── 第四步：目标规划（Alpha、偏离、投影等） ──
    const safeTargetAmount = Number(targetAmount) || 0;
    const gap = Math.max(0, safeTargetAmount - portfolioTotalProfit);
    const today = new Date();
    const target = new Date(targetDate);
    const monthsLeft = Math.max(1, (target.getFullYear() - today.getFullYear()) * 12 + target.getMonth() - today.getMonth());
    let projectedAssets = portfolioTotalCurrentValue;
    if (overallXirr > 0 && monthsLeft > 0) {
      projectedAssets = portfolioTotalCurrentValue * Math.pow(1 + overallXirr, monthsLeft / 12);
    }

    const rate = Number(targetAnnualRate) || 5;
    let baselineValue = 0;
    globalCashFlows.forEach(cf => {
      if (cf.amount < 0) {
        const days = (new Date() - new Date(cf.date)) / (1000 * 60 * 60 * 24);
        const years = Math.max(0, days / 365);
        baselineValue += Math.abs(cf.amount) * Math.pow(1 + (rate / 100), years);
      } else if (cf.amount > 0 && !cf.isTerminal) {
        baselineValue -= cf.amount;
      }
    });
    baselineValue = Math.max(0, baselineValue);
    const deviationAmount = portfolioTotalCurrentValue - baselineValue;
    const alpha = overallXirr - (rate / 100);

    return {
      // 前端渲染需要的原始基金列表
      baseFundsData: baseFunds,
      // 兼容旧接口（PortfolioAnalysisModal 等直接消费 portfolioStats）
      portfolioStats: {
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
        safeTargetAmount, targetAnnualRate: rate,
        projectedAssets,
        baselineValue, deviationAmount,
      },
    };
  }, [baseResult, targetAmount, targetDate, targetAnnualRate]);

  return result;
}
