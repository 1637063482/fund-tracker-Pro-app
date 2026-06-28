// 量化系统改进测试 — 多指数回测 + auto-tuner 诊断
// 改进方案 Phase 0-2 的单元测试
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// 测试 1: selectRelevantReturn — 按因子主导性选择验证指数
// ============================================================================
describe('selectRelevantReturn — 多指数验证选择', () => {
  let selectRelevantReturn;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/quant/backtest');
    selectRelevantReturn = mod.selectRelevantReturn;
  });

  it('F1b主导(≥25%) → 返回 cyb 指数', () => {
    const eq = { F1a: 8, F1b: 10, F2: 8, F3: 8, F4: 5 };
    const returns = { sh: 0.02, cyb: -0.03, sz: 0.01 };
    const result = selectRelevantReturn(eq, returns);
    expect(result).toBe(-0.03); // cyb return
  });

  it('F3主导(≥30%) → 返回多指数加权', () => {
    const eq = { F1a: 5, F1b: 5, F2: 5, F3: 15, F4: 5 };
    const returns = { sh: 0.01, cyb: 0.02, sz: 0.03 };
    const result = selectRelevantReturn(eq, returns);
    // sh*0.4 + cyb*0.35 + sz*0.25 = 0.004 + 0.007 + 0.0075 = 0.0185
    expect(result).toBeCloseTo(0.0185, 4);
  });

  it('均衡(无主导) → 返回 sh 默认', () => {
    const eq = { F1a: 8, F1b: 7, F2: 8, F3: 8, F4: 7 };
    const returns = { sh: 0.015, cyb: 0.02, sz: 0.01 };
    const result = selectRelevantReturn(eq, returns);
    expect(result).toBe(0.015); // sh
  });

  it('总分0 → 返回 sh 兜底', () => {
    const eq = { F1a: 0, F1b: 0, F2: 0, F3: 0, F4: 0 };
    const returns = { sh: 0.01, cyb: 0.02, sz: 0.03 };
    const result = selectRelevantReturn(eq, returns);
    expect(result).toBe(0.01); // fallback to sh
  });

  it('缺少cyb/sz时 → F1b主导降级到sh', () => {
    const eq = { F1a: 3, F1b: 10, F2: 5, F3: 5, F4: 3 };
    const returns = { sh: 0.01 }; // 只有sh
    // cyb undefined → 降级使用 sh
    const result = selectRelevantReturn(eq, returns);
    // F1b主导，但cyb不存在 → 使用默认sh
    expect(result).toBe(0.01);
  });
});

// ============================================================================
// 测试 2: getFactorDominance — 因子主导性判定
// ============================================================================
describe('getFactorDominance — 因子主导性', () => {
  let getFactorDominance;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/quant/backtest');
    getFactorDominance = mod.getFactorDominance;
  });

  it('F1a最高 → F1a_dominant', () => {
    expect(getFactorDominance({ F1a: 15, F1b: 5, F2: 8, F3: 8, F4: 4 })).toBe('F1a_dominant');
  });

  it('F1b最高 → F1b_dominant', () => {
    expect(getFactorDominance({ F1a: 5, F1b: 12, F2: 8, F3: 8, F4: 4 })).toBe('F1b_dominant');
  });

  it('F3最高 → F3_dominant', () => {
    expect(getFactorDominance({ F1a: 5, F1b: 5, F2: 8, F3: 14, F4: 4 })).toBe('F3_dominant');
  });

  it('F4最高 → F4_dominant', () => {
    expect(getFactorDominance({ F1a: 5, F1b: 5, F2: 8, F3: 8, F4: 10 })).toBe('F4_dominant');
  });

  it('全零 → mixed', () => {
    expect(getFactorDominance({ F1a: 0, F1b: 0, F2: 0, F3: 0, F4: 0 })).toBe('mixed');
  });

  it('平局 → 返回第一个最高(确定性)', () => {
    // F1a和F3都是12
    expect(getFactorDominance({ F1a: 12, F1b: 5, F2: 8, F3: 12, F4: 4 })).toBe('F1a_dominant');
  });
});

