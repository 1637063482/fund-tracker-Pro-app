// 量化打分引擎 — 决策树状态分类器
// 将 System Prompt 中的 F1-F4 档位规则翻译为确定性的 JS 决策树
// 设计原则（防坑3）：输出"标签"(category/baseScore/scoreRange)，不输出连续分数
// LLM 在 scoreRange 内做 ±1 微调，利用其模糊理解优势
import { logDecisionTree, logVRCalc, logFundScore } from './quantLogger';

// ============================================================================
// 通用工具：EMA / SMA
// ============================================================================
const calcSMA = (values, period) => {
  if (values.length < period) return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
};

// 控制台探针：每个决策树分类结果自动输出到浏览器控制台
const _trace = (name, ctx, result, extraLabel) => {
  if (typeof logDecisionTree === 'function') {
    logDecisionTree(name + (extraLabel ? ` (${extraLabel})` : ''), ctx, result);
  }
  return result;
};

// ============================================================================
// F1a 上证宏观赔率 — 12 档决策树
// 对应 System Prompt 中的 12 个档位描述
// ============================================================================

/**
 * @param {Object} ctx
 * @param {number} ctx.price - 当前收盘价
 * @param {number} ctx.dailyMA20 - 20日均线
 * @param {number} ctx.dailyMA60 - 60日均线
 * @param {number} ctx.weeklyMA20 - 20周均线
 * @param {Object} ctx.weeklyMACD - 周线MACD { dif, dea, macdBar }
 * @param {boolean} ctx.weeklyMACDGoldenCross - 周线MACD金叉状态
 * @param {boolean} ctx.weeklyMACDDeadCross - 周线MACD死叉状态
 * @param {boolean} ctx.weeklyTopDivergence - 周线MACD顶背离(价新高DIF未新高,≥3周)
 * @param {boolean} ctx.weeklyBottomDivergence - 周线MACD底背离(价新低DIF未新低,≥3周)
 * @param {Object} ctx.weeklyBollinger - 周线布林带 { upper, middle, lower, bandwidth, bwPercentile, squeeze }
 * @param {number} ctx.pePercentile - PE历史分位(0-100)
 * @param {string} ctx.monthlyPosition - 月K位置 'upper'|'middle'|'lower'
 * @param {boolean} ctx.monthlyTopDivergence - 月K上轨+多周期顶背离
 * @param {boolean} ctx.dailyCenterUp - 日K重心上移(近5日)
 * @param {boolean} ctx.dailyCenterDown - 日K重心下移(近5日)
 * @param {boolean} ctx.weeklyHighStall - 周K高位滞涨+量价背离
 * @param {boolean} ctx.dailyMA20Turning - 20日均线走平/拐头(从下跌到走平)
 * @returns {{category, baseScore, scoreRange, confidence, keySignals, overrides}}
 */
export function classifyF1a(ctx) {
  const { price, dailyMA20, dailyMA60, weeklyMA20 } = ctx;
  const aboveDaily60 = price > dailyMA60;
  const aboveWeekly20 = price > weeklyMA20;
  const aboveDaily20 = price > dailyMA20;
  const belowDaily60 = price < dailyMA60;
  const belowWeekly20 = price < weeklyMA20;
  const belowDaily20 = price < dailyMA20;

  // ── 红线先行（可被 topDivergenceResolved 绕过）──
  const hasTopDivergence = (ctx.weeklyMACD?.topDivergence || ctx.weeklyTopDivergence) && !ctx.topDivergenceResolved;
  if (hasTopDivergence) {
    return {
      category: '周线MACD顶背离压制',
      baseScore: 5,
      scoreRange: [0, 10],
      confidence: 'high',
      keySignals: ['周线MACD顶背离(价新高DIF未新高)'],
      overrides: { f1aCap: 10 }
    };
  }

  // ── 第1档：月K上轨+多周期顶背离+估值>80% → 0-1
  if (ctx.monthlyPosition === 'upper' && ctx.monthlyTopDivergence && ctx.pePercentile > 80) {
    return {
      category: '月K上轨+多周期顶背离+估值极高',
      baseScore: 1,
      scoreRange: [0, 1],
      confidence: 'high',
      keySignals: ['月K上轨', '多周期顶背离', `PE分位${ctx.pePercentile}%`],
      overrides: { totalCap: 45 }
    };
  }

  // ── 第2档：周K高位滞涨+量价背离 → 2-3
  if (ctx.weeklyHighStall) {
    return {
      category: '周K高位滞涨+量价背离',
      baseScore: 2,
      scoreRange: [2, 3],
      confidence: 'medium',
      keySignals: ['周K高位滞涨', '量价背离']
    };
  }

  // ═══════════════════════════════════════════
  // 极值优先：底背离/大底判定先于均线常规判定
  // 确保F1输出纯宏观赔率信号，CIO矩阵+F2做时机拦截
  // ═══════════════════════════════════════════

  // ── (原第9档) 周线MACD底背离+布林带宽收窄 → 16-18
  if (ctx.weeklyBottomDivergence && ctx.weeklyBollinger?.squeeze) {
    return {
      category: '周线MACD底背离+布林带宽收窄(左侧大底,胜率>金叉)',
      baseScore: 17,
      scoreRange: [16, 18],
      confidence: 'high',
      keySignals: ['周线MACD底背离(价新低DIF未新低≥3周)', '布林带宽收窄']
    };
  }

  // ── (原第10档) 月K下轨+周K底背离+估值<20% → 18-20
  if (ctx.monthlyPosition === 'lower' && ctx.weeklyBottomDivergence && ctx.pePercentile < 20) {
    return {
      category: '月K下轨+周K底背离+估值极低(绝对大底,最高赔率)',
      baseScore: 19,
      scoreRange: [18, 20],
      confidence: 'high',
      keySignals: ['月K下轨', '周K底背离', `PE分位${ctx.pePercentile}%`]
    };
  }

  // ── (原第8档) 周K低位企稳+日K重心上移+周线MACD金叉 → 14-16
  if (ctx.weeklyBollinger) {
    const bb = ctx.weeklyBollinger;
    const nearLower = price <= parseFloat(bb.lower) * 1.02;
    if (nearLower && ctx.dailyCenterUp && ctx.weeklyMACDGoldenCross) {
      return {
        category: '周K低位企稳+日K重心上移+周线金叉(中期反弹右侧确认)',
        baseScore: 15,
        scoreRange: [14, 16],
        confidence: 'high',
        keySignals: ['周K低位企稳', '日K重心上移', '周线MACD金叉']
      };
    }
  }

  // ═══════════════════════════════════════════
  // 常规均线判定（极值未命中时）
  // ═══════════════════════════════════════════

  // ── (原第3档) 价跌破60日&20周+周线MACD死叉+布林带宽扩张向下 → 3-5
  if (belowDaily60 && belowWeekly20 && ctx.weeklyMACDDeadCross && ctx.weeklyBollinger?.squeeze === false) {
    return {
      category: '跌破关键均线+周线死叉+布林扩张向下',
      baseScore: 4,
      scoreRange: [3, 5],
      confidence: 'high',
      keySignals: ['价跌破60日线', '价跌破20周线', '周线MACD死叉', '布林带宽扩张向下']
    };
  }

  // ── 价跌破60日&20周+重心下移+周线MACD未死叉 → 5-7
  if (belowDaily60 && belowWeekly20 && ctx.dailyCenterDown && !ctx.weeklyMACDDeadCross) {
    return {
      category: '跌破均线+重心下移(未死叉)',
      baseScore: 6,
      scoreRange: [5, 7],
      confidence: 'medium',
      keySignals: ['价跌破60日线', '价跌破20周线', '重心下移', '周线MACD未死叉']
    };
  }

  // ── 第5档：价夹在60日与20周均线间 → 7-8
  if ((belowDaily60 && aboveWeekly20) || (aboveDaily60 && belowWeekly20)) {
    return {
      category: '夹在60日与20周均线间,方向不定',
      baseScore: 8,
      scoreRange: [7, 8],
      confidence: 'low',
      keySignals: ['价夹在关键均线之间']
    };
  }

  // ── 第6档：20日均线拐点狙击 → 8-10
  if (belowDaily60 && aboveDaily20 && ctx.dailyMA20Turning) {
    return {
      category: '20日均线拐点狙击(价在60日下方但站上20日线且20日线走平/拐头)',
      baseScore: 9,
      scoreRange: [8, 10],
      confidence: 'medium',
      keySignals: ['站上20日线', '20日线走平/拐头', '仍在60日下方']
    };
  }

  // ── 第7档：价上穿60日&20周+周线MACD多头(DIF>DEA>0) → 12-14
  if (aboveDaily60 && aboveWeekly20 && ctx.weeklyMACDGoldenCross) {
    const macd = ctx.weeklyMACD || {};
    const macdBullish = (macd.dif || 0) > (macd.dea || 0) && (macd.dea || 0) > 0;
    if (macdBullish) {
      return {
        category: '站上关键均线+周线MACD多头',
        baseScore: 13,
        scoreRange: [12, 14],
        confidence: 'high',
        keySignals: ['价上穿60日均线', '价上穿20周均线', '周线MACD金叉/多头']
      };
    }
    // 上穿均线但MACD未金叉 → 10-12
    return {
      category: '站上关键均线(周线MACD未金叉)',
      baseScore: 11,
      scoreRange: [10, 12],
      confidence: 'medium',
      keySignals: ['价上穿60日均线', '价上穿20周均线', '周线MACD未金叉']
    };
  }

  // ── 第8档：周K低位企稳+日K重心上移+周线MACD金叉 → 14-16
  if (ctx.weeklyBollinger) {
    const bb = ctx.weeklyBollinger;
    const nearLower = price <= parseFloat(bb.lower) * 1.02;
    if (nearLower && ctx.dailyCenterUp && ctx.weeklyMACDGoldenCross) {
      return {
        category: '周K低位企稳+日K重心上移+周线金叉(中期反弹右侧确认)',
        baseScore: 15,
        scoreRange: [14, 16],
        confidence: 'high',
        keySignals: ['周K低位企稳', '日K重心上移', '周线MACD金叉']
      };
    }
  }

  // ── 兜底档位：根据均线相对位置判定 ──
  if (aboveDaily60 && aboveWeekly20) {
    return {
      category: '站上关键均线(态势偏多)',
      baseScore: 12,
      scoreRange: [10, 14],
      confidence: 'medium',
      keySignals: ['价在60日线上方', '价在20周线上方']
    };
  }

  if (aboveDaily60 && belowWeekly20) {
    return {
      category: '短期修复但中期承压',
      baseScore: 8,
      scoreRange: [7, 9],
      confidence: 'low',
      keySignals: ['价在60日线上方', '价在20周线下方']
    };
  }

  // 最终兜底
  return {
    category: '均线下方弱势(兜底)',
    baseScore: 5,
    scoreRange: [3, 7],
    confidence: 'low',
    keySignals: ['价低于关键均线']
  };
}

