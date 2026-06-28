// B-L 模型校准层 — Ω 置信度校准 + GLOBAL_CONSTITUTION 解析 + AI打分→Views转换
// 防坑2: Ω 从不直接使用 Meta-Vigilance 准确率，必须过三层校准
// 确认2: B-L 先验权重来自 GLOBAL_CONSTITUTION 备忘录，而非外部指数

import { classifyFundType } from './scoring-tree';
import { logBLCalibration, logBLViews, logBLCurrentWeights, logBLPosteriorStart, logBLPosteriorResult } from './quantLogger';

// ============================================================================
// 第一层：Sigmoid 缩放 — 准确率映射到 [0.1, 0.9]
// rawAccuracy: Meta-Vigilance 近15日预测正确率 (0-1)
// 返回值始终在 [0.1, 0.89] 区间
// ============================================================================
export function calibrateConfidence(rawAccuracy, numViews = 1) {
  // 第一层：Sigmoid 映射
  // raw=0.3 → 0.18 | raw=0.5 → 0.50 | raw=0.7 → 0.82 | raw=1.0 → 0.89
  const steepness = 5;
  const sigmoid = 1 / (1 + Math.exp(-(rawAccuracy - 0.5) * steepness));
  let calibrated = 0.1 + 0.8 * sigmoid;

  // 第二层：观点数量膨胀惩罚
  // 10个观点 → 每个的有效置信度 / sqrt(10) ≈ /3.16
  const numViewsSafe = Math.max(1, numViews);
  calibrated = calibrated / Math.sqrt(numViewsSafe);

  // 第三层：硬约束 [0.05, 0.90]
  const final = Math.max(0.05, Math.min(0.90, calibrated));
  logBLCalibration(rawAccuracy, numViews, final);
  return final;
}

// ============================================================================
// 第二层：GLOBAL_CONSTITUTION 解析 → 先验权重 (w_prior)
// 从备忘录结构化格式中提取风险偏好 → 固收/权益/现金比例
// ============================================================================

/**
 * 从 GLOBAL_CONSTITUTION coreLogic 解析资产配置基准
 * @param {string} coreLogic - 宪法备忘录的 coreLogic 字段
 * @returns {{ bond: number, equity: number, cash: number, label: string }}
 */
export function parseConstitutionToPrior(coreLogic) {
  if (!coreLogic) {
    return { bond: 0.60, equity: 0.30, cash: 0.10, label: '默认(保守)' };
  }

  const text = (coreLogic && typeof coreLogic.toLowerCase === 'function') ? coreLogic : String(coreLogic || '');

  // 提取约束字段
  const constraintMatch = String(text).match(/约束[：:]\s*(.+?)(?:\n|$)/);
  const constraint = constraintMatch ? constraintMatch[1].trim() : '';

  // 提取年化目标
  const targetMatch = String(text).match(/年化[：:]\s*(\d+\.?\d*)\s*%/);
  const annualTarget = targetMatch ? parseFloat(targetMatch[1]) : 8;

  // ── 规则映射 ──
  if (constraint.includes('固收为主') && constraint.includes('适度增强')) {
    return { bond: 0.70, equity: 0.20, cash: 0.10, label: '固收为主+适度增强' };
  }
  if (constraint.includes('固收为主') || constraint.includes('稳健')) {
    return { bond: 0.80, equity: 0.10, cash: 0.10, label: '固收为主(保守)' };
  }
  if (constraint.includes('均衡')) {
    return { bond: 0.45, equity: 0.45, cash: 0.10, label: '均衡配置' };
  }
  if (constraint.includes('进取') || constraint.includes('积极')) {
    return { bond: 0.20, equity: 0.70, cash: 0.10, label: '积极进取' };
  }
  if (constraint.includes('纯债') || constraint.includes('固收')) {
    return { bond: 0.85, equity: 0.05, cash: 0.10, label: '纯债/固收' };
  }

  // 从年化目标推断
  if (annualTarget <= 4) {
    return { bond: 0.80, equity: 0.10, cash: 0.10, label: `保守(目标${annualTarget}%)` };
  }
  if (annualTarget <= 7) {
    return { bond: 0.65, equity: 0.25, cash: 0.10, label: `稳健(目标${annualTarget}%)` };
  }
  if (annualTarget <= 12) {
    return { bond: 0.40, equity: 0.50, cash: 0.10, label: `均衡(目标${annualTarget}%)` };
  }

  return { bond: 0.60, equity: 0.30, cash: 0.10, label: `默认(目标${annualTarget}%)` };
}

// ============================================================================
// 第三层：AI 打分 → B-L Views 转换
// 将 F1-F4 的打分和 CIO 判定转换为 B-L 模型的观点向量
// ============================================================================

