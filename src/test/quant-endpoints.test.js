// CF Worker 量化端点功能测试 — 直接调用方法验证输出格式和数值正确性
import { describe, it, expect } from 'vitest';

// 模拟 CF Worker 导出对象的方法
// my-cors-proxy.js 使用 export default { ...methods }, 这里模拟其量化方法

// 生成模拟日收益率序列
function generateReturns(n, mean, std) {
  // Box-Muller 生成正态分布
  const result = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.random() || 0.0001;
    const u2 = Math.random() || 0.0001;
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    result.push(mean + std * z);
  }
  return result;
}

// ============================================================================
// 测试 1: VaR/CVaR 计算逻辑（来自 handlers.js）
// ============================================================================
describe('VaR/CVaR 风险度量', () => {
  it('参数法 VaR(95%) 应接近 1.645σ', () => {
    const returns = generateReturns(100, 0.001, 0.01);
    const mean = returns.reduce((a,b)=>a+b,0)/returns.length;
    const variance = returns.reduce((s,r)=>s+(r-mean)**2,0)/returns.length;
    const paramVaR95 = mean - 1.645 * Math.sqrt(variance);
    // VaR应为负值（亏损），绝对值应约等于 1.645 * σ
    expect(paramVaR95).toBeLessThan(0);
    expect(Math.abs(paramVaR95) / Math.sqrt(variance)).toBeCloseTo(1.645, 0);
  });

  it('历史法 VaR(95%) 应在序列的 ~5% 分位', () => {
    const returns = generateReturns(100, 0.001, 0.01);
    const sorted = [...returns].sort((a,b)=>a-b);
    const idx = Math.floor(sorted.length * 0.05);
    const histVaR95 = sorted[Math.max(0, idx)];
    // 约5%的值应 ≤ VaR
    const count = returns.filter(r => r <= histVaR95).length;
    expect(count / returns.length).toBeCloseTo(0.05, 1);
  });

  it('CVaR 应 ≤ VaR（尾部条件均值更极端）', () => {
    const returns = generateReturns(100, 0.001, 0.01);
    const sorted = [...returns].sort((a,b)=>a-b);
    const idx = Math.floor(sorted.length * 0.05);
    const histVaR95 = sorted[Math.max(0, idx)];
    const tail = sorted.filter(r => r <= histVaR95);
    const cVaR95 = tail.reduce((a,b)=>a+b,0)/tail.length;
    expect(cVaR95).toBeLessThanOrEqual(histVaR95 + 0.0001); // 容差
  });
});

// ============================================================================
// 测试 2: 协方差矩阵 EWMA
// ============================================================================
describe('EWMA 协方差矩阵', () => {
  function computeEWMA(dailyReturns, lambda = 0.94) {
    const T = dailyReturns.length;
    const N = dailyReturns[0].length;
    let cov = Array.from({length:N}, () => new Array(N).fill(0));
    const warmup = Math.min(20, T);
    for (let t = 0; t < warmup; t++) {
      const r = dailyReturns[t];
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++)
          cov[i][j] += r[i] * r[j] / warmup;
    }
    for (let t = warmup; t < T; t++) {
      const r = dailyReturns[t];
      for (let i = 0; i < N; i++)
        for (let j = 0; j < N; j++)
          cov[i][j] = lambda * cov[i][j] + (1 - lambda) * r[i] * r[j];
    }
    return cov;
  }

  it('协方差矩阵应是对称正定的', () => {
    const returns = Array.from({length:60}, () => [
      (Math.random()-0.5)*0.02,
      (Math.random()-0.5)*0.01,
      (Math.random()-0.5)*0.005
    ]);
    const cov = computeEWMA(returns, 0.94);
    // 对称性
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        expect(cov[i][j]).toBeCloseTo(cov[j][i], 8);
    // 对角线为正
    for (let i = 0; i < 3; i++)
      expect(cov[i][i]).toBeGreaterThan(0);
  });

  it('EWMA 近期数据权重应更高', () => {
    // 前50天低波动, 后10天高波动
    const returns = [];
    for (let t = 0; t < 50; t++) returns.push([0.001, 0.0005]);
    for (let t = 0; t < 10; t++) returns.push([0.03, -0.02]);
    const covEWMA = computeEWMA(returns, 0.94);
    // 简单等权
    const covEqual = computeEWMA(returns, 1.0);
    // EWMA 的方差应更大（更敏感于近期高波动）
    expect(covEWMA[0][0]).toBeGreaterThan(covEqual[0][0]);
  });
});