// ============================================================================
// F3 量价验证 — VR 计算器 + 拦截器
// 对应 System Prompt 中的 11 个档位 + 4 个拦截器
// ============================================================================

/**
 * @param {Object} ctx
 * @param {number} ctx.todayTurnoverYi - 今日沪深两市成交额(亿元)
 * @param {number[]} ctx.recentTurnovers - 近5-10日成交额序列(亿元),第0个=最近交易日
 * @param {number} ctx.upCount - 上涨家数
 * @param {number} ctx.downCount - 下跌家数
 * @param {Object} ctx.indexChanges - 指数涨跌幅 {sh:-0.005, sz:-0.003, cyb:-0.012, kc50:null}
 * @param {string} ctx.microstructureSignal - 微观结构旗标 '🚨 fatal'|'⚠️ warn'|'✅ clear'|'⚪ neutral'
 * @param {boolean} ctx.isEarlySession - 是否早盘(<30min),早盘时VR不准
 * @returns {{score, category, reason, scoreRange, overrides}}
 */
export function calcVRAndIntercept(ctx) {
  const {
    todayTurnoverYi, recentTurnovers = [], upCount = 0, downCount = 0,
    indexChanges = {}, microstructureSignal = '', isEarlySession = false,
    f4Score = 0  // 用于分红季 F4 配合判定,默认为 0(未知)
  } = ctx;

  // 计算 VR（量比）— 优先用20日均量，兜底5日
  const validRecent = recentTurnovers.filter(v => v > 0).slice(0, 20);
  let VR = 1.0;
  let vrSource = '定量(JS)';
  let volumeBaselineDays = 0;

  if (validRecent.length >= 10) {
    const avg20d = validRecent.reduce((a, b) => a + b, 0) / validRecent.length;
    VR = avg20d > 0 ? todayTurnoverYi / avg20d : 1.0;
    vrSource = '定量(JS-20d)';
    volumeBaselineDays = 20;
  } else if (validRecent.length >= 3) {
    const avg5d = validRecent.reduce((a, b) => a + b, 0) / validRecent.length;
    VR = avg5d > 0 ? todayTurnoverYi / avg5d : 1.0;
    vrSource = '定量(JS-5d)';
    volumeBaselineDays = 5;
  } else if (todayTurnoverYi > 25000) {
    VR = 2.0;
    vrSource = '定性(天量标签)';
  } else if (todayTurnoverYi > 15000) {
    VR = 1.5;
    vrSource = '定性(放量标签)';
  } else if (todayTurnoverYi < 5000) {
    VR = 0.5;
    vrSource = '定性(地量标签)';
  } else {
    VR = 1.0;
    vrSource = '定性(中性标签)';
  }

  // 判定涨跌方向
  const upDominant = upCount > downCount;
  const downDominant = downCount > upCount;
  const shChange = indexChanges.sh || 0;
  const cybChange = indexChanges.cyb || indexChanges.sz || 0;
  const kcChange = indexChanges.kc50 || 0;

  // 任一指数跌超阈值
  const anyMajorDrop = (shChange < -0.003) || (cybChange < -0.01) || (kcChange < -0.01);

  // ═══════════════════════════════════════════
  // 🚨 拦截器（自上而下逐条匹配，命中即停）
  // ═══════════════════════════════════════════

  // 拦截器(a)：微观结构崩溃熔断（绝对最高优先级）
  // 设计原则：分红季期指结构性贴水≠危机，但大盘暴跌+贴水=真危机仍需熔断
  const now = new Date();
  const isDividendSeason = now.getMonth() === 5 || now.getMonth() === 6; // JS: 5=June, 6=July
  const upDownRatio = upCount / Math.max(downCount, 1);
  // 真崩盘判定（不论是否分红季，都跳过豁免）
  const isTrueCrash = (shChange <= -0.02) && (upDownRatio < 0.3);
  // 分红季：期指贴水是结构性噪声，正常波动不否决豁免
  // 用更宽松的阈值取代 anyMajorDrop 的 -0.3%
  const majorDropThreshold = isDividendSeason ? -0.015 : -0.003;
  const majorDrop = (shChange < majorDropThreshold) || (cybChange < -0.01);
  // 分红季豁免：涨跌比>0.5=广度正常，可豁免
  const canExempt = isDividendSeason && !isTrueCrash && upDownRatio > 0.5;

  // 分红季豁免：涨跌比>0.5且非真崩盘时，微观结构信号跳过量价拦截器链
  if (canExempt) {
    if (microstructureSignal === '🚨 fatal' || microstructureSignal === '⚠️ warn') {
      // 跳过拦截器(a)，直接进入拦截器(b)-(e)和常规档位
      // 让 VR/涨跌价/价格数据自己说话
    }
  } else {
    // 非分红季或真崩盘：正常处理微观结构信号
    if (microstructureSignal === '🚨 fatal') {
      if (!majorDrop) {
        return {
          score: 8,
          category: '微观结构警告(流动性偏紧但大盘未跌,F3≤15)',
          reason: `流动性/期指信号=${microstructureSignal}，但主要指数未明显下跌，判断为短期扰动非系统性危机`,
          scoreRange: [0, 15],
          overrides: { f3Cap: 15 },
          VR, vrSource
        };
      }
      // 流动性危机 + 大盘同步下跌 = 真正系统性风险
      return {
        score: 2,
        category: '微观结构熔断(三重确认,LLM可驳回)',
        reason: `流动性紧缩+期指深度贴水+主要指数下跌——整体信号=${microstructureSignal}，三重确认。LLM请交叉验证原始数据后自行裁定。`,
        scoreRange: [0, 5],
        overrides: { totalEquityCap: 35, f3IgnoreVR: true, fatalHardLimit: true, llmMayOverride: true },
        VR, vrSource
      };
    }
    if (microstructureSignal === '⚠️ warn') {
      return {
        score: 8,
        category: '微观结构警告(F3上限≤15)',
        reason: `流动性或期指出现警告信号——整体信号=${microstructureSignal}。A股IM/IC常年贴水≠恐慌，保持适度警惕。`,
        scoreRange: [0, 15],
        overrides: { f3Cap: 15 },
        VR, vrSource
      };
    }
  }

  // 拦截器(b)：踩踏式断层（A股流动性危机 — 放量+极度普跌+指数重挫）
  // 放量但跌>涨×3说明毫无承接，机构散户无差别踩踏
  if (VR > 1.15 && downCount > upCount * 3 && (shChange < -0.015 || cybChange < -0.02)) {
    return {
      score: 1,
      category: '🚨踩踏式断层(流动性危机)',
      reason: `VR=${VR.toFixed(1)} 跌/涨=${(downCount/Math.max(upCount,1)).toFixed(1)}:1 指数${(shChange*100).toFixed(1)}%，无承接踩踏`,
      scoreRange: [0, 3],
      overrides: { f3Cap: 3 },
      VR, vrSource
    };
  }

  // 拦截器(c)：天量掩护出货（VR相对指标，自适应市场量能水平）
  if (VR > 1.5 && anyMajorDrop) {
    return {
      score: 2,
      category: '天量掩护出货',
      reason: `VR=${VR.toFixed(1)} 成交=${todayTurnoverYi}亿 主力出货`,
      scoreRange: [0, 3],
      overrides: { f1CapIfAbove25: 25 },
      VR, vrSource
    };
  }

  // 拦截器(d)：虚假繁荣（权重强拉指数，全市场失血）← A股真正的掩护出货
  // up>跌×1.5+指数跌=健康的高低切轮动，不是出货！删掉旧方向判定。
  if (shChange > 0.005 && downCount > upCount * 2) {
    return {
      score: 2,
      category: '🚨虚假繁荣(权重独舞,虹吸全市场)',
      reason: `上证+${(shChange*100).toFixed(1)}%但跌${downCount}>>涨${upCount}(${(downCount/Math.max(upCount,1)).toFixed(1)}:1)，权重强拉诱多，全市场失血`,
      scoreRange: [0, 3],
      overrides: { f3Cap: 3, f1CapIfAbove25: 25 },
      VR, vrSource
    };
  }

  // 拦截器(e)：天量派发（高位绞肉机 — VR自适应量能水平，天量推不动指数=派发）
  const isStall = Math.abs(shChange) < 0.003 && (upCount / Math.max(downCount, 1)) < 1.5;
  if (VR > 1.8 && isStall) {
    return {
      score: 2,
      category: '🧱天量派发(放量滞涨,高位绞肉机)',
      reason: `VR=${VR.toFixed(1)}(>2.0,今日量能${(VR*100).toFixed(0)}%近5日均量) 涨幅<0.3%，天量推不动=强阻力/机构派发`,
      scoreRange: [0, 3],
      VR, vrSource
    };
  }

  // ═══════════════════════════════════════════
  // 常规档位（自上而下匹配，命中即停）
  // ═══════════════════════════════════════════

  // 恐慌宣泄：VR>1.5且跌>涨 — 在A股往往是爆量分歧(恐慌盘+机构抄底)，非单边崩盘
  if (VR > 1.5 && downDominant) {
    return {
      score: 3,
      category: '恐慌宣泄(爆量分歧,可能是V反前夜)',
      reason: `VR=${VR.toFixed(1)}(>1.8) 成交=${todayTurnoverYi}亿 跌>涨，高量能意味着承接盘存在`,
      scoreRange: [1, 5],
      VR, vrSource
    };
  }

  // 显著放量下跌 — 中度利空，不构成熔断级别
  if (VR > 1.3 && downDominant) {
    return {
      score: 7,
      category: '显著放量下跌',
      reason: `VR=${VR.toFixed(1)}(>1.5) 跌>涨`,
      scoreRange: [5, 9],
      VR, vrSource
    };
  }

  // 增量抢筹：VR>1.15且涨>跌×2且指数收涨
  if (VR > 1.15 && upCount > downCount * 2 && shChange > 0) {
    return {
      score: 23,
      category: '增量抢筹',
      reason: `VR=${VR.toFixed(1)}(>1.3) 涨>跌×2 指数>0`,
      scoreRange: [21, 25],
      VR, vrSource
    };
  }

  // 温和放量(涨)
  if (VR > 1.0 && upDominant) {
    return {
      score: 18,
      category: '温和放量上涨',
      reason: `VR=${VR.toFixed(1)}(>1.0) 涨>跌`,
      scoreRange: [16, 20],
      VR, vrSource
    };
  }

  // 放量下行
  if (VR > 1.0 && downDominant) {
    return {
      score: 10,
      category: '放量下行',
      reason: `VR=${VR.toFixed(1)}(>1.0) 跌>涨`,
      scoreRange: [8, 12],
      VR, vrSource
    };
  }

  // 地量见地价（优先于缩量阴跌判定）
  // 注意: isConsecutiveDrop 和 isNearLow 应由调用方从K线数据传入。默认 false 防止误判。
  const isConsecutiveDrop = ctx.isConsecutiveDrop || false;
  const isNearLow = ctx.isNearLow || false;
  if (VR < 0.6 && isConsecutiveDrop && isNearLow) {
    return {
      score: 18,
      category: '地量见地价(空头衰竭变盘在即)',
      reason: `VR=${VR.toFixed(1)}(<0.6) 连跌后缩量企稳`,
      scoreRange: [16, 20],
      VR, vrSource
    };
  }

  // 缩量阴跌
  if (VR >= 0.5 && VR <= 0.7 && downDominant) {
    return {
      score: 8,
      category: '缩量阴跌',
      reason: `VR=${VR.toFixed(1)}(0.5-0.7) 跌>涨`,
      scoreRange: [6, 10],
      VR, vrSource
    };
  }

  // 虚假繁荣/极度缩量
  if (VR < 0.5 || (VR < 0.7 && upDominant)) {
    return {
      score: 4,
      category: '虚假繁荣/极度缩量',
      reason: `VR=${VR.toFixed(1)}(<0.5或<0.7且涨>跌)`,
      scoreRange: [2, 5],
      VR, vrSource
    };
  }

  // ── 兜底：正常博弈 ──
  return {
    score: 13,
    category: '正常博弈',
    reason: `VR=${VR.toFixed(1)} 涨跌比${upCount}/${downCount}`,
    scoreRange: [11, 15],
    VR, vrSource
  };
}