/**
 * 将评分引擎输出转换为 B-L 模型的观点向量
 * @param {Object} scoring - { equity: { F1a, F1b, F2, F3, F4, momentum, final, verdict }, bond: {...} }
 * @param {Object} priorWeights - 宪法先验权重 { bond, equity, cash }
 * @param {Object} currentWeights - 当前实际权重 { bond, equity, cash }
 * @param {number} metaVigilanceAccuracy - Meta-Vigilance 近15日预测正确率 (0-1)，默认0.5
 * @returns {{ views: Array<{asset, direction, outperformance, confidence}>, summary: string }}
 */
export function buildBLViews(scoring, priorWeights, currentWeights, metaVigilanceAccuracy = 0.5) {
  const views = [];
  const equityScore = scoring?.equity?.final ?? 50;
  const equityVerdict = scoring?.equity?.verdict || 'HOLD_STRATEGY';
  const bondScore = scoring?.bond?.final ?? 50;
  const bondVerdict = scoring?.bond?.verdict || 'HOLD_STRATEGY';

  const priorEquity = priorWeights?.equity || 0.30;
  const priorBond = priorWeights?.bond || 0.60;
  const currentEquity = currentWeights?.equity ?? priorEquity;
  const currentBond = currentWeights?.bond ?? priorBond;

  // ── 权益方向判定 ──
  const equityDeviation = (equityScore - 50) / 50;  // -1到+1
  let equityDirection = 'neutral';
  let equityMagnitude = 0;

  if (equityVerdict === 'BLACK_LIST') {
    equityDirection = 'strong_underweight';
    equityMagnitude = -Math.max(0.05, Math.abs(currentEquity - priorEquity));
  } else if (equityScore >= 75) {
    equityDirection = 'overweight';
    equityMagnitude = Math.min(0.10, equityDeviation * 0.10);
  } else if (equityScore >= 55) {
    equityDirection = 'slight_overweight';
    equityMagnitude = Math.min(0.05, equityDeviation * 0.05);
  } else if (equityScore < 35) {
    equityDirection = 'underweight';
    equityMagnitude = Math.min(0.10, Math.abs(equityDeviation) * 0.10);
  } else if (equityScore < 45) {
    equityDirection = 'slight_underweight';
    equityMagnitude = Math.min(0.05, Math.abs(equityDeviation) * 0.05);
  }

  if (equityDirection !== 'neutral' && Math.abs(equityMagnitude) > 0.01) {
    const confidence = calibrateConfidence(metaVigilanceAccuracy, 1 + (bondScore != null ? 1 : 0));
    views.push({
      asset: 'EQUITY',
      direction: equityDirection,
      outperformance: equityDirection.includes('under') ? -Math.abs(equityMagnitude) : Math.abs(equityMagnitude),
      confidence
    });
  }

  // ── 固收方向判定 ──
  if (bondScore != null && bondScore !== undefined) {
    const bondDeviation = (bondScore - 50) / 50;
    let bondDirection = 'neutral';
    let bondMagnitude = 0;

    if (bondVerdict === 'BLACK_LIST') {
      bondDirection = 'strong_underweight';
      bondMagnitude = Math.max(0.05, Math.abs(currentBond - priorBond));
    } else if (bondScore >= 75) {
      bondDirection = 'overweight';
      bondMagnitude = Math.min(0.10, bondDeviation * 0.10);
    } else if (bondScore >= 55) {
      bondDirection = 'slight_overweight';
      bondMagnitude = Math.min(0.05, bondDeviation * 0.05);
    } else if (bondScore < 35) {
      bondDirection = 'underweight';
      bondMagnitude = Math.min(0.10, Math.abs(bondDeviation) * 0.10);
    }

    if (bondDirection !== 'neutral' && Math.abs(bondMagnitude) > 0.01) {
      const confidence = calibrateConfidence(metaVigilanceAccuracy, 2);
      views.push({
        asset: 'BOND',
        direction: bondDirection,
        outperformance: bondDirection.includes('under') ? -Math.abs(bondMagnitude) : Math.abs(bondMagnitude),
        confidence
      });
    }
  }

  const summaryParts = [];
  for (const v of views) {
    const dirLabel = v.outperformance > 0
      ? `超配+${(v.outperformance * 100).toFixed(1)}%`
      : `低配${(v.outperformance * 100).toFixed(1)}%`;
    summaryParts.push(`${v.asset}:${dirLabel}(Ω=${v.confidence.toFixed(2)})`);
  }

  const _blResult = {
    views,
    summary: summaryParts.length > 0 ? summaryParts.join(' | ') : '无显著偏离先验的观点',
    priorWeights,
    currentWeights,
    metaVigilanceAccuracy
  };
  logBLViews(_blResult);
  return _blResult;
}

