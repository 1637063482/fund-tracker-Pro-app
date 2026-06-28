// 评分回测引擎 — 系统性验证打分预测效力
// 将 Meta-Vigilance 自检回顾从定性判断升级为统计验证
// 输出可直接反哺 Ω 校准（替代固定 Sigmoid）
import { logBacktestStart, logBacktestOverview, logBacktestCIO, logBacktestHorizon, logBacktestCalibration, logMetaVigilance, logDegradation, logOLSCalibrationStart, logOLSWindow, logOLSBetas, logOLSWeights } from './quantLogger';

/**
 * 计算评分回测指标
 * @param {Array} scoreHistory - [{date, equity:{final, verdict}, bond:{final}}]
 * @param {Object} marketData - {date: {shPct, cybPct, shClose}}
 * @param {number[]} forwardHorizons - 前向检验窗口 [1,3,5,10,20]
 * @returns {Object} 回测报告
 */
export function computeBacktest(scoreHistory, marketData, forwardHorizons = [1, 3, 5, 10, 20]) {
  if (!scoreHistory || scoreHistory.length < 5) {
    return { error: '历史打分记录不足（需≥5条）' };
  }

  const results = {
    overview: {},
    byCIOOutcome: {},
    byHorizon: {},
    calibration: {},
    rawSamples: [],
    byFactorDominance: {
      'F1a_dominant': { total: 0, correct: 0, samples: [] },
      'F1b_dominant': { total: 0, correct: 0, samples: [] },
      'F3_dominant':  { total: 0, correct: 0, samples: [] },
      'F4_dominant':  { total: 0, correct: 0, samples: [] },
      'mixed':        { total: 0, correct: 0, samples: [] }
    },
    _scoreHistory: scoreHistory,
    _marketData: marketData
  };

  let totalPredictions = 0;
  let correctDirections = 0;
  const outcomeStats = {};   // category → {total, correct}
  const horizonStats = {};
  for (const h of forwardHorizons) horizonStats[h] = { total: 0, correct: 0, samples: [] };

  // 用于校准相关性
  const correlationSamples = [];  // {score, marketReturn, predictedDir, dirType}

  // 遍历每个打分日
  for (const snap of scoreHistory) {
    const scoreDate = snap.date;
    const eq = snap.equity;
    if (!eq || eq.final == null) continue;

    const { dir: predictedDir, confidence, category } = deriveExpectedDirection(snap);
    if (!predictedDir) continue;  // null → 不参与方向统计和校准相关性

    // 查找每个前向窗口的实际走势
    for (const h of forwardHorizons) {
      const fwdDate = addTradingDays(scoreDate, h, marketData);
      if (!fwdDate) continue;

      const startData = getMarketData(scoreDate, marketData);
      const endData = getMarketData(fwdDate, marketData);
      if (!startData || !endData) continue;

      // 构建多指数收益率
      const returns = {
        sh: startData.shClose != null ? (endData.shClose - startData.shClose) / startData.shClose : 0,
        cyb: startData.cybClose != null && endData.cybClose != null ? (endData.cybClose - startData.cybClose) / startData.cybClose : null,
        sz: startData.szClose != null && endData.szClose != null ? (endData.szClose - startData.szClose) / startData.szClose : null
      };

      // 按因子主导性选择对应指数
      const marketReturn = selectRelevantReturn(eq, returns);
      const marketDir = getMarketDirection(marketReturn, predictedDir);

      if (marketDir === 'neutral') continue;

      const match = predictedDir === 'up' || predictedDir === 'weak_up' ? marketDir === 'up' : marketDir === 'down';
      totalPredictions++;
      if (match) correctDirections++;

      // 按 CIO 映射后分组统计
      if (!outcomeStats[category]) outcomeStats[category] = { total: 0, correct: 0 };
      outcomeStats[category].total++;
      if (match) outcomeStats[category].correct++;

      // 前向窗口统计
      horizonStats[h].total++;
      if (match) horizonStats[h].correct++;
      horizonStats[h].samples.push({ date: scoreDate, score: eq.final, verdict: eq.verdict, category, predictedDir, marketDir, marketReturn, horizon: h, confidence });

      // 🆕 按因子主导性分组
      const dominant = getFactorDominance(eq);
      if (results.byFactorDominance[dominant]) {
        results.byFactorDominance[dominant].total++;
        if (match) results.byFactorDominance[dominant].correct++;
        results.byFactorDominance[dominant].samples.push({
          date: scoreDate, f1a: eq.F1a, f1b: eq.F1b, f3: eq.F3,
          predictedDir, marketDir, marketReturn
        });
      }

      // 只在 h=1 时记录一次
      if (h === forwardHorizons[0]) {
        results.rawSamples.push({ date: scoreDate, score: eq.final, verdict: eq.verdict, category, predictedDir, marketDir, marketReturn, confidence });
      }
    }
  }

  // 校准相关性：收集所有非 null 预测的 (score, marketReturn) 对
  for (const snap of scoreHistory) {
    const eq = snap.equity;
    if (!eq || eq.final == null) continue;
    const { dir: predictedDir } = deriveExpectedDirection(snap);
    if (!predictedDir) continue;
    const fwdDate = addTradingDays(snap.date, forwardHorizons[0], marketData);
    if (!fwdDate) continue;
    const startData = getMarketData(snap.date, marketData);
    const endData = getMarketData(fwdDate, marketData);
    if (!startData || !endData) continue;
    const mr = (endData.shClose - startData.shClose) / startData.shClose;
    correlationSamples.push({ score: eq.final, marketReturn: mr, predictedDir });
  }

  // ── 诊断信息（始终展示，不设 <20 限制）──
  const totalSnapshots = scoreHistory.length;
  const withScores = scoreHistory.filter(s => s.equity?.final != null).length;
  const allDirs = scoreHistory.map(s => deriveExpectedDirection(s));
  const withDir = allDirs.filter(d => d.dir).length;
  const withNullDir = allDirs.filter(d => !d.dir).length;
  const categoryBreakdown = {};
  for (const d of allDirs) {
    if (!categoryBreakdown[d.category]) categoryBreakdown[d.category] = 0;
    categoryBreakdown[d.category]++;
  }

  results.overview = {
    totalPredictions,
    correctDirections,
    accuracy: totalPredictions > 0 ? (correctDirections / totalPredictions * 100) : 0,
    grade: totalPredictions > 0 ? (
      correctDirections / totalPredictions > 0.65 ? '🟢 优秀(>65%)' :
      correctDirections / totalPredictions > 0.55 ? '🟡 可用(55-65%)' :
      correctDirections / totalPredictions > 0.50 ? '⚠️ 勉强(50-55%,接近随机)' :
      '🔴 无效(<50%,不如抛硬币)'
    ) : '数据不足',
    // 诊断：显示样本流失原因
    _diag: {
      快照总数: totalSnapshots, 有效打分: withScores,
      '有方向预测': withDir, '无方向预测(持观/锁仓等)': withNullDir,
      K线日期数: Object.keys(marketData).length,
      理论最大预测: withDir * 5, 实际预测: totalPredictions,
      首快照: scoreHistory[0]?.date, 末快照: scoreHistory[scoreHistory.length-1]?.date,
      K线日期范围: Object.keys(marketData).sort()[0] + '~' + Object.keys(marketData).sort().pop(),
      CIO分类明细: categoryBreakdown,
      流失原因: '①打分日无对应K线 ②T+N超出范围 ③实际走势未达方向阈值(up≥0.5%/weak_up≥0.3%/down<-0.5%)'
    }
  };

  // ── 按 CIO 映射分组准确率 ──
  results.byCIOOutcome = {};
  for (const [category, stats] of Object.entries(outcomeStats)) {
    results.byCIOOutcome[category] = {
      ...stats,
      accuracy: stats.total > 0 ? (stats.correct / stats.total * 100).toFixed(1) + '%' : 'N/A'
    };
  }

  // ── 按因子主导性分组准确率 ──
  for (const [key, stats] of Object.entries(results.byFactorDominance)) {
    stats.accuracy = stats.total > 0
      ? (stats.correct / stats.total * 100).toFixed(1) + '%'
      : 'N/A';
  }

  // ── 前向窗口准确率衰减 ──
  results.byHorizon = {};
  for (const [h, stats] of Object.entries(horizonStats)) {
    results.byHorizon[h] = {
      observations: stats.total,
      accuracy: stats.total > 0 ? (stats.correct / stats.total * 100) : 0,
      avgReturnWhenCorrect: stats.samples.filter(s => {
        const isUp = s.predictedDir === 'up' || s.predictedDir === 'weak_up';
        const md = getMarketDirection(s.marketReturn, s.predictedDir);
        return isUp ? md === 'up' : md === 'down';
      }).reduce((sum, s) => sum + Math.abs(s.marketReturn), 0) / Math.max(1, stats.correct)
    };
  }

  // ── 校准评估 ──
  // 1. 分数-收益相关性（Spearman 近似）
  let correlation = null;
  if (correlationSamples.length >= 5) {
    const ranked = correlationSamples
      .map((s, i) => ({ ...s, idx: i }))
      .sort((a, b) => a.score - b.score);
    ranked.forEach((s, i) => s.scoreRank = i + 1);
    ranked.sort((a, b) => a.marketReturn - b.marketReturn);
    ranked.forEach((s, i) => s.retRank = i + 1);
    const n = ranked.length;
    const sumD2 = ranked.reduce((sum, s) => sum + Math.pow(s.scoreRank - s.retRank, 2), 0);
    correlation = 1 - (6 * sumD2) / (n * (n * n - 1));
  }

  results.calibration = {
    spearmanCorrelation: correlation != null ? parseFloat(correlation.toFixed(3)) : null,
    correlationNote: correlation != null
      ? (correlation > 0.3 ? '✅ 分数与收益正相关(分数越高实际涨幅越大)' :
         correlation > 0 ? '⚠️ 弱正相关(分数与收益关联度低)' :
         '🔴 负相关(高分对应更差收益，模型方向反了)')
      : '样本不足,无法计算相关系数',
    totalCorrelationSamples: correlationSamples.length,
    note: `Spearman ρ=${correlation != null ? correlation.toFixed(3) : 'N/A'} | ${correlationSamples.length}次观测`
  };

  // ── 重构前后分界对比 ──
  const REFACTOR_DATE = '2026-06-19';
  const oldScores = scoreHistory.filter(s => s.date < REFACTOR_DATE);
  const newScores = scoreHistory.filter(s => s.date >= REFACTOR_DATE);
  if (oldScores.length >= 5 && newScores.length >= 5) {
    const oldAcc = computeSubAccuracy(oldScores, marketData, forwardHorizons);
    const newAcc = computeSubAccuracy(newScores, marketData, forwardHorizons);
    results.prePostComparison = {
      oldSystem: { samples: oldScores.length, accuracy: parseFloat(oldAcc.toFixed(1)) },
      newSystem: { samples: newScores.length, accuracy: parseFloat(newAcc.toFixed(1)) },
      delta: parseFloat((newAcc - oldAcc).toFixed(1)),
      note: newAcc > oldAcc ? '✅ 新系统优于旧系统' : newAcc < oldAcc ? '⚠️ 新系统暂不如旧系统,需更多样本' : '➡️ 两者持平'
    };
  }

  // ── Ω 建议 ──
  const overallAcc = results.overview.accuracy / 100;
  results.omegaSuggestion = {
    rawAccuracy: parseFloat(overallAcc.toFixed(3)),
    recommendedOmega: overallAcc > 0 ? parseFloat((0.1 + 0.8 / (1 + Math.exp(-(overallAcc - 0.5) * 5))).toFixed(3)) : 0.5,
    note: '此值可直接替换 calibrateConfidence 的 rawAccuracy 参数'
  };

  // 控制台探针输出
  logBacktestStart(scoreHistory.length, Object.keys(marketData).length, forwardHorizons);
  logBacktestOverview(results.overview);
  logBacktestCIO(results.byCIOOutcome);
  logBacktestHorizon(results.byHorizon);
  logBacktestCalibration(results.calibration, results.omegaSuggestion);

  return results;
}