// ============================================================================
// F1b 双创风格校验 — 6 档决策树
// 对应 System Prompt 中的 F1b 档位描述
// ============================================================================

/**
 * @param {Object} ctx
 * @param {number} ctx.price - 创业板当前价
 * @param {number} ctx.dailyMA60 - 60日均线
 * @param {number} ctx.weeklyMA20 - 20周均线
 * @param {Object} ctx.weeklyMACD - 周线MACD { dif, dea, goldenCross, deadCross, topDivergence, bottomDivergence }
 * @param {Object} ctx.bollinger - 布林带 { upper, middle, lower, bandwidth, squeeze }
 * @param {boolean} ctx.dailyTopDivergence - 日K顶背离(假突破/主力出货)
 * @param {boolean} ctx.synchWithSH - 双创与上证方向完全同步
 * @param {Object|null} ctx.kc50Ctx - 科创50补充上下文(仅当与创业板方向不一致时)
 * @returns {{category, baseScore, scoreRange, confidence, keySignals, overrides}}
 */
export function classifyF1b(ctx) {
  const { price, dailyMA60, weeklyMA20, correlationWithSH } = ctx;
  const aboveDaily60 = price > dailyMA60;
  const aboveWeekly20 = price > weeklyMA20;
  const belowDaily60 = price < dailyMA60;
  const belowWeekly20 = price < weeklyMA20;

  // 相关系数调整：用于后续各档位的分数修正
  // correlation > 0.85: 双创跟风上证 → 衰减权重
  // correlation < 0.65: 双创独立行情 → 提升权重
  const corrAdj = correlationWithSH != null
    ? (correlationWithSH > 0.85 ? 0.6
        : correlationWithSH < 0.65 ? 1.2
        : 1.0)
    : 1.0;
  const isHighCorr = correlationWithSH != null && correlationWithSH > 0.85;
  const isLowCorr = correlationWithSH != null && correlationWithSH < 0.65;

  // ── 红线：创业板周线MACD顶背离 ──
  if (ctx.weeklyMACD?.topDivergence) {
    return {
      category: '双创周线MACD顶背离',
      baseScore: 3,
      scoreRange: [0, 6],
      confidence: 'high',
      keySignals: ['创业板周线MACD顶背离(价新高DIF未新高)'],
      overrides: { f1bCap: 6 }
    };
  }

  // ── 日K顶背离+放量冲高回落 → 假突破/主力出货 → 0-1 ──
  if (belowDaily60 && ctx.dailyTopDivergence) {
    return {
      category: '双创日K顶背离+假突破(主力出货)',
      baseScore: 1,
      scoreRange: [0, 4],
      confidence: 'high',
      keySignals: ['日K顶背离', '放量冲高回落', '假突破'],
      overrides: { f1bHardFloor: 0 }
    };
  }

  // ── 双创领涨：站上60日&20周+周线MACD金叉/多头 → 12-15 ──
  if (aboveDaily60 && aboveWeekly20 && ctx.weeklyMACD?.goldenCross) {
    const bb = ctx.bollinger;
    if (ctx.weeklyMACD?.bottomDivergence && bb?.squeeze) {
      const bs = Math.round(15 * corrAdj);
      return {
        category: isHighCorr
          ? `双创跟风(r=${correlationWithSH.toFixed(2)},结构牛衰减)`
          : '双创周线MACD底背离+布林带宽收窄(结构牛市起点)',
        baseScore: Math.min(bs, 15),
        scoreRange: [Math.min(Math.round(14 * corrAdj * 0.5), 14), Math.min(bs, 15)],
        confidence: isLowCorr ? 'very_high' : isHighCorr ? 'low' : 'high',
        keySignals: ['周线MACD底背离', '布林带宽收窄', '站上关键均线'].concat(
          isHighCorr ? [`sh-cyb相关系数${correlationWithSH.toFixed(2)}(高度相关,跟风)`] : []
        ),
        overrides: isHighCorr ? { f1bWeightDecay: 0.6 } : undefined
      };
    }
    const isExtremeBollinger = bb && parseFloat(bb.upper) > 0 && price > parseFloat(bb.upper) * 0.95;
    const baseScoreVal = isExtremeBollinger ? 9 : 13;
    const adjusted = Math.round(baseScoreVal * corrAdj);
    return {
      category: isHighCorr
        ? `双创跟风(r=${correlationWithSH.toFixed(2)},领涨衰减)`
        : isLowCorr
        ? `双创领涨(r=${correlationWithSH.toFixed(2)},独立行情)`
        : '双创领涨(站上关键均线+周线金叉/多头)',
      baseScore: Math.min(adjusted, 15),
      scoreRange: [Math.round((isExtremeBollinger ? 8 : 12) * corrAdj * 0.5), Math.min(adjusted, 15)],
      confidence: isLowCorr ? 'very_high' : isHighCorr ? 'low' : 'high',
      keySignals: ['站上60日均线', '站上20周均线', '周线MACD金叉/多头', isExtremeBollinger ? '布林上轨附近(短期超买)' : '']
        .concat(isHighCorr ? [`相关系数${correlationWithSH.toFixed(2)}高,跟风`] : [])
        .filter(Boolean)
    };
  }

  // ── 双创偏多：站上60日线+周线MACD未金叉但DIF走平 → 8-12 ──
  if (aboveDaily60 && !ctx.weeklyMACD?.goldenCross) {
    const adjusted = Math.round(10 * corrAdj);
    return {
      category: isHighCorr
        ? `双创跟风(r=${correlationWithSH.toFixed(2)},偏多衰减)`
        : '双创偏多(站上60日线,周线MACD未金叉)',
      baseScore: Math.min(adjusted, 12),
      scoreRange: [Math.round(8 * corrAdj * 0.5), Math.min(adjusted, 12)],
      confidence: isHighCorr ? 'low' : 'medium',
      keySignals: ['站上60日均线', '周线MACD未金叉'].concat(
        isHighCorr ? [`相关系数${correlationWithSH.toFixed(2)},跟风`] : []
      )
    };
  }

  // ── 双创中性：夹在60日与20周间 → 4-8 ──
  if ((aboveDaily60 && belowWeekly20) || (belowDaily60 && aboveWeekly20)) {
    if (ctx.synchWithSH) {
      return {
        category: '双创与上证同步(中性跟随)',
        baseScore: 7,
        scoreRange: [6, 7],
        confidence: 'medium',
        keySignals: ['双创与上证方向完全同步', '无独立行情']
      };
    }
    return {
      category: '双创中性(夹在关键均线间,方向不定)',
      baseScore: 6,
      scoreRange: [4, 8],
      confidence: 'low',
      keySignals: ['夹在60日与20周均线间']
    };
  }

  // ── 双创偏空：跌破60日线+周线MACD未金叉 → 0-4 ──
  if (belowDaily60) {
    const adjusted = Math.round(2 * (isLowCorr ? 1.3 : 1));
    return {
      category: isLowCorr
        ? `双创独立走弱(r=${correlationWithSH.toFixed(2)},风险更大)`
        : '双创偏空(跌破60日线,周线MACD未金叉)',
      baseScore: Math.min(adjusted, 4),
      scoreRange: [0, Math.min(adjusted, 4)],
      confidence: isLowCorr ? 'high' : 'medium',
      keySignals: ['跌破60日均线', '周线MACD未金叉'].concat(
        isLowCorr ? [`相关系数${correlationWithSH.toFixed(2)},弱相关独立走弱`] : []
      )
    };
  }

  // ── 兜底 ──
  return {
    category: '双创中性(数据不足,兜底)',
    baseScore: 7,
    scoreRange: [4, 8],
    confidence: 'low',
    keySignals: ['数据不足以精准定档']
  };
}

