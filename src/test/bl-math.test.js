// B-L 模型单元测试 — 矩阵运算 + 置信度校准 + 观点构建 + 后验优化
import { describe, it, expect } from 'vitest';
import { calibrateConfidence, parseConstitutionToPrior, buildBLViews, calcCurrentWeights } from '../utils/quant/bl-calibration';

// 矩阵运算和白盒测试通过 blackLittermanPosterior 间接验证（它内部调用所有矩阵函数）

describe('calibrateConfidence — Ω 三重校准', () => {
  it('准确率 0.5 → Ω ≈ 0.5', () => {
    const omega = calibrateConfidence(0.5, 1);
    expect(omega).toBeCloseTo(0.50, 1);
  });

  it('准确率 0 → Ω 接近 0.16（Sigmoid(0)后经缩放）', () => {
    const omega = calibrateConfidence(0, 1);
    expect(omega).toBeCloseTo(0.16, 1);
    expect(omega).toBeGreaterThanOrEqual(0.05);
    expect(omega).toBeLessThanOrEqual(0.90);
  });

  it('准确率 1.0 → Ω 被 clamp 到 0.90', () => {
    const omega = calibrateConfidence(1.0, 1);
    expect(omega).toBeLessThanOrEqual(0.90);
  });

  it('准确率 0.7 → Ω 高于 0.5', () => {
    const omega = calibrateConfidence(0.7, 1);
    expect(omega).toBeGreaterThan(0.5);
  });

  it('准确率 0.3 → Ω 低于 0.5', () => {
    const omega = calibrateConfidence(0.3, 1);
    expect(omega).toBeLessThan(0.5);
  });

  it('多个观点膨胀惩罚：2个观点 → Ω 除以 √2', () => {
    const omega1 = calibrateConfidence(0.5, 1);
    const omega2 = calibrateConfidence(0.5, 2);
    expect(omega2).toBeCloseTo(omega1 / Math.sqrt(2), 2);
  });

  it('10个观点 → Ω 显著降低', () => {
    const omega10 = calibrateConfidence(0.5, 10);
    expect(omega10).toBeLessThan(0.2);
    expect(omega10).toBeGreaterThanOrEqual(0.05);
  });

  it('numViews = 0（非法输入）→ 自举为 1', () => {
    const omega = calibrateConfidence(0.5, 0);
    expect(omega).toBeGreaterThan(0);
  });
});

describe('parseConstitutionToPrior — 宪法解析', () => {
  it('空输入 → 默认保守', () => {
    const p = parseConstitutionToPrior(null);
    expect(p.label).toBe('默认(保守)');
    expect(p.bond + p.equity + p.cash).toBeCloseTo(1.0);
  });

  it('固收为主+适度增强 → bond=0.70 equity=0.20', () => {
    const p = parseConstitutionToPrior('约束：固收为主+适度增强');
    expect(p.bond).toBe(0.70);
    expect(p.equity).toBe(0.20);
    expect(p.cash).toBe(0.10);
  });

  it('均衡 → bond=0.45 equity=0.45', () => {
    const p = parseConstitutionToPrior('约束：均衡配置\n年化：8%');
    expect(p.bond).toBe(0.45);
    expect(p.equity).toBe(0.45);
  });

  it('进取 → bond=0.20 equity=0.70', () => {
    const p = parseConstitutionToPrior('约束：积极进取');
    expect(p.equity).toBe(0.70);
  });

  it('纯债 → bond=0.85 equity=0.05', () => {
    const p = parseConstitutionToPrior('约束：纯债固收');
    expect(p.bond).toBe(0.85);
  });

  it('年化 3% → 保守', () => {
    const p = parseConstitutionToPrior('年化：3%');
    expect(p.bond).toBe(0.80);
  });

  it('年化 6% → 稳健', () => {
    const p = parseConstitutionToPrior('年化：6%');
    expect(p.bond).toBe(0.65);
  });
});

