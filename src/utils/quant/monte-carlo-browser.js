// 蒙特卡洛模拟 — 浏览器端纯JS实现（通过 execute_javascript 工具调用）
// 输入格式见下方 monteCarloSimulate 的 JSDoc

/**
 * 蒙特卡洛组合模拟
 * @param {Object} params
 * @param {number[]} params.weights - 各资产权重 [0.3, 0.3, 0.2, 0.2]
 * @param {number[][]} params.dailyReturns - 历史日收益率矩阵 [资产][日期]
 * @param {number} params.initialValue - 初始市值(元)
 * @param {number} params.horizonDays - 模拟天数 (≤252)
 * @param {number} params.numSims - 模拟次数 (≤5000)
 * @param {number[]} params.drawdownThresholds - 回撤阈值如 [0.05, 0.10, 0.15]
 * @returns {string} 格式化的模拟报告
 */
function monteCarloSimulate(params) {
  const { weights, dailyReturns, initialValue = 100000, horizonDays = 60,
          numSims = 3000, drawdownThresholds = [0.05, 0.10, 0.15] } = params || {};

  if (!weights || !dailyReturns) return '缺少 weights 或 dailyReturns 参数';
  const N = weights.length;
  if (N < 1 || N > 20) return '资产数需 1-20';

  // 计算协方差矩阵
  const T = dailyReturns[0].length;
  let cov = Array.from({length:N}, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      let sum = 0;
      for (let t = 0; t < T; t++) sum += dailyReturns[i][t] * dailyReturns[j][t];
      cov[i][j] = sum / T;
    }
  }

  // Cholesky 分解
  const L = Array.from({length:N}, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = cov[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) L[i][j] = sum > 0 ? Math.sqrt(sum) : 0;
      else L[i][j] = L[j][j] > 0 ? sum / L[j][j] : 0;
    }
  }

  // PRNG
  const mulberry32 = (seed) => {
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  };
  const randn = (prng) => {
    const u1 = Math.max(prng(), 0.0001), u2 = prng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const sims = Math.min(numSims, 5000);
  const finalValues = new Array(sims);
  const maxDrawdowns = new Array(sims);

  for (let s = 0; s < sims; s++) {
    const rng = mulberry32(42 + s * 137);
    let value = initialValue, peak = initialValue, mdd = 0;

    for (let d = 0; d < horizonDays; d++) {
      const z = Array.from({length:N}, () => randn(rng));
      const correlated = new Array(N).fill(0);
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) correlated[i] += L[i][j] * z[j];

      let dailyReturn = 0;
      for (let i = 0; i < N; i++) dailyReturn += weights[i] * correlated[i];
      value *= (1 + dailyReturn);
      if (value > peak) peak = value;
      const dd = (peak - value) / peak;
      if (dd > mdd) mdd = dd;
    }
    finalValues[s] = value;
    maxDrawdowns[s] = mdd;
  }

  finalValues.sort((a,b) => a - b);
  maxDrawdowns.sort((a,b) => a - b);

  const percentile = (arr, p) => arr[Math.max(0, Math.floor(arr.length * p))];
  const mean = finalValues.reduce((a,b)=>a+b,0)/sims;
  const totalReturn = (mean - initialValue) / initialValue;

  let report = `【蒙特卡洛模拟 — ${sims}条${horizonDays}日路径】\n`;
  report += `初始: ${initialValue.toLocaleString()}元 → 预期终值: ${mean.toFixed(0)}元 (${(totalReturn*100).toFixed(1)}%)\n\n`;
  report += `📊 终值分布:\n`;
  report += `  最坏1%: ${percentile(finalValues,0.01).toFixed(0)} | 最坏5%: ${percentile(finalValues,0.05).toFixed(0)}\n`;
  report += `  中位数: ${percentile(finalValues,0.50).toFixed(0)} | 最好5%: ${percentile(finalValues,0.95).toFixed(0)} | 最好1%: ${percentile(finalValues,0.99).toFixed(0)}\n`;
  report += `  VaR(95%): ${(initialValue-percentile(finalValues,0.05)).toFixed(0)}元\n\n`;
  report += `📉 回撤概率:\n`;
  for (const t of drawdownThresholds) {
    const count = maxDrawdowns.filter(d => d >= t).length;
    report += `  >${(t*100).toFixed(0)}%回撤: ${(count/sims*100).toFixed(1)}%概率\n`;
  }
  report += `\n👉 解读: ${horizonDays}日内有${(maxDrawdowns.filter(d=>d>=0.10).length/sims*100).toFixed(1)}%概率发生>10%回撤。`;

  return report;
}

// 导出供 execute_javascript 使用
return JSON.stringify({ result: monteCarloSimulate(PARAMS_PLACEHOLDER) });