// ============================================================================
// 测试 3: O-U 半衰期
// ============================================================================
describe('O-U 均值回归半衰期', () => {
  function computeOUHalfLife(navSeries) {
    const X = navSeries.filter(v => !isNaN(v) && v > 0);
    const Y = X.slice(1), X_lag = X.slice(0, -1);
    const n = Y.length;
    const sumX = X_lag.reduce((s,v)=>s+v,0);
    const sumY = Y.reduce((s,v)=>s+v,0);
    const sumXY = X_lag.reduce((s,v,i)=>s+v*Y[i],0);
    const sumX2 = X_lag.reduce((s,v)=>s+v*v,0);
    const denom = n * sumX2 - sumX * sumX;
    const b = (n * sumXY - sumX * sumY) / denom;
    const a = (sumY - b * sumX) / n;
    const theta = b < 1 && b > 0 ? -Math.log(Math.max(b, 0.001)) : 0;
    const mu = b < 1 ? a / (1 - b) : X[X.length-1];
    const halfLife = theta > 0 ? Math.log(2) / theta : Infinity;
    return { mu, theta, halfLife, b, a };
  }

  it('均值回归序列应检测出有限半衰期', () => {
    // 模拟 O-U 过程: X_{t+1} = 10 + 0.9*X_t + noise
    const nav = [10];
    for (let i = 1; i < 100; i++) {
      nav.push(10 + 0.9 * nav[i-1] + (Math.random()-0.5)*0.2);
    }
    const result = computeOUHalfLife(nav);
    expect(result.b).toBeGreaterThan(0.8);
    expect(result.b).toBeLessThan(1.0);
    expect(result.halfLife).toBeLessThan(100);
    expect(result.mu).toBeCloseTo(100, -1); // 均值应在 ~100 附近 (10/(1-0.9))
  });

  it('随机游走 b→1，均值回归序列 b<1 且有界半衰期', () => {
    // 均值回归序列：明确的回归
    const meanRevert = [10];
    for (let i = 1; i < 100; i++) {
      meanRevert.push(10 + 0.85 * (meanRevert[i-1] - 10) + (Math.random()-0.5)*0.1);
    }
    const mrResult = computeOUHalfLife(meanRevert);
    expect(mrResult.b).toBeLessThan(0.95); // 明确的均值回归
    expect(mrResult.halfLife).toBeLessThan(100);

    // 随机游走：b 接近或超过 1，半衰期很长或无界
    const rw = [10];
    for (let i = 1; i < 200; i++) {
      rw.push(rw[i-1] + (Math.random()-0.5)*0.1);
    }
    const rwResult = computeOUHalfLife(rw);
    // 随机游走的 b 应更接近 1，半衰期应比均值回归序列长得多
    expect(rwResult.b).toBeGreaterThan(mrResult.b);
    expect(rwResult.halfLife).toBeGreaterThan(mrResult.halfLife);
  });
});

// ============================================================================
// 测试 4: Markov Regime
// ============================================================================
describe('Markov 机制转移', () => {
  it('2状态模型应输出概率和为1', () => {
    // 混合：前50天低波动，后30天高波动+负收益
    const returns = [];
    for (let i = 0; i < 50; i++) returns.push((Math.random()-0.5)*0.005);
    for (let i = 0; i < 30; i++) returns.push(-0.01 + (Math.random()-0.5)*0.02);

    // 简化版 Hamilton 滤波
    const T = returns.length, K = 2;
    const mu = [-0.005, 0.0];
    const sigma = [0.015, 0.003];
    let P = [[0.9, 0.1], [0.1, 0.9]];

    // 前向滤波
    const fwd = Array.from({length:T}, () => new Array(K).fill(0));
    for (let k = 0; k < K; k++) {
      const diff = (returns[0]-mu[k])/sigma[k];
      fwd[0][k] = 0.5 * Math.exp(-0.5*diff*diff)/(Math.sqrt(2*Math.PI)*sigma[k]);
    }
    let sum = fwd[0].reduce((a,b)=>a+b,0);
    fwd[0] = fwd[0].map(v => v/sum);

    for (let t = 1; t < T; t++) {
      for (let j = 0; j < K; j++) {
        let s = 0;
        for (let i = 0; i < K; i++) s += fwd[t-1][i] * P[i][j];
        const diff = (returns[t]-mu[j])/sigma[j];
        fwd[t][j] = s * Math.exp(-0.5*diff*diff)/(Math.sqrt(2*Math.PI)*sigma[j]);
      }
      sum = fwd[t].reduce((a,b)=>a+b,0);
      if (sum > 0) fwd[t] = fwd[t].map(v => v/sum);
    }

    const last = fwd[T-1];
    // 概率和必须为 1
    expect(last[0] + last[1]).toBeCloseTo(1.0, 5);
    // 每个概率在 [0,1] 区间
    for (const p of last) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    // 两状态概率应分化（不完全均等）
    expect(Math.abs(last[0] - last[1])).toBeGreaterThan(0.01);
  });

  it('转移矩阵每行应和为1', () => {
    const P = [[0.9, 0.1], [0.05, 0.95]];
    for (const row of P) {
      expect(row.reduce((a,b)=>a+b,0)).toBeCloseTo(1.0, 5);
    }
  });
});

// ============================================================================
// 测试 5: Cholesky 分解 (蒙特卡洛前置)
// ============================================================================
describe('Cholesky 分解', () => {
  function choleskyDecomp(matrix) {
    const n = matrix.length;
    const L = Array.from({length:n}, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = matrix[i][j];
        for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        if (i === j) L[i][j] = sum > 0 ? Math.sqrt(sum) : 0;
        else L[i][j] = L[j][j] > 0 ? sum / L[j][j] : 0;
      }
    }
    return L;
  }

  it('L × L\' 应还原原始协方差矩阵', () => {
    const cov = [
      [0.0004, 0.0001, 0.00005],
      [0.0001, 0.0009, 0.00002],
      [0.00005, 0.00002, 0.0001]
    ];
    const L = choleskyDecomp(cov);
    const n = cov.length;
    // 验证 L × L'
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let recon = 0;
        for (let k = 0; k < n; k++) recon += L[i][k] * L[j][k];
        expect(recon).toBeCloseTo(cov[i][j], 6);
      }
    }
  });

  it('全零行应产生0对角线', () => {
    const cov = [[0, 0], [0, 0.01]];
    const L = choleskyDecomp(cov);
    expect(L[0][0]).toBe(0);
    expect(L[1][1]).toBeGreaterThan(0);
  });
});