// ============================================================================
// 测试 3: computeBacktest — byFactorDominance 分组统计
// ============================================================================
describe('computeBacktest — 分组统计', () => {
  let computeBacktest;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/quant/backtest');
    computeBacktest = mod.computeBacktest;
  });

  it('返回结果包含 byFactorDominance 字段', () => {
    const marketData = {};
    // 构建60日上证数据
    const startPrice = 3000;
    for (let i = 0; i < 120; i++) {
      const d = new Date(2024, 0, 1 + i * 2);
      const ds = d.toISOString().split('T')[0];
      marketData[ds] = {
        shClose: startPrice + i * 5,
        cybClose: 1500 + i * 3,
        szClose: 10000 + i * 15
      };
    }

    const dates = Object.keys(marketData).sort();
    const scoreHistory = [];
    for (let i = 10; i < dates.length - 25; i += 5) {
      scoreHistory.push({
        date: dates[i],
        equity: {
          final: 55 + Math.round(Math.random() * 30),
          verdict: 'BUY_STRATEGY',
          F1a: 10 + Math.round(Math.random() * 5),
          F1b: 8 + Math.round(Math.random() * 4),
          F2: 12 + Math.round(Math.random() * 6),
          F3: 10 + Math.round(Math.random() * 5),
          F4: 6 + Math.round(Math.random() * 3)
        }
      });
    }

    const result = computeBacktest(scoreHistory, marketData, [1, 3, 5]);
    expect(result).toHaveProperty('byFactorDominance');
    expect(result.byFactorDominance).toHaveProperty('F1a_dominant');
    expect(result.byFactorDominance).toHaveProperty('F1b_dominant');
    expect(result.byFactorDominance).toHaveProperty('F3_dominant');
    expect(result.byFactorDominance).toHaveProperty('F4_dominant');
    expect(result.byFactorDominance).toHaveProperty('mixed');
  });

  it('分组准确率为有效数字或 N/A', () => {
    const marketData = {};
    for (let i = 0; i < 60; i++) {
      const d = new Date(2024, 0, 1 + i * 3);
      const ds = d.toISOString().split('T')[0];
      marketData[ds] = { shClose: 3000 + i * 8, cybClose: 1500 + i * 5, szClose: 10000 + i * 20 };
    }

    const dates = Object.keys(marketData).sort();
    const scoreHistory = [];
    for (let i = 5; i < dates.length - 10; i += 3) {
      scoreHistory.push({
        date: dates[i],
        equity: {
          final: 60, verdict: 'HOLD_STRATEGY',
          F1a: 15, F1b: 5, F2: 12, F3: 10, F4: 6
        }
      });
    }

    const result = computeBacktest(scoreHistory, marketData, [1, 3]);
    // F1a_dominant should have some stats
    const f1a = result.byFactorDominance.F1a_dominant;
    expect(typeof f1a.accuracy).toBe('string');
    expect(['N/A'].includes(f1a.accuracy) || f1a.accuracy.endsWith('%')).toBe(true);
  });
});

