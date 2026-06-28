// 量化引擎诊断日志 — 控制台探针输出
// 所有 JS 决策树/回测/自适应/BL模型的计算过程与结果统一在这里展示
// 通过 window.__QUANT_LOG__ 控制开关：
//   window.__QUANT_LOG__ = true   → 开启（默认开启，DEV模式下）
//   window.__QUANT_LOG__ = false  → 关闭
//   window.__QUANT_LOG__ = 'full' → 全量展开（不折叠 console.group）

const DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

const isEnabled = () => {
  if (typeof window !== 'undefined') {
    if (window.__QUANT_LOG__ !== undefined) return window.__QUANT_LOG__ !== false;
    if (window.__QUANT_LOG__ === undefined) window.__QUANT_LOG__ = true; // 首次加载默认开启
    return true;
  }
  return false; // Node.js 环境
};

const isFullExpand = () => {
  if (typeof window !== 'undefined') {
    return window.__QUANT_LOG__ === 'full';
  }
  return false;
};

// ── 样式配置 ──
const STYLES = {
  scoring:  'color: #10b981; font-weight: bold;',   // 绿 — 决策树
  autotune: 'color: #f59e0b; font-weight: bold;',   // 橙 — 自适应调参
  backtest: 'color: #6366f1; font-weight: bold;',   // 紫 — 回测
  bl:       'color: #ec4899; font-weight: bold;',   // 粉 — B-L模型
  matrix:   'color: #06b6d4; font-weight: bold;',   // 青 — 矩阵运算
  warning:  'color: #ef4444; font-weight: bold;',   // 红 — 警告
  success:  'color: #22c55e; font-weight: bold;',   // 绿 — 成功
  input:    'color: #94a3b8;',                       // 灰 — 输入
  output:   'color: #fbbf24; font-weight: bold;',   // 金 — 输出
  path:     'color: #a78bfa;',                       // 紫 — 路径
};

// ── 分组工具 ──
const group = (label, style = '') => {
  if (!isEnabled()) return () => {};
  const fn = isFullExpand() ? console.group : console.groupCollapsed;
  fn(`%c${label}`, style);
  return () => { if (isEnabled()) console.groupEnd(); };
};

const log = (emoji, label, value, style = '') => {
  if (!isEnabled()) return;
  if (value !== undefined) {
    console.log(`%c${emoji} ${label}:`, style, value);
  } else {
    console.log(`%c${emoji} ${label}`, style);
  }
};

const table = (data, columns) => {
  if (!isEnabled()) return;
  if (columns) {
    console.table(data, columns);
  } else {
    console.table(data);
  }
};

// ══════════════════════════════════════════════════════════════
// 决策树探针
// ══════════════════════════════════════════════════════════════

export function logDecisionTree(treeName, ctx, result) {
  if (!isEnabled()) return;
  const end = group(`🔬 [决策树] ${treeName}`, STYLES.scoring);

  // 输入
  log('📥', '输入参数', null, STYLES.input);
  const safeCtx = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') safeCtx[k] = JSON.stringify(v).substring(0, 120);
    else safeCtx[k] = v;
  }
  console.table(safeCtx);

  // 输出
  log('📤', '判定结果', null, STYLES.output);
  console.table({
    category: result.category,
    baseScore: result.baseScore,
    scoreRange: `${result.scoreRange[0]}~${result.scoreRange[1]}`,
    confidence: result.confidence,
    keySignals: result.keySignals?.join(' | '),
    overrides: result.overrides ? JSON.stringify(result.overrides) : '无'
  });

  end();
}

// ══════════════════════════════════════════════════════════════
// F3 VR 计算探针
// ══════════════════════════════════════════════════════════════

