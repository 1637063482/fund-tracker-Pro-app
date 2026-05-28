// 行情数据抓取模块：腾讯分时、多周期 K 线、东财情绪聚合
import { buildProxyUrl } from './proxy';

// 格式化现金流数据
export const formatCashFlows = (transactions) => {
  if (!transactions || transactions.length === 0) return "无交易记录";
  const sorted = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  return sorted.map(t => {
    let action = '操作';
    if (t.type === 'buy') action = '买入建仓/加仓';
    if (t.type === 'sell') action = '卖出提现/减仓';
    if (t.type === 'dividend_cash') action = '现金分红';
    if (t.type === 'dividend_reinvest') action = '红利再投';
    if (t.type === 'fee') action = '扣除手续费';
    return `- ${t.date}：${action} ${t.amountRaw} 元`;
  }).join('\n');
};

// 分时路径压缩器：M15 采样 + 自适应波动阈值
export const fetchIntradayTrend = async (code, settings) => {
  try {
    const url = `https://ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`;
    const fetchUrl = buildProxyUrl(settings, url);

    const res = await fetch(fetchUrl, { cache: 'no-store' });
    const resData = await res.json();

    const minuteData = resData?.data?.[code]?.data?.data;
    if (!minuteData || !Array.isArray(minuteData) || minuteData.length === 0) return "分时暂无";

    const keyPoints = [];
    let lastAddedTime = "";

    minuteData.forEach((item, index) => {
      const [timeStr, priceStr] = item.split(' ');
      const minute = parseInt(timeStr.substring(2, 4));
      const price = parseFloat(priceStr);

      if (minute % 15 === 0) {
        keyPoints.push({ time: `${timeStr.substring(0, 2)}:${timeStr.substring(2)}`, price });
        lastAddedTime = timeStr;
      }
      if (index === minuteData.length - 1 && timeStr !== lastAddedTime) {
        keyPoints.push({ time: `${timeStr.substring(0, 2)}:${timeStr.substring(2)}(最新)`, price });
      }
    });

    let trendString = "";
    for (let i = 0; i < keyPoints.length; i++) {
      const current = keyPoints[i];
      if (i === 0) {
        trendString += `${current.time}[${current.price}]`;
      } else {
        const prev = keyPoints[i - 1];
        const diff = current.price - prev.price;
        const threshold = current.price > 1000 ? 0.5 : 0.02;
        let icon = '→';
        if (diff > threshold) icon = '↗';
        else if (diff < -threshold) icon = '↘';
        else icon = '→';
        trendString += ` ${icon} ${current.time}[${current.price}]`;
      }
    }

    return trendString;
  } catch (e) {
    console.warn(`[分时探针] 获取 ${code} 分时失败:`, e);
    return "分时数据抓取失败";
  }
};