// ============================================================================
// 测试 4: autoTune — 诊断输出
// ============================================================================
describe('autoTune — 诊断与动态阈值', () => {
  let autoTune;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/quant/auto-tuner');
    autoTune = mod.autoTune;
  });

  it('返回结果包含 diagnostics 字段', () => {
    const marketData = {};
    for (let i = 0; i < 90; i++) {
      const d = new Date(2024, 0, 1 + i);
      const ds = d.toISOString().split('T')[0];
      marketData[ds] = { shClose: 3000 + i * 6, cybClose: 1500 + i * 4, szClose: 10000 + i * 15 };
    }

    const dates = Object.keys(marketData).sort();
    const scoreHistory = [];
    for (let i = 10; i < dates.length - 15; i += 3) {
      scoreHistory.push({
        date: dates[i],
        equity: {
          F1a: 12, F1b: 8, F2: 15, F3: 12, F4: 6
        }
      });
    }

    const result = autoTune(scoreHistory, marketData);
    expect(result).toHaveProperty('diagnostics');
    expect(result.diagnostics).toHaveProperty('sampleSufficiency');
    expect(result.diagnostics).toHaveProperty('overallConfidence');
  });

  it('diagnostics.sampleSufficiency 包含所有5个因子', () => {
    const marketData = {};
    for (let i = 0; i < 90; i++) {
      const d = new Date(2024, 0, 1 + i);
      const ds = d.toISOString().split('T')[0];
      marketData[ds] = { shClose: 3000 + i * 6, cybClose: 1500 + i * 4, szClose: 10000 + i * 15 };
    }

    const dates = Object.keys(marketData).sort();
    const scoreHistory = [];
    for (let i = 10; i < dates.length - 15; i += 3) {
      scoreHistory.push({
        date: dates[i],
        equity: {
          F1a: 12, F1b: 8, F2: 15, F3: 12, F4: 6
        }
      });
    }

    const result = autoTune(scoreHistory, marketData);
    const ss = result.diagnostics.sampleSufficiency;
    expect(ss).toHaveProperty('F1a');
    expect(ss).toHaveProperty('F1b');
    expect(ss).toHaveProperty('F2');
    expect(ss).toHaveProperty('F3');
    expect(ss).toHaveProperty('F4');
    // 每个因子都有 samples 和 minRequired
    for (const key of ['F1a', 'F1b', 'F2', 'F3', 'F4']) {
      expect(typeof ss[key].samples).toBe('number');
      expect(typeof ss[key].minRequired).toBe('number');
      expect(['✓ 充分', '✗ 不足']).toContain(ss[key].status);
    }
  });

  it('样本不足时 overallConfidence < 100', () => {
    const marketData = {
      '2024-01-15': { shClose: 3000, cybClose: 1500, szClose: 10000 },
      '2024-01-16': { shClose: 3010, cybClose: 1510, szClose: 10020 },
      '2024-01-17': { shClose: 3020, cybClose: 1520, szClose: 10030 }
    };

    const scoreHistory = [
      { date: '2024-01-15', equity: { F1a: 12, F1b: 8, F2: 15, F3: 12, F4: 6 } },
      { date: '2024-01-16', equity: { F1a: 10, F1b: 7, F2: 14, F3: 11, F4: 5 } }
    ];

    const result = autoTune(scoreHistory, marketData);
    // 只有2条快照，远不足30日窗口，样本稀疏
    expect(result.diagnostics.overallConfidence).toBeLessThan(100);
  });

  it('F4 使用更高的最小样本阈值(15)', () => {
    const marketData = {};
    for (let i = 0; i < 90; i++) {
      const d = new Date(2024, 0, 1 + i);
      const ds = d.toISOString().split('T')[0];
      marketData[ds] = { shClose: 3000 + i * 6, cybClose: 1500 + i * 4, szClose: 10000 + i * 15 };
    }

    const dates = Object.keys(marketData).sort();
    const scoreHistory = [];
    for (let i = 5; i < dates.length - 10; i += 2) {
      scoreHistory.push({
        date: dates[i],
        equity: {
          F1a: 12, F1b: 8, F2: 15, F3: 12,
          F4: (i % 3 === 0) ? 6 : undefined // F4 约1/3的时间有数据
        }
      });
    }

    const result = autoTune(scoreHistory, marketData);
    const f4 = result.diagnostics.sampleSufficiency.F4;
    expect(f4.minRequired).toBe(15); // F4动态阈值更高
  });

  it('changes 字段保持不变(向后兼容)', () => {
    const marketData = {};
    for (let i = 0; i < 90; i++) {
      const d = new Date(2024, 0, 1 + i);
      const ds = d.toISOString().split('T')[0];
      marketData[ds] = { shClose: 3000 + i * 6, cybClose: 1500 + i * 4, szClose: 10000 + i * 15 };
    }

    const dates = Object.keys(marketData).sort();
    const scoreHistory = [];
    for (let i = 10; i < dates.length - 15; i += 3) {
      scoreHistory.push({
        date: dates[i],
        equity: { F1a: 12, F1b: 8, F2: 15, F3: 12, F4: 6 }
      });
    }

    const result = autoTune(scoreHistory, marketData);
    expect(result).toHaveProperty('changes');
    expect(result).toHaveProperty('newScores');
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('details');
    // 确保旧字段类型不变
    expect(typeof result.changes).toBe('object');
    expect(typeof result.newScores).toBe('object');
  });
});

