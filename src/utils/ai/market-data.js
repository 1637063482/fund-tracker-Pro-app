// 行情数据抓取模块：腾讯分时图、多周期 K 线数据、东方财富市场情绪指标聚合拉取
import { buildProxyUrl, buildAllOriginsUrl, rateLimitedFetch } from './proxy';
import { debugLog } from '../debugLog';
import { calcVRAndIntercept } from '../quant/scoring-tree';
import { logVRCalc } from '../quant/quantLogger';
import { calcVolumePriceAnalysis, compareStyle } from '../quant/volume-price-analysis';
import { fetchNorthboundData, fetchBondYields, fetchMacroData, fetchMarketConcentration } from './data-fetcher';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

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
    const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, url) : buildAllOriginsUrl(url);

    const ctrl = new AbortController();
	    const timer = setTimeout(() => ctrl.abort(), 10000);
	    const res = await fetch(fetchUrl, { cache: "no-store", signal: ctrl.signal }).finally(() => clearTimeout(timer));
    const resData = await res.json();

    const minuteData = resData?.data?.[code]?.data?.data;
    if (!minuteData || !Array.isArray(minuteData) || minuteData.length === 0) return "分时暂无";

    const keyPoints = [];
    let lastAddedTime = "";
    let lastAddedPrice = null;

    minuteData.forEach((item, index) => {
      const [timeStr, priceStr] = item.split(' ');
      const minute = parseInt(timeStr.substring(2, 4));
      const price = parseFloat(priceStr);

      // M5采样 + 跳过连续平稳段(变动<阈值不重复记录)
      if (minute % 5 === 0) {
        if (lastAddedPrice !== null && index < minuteData.length - 1) {
          const threshold = price > 1000 ? 0.3 : 0.01;
          if (Math.abs(price - lastAddedPrice) < threshold) return;
        }
        keyPoints.push({ time: `${timeStr.substring(0, 2)}:${timeStr.substring(2)}`, price });
        lastAddedTime = timeStr;
        lastAddedPrice = price;
      }
      // 最新价始终追加
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
    const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, url) : buildAllOriginsUrl(url);

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

    // 趋势线压缩：最多显示60根，减少上下文占用
    const maxDisplay = 60;
    const displayPoints = keyPoints.length > maxDisplay ? keyPoints.slice(-maxDisplay) : keyPoints;
    let trendString = "";
    let skipped = keyPoints.length > maxDisplay ? keyPoints.length - maxDisplay : 0;
    if (skipped > 0) trendString += `(前${skipped}根略)... `;
    for (let i = 0; i < displayPoints.length; i++) {
      const current = displayPoints[i];
      if (i === 0) {
        trendString += `${current.date}[${current.price}]`;
      } else {
        const prev = displayPoints[i - 1];
        const diff = current.price - prev.price;
        const threshold = current.price > 1000 ? (period === 'day' ? 5 : 20) : 0.1;
        let icon = '→';
        if (diff > threshold) icon = '↗';
        else if (diff < -threshold) icon = '↘';
        else icon = '→';
        trendString += ` ${icon} ${current.date}[${current.price}]`;
      }
    }

    const labelMap = { 'day': '日K线', 'week': '周K线', 'month': '月K线' };
    return `\n   📅 ${labelMap[period]}: ${closePrices.length}根 区间[${minVal.toFixed(2)} ~ ${maxVal.toFixed(2)}]${maString} | ${trendString}`;
  } catch (e) {
    console.warn(`[多周期探针] 获取 ${code} 的 ${period} K线失败:`, e);
    return "";
  }
};