describe('buildBLViews — AI打分 → B-L 观点', () => {
  const prior = { bond: 0.70, equity: 0.20, cash: 0.10 };
  const curr = { bond: 0.68, equity: 0.22, cash: 0.10 };

  it('权益 75 分 → overweight', () => {
    const scoring = { equity: { final: 75, verdict: 'BUY_STRATEGY' } };
    const result = buildBLViews(scoring, prior, curr, 0.5);
    const eqView = result.views.find(v => v.asset === 'EQUITY');
    expect(eqView).toBeDefined();
    expect(eqView.outperformance).toBeGreaterThan(0);
    expect(eqView.direction).toContain('over');
  });

  it('权益 30 分 → underweight', () => {
    const scoring = { equity: { final: 30, verdict: 'WATCH_GRID' } };
    const result = buildBLViews(scoring, prior, curr, 0.5);
    const eqView = result.views.find(v => v.asset === 'EQUITY');
    expect(eqView).toBeDefined();
    expect(eqView.outperformance).toBeLessThan(0);
  });

  it('权益 60 分 → slight_overweight（幅度 >0.01 阈值）', () => {
    const scoring = { equity: { final: 60, verdict: 'HOLD_STRATEGY' } };
    const result = buildBLViews(scoring, prior, curr, 0.5);
    const eqView = result.views.find(v => v.asset === 'EQUITY');
    expect(eqView).toBeDefined();
    expect(eqView.outperformance).toBeGreaterThan(0);
    expect(eqView.outperformance).toBeLessThanOrEqual(0.05);
  });

  it('权益 BLACK_LIST → strong_underweight（outperformance < 0）', () => {
    const scoring = { equity: { final: 80, verdict: 'BLACK_LIST' } };
    const result = buildBLViews(scoring, prior, curr, 0.5);
    const eqView = result.views.find(v => v.asset === 'EQUITY');
    expect(eqView).toBeDefined();
    expect(eqView.outperformance).toBeLessThan(0);
    expect(eqView.direction).toBe('strong_underweight');
  });

  it('权益 35-54 分 → neutral，无 views', () => {
    const scoring = { equity: { final: 50, verdict: 'HOLD_STRATEGY' } };
    const result = buildBLViews(scoring, prior, curr, 0.5);
    expect(result.views).toHaveLength(0);
  });

  it('无 bond 数据 → 仅输出 EQUITY views', () => {
    const scoring = { equity: { final: 80, verdict: 'BUY_STRATEGY' } };
    const result = buildBLViews(scoring, prior, curr, 0.5);
    expect(result.views.every(v => v.asset === 'EQUITY')).toBe(true);
  });

  it('summary 格式正确 — 包含 Ω 值', () => {
    const scoring = { equity: { final: 80, verdict: 'BUY_STRATEGY' } };
    const result = buildBLViews(scoring, prior, curr, 0.6);
    expect(result.summary).toContain('Ω=');
  });
});

describe('calcCurrentWeights — 持仓→大类权重', () => {
  it('空持仓 → 默认 60/30/10', () => {
    const w = calcCurrentWeights([]);
    expect(w.bond).toBe(0.60);
    expect(w.equity).toBe(0.30);
    expect(w.cash).toBe(0.10);
  });

  it('全权益持仓 → equity=1.0', () => {
    const funds = [
      { fundName: '沪深300指数', currentWeight: 0.6 },
      { fundName: '创业板ETF', currentWeight: 0.4 }
    ];
    const w = calcCurrentWeights(funds);
    expect(w.equity).toBe(1.0);
    expect(w.bond).toBe(0);
  });

  it('混合持仓 → 正确分类', () => {
    const funds = [
      { fundName: '广发稳健', currentWeight: 0.3 },
      { fundName: '招商双债', currentWeight: 0.5 },
      { fundName: '余额宝货币', currentWeight: 0.2 }
    ];
    const w = calcCurrentWeights(funds);
    expect(w.equity).toBeCloseTo(0.3);
    expect(w.bond).toBeCloseTo(0.5);
    expect(w.cash).toBeCloseTo(0.2);
  });

  it('含"债"字 → 归为 bond', () => {
    const funds = [{ fundName: '易方达纯债', currentWeight: 1.0 }];
    const w = calcCurrentWeights(funds);
    expect(w.bond).toBe(1.0);
  });

  it('含"货币"字 → 归为 cash', () => {
    const funds = [{ fundName: '华夏货币A', currentWeight: 1.0 }];
    const w = calcCurrentWeights(funds);
    expect(w.cash).toBe(1.0);
  });
});

describe('B-L 边界情况', () => {
  // 这些测试不需要真实的协方差矩阵 — blackLittermanPosterior 在条件数过高或 M_inv 为null时会降级
  it('单资产 → 返回"资产不足"', async () => {
    const { blackLittermanPosterior } = await import('../utils/quant/bl-calibration');
    const result = blackLittermanPosterior(
      { bond: 0.7, equity: 0.2, cash: 0.1 },
      [{ asset: 'EQUITY', outperformance: 0.05, confidence: 0.5 }],
      [[0.0004]], // 1×1 cov matrix
      ['000001'],
      [{ fundName: '沪深300', currentWeight: 1.0 }]
    );
    expect(result.status).toContain('资产不足');
  });

  it('空 views → 宪法均衡', async () => {
    const { blackLittermanPosterior } = await import('../utils/quant/bl-calibration');
    const result = blackLittermanPosterior(
      { bond: 0.7, equity: 0.2, cash: 0.1 },
      [],
      [[0.0004, 0.0001], [0.0001, 0.0009]],
      ['000001', '000002'],
      [
        { fundName: '沪深300', currentWeight: 0.3 },
        { fundName: '债券基金', currentWeight: 0.7 }
      ]
    );
    expect(result.status).toContain('无观点');
    expect(result.optimalWeights['000001']).toBeGreaterThan(0);
    expect(result.optimalWeights['000002']).toBeGreaterThan(0);
  });
});