// ============================================================================
// 测试 5: buildFactorSamples — 各因子使用对应指数
// ============================================================================
describe('buildFactorSamples — 因子-指数匹配', () => {
  let buildFactorSamples, addTradingDays;

  beforeEach(async () => {
    vi.resetModules();
    const bt = await import('../utils/quant/backtest');
    const at = await import('../utils/quant/auto-tuner');
    buildFactorSamples = at.buildFactorSamples;
    addTradingDays = bt.addTradingDays;
  });

  it('F1b 样本使用 cybClose 计算市场收益', () => {
    const marketData = {
      '2024-01-15': { shClose: 3000, cybClose: 1500, szClose: 10000 },
      '2024-01-16': { shClose: 3030, cybClose: 1470, szClose: 10000 }, // sh +1%, cyb -2%
      '2024-01-17': { shClose: 3060, cybClose: 1440, szClose: 10000 }
    };

    const scoreHistory = [
      { date: '2024-01-15', equity: { F1a: 12, F1b: 10, F2: 15, F3: 12, F4: 6 } }
    ];

    const samples = buildFactorSamples(scoreHistory, marketData);

    // F1a的marketReturn基于shClose: (3030-3000)/3000 = 0.01
    // F1b的marketReturn基于cybClose: (1470-1500)/1500 = -0.02
    // F3的marketReturn基于多指数加权
    const f1aSamples = samples.F1a.filter(s => s.horizon === 1);
    const f1bSamples = samples.F1b.filter(s => s.horizon === 1);
    const f3Samples = samples.F3.filter(s => s.horizon === 1);

    if (f1aSamples.length > 0) {
      expect(f1aSamples[0].marketReturn).toBeCloseTo(0.01, 3); // sh
    }
    if (f1bSamples.length > 0) {
      expect(f1bSamples[0].marketReturn).toBeCloseTo(-0.02, 3); // cyb
    }
    if (f3Samples.length > 0) {
      // F3 weighted: sh*0.4 + cyb*0.35 + sz*0.25
      const expected = 0.01 * 0.4 + (-0.02) * 0.35 + 0 * 0.25;
      expect(f3Samples[0].marketReturn).toBeCloseTo(expected, 3);
    }
  });

  it('cybClose缺失时 → F1b降级使用shClose', () => {
    const marketData = {
      '2024-01-15': { shClose: 3000 },
      '2024-01-16': { shClose: 3030 }
    };

    const scoreHistory = [
      { date: '2024-01-15', equity: { F1a: 12, F1b: 10, F2: 15, F3: 12, F4: 6 } }
    ];

    const samples = buildFactorSamples(scoreHistory, marketData);
    const f1bSamples = samples.F1b.filter(s => s.horizon === 1);

    if (f1bSamples.length > 0) {
      // 降级使用 shClose
      expect(f1bSamples[0].marketReturn).toBeCloseTo(0.01, 3);
    }
  });
});