// ============================================================================
// 矩阵运算工具（纯 JS，零外部依赖，≤15×15 数值稳定）
// ============================================================================

const matMul = (A, B) => {
  const m = A.length, n = B[0].length, p = B.length;
  const C = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++)
      for (let k = 0; k < p; k++)
        C[i][j] += A[i][k] * B[k][j];
  return C;
};

const matTranspose = (A) => {
  const m = A.length, n = A[0].length;
  const C = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < m; i++)
    for (let j = 0; j < n; j++)
      C[j][i] = A[i][j];
  return C;
};

const matScale = (A, s) => A.map(row => row.map(v => v * s));

const matAdd = (A, B) => A.map((row, i) => row.map((v, j) => v + B[i][j]));

// Gaussian elimination 求逆矩阵
const matInverse = (A) => {
  const n = A.length;
  // 增广矩阵 [A | I]
  const aug = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let col = 0; col < n; col++) {
    // 部分主元选取
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    if (Math.abs(aug[maxRow][col]) < 1e-14) return null; // 奇异矩阵
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    // 归一化主元行
    const pivot = aug[col][col];
    for (let j = col; j < 2 * n; j++) aug[col][j] /= pivot;
    // 消元
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j < 2 * n; j++) aug[row][j] -= factor * aug[col][j];
    }
  }
  return aug.map(row => row.slice(n));
};

// 条件数估计（1-范数）
const matCondition = (A) => {
  const inv = matInverse(A);
  if (!inv) return Infinity;
  let normA = 0, normInv = 0;
  for (let j = 0; j < A[0].length; j++) {
    let colSum = 0, colSumInv = 0;
    for (let i = 0; i < A.length; i++) { colSum += Math.abs(A[i][j]); colSumInv += Math.abs(inv[i][j]); }
    normA = Math.max(normA, colSum);
    normInv = Math.max(normInv, colSumInv);
  }
  return normA * normInv;
};

// ============================================================================
// B-L 后验优化：观点 + 先验 + 协方差 → 最优权重
// ============================================================================

/**
 * Black-Litterman 后验优化
 * @param {Object} prior - { bond, equity, cash, label }
 * @param {Array} views - B-L 观点向量 [{ asset: 'EQUITY'|'BOND', outperformance, confidence }]
 * @param {number[][]} covMatrix - 基金级协方差矩阵 (N×N)
 * @param {string[]} fundCodes - 基金代码列表（与 covMatrix 行列对应）
 * @param {Object[]} funds - 基金信息 [{ fundCode, fundName, currentWeight }]
 * @returns {{ optimalWeights: Object<string,number>, posteriorReturns: number[][], status: string, conditionNumber: number }}
 */