// ============================================================================
// F2 微观反转与背离 — 6 档决策树
// 对应 System Prompt 中的 F2 档位描述
// ============================================================================

/**
 * @param {Object} ctx
 * @param {number} ctx.deviation20d - 偏离20日均线幅度(%)
 * @param {number} ctx.deviation60d - 偏离60日均线幅度(%)
 * @param {boolean} ctx.isChuangYe - 是否创业板/科创50(波动率翻倍,阈值自适应)
 * @param {boolean} ctx.touchBollLower - 触及布林下轨
 * @param {number} ctx.consecutiveDownDays - 连阴天数
 * @param {boolean} ctx.deepV - 深V形态(日内或日间)
 * @param {boolean} ctx.volumeUp - 带量上行
 * @param {boolean} ctx.intradayStable - 分时企稳(低点不刷新)
 * @param {boolean} ctx.declineNarrowing - 跌幅收窄
 * @param {number} ctx.amplitude - 日振幅(%)
 * @param {boolean} ctx.topPattern - 日K高位+冲高跳水/长上影/顶背离
 * @param {boolean} ctx.rsiBottomDivergence - RSI底背离
 * @param {boolean} ctx.bollLowerRSILow - 布林下轨+RSI<30(三重确认)
 * @returns {{category, baseScore, scoreRange, confidence, keySignals}}
 */