export function logVRCalc(ctx, result) {
  if (!isEnabled()) return;
  const end = group('🔬 [决策树] F3 量价验证 — VR计算 + 拦截检测', STYLES.scoring);

  log('📥', 'VR 计算', null, STYLES.input);
  console.table({
    todayTurnoverYi: ctx.todayTurnoverYi + '亿',
    avg5d: ctx.recentTurnovers?.length > 0
      ? (ctx.recentTurnovers.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(ctx.recentTurnovers.length, 5)).toFixed(2) + '亿'
      : '无数据(定性兜底)',
    VR: result.VR.toFixed(2),
    vrSource: result.vrSource,
    upCount: ctx.upCount,
    downCount: ctx.downCount,
    涨跌比: ctx.downCount > 0 ? (ctx.upCount / ctx.downCount).toFixed(2) : '∞',
    shChange: (ctx.indexChanges?.sh != null ? (ctx.indexChanges.sh * 100).toFixed(2) + '%' : '?'),
    cybChange: (ctx.indexChanges?.cyb != null ? (ctx.indexChanges.cyb * 100).toFixed(2) + '%' : '?'),
    microstructureSignal: ctx.microstructureSignal || '⚪ neutral',
    分红季豁免: ctx.microstructureSignal === '🚨 fatal' ? '(检查中...)' : '不适用'
  });

  if (result.intercepted) {
    log('🚨', '拦截器触发!', result.category, STYLES.warning);
  } else {
    log('✅', '正常博弈档位', result.category, STYLES.success);
  }

  log('📤', '判定结果', null, STYLES.output);
  console.table({
    category: result.category,
    score: result.score + '/25',
    scoreRange: `${result.scoreRange[0]}~${result.scoreRange[1]}`,
    reason: result.reason,
    overrides: result.overrides ? JSON.stringify(result.overrides) : '无',
    VR: result.VR.toFixed(2),
    vrSource: result.vrSource
  });

  end();
}

// ══════════════════════════════════════════════════════════════
// 基金评分卡探针
// ══════════════════════════════════════════════════════════════

export function logFundScore(fundCode, fundName, ctx, result) {
  if (!isEnabled()) return;
  const end = group(`🔬 [基金评分] ${fundName}(${fundCode})`, STYLES.scoring);

  log('📥', '基金指标输入', null, STYLES.input);
  console.table({
    annualReturn: ctx.annualReturn != null ? (ctx.annualReturn * 100).toFixed(1) + '%' : '缺失',
    sharpe: ctx.sharpe ?? '缺失',
    ir: ctx.ir ?? '缺失',
    mdd: ctx.mdd != null ? (ctx.mdd * 100).toFixed(1) + '%' : '缺失',
    upCapture: ctx.upCapture != null ? ctx.upCapture + '%' : '缺失',
    downCapture: ctx.downCapture != null ? ctx.downCapture + '%' : '缺失',
    ranking: ctx.ranking || '缺失',
    verdict: ctx.verdict || '缺失',
    feeRate: ctx.feeRate != null ? ctx.feeRate + '%' : '缺失',
    isShortTerm: ctx.isShortTerm ? '⚠️是' : '否',
    volatility: ctx.volatility != null ? (ctx.volatility * 100).toFixed(1) + '%' : '缺失'
  });

  log('📤', '评分结果', null, STYLES.output);
  const bd = result.breakdown;
  const rows = {};
  let totalWeight = 0, totalScore = 0;
  for (const [k, v] of Object.entries(bd)) {
    rows[k] = `${v.score}/${v.max} | ${v.category}`;
    totalWeight += v.max;
    totalScore += v.score;
  }
  rows['汇总(归一化)'] = `${result.baseScore}/100 (原始 ${totalScore}/${totalWeight})`;
  if (result.overrides?.blackList) rows['⚠️ BLACK_LIST'] = '全局否决，强制 ≤10分';
  console.table(rows);

  end();
}

// ══════════════════════════════════════════════════════════════
// AutoTuner 探针
// ══════════════════════════════════════════════════════════════

export function logAutoTuneStart(scoreHistoryLen, marketDataLen) {
  if (!isEnabled()) return;
  const end = group('⚙️ [AutoTuner] 自适应引擎启动', STYLES.autotune);
  log('📥', '输入规模', `${scoreHistoryLen}条快照 | ${marketDataLen}个K线日期`, STYLES.input);
  return end;
}