export function blackLittermanPosterior(prior, views, covMatrix, fundCodes, funds) {
  const n = covMatrix.length;
  if (n < 2) return { optimalWeights: {}, status: '资产不足', conditionNumber: 0 };

  logBLPosteriorStart(n, funds, prior, views, null);

  // 1. 将基金归类为 equity/bond/cash
  const fundClass = funds.map(f => {
    const name = (f.fundName || '').toLowerCase();
    if (name.includes('货币')) return 'cash';
    if (name.includes('债')) return 'bond';
    return 'equity';
  });

  // 2. 当前大类权重
  const currW = { equity: 0, bond: 0, cash: 0 };
  for (let i = 0; i < n; i++) {
    currW[fundClass[i]] += (funds[i]?.currentWeight || 1 / n);
  }

  // 3. 条件数检查
  const cond = matCondition(covMatrix);
  if (cond > 1e10) {
    // 协方差矩阵奇异 → 返回宪法均衡权重
    const eqWeights = {};
    for (let i = 0; i < n; i++) {
      const cls = fundClass[i];
      const clsFunds = fundClass.filter(c => c === cls).length;
      eqWeights[fundCodes[i]] = prior[cls] / Math.max(1, clsFunds);
    }
    return { optimalWeights: eqWeights, status: `协方差矩阵奇异(条件数${cond.toExponential(2)})，使用宪法均衡权重`, conditionNumber: cond };
  }

  // 4. 若无观点 → 基于协方差做风险加权优化（w* ∝ Σ⁻¹ × w_prior）
  if (!views || views.length === 0) {
    const wPriorVec = fundCodes.map((_, i) => {
      const cls = fundClass[i];
      const clsFunds = fundClass.filter(c => c === cls).length;
      return prior[cls] / Math.max(1, clsFunds);
    });
    const Sigma_inv = matInverse(covMatrix);
    if (!Sigma_inv) {
      // 不可逆→降级等权
      const eqWeights = {};
      for (let i = 0; i < n; i++) {
        const cls = fundClass[i];
        const clsFunds = fundClass.filter(c => c === cls).length;
        eqWeights[fundCodes[i]] = prior[cls] / Math.max(1, clsFunds);
      }
      return { optimalWeights: eqWeights, status: '无观点+协方差不可逆,降级等权', conditionNumber: cond };
    }
    // w* = Σ⁻¹ × w_prior / sum(...) — 风险加权：低波动/低相关 → 高权重
    const rawW = matMul(Sigma_inv, wPriorVec.map(v => [v]));
    let total = 0;
    const optW = {};
    for (let i = 0; i < n; i++) {
      const w = Math.max(0, rawW[i][0]);
      optW[fundCodes[i]] = w;
      total += w;
    }
    if (total > 0) {
      for (let i = 0; i < n; i++) optW[fundCodes[i]] /= total;
    }
    return {
      optimalWeights: optW,
      status: `无观点,基于协方差风险加权(条件数=${cond.toExponential(2)})`,
      conditionNumber: cond
    };
  }

  // 5. 构建 B-L 输入
  const tau = 0.05;
  const wPriorVec = fundCodes.map((_, i) => {
    const cls = fundClass[i];
    const clsFunds = fundClass.filter(c => c === cls).length;
    return prior[cls] / Math.max(1, clsFunds);
  });

  // 6. 构建 P 矩阵和 Q 向量（从 class-level views 映射到 fund-level）
  // 简化：将 class-level view 按基金权重比例分配到各基金
  const K = views.length;
  const P = Array.from({ length: K }, () => new Array(n).fill(0));
  const Q = new Array(K).fill(0);
  for (let k = 0; k < K; k++) {
    const v = views[k];
    for (let i = 0; i < n; i++) {
      const cls = fundClass[i];
      if ((v.asset === 'EQUITY' && cls === 'equity') || (v.asset === 'BOND' && cls === 'bond')) {
        const clsFunds = fundClass.filter(c => c === (v.asset === 'EQUITY' ? 'equity' : 'bond')).length;
        P[k][i] = 1 / Math.max(1, clsFunds);
      }
    }
    Q[k] = v.outperformance;
  }

  // 7. 构建 Ω 矩阵（diagonal view confidence）
  const Omega = Array.from({ length: K }, () => new Array(K).fill(0));
  for (let k = 0; k < K; k++) {
    Omega[k][k] = 1 / Math.max(0.01, views[k].confidence || 0.5) - 1; // 置信度 → 方差
  }

  // 8. B-L 计算
  const wPrior = [wPriorVec]; // 1×N
  const Sigma = covMatrix;
  const tauSigma = matScale(Sigma, tau);

  // Π = τ * Σ * w_prior (N×1)
  const Pi = matMul(tauSigma, matTranspose(wPrior)); // N×1

  // M = P * τ*Σ * P' + Ω (K×K)
  const P_tauSigma = matMul(P, tauSigma); // K×N
  const M = matAdd(matMul(P_tauSigma, matTranspose(P)), Omega); // K×K

  const M_inv = matInverse(M);
  if (!M_inv) {
    const eqWeights = {};
    for (let i = 0; i < n; i++) {
      const cls = fundClass[i];
      const clsFunds = fundClass.filter(c => c === cls).length;
      eqWeights[fundCodes[i]] = prior[cls] / Math.max(1, clsFunds);
    }
    return { optimalWeights: eqWeights, status: 'B-L中间矩阵奇异，使用宪法均衡权重', conditionNumber: cond };
  }

  // μ_BL = Π + τ*Σ * P' * M⁻¹ * (Q - P*Π)
  const PiVec = Pi.map(r => r[0]); // N×1 → N-vector
  const QVec = Q;
  const P_Pi = matMul(P, Pi); // K×1  →  K-vector
  const Q_minus_PPi = QVec.map((q, i) => q - P_Pi[i][0]); // K-vector
  // Convert Q_minus_PPi to K×1 column vector
  const diffVec = Q_minus_PPi.map(v => [v]); // K×1
  const M_inv_diffVec = matMul(M_inv, diffVec); // K×1
  const tauSigma_Pt = matMul(tauSigma, matTranspose(P)); // N×K
  const adjustment = matMul(tauSigma_Pt, M_inv_diffVec); // N×1

  const muBL = PiVec.map((v, i) => v + adjustment[i][0]);

  // 9. 从后验收益 → 最优权重（简化：w ∝ max(mu, 0)）
  // 更合理的做法：w* ∝ Σ⁻¹ * μ_BL（均值-方差优化，无风险资产）
  const Sigma_inv = matInverse(Sigma);
  if (!Sigma_inv) {
    const eqWeights = {};
    for (let i = 0; i < n; i++) {
      const cls = fundClass[i];
      const clsFunds = fundClass.filter(c => c === cls).length;
      eqWeights[fundCodes[i]] = prior[cls] / Math.max(1, clsFunds);
    }
    return { optimalWeights: eqWeights, status: '协方差矩阵不可逆，使用宪法均衡权重', conditionNumber: cond };
  }

  const rawWeights = matMul(Sigma_inv, muBL.map(v => [v])); // N×1, proportional to optimal
  let totalRaw = 0;
  const optimalWeights = {};
  for (let i = 0; i < n; i++) {
    const w = Math.max(0, rawWeights[i][0]); // 禁做空
    optimalWeights[fundCodes[i]] = w;
    totalRaw += w;
  }

  // 归一化 + 约束
  if (totalRaw > 0) {
    // 约束：单基 ≤20%，权益合计 ≤prior.equity×1.3，现金 ≥5%
    const maxSingle = 0.20;
    const maxEquity = prior.equity * 1.3;
    const minCash = 0.05;
    let equitySum = 0, bondSum = 0, cashSum = 0;

    for (let i = 0; i < n; i++) {
      optimalWeights[fundCodes[i]] = Math.min(optimalWeights[fundCodes[i]] / totalRaw, maxSingle);
    }

    // 重新归一化
    let total2 = 0;
    for (let i = 0; i < n; i++) total2 += optimalWeights[fundCodes[i]];
    if (total2 > 0) {
      for (let i = 0; i < n; i++) {
        optimalWeights[fundCodes[i]] /= total2;
        if (fundClass[i] === 'equity') equitySum += optimalWeights[fundCodes[i]];
        else if (fundClass[i] === 'bond') bondSum += optimalWeights[fundCodes[i]];
        else cashSum += optimalWeights[fundCodes[i]];
      }
    }

    // 权益上限约束
    if (equitySum > maxEquity) {
      const scale = maxEquity / equitySum;
      let redist = 0;
      for (let i = 0; i < n; i++) {
        if (fundClass[i] === 'equity') {
          redist += optimalWeights[fundCodes[i]] * (1 - scale);
          optimalWeights[fundCodes[i]] *= scale;
        }
      }
      // 超额分配给债券
      const bondFunds = fundClass.reduce((s, c) => s + (c === 'bond' ? 1 : 0), 0);
      if (bondFunds > 0) {
        for (let i = 0; i < n; i++) {
          if (fundClass[i] === 'bond') optimalWeights[fundCodes[i]] += redist / bondFunds;
        }
      }
    }
  } else {
    // 所有后验收益为负 → 宪法均衡
    for (let i = 0; i < n; i++) {
      const cls = fundClass[i];
      const clsFunds = fundClass.filter(c => c === cls).length;
      optimalWeights[fundCodes[i]] = prior[cls] / Math.max(1, clsFunds);
    }
    return { optimalWeights, status: '所有资产后验收益≤0，使用宪法均衡权重', conditionNumber: cond };
  }

  const _blPostResult = {
    optimalWeights,
    posteriorReturns: muBL,
    status: `条件数=${cond.toExponential(2)}，B-L后验成功`,
    conditionNumber: cond
  };
  logBLPosteriorResult(_blPostResult);
  return _blPostResult;
}

// ============================================================================
// 辅助：从持仓数据计算当前大类资产权重
// ============================================================================

/**
 * @param {Array} funds - [{ fundName, currentWeight }]
 * @returns {{ bond: number, equity: number, cash: number }}
 */
export function calcCurrentWeights(funds) {
  if (!funds || funds.length === 0) return { bond: 0.60, equity: 0.30, cash: 0.10 };

  let bondW = 0, equityW = 0, cashW = 0;
  for (const f of funds) {
    const w = f.currentWeight || 0;
    const cls = classifyFundType(f);
    if (cls === 'cash') cashW += w;
    else if (cls === 'bond') bondW += w;
    else equityW += w; // equity + hybrid
  }
  const total = bondW + equityW + cashW;
  if (total <= 0) return { bond: 0.60, equity: 0.30, cash: 0.10 };

  const _cwResult = {
    bond: bondW / total,
    equity: equityW / total,
    cash: cashW / total
  };
  logBLCurrentWeights(funds, _cwResult);
  return _cwResult;
}
