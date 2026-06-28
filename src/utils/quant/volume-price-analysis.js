// 量价对比分析模块
// 纯客户端计算，不依赖外部API
// 输入：K线数据(含close+volume) + 今日成交额
// 输出：量比、趋势一致性、背离检测、成交额偏离σ

/**
 * 计算量价分析指标
 * @param {Array} bars - K线数组 [{close, volume, date, high, low}]
 * @param {number} todayVolume - 今日成交额(元)
 * @param {number} todayTurnoverYi - 今日成交额(亿)
 * @returns {Object} 量价分析结果
 */
export function calcVolumePriceAnalysis(bars, todayVolume, todayTurnoverYi) {
  if (!bars || bars.length < 5) {
    return {
      signal: '数据不足',
      volumeRatio: null,
      trendConsistency: 'unknown',
      volumeDeviation: null,
      detail: ''
    };
  }

  const closes = bars.map(b => b.close);
  const volumes = bars.map(b => b.volume || 0);
  const lastClose = closes[closes.length - 1];
  const lastVolume = todayVolume || volumes[volumes.length - 1];

  // 1. 量比(VR) = 今日量 / 近5日均量
  const last5Volumes = volumes.slice(-5);
  const avg5Volume = last5Volumes.reduce((a, b) => a + b, 0) / last5Volumes.length;
  const volumeRatio = avg5Volume > 0 ? lastVolume / avg5Volume : 1;

  // 2. 近20日均量偏离σ
  const last20Volumes = volumes.slice(-20);
  const avg20Volume = last20Volumes.length > 0
    ? last20Volumes.reduce((a, b) => a + b, 0) / last20Volumes.length : 0;
  const volumeDeviation = avg20Volume > 0
    ? (lastVolume - avg20Volume) / avg20Volume * 100 : 0;

  // 3. 近5日价格方向 vs 成交量方向
  const last5Closes = closes.slice(-5);
  const priceSlope = last5Closes.length >= 2
    ? (last5Closes[last5Closes.length - 1] - last5Closes[0]) / last5Closes[0] * 100 : 0;
  const volumeSlope = last5Volumes.length >= 2
    ? (last5Volumes[last5Volumes.length - 1] - last5Volumes[0]) / last5Volumes[0] * 100 : 0;

  // 4. 趋势一致性判定
  let trendConsistency = 'neutral';
  let divergence = null;
  if (priceSlope > 0.5 && volumeSlope > 5) {
    trendConsistency = '价涨量增(健康)';
  } else if (priceSlope > 0.5 && volumeSlope < -5) {
    trendConsistency = '价涨量缩(警惕)';
    divergence = '缩量上涨';
  } else if (priceSlope < -0.5 && volumeSlope > 5) {
    trendConsistency = '价跌量增(恐慌)';
    divergence = '放量下跌';
  } else if (priceSlope < -0.5 && volumeSlope < -5) {
    trendConsistency = '价跌量缩(缩量调整)';
  } else {
    trendConsistency = '量价平稳';
  }

  // 5. 成交额偏离20日均值的σ数
  const last20Turnovers = bars.slice(-20).map(b => b.volume || 0);
  const mean = last20Turnovers.length > 0
    ? last20Turnovers.reduce((a, b) => a + b, 0) / last20Turnovers.length : 0;
  const variance = last20Turnovers.length > 1
    ? last20Turnovers.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (last20Turnovers.length - 1) : 0;
  const std = Math.sqrt(variance);
  const sigmaCount = std > 0 ? (lastVolume - mean) / std : 0;

  // 汇总信号
  let signal = 'neutral';
  if (volumeRatio > 2.0 && priceSlope < -1) signal = '放量下跌(危险)';
  else if (volumeRatio > 2.0 && priceSlope > 1) signal = '放量上涨(强势)';
  else if (volumeRatio < 0.5 && priceSlope < -1) signal = '缩量下跌(可能见底)';
  else if (volumeRatio < 0.5 && priceSlope > 1) signal = '缩量上涨(动能不足)';

  const detailLines = [];
  detailLines.push(`量比(VR): ${volumeRatio.toFixed(2)}(今日/近5日均量)`);
  detailLines.push(`成交额偏离20日均值: ${volumeDeviation >= 0 ? '+' : ''}${volumeDeviation.toFixed(1)}% (${sigmaCount.toFixed(2)}σ)`);
  detailLines.push(`近5日量价趋势: ${trendConsistency}${divergence ? ` → ${divergence}` : ''}`);
  if (signal !== 'neutral') detailLines.push(`综合信号: ${signal}`);

  return {
    signal,
    volumeRatio,
    volumeDeviation: volumeDeviation.toFixed(1),
    sigmaCount: sigmaCount.toFixed(2),
    trendConsistency,
    divergence,
    priceSlope: priceSlope.toFixed(2),
    volumeSlope: volumeSlope.toFixed(2),
    detail: detailLines.join(' | ')
  };
}

/**
 * 计算大小盘风格对比
 * @param {Object} largeCap - 沪深300行情 { pct: -3.03, cur: 4868 }
 * @param {Object} midCap  - 中证500行情 { pct: -2.62, cur: 8703 }
 * @param {Object} smallCap - 中证1000行情 { pct: -2.54, cur: 8601 }
 * @param {Object} megaCap - 上证50行情 { pct: -2.37, cur: 2906 }
 * @returns {string} 风格对比分析文本
 */
export function compareStyle(largeCap, midCap, smallCap, megaCap) {
  if (!largeCap) return '';

  const parts = [];

  // 当日涨跌幅对比
  parts.push(`沪深300: ${largeCap.pct >= 0 ? '+' : ''}${largeCap.pct}%`);
  if (megaCap) parts.push(`上证50: ${megaCap.pct >= 0 ? '+' : ''}${megaCap.pct}%`);
  if (midCap) parts.push(`中证500: ${midCap.pct >= 0 ? '+' : ''}${midCap.pct}%`);
  if (smallCap) parts.push(`中证1000: ${smallCap.pct >= 0 ? '+' : ''}${smallCap.pct}%`);

  // 大小盘相对强弱
  let styleSignal = '均衡';
  if (largeCap && midCap) {
    const spread = largeCap.pct - midCap.pct;
    if (spread > 0.5) styleSignal = '大盘明显占优(沪深300跑赢中证500)';
    else if (spread > 0.2) styleSignal = '大盘略占优';
    else if (spread < -0.5) styleSignal = '小盘明显占优(中证500跑赢沪深300)';
    else if (spread < -0.2) styleSignal = '小盘略占优';
  }
  parts.push(`风格: ${styleSignal}`);

  // 沪深300 vs 上证50 (判断大市值内部风格)
  if (largeCap && megaCap) {
    const megaSpread = largeCap.pct - megaCap.pct;
    if (Math.abs(megaSpread) > 0.3) {
      parts.push(`大市值内: ${megaSpread > 0 ? '沪深300更强' : '上证50更强'} (差${Math.abs(megaSpread).toFixed(2)}%)`);
    }
  }

  return `【大小盘风格对比】${parts.join(' | ')}`;
}