// ── CIO 矩阵 → 预期方向映射 ──

/**
 * 将 verdict+final+子因子 按 CIO 矩阵映射为预期方向
 * @param {Object} snap - {equity:{final,verdict,F1a,F1b,F2,F3,F4,F1}}
 * @returns {{dir:('up'|'weak_up'|'down'|null), confidence:('high'|'medium'|'low'|'none'), category:string}}
 *   dir=null 表示不参与方向统计(持观/锁仓/BLACK_LIST等)
 */
export function deriveExpectedDirection(snap) {
  const eq = snap.equity || {};
  const final = eq.final;
  const F1 = eq.F1 ?? ((eq.F1a ?? 0) + (eq.F1b ?? 0));
  const F2 = eq.F2;

  if (final == null) {
    return { dir: null, confidence: 'none', category: '无判定' };
  }

  // 若无 verdict，从 final 推断（兼容 LLM 未传 verdict 的快照）
  const verdict = eq.verdict || (final >= 55 ? 'BUY_STRATEGY' : final >= 35 ? 'HOLD_STRATEGY' : 'WATCH_GRID');

  // ── BLACK_LIST: 非方向预测 ──
  if (verdict === 'BLACK_LIST') {
    return { dir: null, confidence: 'none', category: 'BLACK_LIST' };
  }

  // ── BUY_STRATEGY / HOLD_STRATEGY ──
  if (verdict === 'BUY_STRATEGY' || verdict === 'HOLD_STRATEGY') {
    if (final >= 75) {
      return { dir: 'up', confidence: 'high', category: 'BUY/HOLD-主升确立' };
    }
    if (final >= 55) {
      return { dir: 'up', confidence: 'medium', category: 'BUY/HOLD-趋势修复' };
    }
    if (final >= 35) {
      return { dir: 'weak_up', confidence: 'low', category: 'BUY/HOLD-左侧磨底' };
    }
    // final < 35
    if (F1 >= 20 && F2 >= 8) {
      return { dir: 'weak_up', confidence: 'medium', category: 'BUY/HOLD-黄金坑低吸' };
    }
    if (F1 >= 20) {
      // F2 < 8
      return { dir: null, confidence: 'none', category: 'BUY/HOLD-便宜未企稳禁接' };
    }
    if (F1 >= 13) {
      return { dir: null, confidence: 'none', category: 'BUY/HOLD-持观' };
    }
    // F1 ≤ 12
    return { dir: 'down', confidence: 'medium', category: 'BUY/HOLD-警戒' };
  }

  // ── WATCH_GRID ──
  if (verdict === 'WATCH_GRID') {
    if (final > 85) {
      return { dir: 'up', confidence: 'medium', category: 'WATCH_GRID-黄金坑反弹' };
    }
    if (final >= 75) {
      return { dir: 'weak_up', confidence: 'low', category: 'WATCH_GRID-分批建仓' };
    }
    if (final >= 55) {
      return { dir: null, confidence: 'none', category: 'WATCH_GRID-持观' };
    }
    if (final >= 35) {
      return { dir: null, confidence: 'none', category: 'WATCH_GRID-锁利不加仓' };
    }
    // final < 35
    if (F1 >= 20) {
      return { dir: null, confidence: 'none', category: 'WATCH_GRID-锁仓' };
    }
    return { dir: 'down', confidence: 'medium', category: 'WATCH_GRID-清仓' };
  }

  return { dir: null, confidence: 'none', category: `未知Verdict-${verdict}` };
}