export function logAutoTuneFactor(key, details, oldScore, newScore, delta, status) {
  if (!isEnabled()) return;
  const emoji = delta > 0 ? '📈' : delta < 0 ? '📉' : '➡️';
  const style = delta !== 0 ? STYLES.autotune : STYLES.input;
  console.log(
    `%c${emoji} ${key}: ${oldScore}→${newScore} (${delta >= 0 ? '+' : ''}${delta}) | 准确率${details.accuracy}% (${details.correct}/${details.samples}) | ${status}`,
    style
  );
}

export function logAutoTuneValidation(result) {
  if (!isEnabled()) return;
  if (!result.validation) return;
  const v = result.validation;
  const emoji = v.winner === 'B' ? '✅' : v.winner === 'A' ? '⏪' : '➡️';
  console.log(
    `%c${emoji} 权重验证: ${v.note}`,
    v.winner === 'B' ? STYLES.success : v.winner === 'A' ? STYLES.warning : STYLES.input
  );
  console.table({
    '旧权重准确率': v.a.accuracy.toFixed(1) + '%',
    '新权重准确率': v.b.accuracy.toFixed(1) + '%',
    '差值': (v.delta > 0 ? '+' : '') + v.delta.toFixed(1) + 'pp',
    '胜者': v.winner === 'B' ? '新权重✅' : v.winner === 'A' ? '旧权重⏪' : '持平➡️'
  });
}

export function logAutoTuneFinal(result) {
  if (!isEnabled()) return;
  const pathLabel = result.acceptedMethod === 'OLS' ? 'OLS回归' : result.acceptedMethod === 'heuristic' ? '启发式' : result.acceptedMethod === 'rejected' ? '已拒绝' : '无';
  const pathStyle = result.acceptedMethod === 'OLS' ? STYLES.matrix : result.acceptedMethod === 'heuristic' ? STYLES.autotune : STYLES.input;
  log('📤', '最终结果', result.summary, STYLES.output);
  log('🔀', '采纳路径', pathLabel, pathStyle);
  const scores = {};
  for (const [k, v] of Object.entries(result.newScores)) {
    scores[k] = v;
  }
  console.table(scores);
  if (result.tuned !== undefined) {
    log(result.tuned ? '✅' : '⏭️', '生效状态', result.tuned ? '已生效（已验证+持久化）' : '未生效或无需调整', result.tuned ? STYLES.success : STYLES.input);
  }
}

// ══════════════════════════════════════════════════════════════
// OLS 探针
// ══════════════════════════════════════════════════════════════

export function logOLSCalibrationStart(sampleCount, trainSize, validSize, horizon) {
  if (!isEnabled()) return () => {};
  const end = group('🧮 [OLS] Walk-Forward 校准启动', STYLES.matrix);
  log('📥', '样本/窗口', `${sampleCount}条 | 训练${trainSize} | 验证${validSize} | T+${horizon}`, STYLES.matrix);
  return end;
}

export function logOLSWindow(index, valRange, rSquared, valAccuracy) {
  if (!isEnabled()) return;
  console.log(
    `%c  窗口${index} %c${valRange}%c | R²=%c${rSquared.toFixed(3)}%c | 验证=%c${(valAccuracy*100).toFixed(1)}%`,
    STYLES.matrix, 'color: #94a3b8', STYLES.matrix, 'color: #fbbf24', STYLES.matrix, 'color: #22c55e'
  );
}

export function logOLSBetas(beta, tStats) {
  if (!isEnabled()) return;
  console.log(`%c📐 加权平均β: %c[${beta.map(v => v.toFixed(5)).join(', ')}]`, STYLES.matrix, 'color: #fbbf24');
  console.log(`%c📐 平均t统计: %c[${tStats.map(v => v.toFixed(2)).join(', ')}]`, STYLES.matrix, 'color: #fbbf24');
}

export function logOLSWeights(finalWeights) {
  if (!isEnabled()) return;
  console.log(`%c📤 最终权重: %c${JSON.stringify(finalWeights)}`, STYLES.matrix, 'color: #22c55e');
}