// ============================================================================
// 测试 6: mergeMultiIndexKlines — 多指数K线合并
// ============================================================================
describe('mergeMultiIndexKlines — 多指数K线合并', () => {
  let mergeMultiIndexKlines;

  beforeEach(async () => {
    vi.resetModules();
    const handlers = await import('../utils/ai/tools/handlers');
    mergeMultiIndexKlines = handlers.mergeMultiIndexKlines;
  });

  it('三指数按日期对齐合并', () => {
    const sh = [
      ['2024-01-15', '3100', '3200'],
      ['2024-01-16', '3200', '3300']
    ];
    const cyb = [
      ['2024-01-15', '1500', '1550'],
      ['2024-01-16', '1550', '1530']
    ];
    const sz = [
      ['2024-01-15', '10000', '10200'],
      ['2024-01-16', '10200', '10100']
    ];

    const result = mergeMultiIndexKlines(sh, cyb, sz);

    expect(result['2024-01-15']).toEqual({
      shClose: 3200, cybClose: 1550, szClose: 10200
    });
    expect(result['2024-01-16']).toEqual({
      shClose: 3300, cybClose: 1530, szClose: 10100
    });
  });

  it('cyb/sz缺失(undefined) → 仅含sh', () => {
    const sh = [
      ['2024-01-15', '3100', '3200'],
      ['2024-01-16', '3200', '3300']
    ];

    const result = mergeMultiIndexKlines(sh, undefined, undefined);

    expect(result['2024-01-15']).toEqual({ shClose: 3200 });
    expect(result['2024-01-16']).toEqual({ shClose: 3300 });
    expect(Object.keys(result)).toHaveLength(2);
  });

  it('部分日期重叠 → 合并可用日期', () => {
    const sh = [
      ['2024-01-15', '3100', '3200'],
      ['2024-01-16', '3200', '3300'],
      ['2024-01-17', '3300', '3400']
    ];
    const cyb = [
      ['2024-01-15', '1500', '1550'],
      ['2024-01-17', '1550', '1530']
    ];

    const result = mergeMultiIndexKlines(sh, cyb, []);

    // Jan 15: sh + cyb
    expect(result['2024-01-15']).toEqual({ shClose: 3200, cybClose: 1550 });
    // Jan 16: sh only (no cyb data)
    expect(result['2024-01-16']).toEqual({ shClose: 3300 });
    // Jan 17: sh + cyb
    expect(result['2024-01-17']).toEqual({ shClose: 3400, cybClose: 1530 });
  });

  it('sz为空数组 → 跳过sz', () => {
    const sh = [['2024-01-15', '3100', '3200']];
    const cyb = [['2024-01-15', '1500', '1550']];
    const sz = [];

    const result = mergeMultiIndexKlines(sh, cyb, sz);
    expect(result['2024-01-15']).toEqual({ shClose: 3200, cybClose: 1550 });
  });

  it('指数日期不完全对齐 → 各自的日期各自有值', () => {
    const sh = [
      ['2024-01-15', '3100', '3200']
    ];
    const cyb = []; // 创业板无数据

    const result = mergeMultiIndexKlines(sh, cyb, []);
    expect(result['2024-01-15']).toEqual({ shClose: 3200 });
  });
});

