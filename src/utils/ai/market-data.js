// 行情数据抓取模块：腾讯分时图、多周期 K 线数据、东方财富市场情绪指标聚合拉取
import { buildProxyUrl } from './proxy';
import { debugLog } from '../debugLog';

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

    const ctrl = new AbortController();
	    const timer = setTimeout(() => ctrl.abort(), 10000);
	    const res = await fetch(fetchUrl, { cache: "no-store", signal: ctrl.signal }).finally(() => clearTimeout(timer));
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

// 多周期 K 线轨迹提取器：收盘价序列+极值区间+预计算均线，注入 AI 上下文
// 均线配置: { period: 均线周期, label: 标签 }，如 [{period:20, label:'20MA'}, {period:60, label:'60MA'}]
export const fetchMultiPeriodKLines = async (code, period = 'day', count = 20, settings, maConfig = null) => {
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
    const closePrices = [];

    dayData.forEach(day => {
      const high = parseFloat(day[3]);
      const low = parseFloat(day[4]);
      if (high > maxVal) maxVal = high;
      if (low < minVal) minVal = low;

      const dateStr = day[0].substring(5);
      const closePrice = parseFloat(day[2]);
      keyPoints.push({ date: dateStr, price: closePrice });
      closePrices.push(closePrice);
    });

    // 预计算均线
    let maString = "";
    if (maConfig && Array.isArray(maConfig) && closePrices.length > 0) {
      const maParts = [];
      for (const cfg of maConfig) {
        const n = cfg.period;
        if (closePrices.length >= n) {
          const slice = closePrices.slice(-n);
          const sum = slice.reduce((a, b) => a + b, 0);
          const ma = sum / n;
          const lastClose = closePrices[closePrices.length - 1];
          const deviation = lastClose > 0 ? ((lastClose - ma) / ma * 100).toFixed(2) : '?';
          const bias = parseFloat(deviation) > 0 ? `↑+${deviation}%` : parseFloat(deviation) < 0 ? `↓${deviation}%` : '→0%';
          maParts.push(`${cfg.label}: ${ma.toFixed(2)} (现价偏离 ${bias})`);
        } else {
          maParts.push(`${cfg.label}: 数据不足(需${n}根,仅${closePrices.length}根)`);
        }
      }
      if (maParts.length > 0) maString = ` | ${maParts.join(' | ')}`;
    }

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
    return `\n   📅 ${labelMap[period]}: 区间[${minVal.toFixed(2)} ~ ${maxVal.toFixed(2)}]${maString} | 完整走势: ${trendString}`;
  } catch (e) {
    console.warn(`[多周期探针] 获取 ${code} 的 ${period} K线失败:`, e);
    return "";
  }
};