export function logAutoTuneOLS(olsResult) {
  if (!isEnabled() || !olsResult) return;
  const end = group('🧮 [AutoTuner] OLS Walk-Forward 校准', STYLES.matrix);

  log('📥', 'OLS状态', olsResult.status, STYLES.input);

  if (olsResult.details) {
    const d = olsResult.details;
    log('📐', '样本规模', `${d.samples}条有效样本 | ${d.windows}个滑动窗口`, STYLES.matrix);
    log('📐', '验证准确率', `${(d.avgValidationAccuracy*100).toFixed(1)}%`, STYLES.matrix);
    log('📐', '平均R²', d.avgRSquared.toFixed(3), STYLES.matrix);

    // β系数 + t统计量 + 调整决策
    console.log('%c📐 β系数 & t统计量:', STYLES.matrix);
    const betaRows = {};
    const FACTOR_KEYS = ['F1a','F1b','F2','F3','F4'];
    for (let j = 0; j < FACTOR_KEYS.length; j++) {
      betaRows[FACTOR_KEYS[j]] = {
        'β系数': d.avgBeta[j].toFixed(5),
        't统计量': d.avgTStats[j].toFixed(2),
        '|t|': Math.abs(d.avgTStats[j]).toFixed(2),
        '判定': d.adjustments[FACTOR_KEYS[j]] || '→维持'
      };
    }
    console.table(betaRows);

    // 权重转换结果
    console.log('%c📤 OLS建议权重 vs 默认权重:', STYLES.output);
    const weightRows = {};
    const DEF = { F1a: 20, F1b: 15, F2: 25, F3: 25, F4: 15 };
    for (const k of FACTOR_KEYS) {
      weightRows[k] = {
        '默认': DEF[k],
        '原始OLSwt': olsResult.details.rawWeights[k],
        '最终(归一化+边界)': olsResult.weights[k],
        '调整': olsResult.details.adjustments[k] || '→维持'
      };
    }
    console.table(weightRows);

    // Walk-forward 窗口详情（折叠）
    const wfEnd = group(`📋 ${d.windows}个Walk-Forward窗口详情`, STYLES.path);
    const wfRows = {};
    for (let w = 0; w < d.windows.length; w++) {
      const wf = d.windows[w];
      wfRows[`窗口${w+1} ${wf.valRange}`] = {
        'R²': wf.rSquared.toFixed(3),
        '验证准确率': (wf.valAccuracy*100).toFixed(1)+'%',
        'β[F1a]': wf.beta[0].toFixed(5),
        'β[F1b]': wf.beta[1].toFixed(5),
        'β[F2]': wf.beta[2].toFixed(5),
        'β[F3]': wf.beta[3].toFixed(5),
        'β[F4]': wf.beta[4].toFixed(5)
      };
    }
    console.table(wfRows);
    wfEnd();
  }

  end();
}

// ══════════════════════════════════════════════════════════════
// 回测探针
// ══════════════════════════════════════════════════════════════

export function logBacktestStart(scoreHistoryLen, marketDatesLen, forwardHorizons) {
  if (!isEnabled()) return;
  const end = group('📊 [回测] 评分预测效力验证', STYLES.backtest);
  log('📥', '输入', `${scoreHistoryLen}条快照 | ${marketDatesLen}个K线日期 | 前向窗口 ${forwardHorizons.join('/')}天`, STYLES.input);
  return end;
}

export function logBacktestOverview(overview) {
  if (!isEnabled()) return;
  const end = group('📊 [回测] 总览结果', STYLES.backtest);
  console.log(`%c总预测: ${overview.totalPredictions}次 | 正确: ${overview.correctDirections}次 | 准确率: ${overview.accuracy.toFixed(1)}%`, STYLES.output);
  console.log(`%c${overview.grade}`, overview.accuracy > 65 ? STYLES.success : overview.accuracy > 50 ? STYLES.autotune : STYLES.warning);

  if (overview._diag) {
    log('🔍', '样本诊断', null, STYLES.path);
    console.table(overview._diag);
  }
  end();
}

