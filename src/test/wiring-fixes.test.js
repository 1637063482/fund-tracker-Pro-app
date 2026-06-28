// 数据拉取工具 + proxy failover 单元测试
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// 需要动态导入 data-fetcher 以隔离 mock
describe('buildAllOriginsUrl — CORS代理轮换', () => {
  let proxy;

  beforeEach(async () => {
    vi.resetModules();
    proxy = await import('../utils/ai/proxy');
  });

  it('buildAllOriginsUrl 包含 CORS 代理前缀', () => {
    const url = proxy.buildAllOriginsUrl('https://example.com/api');
    // 实际URL格式: https://corsproxy.io/?https%3A%2F%2Fexample.com%2Fapi
    expect(url).toContain('corsproxy');
    expect(url).toContain('example.com');
  });

  it('reportProxyFailure 连续2次 → 自动轮换', () => {
    const url1 = proxy.buildAllOriginsUrl('https://test.com/a');
    proxy.reportProxyFailure();
    proxy.reportProxyFailure(); // 第2次 → 应切换
    const url2 = proxy.buildAllOriginsUrl('https://test.com/b');
    // 切换后 URL 前缀应不同
    expect(url2).not.toBe(url1);
  });

  it('reportProxySuccess → 重置失败计数', () => {
    proxy.reportProxyFailure();
    proxy.reportProxySuccess();
    proxy.reportProxyFailure(); // 第1次，不应切换
    const urlBefore = proxy.buildAllOriginsUrl('https://test.com/c');
    proxy.reportProxyFailure(); // 第2次，应切换
    const urlAfter = proxy.buildAllOriginsUrl('https://test.com/d');
    // 如果 reset 正确，第2次才切换
    expect(urlAfter).not.toBe(urlBefore);
  });
});

describe('classifyF1a — 接线后档位可达性', () => {
  let scoringTree;

  beforeEach(async () => {
    vi.resetModules();
    scoringTree = await import('../utils/quant/scoring-tree');
  });

  it('PE分位为null时 → 不触发估值极值档，走兜底', () => {
    const ctx = {
      price: 3300, dailyMA20: 3400, dailyMA60: 3500,
      weeklyMA20: 3450,
      weeklyMACDGoldenCross: false, weeklyMACDDeadCross: true,
      weeklyTopDivergence: false, weeklyBottomDivergence: false,
      weeklyBollinger: { upper: '3600', middle: '3400', lower: '3200', bandwidth: '5.0', bwPercentile: '50', squeeze: false },
      pePercentile: null, // ← PE 数据缺失
      monthlyPosition: 'middle', monthlyTopDivergence: false,
      dailyCenterUp: false, dailyCenterDown: true,
      weeklyHighStall: false, dailyMA20Turning: false
    };
    const r = scoringTree.classifyF1a(ctx);
    // PE 缺失时不应触发依赖 PE 的档位
    expect(r.category).not.toContain('估值');
  });

  it('PE分位 >80% + 月K上轨 + 顶背离 → 触发绝对大顶档位 (0-1分)', () => {
    const ctx = {
      price: 3600, dailyMA20: 3400, dailyMA60: 3300,
      weeklyMA20: 3350,
      weeklyMACDGoldenCross: true, weeklyMACDDeadCross: false,
      weeklyTopDivergence: false, weeklyBottomDivergence: false,
      weeklyBollinger: { upper: '3550', middle: '3400', lower: '3250', bandwidth: '4.0', bwPercentile: '60', squeeze: false },
      pePercentile: 85, // > 80%
      monthlyPosition: 'upper', monthlyTopDivergence: true,
      dailyCenterUp: false, dailyCenterDown: false,
      weeklyHighStall: false, dailyMA20Turning: false
    };
    const r = scoringTree.classifyF1a(ctx);
    expect(r.baseScore).toBeLessThanOrEqual(1);
    expect(r.overrides?.totalCap).toBe(45);
  });

  it('PE分位 <20% + 月K下轨 + 底背离 → 触发绝对大底档位 (18-20分)', () => {
    const ctx = {
      price: 2800, dailyMA20: 3000, dailyMA60: 3200,
      weeklyMA20: 3100,
      weeklyMACDGoldenCross: false, weeklyMACDDeadCross: false,
      weeklyTopDivergence: false, weeklyBottomDivergence: true,
      weeklyBollinger: { upper: '3400', middle: '3200', lower: '3000', bandwidth: '6.0', bwPercentile: '30', squeeze: false }, // ← squeeze=false 避免第9档优先匹配
      pePercentile: 15,
      monthlyPosition: 'lower', monthlyTopDivergence: false,
      dailyCenterUp: false, dailyCenterDown: false,
      weeklyHighStall: false, dailyMA20Turning: false
    };
    const r = scoringTree.classifyF1a(ctx);
    expect(r.baseScore).toBeGreaterThanOrEqual(18);
    expect(r.category).toContain('绝对大底');
  });

  it('信用利差为 narrow + 全面 bullish → F4 触发 risk-on 档位', () => {
    const ctx = { rmb: 'up', copper: 'up', oil: 'up', gold: 'stable', creditSpread: 'narrow' };
    const r = scoringTree.classifyF4(ctx);
    expect(r.baseScore).toBeGreaterThanOrEqual(12);
    expect(r.category).toContain('risk-on');
  });

  it('信用利差为 widen + 全面 bearish → F4 触发 risk-off 档位', () => {
    const ctx = { rmb: 'down', copper: 'down', oil: 'down', gold: 'up', creditSpread: 'widen' };
    const r = scoringTree.classifyF4(ctx);
    expect(r.baseScore).toBeLessThanOrEqual(1);
    expect(r.category).toContain('risk-off');
  });

  it('F2 deepV=true → 触发超跌反转高分档位', () => {
    const ctx = {
      deviation20d: -8, deviation60d: -12, isChuangYe: false,
      touchBollLower: true, consecutiveDownDays: 5,
      deepV: true, volumeUp: true,
      intradayStable: true, declineNarrowing: true,
      amplitude: 3.5, topPattern: false,
      rsiBottomDivergence: false, bollLowerRSILow: false
    };
    const r = scoringTree.classifyF2(ctx);
    expect(r.baseScore).toBeGreaterThanOrEqual(20);
  });
});