// ── 辅助函数 ──

function getMarketDirection(marketReturn, predictedDir) {
  const thresh = predictedDir === 'weak_up' ? 0.003 : 0.005;
  if (marketReturn > thresh) return 'up';
  if (marketReturn < -thresh) return 'down';
  return 'neutral';
}

/**
 * 根据打分主导因子选择验证指数收益率
 * @param {Object} eq — snap.equity {F1a, F1b, F2, F3, F4}
 * @param {Object} returns — {sh, cyb, sz, ...}
 * @returns {number} 用于方向验证的市场收益率
 */
export function selectRelevantReturn(eq, returns) {
  const f1a = eq.F1a ?? 0;
  const f1b = eq.F1b ?? 0;
  const f2 = eq.F2 ?? 0;
  const f3 = eq.F3 ?? 0;
  const f4 = eq.F4 ?? 0;
  const total = f1a + f1b + f2 + f3 + f4;
  if (total === 0) return returns.sh ?? 0;

  const f1bRatio = f1b / total;
  const f3Ratio = f3 / total;

  // F1b主导(≥25%) → 用创业板验证；降级：cyb不存在→sh
  if (f1bRatio >= 0.25) {
    return returns.cyb != null ? returns.cyb : (returns.sh ?? 0);
  }
  // F3主导(≥30%) → 用多指数加权（体现量价广度）
  if (f3Ratio >= 0.30) {
    const sh = returns.sh ?? 0;
    const cyb = returns.cyb ?? sh;
    const sz = returns.sz ?? sh;
    return sh * 0.4 + cyb * 0.35 + sz * 0.25;
  }
  // 默认 → 上证
  return returns.sh ?? 0;
}

/**
 * 判定哪个因子得分最高（主导因子）
 * @param {Object} eq — {F1a, F1b, F2, F3, F4}
 * @returns {'F1a_dominant'|'F1b_dominant'|'F3_dominant'|'F4_dominant'|'mixed'}
 */
