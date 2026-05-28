// 工具执行处理器：策略模式替代 if-else 链
// 每个 handler: async (ctx) => void，其中 ctx = { args, toolCall, settings, body, pendingActions, fullDateTimeStr }
import { buildProxyUrl, buildAllOriginsUrl } from './proxy';
import { fetchSerperSearch, fetchTavilySearch, fetchExaSearch } from './search-engines';

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
  if (!colorStr) return colorMap['gray'];
  const key = String(colorStr).toLowerCase().trim();
  if (colorMap[key]) return colorMap[key];
  // 支持 hex 色码: #rrggbb 或 #rgb
  if (/^#[0-9a-fA-F]{3,8}$/.test(key)) {
    const solid = key.length === 4 ? `#${key[1]}${key[1]}${key[2]}${key[2]}${key[3]}${key[3]}` : key;
    return { solid, bg: `${solid}26` };
  }
  return colorMap['gray'];
}

// ============================================================================
// 各工具执行器
// ============================================================================

const handleGetFundHistoryData = async (ctx) => {
  const { args, toolCall, settings, body } = ctx;
  try {
    console.log(`🔥 [Agent 调度] AI 激活时序数据库！拉取基金 [${args.fundCode}] 历史走势`);
    const targetUrl = `http://api.fund.eastmoney.com/f10/lsjz?fundCode=${args.fundCode}&pageIndex=1&pageSize=30`;
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
    console.log(`🔥 [Agent 调度] AI 拔出专属金融 API 狙击枪！锁定代码:【${args.fundCode}】`);
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
    console.log(`🔥 [Agent 调度] AI 拔出透视扫描仪！直连金融库穿透代码:【${args.fundCode}】`);
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
    console.log(`🔥 [Agent 调度] AI 拔出批量散弹枪！锁定代码:`, args.fundCodes);
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
    console.log(`🔥 [Agent 调度] AI 挂载算力协处理器！执行硬核量化运算:【${args.calcType}】`);
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
    console.log(`🔥 [Agent 调度] AI 释放可视化技能！绘制图表:【${cleanTitle}】`);

    // ---- 1. 解析 labels ----
    let rawLabels = args.labels || [];
    if (typeof rawLabels === 'string') {
      try { rawLabels = JSON.parse(rawLabels.replace(/'/g, '"')); }
      catch (e) { rawLabels = rawLabels.replace(/[\[\]]/g, '').split(','); }
    }
    const safeLabels = (Array.isArray(rawLabels) ? rawLabels : []).map(l => String(l).trim().substring(0, 16));

    // ---- 2. 解析 datasets（支持 AI 指定颜色/线型/填充/点/轴） ----
    const globalChartType = args.chartType || 'line';
    const enableDualAxis = args.enableDualAxis === true;
    let rawDatasets = args.datasets || [];
    let safeDatasets = [];
    let datasetMeta = []; // 存储每个数据集的反归一化信息

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

        // 尊重 AI 指定的颜色，未指定则按主题色轮转
        const dsColor = getThemeColor(ds.color);
        const autoTheme = themeColors[index % themeColors.length];
        const theme = ds.color ? dsColor : autoTheme;
        const dsChartType = ds.chartType || globalChartType;

        datasetMeta.push({ originalData: [...sData], baseVal: sData[0] || 0 });

        const isScatter = dsChartType === 'scatter';
        const showPoints = ds.showPoints !== undefined ? ds.showPoints : (safeLabels.length <= 30);
        const enableFill = ds.fill === true;
        const useDash = ds.dashed === true;
        const yAxisIndex = enableDualAxis ? (ds.yAxisIndex || 0) : 0;

        safeDatasets.push({
          label: ds.label || `资产 ${index + 1}`,
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

    // ---- 3. 多数据集线图自动归一化为累积涨跌幅 ----
    const realAssetCount = safeDatasets.filter(ds => ds.type === 'line' && !ds.label.match(/MA|均线|阻力|支撑|上限|下限|上轨|下轨|中枢/i)).length;
    const isMultiCompare = realAssetCount > 1 && (globalChartType === 'line' || globalChartType === 'area');

    if (isMultiCompare) {
      safeDatasets.forEach((ds, idx) => {
        if (ds.type === 'line' && idx < datasetMeta.length) {
          const baseVal = (datasetMeta[idx].baseVal !== 0 && datasetMeta[idx].baseVal !== undefined) ? datasetMeta[idx].baseVal : 1;
          ds.data = ds.data.map(v => ((v - baseVal) / baseVal) * 100);
        }
      });
    }

    // ---- 4. Y轴范围计算（支持双轴独立范围） ----
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
      const pad = range === 0 ? (isMultiCompare ? 0.5 : 0.01) : range * 0.15;
      return { yMin: parseFloat((min - pad).toFixed(4)), yMax: parseFloat((max + pad).toFixed(4)) };
    }

    const leftRange = calcYRange(safeDatasets, 'y-axis-0');
    const rightRange = enableDualAxis ? calcYRange(safeDatasets, 'y-axis-1') : null;

    // ---- 5. 注解：色带 + 水平线（不再创建假数据集污染图例） ----
    let annotations = [];
    let annotationLegend = []; // 用于图例展示的标注项

    if (args.horizontalBands && Array.isArray(args.horizontalBands)) {
      args.horizontalBands.forEach((band, i) => {
        const bandMin = parseFloat(band.yMin), bandMax = parseFloat(band.yMax);
        if (!isNaN(bandMin) && !isNaN(bandMax)) {
          const theme = getThemeColor(band.color);
          annotations.push({
            type: 'box', yScaleID: 'y-axis-0', yMin: bandMin, yMax: bandMax,
            backgroundColor: theme.bg, borderColor: theme.solid, borderWidth: 1,
          });
          if (band.label) {
            annotationLegend.push({ label: band.label, color: theme.solid, bg: theme.bg, isBand: true });
          }
        }
      });
    }

    if (args.horizontalLines && Array.isArray(args.horizontalLines)) {
      args.horizontalLines.forEach((line) => {
        const lineVal = parseFloat(line.value);
        if (!isNaN(lineVal)) {
          const theme = getThemeColor(line.color);
          const lineDash = line.dashed !== false ? [6, 4] : [];
          annotations.push({
            type: 'line', mode: 'horizontal', scaleID: 'y-axis-0', value: lineVal,
            borderColor: theme.solid, borderWidth: 2, borderDash: lineDash,
            label: line.label ? { enabled: true, content: line.label, position: 'right', fontColor: theme.solid, fontSize: 12 } : undefined,
          });
          if (line.label) {
            annotationLegend.push({ label: line.label, color: theme.solid, bg: 'transparent', isBand: false });
          }
        }
      });
    }

    const displayTitle = isMultiCompare ? `${cleanTitle} (累积涨跌幅 %)` : cleanTitle;

    // ---- 6. 构建 QuickChart 配置 ----
    const yAxes = [{
      id: 'y-axis-0', position: 'left',
      gridLines: { display: true, color: '#f3f4f6', drawBorder: true, zeroLineColor: '#e5e7eb' },
      ticks: { min: leftRange.yMin, max: leftRange.yMax, fontColor: '#6b7280', padding: 10 },
      scaleLabel: isMultiCompare ? { display: true, labelString: '累积涨跌幅 (%)', fontColor: '#6b7280' } : undefined,
    }];

    if (enableDualAxis && rightRange) {
      yAxes.push({
        id: 'y-axis-1', position: 'right',
        gridLines: { display: false, drawBorder: false },
        ticks: { min: rightRange.yMin, max: rightRange.yMax, fontColor: '#9ca3af', padding: 10 },
      });
    }

    const chartConfig = {
      type: globalChartType === 'scatter' ? 'line' : (globalChartType === 'area' ? 'line' : globalChartType),
      data: { labels: safeLabels, datasets: safeDatasets },
      options: {
        defaultFontFamily: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
        title: { display: true, text: displayTitle, fontSize: 16, fontColor: '#374151', padding: 20 },
        tooltips: { mode: 'index', intersect: false },
        legend: {
          display: safeDatasets.length > 1 || annotationLegend.length > 0,
          position: 'bottom',
          labels: {
            boxWidth: 24, padding: 12, fontColor: '#4b5563',
          },
        },
        scales: {
          xAxes: [{
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
      const qcPayload = { chart: chartConfig, width: 800, height: 420, backgroundColor: 'white', devicePixelRatio: 2 };
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
      finalChartUrl = `https://quickchart.io/chart?c=${fallbackConfig}&bkg=white&w=800&h=420&devicePixelRatio=2`;
    }

    // ---- 7. 返回结果给 AI ----
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
    console.log(`%c🚀 [Agent 算力觉醒] AI 正在自主编写 JavaScript 代码...`, `color: #8b5cf6; font-size: 14px; font-weight: bold; padding: 4px 0;`);
    console.log(`%c🎯 编码意图:%c ${args.reasoning}`, `color: #10b981; font-weight: bold;`, `color: #334155; font-size: 13px;`);
    console.log(`%c💻 生成的源码:\n%c${args.code}`, `color: #3b82f6; font-weight: bold;`, `color: #ef4444; font-family: monospace; font-size: 13px; background: #f8fafc; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; display: block; width: 100%;`);

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
      // 如果 Worker 不可用（某些旧浏览器），降级到 new Function 但有基本防护
      console.warn("Web Worker 不可用，降级到沙箱执行:", workerError.message);
      const sandboxedCode = args.code.replace(/document\.|window\.|location\.|fetch\(|XMLHttpRequest|localStorage|sessionStorage/gi, 'undefined');
      finalResult = new Function(sandboxedCode)();
    }

    let output = finalResult;
    if (typeof finalResult === 'object' && finalResult !== null) {
      output = JSON.stringify(finalResult, null, 2);
    }

    console.log(`%c✅ [沙盒运算完毕] 结果: %c${output}`, `color: #10b981; font-weight: bold;`, `color: #0f172a; font-size: 13px; font-weight: 900;`);

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
    let finalQuery = (args.query || '').trim();
    console.log(`🔥 [Agent 调度] AI 激活【${toolName}】 | 发射检索词: [${finalQuery}]`);

    let searchRes = "";

    if (toolName === 'google_macro_search') {
      const tr = args.timeRange || "qdr:d";
      searchRes = await fetchSerperSearch(settings.serperApiKey, finalQuery, tr);
    } else if (toolName === 'tavily_news_search') {
      const recency = args.recency || "d3";
      searchRes = await fetchTavilySearch(settings.tavilyApiKey, finalQuery, "news", settings, recency);
    } else if (toolName === 'exa_research') {
      searchRes = await fetchExaSearch(settings.exaApiKey, finalQuery, settings);
    }

    // 降级兜底
    if (!searchRes && settings.serperApiKey && toolName !== 'google_macro_search') {
      console.log(`⚠️ [Agent 降级] 主节点超时，触发 Serper 兜底: ${finalQuery}`);
      searchRes = await fetchSerperSearch(settings.serperApiKey, finalQuery, "qdr:w");
    }

    const timeWarning = `[系统物理防伪探针] 现在的真实时间是 ${fullDateTimeStr}。请严格核对以下搜索结果中的【发布时间】！如果新闻是几个月前甚至几年前的，说明它是过时垃圾信息，绝对禁止作为判断依据！\n\n`;

    body.messages.push({
      role: "tool", tool_call_id: toolCall.id, name: toolName,
      content: searchRes ? (timeWarning + searchRes) : "未检索到精确数据，请停止主观臆断并告知用户缺乏数据支撑。"
    });
  } catch (e) {
    console.error(`❌ [Agent 崩溃] 武器【${toolCall.function.name}】卡壳！`);
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "接口执行异常，请忽略本次查询结果。" });
  }
};

const handleUpdateLedger = async (ctx) => {
  const { args, toolCall, body, pendingActions } = ctx;
  const actionsList = args.actions ? args.actions : (args.fundCode ? [args] : []);
  console.log(`🔥 [Agent 调度] AI 触发自主记账(支持批量)！参数:`, args);
  actionsList.forEach(act => pendingActions.push({ ...act, toolType: 'ledger' }));
  body.messages.push({
    role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
    content: `【系统提示】成功捕获 ${actionsList.length} 条记账指令，UI端将自动生成调仓卡片。🚨 强制指令：请你立刻继续完成刚才的宏观分析与调仓逻辑报告，并在报告末尾顺便告知用户调仓卡片已生成！`
  });
};

const handleManagePlanTodo = async (ctx) => {
  const { args, toolCall, body, pendingActions } = ctx;
  const plansList = args.plans || [];
  console.log(`🔥 [Agent 调度] AI 触发待办生命周期管理(增删改)！参数:`, args);
  plansList.forEach(plan => pendingActions.push({ ...plan, toolType: 'todo' }));
  body.messages.push({
    role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
    content: `【系统提示】成功捕获 ${plansList.length} 条待办指令(增/删/改)。请立刻继续输出你的建议，并在末尾提醒用户点击卡片确认授权。`
  });
};

const handleUpdateDecisionMemo = async (ctx) => {
  const { args, toolCall, body, pendingActions } = ctx;
  console.log(`🧠 [Agent 记忆觉醒] AI 正在写入核心决策备忘录:`, args);
  pendingActions.push({ ...args, toolType: 'memo' });
  body.messages.push({
    role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
    content: "【系统提示】该战略研判已成功生成记忆卡片。请继续回答用户的问题，并告知用户你已将此结论记录在备忘录中。"
  });
};

const handleUpdateFofDictionary = async (ctx) => {
  const { args, toolCall, body, pendingActions } = ctx;
  console.log(`🔥 [Agent 调度] AI 触发穿透字典采编！参数:`, args);
  pendingActions.push({ ...args, toolType: 'fof_dict' });
  body.messages.push({
    role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name,
    content: "【系统提示】FOF 穿透字典入库单据已生成。请在回复中提示用户点击卡片确认写入云端。"
  });
};

const handleGetMarketHistoricalIntraday = async (ctx) => {
  const { args, toolCall, settings, body } = ctx;
  try {
    console.log(`🔥 [Agent 调度] AI 启动历史K线溯源！目标代码:【${args.code}】`);
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

    console.log(`%c🔍 [历史K线探针] 喂给 AI 的客观数学矩阵:\n${resultStr}`, "color: #10b981; font-weight: bold;");

    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: resultStr });
  } catch (e) {
    console.error("历史K线获取失败", e);
    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "K线数据库调用异常。" });
  }
};

// ============================================================================
// 策略映射表：toolName → handler function
// ============================================================================
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
  'update_ledger': handleUpdateLedger,
  'manage_plan_todo': handleManagePlanTodo,
  'update_decision_memo': handleUpdateDecisionMemo,
  'update_fof_dictionary': handleUpdateFofDictionary,
  'get_market_historical_intraday': handleGetMarketHistoricalIntraday,
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