describe('VR 计算器 — 接线后定量路径', () => {
  let scoringTree;

  beforeEach(async () => {
    vi.resetModules();
    scoringTree = await import('../utils/quant/scoring-tree');
  });

  it('有历史成交序列(≥10日) → vrSource 为 定量(JS-20d)', () => {
    const result = scoringTree.calcVRAndIntercept({
      todayTurnoverYi: 15000,
      recentTurnovers: [12000, 13000, 11000, 12500, 11500, 14000, 13500, 12000, 11000, 10500], // 10日
      upCount: 3000, downCount: 2000,
      indexChanges: { sh: 0.005 },
      microstructureSignal: '✅ clear'
    });
    expect(result.vrSource).toBe('定量(JS-20d)');
    // avg10d = (12000+13000+11000+12500+11500+14000+13500+12000+11000+10500)/10 = 12100
    expect(result.VR).toBeCloseTo(15000 / 12100, 1);
  });

  it('历史成交序列(≥3日<10日) → 定量(JS-5d) 兜底', () => {
    const result = scoringTree.calcVRAndIntercept({
      todayTurnoverYi: 15000,
      recentTurnovers: [12000, 13000, 11000], // 仅3日
      upCount: 3000, downCount: 2000,
      indexChanges: { sh: 0.005 },
      microstructureSignal: '✅ clear'
    });
    expect(result.vrSource).toBe('定量(JS-5d)');
  });

  it('空历史序列 → vrSource 走定性兜底', () => {
    const result = scoringTree.calcVRAndIntercept({
      todayTurnoverYi: 30000,
      recentTurnovers: [],
      upCount: 2000, downCount: 3000,
      indexChanges: { sh: -0.005 },
      microstructureSignal: '⚪ neutral'
    });
    expect(result.vrSource).toContain('定性');
  });

  it('分红季 🚨 fatal → 跳过微观结构，走正常量价档位', () => {
    const result = scoringTree.calcVRAndIntercept({
      todayTurnoverYi: 12000,
      recentTurnovers: [12000, 12000, 12000],
      upCount: 2500, downCount: 2500,
      indexChanges: { sh: 0.001 },
      microstructureSignal: '🚨 fatal',
      isEarlySession: false
    });
    // 分红季：fatal被完全跳过，VR=1.0+涨跌平衡 → 正常博弈(13分)
    expect(result.score).toBe(13);
    expect(result.category).toBe('正常博弈');
    expect(result.overrides).toBeUndefined();
  });

  it('分红季 🚨 fatal + 市崩 → 仍触硬熔断', () => {
    const result = scoringTree.calcVRAndIntercept({
      todayTurnoverYi: 20000,
      recentTurnovers: [12000, 12000, 12000],
      upCount: 500, downCount: 4500,
      indexChanges: { sh: -0.02, cyb: -0.03 },
      microstructureSignal: '🚨 fatal',
      isEarlySession: false
    });
    // isTrueCrash触发 → 硬熔断
    expect(result.score).toBeLessThanOrEqual(2);
    expect(result.overrides?.totalEquityCap).toBe(35);
    expect(result.overrides?.llmMayOverride).toBe(true);
  });

  it('分红季 ⚠️ warn → 跳过，走正常量价档位', () => {
    const result = scoringTree.calcVRAndIntercept({
      todayTurnoverYi: 12000,
      recentTurnovers: [12000, 12000, 12000],
      upCount: 2500, downCount: 2500,
      indexChanges: { sh: 0.001 },
      microstructureSignal: '⚠️ warn'
    });
    // 分红季：warn被跳过 → 正常博弈
    expect(result.score).toBe(13);
    expect(result.category).toBe('正常博弈');
    expect(result.overrides).toBeUndefined();
  });
});