// 全息盘口探针：腾讯量价 + 多周期共振 + 东财情绪
// depth='full' → 完整探针(含分时/多周期K线), depth='summary' → 仅核心行情摘要(零额外fetch)
export const fetchAdvancedMarketData = async (settings, depth = 'full', microstructureSignal = '⚪ neutral', firestoreContext = null) => {
  let marketDataStr = "核心宽基走势: 未知";
  let totalTurnoverYi = 0;
  let upCount = 0;
  let downCount = 0;

  // =========================================================================
  // 动作 1：获取全市场涨跌家数 (东财) — 四级容灾策略（JSONP 优先）
  //
  // 策略 1 (优先)：JSONP 脚本注入 → 浏览器直连东财（零前置连接，WAF 不会因前后行为不一致误判）
  //               关键：SW fetch 等前置请求会改变浏览器与东财的 HTTP/2 连接状态，
  //               让后续 JSONP 被 WAF 标记为可疑。因此 JSONP 必须跑在第一位。
  // 策略 2 (降级)：用户自有 CF Worker → 东财 API，与 my-cors-proxy.js 同源，零 Referer
  // 策略 3 (备用)：Service Worker 原生代理 → 浏览器直连东财（Referer 已置空，与 CF Worker 一致）
  // 策略 4 (兜底)：多公共代理轮询 → allorigins/get → codetabs → corsproxy.io
  // =========================================================================
  {
    const emUrl = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001,0.399001&fields=f104,f105,f106';
    let actualEmData = null;

    // 策略 1：JSONP 脚本注入（快速尝试，短超时）
    // 东财对该端点的 JSONP 请求间歇性返回 ERR_EMPTY_RESPONSE
    // 成功时瞬时完成，失败时也是立即 TCP RST——不需长超时
    if (!actualEmData) {
      try {
        debugLog('🔍 [情绪探针-1] 尝试 JSONP 原生绕过...');
        const jsonpResult = await new Promise((resolve, reject) => {
          const callbackName = `jQuery${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
          const script = document.createElement('script');
          const timer = setTimeout(() => {
            script.remove();
            delete window[callbackName];
            reject(new Error('JSONP 超时 (3s)'));
          }, 3000);

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
        debugLog(`⏱️ [情绪探针-1] JSONP 失败: ${e.message}`);
      }
    }

    // 策略 2：corsproxy.io（实测唯一稳定可达路径）
    // corsproxy.io 用自家服务器 IP 请求 push2.eastmoney.com，东财放行
    if (!actualEmData) {
      try {
        debugLog('🔍 [情绪探针-2] 尝试 corsproxy.io...');
        const cpUrl = `https://corsproxy.io/?${encodeURIComponent(emUrl)}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const cpRes = await fetch(cpUrl, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(timer);

        if (cpRes.ok) {
          const cpData = await cpRes.json();
          if (cpData?.data?.diff) {
            actualEmData = cpData;
            debugLog('✅ [情绪探针-2] corsproxy.io 成功');
          }
        }
      } catch (e) {
        console.warn('⚠️ [情绪探针-2] corsproxy.io 失败:', e.message);
      }
    }

    // 策略 3：SW 原生代理 / CF Worker / allorigins / codetabs 兜底
    if (!actualEmData && settings.proxyMode === 'custom' && settings.customProxyUrl) {
      try {
        debugLog('🔍 [情绪探针-3] 尝试 CF Worker 代理...');
        const cfFetchUrl = buildProxyUrl(settings, emUrl);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const emRes = await rateLimitedFetch(cfFetchUrl, { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(timer);

        if (emRes.ok) {
          const emData = await emRes.json();
          if (emData?.data?.diff) {
            actualEmData = emData;
            debugLog('✅ [情绪探针-3] CF Worker 代理成功');
          }
        } else {
          debugLog(`⚠️ [情绪探针-3] CF Worker 返回 HTTP ${emRes.status}`);
        }
      } catch (e) {
        console.warn('⚠️ [情绪探针-3] CF Worker 代理失败:', e.message);
      }
    }

    // 策略 4：SW 代理 + allorigins/codetabs 兜底
    if (!actualEmData) {
      const fallbackProxies = [
        { url: `/api/em-proxy?url=${encodeURIComponent(emUrl)}`, label: 'sw-proxy', isFetch: true },
        { url: `https://api.allorigins.win/get?url=${encodeURIComponent(emUrl)}`, label: 'allorigins-get' },
        { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(emUrl)}`, label: 'codetabs' },
      ];

      for (const { url: fetchUrl, label, isFetch } of fallbackProxies) {
        try {
          debugLog(`🔍 [情绪探针-4] 尝试 ${label}...`);
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), isFetch ? 8000 : 12000);
          const emRes = await fetch(fetchUrl, { cache: 'no-store', signal: ctrl.signal });
          clearTimeout(timer);

          if (!emRes.ok) throw new Error(`HTTP ${emRes.status}`);

          const rawText = await emRes.text();
          if (!rawText) throw new Error('空响应');

          let emData;
          try {
            const parsed = JSON.parse(rawText);
            if (parsed?.data?.diff) {
              actualEmData = parsed;
            } else if (parsed.contents) {
              emData = typeof parsed.contents === 'string' ? JSON.parse(parsed.contents) : parsed.contents;
              actualEmData = emData;
            }
          } catch (e) { throw new Error('非有效 JSON'); }

          if (actualEmData?.data?.diff) {
            debugLog(`✅ [情绪探针-4] ${label} 成功`);
            break;
          } else {
            actualEmData = null;
          }
        } catch (e) {
          console.warn(`⚠️ [情绪探针-4] ${label} 失败:`, e.message);
        }
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
    const queryStr = 'sh000001,sz399001,sz399006,sh000300,sh000905,sh000852,sh000016,sh511260,sh511090';
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
            const prefix = (code.startsWith('00') || code.startsWith('5') || code.startsWith('68') || code.startsWith('01')) ? 'sh' : 'sz';
            const ifzqCode = prefix + code;

            // 分时路径：跳过国债ETF（波动小，日内分时意义不大）
            if (code !== '511260' && code !== '511090') {
              const pathStr = await fetchIntradayTrend(ifzqCode, settings);
              if (pathStr) intradayPathDesc = `\n   📍 日内分时: ${pathStr}`;
            }

            // 日K（120根含 5MA/10MA/20MA/60MA/120MA）：radar 和 full 都拉
            const dailyStr = await fetchMultiPeriodKLines(ifzqCode, 'day', 120, settings, [
              {period:5, label:'5MA'}, {period:10, label:'10MA'}, {period:20, label:'20MA'},
              {period:60, label:'60MA'}, {period:120, label:'120MA'}
            ]);
            dailyKLineDesc = dailyStr || '';

            // 周K + 月K：仅 full 模式拉取（radar 跳过以节省 ~10 次 HTTP）
            if (depth === 'full') {
              const weeklyStr = await fetchMultiPeriodKLines(ifzqCode, 'week', 30, settings, [
                {period:5, label:'5周MA'}, {period:10, label:'10周MA'}, {period:20, label:'20周MA'}
              ]);
              const monthlyStr = await fetchMultiPeriodKLines(ifzqCode, 'month', 12, settings);
              if (weeklyStr || monthlyStr) dailyKLineDesc += `${weeklyStr}${monthlyStr}`;
            }
          }

          infos.push(`- ${name}: ${cur} (${pct > 0 ? '+' : ''}${pct}%) | 振幅: ${amp.toFixed(2)}% | 形态: ${shape}${intradayPathDesc}${dailyKLineDesc}`);
        }
      }

      const breadthRatio = downCount > 0 ? (upCount / downCount).toFixed(1) : (upCount > 0 ? '∞' : '—');

      const breadthStr = (upCount > 0 || downCount > 0)
        ? `\n👉 【涨跌家数】上涨 ${upCount} 家 / 下跌 ${downCount} 家 (涨跌比 ${breadthRatio})`
        : `\n👉 【涨跌家数】暂无盘口数据 (休市或数据获取中)`;

      if (depth === 'summary') {
        const header = '【今日大盘行情摘要】';
        const turnover = `沪深成交: ${totalTurnoverYi.toFixed(2)}亿`;
        const breadth = `上涨: ${upCount}家 / 下跌: ${downCount}家`;
        marketDataStr = `${header}\n${turnover} | ${breadth}\n${infos.join(' | ')}`;
      } else {
        marketDataStr = `👉 【沪深两市总成交额】约 ${totalTurnoverYi.toFixed(2)} 亿元${breadthStr}\n【核心资产多因子量价走势验证】\n${infos.join('\n')}`;
      }

      // ── F3 量价验证 JS引擎预计算 ──
      if (depth !== 'summary') {
        try {
          const indexChanges = {};
          for (const asset of parsedAssets) {
            if (asset.code === '000001') indexChanges.sh = asset.pct / 100;
            else if (asset.code === '399001') indexChanges.sz = asset.pct / 100;
            else if (asset.code === '399006') indexChanges.cyb = asset.pct / 100;
          }

          // 从 Firestore 读取近22日成交额（供 VR 定量计算，取前20日基线）
          let recentTurnovers = [];
          if (firestoreContext) {
            try {
              const { db, userId, appId } = firestoreContext;
              if (db && userId && appId) {
                const sinceDate = new Date();
                sinceDate.setDate(sinceDate.getDate() - 30);
                const q = query(
                  collection(db, 'artifacts', appId, 'users', userId, 'scoring_snapshots'),
                  where('date', '>=', sinceDate.toISOString().split('T')[0]),
                  orderBy('date', 'desc'),
                  limit(25)
                );
                const snapshot = await getDocs(q);
                const today = new Date().toISOString().split('T')[0];
                snapshot.forEach(doc => {
                  const d = doc.data();
                  if (d.turnoverYi && d.date !== today) recentTurnovers.push(d.turnoverYi);
                });
                recentTurnovers = recentTurnovers.slice(0, 20);
              }
            } catch (e) { /* 保持空数组，走定性兜底 */ }
          }

          const f3Result = calcVRAndIntercept({
            todayTurnoverYi: totalTurnoverYi,
            recentTurnovers,
            upCount, downCount,
            indexChanges,
            microstructureSignal
          });
          logVRCalc({ todayTurnoverYi: totalTurnoverYi, recentTurnovers, upCount, downCount, indexChanges, microstructureSignal }, f3Result);
          const f3DefaultMax = 25;
          const f3Tuned = settings?.tunedMaxScores?.F3;
          const f3Weight = f3Tuned != null ? f3Tuned : f3DefaultMax;
          const f3Contribution = f3Result.score * f3Weight / f3DefaultMax;
          const f3WeightText = f3Tuned != null && f3Tuned !== f3DefaultMax
            ? ` | ⚙️权重${f3DefaultMax}→${f3Weight} 贡献: ${f3Contribution.toFixed(1)}(ⓘ权重变化属正常,以今日为准)`
            : ` | 贡献: ${f3Contribution.toFixed(1)}`;
          marketDataStr += `\n\n【F3 量价数据】\n`;
          marketDataStr += `档位: ${f3Result.category} | 基础分: ${f3Result.score}/25 (可调范围 ${f3Result.scoreRange?.[0] || 0}-${f3Result.scoreRange?.[1] || 25})${f3WeightText}`;
          if (f3Result.overrides) {
            marketDataStr += ` | 🚨覆盖: ${JSON.stringify(f3Result.overrides)}`;
            // 硬约束标记：LLM 有权根据原始数据驳回
            if (f3Result.overrides.fatalHardLimit) {
              marketDataStr += `\n【F3熔断信号】JS引擎检测到微观结构异常，自动输出totalEquityCap=25（权益总分上限）。LLM请根据上方微观结构原始数据（GC001/期指基差/VIX/盘面走势）自行裁定：判断为短期扰动→正常打分；确认为系统性危机→采纳上限约束。`;
            }
          }
          marketDataStr += `\n原因: ${f3Result.reason}`;
          marketDataStr += `\nVR: ${f3Result.VR.toFixed(2)} (${f3Result.vrSource})`;
        } catch (e) { /* F3引擎异常不影响行情输出 */ }
      }

      // ── 大小盘风格对比 ──
      const largeCap = parsedAssets.find(a => a.code === '000300');
      const megaCap  = parsedAssets.find(a => a.code === '000016');
      const midCap   = parsedAssets.find(a => a.code === '000905');
      const smallCap = parsedAssets.find(a => a.code === '000852');
      if (largeCap) {
        const styleStr = compareStyle(largeCap, midCap, smallCap, megaCap);
        marketDataStr += `\n\n${styleStr}`;
      }

      // ── 量价分析（基于总成交额） ──
      try {
        const vpBars = parsedAssets.map(a => ({
          close: a.cur,
          volume: a.amountWan * 10000, // 万元转元
          date: ''
        }));
        if (vpBars.length > 0) {
          const vpResult = calcVolumePriceAnalysis(vpBars, vpBars[0]?.volume || 0, totalTurnoverYi);
          if (vpResult.detail) {
            marketDataStr += `\n\n【量价分析】\n${vpResult.detail}`;
          }
        }
      } catch (e) { /* 量价分析异常不影响主流程 */ }
    }
  } catch (e) {
    console.error(`❌ [量价探针] 腾讯接口致命崩溃:`, e);
  }

  // 数据新鲜度 — 增强版（含交易日检测）
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
  const dayOfWeek = now.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const hour = now.getHours();
  let tradingStatus = '未知';
  if (isWeekend) {
    tradingStatus = '⛔ 周末休市';
  } else if (hour >= 9 && hour < 11) {
    tradingStatus = '🟢 早盘交易中(9:30-11:30)';
  } else if (hour >= 11 && hour < 13) {
    tradingStatus = '🟡 午间休市(11:30-13:00)';
  } else if (hour >= 13 && hour < 15) {
    tradingStatus = '🟢 午盘交易中(13:00-15:00)';
  } else if (hour >= 15 && hour < 17) {
    tradingStatus = '🔵 已收盘(T日数据)';
  } else if (hour >= 17 || hour < 9) {
    tradingStatus = '🌙 盘后/盘前(T日收盘数据)';
  }
  // 检测数据是否为最近交易日
  const lastTradeDateTag = (isWeekend || hour < 9) ? '⚠️ 当前可能非交易日，数据为最近交易日快照' : '';
  const freshnessTag = `📅 数据时间: ${timeStr} CST | ${tradingStatus} | 周${['日','一','二','三','四','五','六'][dayOfWeek]}${lastTradeDateTag ? '\n' + lastTradeDateTag : ''}`;

  // 数据异常检测
  let anomalyTag = '';
  if (totalTurnoverYi > 50000) anomalyTag += `\n⚠️ 成交额异常: ${totalTurnoverYi.toFixed(0)}亿 (>5万亿)`;
  else if (totalTurnoverYi < 1000 && totalTurnoverYi > 0) anomalyTag += `\n⚠️ 成交额过低: ${totalTurnoverYi.toFixed(0)}亿`;

  // 北向资金数据（非阻塞，总超时 6s，失败不影响主流程）
  let northboundStr = '';
  try {
    // race: 北向数据获取 vs 6s 总超时（含代理降级延迟）
    const nb = await Promise.race([
      (async () => {
        await new Promise(r => setTimeout(r, 300)); // 微延迟避免冲击同域限流
        return await fetchNorthboundData(settings);
      })(),
      new Promise(r => setTimeout(() => r(null), 6000)) // 6s 硬超时
    ]);
    if (nb) {
      northboundStr = `\n\n【北向资金】`;
      // 当日数据
      northboundStr += `\n当日: `;
      if (nb.sh) {
        northboundStr += `沪股通净${nb.sh.netInflowDay >= 0 ? '流入' : '流出'}${Math.abs(nb.sh.netInflowDay).toFixed(1)}亿 | 买入${nb.sh.buyDay.toFixed(1)}亿 卖出${nb.sh.sellDay.toFixed(1)}亿 | `;
      }
      if (nb.sz) {
        northboundStr += `深股通净${nb.sz.netInflowDay >= 0 ? '流入' : '流出'}${Math.abs(nb.sz.netInflowDay).toFixed(1)}亿`;
      }
      northboundStr += `\n合计: 净${nb.totalNetInflow >= 0 ? '流入' : '流出'}${Math.abs(nb.totalNetInflow).toFixed(1)}亿`;

      // 从 Firestore 读取历史北向数据（近20日）
      try {
        const { db, userId, appId } = firestoreContext || {};
        if (db && userId && appId) {
          const sinceDate = new Date();
          sinceDate.setDate(sinceDate.getDate() - 30);
          const q = query(
            collection(db, 'artifacts', appId, 'users', userId, 'scoring_snapshots'),
            where('date', '>=', sinceDate.toISOString().split('T')[0]),
            orderBy('date', 'desc'),
            limit(25)
          );
          const snapshot = await getDocs(q);
          const nbHistory = [];
          const today = new Date().toISOString().split('T')[0];
          snapshot.forEach(doc => {
            const d = doc.data();
            if (d.northbound?.totalNet != null && d.date !== today) {
              nbHistory.push(d.northbound.totalNet);
            }
          });

          if (nbHistory.length >= 3) {
            const nb5 = nbHistory.slice(0, 5);
            const nb20 = nbHistory.slice(0, 20);
            const avg5 = nb5.reduce((a, b) => a + b, 0) / nb5.length;
            const avg20 = nb20.reduce((a, b) => a + b, 0) / nb20.length;

            // 20日标准差
            const mean20 = avg20;
            const variance20 = nb20.length > 1
              ? nb20.reduce((sum, v) => sum + (v - mean20) ** 2, 0) / (nb20.length - 1) : 0;
            const std20 = Math.sqrt(variance20);
            const deviationSigma = std20 > 0 ? (nb.totalNetInflow - mean20) / std20 : 0;

            northboundStr += `\n历史统计(近${Math.min(nbHistory.length, 20)}日): 近5日均 ${avg5 >= 0 ? '+' : ''}${avg5.toFixed(1)}亿 | 近20日均 ${avg20 >= 0 ? '+' : ''}${avg20.toFixed(1)}亿 | 当前偏离 ${deviationSigma >= 0 ? '+' : ''}${deviationSigma.toFixed(2)}σ`;
            if (Math.abs(deviationSigma) > 2) {
              northboundStr += ` ⚠️偏离超2σ`;
            }
          } else {
            northboundStr += `\n历史统计: 数据积累中(已有${nbHistory.length}天)`;
          }
        }
      } catch (e) { /* 北向历史不影响主流程 */ }

      if (Math.abs(nb.totalNetInflow) > 50) {
        northboundStr += `\n📌 北向单日净${nb.totalNetInflow > 0 ? '流入' : '流出'}超50亿（绝对值较大）。`;
      }
    }
  } catch (e) { /* 北向数据获取失败不影响主流程 */ }

  // 国债收益率曲线（非阻塞，失败不影响主流程）
  let bondYieldStr = '';
  try {
    const yields = await fetchBondYields(settings);
    if (yields && yields.y10 != null) {
      const parts = [];
      if (yields.y1 != null) parts.push(`1Y: ${yields.y1.toFixed(2)}%`);
      if (yields.y2 != null) parts.push(`2Y: ${yields.y2.toFixed(2)}%`);
      if (yields.y5 != null) parts.push(`5Y: ${yields.y5.toFixed(2)}%`);
      if (yields.y10 != null) parts.push(`10Y: ${yields.y10.toFixed(2)}%`);
      if (yields.y30 != null) parts.push(`30Y: ${yields.y30.toFixed(2)}%`);
      if (yields.spread_10_2 != null) {
        const sp = yields.spread_10_2;
        parts.push(`期限利差10Y-2Y: ${sp >= 0 ? '+' : ''}${sp.toFixed(2)}%${sp < 0 ? ' ⚠️倒挂' : ''}`);
      }
      const sourceNote = yields.source === 'us_treasury_fallback' ? ' (美债兜底)' : '';
      bondYieldStr = `\n\n【国债收益率${sourceNote}】\n${parts.join(' | ')}`;
    }
  } catch (e) { /* 国债收益率不影响主流程 */ }

  // 宏观数据（M2增速 + 制造业PMI，非阻塞）
  let macroStr = '';
  try {
    const macro = await fetchMacroData(settings);
    if (macro) {
      const parts = [];
      if (macro.m2Growth != null) parts.push(`M2同比增速: ${macro.m2Growth.toFixed(1)}%`);
      if (macro.pmiManuf != null) {
        const pmi = macro.pmiManuf;
        const pmiNote = pmi > 52 ? '(扩张强劲)' : pmi > 50 ? '(扩张)' : pmi > 48 ? '(临界)' : '(收缩)';
        parts.push(`制造业PMI: ${pmi.toFixed(1)} ${pmiNote}`);
      }
      if (parts.length > 0) macroStr = `\n\n【宏观数据】\n${parts.join(' | ')}`;
    }
  } catch (e) { /* 宏观数据不影响主流程 */ }

  // 市场集中度（非阻塞，仅 full 模式）
  let concentrationStr = '';
  if (depth !== 'summary') {
    try {
      const conc = await fetchMarketConcentration(settings);
      if (conc && conc.concentrationRatio != null && conc.sampleCount >= 10) {
        const note = conc.concentrationRatio > 0.5 ? ' ⚠️权重股强拉指数' :
          conc.concentrationRatio < -0.5 ? ' ⚠️权重股砸盘' : '';
        concentrationStr = `\n\n【市场集中度】\nTOP${conc.sampleCount}大市值加权: ${conc.weightedAvg}% | 等权: ${conc.equalAvg}% | 偏离: ${conc.concentrationRatio > 0 ? '+' : ''}${conc.concentrationRatio}pp${note}`;
      }
    } catch (e) { /* 集中度不影响主流程 */ }
  }

  const dHeader = depth === 'summary' ? `\n【今日大盘行情摘要】\n` : `\n【今日大盘行情】\n`;
  return `${dHeader}${freshnessTag}${anomalyTag}${northboundStr}${bondYieldStr}${macroStr}${concentrationStr}\n${marketDataStr}\n`;
};