export function logBacktestCIO(byCIOOutcome) {
  if (!isEnabled()) return;
  const end = group('📊 [回测] CIO 映射分组准确率', STYLES.backtest);
  for (const [category, stats] of Object.entries(byCIOOutcome)) {
    console.log(`%c${category}: ${stats.accuracy} (${stats.correct}/${stats.total})`, stats.accuracy > 65 ? STYLES.success : stats.accuracy > 50 ? STYLES.autotune : STYLES.warning);
  }
  end();
}

export function logBacktestHorizon(byHorizon) {
  if (!isEnabled()) return;
  const end = group('📊 [回测] 前向窗口衰减', STYLES.backtest);
  for (const [h, stats] of Object.entries(byHorizon)) {
    console.log(`%cT+${h}: ${stats.accuracy.toFixed(1)}% (${stats.observations}次)`, stats.accuracy > 65 ? STYLES.success : stats.accuracy > 50 ? STYLES.autotune : STYLES.warning);
  }
  end();
}

export function logBacktestCalibration(calibration, omegaSuggestion) {
  if (!isEnabled()) return;
  const end = group('📊 [回测] 校准评估 & Ω建议', STYLES.backtest);
  log('📐', 'Spearman ρ', calibration.spearmanCorrelation, STYLES.matrix);
  log('📐', '判定', calibration.correlationNote, STYLES.path);
  if (omegaSuggestion) {
    log('🎯', 'Ω建议', `rawAccuracy=${omegaSuggestion.rawAccuracy} → Ω=${omegaSuggestion.recommendedOmega}`, STYLES.output);
  }
  end();
}

// ══════════════════════════════════════════════════════════════
// Meta-Vigilance 探针
// ══════════════════════════════════════════════════════════════

export function logMetaVigilance(result) {
  if (!isEnabled()) return;
  const end = group('🛡️ [Meta-Vigilance] 预测效力自检', result.warning ? STYLES.warning : STYLES.success);
  console.log(`%c${result.message}`, result.warning ? STYLES.warning : STYLES.success);
  if (result.details) {
    log('📋', '逐条对比', result.details, STYLES.path);
  }
  end();
}

export function logDegradation(result) {
  if (!isEnabled()) return;
  if (result.degrading) {
    console.log(`%c🚨 [退化检测] ${result.message}`, STYLES.warning);
  } else {
    console.log(`%c✅ [退化检测] ${result.message}`, STYLES.success);
  }
  if (result.trend?.length > 0) {
    console.log('%c📈 滚动准确率趋势:', STYLES.path, result.trend.map(v => v.toFixed(0) + '%').join(' → '));
  }
}

// ══════════════════════════════════════════════════════════════
// B-L 模型探针
// ══════════════════════════════════════════════════════════════

export function logBLCalibration(rawAccuracy, numViews, calibrated) {
  if (!isEnabled()) return;
  const end = group('🧮 [B-L] Ω 置信度校准', STYLES.bl);
  log('📥', '输入', `rawAccuracy=${(rawAccuracy*100).toFixed(1)}% | numViews=${numViews}`, STYLES.input);
  const sigmoid = 1 / (1 + Math.exp(-(rawAccuracy - 0.5) * 5));
  console.log(`%c📐 Sigmoid映射: ${(rawAccuracy*100).toFixed(1)}% → ${(0.1+0.8*sigmoid).toFixed(3)}`, STYLES.matrix);
  console.log(`%c📐 √Views惩罚: /√${numViews} = /${Math.sqrt(numViews).toFixed(2)}`, STYLES.matrix);
  console.log(`%c📤 最终Ω: ${calibrated.toFixed(3)} (硬约束 [0.05, 0.90])`, STYLES.output);
  end();
}