export function getFactorDominance(eq) {
  const f1a = eq.F1a ?? 0;
  const f1b = eq.F1b ?? 0;
  const f3 = eq.F3 ?? 0;
  const f4 = eq.F4 ?? 0;
  const max = Math.max(f1a, f1b, f3, f4);
  if (max === 0) return 'mixed';
  if (max === f1a) return 'F1a_dominant';
  if (max === f1b) return 'F1b_dominant';
  if (max === f3) return 'F3_dominant';
  if (max === f4) return 'F4_dominant';
  return 'mixed';
}

function computeSubAccuracy(scoreHistory, marketData, forwardHorizons) {
  let total = 0, correct = 0;
  for (const snap of scoreHistory) {
    const { dir: predictedDir } = deriveExpectedDirection(snap);
    if (!predictedDir) continue;
    const h = forwardHorizons[0];
    const fwdDate = addTradingDays(snap.date, h, marketData);
    if (!fwdDate) continue;
    const startData = getMarketData(snap.date, marketData);
    const endData = getMarketData(fwdDate, marketData);
    if (!startData || !endData) continue;
    const returns = {
      sh: startData.shClose != null ? (endData.shClose - startData.shClose) / startData.shClose : 0,
      cyb: startData.cybClose != null && endData.cybClose != null ? (endData.cybClose - startData.cybClose) / startData.cybClose : null,
      sz: startData.szClose != null && endData.szClose != null ? (endData.szClose - startData.szClose) / startData.szClose : null
    };
    const mr = selectRelevantReturn(snap.equity, returns);
    const marketDir = getMarketDirection(mr, predictedDir);
    if (marketDir === 'neutral') continue;
    const match = predictedDir === 'up' || predictedDir === 'weak_up' ? marketDir === 'up' : marketDir === 'down';
    total++;
    if (match) correct++;
  }
  return total > 0 ? (correct / total * 100) : 0;
}

export function addTradingDays(dateStr, days, marketData) {
  const dates = Object.keys(marketData).sort();
  const idx = dates.indexOf(dateStr);
  if (idx < 0) {
    // 找最近的前一个交易日（<= dateStr），避免非交易日跳到次日拉伸窗口
    const nearest = dates.filter(d => d <= dateStr).pop();
    if (!nearest) return null;
    const nearestIdx = dates.indexOf(nearest);
    return dates[Math.min(nearestIdx + days, dates.length - 1)] || null;
  }
  return dates[Math.min(idx + days, dates.length - 1)] || null;
}

function getMarketData(dateStr, marketData) {
  return marketData[dateStr] || null;
}

/**
 * 生成回测报告摘要（Markdown格式，直接喂LLM）
 */
export function formatBacktestReport(results) {
  if (results.error) return `【回测报告】\n❌ ${results.error}`;

  const ov = results.overview;
  let report = `【评分回测报告 — CIO方向 vs 大盘实际走势】\n`;
  report += `⚠️ 本报告基于CIO矩阵语义(verdict+final+F1/F2)映射预期方向，非简单55分阈值。\n\n`;
  report += `📊 总览: ${ov.totalPredictions}次预测 | 方向准确率: ${ov.accuracy.toFixed(1)}% | ${ov.grade}\n`;
  if (ov._diag) {
    const d = ov._diag;
    report += `\n🔍 样本诊断:\n`;
    report += `  快照${d.快照总数}条 | 有效打分${d.有效打分}条\n`;
    report += `  有方向(参与统计): ${d.有方向预测}条 | 无方向(持观/锁仓等): ${d['无方向预测(持观/锁仓等)']}条\n`;
    report += `  理论最大预测: ${d.理论最大预测}次(${d.有方向预测}方向分×5窗口) | 实际: ${d.实际预测}次\n`;
    report += `  快照日期: ${d.首快照} → ${d.末快照} | K线日期: ${d['K线日期范围']}\n`;
    if (d.CIO分类明细) {
      report += `  CIO分类明细: ${Object.entries(d.CIO分类明细).map(([k,v]) => `${k}=${v}`).join(', ')}\n`;
    }
    report += `  流失: ${d.流失原因}\n`;
  }
  report += `\n`;

  report += `📈 CIO映射分组准确率:\n`;
  for (const [category, stats] of Object.entries(results.byCIOOutcome)) {
    report += `  ${category}: ${stats.accuracy} (${stats.correct}/${stats.total})\n`;
  }

  report += `\n📊 按因子主导性分组准确率:\n`;
  for (const [key, stats] of Object.entries(results.byFactorDominance || {})) {
    report += `  ${key}: ${stats.accuracy} (${stats.correct}/${stats.total})\n`;
  }

  report += `\n📉 前向窗口衰减:\n`;
  for (const [h, stats] of Object.entries(results.byHorizon)) {
    report += `  T+${h}: ${stats.accuracy.toFixed(1)}% (${stats.observations}次观测)\n`;
  }

  report += `\n📐 校准: ${results.calibration.note}`;
  if (results.calibration.spearmanCorrelation != null) {
    report += `\n  Spearman秩相关: ρ=${results.calibration.spearmanCorrelation} (${results.calibration.correlationNote})`;
  }
  if (results.prePostComparison) {
    const pp = results.prePostComparison;
    report += `\n\n📅 重构前后对比 (分界: 2026-06-19 v1.8):`;
    report += `\n  旧系统(Boolean): ${pp.oldSystem.accuracy}% (${pp.oldSystem.samples}样本)`;
    report += `\n  新系统(JS决策树): ${pp.newSystem.accuracy}% (${pp.newSystem.samples}样本)`;
    report += `\n  差值: ${pp.delta > 0 ? '+' : ''}${pp.delta}% → ${pp.note}`;
  }

  // 退化检测
  if (results._scoreHistory && results._marketData) {
    const deg = detectDegradation(results._scoreHistory, results._marketData, 10);
    report += `\n\n📉 模型退化检测: ${deg.message}`;
  }

  report += `\n\n🎯 Ω建议: rawAccuracy=${results.omegaSuggestion.rawAccuracy} → Ω=${results.omegaSuggestion.recommendedOmega}`;

  return report;
}