// ============================================================================
// 测试 7: parseBondYieldData — 国债收益率解析
// ============================================================================
describe('parseBondYieldData — 国债收益率解析', () => {
  let parseBondYieldData;

  beforeEach(async () => {
    vi.resetModules();
    const df = await import('../utils/ai/data-fetcher');
    parseBondYieldData = df.parseBondYieldData;
  });

  it('从东财API响应中提取 1Y/2Y/5Y/10Y 收益率', () => {
    const mockApiResponse = {
      success: true,
      result: {
        data: [
          { BOND_CODE: '100001', BOND_ABBR: '国债1706', BOND_YIELD: 1.52, YEAR: 1 },
          { BOND_CODE: '100002', BOND_ABBR: '国债1808', BOND_YIELD: 1.68, YEAR: 2 },
          { BOND_CODE: '100003', BOND_ABBR: '国债1904', BOND_YIELD: 2.05, YEAR: 5 },
          { BOND_CODE: '100004', BOND_ABBR: '国债2001', BOND_YEAR: 10, BOND_YIELD: 2.48 }
        ]
      }
    };
    const result = parseBondYieldData(mockApiResponse);
    expect(result).toEqual({
      y1: 1.52, y2: 1.68, y5: 2.05, y10: 2.48,
      spread_10_2: 0.80
    });
  });

  it('兼容 TERM 字段名', () => {
    const mock = { success: true, result: { data: [
      { BOND_YIELD: 1.55, TERM: 1 },
      { BOND_YIELD: 1.70, TERM: 2 },
      { BOND_YIELD: 2.10, TERM: 5 },
      { BOND_YIELD: 2.50, TERM: 10 }
    ]}};
    const result = parseBondYieldData(mock);
    expect(result.y1).toBe(1.55);
    expect(result.y10).toBe(2.50);
    expect(result.spread_10_2).toBe(0.80);
  });

  it('只提取国债品种（过滤政策行债）', () => {
    const mock = { success: true, result: { data: [
      { BOND_CODE: '100001', BOND_ABBR: '国债1706', BOND_YIELD: 1.52, YEAR: 1 },
      { BOND_CODE: '200001', BOND_ABBR: '农发1801', BOND_YIELD: 1.80, YEAR: 1 }
    ]}};
    const result = parseBondYieldData(mock);
    expect(result.y1).toBe(1.52);
  });

  it('空数据 → 返回空对象', () => {
    expect(parseBondYieldData({ success: true, result: { data: [] } })).toEqual({});
  });

  it('null 输入 → 返回空对象', () => {
    expect(parseBondYieldData(null)).toEqual({});
  });

  it('spread_10_2 在2Y缺失时为 undefined', () => {
    const mock = { success: true, result: { data: [
      { BOND_YIELD: 2.48, YEAR: 10 }
    ]}};
    expect(parseBondYieldData(mock).spread_10_2).toBeUndefined();
  });

  it('解析30Y国债收益率', () => {
    const mock = { success: true, result: { data: [
      { BOND_CODE: '100001', BOND_ABBR: '国债1706', BOND_YIELD: 1.52, YEAR: 1 },
      { BOND_CODE: '100002', BOND_ABBR: '国债1808', BOND_YIELD: 1.68, YEAR: 2 },
      { BOND_CODE: '100003', BOND_ABBR: '国债1904', BOND_YIELD: 2.05, YEAR: 5 },
      { BOND_CODE: '100004', BOND_ABBR: '国债2001', BOND_YIELD: 2.48, YEAR: 10 },
      { BOND_CODE: '100005', BOND_ABBR: '国债2401', BOND_YIELD: 2.26, YEAR: 30 }
    ]}};
    const result = parseBondYieldData(mock);
    expect(result.y30).toBe(2.26);
  });
});

