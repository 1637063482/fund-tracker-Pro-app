// 工具执行处理器：策略模式替代 if-else 链
// 每个 handler: async (ctx) => void，其中 ctx = { args, toolCall, settings, body, pendingActions, fullDateTimeStr }
import { buildProxyUrl, buildAllOriginsUrl } from './proxy';
import { fetchSerperSearch, fetchTavilySearch, fetchExaSearch } from './search-engines';
import { formatCashFlows } from './market-data';
import { fetchFinancialNews } from './financial-news';

// 生成色卡主题（扩展至 14 色 + hex 支持）
const colorMap = {
  'red':     { solid: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
  'green':   { solid: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  'blue':    { solid: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
  'orange':  { solid: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  'purple':  { solid: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
  'yellow':  { solid: '#eab308', bg: 'rgba(234, 179, 8, 0.15)' },
  'gray':    { solid: '#6b7280', bg: 'rgba(107, 114, 128, 0.15)' },
  'cyan':    { solid: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)' },
  'pink':    { solid: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)' },
  'teal':    { solid: '#14b8a6', bg: 'rgba(20, 184, 166, 0.15)' },
  'indigo':  { solid: '#6366f1', bg: 'rgba(99, 102, 241, 0.15)' },
  'amber':   { solid: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  'lime':    { solid: '#84cc16', bg: 'rgba(132, 204, 22, 0.15)' },
  'rose':    { solid: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)' },
  'slate':   { solid: '#64748b', bg: 'rgba(100, 116, 139, 0.15)' },
};

const themeColors = [colorMap['blue'], colorMap['green'], colorMap['red'], colorMap['purple'], colorMap['orange'], colorMap['cyan'], colorMap['pink'], colorMap['teal'], colorMap['indigo']];

function getThemeColor(colorStr) {
  if (!colorStr) return null;
  const key = String(colorStr).toLowerCase().trim();
  if (colorMap[key]) return colorMap[key];
  // 支持 hex 色码: #rrggbb 或 #rgb
  if (/^#[0-9a-fA-F]{3,8}$/.test(key)) {
    const solid = key.length === 4 ? `#${key[1]}${key[1]}${key[2]}${key[2]}${key[3]}${key[3]}` : key;
    return { solid, bg: `${solid}26` };
  }
  return null; // 无法识别则返回 null，让调用方 || autoTheme 兜底轮换
}

// ============================================================================
// 各工具执行器
// ============================================================================

const handleGetFundHistoryData = async (ctx) => {
  const { args, toolCall, settings, body } = ctx;
  try {
    const targetUrl = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${args.fundCode}&pageIndex=1&pageSize=30`;
    const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, targetUrl)
      : buildAllOriginsUrl(targetUrl);

    const res = await fetch(fetchUrl, { cache: 'no-store' });
    const data = await res.json();
    const actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);

    if (actualData?.Data?.LSJZList) {
      const list = actualData.Data.LSJZList.reverse();
      const dates = list.map(item => item.FSRQ.substring(5));
      const navs = list.map(item => parseFloat(item.DWJZ));
      body.messages.push({
        role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
        content: `【成功获取近30日净值】\n日期序列: [${dates.join(',')}]\n净值序列: [${navs.join(',')}]\n👉 请直接使用这些数组数据，利用你的 QuickChart 生成图片能力为用户绘制走势图！`
      });
    } else {
      body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "获取历史净值失败，请告知用户无法画图。" });
    }
  } catch (e) {
    console.error("历史API调用失败", e);
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "时序接口报错，停止尝试画图。" });
  }
};

const handleGetRealtimeFundData = async (ctx) => {
  const { args, toolCall, settings, body } = ctx;
  try {
    const targetUrl = `https://danjuanfunds.com/djapi/fund/${args.fundCode}`;
    const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, targetUrl)
      : buildAllOriginsUrl(targetUrl);

    const res = await fetch(fetchUrl, { cache: 'no-store' });
    const data = await res.json();
    const actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);

    if (actualData?.data) {
      const fundData = actualData.data;
      const derived = fundData.fund_derived || {};
      const resultStr = `
【基金名称】${fundData.fd_name} (${fundData.fd_code})
【最新净值】${derived.unit_nav || '未知'} (数据更新日期: ${derived.end_date || '未知'})
【近1月涨跌】${derived.nav_grl1m || '--'}%
【近3月涨跌】${derived.nav_grl3m || '--'}%
【近6月涨跌】${derived.nav_grl6m || '--'}%
【近1年涨跌】${derived.nav_grl1y || '--'}% (近1年同类排名: ${derived.srank_l1y || '未知'})
【近3年涨跌】${derived.nav_grl3y || '--'}% (近3年同类排名: ${derived.srank_l3y || '未知'})
【成立以来收益】${derived.nav_grbase || '--'}%
`;
      body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: resultStr });
    } else {
      body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "未查询到该基金数据，可能是代码错误或退市。" });
    }
  } catch (e) {
    console.error("金融API调用失败", e);
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "接口报错，请降级使用网页搜索工具去雪球获取数据。" });
  }
};