// ============================================================================
// Meta-Vigilance 快速检测 — 打分后自动执行，检验预测效力
// ============================================================================

/**
 * Meta-Vigilance：最近N次打分是否与后续走势背离
 * @param {Array} scoreHistory - [{date, equity:{final, verdict}}]
 * @param {Object} marketData - {date: {shClose}}
 * @param {number} lookbackDays - 回溯天数，默认15
 * @returns {{warning: boolean, message: string, details: string}}
 */
export function metaVigilanceCheck(scoreHistory, marketData, lookbackDays = 15) {
  if (!scoreHistory || scoreHistory.length < 3) {
    return { warning: false, message: '样本不足（需≥3次打分）', details: '' };
  }

  const recent = scoreHistory.slice(-Math.min(lookbackDays, scoreHistory.length));
  const results = [];

  for (const snap of recent) {
    const { dir: predictedDir, category } = deriveExpectedDirection(snap);
    if (!predictedDir) continue;  // null = 持观/锁仓/BLACK，不产生背离警告

    for (let h = 1; h <= 3; h++) {
      const fwdDate = addTradingDays(snap.date, h, marketData);
      if (!fwdDate) continue;
      const start = marketData[snap.date];
      const end = marketData[fwdDate];
      if (!start || !end) continue;

      const returns = {
        sh: start.shClose != null ? (end.shClose - start.shClose) / start.shClose : 0,
        cyb: start.cybClose != null && end.cybClose != null ? (end.cybClose - start.cybClose) / start.cybClose : null,
        sz: start.szClose != null && end.szClose != null ? (end.szClose - start.szClose) / start.szClose : null
      };
      const ret = selectRelevantReturn(snap.equity, returns);
      const thresh = predictedDir === 'weak_up' ? 0.003 : 0.005;
      const actualDir = ret > thresh ? 'up' : ret < -thresh ? 'down' : 'flat';

      results.push({ date: snap.date, score: snap.equity?.final, predictedDir, fwdDate, actualDir, actualRet: ret, horizon: h, category });
    }
  }

  // 按语义分组检查背离
  // 喊多→跌: predictedDir 是 up/weak_up 但实际 down
  const bullishResults = results.filter(r => r.predictedDir === 'up' || r.predictedDir === 'weak_up');
  const bearishResults = results.filter(r => r.predictedDir === 'down');

  const bullishWrong = bullishResults.filter(r => r.actualDir === 'down');
  const bearishWrong = bearishResults.filter(r => r.actualDir === 'up');

  let warning = false;
  let message = '';

  if (bullishResults.length >= 3 && bullishWrong.length >= Math.ceil(bullishResults.length * 0.5)) {
    warning = true;
    message = `🚨【预测效力警告】近${lookbackDays}日内${bullishWrong.length}/${bullishResults.length}次看多预测后大盘实际走弱——"喊多→跌"，因子可能钝化。`;
  }
  if (bearishResults.length >= 3 && bearishWrong.length >= Math.ceil(bearishResults.length * 0.5)) {
    warning = true;
    const msg = `🚨【预测效力警告】近${lookbackDays}日内${bearishWrong.length}/${bearishResults.length}次看空预测后大盘实际走强——"喊空→涨"，因子可能钝化。`;
    message = message ? message + '\n' + msg : msg;
  }
  if (!warning && results.length >= 5) {
    const correct = results.filter(r => {
      const isUp = r.predictedDir === 'up' || r.predictedDir === 'weak_up';
      const isDown = r.predictedDir === 'down';
      if (isUp) return r.actualDir === 'up';
      if (isDown) return r.actualDir === 'down';
      return false;
    }).length;
    message = `✅ Meta-Vigilance: 近${lookbackDays}日预测(基于CIO矩阵)与后续走势一致 (${correct}/${results.length})，模型预测效力正常。`;
  }

  const _mvResult = { warning, message, details: results.slice(0, 5).map(r => `${r.date}→${r.fwdDate}: ${r.predictedDir}/${r.category} vs ${r.actualDir}`).join(' | ') };
  logMetaVigilance(_mvResult);
  return _mvResult;
}

// ============================================================================
// 模型退化检测 — 滚动窗口准确率趋势
// ============================================================================

/**
 * 检测评分系统准确率是否持续下降
 * @param {Array} scoreHistory — 按日期升序排列
 * @param {Object} marketData
 * @param {number} windowSize — 滚动窗口大小，默认10
 * @returns {{degrading: boolean, trend: number[], message: string}}
 */
