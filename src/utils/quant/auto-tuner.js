// 自适应进化引擎 — 基于回测结果自动调整因子权重
// 核心原则: 渐变(单次≤3分) + 连续映射(accuracy-50)/7 + 滚动窗口(30日) + 统计显著(≥10次) + 安全边界(×0.5~×1.5) + 回算验证(compareWeights)
// 双轨设计: Track A = run_backtest(LLM工具,不改); Track B = autoTune(静默,每次存快照时触发)

import { addTradingDays, compareWeights, calibrateWeights } from './backtest';
import { logAutoTuneStart, logAutoTuneFactor, logAutoTuneValidation, logAutoTuneFinal, logAutoTuneOLS } from './quantLogger';

const DEFAULT_MAX_SCORES = { F1a: 20, F1b: 15, F2: 25, F3: 25, F4: 15 };
const FLOOR_RATIO = 0.5;   // 任何因子不低于原始权重的 50%
const CEIL_RATIO = 1.5;    // 任何因子不高于原始权重的 150%
const MAX_STEP = 3;        // 单次调整上限（配合 compareWeights 验证，激进调整会被拒绝）
const ROLLING_WINDOW = 30; // 滚动窗口(交易日)
const MIN_SAMPLES = 10;    // 最少有效预测次数（默认值）

// 各因子动态最小样本阈值（数据可得性差异）
const MIN_SAMPLES_BY_FACTOR = {
  F1a: 8,   // 上证数据最全
  F1b: 12,  // 双创波动大，需更多样本
  F2:  10,  // 微观反转默认
  F3:  10,  // 量价相对稳定
  F4:  15   // 跨资产数据最稀缺
};

// 将因子分数映射为方向（考虑各因子语义差异）
// F2(微观反转): 高分=超跌反转信号→市场应涨; 低分=高位顶背离→市场应跌
// F1a/F1b(赔率型): 高分=估值低赔率高→市场应涨; 低分=高估→市场应跌
// F3(量价验证): 高分=放量涨/增量抢筹→偏多; 低分=放量跌/恐慌→偏空
// F4(跨资产): 高分=risk-on→偏多; 低分=risk-off→偏空
function factorDirection(score, maxScore, factorKey = '') {
  const ratio = score / maxScore;
  // F2 反转因子：高分=底部反转(看涨)，低分=顶部(看跌)
  // 与 F1a/F1b/F3/F4 方向一致，不做翻转
  if (ratio >= 0.65) return 'up';    // 高分=看涨（F2:超跌反转; F1:高赔率; F3:增量抢筹; F4:risk-on）
  if (ratio <= 0.28) return 'down';  // 低分=看跌（F2:高位顶背离; F1:高估; F3:恐慌; F4:risk-off）
  return 'neutral';
}

/**
 * 计算单个因子在历史样本上的方向准确率
 * @param {Array} samples — [{factorScore, marketReturn, horizon}]
 * @param {number} maxScore
 * @returns {{accuracy, total, correct}}
 */
function factorAccuracy(samples, maxScore) {
  let total = 0, correct = 0;
  for (const s of samples) {
    const dir = factorDirection(s.factorScore, maxScore);
    if (dir === 'neutral') continue;
    // 使用 0.3% 阈值(与 backtest 的 weak_up 阈值一致，降低样本丢弃率)
    const actualDir = s.marketReturn > 0.003 ? 'up' : s.marketReturn < -0.003 ? 'down' : 'neutral';
    if (actualDir === 'neutral') continue;
    total++;
    if (dir === actualDir) correct++;
  }
  return { accuracy: total > 0 ? correct / total * 100 : 50, total, correct };
}

/**
 * 从打分快照+市场数据构建因子级评估样本
 * 各因子使用对应指数的市场收益：
 *   F1a → shClose (上证)
 *   F1b → cybClose (创业板)，降级使用 shClose
 *   F3  → 多指数加权 (sh*0.4 + cyb*0.35 + sz*0.25)
 *   F2/F4 → shClose (默认)
 * @param {Array} scoreHistory — 最近30条快照 [{date, equity:{F1a,F1b,F2,F3,F4}, bond:{...}}]
 * @param {Object} marketData — {date: {shClose, cybClose?, szClose?}}
 * @returns {Object} — {F1a: samples[], F1b: samples[], ...}
 */