const handleGetFundHoldingsPenetration = async (ctx) => {
  const { args, toolCall, settings, body } = ctx;
  try {
    const targetUrl = `https://danjuanfunds.com/djapi/fund/${args.fundCode}`;
    const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, targetUrl)
      : buildAllOriginsUrl(targetUrl);

    const res = await fetch(fetchUrl, { cache: 'no-store' });
    const data = await res.json();
    let actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);

    let hasStock = actualData?.data?.fund_position?.stock_list?.length > 0;
    let hasBond = actualData?.data?.fund_position?.bond_list?.length > 0;

    // 东财容灾降级
    if (!hasStock && !hasBond && settings.proxyMode === 'custom') {
      const fakeDeviceId = Math.random().toString(36).substring(2, 15);
      const emTargetUrl = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${args.fundCode}&deviceid=${fakeDeviceId}&plat=Android&product=EFund&version=6.6.8`;
      const emFetchUrl = buildProxyUrl(settings, emTargetUrl);

      const emRes = await fetch(emFetchUrl, { cache: 'no-store' });
      if (emRes.ok) {
        const emData = await emRes.json();
        if (emData?.Datas && !emData.ErrCode) {
          const stock_list = (emData.Datas.fundStocks || []).map(s => ({ name: s.GPJC, percent: parseFloat(s.JZBL) }));
          const bond_list = (emData.Datas.fundbonds || []).map(b => ({ name: b.ZQJC, percent: parseFloat(b.JZBL) }));
          if (!actualData) actualData = { data: {} };
          if (!actualData.data) actualData.data = {};
          actualData.data.fund_position = { stock_list, bond_list };
        }
      }
    }

    if (actualData?.data?.fund_position) {
      const stocks = actualData.data.fund_position.stock_list || [];
      const stockPercent = stocks.reduce((sum, s) => sum + (parseFloat(s.percent) || 0), 0);
      let resultStr = `【基金 ${args.fundCode} 底层穿透精确数据】\n前十大股票总占比: ${stockPercent.toFixed(2)}%\n`;
      if (stocks.length > 0) {
        resultStr += `【股票明细】\n` + stocks.map(s => `- ${s.name}: ${s.percent}%`).join('\n') + `\n\n`;
        resultStr += `👉 核心指令：请观察上方具体的股票名称，发挥你的行业常识，将它们归类到申万一级行业。如果前十大股票占比超过 40%，说明这是偏股基，请将 equityRatio 设为 0.85；若这是纯指数基，设为 0.95。如果是固收+，设为 0.2。然后立刻调用 update_fof_dictionary 入库！`;
      } else {
        resultStr += `【未发现股票持仓】👉 请直接认定其为纯债或货币基金，停止生成字典！`;
      }
      body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: resultStr });
    } else {
      body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "接口暂无底层数据，请直接向用户认错。" });
    }
  } catch (e) {
    console.error("穿透API报错", e);
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "接口调用异常。" });
  }
};

const handleGetBatchFundData = async (ctx) => {
  const { args, toolCall, settings, body } = ctx;
  try {
    const promises = args.fundCodes.map(async (code) => {
      const targetUrl = `https://danjuanfunds.com/djapi/fund/${code}`;
      const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
        ? buildProxyUrl(settings, targetUrl)
        : buildAllOriginsUrl(targetUrl);

      try {
        const res = await fetch(fetchUrl, { cache: 'no-store' });
        const data = await res.json();
        const actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
        return { code, actualData, success: true };
      } catch (err) {
        return { code, success: false };
      }
    });

    const results = await Promise.all(promises);
    let resultStr = "【批量数据获取结果】\n";
    results.forEach(item => {
      if (item.success && item.actualData?.data) {
        const fundData = item.actualData.data;
        const derived = fundData.fund_derived || {};
        resultStr += `- ${fundData.fd_name}(${fundData.fd_code}): 最新净值 ${derived.unit_nav || '--'} (更新日期: ${derived.end_date || '--'}) | 近1月 ${derived.nav_grl1m || '--'}% | 近1年 ${derived.nav_grl1y || '--'}%\n`;
      } else {
        resultStr += `- 代码 ${item.code}: 数据抓取失败、代码错误或已退市。\n`;
      }
    });

    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: resultStr });
  } catch (e) {
    console.error("批量API调用崩溃", e);
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "批量查询参数异常，请降级使用单只查询或文字说明。" });
  }
};

const handleQuantAnalysisEngine = async (ctx) => {
  const { args, toolCall, body } = ctx;
  try {
    let resultStr = "";

    if (args.calcType === 'future_value') {
      const ratePerMonth = (args.annualRate / 100) / 12;
      const fv = args.principal * Math.pow(1 + ratePerMonth, args.months);
      const profit = fv - args.principal;
      resultStr = `【量化引擎计算结果】\n投入本金：${args.principal}元\n预设年化：${args.annualRate}%\n投资期限：${args.months}个月\n👉 精确复利终值：${fv.toFixed(2)}元\n👉 预期纯收益：${profit.toFixed(2)}元`;
    } else if (args.calcType === 'required_rate') {
      const ratePerMonth = Math.pow(args.targetAmount / args.principal, 1 / args.months) - 1;
      const requiredAnnualRate = ratePerMonth * 12 * 100;
      resultStr = `【量化引擎计算结果】\n当前本金：${args.principal}元\n目标金额：${args.targetAmount}元\n剩余期限：${args.months}个月\n👉 要达成此目标，所需的精确年化收益率为：${requiredAnnualRate.toFixed(2)}%`;
    } else if (args.calcType === 'risk_evaluation' && args.priceArray && args.priceArray.length > 0) {
      const prices = args.priceArray;
      let maxDrawdown = 0;
      let peak = prices[0];
      let sum = 0;

      for (const p of prices) {
        sum += p;
        if (p > peak) peak = p;
        const drawdown = (peak - p) / peak;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }
      const currentPrice = prices[prices.length - 1];
      const ma = sum / prices.length;
      const currentDrawdownFromPeak = (peak - currentPrice) / peak;

      resultStr = `【量化风控扫描结果】\n该序列区间内极值：最高 ${peak.toFixed(4)}\n区间最大回撤 (Max Drawdown)：${(maxDrawdown * 100).toFixed(2)}%\n当前相对最高点回撤：${(currentDrawdownFromPeak * 100).toFixed(2)}%\n区间均值 (MA)：${ma.toFixed(4)}\n当前净值位：${currentPrice >= ma ? '均线之上(趋势偏强)' : '均线之下(趋势偏弱)'}`;
    }

    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: resultStr });
  } catch (e) {
    console.error("量化计算引擎执行失败", e);
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "运算参数异常，请重新调整调用参数。" });
  }
};