// ============================================================================
// 测试 8: parseYieldText — 从搜索文本提取国债收益率
// ============================================================================
describe('parseYieldText — 搜索文本收益率提取', () => {
  let parseYieldText;

  beforeEach(async () => {
    vi.resetModules();
    const df = await import('../utils/ai/data-fetcher');
    parseYieldText = df.parseYieldText;
  });

  it('中文新闻格式: X年期收益率X.XX%', () => {
    const text = '中国1年期国债收益率报1.52%，2年期1.68%，5年期2.05%，10年期2.48%。';
    const result = parseYieldText(text);
    expect(result.y1).toBe(1.52);
    expect(result.y2).toBe(1.68);
    expect(result.y5).toBe(2.05);
    expect(result.y10).toBe(2.48);
    expect(result.spread_10_2).toBeCloseTo(0.80, 2);
  });

  it('英文格式: 1Y 2Y 5Y 10Y', () => {
    const text = 'China 1Y bond yield 1.52, 2Y: 1.68, 5Y=2.05, 10Y yield 2.48';
    const result = parseYieldText(text);
    expect(result.y1).toBe(1.52);
    expect(result.y10).toBe(2.48);
  });

  it('提及 期限利差', () => {
    const text = '10年2.48%，2年1.68%。期限利差10-2年为0.80%。';
    const result = parseYieldText(text);
    expect(result.y10).toBe(2.48);
    expect(result.y2).toBe(1.68);
    expect(result.spread_10_2).toBe(0.80);
  });

  it('仅部分期限数据', () => {
    const text = '中国10年期国债收益率2.48%';
    const result = parseYieldText(text);
    expect(result.y10).toBe(2.48);
    expect(result.y1).toBeUndefined();
    expect(result.spread_10_2).toBeUndefined();
  });

  it('空文本 → 空对象', () => {
    expect(parseYieldText('')).toEqual({});
    expect(parseYieldText(null)).toEqual({});
  });
});

// ============================================================================
// 测试 9: parseMacroData — M2/PMI 宏观数据提取
// ============================================================================
describe('parseMacroData — M2/PMI 宏观数据提取', () => {
  let parseMacroData;

  beforeEach(async () => {
    vi.resetModules();
    const df = await import('../utils/ai/data-fetcher');
    parseMacroData = df.parseMacroData;
  });

  it('中文 M2 格式: M2同比增速X.X%', () => {
    const text = '中国5月M2同比增速8.2%，前值8.3%。';
    const result = parseMacroData(text);
    expect(result.m2Growth).toBe(8.2);
  });

  it('中文 M2 变体: 广义货币(M2)余额同比增长X.X%', () => {
    const text = '5月末，广义货币(M2)余额301.85万亿元，同比增长7.0%。';
    const result = parseMacroData(text);
    expect(result.m2Growth).toBe(7.0);
  });

  it('中文 M2 变体: M2增速X.X%', () => {
    const text = '5月M2增速7.0%，社会融资规模存量同比增长8.4%。';
    const result = parseMacroData(text);
    expect(result.m2Growth).toBe(7.0);
  });

  it('中文 PMI 格式: 制造业PMI为XX.X%', () => {
    const text = '6月制造业PMI为50.8%，环比上升0.2个百分点。';
    const result = parseMacroData(text);
    expect(result.pmiManuf).toBe(50.8);
  });

  it('中文 PMI 变体: 官方制造业PMI XX.X', () => {
    const text = '中国6月官方制造业PMI 50.8，前值50.6。';
    const result = parseMacroData(text);
    expect(result.pmiManuf).toBe(50.8);
  });

  it('英文 M2 格式', () => {
    const text = 'China M2 money supply grew 8.2% year-on-year in May';
    const result = parseMacroData(text);
    expect(result.m2Growth).toBe(8.2);
  });

  it('英文 PMI 格式', () => {
    const text = 'China Manufacturing PMI stands at 50.8 in June';
    const result = parseMacroData(text);
    expect(result.pmiManuf).toBe(50.8);
  });

  it('M2 + PMI 同时提取', () => {
    const text = '中国5月M2增速7.0%，6月制造业PMI为50.8%。';
    const result = parseMacroData(text);
    expect(result.m2Growth).toBe(7.0);
    expect(result.pmiManuf).toBe(50.8);
  });

  it('仅 M2 无 PMI', () => {
    const text = '央行：5月M2同比增速7.0%';
    const result = parseMacroData(text);
    expect(result.m2Growth).toBe(7.0);
    expect(result.pmiManuf).toBeUndefined();
  });

  it('空文本 → 空对象', () => {
    expect(parseMacroData('')).toEqual({});
    expect(parseMacroData(null)).toEqual({});
  });
});