export function buildFactorSamples(scoreHistory, marketData) {
  const factors = { F1a: [], F1b: [], F2: [], F3: [], F4: [] };

  // 各因子的市场收益计算函数
  const getMarketReturn = (sD, eD, factorKey) => {
    switch (factorKey) {
      case 'F1b':
        // 创业板；降级到 sh
        if (sD.cybClose != null && eD.cybClose != null) {
          return (eD.cybClose - sD.cybClose) / sD.cybClose;
        }
        return (eD.shClose - sD.shClose) / sD.shClose;
      case 'F3': {
        // 多指数加权
        const shRet = (eD.shClose - sD.shClose) / sD.shClose;
        const cybRet = (sD.cybClose != null && eD.cybClose != null)
          ? (eD.cybClose - sD.cybClose) / sD.cybClose : shRet;
        const szRet = (sD.szClose != null && eD.szClose != null)
          ? (eD.szClose - sD.szClose) / sD.szClose : shRet;
        return shRet * 0.4 + cybRet * 0.35 + szRet * 0.25;
      }
      default:
        // F1a, F2, F4 → 上证
        return (eD.shClose - sD.shClose) / sD.shClose;
    }
  };

  for (const snap of scoreHistory) {
    const eq = snap.equity;
    if (!eq) continue;
    const sD = marketData[snap.date];
    if (!sD || sD.shClose == null) continue;

    for (let h = 1; h <= 3; h++) {
      const fwdDate = addTradingDays(snap.date, h, marketData);
      if (!fwdDate) continue;
      const eD = marketData[fwdDate];
      if (!eD || eD.shClose == null) continue;

      for (const key of Object.keys(factors)) {
        if (eq[key] != null) {
          const marketReturn = getMarketReturn(sD, eD, key);
          factors[key].push({ factorScore: eq[key], marketReturn, horizon: h, date: snap.date });
        }
      }
    }
  }

  return factors;
}

/**
 * 自适应调优 — 基于回测结果调整因子权重
 * @param {Array} scoreHistory — 打分快照数组(最近30条)
 * @param {Object} marketData — {date: {shClose}}
 * @param {Object} currentMaxScores — 当前各因子满分(默认 DEFAULT_MAX_SCORES)
 * @returns {{newScores: Object, changes: Object, summary: string, details: Object}}
 */