const handleGenerateTrendChart = async (ctx) => {
  const { args, toolCall, body } = ctx;
  try {
    const cleanTitle = (args.title || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    // ---- 1. 解析 labels ----
    let rawLabels = args.labels || [];
    if (typeof rawLabels === 'string') {
      try { rawLabels = JSON.parse(rawLabels.replace(/'/g, '"')); }
      catch (e) { rawLabels = rawLabels.replace(/[\[\]]/g, '').split(','); }
    }
    const safeLabels = (Array.isArray(rawLabels) ? rawLabels : []).map(l => String(l).trim().substring(0, 16));

    // ---- 2. 解析 datasets ----
    const globalChartType = args.chartType || 'line';
    const enableDualAxis = args.enableDualAxis === true;
    let rawDatasets = args.datasets || [];
    let safeDatasets = [];

    if (typeof rawDatasets === 'string') {
      try { rawDatasets = JSON.parse(rawDatasets.replace(/'/g, '"')); } catch(e) { rawDatasets = []; }
    }

    if (Array.isArray(rawDatasets) && rawDatasets.length > 0) {
      rawDatasets.forEach((ds, index) => {
        let rData = ds.data || [];
        if (typeof rData === 'string') {
          try { rData = JSON.parse(rData); }
          catch (e) { rData = rData.replace(/[\[\]]/g, '').split(','); }
        }
        const sData = (Array.isArray(rData) ? rData : []).map(d => {
          const num = parseFloat(String(d).replace(/[^\d.-]/g, ''));
          return isNaN(num) ? 0 : num;
        });
        if (sData.length === 0) return;

        const autoTheme = (typeof themeColors !== 'undefined' && themeColors) 
            ? themeColors[index % themeColors.length] 
            : { solid: '#3b82f6', bg: 'rgba(59,130,246,0.2)' }; // 默认兜底蓝
            
        let theme = autoTheme;
        if (ds.color && typeof getThemeColor === 'function') {
          try { theme = getThemeColor(ds.color) || autoTheme; } catch(e) {}
        }

        const dsChartType = ds.chartType || globalChartType;
        const isScatter = dsChartType === 'scatter';
        const showPoints = ds.showPoints !== undefined ? ds.showPoints : (safeLabels.length <= 30);
        const enableFill = ds.fill === true;
        const useDash = ds.dashed === true;
        const yAxisIndex = enableDualAxis ? (ds.yAxisIndex || 0) : 0;

        const rawLabel = ds.label || `资产 ${index + 1}`;
        const truncLabel = rawLabel.length > 20 ? rawLabel.substring(0, 19) + '...' : rawLabel;

        // 🌟 核心新增：提取基金代码，保存最终颜色，供色带“认祖归宗”
        const fundCodeMatch = rawLabel.match(/\d{6}/);
        const fundCode = fundCodeMatch ? fundCodeMatch[0] : null;

        safeDatasets.push({
          label: truncLabel,
          _fundCode: fundCode,      // 隐藏属性：记录该折线的基金代码
          _resolvedTheme: theme,    // 隐藏属性：记录该折线最终的真实颜色
          data: isScatter ? sData.map((v, i) => ({ x: safeLabels[i] || i, y: v })) : sData,
          type: dsChartType === 'area' ? 'line' : dsChartType,
          ...(dsChartType === 'area' || enableFill ? {
            fill: true,
            backgroundColor: enableFill ? theme.bg : 'transparent',
          } : { fill: false }),
          borderColor: theme.solid,
          backgroundColor: dsChartType === 'bar' || dsChartType === 'scatter' ? theme.solid : (enableFill ? theme.bg : theme.solid),
          lineTension: isScatter ? 0 : 0.2,
          borderWidth: dsChartType === 'bar' ? 0 : 2,
          borderDash: useDash ? [6, 4] : [],
          pointBackgroundColor: '#ffffff',
          pointBorderColor: theme.solid,
          pointBorderWidth: isScatter ? 2 : 1.5,
          pointRadius: isScatter ? 5 : (showPoints ? 3 : 0),
          pointHoverRadius: isScatter ? 7 : 5,
          yAxisID: enableDualAxis ? `y-axis-${yAxisIndex}` : 'y-axis-0',
          spanGaps: false,
        });
      });
    }

    if (safeDatasets.length === 0) throw new Error("解析后无有效绘图数据");

    // ---- 4. Y轴范围计算 ----
    function calcYRange(datasets, axisId) {
      let min = Infinity, max = -Infinity;
      datasets.forEach(ds => {
        if (ds.yAxisID !== axisId) return;
        const vals = ds.type === 'scatter' ? ds.data.map(d => d.y) : ds.data;
        const dsMin = Math.min(...vals);
        const dsMax = Math.max(...vals);
        if (dsMin < min) min = dsMin;
        if (dsMax > max) max = dsMax;
      });
      if (min === Infinity) return { yMin: 0, yMax: 1 };
      const range = max - min;
      const pad = range === 0 ? 0.5 : range * 0.15; // 移除了 isMultiCompare 依赖
      return { yMin: parseFloat((min - pad).toFixed(4)), yMax: parseFloat((max + pad).toFixed(4)) };
    }

    const leftRange = calcYRange(safeDatasets, 'y-axis-0');
    const rightRange = enableDualAxis ? calcYRange(safeDatasets, 'y-axis-1') : null;

    // ---- 5. 注解：色带 + 水平线 ----
    let annotations = [];
    let annotationLegend = [];
    let colorIdx = 0; // 共享颜色索引，色带和辅助线统一轮换

    let safeBands = args.horizontalBands;
    if (typeof safeBands === 'string') {
      try { safeBands = JSON.parse(safeBands.replace(/'/g, '"')); } catch(e) { safeBands = []; }
    }
    let safeLines = args.horizontalLines;
    if (typeof safeLines === 'string') {
      try { safeLines = JSON.parse(safeLines.replace(/'/g, '"')); } catch(e) { safeLines = []; }
    }

    // 解析色带：AI 指定颜色优先，未指定则自动轮换
    if (Array.isArray(safeBands)) {
      safeBands.forEach((band) => {
        const bandMin = parseFloat(band.yMin), bandMax = parseFloat(band.yMax);
        if (!isNaN(bandMin) && !isNaN(bandMax)) {

          const autoTheme = themeColors[colorIdx % themeColors.length];
          let theme = autoTheme;
          if (band.color && typeof getThemeColor === 'function') {
            const picked = getThemeColor(band.color);
            if (picked) theme = picked;
          }

          // 色带填色区（box 本身不带 label，因为 QuickChart 的 annotation 插件对 box.label 支持不完整）
          annotations.push({
            type: 'box', xScaleID: 'x-axis-0', yScaleID: 'y-axis-0',
            yMin: bandMin, yMax: bandMax,
            backgroundColor: theme.bg, borderColor: theme.solid, borderWidth: 1,
            drawTime: 'beforeDatasetsDraw',
          });
          // 色带标签：用透明辅助线挂 label（line 的 label 在 QuickChart 中稳定可用）
          if (band.label) {
            annotations.push({
              type: 'line', mode: 'horizontal', scaleID: 'y-axis-0',
              value: (bandMin + bandMax) / 2,
              borderColor: 'transparent', borderWidth: 0,
              label: {
                enabled: true, content: band.label, position: 'right',
                backgroundColor: theme.solid, fontColor: '#ffffff', fontSize: 11,
                xPadding: 6, yPadding: 4, cornerRadius: 4
              },
            });
            annotationLegend.push({ label: band.label, color: theme.solid, bg: theme.bg, isBand: true });
          }
          if (bandMin < leftRange.yMin) leftRange.yMin = bandMin;
          if (bandMax > leftRange.yMax) leftRange.yMax = bandMax;
          colorIdx++;
        }
      });
    }

    // 解析辅助线：强制虚线 + 强制自动轮换色（不允许 AI 指定颜色，确保每条线颜色不同）
    if (Array.isArray(safeLines)) {
      safeLines.forEach((line) => {
        const lineVal = parseFloat(line.value);
        if (!isNaN(lineVal)) {

          const theme = themeColors[colorIdx % themeColors.length];

          annotations.push({
            type: 'line', mode: 'horizontal', scaleID: 'y-axis-0', value: lineVal,
            borderColor: theme.solid, borderWidth: 2, borderDash: [6, 4],
          });
          const lineLabel = line.label || lineVal.toFixed(4);
          annotationLegend.push({ label: lineLabel, color: theme.solid, bg: 'transparent', isBand: false });
          if (lineVal < leftRange.yMin) leftRange.yMin = lineVal;
          if (lineVal > leftRange.yMax) leftRange.yMax = lineVal;
          colorIdx++;
        }
      });
    }

    // 解析竖直线（标记重要日期/事件）
    let safeVLines = args.verticalLines;
    if (typeof safeVLines === 'string') {
      try { safeVLines = JSON.parse(safeVLines.replace(/'/g, '"')); } catch(e) { safeVLines = []; }
    }
    if (Array.isArray(safeVLines)) {
      safeVLines.forEach((vLine) => {
        const theme = (vLine.color && getThemeColor(vLine.color)) || themeColors[colorIdx % themeColors.length];
        annotations.push({
          type: 'line', mode: 'vertical', scaleID: 'x-axis-0',
          value: String(vLine.value).trim(),
          borderColor: theme.solid, borderWidth: 2,
          borderDash: vLine.dashed !== false ? [6, 4] : [],
          label: vLine.label ? {
            enabled: true, content: vLine.label, position: 'top',
            backgroundColor: theme.solid, fontColor: '#ffffff', fontSize: 10,
            xPadding: 6, yPadding: 4, cornerRadius: 4
          } : undefined,
        });
        if (vLine.label) {
          annotationLegend.push({ label: vLine.label, color: theme.solid, bg: 'transparent', isBand: false });
        }
        colorIdx++;
      });
    }

    // 解析斜线/趋势线（连接两个数据点）
    let safeTLines = args.trendLines;
    if (typeof safeTLines === 'string') {
      try { safeTLines = JSON.parse(safeTLines.replace(/'/g, '"')); } catch(e) { safeTLines = []; }
    }
    if (Array.isArray(safeTLines)) {
      safeTLines.forEach((tLine) => {
        const x1 = parseFloat(tLine.x1), x2 = parseFloat(tLine.x2);
        const theme = (tLine.color && getThemeColor(tLine.color)) || themeColors[colorIdx % themeColors.length];
        const xScaleType = typeof safeLabels[0] === 'string' ? 'category' : 'linear';
        annotations.push({
          type: 'line',
          xScaleID: 'x-axis-0', yScaleID: 'y-axis-0',
          xMin: xScaleType === 'category' ? String(tLine.x1).trim() : (isNaN(x1) ? String(tLine.x1).trim() : x1),
          xMax: xScaleType === 'category' ? String(tLine.x2).trim() : (isNaN(x2) ? String(tLine.x2).trim() : x2),
          yMin: parseFloat(tLine.y1), yMax: parseFloat(tLine.y2),
          borderColor: theme.solid, borderWidth: 2,
          borderDash: tLine.dashed !== false ? [6, 4] : [],
          label: tLine.label ? {
            enabled: true, content: tLine.label, position: 'right',
            backgroundColor: theme.solid, fontColor: '#ffffff', fontSize: 10,
            xPadding: 6, yPadding: 4, cornerRadius: 4
          } : undefined,
        });
        if (tLine.label) {
          annotationLegend.push({ label: tLine.label, color: theme.solid, bg: 'transparent', isBand: false });
        }
        // 扩展Y轴范围以容纳趋势线的Y值
        if (parseFloat(tLine.y1) < leftRange.yMin) leftRange.yMin = parseFloat(tLine.y1);
        if (parseFloat(tLine.y1) > leftRange.yMax) leftRange.yMax = parseFloat(tLine.y1);
        if (parseFloat(tLine.y2) < leftRange.yMin) leftRange.yMin = parseFloat(tLine.y2);
        if (parseFloat(tLine.y2) > leftRange.yMax) leftRange.yMax = parseFloat(tLine.y2);
        colorIdx++;
      });
    }

    // 解析数据点标注（峰值/谷底/关键点位）
    let safePMarkers = args.pointMarkers;
    if (typeof safePMarkers === 'string') {
      try { safePMarkers = JSON.parse(safePMarkers.replace(/'/g, '"')); } catch(e) { safePMarkers = []; }
    }
    if (Array.isArray(safePMarkers)) {
      safePMarkers.forEach((pMarker) => {
        const theme = (pMarker.color && getThemeColor(pMarker.color)) || themeColors[colorIdx % themeColors.length];
        annotations.push({
          type: 'point',
          xScaleID: 'x-axis-0', yScaleID: 'y-axis-0',
          xValue: String(pMarker.x).trim(), yValue: parseFloat(pMarker.y),
          backgroundColor: theme.solid,
          radius: 6,
          label: pMarker.label ? {
            enabled: true, content: pMarker.label, position: 'top',
            backgroundColor: theme.solid, fontColor: '#ffffff', fontSize: 10,
            xPadding: 6, yPadding: 4, cornerRadius: 4
          } : undefined,
        });
        if (pMarker.label) {
          annotationLegend.push({ label: pMarker.label, color: theme.solid, bg: 'transparent', isBand: false });
        }
        // 扩展Y轴范围以容纳点标注的Y值
        if (parseFloat(pMarker.y) < leftRange.yMin) leftRange.yMin = parseFloat(pMarker.y);
        if (parseFloat(pMarker.y) > leftRange.yMax) leftRange.yMax = parseFloat(pMarker.y);
        colorIdx++;
      });
    }

    // ---- 6. 构建 QuickChart 配置 ----
    const yAxes = [{
      id: 'y-axis-0', position: 'left',
      gridLines: { display: true, color: '#f3f4f6', drawBorder: true, zeroLineColor: '#e5e7eb' },
      ticks: { suggestedMin: leftRange.yMin, suggestedMax: leftRange.yMax, fontColor: '#6b7280', padding: 10 },
      // ⚠️ 修复点：移除了写死的 scaleLabel（不再强加“累积涨跌幅”字眼，因为数据现在可能是基准点位100）
    }];

    if (enableDualAxis && rightRange) {
      yAxes.push({
        id: 'y-axis-1', position: 'right',
        gridLines: { display: false, drawBorder: false },
        ticks: { suggestedMin: rightRange.yMin, suggestedMax: rightRange.yMax, fontColor: '#9ca3af', padding: 10 },
      });
    }

    const chartConfig = {
      type: globalChartType === 'scatter' ? 'line' : (globalChartType === 'area' ? 'line' : globalChartType),
      data: { labels: safeLabels, datasets: safeDatasets },
      options: {
        defaultFontFamily: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
        layout: { padding: { top: 10, right: 65, bottom: 20, left: 10 } }, 
        title: { display: true, text: cleanTitle, fontSize: 16, fontColor: '#374151', padding: 20 },
        tooltips: { mode: 'index', intersect: false },
        legend: {
          display: safeDatasets.length > 1 || annotationLegend.length > 0,
          position: 'bottom',
          labels: { boxWidth: 14, padding: 20, fontColor: '#4b5563', fontSize: 12 },
        },
        scales: {
          xAxes: [{
            id: 'x-axis-0',
            type: globalChartType === 'scatter' ? 'linear' : 'category',
            gridLines: { display: true, color: '#f3f4f6', drawBorder: true },
            ticks: { autoSkip: true, maxRotation: 45, minRotation: 0, fontColor: '#6b7280' },
          }],
          yAxes,
        },
        annotation: annotations.length > 0 ? { annotations } : undefined,
      },
    };

    let finalChartUrl = "";
    try {
      const chartHeight = safeDatasets.length > 5 ? 520 : 420;
      const qcPayload = { chart: chartConfig, width: 800, height: chartHeight, backgroundColor: 'white', devicePixelRatio: 2 };
      const qcRes = await fetch('https://quickchart.io/chart/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(qcPayload),
      });
      const qcText = await qcRes.text();
      let qcData;
      try { qcData = JSON.parse(qcText); }
      catch (parseErr) { throw new Error(`QuickChart 返回非JSON: ${qcText.substring(0, 100)}`); }

      if (qcData.success && qcData.url) {
        finalChartUrl = qcData.url;
      } else {
        throw new Error(`QuickChart API 内部报错: ${JSON.stringify(qcData)}`);
      }
    } catch (qcError) {
      console.error("🚨 [画图探针] POST 请求失败:", qcError.message);
      const fallbackConfig = encodeURIComponent(JSON.stringify(chartConfig));
      const chartHeight = safeDatasets.length > 5 ? 520 : 420;
      finalChartUrl = `https://quickchart.io/chart?c=${fallbackConfig}&bkg=white&w=800&h=${chartHeight}&devicePixelRatio=2`;
    }

    // ---- 7. 返回结果 ----
    let annotationDesc = '';
    if (annotationLegend.length > 0) {
      annotationDesc = '\n\n📐 图表中的标注元素：\n' + annotationLegend.map(a =>
        `- ${a.isBand ? '🟦 色带' : '📏 辅助线'} "${a.label}" (色码: ${a.color})`
      ).join('\n');
    }

    body.messages.push({
      role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
      content: `图表已成功生成。请在最终回复中直接使用这行 Markdown 展示图表：\n![${cleanTitle}](${finalChartUrl})${annotationDesc}`,
    });
  } catch (e) {
    console.error("画图技能执行失败", e);
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "图表生成失败，请用文字表格代替说明。" });
  }
};

// execute_javascript 使用 Web Worker 沙箱隔离
const handleExecuteJavascript = async (ctx) => {
  const { args, toolCall, body } = ctx;
  try {

    let finalResult;
    try {
      // 使用 Web Worker 沙箱隔离执行，防止恶意代码访问 DOM
      const workerCode = `
        self.onmessage = function(e) {
          try {
            const result = (function() { ${args.code} })();
            self.postMessage({ success: true, result: result });
          } catch (err) {
            self.postMessage({ success: false, error: err.message });
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);

      finalResult = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          reject(new Error('代码执行超时 (5秒)'));
        }, 5000);

        worker.onmessage = (e) => {
          clearTimeout(timeout);
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          if (e.data.success) {
            resolve(e.data.result);
          } else {
            reject(new Error(e.data.error));
          }
        };

        worker.onerror = (err) => {
          clearTimeout(timeout);
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          reject(new Error(err.message));
        };

        worker.postMessage({});
      });
    } catch (workerError) {
      body.messages.push({
        role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
        content: `代码执行失败：Web Worker 沙箱不可用（${workerError.message}）。请换一种方式完成计算，不要依赖 execute_javascript 工具。`
      });
      return;
    }

    let output = finalResult;
    if (typeof finalResult === 'object' && finalResult !== null) {
      output = JSON.stringify(finalResult, null, 2);
    }


    body.messages.push({
      role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
      content: `代码执行成功！沙盒返回的绝对精确结果为:\n${output}\n👉 请将此结果无缝融入你的最终分析报告中。`
    });
  } catch (e) {
    console.error(`%c❌ [沙盒执行崩溃]:`, `color: #ef4444; font-weight: bold;`, e);
    body.messages.push({
      role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
      content: `你写的代码执行报错了: ${e.message}。请检查语法逻辑，修复后重新调用执行！`
    });
  }
};

const handleSearchTools = async (ctx) => {
  const { args, toolCall, settings, body, fullDateTimeStr } = ctx;
  try {
    const toolName = toolCall.function.name;
    let rawQuery = (args.query || '').trim();

    // 统一查询增强：剥离 AI 经常附加的冗余日期描述，追加金融新闻精准限定词
    let finalQuery = rawQuery
      .replace(/202\d年/g, '').replace(/\d{1,2}月\d{1,2}日/g, '')
      .replace(/今天|今日|昨天|最新|近期/g, '').trim();

    let searchRes = "";

    if (toolName === 'google_macro_search') {
      const tr = args.timeRange || "qdr:w";
      // Serper/Google 查询增强：限定站点 + 排除 SEO 垃圾
      const enhanced = finalQuery + ' (site:cls.cn OR site:wallstreetcn.com OR site:jin10.com OR site:yicai.com)';
      searchRes = await fetchSerperSearch(settings.serperApiKey, enhanced, tr);
    } else if (toolName === 'tavily_news_search') {
      const recency = args.recency || "d1";
      // 确保查询偏向新闻快讯
      if (!/快讯|突发|政策|新闻|异动/.test(finalQuery)) {
        finalQuery = finalQuery + ' 最新消息';
      }
      searchRes = await fetchTavilySearch(settings.tavilyApiKey, finalQuery, "news", settings, recency);
    } else if (toolName === 'exa_research') {
      // 确保查询偏向深度分析
      if (!/研报|分析|解读|展望|策略|报告/.test(finalQuery)) {
        finalQuery = finalQuery + ' 研报 分析 展望';
      }
      searchRes = await fetchExaSearch(settings.exaApiKey, finalQuery, settings);
    }

    // 降级兜底：主节点失败或无结果，触发 Serper 带站点过滤
    if (!searchRes && settings.serperApiKey && toolName !== 'google_macro_search') {
      const fallbackQuery = finalQuery + ' (site:cls.cn OR site:wallstreetcn.com OR site:stcn.com)';
      searchRes = await fetchSerperSearch(settings.serperApiKey, fallbackQuery, "qdr:w");
    }

    const timeWarning = '[系统物理防伪探针] 现在的真实时间是 ' + fullDateTimeStr + '。请严格核对以下搜索结果中的【发布时间】！如果新闻是几个月前甚至几年前的，说明它是过时垃圾信息，绝对禁止作为判断依据！\n\n';

    body.messages.push({
      role: "tool", tool_call_id: toolCall.id, name: toolName,
      content: searchRes ? (timeWarning + searchRes) : "未检索到精确数据。请使用 A 组的专用 API 工具（get_realtime_fund_data 等）获取数据，或告知用户当前无有效信息。"
    });
  } catch (e) {
    console.error('搜索工具执行异常:', toolCall.function.name, e.message);
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "搜索接口异常，请尝试用专用 API 工具替代搜索。" });
  }
};

const handleUpdateLedger = async (ctx) => {
  const { args, toolCall, body, pendingActions } = ctx;
  const actionsList = args.actions ? args.actions : (args.fundCode ? [args] : []);
  actionsList.forEach(act => pendingActions.push({ ...act, toolType: 'ledger' }));
  body.messages.push({
    role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
    content: `【系统提示】成功捕获 ${actionsList.length} 条记账指令，UI端将自动生成调仓卡片。🚨 强制指令：请你立刻继续完成刚才的宏观分析与调仓逻辑报告，并在报告末尾顺便告知用户调仓卡片已生成！`
  });
};

const handleManagePlanTodo = async (ctx) => {
  const { args, toolCall, body, pendingActions } = ctx;
  const plansList = args.plans || [];
  plansList.forEach(plan => pendingActions.push({ ...plan, toolType: 'todo' }));
  body.messages.push({
    role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
    content: `【系统提示】成功捕获 ${plansList.length} 条待办指令(增/删/改)。请立刻继续输出你的建议，并在末尾提醒用户点击卡片确认授权。`
  });
};

const handleUpdateDecisionMemo = async (ctx) => {
  const { args, toolCall, body, pendingActions } = ctx;
  pendingActions.push({ ...args, toolType: 'memo' });
  body.messages.push({
    role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
    content: "【系统提示】该战略研判已成功生成记忆卡片。请继续回答用户的问题，并告知用户你已将此结论记录在备忘录中。"
  });
};

const handleUpdateFofDictionary = async (ctx) => {
  const { args, toolCall, body, pendingActions } = ctx;
  pendingActions.push({ ...args, toolType: 'fof_dict' });
  body.messages.push({
    role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
    content: "【系统提示】FOF 穿透字典入库单据已生成。请在回复中提示用户点击卡片确认写入云端。"
  });
};

const handleGetMarketHistoricalIntraday = async (ctx) => {
  const { args, toolCall, settings, body } = ctx;
  try {
    let code = (args.code || '').toLowerCase();
    if (/^\d{6}$/.test(code)) {
      code = (code === '000001' || code.startsWith('5')) ? 'sh' + code : 'sz' + code;
    }

    const targetUrl = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},day,,,20,`;
    const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
      ? buildProxyUrl(settings, targetUrl)
      : buildAllOriginsUrl(targetUrl);

    const res = await fetch(fetchUrl, { cache: 'no-store' });
    const resData = await res.json();
    const dayData = resData?.data?.[code]?.day || resData?.data?.[code]?.qfqday;

    let resultStr = `【资产 ${args.code} 过去 20 个交易日的K线结构微观数据】\n(注：百分比基准为当日开盘价)\n`;

    if (dayData && Array.isArray(dayData)) {
      dayData.forEach(day => {
        const date = day[0];
        const open = parseFloat(day[1]), close = parseFloat(day[2]), high = parseFloat(day[3]), low = parseFloat(day[4]);
        const ampPct = ((high - low) / open * 100).toFixed(2);
        const bodyPct = ((close - open) / open * 100).toFixed(2);
        const upperPct = ((high - Math.max(open, close)) / open * 100).toFixed(2);
        const lowerPct = ((Math.min(open, close) - low) / open * 100).toFixed(2);
        const shapeMath = `(振幅${ampPct}% | 实体${bodyPct > 0 ? '+' + bodyPct : bodyPct}% | 上影${upperPct}% | 下影${lowerPct}%)`;
        resultStr += `- [${date}] 开:${open} 收:${close} 高:${high} 低:${low} ${shapeMath}\n`;
      });
    } else {
      resultStr += "暂无历史K线数据。\n";
    }


    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: resultStr });
  } catch (e) {
    console.error("历史K线获取失败", e);
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "K线数据库调用异常。" });
  }
};

// ============================================================================
// 策略映射表：toolName → handler function
// ============================================================================
// 交易流水溯源处理器
const handleGetFundTransactionHistory = async (ctx) => {
  const { args, toolCall, body, portfolioStats } = ctx;
  try {
    const fundCode = (args.fundCode || '').trim();

    const fund = (portfolioStats?.computedFundsWithMetrics || []).find(
      f => (f.fundCode || '').trim() === fundCode
    );

    if (!fund) {
      body.messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: "get_fund_transaction_history",
        content: `未找到代码为 ${fundCode} 的基金持仓记录。请检查代码是否正确。`
      });
      return;
    }

    const cashFlowStr = formatCashFlows(fund.transactions);
    body.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      name: "get_fund_transaction_history",
      content: `【${fund.name} (${fund.fundCode}) 完整历史交易流水】\n${cashFlowStr}\n\n当前持仓市值: ${fund.currentValue} 元 | 累计盈亏: ${fund.profit} 元 | 净本金: ${fund.netInvested} 元`
    });
  } catch (e) {
    body.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      name: "get_fund_transaction_history",
      content: `查询交易流水失败: ${e.message}`
    });
  }
};

// 财经快讯处理器（优先财联社→东财，均失败时引导使用搜索工具）
const handleFinancialNews = async (ctx) => {
  const { args, toolCall, body, fullDateTimeStr, settings } = ctx;
  try {
    const topic = args.topic || 'market';
    const { source, items } = await fetchFinancialNews(settings, topic, 12);

    if (items.length === 0) {
      body.messages.push({
        role: "tool", tool_call_id: toolCall.id, name: "get_financial_news",
        content: "新浪财经快讯 API 暂不可用。请改用 tavily_news_search 或 google_macro_search 获取新闻资讯。"
      });
      return;
    }

    const formatted = items.map(n =>
      '【' + (n.time || '未知时间') + '】' + n.title + '\n' + (n.content ? '  > ' + n.content.substring(0, 200) : '')
    ).join('\n\n');

    const timeWarning = '[系统物理防伪探针] 现在的真实时间是 ' + fullDateTimeStr + '。以上为' + source + '实时快讯的结构化数据。\n\n';

    body.messages.push({
      role: "tool", tool_call_id: toolCall.id, name: "get_financial_news",
      content: timeWarning + formatted
    });
  } catch (e) {
    body.messages.push({
      role: "tool", tool_call_id: toolCall.id, name: "get_financial_news",
      content: '新浪财经快讯接口异常: ' + e.message + '。请改用搜索工具获取资讯。'
    });
  }
};

// ============================================================================
// 多基金横向对比引擎
// ============================================================================
const handleFundComparison = async (ctx) => {
  const { args, toolCall, settings, body } = ctx;
  const fundCodes = (args.fundCodes || []).slice(0, 5);
  const aspect = args.aspect || 'full';

  if (fundCodes.length < 2) {
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: "get_fund_comparison", content: "至少需要2只基金代码才能对比。" });
    return;
  }

  try {
    // --- 1. 并行拉取所有基金数据 ---
    const fundDataList = await Promise.all(fundCodes.map(async (code) => {
      const targetUrl = `https://danjuanfunds.com/djapi/fund/${code}`;
      const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
        ? buildProxyUrl(settings, targetUrl)
        : buildAllOriginsUrl(targetUrl);
      try {
        const res = await fetch(fetchUrl, { cache: 'no-store' });
        const data = await res.json();
        const actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
        if (!actualData?.data) return null;
        const d = actualData.data;
        const der = d.fund_derived || {};
        const rates = d.fund_rates || {};

        // 估规模：totshare(亿) × unit_nav = 亿
        const shareStr = String(d.totshare || '0');
        const shareYi = parseFloat(shareStr.replace(/[^0-9.]/g, '')) || 0;
        const nav = parseFloat(der.unit_nav) || 0;
        const estimatedSize = nav > 0 ? (shareYi * nav).toFixed(2) : 'N/A';

        // 费率
        const subRate = rates.subscribe_rate != null ? parseFloat(rates.subscribe_rate) : null;
        const discount = rates.subscribe_discount != null ? parseFloat(rates.subscribe_discount) : (rates.discount != null ? parseFloat(rates.discount) : 1);

        // 估管理费(基于类型)
        const typeDesc = d.type_desc || '';
        let mgmtFee = '~1.50%';
        if (typeDesc.includes('货币')) mgmtFee = '~0.25%';
        else if (typeDesc.includes('债') || typeDesc.includes('固收')) mgmtFee = '~0.60%';
        else if (typeDesc.includes('指数') || typeDesc.includes('ETF') || typeDesc.includes('联接')) mgmtFee = '~0.50%';
        else if (typeDesc.includes('混合') && !typeDesc.includes('偏股')) mgmtFee = '~1.20%';

        return {
          code, name: d.fd_name, type: typeDesc, nav,
          returns: {
            m1: parseFloat(der.nav_grl1m) || 0, m3: parseFloat(der.nav_grl3m) || 0,
            m6: parseFloat(der.nav_grl6m) || 0, y1: parseFloat(der.nav_grl1y) || 0,
            y3: parseFloat(der.nav_grl3y) || 0, base: parseFloat(der.nav_grbase) || 0,
          },
          rank: { y1: der.srank_l1y || 'N/A', y3: der.srank_l3y || 'N/A' },
          manager: d.manager_name || 'N/A',
          company: d.trup_name || 'N/A',
          foundDate: d.found_date || 'N/A',
          riskLevel: d.risk_level || 'N/A',
          subscribeFee: subRate != null ? (subRate * discount).toFixed(2) + '%' : 'N/A',
          mgmtFee,
          size: estimatedSize !== 'N/A' ? estimatedSize + '亿' : 'N/A',
          maxDrawdown: 'N/A', volatility: 0, percentile: 50,
          equityRatio: 'N/A', sectors: 'N/A',
        };
      } catch (e) { return null; }
    }));

    const validFunds = fundDataList.filter(Boolean);
    if (validFunds.length < 2) {
      body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: "get_fund_comparison", content: "至少需要2只有效基金数据才能对比，部分基金代码可能无效。" });
      return;
    }

    // --- 2. 并行拉取30日净值序列 + FOF字典 ---
    const navSeries = await Promise.all(validFunds.map(async (f) => {
      try {
        const targetUrl = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${f.code}&pageIndex=1&pageSize=30`;
        const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
          ? buildProxyUrl(settings, targetUrl)
          : buildAllOriginsUrl(targetUrl);
        const res = await fetch(fetchUrl, { cache: 'no-store' });
        const data = await res.json();
        const actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
        const list = (actualData?.Data?.LSJZList || []).map(item => parseFloat(item.DWJZ)).filter(v => !isNaN(v));
        return list.reverse();
      } catch (e) { return []; }
    }));

    // --- 3. 计算衍生指标 ---
    validFunds.forEach((f, i) => {
      const navs = navSeries[i] || [];
      if (navs.length >= 5) {
        // 日收益率序列
        const dailyReturns = [];
        for (let j = 1; j < navs.length; j++) {
          dailyReturns.push((navs[j] - navs[j-1]) / navs[j-1]);
        }
        // 年化波动率
        const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
        const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
        f.volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;

        // 估值分位: 当前净值在30日区间位置
        const minNav = Math.min(...navs);
        const maxNav = Math.max(...navs);
        f.percentile = maxNav > minNav ? ((f.nav - minNav) / (maxNav - minNav)) * 100 : 50;

        // 最大回撤 (30日)
        let peak = navs[0], mdd = 0;
        for (const n of navs) {
          if (n > peak) peak = n;
          const dd = (peak - n) / peak;
          if (dd > mdd) mdd = dd;
        }
        f.maxDrawdown = (mdd * 100).toFixed(2) + '%';
      }
      // Sharpe 近似
      const riskFree = 2.0; // 假设无风险利率 2%
      f.sharpeProxy = f.volatility > 0 ? ((f.returns.y1 - riskFree) / f.volatility).toFixed(2) : 'N/A';
      f.volatility = f.volatility.toFixed(2) + '%';
      f.percentile = f.percentile.toFixed(0) + '%';
    });

    // --- 4. 相关性矩阵 ---
    let corrMatrix = '';
    if (navSeries.every(n => n.length >= 20)) {
      corrMatrix = '\n【相关性矩阵】\n';
      const names = validFunds.map(f => f.name.length > 8 ? f.name.substring(0,7)+'..' : f.name);
      corrMatrix += '          ' + names.join('    ') + '\n';
      for (let i = 0; i < validFunds.length; i++) {
        const row = [names[i]];
        for (let j = 0; j < validFunds.length; j++) {
          if (i === j) { row.push('1.00'); continue; }
          const a = navSeries[i], b = navSeries[j];
          const n = Math.min(a.length, b.length);
          const aSlice = a.slice(0, n), bSlice = b.slice(0, n);
          const meanA = aSlice.reduce((s, v) => s + v, 0) / n;
          const meanB = bSlice.reduce((s, v) => s + v, 0) / n;
          let cov = 0, varA = 0, varB = 0;
          for (let k = 0; k < n; k++) {
            const da = aSlice[k] - meanA, db = bSlice[k] - meanB;
            cov += da * db; varA += da * da; varB += db * db;
          }
          const r = varA > 0 && varB > 0 ? (cov / Math.sqrt(varA * varB)).toFixed(2) : 'N/A';
          row.push(r);
        }
        corrMatrix += row.join('  ') + '\n';
      }
    }

    // --- 5. 评级 ---
    const calcRating = (values, reverse) => {
      if (values.length < 2) return values.map(() => '---');
      const sorted = [...values].sort((a, b) => reverse ? a - b : b - a);
      return values.map(v => {
        const rank = sorted.indexOf(v) + 1;
        if (rank === 1) return '★★★★★';
        if (rank <= Math.ceil(values.length / 3)) return '★★★★☆';
        if (rank <= Math.ceil(values.length * 2 / 3)) return '★★★☆☆';
        return '★★☆☆☆';
      });
    };

    const returnScores = validFunds.map(f => f.returns.y1 + f.returns.y3 * 0.4);
    const riskScores = validFunds.map(f => parseFloat(f.maxDrawdown) || 0);
    const sharpeVals = validFunds.map(f => parseFloat(f.sharpeProxy) || 0);
    const returnStars = calcRating(returnScores, false);
    const riskStars = calcRating(riskScores, true);  // lower drawdown = better
    const sharpeStars = calcRating(sharpeVals, false);

    // --- 6. 格式化输出 ---
    const cols = validFunds.map(f => f.name.length > 10 ? f.name.substring(0, 9) + '..' : f.name).join(' | ');
    let report = '【多基金横向对比报告】\n\n';

    // 基本信息
    report += `指标 | ${cols}\n`;
    report += `---|---|---\n`;
    report += `代码 | ${validFunds.map(f => f.code).join(' | ')}\n`;
    report += `类型 | ${validFunds.map(f => f.type).join(' | ')}\n`;
    report += `基金经理 | ${validFunds.map(f => f.manager).join(' | ')}\n`;

    if (aspect !== 'risk' && aspect !== 'cost') {
      report += `最新净值 | ${validFunds.map(f => f.nav).join(' | ')}\n`;
      report += `近1月 | ${validFunds.map(f => (f.returns.m1>0?'+':'')+f.returns.m1.toFixed(2)+'%').join(' | ')}\n`;
      report += `近3月 | ${validFunds.map(f => (f.returns.m3>0?'+':'')+f.returns.m3.toFixed(2)+'%').join(' | ')}\n`;
      report += `近6月 | ${validFunds.map(f => (f.returns.m6>0?'+':'')+f.returns.m6.toFixed(2)+'%').join(' | ')}\n`;
      report += `近1年 | ${validFunds.map(f => (f.returns.y1>0?'+':'')+f.returns.y1.toFixed(2)+'%').join(' | ')}\n`;
      report += `近3年 | ${validFunds.map(f => (f.returns.y3>0?'+':'')+f.returns.y3.toFixed(2)+'%').join(' | ')}\n`;
      report += `1年排名 | ${validFunds.map(f => f.rank.y1).join(' | ')}\n`;
    }

    if (aspect !== 'returns' && aspect !== 'cost') {
      report += `最大回撤(30日) | ${validFunds.map(f => f.maxDrawdown).join(' | ')}\n`;
      report += `波动率(年化) | ${validFunds.map(f => f.volatility).join(' | ')}\n`;
      report += `Sharpe估 | ${validFunds.map(f => f.sharpeProxy).join(' | ')}\n`;
      report += `估值分位(30日) | ${validFunds.map(f => f.percentile).join(' | ')}\n`;
    }

    if (aspect !== 'returns' && aspect !== 'risk') {
      report += `申购费率 | ${validFunds.map(f => f.subscribeFee).join(' | ')}\n`;
      report += `估管理费 | ${validFunds.map(f => f.mgmtFee).join(' | ')}\n`;
      report += `估规模 | ${validFunds.map(f => f.size).join(' | ')}\n`;
    }

    // 评级
    report += `\n【综合评级】\n`;
    report += `收益能力 | ${validFunds.map((_, i) => returnStars[i]).join(' | ')}\n`;
    report += `风控能力 | ${validFunds.map((_, i) => riskStars[i]).join(' | ')}\n`;
    report += `性价比 | ${validFunds.map((_, i) => sharpeStars[i]).join(' | ')}\n`;

    // 估值时机提示
    report += `估值时机 | ${validFunds.map(f => {
      const p = parseFloat(f.percentile) || 50;
      if (p > 70) return '偏高不宜追';
      if (p < 30) return '偏低适合建仓';
      return '中性可入';
    }).join(' | ')}\n`;

    // 相关性
    report += corrMatrix;

    // 分散度建议
    const corrVals = [];
    for (let i = 0; i < validFunds.length; i++) {
      for (let j = i + 1; j < validFunds.length; j++) {
        const a = navSeries[i], b = navSeries[j], n = Math.min(a.length, b.length);
        const aS = a.slice(0, n), bS = b.slice(0, n);
        const mA = aS.reduce((s, v) => s + v, 0) / n, mB = bS.reduce((s, v) => s + v, 0) / n;
        let cov = 0, vA = 0, vB = 0;
        for (let k = 0; k < n; k++) {
          const da = aS[k] - mA, db = bS[k] - mB;
          cov += da * db; vA += da * da; vB += db * db;
        }
        const r = vA > 0 && vB > 0 ? cov / Math.sqrt(vA * vB) : 0;
        if (r > 0.85) corrVals.push('🚨 ' + validFunds[i].name + '↔' + validFunds[j].name + ': r=' + r.toFixed(2) + ' 高度重叠，无效分散');
        else if (r > 0.6) corrVals.push('⚠️ ' + validFunds[i].name + '↔' + validFunds[j].name + ': r=' + r.toFixed(2) + ' 同质性较高');
      }
    }
    if (corrVals.length > 0) {
      report += '\n【分散度警告】\n' + corrVals.join('\n') + '\n';
    } else {
      report += '\n【分散度】各基金间相关性适中，组合分散效果良好。\n';
    }

    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: "get_fund_comparison", content: report });

  } catch (e) {
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: "get_fund_comparison", content: '基金对比引擎异常: ' + e.message });
  }
};

const HANDLER_MAP = {
  'get_fund_history_data': handleGetFundHistoryData,
  'get_realtime_fund_data': handleGetRealtimeFundData,
  'get_fund_holdings_penetration': handleGetFundHoldingsPenetration,
  'get_batch_fund_data': handleGetBatchFundData,
  'generate_trend_chart': handleGenerateTrendChart,
  'execute_javascript': handleExecuteJavascript,
  'google_macro_search': handleSearchTools,
  'tavily_news_search': handleSearchTools,
  'exa_research': handleSearchTools,
  'get_financial_news': handleFinancialNews,
  'get_fund_comparison': handleFundComparison,
  'update_ledger': handleUpdateLedger,
  'manage_plan_todo': handleManagePlanTodo,
  'update_decision_memo': handleUpdateDecisionMemo,
  'update_fof_dictionary': handleUpdateFofDictionary,
  'get_market_historical_intraday': handleGetMarketHistoricalIntraday,
  'get_fund_transaction_history': handleGetFundTransactionHistory,
};

// 分发入口：根据 toolName 调用对应 handler
export const dispatchToolCall = async (toolName, ctx) => {
  const handler = HANDLER_MAP[toolName];
  if (handler) {
    await handler(ctx);
  } else {
    console.warn(`[Agent] 未知工具调用: ${toolName}`);
    ctx.body.messages.push({
      role: "tool",
      tool_call_id: ctx.toolCall.id,
      name: toolName,
      content: `未知工具: ${toolName}`
    });
  }
};