// 全息盘口探针：腾讯量价 + 多周期共振 + 东财情绪
// depth='full' → 完整探针(含分时/多周期K线), depth='summary' → 仅核心行情摘要(零额外fetch)
export const fetchAdvancedMarketData = async (settings, depth = 'full') => {
  let marketDataStr = "核心宽基走势: 未知";
  let totalTurnoverYi = 0;
  let upCount = 0;
  let downCount = 0;

  // =========================================================================
  // 动作 1：获取全市场涨跌家数 (东财) — 二级简洁策略
  // 策略 1 (优先)：JSONP 原生绕过 → 浏览器直连东财，零代理依赖，延迟最低
  // 策略 2 (降级)：旧版可靠路径 → 自定义代理 或 allorigins.win/get（重构前已验证稳定）
  // =========================================================================
  {
    const emUrl = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001,0.399001&fields=f104,f105,f106';
    let actualEmData = null;

    // 策略 1：JSONP 脚本注入（优先：直连最快，完全不受代理故障影响）
    // 关键修复：移除 referrerPolicy='no-referrer'，让浏览器发送正常 Referer
    // 避免 Sec-Fetch-Dest:script + 无 Referer 的组合被 Cloudflare 标记为 JSONP 劫持
    try {
      debugLog('🔍 [情绪探针-1] 尝试 JSONP 原生绕过...');
      const jsonpResult = await new Promise((resolve, reject) => {
        const callbackName = `jQuery${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        const script = document.createElement('script');
        const timer = setTimeout(() => {
          script.remove();
          delete window[callbackName];
          reject(new Error('JSONP 超时 (8s)'));
        }, 8000);

        window[callbackName] = (data) => {
          clearTimeout(timer);
          script.remove();
          delete window[callbackName];
          resolve(data);
        };
        script.onerror = () => {
          clearTimeout(timer);
          script.remove();
          delete window[callbackName];
          reject(new Error('JSONP 脚本加载失败'));
        };
        script.src = `${emUrl}&cb=${callbackName}&_=${Date.now()}`;
        document.head.appendChild(script);
      });
      if (jsonpResult?.data?.diff) {
        actualEmData = jsonpResult;
        debugLog('✅ [情绪探针-1] JSONP 成功');
      }
    } catch (e) {
      console.warn('⚠️ [情绪探针-1] JSONP 失败:', e.message);
    }

    // 策略 2：旧版可靠路径 —— 自定义代理 或 allorigins.win/get
    // 这是重构前已验证稳定的方案，allorigins.win/get 兼容性最好
    if (!actualEmData) {
      try {
        let emFetchUrl;
        if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
          emFetchUrl = buildProxyUrl(settings, emUrl);
          debugLog('🔍 [情绪探针-2] 尝试自定义代理...');
        } else {
          emFetchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(emUrl)}`;
          debugLog('🔍 [情绪探针-2] 尝试 allorigins.win/get...');
        }

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        const emRes = await fetch(emFetchUrl, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(timer);

        if (!emRes.ok) throw new Error(`HTTP ${emRes.status}`);

        const rawText = await emRes.text();
        if (!rawText) throw new Error('空响应');

        let emData;
        try { emData = JSON.parse(rawText); } catch (e) {
          throw new Error('非有效 JSON');
        }

        if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
          actualEmData = emData;
        } else if (emData.contents) {
          try {
            actualEmData = typeof emData.contents === 'string' ? JSON.parse(emData.contents) : emData.contents;
          } catch (e) { /* ignore */ }
        }

        if (actualEmData?.data?.diff) {
          debugLog('✅ [情绪探针-2] 代理路径成功');
        }
      } catch (e) {
        console.warn('⚠️ [情绪探针-2] 代理路径失败:', e.message);
      }
    }

    // 解析最终结果
    if (actualEmData?.data?.diff && Array.isArray(actualEmData.data.diff)) {
      actualEmData.data.diff.forEach((market) => {
        upCount += market.f104 || 0;
        downCount += market.f105 || 0;
      });
      debugLog(`📊 [情绪探针] 涨跌家数获取成功: ↑${upCount} / ↓${downCount}`);
    } else if (!actualEmData) {
      console.warn('❌ [情绪探针] 全部策略均失败，涨跌比数据暂不可用。请检查网络或代理配置。');
    } else {
      console.warn('⚠️ [情绪探针] 数据返回但缺少 diff 结构，实际 keys:', Object.keys(actualEmData).join(', '));
    }
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

      const infos = [];

      for (const asset of parsedAssets) {
        const { name, code, cur, prevClose, open, high, low, pct } = asset;
        const amp = prevClose > 0 ? ((high - low) / prevClose * 100) : 0;
        // 定量K线解剖：实体+影线占比，AI自行判定形态
        const barType = cur >= open ? '阳' : '阴';
        const entityPct = open > 0 ? ((cur - open) / open * 100) : 0;
        const upperShadowPct = open > 0 ? ((high - Math.max(open, cur)) / open * 100) : 0;
        const lowerShadowPct = open > 0 ? ((Math.min(open, cur) - low) / open * 100) : 0;
        const entityAbs = Math.abs(entityPct);
        let shape = `${barType}线 实体${entityAbs.toFixed(1)}% 上影${upperShadowPct.toFixed(1)}% 下影${lowerShadowPct.toFixed(1)}%`;
        if (entityAbs < 0.2) shape = `十字星 ` + shape;
        if (upperShadowPct > entityAbs * 1.5 && upperShadowPct > 1) shape += ` (长上影)`;
        if (lowerShadowPct > entityAbs * 1.5 && lowerShadowPct > 1) shape += ` (长下影)`;


        if (depth === 'summary') {
          // 摘要模式：仅注入价格涨跌幅，零额外 HTTP
          infos.push(`${name}: ${cur} (${pct >= 0 ? '+' : ''}${pct}%)`);
        } else {
          // radar / full 模式：注入分时路径 + K 线
          let intradayPathDesc = '';
          let dailyKLineDesc = '';
          const targetCodes = ['000001', '399001', '399006', '511260', '511090'];

          if (targetCodes.includes(code)) {
            const prefix = (code === '000001' || code.startsWith('5')) ? 'sh' : 'sz';
            const ifzqCode = prefix + code;

            // 分时路径：所有非 summary 模式都必须拉取
            const pathStr = await fetchIntradayTrend(ifzqCode, settings);
            if (pathStr) intradayPathDesc = `\n   📍 日内分时: ${pathStr}`;

            // 日K（60根含 20MA/60MA）：radar 和 full 都拉
            const dailyStr = await fetchMultiPeriodKLines(ifzqCode, 'day', 60, settings, [{period:20, label:'20MA'}, {period:60, label:'60MA'}]);
            dailyKLineDesc = dailyStr || '';

            // 周K + 月K：仅 full 模式拉取（radar 跳过以节省 ~10 次 HTTP）
            if (depth === 'full') {
              const weeklyStr = await fetchMultiPeriodKLines(ifzqCode, 'week', 20, settings, [{period:20, label:'20周MA'}]);
              const monthlyStr = await fetchMultiPeriodKLines(ifzqCode, 'month', 12, settings);
              if (weeklyStr || monthlyStr) dailyKLineDesc += `${weeklyStr}${monthlyStr}`;
            }
          }

          infos.push(`- ${name}: ${cur} (${pct > 0 ? '+' : ''}${pct}%) | 振幅: ${amp.toFixed(2)}% | 形态: ${shape}${intradayPathDesc}${dailyKLineDesc}`);
        }
      }

      let breadthStatus = "多空平衡/分化";
      if (upCount > downCount * 2) breadthStatus = "情绪高昂/普涨";
      else if (downCount > upCount * 2) breadthStatus = "情绪冰点/普跌";

      const breadthStr = (upCount > 0 || downCount > 0)
        ? `\n👉 【市场真实情绪】两市上涨 ${upCount} 家 / 下跌 ${downCount} 家 (${breadthStatus})`
        : `\n👉 【市场真实情绪】暂无盘口数据 (休市或数据获取中)`;

      if (depth === 'summary') {
        const header = '【今日大盘行情摘要】';
        const turnover = `沪深成交: ${totalTurnoverYi.toFixed(2)}亿`;
        const breadth = `上涨: ${upCount}家 / 下跌: ${downCount}家`;
        marketDataStr = `${header}\n${turnover} | ${breadth}\n${infos.join(' | ')}`;
      } else {
        marketDataStr = `👉 【沪深两市总成交额】约 ${totalTurnoverYi.toFixed(2)} 亿元${breadthStr}\n【核心资产多因子量价走势验证】\n${infos.join('\n')}`;
      }
    }
  } catch (e) {
    console.error(`❌ [量价探针] 腾讯接口致命崩溃:`, e);
  }

  const dHeader = depth === 'summary' ? `\n【今日大盘行情摘要】\n` : `\n【今日大盘全息盘口与资金面 (已过滤噪音)】\n`;
  return `${dHeader}${marketDataStr}\n`;
};
