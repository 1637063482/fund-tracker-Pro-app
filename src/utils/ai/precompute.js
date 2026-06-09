// 本地预计算层 — 将确定性的、规则化的计算前置到 JS 端
// 避免 AI 每轮重新分析同一份原始数据，节省输入 + 输出 token
import { analyzeHoldingPeriods } from './fifo';
import { classifyFundType, classifyAssetClass } from '../fundClassifier';

// ============================================================================
// DataCache — 同次对话内缓存预计算结果，避免重复遍历
// 失效条件：totalCurrentValue 变化 / 持仓数变化 / 跨日
// ============================================================================
let _cache = null;

export const getDataCache = (portfolioStats, settings) => {
  const currentDate = new Date().toDateString();
  const currentValue = portfolioStats.totalCurrentValue || 0;
  const fundCount = portfolioStats.computedFundsWithMetrics?.filter(f => f.currentValue > 0 && !f.isArchived).length || 0;
  const snapshotKey = `${currentValue}|${fundCount}|${currentDate}`;

  if (_cache && _cache._snapshotKey === snapshotKey) return _cache;

  const insights = precomputePortfolioInsights(portfolioStats, settings);
  _cache = {
    _snapshotKey: snapshotKey,
    ...insights,
    getFund(fundCode) {
      return (insights.fundList || []).find(f => f.code === fundCode) || null;
    },
    getTradeWarnings() {
      return insights.alerts || [];
    }
  };
  return _cache;
};

export const clearDataCache = () => { _cache = null; };

// ============================================================================
// 主入口：预计算全量持仓洞察
// ============================================================================
export const precomputePortfolioInsights = (portfolioStats, settings) => {
  const todayIso = new Date().toISOString().split('T')[0];
  const activeFunds = (portfolioStats.computedFundsWithMetrics || [])
    .filter(f => f.currentValue > 0 && !f.isArchived);

  const totalValue = portfolioStats.totalCurrentValue || 1;
  const idleFunds = Number(settings.idleFunds) || 0;

  // --- 1. 紧凑持仓表格 ---
  let portfolioTable = '';
  const feeTraps = [];
  const concentrationRisks = [];
  const categoryWeights = {};
  const fundList = [];

  for (const f of activeFunds) {
    const name = (f.name || '').substring(0, 10);
    const code = f.fundCode || '?';
    const shares = Number(f.shares) || 0;
    const value = f.currentValue || 0;
    const profitRate = f.totalInvested > 0 ? ((f.profit / f.totalInvested) * 100) : 0;
    const xirr = f.xirr != null ? f.xirr * 100 : null;
    const typeTag = classifyFundType(f.name || '');
    const weight = totalValue > 0 ? ((value / totalValue) * 100) : 0;

    // 赎回费陷阱检测
    const sortedTx = [...(f.transactions || [])].sort((a, b) => new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt));
    const fees = f.redemptionFees || {};
    const breakpoints = fees.breakpoints || [7, 30, 180, 365];
    const rates = fees.rates || [fees.d0_7, fees.d7_30, fees.d30_180, fees.d180_365, fees.d365_plus];
    const holding = analyzeHoldingPeriods(sortedTx, todayIso, breakpoints);

    let trapMark = '';
    if (holding.totalHolding > 0 && holding.tiers.length > 0) {
      let totalEstFee = 0;
      let shortAmount = 0;
      for (let i = 0; i < holding.tiers.length; i++) {
        const t = holding.tiers[i];
        const rateStr = rates[t.rateIndex] !== undefined && rates[t.rateIndex] !== '' ? rates[t.rateIndex] : null;
        const rate = rateStr !== null ? parseFloat(rateStr) : null;
        if (rate !== null) {
          totalEstFee += t.amount * rate / 100;
        }
        // 持有<30天(前两层)标记为短期陷阱
        if (t.rateIndex <= 1) shortAmount += t.amount;
      }
      if (shortAmount > 0 && totalEstFee > 10) {
        trapMark = ' ⚠️短';
        feeTraps.push({
          fundCode: code,
          fundName: name,
          shortAmount: Math.round(shortAmount),
          estimatedFee: Math.round(totalEstFee)
        });
      }
    }

    // 大类资产权重累计
    const cat = classifyAssetClass(f.name || '');
    categoryWeights[cat] = (categoryWeights[cat] || 0) + weight;

    // 集中度检测
    if (weight > 30) {
      concentrationRisks.push({ type: '单只>30%', fund: name, weight: weight.toFixed(1) + '%' });
    }

    // 基金列表
    fundList.push({ name, code, value, profitRate, xirr, weight, typeTag, trapMark });

    // 紧凑行：名称│代码│份额│市值│盈亏率│XIRR│占比│类型│标记
    const xirrStr = xirr !== null ? xirr.toFixed(1) + '%' : '-';
    const profitStr = (profitRate >= 0 ? '+' : '') + profitRate.toFixed(1) + '%';
    const sharesStr = shares > 0 ? (shares >= 1000 ? Math.round(shares).toLocaleString() : shares.toFixed(2)) : '?';
    portfolioTable += `${name.padEnd(8)}│${code}│${sharesStr.padStart(8)}│${String(Math.round(value)).padStart(8)}│${profitStr.padStart(7)}│${xirrStr.padStart(6)}│${weight.toFixed(1).padStart(4)}%│${typeTag.padEnd(9)}${trapMark}\n`;
  }

  // 大类集中度检测
  for (const [cat, w] of Object.entries(categoryWeights)) {
    if (w > 60) {
      concentrationRisks.push({ type: '大类>60%', fund: cat, weight: w.toFixed(1) + '%' });
    }
  }

  // --- 2. 组合摘要 ---
  const summary = {
    totalValue: Math.round(portfolioStats.totalCurrentValue || 0),
    totalProfit: Math.round(portfolioStats.totalProfit || 0),
    overallXirr: portfolioStats.overallXirr || 0,
    simpleReturn: portfolioStats.overallSimpleReturn || 0,
    idleFunds,
    fundCount: activeFunds.length,
    monthsLeft: portfolioStats.monthsLeft || 0,
    requiredMonthly: portfolioStats.requiredMonthly || 0,
    alpha: portfolioStats.alpha || 0,
    deviationAmount: portfolioStats.deviationAmount || 0,
  };

  // --- 3. 风控标记(紧凑文本，直接注入) ---
  const alerts = [];
  if (feeTraps.length > 0) {
    const trapSummary = feeTraps.map(t => `${t.fundCode}(${t.shortAmount}元↘费≈${t.estimatedFee}元)`).join(', ');
    const trapCodes = new Set(feeTraps.map(t => t.fundCode));
    const noTrapCount = activeFunds.length - trapCodes.size;
    const note = noTrapCount > 0 ? `（其余${noTrapCount}只无赎回费问题）` : '';
    alerts.push(`⚠️赎回陷阱: ${trapSummary}${note}`);
  }
  if (idleFunds > totalValue * 0.3) {
    alerts.push(`⚠️闲置资金占比${((idleFunds / totalValue) * 100).toFixed(0)}%，过高`);
  }

  return {
    portfolioTable,
    fundList,
    feeTraps,
    concentrationRisks,
    summary,
    alerts,
    categoryWeights,
  };
};