export function detectDegradation(scoreHistory, marketData, windowSize = 10) {
  if (!scoreHistory || scoreHistory.length < windowSize + 5) {
    return { degrading: false, trend: [], message: `样本不足（需≥${windowSize + 5}条）` };
  }

  const accuracies = [];
  for (let i = windowSize; i <= scoreHistory.length; i++) {
    const window = scoreHistory.slice(i - windowSize, i);
    let total = 0, correct = 0;
    for (const snap of window) {
      const { dir: predictedDir } = deriveExpectedDirection(snap);
      if (!predictedDir) continue;
      const fwdDate = addTradingDays(snap.date, 1, marketData);
      if (!fwdDate) continue;
      const sD = marketData[snap.date], eD = marketData[fwdDate];
      if (!sD || !eD) continue;
      const returns = {
        sh: sD.shClose != null ? (eD.shClose - sD.shClose) / sD.shClose : 0,
        cyb: sD.cybClose != null && eD.cybClose != null ? (eD.cybClose - sD.cybClose) / sD.cybClose : null,
        sz: sD.szClose != null && eD.szClose != null ? (eD.szClose - sD.szClose) / sD.szClose : null
      };
      const mr = selectRelevantReturn(snap.equity, returns);
      const actualDir = getMarketDirection(mr, predictedDir);
      if (actualDir === 'neutral') continue;
      const match = predictedDir === 'up' || predictedDir === 'weak_up' ? actualDir === 'up' : actualDir === 'down';
      total++;
      if (match) correct++;
    }
    accuracies.push(total > 0 ? correct / total * 100 : 0);
  }

  if (accuracies.length < 10) return { degrading: false, trend: accuracies, message: '趋势数据不足' };

  // 检查最近 10 个窗口是否持续下降
  const recent10 = accuracies.slice(-10);
  let downCount = 0;
  for (let i = 1; i < recent10.length; i++) {
    if (recent10[i] < recent10[i - 1]) downCount++;
  }
  const firstHalf = recent10.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const secondHalf = recent10.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const drop = firstHalf - secondHalf;
  const degrading = drop > 10 && downCount >= 7;

  const _degResult = {
    degrading,
    trend: accuracies,
    message: degrading
      ? `🚨 模型退化警告：近10窗口准确率下降 ${drop.toFixed(1)}pp (${firstHalf.toFixed(0)}%→${secondHalf.toFixed(0)}%)，连续${downCount}/9次下降`
      : `✅ 滚动准确率趋势稳定 (${secondHalf.toFixed(0)}%)`
  };
  logDegradation(_degResult);
  return _degResult;
}

// ============================================================================
// Walk-forward OLS 权重校准
// ============================================================================

// ── 矩阵运算（无外部依赖，纯 JS）──

/** 矩阵转置 */
function transpose(M) {
  const rows = M.length, cols = M[0].length;
  const T = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      T[j][i] = M[i][j];
  return T;
}

/** 矩阵乘法 C = A × B */
function matMul(A, B) {
  const m = A.length, n = B[0].length, inner = B.length;
  const C = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++)
    for (let k = 0; k < inner; k++)
      for (let j = 0; j < n; j++)
        C[i][j] += A[i][k] * B[k][j];
  return C;
}

/** 高斯消元 + 部分主元选择 求解 Ax = b
 *  @returns {number[][]} x 列向量 (n×1) */
function solve(A, b) {
  const n = A.length;
  // 增广矩阵 [A|b]
  const aug = A.map((row, i) => [...row, b[i][0]]);

  // 前向消元
  for (let col = 0; col < n; col++) {
    // 部分主元选择
    let maxRow = col, maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]); maxRow = row;
      }
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    if (Math.abs(aug[col][col]) < 1e-14) continue; // 奇异矩阵

    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  // 回代
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(aug[i][i]) < 1e-14) { x[i] = 0; continue; }
    let sum = aug[i][n];
    for (let j = i + 1; j < n; j++) sum -= aug[i][j] * x[j];
    x[i] = sum / aug[i][i];
  }
  return x.map(v => [v]);
}

// ── OLS 回归 ──

/**
 * 普通最小二乘回归
 * @param {number[][]} X — N×K 自变量矩阵
 * @param {number[][]} Y — N×1 因变量向量
 * @returns {{beta: number[][], rSquared: number, tStats: number[], se: number[]}}
 */
function ols(X, Y) {
  const N = X.length, K = X[0].length;
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);  // K×K
  const XtY = matMul(Xt, Y);  // K×1

  const betaMatrix = solve(XtX, XtY);
  const beta = betaMatrix.map(r => r[0]);

  // 拟合值 + 残差
  const yMean = Y.reduce((s, r) => s + r[0], 0) / N;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < N; i++) {
    let yHat = 0;
    for (let j = 0; j < K; j++) yHat += X[i][j] * beta[j];
    ssRes += (Y[i][0] - yHat) ** 2;
    ssTot += (Y[i][0] - yMean) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // 标准误 + t 统计量
  const sigma2 = ssRes / Math.max(1, N - K);
  const se = [];
  const tStats = [];
  // XtX 的逆矩阵对角线 = 方差
  for (let j = 0; j < K; j++) {
    const v = sigma2 * (XtX[j]?.[j] || 0);
    const stdErr = Math.sqrt(Math.max(v, 1e-10));
    se.push(stdErr);
    tStats.push(stdErr > 0 ? beta[j] / stdErr : 0);
  }

  return { beta, rSquared, tStats, se };
}

/** 用 OLS 系数做预测 */
function predict(Xrow, beta) {
  let y = 0;
  for (let j = 0; j < beta.length; j++) y += Xrow[j] * beta[j];
  return y;
}

// ── Walk-Forward 校准 ──

const DEFAULT_WEIGHTS_CAL = { F1a: 20, F1b: 15, F2: 25, F3: 25, F4: 15 };
const FACTOR_KEYS = ['F1a', 'F1b', 'F2', 'F3', 'F4'];
const WF_TRAIN = 20;   // 训练窗口大小
const WF_VALID = 5;    // 验证窗口大小（slide step）
const WF_MIN_SAMPLES = 30; // 至少 30 条样本才激活 OLS
const WF_MIN_WINDOWS = 2;  // 至少 2 个 walk-forward 窗口
const WF_HORIZON = 3;      // 预测 T+3 市场收益

/**
 * Walk-forward OLS 因子权重校准
 * 滑动窗口训练 OLS → 验证集评估方向准确率 → 加权平均 β → 转化为因子权重
 * @param {Array} scoreHistory
 * @param {Object} marketData
 * @returns {{weights: Object, status: string, details: Object}}
 */