export function classifyF2(ctx) {
  const mult = ctx.isChuangYe ? 2 : 1;
  const dev20Threshold = 3 * mult;   // 上证3%, 双创6%
  const dev60Threshold = 5 * mult;   // 上证5%, 双创10%

  const isOversold = Math.abs(ctx.deviation20d) > dev20Threshold ||
    Math.abs(ctx.deviation60d) > dev60Threshold ||
    ctx.touchBollLower ||
    ctx.consecutiveDownDays >= 4;

  const isRSIEnhanced = ctx.rsiBottomDivergence || ctx.bollLowerRSILow;

  // ── 日K高位+冲高跳水 → 0-4, F3自动≤10 ──
  if (ctx.topPattern) {
    return {
      category: '日K高位+冲高跳水/长上影/顶背离',
      baseScore: 2,
      scoreRange: [0, 4],
      confidence: 'high',
      keySignals: ['日K高位', '冲高跳水/长上影/顶背离'],
      overrides: { f3Cap: 10 }
    };
  }

  // ── 持续走弱无量崩 → 4-8 ──
  if (ctx.declineNarrowing === false && Math.abs(ctx.deviation20d) > dev20Threshold * 0.5 && !ctx.volumeUp) {
    return {
      category: '持续走弱无量崩',
      baseScore: 6,
      scoreRange: [4, 8],
      confidence: 'medium',
      keySignals: ['持续走弱', '无量下跌']
    };
  }

  // ── 日K超跌+深V/带量上行 → 21-25 ──
  if (isOversold && (ctx.deepV || ctx.volumeUp)) {
    let score = 23;
    if (isRSIEnhanced) score = 25;  // RSI底背离加满
    return {
      category: '日K超跌+反转信号(深V/带量上行)',
      baseScore: Math.min(score, 25),
      scoreRange: [21, 25],
      confidence: 'high',
      keySignals: [
        isOversold ? '超跌(超阈值/布林下轨/连阴≥4)' : '',
        ctx.deepV ? '深V' : '',
        ctx.volumeUp ? '带量上行' : '',
        isRSIEnhanced ? 'RSI底背离/三重确认(极强信号)' : ''
      ].filter(Boolean)
    };
  }

  // ── 跌幅收窄+分时企稳 → 15-21 ──
  if (ctx.declineNarrowing && ctx.intradayStable) {
    return {
      category: '跌幅收窄+分时企稳(低点不刷新)',
      baseScore: 18,
      scoreRange: [15, 21],
      confidence: 'medium',
      keySignals: ['跌幅收窄', '分时企稳', '低点不刷新']
    };
  }

  // ── 温和量能配合上涨 → 11-15 ──
  if (ctx.volumeUp) {
    return {
      category: '温和量能配合上涨',
      baseScore: 13,
      scoreRange: [11, 15],
      confidence: 'medium',
      keySignals: ['温和量能', '配合上涨']
    };
  }

  // ── 振幅<1.5%无明显方向 → 8-11 ──
  if (ctx.amplitude < 1.5) {
    return {
      category: '窄幅震荡无明显方向',
      baseScore: 10,
      scoreRange: [8, 11],
      confidence: 'low',
      keySignals: [`振幅${ctx.amplitude.toFixed(1)}%`, '无明显方向']
    };
  }

  // ── 兜底 ──
  return {
    category: '走势中性(兜底)',
    baseScore: 10,
    scoreRange: [8, 11],
    confidence: 'low',
    keySignals: ['无显著超跌或反转信号']
  };
}

// ============================================================================
// F4 跨资产确认(国内) — 6 档决策树
// 对应 System Prompt 中的 F4 档位描述
// ============================================================================

/**
 * @param {Object} ctx
 * @param {'up'|'down'|'stable'} ctx.rmb - 人民币方向 (up=升, down=贬)
 * @param {'up'|'down'|'stable'} ctx.copper - 铜价方向
 * @param {'up'|'down'|'stable'} ctx.oil - 油价方向
 * @param {'up'|'down'|'stable'} ctx.gold - 黄金方向
 * @param {'narrow'|'stable'|'widen'} ctx.creditSpread - 信用利差方向 (narrow=收窄, widen=走阔)
 * @returns {{category, baseScore, scoreRange, confidence, keySignals, overrides}}
 */