// 多周期 K 线轨迹提取器
export const fetchMultiPeriodKLines = async (code, period = 'day', count = 20, settings) => {
  try {
    const url = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},${period},,,${count},`;
    const fetchUrl = buildProxyUrl(settings, url);

    const res = await fetch(fetchUrl, { cache: 'no-store' });
    const resData = await res.json();

    const dayData = resData?.data?.[code]?.[period] || resData?.data?.[code]?.[`qfq${period}`];

    if (!dayData || !Array.isArray(dayData) || dayData.length === 0) {
      console.warn(`[多周期探针] ${code} 的 ${period} K线数据为空`);
      return "";
    }

    let maxVal = -Infinity;
    let minVal = Infinity;
    const keyPoints = [];

    dayData.forEach(day => {
      const high = parseFloat(day[3]);
      const low = parseFloat(day[4]);
      if (high > maxVal) maxVal = high;
      if (low < minVal) minVal = low;

      const dateStr = day[0].substring(5);
      const closePrice = parseFloat(day[2]);
      keyPoints.push({ date: dateStr, price: closePrice });
    });

    let trendString = "";
    for (let i = 0; i < keyPoints.length; i++) {
      const current = keyPoints[i];
      if (i === 0) {
        trendString += `${current.date}[${current.price}]`;
      } else {
        const prev = keyPoints[i - 1];
        const diff = current.price - prev.price;
        const threshold = current.price > 1000 ? (period === 'day' ? 5 : 20) : 0.1;
        let icon = '→';
        if (diff > threshold) icon = '↗';
        else if (diff < -threshold) icon = '↘';
        else icon = '→';
        trendString += ` ${icon} ${current.date}[${current.price}]`;
      }
    }

    const labelMap = { 'day': '日K线(季波动)', 'week': '周K线(中线中枢)', 'month': '月K线(牛熊大周期)' };
    return `\n   📅 ${labelMap[period]}: 区间[${minVal.toFixed(2)} ~ ${maxVal.toFixed(2)}] | 完整走势: ${trendString}`;
  } catch (e) {
    console.warn(`[多周期探针] 获取 ${code} 的 ${period} K线失败:`, e);
    return "";
  }
};

// 全息盘口探针：腾讯量价 + 多周期共振 + 东财情绪
export const fetchAdvancedMarketData = async (settings) => {
  let marketDataStr = "核心宽基走势: 未知";
  let totalTurnoverYi = 0;
  let upCount = 0;
  let downCount = 0;

  // 动作 1：获取全市场涨跌家数 (东财)
  try {
    const emUrl = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001,0.399001&fields=f104,f105,f106';
    let emFetchUrl = buildProxyUrl(settings, emUrl);
    if (settings.proxyMode !== 'custom' || !settings.customProxyUrl) {
      emFetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(emUrl)}`;
    }

    console.log(`🌍 [情绪探针] 正在请求东财批量数据，代理模式: ${settings.proxyMode}`);
    const emRes = await fetch(emFetchUrl, { cache: 'no-store' });
    if (!emRes.ok) throw new Error(`HTTP ${emRes.status}`);

    const rawText = await emRes.text();
    if (!rawText) throw new Error("空响应");

    let emData;
    try { emData = JSON.parse(rawText); } catch (e) {
      console.error("🚨 [情绪探针] JSON 解析失败！原始内容为:", rawText.substring(0, 200) + "...");
      throw new Error("非有效 JSON");
    }

    let actualEmData = null;
    if (settings.proxyMode === 'custom') {
      actualEmData = emData;
    } else if (emData.contents) {
      try {
        actualEmData = typeof emData.contents === 'string' ? JSON.parse(emData.contents) : emData.contents;
      } catch (e) { /* ignore */ }
    }

    console.log("%c🔍 [深度探针] 东财批量接口原始返回结构:", "color: #eab308; font-weight: bold;");
    console.dir(actualEmData);

    if (actualEmData?.data?.diff && Array.isArray(actualEmData.data.diff)) {
      actualEmData.data.diff.forEach((market, index) => {
        const up = market.f104 || 0;
        const down = market.f105 || 0;
        upCount += up;
        downCount += down;
        console.log(`   └─ 细分市场 ${index + 1} 探针: 涨 ${up}, 跌 ${down}`);
      });
      console.log(`✅ [情绪探针] 成功获取两市聚合数据: 总计上涨 ${upCount} 家, 下跌 ${downCount} 家`);
    } else {
      console.warn("⚠️ [情绪探针] 请求成功，但未找到有效的 diff 数组结构。");
    }
  } catch (e) {
    console.error("❌ [情绪探针] 抓取失败:", e.message);
  }

  // 动作 2：抓取核心宽基量价形态 + 异步多周期探针
  try {
    const queryStr = 'sh000001,sz399001,sz399006,sh511260,sh511090';
    const tencentUrl = `https://qt.gtimg.cn/q=${queryStr}`;

    const res = await fetch(tencentUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`腾讯接口 HTTP ${res.status}`);

    const buffer = await res.arrayBuffer();
    const decoder = new TextDecoder('gbk');
    const rawText = decoder.decode(buffer);

    if (rawText && rawText.includes('v_')) {
      const lines = rawText.split(';').filter(line => line.trim().length > 0);
      const parsedAssets = [];

      lines.forEach(line => {
        const dataArr = line.substring(line.indexOf('="') + 2, line.length - 1).split('~');
        if (dataArr.length < 40) return;

        const name = dataArr[1];
        const code = dataArr[2];
        const cur = parseFloat(dataArr[3]);
        const prevClose = parseFloat(dataArr[4]);
        const open = parseFloat(dataArr[5]);
        const high = parseFloat(dataArr[33]);
        const low = parseFloat(dataArr[34]);
        const amountWan = parseFloat(dataArr[37]);
        const pct = parseFloat(dataArr[32]);

        if (code === '000001' || code === '399001') {
          totalTurnoverYi += (amountWan / 10000);
        }
        parsedAssets.push({ name, code, cur, prevClose, open, high, low, pct, amountWan });
      });

      const isHighVolume = totalTurnoverYi > 9500;
      const isLowVolume = totalTurnoverYi > 0 && totalTurnoverYi < 6500;

      const infos = [];

      for (const asset of parsedAssets) {
        const { name, code, cur, prevClose, open, high, low, pct } = asset;
        let shape = "〰️ 窄幅震荡";
        let volumeConfirmation = "";
        const amp = prevClose > 0 ? ((high - low) / prevClose * 100) : 0;

        // 粗略形态判断
        if (amp > 0.6) {
          const isRed = cur >= open;
          const isGreen = cur < open;
          const maxUpPct = (high - prevClose) / prevClose * 100;
          const maxDownPct = (prevClose - low) / prevClose * 100;
          const curPct = (cur - prevClose) / prevClose * 100;

          if (isRed && maxDownPct < 0.3 && (high - cur) / prevClose * 100 < 0.3 && curPct > 0.5) shape = "📈 强势单边上行 (逼空)";
          else if (isGreen && maxUpPct < 0.3 && (cur - low) / prevClose * 100 < 0.3 && curPct < -0.5) shape = "📉 弱势单边下杀 (光脚)";
          else if (maxUpPct > 0.8 && (high - cur) / prevClose * 100 > maxUpPct * 0.5) shape = cur < prevClose ? "🚨 冲高跳水大回落" : "⚠️ 冲高回落留长上影";
          else if (maxDownPct > 0.8 && (cur - low) / prevClose * 100 > maxDownPct * 0.6) shape = cur > prevClose ? "🚀 探底回升深V反转" : "🛡️ 探底回升留长下影";
          else if (amp > 1.5) shape = "⚖️ 宽幅震荡洗盘";
          else if (isRed && cur > prevClose) shape = "↗️ 震荡攀升";
          else if (isGreen && cur < prevClose) shape = "↘️ 震荡走弱";
        }

        if (asset.code !== '511260' && asset.code !== '511090') {
          if (shape.includes("上行") || shape.includes("攀升")) {
            if (isLowVolume) volumeConfirmation = " [⚠️量价背离: 缩量无支持，警惕诱多]";
            else if (isHighVolume) volumeConfirmation = " [🔥量价齐升: 增量资金抢筹，趋势可靠]";
          } else if (shape.includes("下杀") || shape.includes("走弱")) {
            if (isHighVolume) volumeConfirmation = " [🩸放量暴跌: 恐慌盘疯狂涌出，切勿接飞刀]";
            else if (isLowVolume) volumeConfirmation = " [🧊缩量阴跌: 流动性枯竭，钝刀割肉]";
          } else if (shape.includes("深V") || shape.includes("探底")) {
            if (isHighVolume) volumeConfirmation = " [💎底部爆量: 机构资金强力承接，黄金坑确立]";
            else if (isLowVolume) volumeConfirmation = " [❓无量反抽: 跌停板自救/散户跟风，谨慎追高]";
          } else if (shape.includes("跳水") || shape.includes("回落")) {
            if (isHighVolume) volumeConfirmation = " [💣高位放量滞涨: 主力借机出逃]";
          }
        }

        // 异步注入分时 + 多周期 K 线
        let intradayPathDesc = "";
        let dailyKLineDesc = "";
        const targetCodes = ['000001', '399001', '399006', '511260', '511090'];

        if (targetCodes.includes(code)) {
          const prefix = (code === '000001' || code.startsWith('5')) ? 'sh' : 'sz';
          const ifzqCode = prefix + code;

          const pathStr = await fetchIntradayTrend(ifzqCode, settings);
          if (pathStr) intradayPathDesc = `\n   📍 日内分时: ${pathStr}`;

          const dailyStr = await fetchMultiPeriodKLines(ifzqCode, 'day', 60, settings);
          const weeklyStr = await fetchMultiPeriodKLines(ifzqCode, 'week', 20, settings);
          const monthlyStr = await fetchMultiPeriodKLines(ifzqCode, 'month', 12, settings);

          if (dailyStr || weeklyStr || monthlyStr) {
            dailyKLineDesc = `${dailyStr}${weeklyStr}${monthlyStr}`;
          }
        }

        infos.push(`- ${name}: ${cur} (${pct > 0 ? '+' : ''}${pct}%) | 振幅: ${amp.toFixed(2)}% | 粗略形态: ${shape}${volumeConfirmation}${intradayPathDesc}${dailyKLineDesc}`);
      }

      let volumeStatus = "缩量/平量博弈态";
      if (isHighVolume) volumeStatus = "🔥 放量过万亿 (场外增量资金入场，交投极度活跃)";
      else if (isLowVolume) volumeStatus = "🧊 极度缩量地量 (流动性枯竭，存量资金残杀)";

      let breadthStatus = "多空平衡/分化";
      if (upCount > downCount * 2) breadthStatus = "🔥 情绪高昂/普涨 (赚钱效应极佳)";
      else if (downCount > upCount * 2) breadthStatus = "🧊 情绪冰点/普跌 (吸血效应显著，极度悲观)";

      const breadthStr = (upCount > 0 || downCount > 0)
        ? `\n👉 【市场真实情绪】两市上涨 ${upCount} 家 / 下跌 ${downCount} 家 (${breadthStatus})`
        : `\n👉 【市场真实情绪】暂无盘口数据 (休市或数据获取中)`;

      marketDataStr = `👉 【沪深两市总成交额】约 ${totalTurnoverYi.toFixed(2)} 亿元 (${volumeStatus})${breadthStr}\n【核心资产多因子量价走势验证】\n${infos.join('\n')}`;
    }
  } catch (e) {
    console.error(`❌ [量价探针] 腾讯接口致命崩溃:`, e);
  }

  return `\n【今日大盘全息盘口与资金面 (已过滤噪音)】\n${marketDataStr}\n`;
};