export function calibrateWeights(scoreHistory, marketData) {
  if (!scoreHistory || scoreHistory.length < WF_MIN_SAMPLES) {
    return {
      weights: { ...DEFAULT_WEIGHTS_CAL },
      status: `样本不足(${scoreHistory?.length || 0}/${WF_MIN_SAMPLES})，使用默认权重。`,
      details: null
    };
  }

  // ── 构建 (X, Y) 样本集 ──
  const samples = [];
  for (const snap of scoreHistory) {
    const eq = snap.equity;
    if (!eq || eq.F1a == null || eq.F1b == null || eq.F2 == null || eq.F3 == null || eq.F4 == null) continue;
    const fwdDate = addTradingDays(snap.date, WF_HORIZON, marketData);
    if (!fwdDate) continue;
    const sD = marketData[snap.date], eD = marketData[fwdDate];
    if (!sD || !eD) continue;
    const Y = (eD.shClose - sD.shClose) / sD.shClose;
    const X = [eq.F1a, eq.F1b, eq.F2, eq.F3, eq.F4];
    samples.push({ date: snap.date, X, Y });
  }

  if (samples.length < WF_MIN_SAMPLES) {
    return {
      weights: { ...DEFAULT_WEIGHTS_CAL },
      status: `有效样本不足(${samples.length}/${WF_MIN_SAMPLES})，使用默认权重。`,
      details: { totalSnaps: scoreHistory.length, validSamples: samples.length }
    };
  }

  const _endGroupOLS = logOLSCalibrationStart(samples.length, WF_TRAIN, WF_VALID, WF_HORIZON);

  // ── Walk-Forward 滑动 ──
  const windows = [];
  for (let start = 0; start + WF_TRAIN + WF_VALID <= samples.length; start += WF_VALID) {
    const trainSet = samples.slice(start, start + WF_TRAIN);
    const valSet = samples.slice(start + WF_TRAIN, start + WF_TRAIN + WF_VALID);

    const X_train = trainSet.map(s => s.X);
    const Y_train = trainSet.map(s => [s.Y]);
    const X_val = valSet.map(s => s.X);
    const Y_val = valSet.map(s => [s.Y]);

    const model = ols(X_train, Y_train);

    // 验证集方向准确率
    let correct = 0, total = 0;
    for (let i = 0; i < valSet.length; i++) {
      const pred = predict(X_val[i], model.beta);
      const actual = Y_val[i][0];
      // 预测 >0 → 看涨, 实际 > 0.3% → 正确
      if ((pred > 0 && actual > 0.003) || (pred < 0 && actual < -0.003)) correct++;
      total++;
    }
    const valAcc = total > 0 ? correct / total : 0;

    windows.push({
      trainRange: `${trainSet[0]?.date}-${trainSet[trainSet.length-1]?.date}`,
      valRange: `${valSet[0]?.date}-${valSet[valSet.length-1]?.date}`,
      beta: model.beta,
      tStats: model.tStats,
      rSquared: model.rSquared,
      valAccuracy: valAcc,
      valSamples: total
    });

    logOLSWindow(windows.length, windows[windows.length-1].valRange, model.rSquared, valAcc);
  }

  if (windows.length < WF_MIN_WINDOWS) {
    return {
      weights: { ...DEFAULT_WEIGHTS_CAL },
      status: `Walk-Forward窗口不足(${windows.length}/${WF_MIN_WINDOWS})，需更长历史。`,
      details: { totalSamples: samples.length, windows: windows.length }
    };
  }

  // ── 加权平均 β（以验证准确率为权重）──
  const totalWeight = windows.reduce((s, w) => s + Math.max(w.valAccuracy, 0.4), 0);
  const avgBeta = new Array(5).fill(0);
  const avgT = new Array(5).fill(0);
  for (const w of windows) {
    const wt = Math.max(w.valAccuracy, 0.4) / totalWeight;
    for (let j = 0; j < 5; j++) {
      avgBeta[j] += w.beta[j] * wt;
      avgT[j] += w.tStats[j] * wt;
    }
  }

  // ── β → 权重转换 ──
  // 规则：|t| > 1.0 且 β 显著为正 → 增加权重；|t| < 0.5 → 降低权重
  const rawWeights = { ...DEFAULT_WEIGHTS_CAL };
  const adjustments = {};

  for (let j = 0; j < 5; j++) {
    const key = FACTOR_KEYS[j];
    const defMax = DEFAULT_WEIGHTS_CAL[key];
    const absT = Math.abs(avgT[j]);
    const betaSign = avgBeta[j];

    if (absT > 1.5 && betaSign > 0) {
      // 统计显著 + 正向预测 → 大幅增权
      rawWeights[key] = Math.round(defMax * Math.min(1.5, 1.0 + absT * 0.15));
      adjustments[key] = `↑显著(t=${avgT[j].toFixed(1)},β>0)`;
    } else if (absT > 1.0 && betaSign > 0) {
      // 较显著 + 正向 → 温和增权
      rawWeights[key] = Math.round(defMax * Math.min(1.3, 1.0 + absT * 0.1));
      adjustments[key] = `↑较显著(t=${avgT[j].toFixed(1)})`;
    } else if (absT < 0.5 || betaSign < 0) {
      // 不显著 或 负β → 降权
      rawWeights[key] = Math.round(defMax * 0.7);
      adjustments[key] = betaSign < 0 ? `↓负β(t=${avgT[j].toFixed(1)})` : `↓不显著(t=${avgT[j].toFixed(1)})`;
    } else {
      adjustments[key] = `→维持(t=${avgT[j].toFixed(1)})`;
    }
  }

  // 归一化到 100（保持各因子相对比例）
  const rawSum = Object.values(rawWeights).reduce((a, b) => a + b, 0);
  const finalWeights = {};
  for (const key of FACTOR_KEYS) {
    finalWeights[key] = Math.round(rawWeights[key] * 100 / rawSum);
  }

  // 安全边界
  for (const key of FACTOR_KEYS) {
    const floor = Math.round(DEFAULT_WEIGHTS_CAL[key] * 0.5);
    const ceil = Math.round(DEFAULT_WEIGHTS_CAL[key] * 1.5);
    finalWeights[key] = Math.max(floor, Math.min(ceil, finalWeights[key]));
  }

  // 强制归一化
  const finalSum = Object.values(finalWeights).reduce((a, b) => a + b, 0);
  if (finalSum !== 100) {
    const diff = 100 - finalSum;
    // 加到最大的因子
    let maxKey = FACTOR_KEYS[0];
    for (const k of FACTOR_KEYS) { if (finalWeights[k] > finalWeights[maxKey]) maxKey = k; }
    finalWeights[maxKey] += diff;
  }

  const avgAccuracy = windows.reduce((s, w) => s + w.valAccuracy, 0) / windows.length;
  const avgR2 = windows.reduce((s, w) => s + w.rSquared, 0) / windows.length;

  logOLSBetas(avgBeta, avgT);
  logOLSWeights(finalWeights);
  if (_endGroupOLS) _endGroupOLS();

  return {
    weights: finalWeights,
    status: `OLS校准完成(${windows.length}窗口, ${samples.length}样本)。验证准确率${(avgAccuracy*100).toFixed(1)}%, R²=${avgR2.toFixed(3)}。`,
    details: {
      samples: samples.length,
      windows: windows.length,
      avgValidationAccuracy: parseFloat(avgAccuracy.toFixed(3)),
      avgRSquared: parseFloat(avgR2.toFixed(3)),
      avgBeta: avgBeta.map(v => parseFloat(v.toFixed(5))),
      avgTStats: avgT.map(v => parseFloat(v.toFixed(2))),
      adjustments,
      rawWeights,
      windows: windows.map(w => ({
        valRange: w.valRange,
        rSquared: parseFloat(w.rSquared.toFixed(3)),
        valAccuracy: parseFloat(w.valAccuracy.toFixed(3)),
        beta: w.beta.map(v => parseFloat(v.toFixed(5)))
      }))
    }
  };
}