export function logBLViews(buildResult) {
  if (!isEnabled()) return;
  const end = group('🧮 [B-L] Views 构建', STYLES.bl);
  log('📥', '先验权重', `${(buildResult.priorWeights.bond*100).toFixed(0)}%债/${(buildResult.priorWeights.equity*100).toFixed(0)}%权益/${(buildResult.priorWeights.cash*100).toFixed(0)}%现金`, STYLES.input);
  log('📥', '当前权重', `${(buildResult.currentWeights.bond*100).toFixed(0)}%债/${(buildResult.currentWeights.equity*100).toFixed(0)}%权益/${(buildResult.currentWeights.cash*100).toFixed(0)}%现金`, STYLES.input);
  log('📥', 'Meta-Vigilance准确率', (buildResult.metaVigilanceAccuracy * 100).toFixed(1) + '%', STYLES.input);

  if (buildResult.views.length === 0) {
    log('📤', '观点', '无显著偏离先验的观点 → 使用协方差风险加权', STYLES.output);
  } else {
    console.log('%c📤 生成的观点向量:', STYLES.output);
    for (const v of buildResult.views) {
      console.log(`%c  ${v.asset}: ${v.direction} | outperformance=${(v.outperformance*100).toFixed(1)}% | Ω=${v.confidence.toFixed(3)}`, STYLES.path);
    }
    log('📤', '汇总', buildResult.summary, STYLES.output);
  }
  end();
}

export function logBLPosteriorStart(n, funds, prior, views, covCondition) {
  if (!isEnabled()) return;
  const end = group('🧮 [B-L] 后验优化', STYLES.bl);
  log('📥', '资产数', n, STYLES.input);
  log('📥', '宪法先验', prior.label, STYLES.input);
  log('📥', '观点数', views?.length || 0, STYLES.input);
  log('📐', '协方差条件数', covCondition != null ? covCondition.toExponential(2) : '待计算', covCondition < 1e10 ? STYLES.matrix : STYLES.warning);
  return end;
}

export function logBLPosteriorResult(result) {
  if (!isEnabled()) return;
  log('📤', '状态', result.status, result.status.includes('成功') ? STYLES.success : STYLES.warning);
  log('📐', '条件数', result.conditionNumber != null ? result.conditionNumber.toExponential(2) : '?', STYLES.matrix);

  if (result.optimalWeights && Object.keys(result.optimalWeights).length > 0) {
    const end = group('📤 最优权重分配', STYLES.output);
    const rows = {};
    for (const [code, w] of Object.entries(result.optimalWeights)) {
      rows[code] = (w * 100).toFixed(2) + '%';
    }
    console.table(rows);
    end();
  }
}

export function logBLCurrentWeights(funds, result) {
  if (!isEnabled()) return;
  const end = group('🧮 [B-L] 当前大类权重计算', STYLES.bl);
  log('📥', '持仓基金数', funds?.length || 0, STYLES.input);
  for (const f of funds || []) {
    const cls = (f.fundName || '').toLowerCase().includes('债') ? 'bond'
      : (f.fundName || '').toLowerCase().includes('货币') ? 'cash' : 'equity';
    console.log(`%c  ${f.fundName || f.fundCode}: ${(f.currentWeight * 100).toFixed(1)}% → ${cls}`, STYLES.path);
  }
  console.log(`%c📤 汇总: ${(result.bond*100).toFixed(0)}%债 ${(result.equity*100).toFixed(0)}%权益 ${(result.cash*100).toFixed(0)}%现金`, STYLES.output);
  end();
}

// ══════════════════════════════════════════════════════════════
// 配置面板
// ══════════════════════════════════════════════════════════════

export function initQuantLogger() {
  if (typeof window === 'undefined') return;
  // 首次加载默认开启
  if (window.__QUANT_LOG__ === undefined) window.__QUANT_LOG__ = true;
  const status = window.__QUANT_LOG__ ? '✅ 开启' : '⏸️ 关闭';
  const mode = window.__QUANT_LOG__ === 'full' ? '(全量展开)' : '(折叠模式)';
  console.log(
    `%c🔬 [量化探针] ${status} ${mode} | window.__QUANT_LOG__=true/\"full\"/false 控制开关`,
    STYLES.scoring
  );
}