export function classifyF4(ctx) {
  const { rmb, copper, oil, gold, creditSpread } = ctx;

  // ── 全面 risk-on ──
  if (rmb === 'up' && copper === 'up' && oil === 'up' && (gold === 'stable' || gold === 'down') && creditSpread === 'narrow') {
    return {
      category: '全面risk-on(人民币升+铜涨+油涨+黄金稳/跌+利差收窄)',
      baseScore: 14,
      scoreRange: [12, 15],
      confidence: 'high',
      keySignals: ['人民币升', '铜涨', '油涨', '黄金稳/跌', '信用利差收窄']
    };
  }

  // ── 滞胀信号：金涨+铜跌+油涨（需求弱+成本推升通胀）──
  if (gold === 'up' && copper === 'down' && oil === 'up' && rmb !== 'up') {
    return {
      category: '类滞胀信号(金涨+铜跌+油涨,需求弱+通胀)',
      baseScore: 4,
      scoreRange: [2, 6],
      confidence: 'medium',
      keySignals: ['金涨(避险)', '铜跌(需求弱)', '油涨(通胀)', '人民币未升']
    };
  }

  // ── 全面 risk-off ──
  if (rmb === 'down' && copper === 'down' && oil === 'down' && creditSpread === 'widen') {
    return {
      category: '全面risk-off(人民币贬+铜跌+油跌+利差走阔)',
      baseScore: 1,
      scoreRange: [0, 1],
      confidence: 'high',
      keySignals: ['人民币贬', '铜跌', '油跌', '信用利差走阔'],
      overrides: { totalPenalty: -5 }
    };
  }

  // ── 偏多 ──
  const bullishSignals = [copper === 'up', oil === 'up'].filter(Boolean).length;
  if (rmb === 'stable' && bullishSignals >= 1 && creditSpread !== 'widen') {
    return {
      category: '偏多(人民币稳+铜/油至少一个涨+利差未走阔)',
      baseScore: 10,
      scoreRange: [8, 11],
      confidence: 'medium',
      keySignals: ['人民币稳', bullishSignals >= 1 ? '铜/油涨' : '', '利差未走阔'].filter(Boolean)
    };
  }

  // ── 偏空 ──
  const bearishSignals = [copper === 'down', oil === 'down'].filter(Boolean).length;
  if (rmb === 'down' && bearishSignals >= 1 && creditSpread !== 'narrow') {
    return {
      category: '偏空(人民币贬+铜/油至少一个跌+利差未收窄)',
      baseScore: 3,
      scoreRange: [2, 4],
      confidence: 'medium',
      keySignals: ['人民币贬', bearishSignals >= 1 ? '铜/油跌' : '', '利差未收窄'].filter(Boolean)
    };
  }

  // ── 中性/缺数据 ──
  return {
    category: '信号涨跌互现/中性',
    baseScore: 6,
    scoreRange: [5, 7],
    confidence: 'low',
    keySignals: ['信号无明显一致性']
  };
}

// ============================================================================
// 纯债 F1 — 宏观利率水位 (Max 50)
// 基于国债ETF(sh511260)的月K/周K位置判定
// ETF价上行 = 收益率下行 = 债牛
// ============================================================================

/**
 * @param {Object} ctx
 * @param {number} ctx.price - 国债ETF当前价
 * @param {number} ctx.weeklyMA20 - 周线20MA
 * @param {number} ctx.monthlyMA60 - 月线近似（60日MA）
 * @param {Object} ctx.weeklyBollinger - 周线布林带 { upper, middle, lower, bandwidth }
 * @param {number|null} ctx.yield10Y - 10年期国债收益率(%) 如1.73
 * @param {number|null} ctx.yield10YChange - 10Y收益率近5日变化(bp),正=上行(债跌) 可选
 * @param {'upper'|'middle'|'lower'} ctx.monthlyPosition - 月K位置
 * @returns {{category, baseScore, scoreRange, confidence, keySignals}}
 */
export function classifyBondF1(ctx) {
  const { price, weeklyMA20, monthlyMA60, weeklyBollinger, yield10Y, yield10YChange, monthlyPosition } = ctx;

  // ═══════════════════════════════════════════
  // 收益率水位优先判定（数据可用时优先于ETF技术指标）
  // 利用Worker注入的真实10Y收益率数据
  // ═══════════════════════════════════════════

  // 收益率历史低位(<2.0%)：债市极度拥挤，上涨空间有限
  if (yield10Y != null && yield10Y < 2.0) {
    // 收益率仍在下行（近5日变化为负且幅度超5bp）→ 资金仍在涌入
    if (yield10YChange != null && yield10YChange < -5) {
      return {
        category: '收益率历史低位+加速下行(资金持续涌入,警惕拥挤)',
        baseScore: 15,
        scoreRange: [10, 20],
        confidence: 'medium',
        keySignals: [`10Y收益率${yield10Y.toFixed(2)}%(历史低位)`, `近5日-${Math.abs(yield10YChange).toFixed(0)}bp(仍在下行)`, '交易拥挤']
      };
    }
    // 收益率在低位企稳或回升 → 变盘在即
    return {
      category: '收益率历史低位(变盘在即)',
      baseScore: 12,
      scoreRange: [7, 18],
      confidence: 'medium',
      keySignals: [`10Y收益率${yield10Y.toFixed(2)}%(历史低位)`, '做多空间有限', '关注反弹风险']
    };
  }

  // 收益率偏低(2.0%-2.5%)：中性偏贵
  if (yield10Y != null && yield10Y >= 2.0 && yield10Y < 2.5) {
    return {
      category: '收益率偏低(中性偏贵)',
      baseScore: 22,
      scoreRange: [18, 28],
      confidence: 'medium',
      keySignals: [`10Y收益率${yield10Y.toFixed(2)}%`, '估值中性偏贵', '等待更好买点']
    };
  }

  // 收益率中性(2.5%-3.0%)：合理区间
  if (yield10Y != null && yield10Y >= 2.5 && yield10Y < 3.0) {
    return {
      category: '收益率中性(合理区间)',
      baseScore: 32,
      scoreRange: [27, 37],
      confidence: 'medium',
      keySignals: [`10Y收益率${yield10Y.toFixed(2)}%`, '估值合理', '中性配置']
    };
  }

  // 收益率偏高(3.0%-3.5%)：值得关注
  if (yield10Y != null && yield10Y >= 3.0 && yield10Y < 3.5) {
    return {
      category: '收益率偏高(配置窗口)',
      baseScore: 40,
      scoreRange: [36, 44],
      confidence: 'high',
      keySignals: [`10Y收益率${yield10Y.toFixed(2)}%`, '利率高位', '降息预期升温']
    };
  }

  // 收益率极高(>3.5%)：历史下沿级别的机会
  if (yield10Y != null && yield10Y >= 3.5) {
    return {
      category: '收益率极高(降息降准空间大)',
      baseScore: 46,
      scoreRange: [42, 50],
      confidence: 'high',
      keySignals: [`10Y收益率${yield10Y.toFixed(2)}%>3.5%`, '极度超卖', '降息降准空间大']
    };
  }

  // ═══════════════════════════════════════════
  // yield10Y数据不可用时：回退到ETF技术指标
  // ═══════════════════════════════════════════

  // 历史下沿：月K下轨 + ETF价跌破月MA
  if (monthlyPosition === 'lower' && monthlyMA60 > 0 && price < monthlyMA60) {
    return {
      category: '国债历史下沿(降息降准空间大)',
      baseScore: 46,
      scoreRange: [42, 50],
      confidence: 'high',
      keySignals: ['月K下轨', '跌破月MA']
    };
  }

  // 周K低位：触及布林下轨
  if (weeklyBollinger && price <= parseFloat(weeklyBollinger.lower) * 1.02 && weeklyMA20 > 0 && price < weeklyMA20) {
    return {
      category: '高位回调(布林下轨,降息预期)',
      baseScore: 36,
      scoreRange: [32, 41],
      confidence: 'medium',
      keySignals: ['触及周线布林下轨', '低于周MA20']
    };
  }

  // 周K中轨
  if (weeklyBollinger) {
    const bbLow = parseFloat(weeklyBollinger.lower);
    const bbUp = parseFloat(weeklyBollinger.upper);
    if (price > bbLow * 1.05 && price < bbUp * 0.95) {
      return {
        category: '周K中轨(中性)',
        baseScore: 26,
        scoreRange: [21, 31],
        confidence: 'medium',
        keySignals: ['价格在布林中轨附近']
      };
    }
  }

  // 周K高位：触及布林上轨
  if (weeklyBollinger && price >= parseFloat(weeklyBollinger.upper) * 0.95) {
    return {
      category: '周K高位(交易拥挤)',
      baseScore: 15,
      scoreRange: [10, 20],
      confidence: 'medium',
      keySignals: ['触及周线布林上轨', '交易拥挤']
    };
  }

  // 历史高位：月K上轨 + 周K上轨
  if (monthlyPosition === 'upper' && weeklyBollinger && price >= parseFloat(weeklyBollinger.upper) * 0.98) {
    return {
      category: '历史高位+极度拥挤',
      baseScore: 4,
      scoreRange: [0, 9],
      confidence: 'high',
      keySignals: ['月K上轨', '周K上轨', '极度拥挤']
    };
  }

  // 兜底
  return {
    category: '中性(数据不足)',
    baseScore: 25,
    scoreRange: [18, 32],
    confidence: 'low',
    keySignals: ['数据不足以精准定档']
  };
}