// ============================================================================
// A/B 权重对比 — 用同一批快照，模拟不同权重方案的预测准确率
// ============================================================================

const DEFAULT_WEIGHTS = { F1a: 20, F1b: 15, F2: 25, F3: 25, F4: 15 };

/**
 * 对比两套因子权重在历史打分上的方向准确率
 * 快照中已存 F1a/F1b/F2/F3/F4/momentum 分项 → 可重算 final
 * @param {Array} scoreHistory
 * @param {Object} marketData
 * @param {Object} weightsA — 权重方案A
 * @param {Object} weightsB — 权重方案B
 * @returns {{ a: {accuracy, predictions}, b: {accuracy, predictions}, winner: string }}
 */
export function compareWeights(scoreHistory, marketData, weightsA = null, weightsB = null) {
  const wA = weightsA || DEFAULT_WEIGHTS;
  const wB = weightsB || DEFAULT_WEIGHTS;
  const sumW = (w) => (w.F1a||0)+(w.F1b||0)+(w.F2||0)+(w.F3||0)+(w.F4||0);

  const evalWeights = (weights) => {
    let total = 0, correct = 0;
    for (const snap of scoreHistory) {
      const eq = snap.equity;
      if (!eq || eq.F1 == null || eq.F2 == null) continue;
      // 从分项重算 final
      const f1a = eq.F1a ?? eq.F1; // 兼容旧快照（无 F1a/F1b 拆分）
      const f1b = eq.F1b ?? 0;
      const f2 = eq.F2, f3 = eq.F3, f4 = eq.F4;
      const mom = eq.momentum || 0;
      const wSum = sumW(weights);
      const rawScore = (f1a * (weights.F1a||20) / 20) + (f1b * (weights.F1b||15) / 15) +
        (f2 * (weights.F2||25) / 25) + (f3 * (weights.F3||25) / 25) + (f4 * (weights.F4||15) / 15);
      const final = Math.min(100, Math.max(0, rawScore + mom));
      // 用重算的 final + 原始快照的子因子 构造临时快照做 CIO 映射
      const tempSnap = { equity: { ...eq, final, F1: eq.F1 ?? ((eq.F1a ?? 0) + (eq.F1b ?? 0)) } };
      const { dir: predictedDir } = deriveExpectedDirection(tempSnap);
      if (!predictedDir) continue;
      const fwdDate = addTradingDays(snap.date, 1, marketData);
      if (!fwdDate) continue;
      const sD = marketData[snap.date], eD = marketData[fwdDate];
      if (!sD || !eD) continue;
      const returns = {
        sh: sD.shClose != null ? (eD.shClose - sD.shClose) / sD.shClose : 0,
        cyb: sD.cybClose != null && eD.cybClose != null ? (eD.cybClose - sD.cybClose) / sD.cybClose : null,
        sz: sD.szClose != null && eD.szClose != null ? (eD.szClose - sD.szClose) / sD.szClose : null
      };
      const mr = selectRelevantReturn(tempSnap.equity, returns);
      const actualDir = getMarketDirection(mr, predictedDir);
      if (actualDir === 'neutral') continue;
      const match = predictedDir === 'up' || predictedDir === 'weak_up' ? actualDir === 'up' : actualDir === 'down';
      total++;
      if (match) correct++;
    }
    return { accuracy: total > 0 ? correct / total * 100 : 0, predictions: total };
  };

  const a = evalWeights(wA);
  const b = evalWeights(wB);
  const winner = a.accuracy > b.accuracy ? 'A' : b.accuracy > a.accuracy ? 'B' : 'tie';

  return {
    a: { ...a, weights: wA },
    b: { ...b, weights: wB },
    winner,
    delta: parseFloat((a.accuracy - b.accuracy).toFixed(1)),
    note: winner === 'tie' ? '两套权重无显著差异' :
      `权重${winner}准确率高 ${Math.abs(a.accuracy - b.accuracy).toFixed(1)}pp (${a.predictions} vs ${b.predictions} 次预测)`
  };
}