export function autoTune(scoreHistory, marketData, currentMaxScores = null) {
  const curScores = currentMaxScores || { ...DEFAULT_MAX_SCORES };

  if (!scoreHistory || scoreHistory.length < MIN_SAMPLES) {
    return {
      newScores: { ...curScores },
      changes: {},
      summary: `样本不足(${scoreHistory?.length || 0}/${MIN_SAMPLES})，维持当前权重。`,
      details: {},
      diagnostics: {
        totalSnapshots: scoreHistory?.length || 0,
        sampleSufficiency: {},
        overallConfidence: 0,
        adjustedFactors: [],
        unadjustedFactors: ['样本总量不足']
      }
    };
  }

  const factorSamples = buildFactorSamples(scoreHistory, marketData);
  const _endGroup = logAutoTuneStart(scoreHistory.length, Object.keys(marketData).length);
  const newScores = { ...curScores };
  const changes = {};
  const details = {};

  // 🆕 诊断信息收集
  const diagnostics = {
    totalSnapshots: scoreHistory.length,
    totalMarketDates: Object.keys(marketData).length,
    sampleSufficiency: {},
    adjustedFactors: [],
    unadjustedFactors: [],
    overallConfidence: 0
  };
  let sufficientFactorCount = 0;

  for (const [key, defaultMax] of Object.entries(DEFAULT_MAX_SCORES)) {
    const minRequired = MIN_SAMPLES_BY_FACTOR[key] || MIN_SAMPLES;
    const samples = factorSamples[key] || [];
    const { accuracy, total, correct } = factorAccuracy(samples, curScores[key]);

    let delta = 0;
    let wasAdjusted = false;
    if (total >= minRequired) {
      wasAdjusted = true;
      sufficientFactorCount++;
      // 连续映射: (accuracy - 50) / 7 → 以 50% 为中心, 每 7pp 跳 1 分, 无死区
      delta = Math.round((accuracy - 50) / 7);
      delta = Math.max(-MAX_STEP, Math.min(MAX_STEP, delta));
    }

    const newVal = curScores[key] + delta;
    const floor = Math.round(defaultMax * FLOOR_RATIO);
    const ceil = Math.round(defaultMax * CEIL_RATIO);
    newScores[key] = Math.max(floor, Math.min(ceil, newVal));

    changes[key] = newScores[key] - curScores[key];
    details[key] = {
      accuracy: parseFloat(accuracy.toFixed(1)),
      samples: total,
      correct,
      minRequired,
      delta,
      oldScore: curScores[key],
      newScore: newScores[key],
      floor,
      ceil,
      status: total >= minRequired ? '✓ 充分' : '✗ 不足'
    };

    // 🆕 诊断信息
    diagnostics.sampleSufficiency[key] = {
      samples: total,
      minRequired,
      status: total >= minRequired ? '✓ 充分' : '✗ 不足'
    };
    if (wasAdjusted) {
      diagnostics.adjustedFactors.push(`${key}(${accuracy.toFixed(1)}% → Δ${delta >= 0 ? '+' : ''}${delta})`);
    } else {
      diagnostics.unadjustedFactors.push(`${key}(${total}/${minRequired}样本,权重维持)`);
    }

    logAutoTuneFactor(key, details[key], curScores[key], newScores[key], changes[key],
      total >= minRequired
        ? `accuracy ${accuracy.toFixed(1)}% → delta ${delta >= 0 ? '+' : ''}${delta}`
        : `样本不足(${total}/${minRequired}) 权重不变`);
  }

  // 🆕 整体置信度
  diagnostics.overallConfidence = parseFloat(
    (sufficientFactorCount / Object.keys(DEFAULT_MAX_SCORES).length * 100).toFixed(1)
  );

  const changedFactors = Object.entries(changes).filter(([, v]) => v !== 0);
  const heuristicScores = { ...newScores };
  let weightChangesSummary = changedFactors.length === 0
    ? '本轮各因子预测效力均在正常范围，权重不变。'
    : changedFactors.map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}分`).join(', ') +
      ` (基于近${ROLLING_WINDOW}日${scoreHistory.length}条样本)`;

  // ── 升级路径: 样本 ≥30 时尝试 OLS 校准 ──
  let olsResult = null;
  if (scoreHistory.length >= 30) {
    try {
      olsResult = calibrateWeights(scoreHistory, marketData);
      logAutoTuneOLS(olsResult);  // 🟢 OLS 探针输出
      if (olsResult.details?.windows < 2) olsResult = null; // 窗口不足
    } catch (e) { console.warn('[AutoTune] OLS校准失败:', e.message); }
  }

  // ── 多候选验证: 当前权重 vs 启发式 vs OLS ──
  let validation = null;
  let finalScores = { ...curScores };
  let finalSummary = weightChangesSummary;
  let acceptedMethod = 'none';

  const candidates = [{ name: 'heuristic', scores: heuristicScores }];
  if (olsResult && olsResult.weights) {
    candidates.push({ name: 'OLS', scores: olsResult.weights, olsStatus: olsResult.status });
  }

  if (scoreHistory.length >= MIN_SAMPLES) {
    // 对每个候选方案 vs 当前权重做 compareWeights
    let bestCandidate = null, bestAccuracy = -1;
    for (const cand of candidates) {
      // 只测试与当前权重不同的候选
      const isDifferent = Object.keys(cand.scores).some(k => cand.scores[k] !== curScores[k]);
      if (!isDifferent) continue;

      try {
        const cmp = compareWeights(scoreHistory, marketData, curScores, cand.scores);
        if (cmp.a.predictions + cmp.b.predictions >= MIN_SAMPLES) {
          const candAcc = cmp.b.accuracy;
          if (candAcc > bestAccuracy) {
            bestAccuracy = candAcc;
            bestCandidate = { name: cand.name, scores: cand.scores, comparison: cmp, olsStatus: cand.olsStatus };
          }
        }
      } catch (e) { console.warn(`[AutoTune] ${cand.name}验证失败:`, e.message); }
    }

    if (bestCandidate && bestCandidate.comparison.winner === 'B' && bestCandidate.comparison.delta > 0) {
      // 新权重更准 → 采纳
      finalScores = { ...bestCandidate.scores };
      acceptedMethod = bestCandidate.name;
      validation = bestCandidate.comparison;

      if (bestCandidate.name === 'OLS') {
        finalSummary = `OLS校准采纳 ✅ ${bestCandidate.olsStatus || ''}\n`;
        finalSummary += `  验证: 新权重准确率${bestCandidate.comparison.b.accuracy.toFixed(1)}% > 旧权重${bestCandidate.comparison.a.accuracy.toFixed(1)}%，提升${bestCandidate.comparison.delta.toFixed(1)}pp`;
      } else {
        finalSummary = weightChangesSummary +
          ` ✅ 验证通过(新权重准确率${bestCandidate.comparison.b.accuracy.toFixed(1)}% > 旧权重${bestCandidate.comparison.a.accuracy.toFixed(1)}%，提升${bestCandidate.comparison.delta.toFixed(1)}pp)`;
      }
    } else if (bestCandidate) {
      // 新权重不如旧权重 → 维持
      finalSummary = weightChangesSummary +
        ` ⚠️ 所有候选未通过验证，维持原权重。`;
      if (olsResult) finalSummary += ` (OLS已尝试但准确率未超过当前)`;
      acceptedMethod = 'rejected';
    }
  }

  logAutoTuneValidation({ validation });
  logAutoTuneFinal({ newScores: finalScores, changes, summary: finalSummary, tuned: acceptedMethod !== 'none' && acceptedMethod !== 'rejected', acceptedMethod });
  if (_endGroup) _endGroup();

  return {
    newScores: finalScores,
    originalScores: heuristicScores,
    changes,
    summary: finalSummary,
    details,
    diagnostics,
    validation,
    acceptedMethod
  };
}

/**
 * 自适应引擎完整执行 — 内部调用 autoTune + 持久化到 Firestore
 * 这是 Track B: 静默、自动、不干扰 LLM 的 run_backtest
 * @param {Object} firestoreContext — {db, userId, appId}
 * @param {Object} settings — 用户设置
 * @param {Array} scoreHistory — 打分快照
 * @param {Object} marketData — 市场K线数据
 * @returns {Promise<{tuned: boolean, summary: string}>}
 */
export async function runAutoTune(firestoreContext, settings, scoreHistory, marketData) {
  const { db, userId, appId } = firestoreContext || {};
  if (!db || !userId) return { tuned: false, summary: 'Firestore未连接，跳过自适应。' };

  // 读取当前活跃权重
  let currentScores = null;
  try {
    const { doc, getDoc } = await import('firebase/firestore');
    const activeRef = doc(db, 'artifacts', appId, 'users', userId, 'model_configs', 'active');
    const snap = await getDoc(activeRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.maxScores) currentScores = data.maxScores;
    }
  } catch (e) { /* 使用默认值 */ }

  const result = autoTune(scoreHistory, marketData, currentScores);

  // 保存到 Firestore（版本化）
  try {
    const { doc, setDoc } = await import('firebase/firestore');
    const ts = new Date().toISOString();
    const versionId = `v_${ts.replace(/[:.]/g, '-')}`;

    // 写入版本快照（含验证结果）
    const versionData = {
      maxScores: result.newScores,
      changes: result.changes,
      details: result.details,
      summary: result.summary,
      createdAt: ts,
      sampleCount: scoreHistory.length
    };
    // 若有验证数据，附带到版本快照
    if (result.validation) {
      versionData.validation = {
        winner: result.validation.winner,
        delta: result.validation.delta,
        oldAccuracy: result.validation.a.accuracy,
        newAccuracy: result.validation.b.accuracy,
        oldPredictions: result.validation.a.predictions,
        newPredictions: result.validation.b.predictions,
        note: result.validation.note
      };
    }
    if (result.originalScores) {
      versionData.originalScores = result.originalScores;
    }
    if (result.acceptedMethod) {
      versionData.acceptedMethod = result.acceptedMethod;
    }
    const versionRef = doc(db, 'artifacts', appId, 'users', userId, 'model_configs', versionId);
    await setDoc(versionRef, versionData);

    // 更新活跃配置
    const activeRef = doc(db, 'artifacts', appId, 'users', userId, 'model_configs', 'active');
    await setDoc(activeRef, {
      maxScores: result.newScores,
      updatedAt: ts,
      sampleCount: scoreHistory.length,
      lastSummary: result.summary,
      ...(result.validation ? {
        lastValidation: {
          winner: result.validation.winner,
          delta: result.validation.delta,
          note: result.validation.note
        }
      } : {})
    }, { merge: true });

    // 注入到 settings 供后续 scoring 使用
    const settingsRef = doc(db, 'artifacts', appId, 'users', userId, 'settings', 'general');
    await setDoc(settingsRef, { tunedMaxScores: result.newScores, tunedAt: ts }, { merge: true });

  } catch (e) {
    console.warn('[AutoTune] Firestore持久化失败:', e.message);
  }

  // 判断是否实际生效（验证通过且权重确实变了）
  const actuallyChanged = Object.entries(result.newScores).some(
    ([k, v]) => v !== (currentScores?.[k] ?? DEFAULT_MAX_SCORES[k])
  );

  return {
    tuned: actuallyChanged,
    summary: result.summary,
    newScores: result.newScores,
    validation: result.validation,
    acceptedMethod: result.acceptedMethod || 'none'
  };
}