// ============================================================================
// 纯债 F2 — 股债跷跷板与日内流动性 (Max 50)
// ============================================================================

/**
 * @param {Object} ctx
 * @param {number} ctx.stockChange - A股当日涨跌幅(%)
 * @param {number} ctx.bondETFChange - 国债ETF当日涨跌幅(%)
 * @param {number} ctx.VR - 全市场量比
 * @param {'narrow'|'stable'|'widen'} ctx.creditSpreadDirection - 信用利差方向
 * @returns {{category, baseScore, scoreRange, confidence, keySignals}}
 */
export function classifyBondF2(ctx) {
  const { stockChange = 0, bondETFChange = 0, VR = 1.0, creditSpreadDirection = 'stable' } = ctx;

  // A股放量跌>1.5% + 国债涨 → 避险流入债市
  if (stockChange < -1.5 && bondETFChange > 0 && VR > 1.2) {
    return {
      category: 'A股放量跌+国债涨(避险流入)',
      baseScore: 46,
      scoreRange: [42, 50],
      confidence: 'high',
      keySignals: [`A股${stockChange.toFixed(1)}%`, `国债+${bondETFChange.toFixed(2)}%`, `VR=${VR.toFixed(1)}`]
    };
  }

  // A股偏弱 + 国债偏强
  if (stockChange < -0.5 && stockChange >= -1.5 && bondETFChange > 0) {
    return {
      category: 'A股偏弱+国债偏强(跷跷板)',
      baseScore: 36,
      scoreRange: [32, 41],
      confidence: 'medium',
      keySignals: [`A股${stockChange.toFixed(1)}%`, `国债+${bondETFChange.toFixed(2)}%`]
    };
  }

  // 股债双牛（流动性宽松）
  if (stockChange > 0.5 && bondETFChange > 0 && creditSpreadDirection !== 'widen') {
    return {
      category: '股债双牛(流动性宽松)',
      baseScore: 28,
      scoreRange: [25, 31],
      confidence: 'medium',
      keySignals: [`A股+${stockChange.toFixed(1)}%`, `国债+${bondETFChange.toFixed(2)}%`, '利差未走阔']
    };
  }

  // 各自独立
  if (Math.abs(stockChange) < 0.5 && Math.abs(bondETFChange) < 0.1) {
    return {
      category: '股债各自独立',
      baseScore: 21,
      scoreRange: [18, 24],
      confidence: 'low',
      keySignals: ['股债均窄幅波动']
    };
  }

  // A股强 + 国债弱（风险偏好提升）
  if (stockChange > 0.5 && bondETFChange < -0.1) {
    return {
      category: 'A股强+国债弱(风险偏好升)',
      baseScore: 13,
      scoreRange: [10, 17],
      confidence: 'medium',
      keySignals: [`A股+${stockChange.toFixed(1)}%`, `国债${bondETFChange.toFixed(2)}%`]
    };
  }

  // 股债双杀（流动性紧缩冲击）
  if (stockChange < -0.5 && bondETFChange < -0.1) {
    return {
      category: '股债双杀(流动性紧缩)',
      baseScore: 7,
      scoreRange: [5, 9],
      confidence: 'high',
      keySignals: [`A股${stockChange.toFixed(1)}%`, `国债${bondETFChange.toFixed(2)}%`, '流动性冲击']
    };
  }

  // A股狂飙>1.5% + 国债跳水（极致风险偏好）
  if (stockChange > 1.5 && bondETFChange < -0.2) {
    return {
      category: 'A股狂飙+国债跳水(极致风险偏好)',
      baseScore: 2,
      scoreRange: [0, 4],
      confidence: 'high',
      keySignals: [`A股+${stockChange.toFixed(1)}%`, `国债${bondETFChange.toFixed(2)}%`]
    };
  }

  // 兜底
  return {
    category: '中性博弈',
    baseScore: 25,
    scoreRange: [18, 32],
    confidence: 'low',
    keySignals: ['信号无明显一致性']
  };
}

// ============================================================================
// 基金评分卡 — 市场分之下沉到个基选择（V2 新增）
// F1 收益动量(30) + F2 风险调整(30) + F3 基准相对(25) + F4 成本纪律(15) = 100
// 输入可部分缺失 → 缺失子项不参与，权重按比例重分配
// ============================================================================

/**
 * @param {Object} ctx
 * @param {number} [ctx.annualReturn] - 年化收益(小数)
 * @param {number} [ctx.sharpe] - Sharpe比率
 * @param {number} [ctx.ir] - 信息比率IR
 * @param {number} [ctx.mdd] - 最大回撤(小数, 如-0.15)
 * @param {number} [ctx.upCapture] - 上行捕获率(%)
 * @param {number} [ctx.downCapture] - 下行捕获率(%)
 * @param {string} [ctx.ranking] - 同类排名 'top25'|'25-50'|'50-75'|'bottom25'
 * @param {string} [ctx.verdict] - 标签 BUY/HOLD/WATCH/BLACK
 * @param {number} [ctx.feeRate] - 年费率(%)
 * @param {boolean} [ctx.isShortTerm] - ⚠️短标记
 * @param {number} [ctx.volatility] - 年化波动率(小数)
 * @returns {{baseScore: number, breakdown: Object, overrides: Object|null}}
 */
export function classifyFundScore(ctx = {}) {
  const breakdown = {};
  let totalWeight = 0;
  let totalScore = 0;

  // ── F1 收益动量 Max 30 ──
  if (ctx.annualReturn != null || ctx.ranking != null) {
    const rank = ctx.ranking || '';
    const ret = ctx.annualReturn ?? 0;
    let score;
    if (rank === 'top25' && ret > 0) score = 27;
    else if (rank === 'top25' || (rank === '25-50' && ret > 0)) score = 22;
    else if ((rank === '25-50' || rank === '50-75') && ret > 0) score = 16;
    else if (ret > 0) score = 10;
    else score = 4;
    breakdown.F1 = { score, max: 30, category: rank || (ret > 0 ? '正收益' : '负收益') };
    totalScore += score;
    totalWeight += 30;
  }

  // ── F2 风险调整 Max 30 ──
  if (ctx.sharpe != null || ctx.mdd != null || ctx.volatility != null) {
    const sharpe = ctx.sharpe ?? 0;
    const mdd = ctx.mdd ?? 0;
    let score;
    if (sharpe > 1.0 && mdd > -0.05) score = 28;
    else if (sharpe > 0.8) score = 22;
    else if (sharpe > 0.5) score = 16;
    else if (sharpe > 0) score = 10;
    else score = 4;
    if (mdd < -0.15) score = Math.min(score, 15); // 大回撤上限
    breakdown.F2 = { score, max: 30, category: `Sharpe=${sharpe.toFixed(2)} MDD=${(mdd*100).toFixed(0)}%` };
    totalScore += score;
    totalWeight += 30;
  }

  // ── F3 基准相对 Max 25 ──
  if (ctx.ir != null || ctx.upCapture != null || ctx.downCapture != null) {
    const ir = ctx.ir ?? 0;
    const up = ctx.upCapture ?? 100;
    const down = ctx.downCapture ?? 100;
    let score;
    if (ir > 0.5 && up > 100 && down < 100) score = 23;
    else if (ir > 0.3) score = 18;
    else if (ir > 0) score = 12;
    else score = 5;
    if (down > 120) score = Math.min(score, 10); // 下行捕获过高→上限
    breakdown.F3 = { score, max: 25, category: `IR=${ir.toFixed(2)} 上行${up.toFixed(0)}% 下行${down.toFixed(0)}%` };
    totalScore += score;
    totalWeight += 25;
  }

  // ── F4 成本与纪律 Max 15 ──
  // 此项始终参与（至少 verdict 一定存在）
  {
    let score = 10; // 中性基准
    const tags = [];
    const v = ctx.verdict || '';
    if (v === 'BLACK_LIST') { score = 0; tags.push('BLACK'); }
    else if (v === 'BUY_STRATEGY' || v === 'HOLD_STRATEGY') { score += 3; tags.push(v.split('_')[0]); }
    else if (v === 'WATCH_GRID') { score += 0; tags.push('WATCH'); }
    if (ctx.isShortTerm) { score -= 3; tags.push('⚠️短'); }
    if (ctx.feeRate != null) {
      if (ctx.feeRate < 0.6) { score += 2; tags.push('低费'); }
      else if (ctx.feeRate > 1.5) { score -= 2; tags.push('高费'); }
    }
    score = Math.max(0, Math.min(15, score));
    breakdown.F4 = { score, max: 15, category: tags.join('/') || '普通' };
    totalScore += score;
    totalWeight += 15;
  }

  // ── 汇总：按有效权重归一化到 100 ──
  const finalScore = totalWeight > 0 ? Math.round(totalScore / totalWeight * 100) : 50;

  // BLACK_LIST 全局否决
  if (ctx.verdict === 'BLACK_LIST') {
    return {
      baseScore: Math.min(finalScore, 10),
      breakdown,
      overrides: { blackList: true }
    };
  }

  return {
    baseScore: finalScore,
    breakdown
  };
}

// ============================================================================
// 统一基金分类 — 按真实资产配置比例，非名称关键词
// 优先使用持仓表格用户填写的 stockPct/bondPct/cashPct，
// 降级使用 assetAllocation 对象，
// 最终降级为名称关键词匹配（兼容旧数据）。
// ============================================================================

/**
 * @param {Object} fund — { fundName, fundCode, stockPct, bondPct, cashPct, typeDesc, assetAllocation, ... }
 * @returns {'equity'|'bond'|'cash'|'hybrid'}
 *
 * 判定优先级（四级降级）：
 *   Tier 1: 用户填写的 stockPct/bondPct/cashPct（持仓表格，最准确）
 *   Tier 2: 蛋卷API type_desc（监管分类，"股票型"/"债券型"等）
 *   Tier 3: assetAllocation 对象
 *   Tier 4: 名称关键词（兜底）
 */
export function classifyFundType(fund) {
  // ── Tier 1: 用户填写的百分比 ──
  let stock = parseFloat(fund.stockPct) || 0;
  let bond = parseFloat(fund.bondPct) || 0;
  let cash = parseFloat(fund.cashPct) || 0;

  // ── Tier 2: 蛋卷API type_desc（监管分类，优先于名称）──
  const typeDesc = (fund.typeDesc || fund.type_desc || '').toLowerCase();

  // ── Tier 3: assetAllocation 对象 ──
  if (stock === 0 && bond === 0 && cash === 0 && fund.assetAllocation) {
    stock = parseFloat(fund.assetAllocation.stock) || 0;
    bond = parseFloat(fund.assetAllocation.bond) || 0;
    cash = parseFloat(fund.assetAllocation.cash) || 0;
  }

  // ── 有真实配置数据 → 按比例 ──
  const totalAlloc = stock + bond + cash;
  if (totalAlloc > 0) {
    if (stock > 60) return 'equity';
    if (bond > 60) return 'bond';
    if (cash > 80) return 'cash';
    if (stock >= 40 && stock > bond) return 'equity';
    if (bond >= 40 && bond > stock) return 'bond';
    if (stock >= bond) return 'equity';
    return 'bond';
  }

  // ── 有 type_desc → 按监管分类 ──
  if (typeDesc) {
    if (/货币|现金/.test(typeDesc)) return 'cash';
    if (/债券|纯债|定开债|信用债|利率债/.test(typeDesc) && !/混合|转/.test(typeDesc)) return 'bond';
    if (/偏债/.test(typeDesc)) return 'bond';
    if (/股票|指数|偏股|混合.*偏股|权益/.test(typeDesc)) return 'equity';
    if (/混合/.test(typeDesc)) return 'equity'; // 混合型默认归权益(有股票敞口)
    if (/QDII.*债券|QDII.*债/i.test(typeDesc)) return 'bond';
    if (/QDII/i.test(typeDesc)) return 'equity'; // QDII默认归权益
    if (/FOF/.test(typeDesc)) return 'equity';    // FOF默认归权益
  }

  // ── Tier 4: 名称关键词（兜底）──
  const name = (fund.fundName || fund.name || '').toLowerCase();
  if (/货币|现金管理|货币市场/.test(name)) return 'cash';
  if (/债|bond|fixed.income/.test(name) && !/转/.test(name)) return 'bond';
  return 'equity';
}

// ============================================================================
// 同类内按基金分加权分配 — 替代等权，使 B-L 大类权重精准分配到个基
// ============================================================================

/**
 * @param {Object} classWeights — B-L 输出的最优权重 {fundCode: weight}
 * @param {Object[]} fundScores — [{fundCode, fundName, score: {baseScore, breakdown}}]
 * @param {string[]} blackFunds — BLACK_LIST 基金代码(已强制清零)
 * @returns {Object} — 调整后的 {fundCode: weight}
 */
export function allocateByScore(classWeights, fundScores, blackFunds = []) {
  // 按大类分组（统一使用 classifyFundType，优先资产配置比例）
  const groups = { equity: [], bond: [], cash: [] };
  for (const fs of fundScores) {
    const code = fs.fundCode;
    if (blackFunds.includes(code)) continue;
    const cls = classifyFundType(fs);
    if (!groups[cls]) groups[cls] = [];
    groups[cls].push(code);
  }

  const result = {};
  // BLACK 清零
  for (const bf of blackFunds) result[bf] = 0;

  for (const [cls, codes] of Object.entries(groups)) {
    if (codes.length === 0) continue;
    // 大类总权重
    const classTotal = codes.reduce((s, c) => s + (classWeights[c] || 0), 0);
    if (classTotal <= 0) {
      // 该类无权重 → 等分
      for (const c of codes) result[c] = 0;
      continue;
    }
    // 按基金分加权
    const scoreMap = {};
    for (const c of codes) {
      const fs = fundScores.find(f => f.fundCode === c);
      scoreMap[c] = fs?.score?.baseScore || 50;
    }
    const totalScore = codes.reduce((s, c) => s + scoreMap[c], 0);
    for (const c of codes) {
      result[c] = totalScore > 0 ? classTotal * scoreMap[c] / totalScore : classTotal / codes.length;
    }
  }

  return result;
}
