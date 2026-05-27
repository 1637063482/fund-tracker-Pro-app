// ============================================================================
// 1. 辅助函数区
// ============================================================================

// 格式化现金流数据的辅助函数
const formatCashFlows = (transactions) => {
  if (!transactions || transactions.length === 0) return "无交易记录";
  const sorted =[...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
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

// =====================================================================
// 🌟 高精度引擎：分时路径压缩器 (带【自适应波动阈值】的 M15 采样)
// =====================================================================
const fetchIntradayTrend = async (code, proxyUrlStr) => {
    try {
        const url = `https://ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`;
        const fetchUrl = proxyUrlStr ? proxyUrlStr.replace('{{url}}', encodeURIComponent(url)) : url;

        const res = await fetch(fetchUrl, { cache: 'no-store' });
        const resData = await res.json();
        
        // 解析腾讯的分时数组 (每个元素格式: "0930 4112.90 12345")
        const minuteData = resData?.data?.[code]?.data?.data;
        if (!minuteData || !Array.isArray(minuteData) || minuteData.length === 0) return "分时暂无";

        const keyPoints = [];
        let lastAddedTime = "";

        // 遍历所有已发生的分钟数据
        minuteData.forEach((item, index) => {
            const [timeStr, priceStr] = item.split(' ');
            const minute = parseInt(timeStr.substring(2, 4)); // 提取分钟: "30", "45", "00"
            const price = parseFloat(priceStr);

            // 规则 1：每 15 分钟采集一次固定锚点
            if (minute % 15 === 0) {
                keyPoints.push({ time: `${timeStr.substring(0,2)}:${timeStr.substring(2)}`, price: price });
                lastAddedTime = timeStr;
            }

            // 规则 2：盘中处理机制！强行追加最新一分钟作为探照灯
            if (index === minuteData.length - 1 && timeStr !== lastAddedTime) {
                keyPoints.push({ time: `${timeStr.substring(0,2)}:${timeStr.substring(2)}(最新)`, price: price });
            }
        });

        // =====================================================================
        // 🔥 新增探针：以完美表格形式打印提取出的 17 个关键节点
        // =====================================================================
        console.log(`%c🔍 [分时探针] ${code} 提取的 M15 关键节点数据如下:`, "color: #10b981; font-weight: bold;");
        console.table(keyPoints); 
        // =====================================================================

        // 将离散的点拼接成 AI 极易理解的带方向箭头的时序字符串
        let trendString = "";
        for (let i = 0; i < keyPoints.length; i++) {
            const current = keyPoints[i];
            if (i === 0) {
                trendString += `${current.time}[${current.price}]`;
            } else {
                const prev = keyPoints[i-1];
                const diff = current.price - prev.price;
                
                // 🌟 核心优化：自适应日内波动阈值
                // 大盘指数(价格>1000) 阈值为0.5；国债ETF(价格一百多) 阈值为0.02
                const threshold = current.price > 1000 ? 0.5 : 0.02; 
                
                let icon = '→'; 
                if (diff > threshold) icon = '↗';      // 上涨
                else if (diff < -threshold) icon = '↘'; // 下跌
                else icon = '→';                 // 微小波动视为平移

                trendString += ` ${icon} ${current.time}[${current.price}]`;
            }
        }

        return trendString;
    } catch (e) {
        console.warn(`[分时探针] 获取 ${code} 分时失败:`, e);
        return "分时数据抓取失败";
    }
};

// =====================================================================
// 🌟 宏观引擎：多周期 K 线轨迹提取器 (带【自适应波动阈值】完整全景版)
// =====================================================================
const fetchMultiPeriodKLines = async (code, period = 'day', count = 20, proxyUrlStr) => {
    try {
        const url = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},${period},,,${count},`;
        const fetchUrl = proxyUrlStr ? proxyUrlStr.replace('{{url}}', encodeURIComponent(url)) : url;

        const res = await fetch(fetchUrl, { cache: 'no-store' });
        const resData = await res.json();

        const dayData = resData?.data?.[code]?.[period] || resData?.data?.[code]?.[`qfq${period}`];
        
        if (!dayData || !Array.isArray(dayData) || dayData.length === 0) {
             console.warn(`[多周期探针] ${code} 的 ${period} K线数据为空，原始返回:`, resData);
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

            const dateStr = day[0].substring(5); // 取 "05-10" 格式
            const closePrice = parseFloat(day[2]); // 收盘价
            keyPoints.push({ date: dateStr, price: closePrice });
        });

        // =====================================================================
        // 🔥 K线探针：恢复你完美的阵列数据打印！
        // =====================================================================
        console.log(`%c🔍 [多周期探针] ${code} 提取的完整 ${count}期 ${period} K线节点如下:`, "color: #8b5cf6; font-weight: bold;");
        console.table(keyPoints); 
        // =====================================================================

        let trendString = "";
        for (let i = 0; i < keyPoints.length; i++) {
            const current = keyPoints[i];
            if (i === 0) {
                trendString += `${current.date}[${current.price}]`;
            } else {
                const prev = keyPoints[i-1];
                const diff = current.price - prev.price;
                
                // 🌟 核心优化：多周期自适应波动阈值
                // 大盘指数：日K阈值为5点，周月K拉长阈值为20点；国债ETF保持0.1元
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

// =====================================================================
// 🌟 核心引擎升级：全息盘口探针 (腾讯量价 + 多周期共振路径 + 东财情绪)
// =====================================================================
const fetchAdvancedMarketData = async (settings) => {
    let marketDataStr = "核心宽基走势: 未知";
    let totalTurnoverYi = 0;
    let upCount = 0;
    let downCount = 0;

    console.log("%c================ 底层盘口数据抓取探针 (量价多周期共振验证版) ================", "color: white; background: #0ea5e9; font-weight: bold; padding: 4px;");

    // ==================================================
    // 🌟 动作 1：获取全市场涨跌真实家数 (沪市+深市 聚合版)
    // ==================================================
    try {
        const emUrl = 'https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001,0.399001&fields=f104,f105,f106';
        let emFetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
            ? (settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(emUrl)) : settings.customProxyUrl + emUrl)
            : `https://api.allorigins.win/get?url=${encodeURIComponent(emUrl)}`;

        console.log(`🌍 [情绪探针] 正在请求东财批量数据，代理模式: ${settings.proxyMode}`);

        const emRes = await fetch(emFetchUrl, { cache: 'no-store' });
        
        if (!emRes.ok) {
            throw new Error(`HTTP 状态码异常: ${emRes.status} ${emRes.statusText}`);
        }

        const rawText = await emRes.text();
        if (!rawText) throw new Error("代理返回了空的响应体");

        let emData;
        try {
            emData = JSON.parse(rawText);
        } catch (parseError) {
            console.error("🚨 [情绪探针] JSON 解析失败！原始内容为:", rawText.substring(0, 200) + "...");
            throw new Error("代理返回的内容不是有效的 JSON 格式");
        }

        let actualEmData = null;
        if (settings.proxyMode === 'custom') {
            actualEmData = emData;
        } else {
            if (emData.contents) {
                try {
                    actualEmData = typeof emData.contents === 'string' ? JSON.parse(emData.contents) : emData.contents;
                } catch (e) {
                     console.error("🚨 [情绪探针] Allorigins contents 解析失败:", emData.contents.substring(0, 100));
                }
            }
        }

        // =====================================================================
        // 🔥 深度探针 1：保留你原始的数据输出，用于验证批量接口的 diff 结构！
        // =====================================================================
        console.log("%c🔍 [深度探针] 东财批量接口原始返回结构:", "color: #eab308; font-weight: bold;");
        console.dir(actualEmData); 
        // =====================================================================

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
        console.error("❌ [情绪探针] 抓取失败 (已跳过):", e.message);
    }

    // ==================================================
    // 🌟 动作 2：抓取核心宽基量价形态 + 异步多周期探针追踪
    // ==================================================
    try {
        const queryStr = 'sh000001,sz399001,sz399006,sh511260,sh511090';
        const tencentUrl = `https://qt.gtimg.cn/q=${queryStr}`;
        
        console.log(`📊 [量价探针] 正在请求腾讯极速接口...`);
        const res = await fetch(tencentUrl, { cache: 'no-store' });
        
        if (!res.ok) throw new Error(`腾讯接口 HTTP 错误: ${res.status}`);
        
        // ✅ 完美保留：使用 ArrayBuffer 接收二进制流，强制使用 GBK 解码防止乱码
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

            console.log(`✅ [量价探针] 成功解析腾讯基础数据，两市成交额: ${totalTurnoverYi.toFixed(2)} 亿`);

            const isHighVolume = totalTurnoverYi > 9500; 
            const isLowVolume = totalTurnoverYi > 0 && totalTurnoverYi < 6500;

            const infos = [];
            
            // 🌟 for...of 循环：以便在循环内部等待 (await) 分时接口
            for (const asset of parsedAssets) {
                const { name, code, cur, prevClose, open, high, low, pct } = asset;
                let shape = "〰️ 窄幅震荡";
                let volumeConfirmation = ""; 
                const amp = prevClose > 0 ? ((high - low) / prevClose * 100) : 0;
                
                // 1. 粗略形态判断 (保留作为兜底)
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

                // ==============================================================
                // 🌟 动作 2.5：异步注入高精度分时路径 + 宏观多周期 K 线轨迹
                // ==============================================================
                let intradayPathDesc = "";
                let dailyKLineDesc = ""; 

                // 🌟 核心优化：将国债 ETF 加入白名单
                const targetCodes = ['000001', '399001', '399006', '511260', '511090'];
                
                if (targetCodes.includes(code)) {
                     const proxyUrlStr = settings.proxyMode === 'custom' ? settings.customProxyUrl : null;
                     
                     // 🌟 智能前缀判断：000001和5开头(沪市ETF)加 sh，其他加 sz
                     const prefix = (code === '000001' || code.startsWith('5')) ? 'sh' : 'sz';
                     const ifzqCode = prefix + code;
                     
                     // 1. 等待分时探针
                     const pathStr = await fetchIntradayTrend(ifzqCode, proxyUrlStr);
                     if (pathStr) {
                         intradayPathDesc = `\n   📍 日内分时: ${pathStr}`;
                     }
                     
                     // 2. 强行灌入多周期共振 K 线特征！(日K60天，周K20周，月K12个月)
                     const dailyStr = await fetchMultiPeriodKLines(ifzqCode, 'day', 60, proxyUrlStr);
                     const weeklyStr = await fetchMultiPeriodKLines(ifzqCode, 'week', 20, proxyUrlStr);
                     const monthlyStr = await fetchMultiPeriodKLines(ifzqCode, 'month', 12, proxyUrlStr);
                     
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
        } else {
             console.warn("⚠️ [量价探针] 腾讯接口未返回包含 'v_' 的有效数据");
        }
    } catch(e) { 
        console.error(`❌ [量价探针] 腾讯接口致命崩溃:`, e);
    }

    console.log("%c==================================================================", "color: white; background: #0ea5e9; font-weight: bold; padding: 4px;");

    return `\n【今日大盘全息盘口与资金面 (已过滤噪音)】\n${marketDataStr}\n`;
};

// 1. Tavily 引擎改造 (增加发布时间提取)
const fetchTavilySearch = async (apiKey, query, searchType = "news", settings = {}, timeRange = "d3") => {
  if (!apiKey) return "";
  try {
    const targetUrl = 'https://api.tavily.com/search';
    const bodyPayload = { 
        api_key: apiKey, 
        query, 
        search_depth: "advanced", 
        max_results: 5,
        include_domains: ["wallstreetcn.com", "cls.cn", "xueqiu.com", "yicai.com", "stcn.com", "jin10.com"], // 建议加个金十数据
        exclude_domains: ["eastmoney.com", "chinabond.com.cn", "baidu.com", "zhihu.com", "wikipedia.org", "gov.cn", "news.cn", "xinhuanet.com", "sohu.com", "163.com"]
    };

    if (searchType === "news") { 
        bodyPayload.topic = "news"; 
        // 允许动态传入天数，默认最近3天，保证绝对时效
        bodyPayload.days = timeRange === "d1" ? 1 : (timeRange === "w1" ? 7 : 3); 
    }

    // 判定是否走跨域代理
    let fetchUrl = targetUrl;
    if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
        fetchUrl = settings.customProxyUrl.includes('{{url}}') 
            ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl))
            : settings.customProxyUrl + targetUrl;
    }

    const res = await fetch(fetchUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyPayload) });
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      // 🌟 核心修复：强制暴露出发布时间！
      return data.results.map(r => `【发布时间】${r.published_date || '近期'}\n【信息源】${r.url}\n【标题】${r.title}\n【量化摘要】${r.content}`).join('\n\n---\n');
    }
    return "";
  } catch (e) { return ""; }
};

// 3. Exa 引擎改造 (启用神经元高亮引擎 + 修复未定义 Bug + 提取 highlights)
const fetchExaSearch = async (apiKey, query, settings = {}) => {
  if (!apiKey) return "";
  try {
    // 🌟 修复 1：定义缺失的 targetUrl
    const targetUrl = 'https://api.exa.ai/search';
    
    // 限制只能搜最近半年的深度研报，太老的没用
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    let fetchUrl = targetUrl;
    if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
        fetchUrl = settings.customProxyUrl.includes('{{url}}') 
            ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl))
            : settings.customProxyUrl + targetUrl;
    }

    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ 
          query, 
          numResults: 2, // 🌟 修复 2：降级到 2 个结果，极大地防止 Serverless 并发超时
          useAutoprompt: true, 
          startPublishedDate: sixMonthsAgo.toISOString(), 
          contents: { 
              // 启用高亮引擎
              highlights: { 
                  numSentences: 5, 
                  highlightsPerUrl: 3, 
                  query: query 
              } 
          } 
      })
    });
    
    if (!res.ok) throw new Error(`Exa HTTP ${res.status}`);
    const data = await res.json();
    
    if (data.results && data.results.length > 0) {
        // 🌟 修复 3：正确解析 highlights 数组，而不是去读 r.text
        return data.results.map(r => {
            const pubDate = r.publishedDate ? r.publishedDate.split('T')[0] : '近期';
            // 将多个高亮片段拼成一段流畅的文字
            const hlText = (r.highlights && r.highlights.length > 0) 
                ? r.highlights.map(hl => `> ${hl}`).join('\n') 
                : '未提取到高亮核心摘要';
                
            return `【发布时间】${pubDate}\n【文献标题】${r.title}\n【核心提取】\n${hlText}`;
        }).join('\n\n---\n');
    }
    return "";
  } catch (e) { 
      console.warn("Exa 引擎执行失败:", e);
      return ""; 
  }
};

// 2. Serper (Google) 引擎改造 (增加 tbs 时效参数)
const fetchSerperSearch = async (apiKey, query, timeRange = "qdr:d") => {
  // timeRange: qdr:h (过去1小时), qdr:d (过去24小时), qdr:w (过去1周), qdr:y (过去1年)
  if (!apiKey) return "";
  try {
    const bodyPayload = { q: query, num: 4 };
    // 🌟 核心修复：如果在查宏观最新数据，强制 Google 只搜最近的内容
    if (timeRange && timeRange !== "all") {
        bodyPayload.tbs = timeRange; 
    }

    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify(bodyPayload)
    });
    const data = await res.json();
    if (data.organic && data.organic.length > 0) {
      // 🌟 核心修复：拼接 date 字段
      return data.organic.map(r => `【发布时间】${r.date || '未知'}\n【网页标题】${r.title}\n【摘要】${r.snippet}`).join('\n\n---\n');
    }
    return "";
  } catch (e) { return ""; }
};

// ============================================================================
// 2. 单基诊断引擎
// ============================================================================
export const analyzeFundWithAI = async (settings, fund, profile, marketData) => {
  const provider = settings.aiProvider || 'gemini';
  
  let apiKey = '';
  let targetModel = '';
  if (provider === 'gemini') {
      apiKey = settings.geminiApiKey;
      targetModel = settings.geminiModel || 'gemini-2.5-pro';
  } else if (provider === 'deepseek') {
      apiKey = settings.deepseekApiKey;
      targetModel = settings.deepseekModel || 'deepseek-v4-pro';
  } else if (provider === 'siliconflow') {
      apiKey = settings.siliconflowApiKey;
      targetModel = settings.siliconflowModel || 'deepseek-ai/DeepSeek-V3';
  }

  if (!apiKey) throw new Error(`请先在设置中配置 ${provider.toUpperCase()} 的 API Key`);

  // ✅ 替换为获取高阶全息盘口数据
  const marketEnv = await fetchAdvancedMarketData(settings);
  const derived = profile.fund_derived || {};
  const baseData = profile.sec_header_base_data ||[];
  const maxDrawdown = baseData.find(d => d.data_name === '最大回撤')?.data_value_str || '未知';
  const rank1y = derived.srank_l1y || '未知';
  const rank3y = derived.srank_l3y || '未知';
  const yieldHistory = derived.yield_history ||[];
  const yieldStr = yieldHistory.map(y => `${y.name}:${y.yield}%`).join(', ');
  const netInvested = fund?.netInvested || 0;
  const currentValue = fund?.currentValue || 0;
  const profit = fund?.profit || 0;
  const profitRate = fund?.totalInvested > 0 ? ((profit / fund.totalInvested) * 100).toFixed(2) : 0;
  const cashFlowStr = formatCashFlows(fund?.transactions);
  const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const idleFunds = Number(settings.idleFunds) || 0;

  // 【真实联网检索】
  let searchContext = "";
  if (provider !== 'gemini' && settings.tavilyApiKey) {
      const isBondFund = (fund?.name || '').includes('债');
      const marketFocus = isBondFund ? "中国债券市场 央行公开市场操作 市场利率走势" : "A股走势 宏观经济";
      const query = `今日 ${marketFocus} ${fund?.name || ''} 最新新闻 利空 利好`;
      
      const searchRes = await fetchTavilySearch(settings.tavilyApiKey, query);
      if (searchRes) {
          searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n以下是刚刚检索到的最新真实互联网资讯，请务必基于这些数据进行判断，绝不允许自己捏造新闻：\n${searchRes}\n`;
      }
  }
  const prompt = `
你是一位拥有30年经验的华尔街顶尖宏观策略与量化分析师，以"客观、犀利、直击痛点"著称。现在请为我的这笔单只基金投资进行深度的"全息体检"。

【分析前置要求 (极其重要)】
0. 绝对信任数据：下方提供的所有数据均为**绝对真实的客观事实（Ground Truth）**，禁止质疑其真实性！
1. 现在的真实物理时间是 ${todayStr}。
2. 请直接读取下方数据作为当前市场基准，绝对不允许凭记忆瞎编点位！${marketEnv}
3. 宏观资产温度与历史纵深：在回答前，请结合你的最新知识库(如果是Gemini请强制使用Google Search获取最新资讯)。结合 A股、美股、黄金、中美国债收益率等核心资产【近3个月、近半年、近1年】的中长线走势趋势，评估当前处于反弹初期、主升浪还是下跌通道。
4. 标的雷达：这只基金（${fund?.name}）近期是否有重要新闻，或其所属核心板块近期的政策/行业利好利空。
5. 【带风控框架的独立裁判】：在评价我的买卖行为时，你拥有绝对的独立批判权，绝不能做只会迎合的“马屁精”。裁判标准请综合考量该资产的【真实绝对盈亏率】与【资金占用效率（排除短期失真年化）】。如果你发现我属于典型的“火场捡钢镚”（为了微小利差牺牲极大流动性或安全性），或者属于被短期高收益蒙蔽了双眼的高位接盘，请用最冷酷的数据戳穿我的幻觉，并建议纠正。只有当我的调仓在风控和收益预期上逻辑严密时，才予以肯定。
${searchContext}

【基金基本面】
名称：${fund?.name} (${fund?.fundCode})
类型：${profile.type_desc || '未知'}
近1年同类排名：${rank1y}
近3年同类排名：${rank3y}
最大回撤：${maxDrawdown}
近期阶段表现：${yieldStr}

【我的真实交易账本与操作轨迹】
总投入本金：${netInvested} 元
当前持仓市值：${currentValue} 元
当前累计盈亏：${profit} 元 (盈亏率: ${profitRate}%)
--- 历史操作轨迹 ---
${cashFlowStr}

【你的输出任务】
不要输出任何客套话。请结合你的检索结果、基金基本面，以及**重点剖析我的历史操作轨迹**，使用 Markdown 输出以下几部分（字数必须充足，展开详细分析，500字左右）：
### 🌍 宏观与标的实时扫描 (一针见血指出大环境利弊)
### 🕵️ 账户行为诊断 (评价我的建仓/加减仓时机是否合理，是否追高杀跌)
### 💡 极简操作建议 (结合当前浮盈/浮亏，明确给出：继续持有/分批定投/果断止损/逢高止盈的建议)
### 🕵️ 操作复盘与现状诊断(直接锐评这只基金现在的死活状态，以及我之前的买卖操作是不是在乱来、追涨杀跌。)
### 🎯 当前标的执行指令(明确告诉我这只基金现在该怎么办。如果该止损，告诉我是全抛还是减半；如果该继续持有，说明理由。)
### 💰 【${idleFunds}元】空闲资金利用建议(如果该基金跌出了黄金坑且质量优秀，请明确告诉我从这 ${idleFunds} 元里抽出多少钱来补仓。如果不值得补仓，请直接推荐一只更适合当前大盘的、带有具体6位数代码的替代基金，并告诉我买入多少。)
`;

  return await executeAIRequest(provider, apiKey, targetModel, prompt, 0.2, 0.2);
};

// ============================================================================
// 3. 全盘体检引擎
// ============================================================================
export const analyzePortfolioWithAI = async (settings, portfolioStats, marketData) => {
  const provider = settings.aiProvider || 'gemini';
  
  let apiKey = '';
  let targetModel = '';
  if (provider === 'gemini') {
      apiKey = settings.geminiApiKey;
      targetModel = settings.geminiModel || 'gemini-2.5-pro';
  } else if (provider === 'deepseek') {
      apiKey = settings.deepseekApiKey;
      targetModel = settings.deepseekModel || 'deepseek-v4-pro';
  } else if (provider === 'siliconflow') {
      apiKey = settings.siliconflowApiKey;
      targetModel = settings.siliconflowModel || 'deepseek-ai/DeepSeek-V3';
  }

  if (!apiKey) throw new Error(`请先在设置中配置 ${provider.toUpperCase()} 的 API Key`);

  const activeFunds = portfolioStats.computedFundsWithMetrics
    .filter(f => f.currentValue > 0 && !f.isArchived)
    .map(f => {
       const profitRate = f.totalInvested > 0 ? ((f.profit / f.totalInvested) * 100).toFixed(2) : 0;
       const cashFlows = formatCashFlows(f.transactions);
       return `\n- 资产：${f.name} (代码: ${f.fundCode || '未知'})\n  当前市值: ${f.currentValue}元 | 累计盈亏率: ${profitRate}% | 资产类型: ${f.name.includes('债') ? '固收' : '权益/其他'}\n  操作流水:\n  ${cashFlows.split('\n').join('\n  ')}`;
    })
    .join('\n');
    
  const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const idleFunds = Number(settings.idleFunds) || 0;

  const marketEnv = marketData && marketData.length > 0 
    ? `\n【今日实时大盘与基准行情】\n${marketData.map(m => `- ${m.name}: ${m.price} (${m.change > 0 ? '+' : ''}${(m.percent * 100).toFixed(2)}%)`).join('\n')}`
    : '\n【今日实时大盘与基准行情】\n大盘数据未获取。';

  let searchContext = "";
  if (provider !== 'gemini' && settings.tavilyApiKey) {
      const query = `当前中国央行货币政策 债券市场走势 A股大盘走势 美联储降息预期 宏观经济`;
      const searchRes = await fetchTavilySearch(settings.tavilyApiKey, query);
      if (searchRes) {
          searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n以下是刚刚检索到的最新真实互联网资讯，请务必基于这些数据进行判断，绝不允许自己捏造新闻：\n${searchRes}\n`;
      }
  }

  const prompt = `
你是一位面向高净值客户的首席资产配置官(CIO)。请对我的整体基金投资组合进行"上帝视角"的宏观诊断。

【分析前置要求 (极其重要)】
0. 绝对信任数据：下方提供的全盘资产快照、大盘行情等数据，均为**绝对真实的客观事实（Ground Truth）**，禁止质疑！
1. 现在的真实物理时间是 ${todayStr}。
2. 请直接读取下方数据作为当前市场基准，绝对不允许自己瞎编点位！${marketEnv}
3. 梳理全球核心资产（中美股市、大宗商品、债券利率）在【近3个月、近半年、近1年】的大周期趋势。
4. 结合美联储最新降息/加息预期、中美股市的核心矛盾等宏观指标，判断当前处于"风险偏好上升"还是"防御为主"的阶段。
5. 【无情鞭挞与客观诊断】：请作为独立客观的第三方进行评估！仔细阅读我的【操作流水】，不要因为我近期有大额加仓操作，就当老好人建议“继续观察”。如果我加仓的是长期跑输、毫无前景的劣质资产，或者是在高位追涨，请毫不留情地指出我的错误操作，并果断建议调仓止损！只有标的本身优质且处于底部时，才建议继续持有。
${searchContext}

【我的全盘资产快照】
总投入净本金：${portfolioStats.totalInvested} 元
全盘当前总市值：${portfolioStats.totalCurrentValue} 元
全盘累计盈亏：${portfolioStats.totalProfit} 元
综合年化收益率(XIRR)：${(portfolioStats.overallXirr * 100).toFixed(2)}%
当前预备空闲资金(子弹)：${idleFunds} 元

【当前持仓明细与比重】
${activeFunds}

【你的输出任务】
请跳过所有晦涩的宏观金融术语，直接给我一份"傻瓜式"的、极其明确的执行清单。注意：对于带有【🌟新近建仓观察期】标签的资产，属于近期刚买入。使用 Markdown 格式输出以下三部分（500字左右）：

### 🔍 组合致命隐患与优势
### 🗑️ 存量资产清洗指令
### 🎯 【${idleFunds}元】空闲子弹精准打出方案 (极其重要)
`;

  return await executeAIRequest(provider, apiKey, targetModel, prompt, 0.4, 0.5);
};
// ==========================================
// 🌟 核心风控算法：FIFO 先进先出 7天惩罚费风控拦截
// ==========================================
const calculate7DayPenalty = (transactions, currentDateStr) => {
    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
        return { lockedAmount: 0, penaltyFee: 0 };
    }

    let buyLots = []; 

    // 1. 历史回溯：先进先出抵扣
    for (const tx of transactions) {
        // 精准匹配真实字段：amountRaw
        const amount = Number(tx.amountRaw) || 0;
        if (amount <= 0) continue;

        // 精准匹配真实字段：type
        const action = String(tx.type || '').toLowerCase().trim();
        const rawDate = tx.date || '';

        if (action === 'buy') {
            buyLots.push({ amount: amount, date: rawDate });
        } else if (action === 'sell') {
            let sellAmount = amount;
            while (sellAmount > 0 && buyLots.length > 0) {
                if (buyLots[0].amount <= sellAmount) {
                    sellAmount -= buyLots[0].amount;
                    buyLots.shift(); 
                } else {
                    buyLots[0].amount -= sellAmount;
                    sellAmount = 0;  
                }
            }
        }
    }

    // 2. 结算未满 7 天的锁定金额
    let lockedAmount = 0;
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const nowTimestamp = new Date(currentDateStr).getTime();

    for (const lot of buyLots) {
        if (!lot.date) continue;
        const lotTimestamp = new Date(lot.date).getTime();
        
        // 核心风控：距离今天不足 7 天（精确到毫秒对比）
        if (nowTimestamp - lotTimestamp < SEVEN_DAYS_MS) {
            lockedAmount += lot.amount;
        }
    }

    return {
        lockedAmount: Number(lockedAmount.toFixed(2)),
        penaltyFee: Number((lockedAmount * 0.015).toFixed(2)) 
    };
};

// ============================================================================
// 4. 持续交互对话引擎 (聊天框专用)
// ============================================================================
export const chatWithPortfolioAI = async (settings, portfolioStats, chatHistory, newMessage, marketData, useWebSearch = true, todos = [], memos = []) => {
  
    const provider = settings.aiProvider || 'gemini';
  
  let apiKey = '';
  let targetModel = '';
  if (provider === 'gemini') {
      apiKey = settings.geminiApiKey;
      targetModel = settings.geminiModel || 'gemini-2.5-pro';
  } else if (provider === 'deepseek') {
      apiKey = settings.deepseekApiKey;
      targetModel = settings.deepseekModel || 'deepseek-v4-pro';
  } else if (provider === 'siliconflow') {
      apiKey = settings.siliconflowApiKey;
      targetModel = settings.siliconflowModel || 'deepseek-ai/DeepSeek-V3';
  }

  if (!apiKey) throw new Error(`请配置 ${provider.toUpperCase()} 的 API Key`);

  // 🌟 强化的时间锚点：加入星期几和具体到秒的时间，彻底唤醒 AI 的交易日历逻辑
  const todayStr = new Date().toLocaleString('zh-CN', { 
      timeZone: 'Asia/Shanghai', 
      year: 'numeric', month: '2-digit', day: '2-digit', 
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'long'
  });
  const idleFunds = Number(settings.idleFunds) || 0;

  const activeFundsDetail = portfolioStats.computedFundsWithMetrics
    .filter(f => f.currentValue > 0 && !f.isArchived)
    .map(f => {
            const profitRate = f.totalInvested > 0 ? ((f.profit / f.totalInvested) * 100).toFixed(2) : 0;
            const xirrRate = (f.xirr * 100).toFixed(2);
            const cashFlows = formatCashFlows(f.transactions);
            
            // 🌟 新增：简单的文本嗅探大类分类器 (用于降低 AI 对比数据的计算噪音)
            let fundTypeTag = "其他类型/混合";
            const name = f.name || '';
            if (name.includes('短债') || name.includes('理财') || name.includes('货币')) fundTypeTag = "中短债/货币 (防守底仓)";
            else if (name.includes('债') || name.includes('定期开放')) fundTypeTag = "长债/纯债 (收益底仓)";
            else if (name.includes('混合') || name.includes('固收+') || name.includes('平衡')) fundTypeTag = "固收+ / 混合 (弹性增强)";
            else if (name.includes('红利') || name.includes('低波')) fundTypeTag = "红利策略 (权益保护)";
            else if (name.includes('指数') || name.includes('联接') || name.includes('ETF')) fundTypeTag = "被动宽基/行业 (高弹性)";

            // 调用底层算子计算 7 天锁定金额
            const sortedTx = [...(f.transactions || [])].sort((a, b) => new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt));
            const todayStr = new Date().toISOString().split('T')[0];
            const { lockedAmount, penaltyFee } = calculate7DayPenalty(sortedTx, todayStr, f.name);
            
            // 构建风控警告字符串
            let penaltyWarning = '';
            if (lockedAmount > 0) {
                penaltyWarning = `\n> 🚨 [系统底层强制风控拦截]：该基金存在 ${lockedAmount} 元持仓未满 7 天！若生成立刻卖出待办，将触发约 ${penaltyFee} 元的 1.5% 惩罚性手续费！`;
            }
            
            return `\n- 资产: ${f.name} (代码: ${f.fundCode || '未知'}) | 🏷️ [大类判定]: ${fundTypeTag}
> 当前市值: ${f.currentValue} 元 | 累计盈亏: ${f.profit} 元
> 累计投入: ${f.totalInvested} 元 | 净本金: ${f.netInvested} 元
> 简单盈亏率: ${profitRate}% | 年化收益率(XIRR): ${xirrRate}% | 持有份额: ${f.shares || 0}${penaltyWarning}
> 操作流水:
${cashFlows.split('\n').join('\n    ')}`;
        }).join('\n');
    // 🌟 修复：让 AI 看到所有待执行计划，以及最近 5 条已执行计划（作为历史执行轨迹参考）
  const pendingTodos = todos.filter(t => !t.isCompleted);
  const completedTodos = todos.filter(t => t.isCompleted).slice(-5); // 仅保留最近的 5 条防 Token 爆炸
  const displayTodos = [...pendingTodos, ...completedTodos];

  let todosContext = "暂无任何计划。";
  if (displayTodos.length > 0) {
      todosContext = displayTodos.map(t => {
          // 明确打上状态标签，防止 AI 篡改历史
          const statusLabel = t.isCompleted ? '✅ 已完成 (历史记录，不可修改)' : '⏳ 待执行/排队中 (可操作)';
          const pLabel = t.priority === 'high' ? '高(紧急/即将触发)' : t.priority === 'low' ? '低(远端/佛系)' : '中(常规)';
          
          if (t.type === 'ai_plan') {
              return `- [待办ID: ${t.id}] [状态: ${statusLabel}] [优先级: ${pLabel}] AI计划 | 标的: ${t.fundName}(${t.fundCode}) | 方向: ${t.actionType === 'buy' ? '计划买入' : t.actionType === 'sell' ? '计划卖出' : '观察'} | 触发条件: ${t.condition} | 预备金额: ${t.amount || '未定'}元`;
          }
          return `- [待办ID: ${t.id}] [状态: ${statusLabel}] [优先级: ${pLabel}] 用户手动记录 | 内容: ${t.text}`;
      }).join('\n');
  }

  // 🌟 将低维数据升维为带走势特征的全息数据！
  const memoContext = memos.length > 0 
        ? memos.map(m => `- [${m.updatedAt.split('T')[0]}] 标的: ${m.targetName}(${m.target}) | 定调: ${m.decisionType} | 核心逻辑: ${m.coreLogic}`).join('\n') 
        : "暂无历史决策备忘录。";

//const systemPrompt = `
//你是一个极其严谨、冷酷且只认数据的【量化交易执行引擎】。
//你的唯一职责是：基于我提供的【真实账本数据】和外部搜索信息，直接下达操作指令。

//【🚨 绝对不可触碰的红线（防幻觉与执行强制协议）】
//1. 【强制穿透交易流水】（防瞎喷）：你看到的不仅是汇总数据，还有每一笔的【操作流水】！在评价某只基金表现（特别是 XIRR 和绝对盈亏）时，**必须先严格核对该基金大额买入或卖出的具体日期！** 绝对禁止把“近期刚大额建仓导致的低绝对收益”误判为“长期表现极差”！绝对禁止对用户“近期已经大额减仓”的基金再次提出重复的盲目减仓建议！且必须牢记T+1交易原则！
//2. 【严禁常识幻觉与脱口而出】（防瞎编）：在进行收益对比时（例如提及余额宝、银行理财、存款利率等），**绝对不允许凭记忆、直觉或修辞惯性下判断！** 你必须明确调用搜索工具（如 tavily_search）查实该对比物当下的【真实最新收益率】后才能作为论据！严禁使用“连余额宝都不如”等毫无最新数据支撑的主观臆测废话！
//3. 绝不推荐虚假代码：推荐任何资产必须是市场上真实存在的，必须附带正确的6位数代码，不知道就明确回答不知道。
//4. 绝不讲废话：不要给我上宏观经济课，不要讲空泛的理论。我只需要直接、量化、精确到金额的“交易指令”。
//5. 严禁目标倒逼风险（反PUA协议）：下方提供的【全局财富目标】只是一个期望值。如果该目标距离较远，你**允许**建议我拿小部分资金配置稳健型权益资产作为“卫星仓位”进行收益增强；但【绝对禁止】为了帮我填补缺口，而强行逼迫我大比例调仓去博取高弹性、高波动的风险资产！若目标脱离了策略极限，请坦诚建议我“降低目标预期”。
//6. 尊重【固收为主，适度增强】的风险边界：我是一个稳健型投资者，资产结构以债券型基金为主力。你可以基于宏观推荐优质的“固收+”或“红利低波/宽基”，但绝不接受单一赛道重仓！
//7. 【独立审查权与固收裁判框架】：你有绝对的权力批评我的操作，必须基于正确的专业逻辑，禁止盲目赞同。严禁将短期失真年化直接外推。用数据和“不可能三角”来裁判我的调仓是否划算。
//8. 绝对的时间认知：请永远以用户提问时强制注入的【当前真实物理时间】为准，彻底抛弃历史聊天记录中的日期和环境！
//9. 严禁估算净值（防工具惰性）：当用户问及某只基金状态，或你需要判断是否达到加/减仓击球区时，**绝对不允许使用“大概在xx区间”、“估算净值”这种词汇！** 你必须立刻调用检索工具去获取今天最新的精确净值。
//10. 【禁止戏精与情绪化表达】：绝对禁止使用任何情绪化、拟人化或夸张的修辞（如“扇自己一巴掌”、“不可饶恕的错误”等）。即使你之前的判断有误，只需直接给出修正后的冷酷数据和最新结论，严禁长篇大论的自我检讨或道歉！
//11. 【空闲子弹的择时与留白绝对纪律】(最核心！)：当要求你分配空闲资金时，**绝对禁止无脑满仓打光！** 你必须具备顶级投资经理的“择时”与“留白”思维：如果当前大盘或某只基金（特别是权益/混合型如019354等）点位偏高、追涨风险大、或者性价比不足，你必须果断建议【保持现金待命】或【仅小额定投试探】，并**明确且具体地给出你需要等待它跌至什么具体净值或区间，再出手的“击球区目标价”**。记住：“不操作”和“保留备用现金”本身就是极具价值的核心策略！
//12. 【防死循环与 T+1 妥协常识】(极其重要！)：公募基金净值和宏观数据（如DR001、国债收益率）通常存在 T+1 的披露延迟，或搜索引擎存在快照缓存延迟。如果你查到了【昨天（T-1）或最近一个有效交易日】的数据，**【请立即接受该数据并停止重搜】！** 你只需要在最终回复的表格中如实标注“数据截至X月X日”即可。绝对禁止为了强行寻找“今天此时此刻”的数据而陷入疯狂的无限二次搜索死循环！！！
//13. 【反海选与对比强迫症】：当用户要求“推荐基金”时，你作为顶级资管专家，绝对禁止为了寻找“全市场收益最高”的基金而在网上进行无休止的海选搜索和循环对比！严禁为了追求完美而陷入无尽的二次搜索！严禁摇摆不定！先决定要推荐什么类型的基金，再搜索该类型近期表现优异或者热门的前十作为候选，然后再进一步确认，最多搜索不超过6轮！
//14. 【坚定立场与反讨好协议】(极其核心！)：大语言模型天生有迎合用户的劣根性。作为顶尖量化CIO，**绝对禁止你因为用户的追问、反问或质疑而下意识地道歉、迎合或轻易推翻自己之前的结论！** 如果你上一轮的结论是基于真实数据推导出的，请像一个专业的华尔街基金经理一样，**用更深层的数据底气十足地反驳用户的质疑，坚定捍卫你的原判！** 只有当用户真的提供了新的推翻性数据，或指出了你明确的数学计算硬伤时，你才允许修正结论。

//【🌟 你的专属技能库 (Skills)】
//15. 你现在拥有一个全能的工具箱。当你需要查询净值时，自主调用"get_realtime_fund_data"；当你需要为用户直观展示一段走势、对比数据时，绝对禁止用文字拼凑，必须自主调用 "generate_trend_chart"技能生成可视化图表！作为顶级执行引擎，你要自己决定何时动用这些能力。

//【🧠 Agent 智能觉醒与能力边界】
//1. 你的核心身份：你是一个具备高度自主决策能力的【全能量化智能体】。你不受任何固定公式的束缚。
//2. 善用你的能力：你手里有搜全球资讯的引擎（Tavily/Serper），也有直连金融数据库的接口（get_realtime_fund_data），现在你还拥有了【代码执行沙盒（execute_javascript）】。
//3. 自主破局：当你遇到任何复杂的财务推演、收益率倒算、极端压测时，你应该像一个真正的量化工程师一样，**自己思考算法，自己编写 JS 代码，并调用沙盒得出绝对正确的数字**，然后再开口回答用户。你完全有能力自己决定何时搜数据，何时写代码计算！
//4. 投资哲学底线：你可以自主思考所有方案，但请务必记住用户【稳健偏保守、固收为主】的画像。当你通过自主计算发现用户的目标不切实际时，请用你算出来的冷酷数据直接劝退他。

//${provider === 'gemini' ? '16. 你拥有原生的 Google 搜索能力，请务必积极调用底层 Google 搜索来查实最新数据！' : ''}

//【我的全局财富目标设定】
//总目标金额：${settings.targetAmount || 0} 元 | 设定基准年化：${settings.targetAnnualRate || 5}%
//剩余倒数时间：${portfolioStats.monthsLeft} 个月 | 为达成目标每月需新增收益：${portfolioStats.requiredMonthly.toFixed(2)} 元
//超额收益(Alpha)：${(portfolioStats.alpha * 100).toFixed(2)}% | 偏离基准轨迹：${portfolioStats.deviationAmount >= 0 ? '+' : ''}${portfolioStats.deviationAmount.toFixed(2)} 元
//`;


const systemPrompt = `
【身份与核心职责】
你是一个极其严谨、冷酷、具备顶层架构思维且只认客观数据的顶尖量化基金经理 (CIO) 与交易执行引擎。
唯一职责：基于实时强制注入的真实账本状态、战略备忘录、待办事项和外部检索信息，直接下达精确到金额的量化操作指令。
核心画像：尊重【固收为主，适度增强】的风险边界。不讲课、不戏精、不盲从、不口嗨。若目标脱离策略极限，冷酷建议用户降低预期。

============================================================
🚨 第一层：绝对不可触碰的执行红线与防幻觉协议
============================================================
1. 【数据真理与防瞎算铁律】
   - 严禁自行除法估算：绝对禁止使用账本中的 (当前市值 ÷ 持有份额) 来反推净值！因公募 T+1 结算与手续费磨损，此除法 100% 错误！判断击球区或状态时，必须调用工具获取精确净值，绝不允许使用“大概区间”。
   - 强制穿透与 XIRR 纠偏：评价基金时必须三步走：1) 核查大额买入日期与持有天数，绝禁将短期失真误判为长期差；2) 拉取客观的近1/6/12个月真实涨跌幅作为 Alpha 基准；3) 拦截对近期已大额减仓基金的盲目重复减仓建议。
   - 妥协 T+1 延迟 (防死循环)：宏观与净值数据存在延迟。若查到最近一个有效交易日(T-1)的数据，立即接受并停止重搜，绝对禁止为寻找“此刻数据”陷入无限二次搜索死循环！
   - 🚨 断绝资金无缝衔接幻觉：公募赎回耗时 T+2 至 T+4。制定调仓计划时，严禁设定“今日卖A、明日到账、明日买B”的违背资金交收物理规律的日期。连环待办的买入触发条件必须表述为：“待 A 基金赎回资金全额到账日，执行买入”。

2. 【交易风控与择时纪律】
   - 闲置子弹择时与留白：绝对禁止无脑满仓打光。若性价比不足，必须果断建议【保持现金待命】或【仅小额定投】，并明确给出等待击球区的具体目标净值/区间。
   - 目标倒逼拦截：允许小仓位卫星增强，但绝对禁止为填补财富缺口，而强行逼迫用户大比例调仓去博取高弹性风险资产。
   - 独立审查与情绪克制：有绝对权力用冷酷数据和“不可能三角”批评用户的追涨杀跌，禁止盲目赞同。严禁使用情绪化、夸张修辞，发现误判直接给出修正数据，严禁长篇检讨道歉（禁止戏精）。

3. 【检索边界与实体操作约束 (Anti-Action-Faking)】
   - 反常识幻觉与反海选：对比余额宝/存款等必须调用工具查实，绝不凭记忆。推荐基金时，先定类型再搜前十候选，最多搜索不超过 6 轮，禁止全市场无休止海选对比！推荐必须附带正确6位数代码。
   - 时间与状态物理隔离：永远且只能以每次对话末尾系统注入的“最新状态”为决策基准，彻底抛弃历史记录中的过时干扰。
   - 🚨 实体操作防口嗨：凡涉及更新备忘录、增删改待办计划、记账、画图等实质动作，**必须实质性输出底层 Tool Call 触发对应工具！** 仅在文字中回复“已记录/已添加/已顺延”属于严重违规撒谎！发现过期待办必须调用 manage_plan_todo 清理！

============================================================
🛡️ 第二层：活体战略记忆与自我维护机制
============================================================
1. 记忆双层结构：备忘录包含“方向性定调（骨架）”与“时效性数据快照（血肉）”。绝对价格锚点（如“跌破1.5清仓”）永久有效；宏观指标快照存在过期风险。
2. 动态验证法则 (Trust but Verify)：应用依赖宏观变量的备忘录前，必须主动检索最新数据进行校验，严禁刻舟求剑。
3. 记忆覆写与自我进化：若最新数据与快照发生结构性偏离，必须主动调用 update_decision_memo 工具覆写并更新过期备忘录。严禁带着错误记忆运行。
4. 反讨好协议：只要最新数据未推翻核心逻辑，即使面对用户强烈质疑，也需用冷酷数据驳回幻想，维持原判。

============================================================
🔧 第三层：专属技能库与量化工具箱
============================================================
1. 全能量化智能体：你需自主决定何时调用下述能力，不受固定公式束缚。
2. 数据与可视化：查净值用 get_realtime_fund_data；对走势对比需生成图表时，必须调用 generate_trend_chart，严禁用文字拼凑。
3. 算力沙盒破局：复杂财务推演、收益率倒算、极端压测时，必须自主编写 JS 调用 execute_javascript 获取精确数字，严禁盲猜。
4. 战略纪律刻录：做出重大研判定调时（如彻底看空、确立底仓、设定震荡区间），必须调用 update_decision_memo 刻入长期记忆。
5. 【防同质化双杀与相关性穿透纪律 (极其重要)】：
   当要求补充阵型或对比同类债基时，严禁仅看名字和年化收益。必须执行硬性风控：
   - 获取相关性：调用 get_fund_history_data 拉取两只基金近 30 日净值序列。
   - 沙盒计算：调用 execute_javascript 编写皮尔逊相关系数(Pearson)计算代码。
   - 拦截红线：若 r > 0.85，必须在回复中严厉警告“高度重叠，属于无效分散，系统强制拦截”。

============================================================
📊 第四层：双核全息多周期博弈打分与战略联动系统
============================================================
⚠️ 前置警告：必须区分【权益/固收+资产】与【纯债资产】，严禁用权益引擎指导纯债买卖。
🛡️ 流程誓言：打分是客观战术工具，备忘录是主观战略宪法。必须先盲评客观数据，再结合战略下指令。严禁让备忘录倒逼篡改打分！

步骤一：双核数据强制解析与锚定
  1. 权益引擎(A股)：上证(000001) 20日K线极值、多空走势、今日分时路径、涨跌家数比、总成交额。
  2. 固收引擎(债市)：十年期国债ETF(511260)或三十年国债ETF(511090) 20日K线极值与今日分时路径（注：ETF价格上行=收益率下行=债牛）。

步骤二：多周期共振双核打分卡 (满分100分，严格基于客观极值运算，严禁主观篡改)

  🔥 【权益/固收+内核】 (适用于含权资产)
  - 因子1：宏观战略赔率极值 (月K/周K) (Max 40分)
    * 战略大底：长周期绝对下沿，向下空间极小 (35-40分)
    * 趋势中枢：震荡中枢，无明显极值 (20分)
    * 战略见顶：1-2年绝对高位强阻力或高位滞涨 (0-5分) 🚨 触此则总分不应超50分
  - 因子2：战术微观反转与背离 (日K/分时) (Max 30分)
    * 底部强共振：日K超跌+分时深V或带量单边上行 (25-30分)
    * 高位诱多：日K高位+分时冲高跳水或长上影 (0分)
    * 顺势延续：温和同向上涨 (15-20分)，温和同向下跌 (5-10分)
  - 因子3：量价验证与全局情绪 (量能/涨跌比) (Max 30分)
    * 真金突破：放量(>9000亿)+普涨 (25-30分)
    * 虚假繁荣：指数涨但严重缩量或普跌吸血 (0-5分)
    * 恐慌冰点：放量暴跌 (0分)；极度缩量阴跌 (5-10分)

  🛡️ 【纯债/货币内核】 (仅适用于纯固收资产)
  - 因子1：宏观利率极值水位 (国债ETF 月K/周K) (Max 50分)
    * 收益率高位/价格低位：国债周/月K下沿，降息降准空间大 (40-50分)
    * 收益率极低/价格拥挤：国债历史高位，交易极度拥挤 (0-10分)
  - 因子2：股债跷跷板与日内流动性 (日K/分时) (Max 50分)
    * 避险涌入：A股放量大跌+国债稳步上行 (40-50分)
    * 抽血效应：A股万亿狂飙+国债分时跳水 (0-10分)

步骤三：CIO 战略/战术交叉执行矩阵
读取备忘录中该资产的定调标签，纯债看【固收得分】，含权看【权益得分】，严格套用：

  A. 标签为【BUY_STRATEGY / HOLD_STRATEGY】(战略看多/核心底仓)
     - < 45分：高位退潮/空头宣泄。指令：严禁开仓，死守现金。纯债得此分需警惕赎回踩踏，可考虑降仓。
     - 45-70分：震荡洗盘/左侧磨底。指令：持有观望，或仅小额定投。
     - > 70分：主升确立/右侧强共振。指令：大举打出空闲子弹，积极加仓。

  B. 标签为【WATCH_GRID】(网格震荡/弹性卫星波段)
     - < 40分：恐慌超跌底。指令：严禁杀跌，果断触发网格底仓买入。
     - 40-75分：中枢混沌区。指令：严格锁仓观望。
     - > 75分：高位极度狂热。指令：严禁追高，反向触发网格卖出/高抛止盈。

  C. 标签为【BLACK_LIST】(黑名单)
     - 无论得分多高，指令：绝对禁止买入，保持物理隔离。

============================================================
🔄 第五层：记忆库批量巡检与洗盘法则 (Routine Maintenance)
============================================================
当收到“执行例行巡检”指令时，进入【双核批处理模式】，动作拆解：
  - 步骤1：前置打分。必须先执行第四层打分系统，在报告开头大写加粗公示今日【A股战术得分】与【纯债战术得分】。
  - 步骤2：战术拦截。遍历所有备忘录标的。若特定引擎得分<45，但其定调仍为 BUY_STRATEGY，必须在报告中发出严厉警告，并输出“今日暂缓加仓/禁止买入”的战术否决。
  - 步骤3：记忆库写入铁律 (防污染墙)。
    * 绝对禁止用单日战术得分篡改长线战略备忘录。严禁降级（如将 BUY 改为 WATCH），严禁写入“今日得分25分”等短期噪音。
    * 备忘录只能且必须记录长线属性、底层逻辑、对标基准和极值阈值。除非基本面核心逻辑破裂，否则战略定调必须维持原判。
  - 步骤4：巡检报告排版。基于【长线战略备忘录】与【今日战术得分】矩阵交叉比对，分发每只基金今日的最终买入/卖出/持有指令。

============================================================
⚙️ 系统变量与场景注入
============================================================
${provider === 'gemini' ? '16. 你拥有原生的 Google 搜索能力，请务必积极调用底层 Google 搜索来查实最新数据！' : ''}

【我的全局财富管理目标设定】
总目标金额：${settings.targetAmount || 0} 元 | 设定基准年化：${settings.targetAnnualRate || 5}%
剩余倒数时间：${portfolioStats.monthsLeft} 个月 | 为达成目标每月需新增收益：${portfolioStats.requiredMonthly.toFixed(2)} 元
超额收益(Alpha)：${(portfolioStats.alpha * 100).toFixed(2)}% | 偏离基准轨迹：${portfolioStats.deviationAmount >= 0 ? '+' : ''}${portfolioStats.deviationAmount.toFixed(2)} 元
`;

  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    // 🌟 阶段一优化：可配置的滑动窗口，保留最近 20 条（10个完整回合）防止 Token 爆炸
    const MAX_HISTORY_MESSAGES = 20;
    const recentHistory = chatHistory.slice(-MAX_HISTORY_MESSAGES);

    // 清洗历史记录，剔除 AI 的深度思考 HTML 标签
    const cleanHistory = recentHistory.map(msg => {
        let content = msg.content;
        if (msg.role === 'assistant') {
            content = content.replace(/### 🧠 AI 深度多轮思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/, '');
            content = content.replace(/### 🧠 AI 深度思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/, '');
        }
        return { role: msg.role, content };
    });
// 🌟 核心物理隔离：只有前端明确下发 "FETCH_NOW" 时，才允许发起网络请求！
    let marketStr = "";
    if (marketData === "FETCH_NOW") {
        marketStr = await fetchAdvancedMarketData(settings); 
    } else {
        // 🌟 因为在 PortfolioChat.jsx 里已经把隔离文案传进了 marketData 参数，这里直接用就行！
        marketStr = marketData; 
    }

// 1. 将备忘录数组拆分为“三层物理结构”
    const constitutionMemo = memos.find(m => m.target === 'GLOBAL_CONSTITUTION');
    const marketMemo = memos.find(m => m.target === 'GLOBAL_MARKET');
    const fundMemos = memos.filter(m => m.target !== 'GLOBAL_CONSTITUTION' && m.target !== 'GLOBAL_MARKET');

    // 2. 组装发给 AI 的三层记忆库文本
    const memosText = `
【👑 第一层：顶层财富宪法 (Global Constitution)】
🚨 这是用户的最高投资目标与底线，所有战术动作必须服务于此目标！
${constitutionMemo ? `> 核心目标：${constitutionMemo.coreLogic}` : '> 暂无顶层财富目标，请询问用户。'}

【🌍 第二层：宏观定价锚定 (Global Market)】
🚨 这是当前市场的客观环境与极值边界，决定了各大类资产的赔率空间！
${marketMemo ? `> 宏观环境：${marketMemo.coreLogic}` : '> 暂无宏观定价记录。'}

【🏷️ 第三层：资产身份挂牌 (Asset Identity Tags)】
🚨 这里仅记录各个资产的战略定位与纪律红线。
${fundMemos.length > 0 ? fundMemos.map(m => `- [${new Date(m.updatedAt).toISOString().split('T')[0]}] ${m.targetName}(${m.target}) | 身份: ${m.decisionType} | 纪律红线: ${m.coreLogic}`).join('\n') : '> 暂无个基记录。'}
`;

    const latestStateWrapper = `
====================================================
🚨 [最高优先级指令：系统底层强制注入最新状态] 🚨
====================================================
⚠️ 致命纪律：请立即忽略上方历史对话中的旧盘口与旧资产记忆！你必须且只能基于以下【最新客观事实】进行本次分析与决策！现在的真实物理时间是：${todayStr}。

${marketStr}
${memoContext}
🚨 【逻辑一致性强制防线】：在给出建议前必须优先审视上述备忘录。除非今天的盘口发生了极其重大且根本性的反转，否则绝对禁止推翻你自己的定调！请像华尔街大鳄一样毫不留情地驳回幻想，维持原判！

【当前全盘与子弹快照】
全盘总市值：${portfolioStats.totalCurrentValue} 元 | 累计总盈亏：${portfolioStats.totalProfit} 元
综合年化(XIRR)：${(portfolioStats.overallXirr * 100).toFixed(2)}% | 预备空闲子弹：${idleFunds} 元

【当前真实持仓明细】
${activeFundsDetail}

【当前交易计划池 (包含排队中与近期已执行)】
${todosContext}

🚨 【防重防漏与资金风控纪律】：
1. 拦截重复建仓，但允许网格交易：如果对某只资产已有同方向的待办计划，除非触发条件(如价格档位)完全不同属于“网格分批交易”，否则【绝对禁止】生成重复的调仓单！
2. 流动性压测与子弹预扣：评估空闲资金时，必须在脑海中【先扣除】上方待办列表中所有独立消耗现金的“计划买入”金额！如果发现用户资金池已经超载（预备买入总额 > 空闲子弹），必须立刻向用户发出【流动性枯竭警告】，并建议补充资金或精简计划。
3. 隐性摩擦成本绝对防线：上方持仓明细中带有“🚨 [系统底层强制风控拦截]”警告的资产，【绝对禁止】下达立刻卖出或转换指令！必须计算从买入日算起的 7 个自然日，若未满 7 天，只能调用管家工具生成顺延待办（例如：“由于惩罚费限制，已为您生成待办，于 X月X日(满7天后) 自动提醒卖出”）。
4. 交易日历核对防线：在设定任何未来的交易日期时，请务必基于当前的物理日期推算，周末及法定节假日不交易，资金T+1/T+2到账。严禁出现日期与星期对应错误的低级幻觉！
====================================================
【用户最新指令】
${newMessage}

👉(系统级注入器警报：如果你判定需要修改备忘录、增删改待办、画图或记账，在你的思考过程结束后，请务必直接触发对应的 Tool Call 接口！绝对禁止用纯文字敷衍回答“已修改/已记录”！)
`;

    if (provider === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
        const geminiMessages = cleanHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts:[{ text: msg.content }]
        }));
        geminiMessages.push({ role: 'user', parts:[{ text: latestStateWrapper }] });
        
        body = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: geminiMessages,
            tools: useWebSearch ? [{ googleSearch: {} }] :[],
            generationConfig: { temperature: 0.1, topP: 0.1, maxOutputTokens: 8192 },
            safetySettings:[
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        };
    } else {
        url = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.siliconflow.cn/v1/chat/completions';
        headers['Authorization'] = `Bearer ${apiKey}`;
        
        const openaiMessages =[
            // 🌟 核心修复 1：在 System Prompt 尾部追加“数据洁癖”强制审查指令
            { role: 'system', content: systemPrompt + `\n\n12. 【数据洁癖与交叉验证】：当你调用搜索工具获取基金净值或排名时，必须严格审视返回结果的【时间戳】！如果搜索返回的是过时数据（如几个月前的数据），或者是一堆毫不相干的文章，绝对不允许生搬硬套！你必须回答“无法获取可靠的最新数据”，或者换个更精确的关键词再搜一次！` },
            ...cleanHistory.map(msg => ({ role: msg.role, content: msg.content })),
            { role: 'user', content: latestStateWrapper }
        ];

        const isReasoner = targetModel.toLowerCase().includes('reasoner') || targetModel.toLowerCase().includes('r1');

        body = {
            model: targetModel,
            messages: openaiMessages,
            temperature: 0.1,
            top_p: 0.1,
            max_tokens: 8192,
            ...(provider === 'deepseek' && {
                thinking: { type: "enabled" },
                reasoning_effort: "max"
            })
        };

// 🛡️ 核心防御：强行初始化为空数组，彻底根除后续 push 的 undefined 报错
        body.tools = [];

        if (useWebSearch && !isReasoner) {
            // 🔫 武器1：基金专属 API (专治中国公募基金净值)

        if (useWebSearch && !isReasoner) {
            // body.tools = [];
            
            // 🔫 武器1：基金专属 API (专治中国公募基金净值)
            body.tools.push({
                type: "function",
                function: {
                    name: "get_realtime_fund_data",
                    description: "【绝对精确金融API】当需要获取公募基金的最新精确净值、同类排名、阶段涨跌幅等结构化财务数据时，绝对优先调用此API！🚨 致命使用纪律：当用户要求“推荐基金”时，绝对禁止为了盲目比较全市场基金，而在多轮循环中疯狂调用此接口查几十只基金！",
                    parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
                }
            });

            // 🔫 武器2：宏观数字狙击枪 (Serper, 专治各种找不到精确数字)
            if (settings.serperApiKey) {
                body.tools.push({
                    type: "function",
                    function: {
                        name: "google_macro_search",
                        // 🌟 核心修正：严厉警告 AI 不要用搜索引擎去查历史连续数据
                        description: "【宏观定量数据引擎】当需要获取具体的宏观经济数字时调用！🚨 严厉警告：此工具是搜索引擎，不是数据库！仅限用于查询【今天此时此刻】的单个最新数值。绝对禁止用它来搜索“历史走势”、“X月到X月的数据”，否则你会引发死循环！🚨 致命警告：受搜索引擎缓存影响，若第一次查到的数据是昨天或前天的，请【直接使用该数据并停止重搜】，只需向用户说明数据更新日期即可，严禁陷入无限重复调用的死循环！🚨 致命红线：绝对禁止用此工具搜索【6位数代码的公募基金】的净值！查公募基金必须且只能调用 get_realtime_fund_data 或 get_fund_history_data！",
                         parameters: { 
            type: "object", 
            properties: { 
                query: { type: "string" },
                timeRange: { type: "string", enum: ["qdr:d", "qdr:w", "qdr:m", "all"], description: "搜索时间范围：qdr:d(过去24小时，查最新行情必备), qdr:w(过去一周), qdr:m(过去一月), all(不限)。默认请用 qdr:d" }
            }, 
            required: ["query"] 
        }
    }
});
            }

            // 🌟 核心增量：专门赋予 AI 查基金历史数组的超能力
            body.tools.push({
                type: "function",
                function: {
                    name: "get_fund_history_data",
                    description: "【基金时序数据库】专门用于获取公募基金过去 30 个交易日的历史净值序列。当用户要求查净值、看某只基金走势、画基金图表时，必须优先调用此工具获取底层数据数组。",
                    parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
                }
            });

            // 🔫 武器3：新闻事件聚合器 (Tavily, 专治突发快讯)
            if (settings.tavilyApiKey) {
                body.tools.push({
                    type: "function",
                    function: {
                        name: "tavily_news_search",
                        description: "【定性新闻事件引擎】仅用于查询大盘异动原因、突发新闻、宏观政策解读等文字类信息。🚨 绝对禁止用此工具查询国债收益率等具体数字！",
                         parameters: { 
            type: "object", 
            properties: { 
                query: { type: "string", description: "例如：'今日 A股 暴跌 核心原因'" },
                recency: { type: "string", enum: ["d1", "d3", "w1"], description: "新闻新鲜度要求：d1(24小时内极速快讯), d3(最近3天), w1(最近一周)。查暴跌原因用 d1" }
            }, 
            required: ["query"] 
        }
    }
});
            }

            // // 🔫 武器4：深度研报挖掘机 (Exa, 专治长期趋势与定性研报) 
            // if (settings.exaApiKey) {
            //     body.tools.push({
            //         type: "function",
            //         function: {
            //             name: "exa_research",
            //             description: "【深度长文研报引擎】当需要深挖特定资产的长期宏观逻辑、机构长篇定性研报、重大会议深入解读时调用。非常适合用于了解未来的中长期趋势分析！注意：绝对禁止用于查单日净值或实时报价。",
            //             parameters: { type: "object", properties: { query: { type: "string", description: "例如：'2026年下半年 中国债市 资产荒 机构研报 深度分析'" } }, required: ["query"] }
            //         }
            //     });
            // }

            // 🔫 武器4：深度研报挖掘机 (Exa, 专治长期趋势与定性研报) 
            if (settings.exaApiKey) {
                body.tools.push({
                    type: "function",
                    function: {
                        name: "exa_research",
                        // 🌟 核心升级：通过 Description 给 AI 进行“心理暗示”，引导它避开 PDF 陷阱！
                        description: "【深度长文研报引擎】当需要深挖特定资产的长期宏观逻辑、机构长篇定性研报、重大会议深入解读时调用。非常适合用于了解未来的中长期趋势分析！注意：绝对禁止用于查单日净值或实时报价。🚨 致命警告：各大基金公司的官方季报多为纯图片或加密 PDF 格式，搜索引擎极易卡死或读出乱码！因此，请优先在查询词中追加 '天天基金'、'新浪财经'、'持仓明细' 等关键词，强制搜索引擎去抓取【网页版/文字版的第三方解读文章】！",
                        parameters: { type: "object", properties: { query: { type: "string", description: "例如：'创金合信中证红利低波动指数A 天天基金 最新一季报 行业分布 解读'" } }, required: ["query"] }
                    }
                });
            }

            // 🔫 武器5：交易记账工具 (升级为批量版)
            body.tools.push({
                type: "function",
                function: {
                    name: "update_ledger",
                    description: "【批量交易引擎】当用户明确表示已经买入、卖出某只基金，或要求补录历史交易时调用此工具。支持一次性传入多条记账指令！",
                    parameters: { 
                        type: "object", 
                        properties: { 
                            actions: {
                                type: "array",
                                description: "要执行的记账指令数组",
                                items: {
                                    type: "object",
                                    properties: {
                                        fundCode: { type: "string", description: "基金6位数代码" },
                                        fundName: { type: "string" },
                                        amount: { type: "number", description: "交易金额" },
                                        actionType: { type: "string", enum:["buy", "sell", "delete"] },
                                        date: { type: "string", description: "交易发生的具体日期，格式 YYYY-MM-DD。" }
                                    },
                                    required: ["fundCode", "amount", "actionType"]
                                }
                            }
                        }, 
                        required: ["actions"] 
                    }
                }
            });
        }
// 🌟 核心修复 2：防止推理模型加载工具导致报错
        if (!isReasoner) {
// 🌟 新增史诗级超能力：硬核量化与风控计算引擎
            body.tools.push({
                type: "function",
                function: {
                    name: "quant_analysis_engine",
                    description: "【核心量化算力协处理器】大语言模型天生不擅长精确数学运算！当且仅当需要预测未来收益、推算回本年化要求、或评估历史最大回撤风险时，【绝对禁止】你在脑海中自行计算，必须立刻调用此硬核算力引擎！",
                    parameters: {
                        type: "object",
                        properties: {
                            calcType: { type: "string", enum: ["future_value", "required_rate", "risk_evaluation"], description: "计算类型：future_value(计算复利终值), required_rate(计算达成目标所需年化), risk_evaluation(评估最大回撤等风险)" },
                            principal: { type: "number", description: "本金金额 (future_value/required_rate 时必填)" },
                            targetAmount: { type: "number", description: "目标金额 (required_rate 时必填)" },
                            annualRate: { type: "number", description: "预计年化收益率%，例如 3.5 (future_value 时必填)" },
                            months: { type: "number", description: "投资期限(月数) (future_value/required_rate 时必填)" },
                            priceArray: { type: "array", items: { type: "number" }, description: "价格或净值历史序列数组 (risk_evaluation 时必填)" }
                        },
                        required: ["calcType"]
                    }
                }
            });



        // 🌟 新增超能力：动态画图技能
            body.tools.push({
    type: "function",
    function: {
        name: "generate_trend_chart",
        description: "【可视化超能力】绘制复杂金融图表。支持单只或多只基金的相对收益率对比（归一化），支持在图表中绘制关键技术位辅助线（击球区、阻力位）。",
        parameters: {
            type: "object",
            properties: {
                title: { type: "string", description: "图表标题" },
                chartType: { type: "string", enum: ["line", "bar"], description: "图表类型" },
                labels: { type: "array", items: { type: "string" }, description: "X轴时间标签，如 ['04-22', '04-23']" },
                // 🌟 核心升级：从单条 data 升级为多数据集
                datasets: { 
                    type: "array", 
                    description: "多基金数据序列。若对比多只基金，必须在此处传入数组。",
                    items: {
                        type: "object",
                        properties: {
                            label: { type: "string", description: "基金名称或代码" },
                            data: { type: "array", items: { type: "number" }, description: "对应的净值数据数组" }
                        },
                        required: ["label", "data"]
                    }
                },
                // 🌟 核心升级：增加辅助线配置
                horizontalLines: {
                    type: "array",
                    description: "图表中的水平辅助线（如击球区、MA20等），用于直观展示买卖点位。",
                    items: {
                        type: "object",
                        properties: {
                            value: { type: "number", description: "Y轴数值" },
                            color: { type: "string", description: "线条颜色，如 'green', 'red'" },
                            label: { type: "string", description: "辅助线名称" }
                        },
                        required: ["value", "color", "label"]
                    }
                }
            },
            // 🌟 新增：区间色带超能力
                horizontalBands: {
                    type: "array",
                    description: "图表中的水平半透明色带（用于极其直观地标识击球区、建仓区、震荡箱体范围）",
                    items: {
                        type: "object",
                        properties: {
                            yMin: { type: "number", description: "区间下沿数值" },
                            yMax: { type: "number", description: "区间上沿数值" },
                            color: { type: "string", description: "色带主题色，如 'green' (买入区), 'red' (危险区)" },
                            label: { type: "string", description: "色带名称，如 '第一档击球区'" }
                        },
                        required: ["yMin", "yMax", "color"]
                    }
                },
            required: ["title", "chartType", "labels", "datasets"]
        }
    }
});

// 🌟 终极超能力：图灵完备的代码沙盒 (Code Interpreter)
            body.tools.push({
                type: "function",
                function: {
                    name: "execute_javascript",
                    description: "【全能逻辑与数学沙盒】大语言模型天生不擅长复杂计算。当你需要进行任何宏观压力测试、复利终值推演、最大回撤计算、或者任何超越你直接回答能力的量化模型时，【绝对禁止】自己猜测结果！你必须自主编写一段 JavaScript 代码交给我执行。你必须通过 `return` 返回最终结果。支持使用标准 Math 库。",
                    parameters: {
                        type: "object",
                        properties: {
                            code: { 
                                type: "string", 
                                description: "合法的 JS 代码。例如计算复利：'let p=80000; let r=0.035/12; let m=7; return p*Math.pow(1+r,m);'" 
                            },
                            reasoning: {
                                type: "string",
                                description: "一句话解释你为什么要写这段代码（供审计使用）"
                            }
                        },
                        required: ["code", "reasoning"]
                    }
                }
            });

            // 在 chatWithPortfolioAI 的 tools 数组中：
body.tools.push({
    type: "function",
    function: {
        name: "get_batch_fund_data",
        description: "【批量金融API】当需要同时查询多只基金的最新净值和表现时，绝对优先调用此批量接口，禁止使用单只查询！",
        parameters: { 
            type: "object", 
            properties: { 
                fundCodes: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "基金6位数代码数组，例如 ['007194', '006829']" 
                } 
            }, 
            required: ["fundCodes"] 
        }
    }
});

// 🔫 武器6：待办全生命周期管理引擎 (增、删、改)
            body.tools.push({
                type: "function",
                function: {
                    name: "manage_plan_todo",
                    description: "【待办计划管理引擎】🚨 致命纪律：当需要新增、顺延(修改)、删除(取消)交易计划时，【必须且只能】调用此工具！禁止使用'明天'、'后天'、'下周一'等没有具体日期的描述，必须使用绝对日期。绝对禁止用纯文字敷衍用户说'已添加待办'而不触发此工具！如果要操作已存在的计划，必须传入其 待办ID。",
                    parameters: { 
                        type: "object", 
                        properties: { 
                            plans: {
                                type: "array",
                                description: "待办计划指令数组",
                                items: {
                                    type: "object",
                                    properties: {
                                        manageType: { type: "string", enum:["add", "update", "delete"], description: "【生命周期核心参数】必须明确你是要：新增(add) / 更新顺延(update) / 废除删除(delete)" },
                                        id: { type: "string", description: "【更新或删除时极其重要】必须填写上下文中方括号里的纯粹的字母数字ID，绝对不要带有'待办ID:'等中文前缀！" },
                                        fundCode: { type: "string", description: "【新增时必填】基金6位数代码" },
                                        fundName: { type: "string", description: "【新增时必填】基金名称" },
                                        tradeDirection: { type: "string", enum:["buy", "sell", "observe"], description: "【新增时必填】买入/卖出/观察" },
                                        amount: { type: "number", description: "计划交易金额" },
                                        condition: { type: "string", description: "【新增或更新时必填】触发条件，例如'顺延至下周一尾盘买入'" },
                                        priority: { type: "string", enum: ["high", "medium", "low"], description: "计划优先级：high(紧急止损/即将触发的买点), medium(常规网格/定投), low(长期远端观察)" }
                                    },
                                    required: ["manageType"]
                                }
                            }
                        }, 
                        required: ["plans"] 
                    }
                }
            });

            // 🔫 武器7：AI 长期记忆写入引擎
            body.tools.push({
                type: "function",
                function: {
                    name: "update_decision_memo",
                    // 🚨 修复1：修正 dedescription 为正确的 description
                    description: "【战略备忘录记录与自我更新】用于记录或覆写长线定调。如果发现旧记忆的宏观前置条件已失效，你必须调用此工具，传入相同的 target 覆盖旧记忆。🚨 写入时必须严格遵循三层物理隔离法则：\n1. target='GLOBAL_CONSTITUTION'：仅在此写入用户的【绝对收益目标】、【总资产规模】等静态财富宪法。定调方向必须选 GLOBAL_MACRO。\n2. target='GLOBAL_MARKET'：仅在此写入【10年国债极值】、【A股流动性阈值分水岭】等动态宏观锚点。定调方向必须选 GLOBAL_MACRO。\n3. target='具体基金代码'：必须极度精简！【绝对禁止】在个基备忘录中写宏观分析，只能标明该基金的【身份】（如: 长债底仓、弹性卫星）以及【数学纪律】（如: 止损线2.00）。绝对禁止用纯文字敷衍用户说'已记录'而不触发此工具！",
                    parameters: {
                        type: "object",
                        properties: {
                            target: { type: "string", description: "标的代码。注意：如果是大盘定调请写 GLOBAL_CONSTITUTION 或 GLOBAL_MARKET。传入相同的代码将直接覆盖该标的的旧记忆。" },
                            targetName: { type: "string", description: "标的名称或大盘标签" },
                            // 🚨 修复2：将 GLOBAL_MACRO 加入到 enum 允许的枚举值列表中
                            decisionType: { type: "string", enum: ["BUY_STRATEGY", "HOLD_STRATEGY", "BLACK_LIST", "WATCH_GRID", "GLOBAL_MACRO"] },
                            coreLogic: { type: "string", description: "核心逻辑摘要，字数尽量精简" }
                        },
                        required: ["target", "targetName", "decisionType", "coreLogic"]
                    }
                }
            });

// 🔫 武器8：FOF 穿透字典采编引擎
body.tools.push({
    type: "function",
    function: {
        name: "update_fof_dictionary",
        description: "【资产穿透字典采编】当调用 get_fund_holdings_penetration 或者 exa_research 获取了底层重仓股数据，并在脑海中推算出真实权益仓位与申万行业分布后，调用此工具将结果写入云端X-Ray字典。🚨 数据必须真实客观！纯债/货币基金严禁入库！",
        parameters: {
            type: "object",
            properties: {
                fundCode: { type: "string", description: "基金代码" },
                fundName: { type: "string", description: "基金名称" },
                equityRatio: { type: "number", description: "真实股票仓位比例（例如 85% 填 0.85）" },
                sectors: {
                    type: "object",
                    description: "申万一级或核心行业分布比例的键值对。确保加起来约等于 1.0。例如: {'电子/半导体': 0.4, '医药生物': 0.3, '新能源': 0.3}",
                    additionalProperties: { type: "number" }
                }
            },
            required: ["fundCode", "fundName", "equityRatio", "sectors"]
        }
    }
});

// 🔫 武器9：底层穿透直连引擎 (你的旧代码重现荣光！)
            body.tools.push({
                type: "function",
                function: {
                    name: "get_fund_holdings_penetration",
                    description: "【底层持仓穿透引擎】当需要获取基金的【前十大重仓股】以更新 FOF 字典时，🚨绝对优先调用此接口！严禁去外网搜 PDF！拿到重仓股明细后，请你发挥常识，将这些股票归类到申万一级行业，并估算大致的股票仓位，最后调用 update_fof_dictionary 入库。",
                    parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
                }
            });
/// 🧹 API 兼容拦截层：如果工具数组为空或为纯推理模型，剥离 tools 字段防 400 报错
        if (isReasoner || body.tools.length === 0) {
            delete body.tools;
        }

    } // 这个括号保留，它是闭合 else 分支的
    }

    // 🔫 武器10：大盘/个股历史K线深度溯源探针 (腾讯无敌版)
            body.tools.push({
                type: "function",
                function: {
                    name: "get_market_historical_intraday",
                    description: "【历史K线深度透视眼】当你需要复盘大盘在‘过去某几天’的走势、量价杀跌博弈时调用。它将调取过去10个交易日的精确OHLC（开盘/最高/最低/收盘）数据及上下影线形态。你可以通过最高价、最低价的落差，完美推演当天日内的多空博弈过程！",
                    parameters: {
                        type: "object",
                        properties: {
                            code: { type: "string", description: "指数或ETF代码，如 sh000001 (上证), sh511260 (国债ETF)" }
                        },
                        required: ["code"]
                    }
                }
            });
}

    let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    let data = await response.json();
    
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices) throw new Error(data.message);

    let accumulatedReasoning = '';
    let accumulatedContent = ''; // 🌟 修复 1：新增变量，用于累积 AI 中途写出的正文
    let maxLoops = 12; 
    let pendingActions = []; // 🌟 改为数组，用于收集 AI 一次性发出的多个指令

    // 🌟 循环拦截 Agent 的多轮工具调用
    while (provider !== 'gemini' && data.choices && data.choices[0].message.tool_calls && maxLoops > 0) {
        maxLoops--;
        const responseMsg = data.choices[0].message;
        
        // 🌟 增强日志：把 AI 的内在深度思考（Chain of Thought）实时投射到 F12 控制台！
        if (responseMsg.reasoning_content) {
            console.log(`%c🧠 [AI 大脑神经元活动] 第 ${12 - maxLoops} 轮思考:`, `color: #f59e0b; font-size: 13px; font-weight: bold; background: #fffbeb; padding: 2px 6px; border-radius: 4px;`);
            console.log(`%c${responseMsg.reasoning_content}`, `color: #64748b; font-style: italic; border-left: 3px solid #f59e0b; padding-left: 10px; margin-bottom: 10px;`);
            accumulatedReasoning += responseMsg.reasoning_content + '\n\n';
        }
        
        if (responseMsg.content) {
            accumulatedContent += responseMsg.content + '\n\n';
        }

        body.messages.push(responseMsg);
        
        for (const toolCall of responseMsg.tool_calls) {
            const toolName = toolCall.function.name;
            
            // 🌟 核心增量执行层：拉取历史 30 天的数组数据
            if (toolName === 'get_fund_history_data') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`🔥 [Agent 调度] AI 激活时序数据库！拉取基金 [${args.fundCode}] 历史走势`);
                    
                    const targetUrl = `http://api.fund.eastmoney.com/f10/lsjz?fundCode=${args.fundCode}&pageIndex=1&pageSize=30`;
                    let fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
                        ? (settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl)) : settings.customProxyUrl + targetUrl)
                        : `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;

                    const res = await fetch(fetchUrl, { cache: 'no-store' });
                    const data = await res.json();
                    let actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);

                    if (actualData?.Data?.LSJZList) {
                        // 倒序处理，让日期从旧到新排列，符合画图逻辑
                        const list = actualData.Data.LSJZList.reverse();
                        // 提取日期标签 (只要月-日) 和 净值数组
                        const dates = list.map(item => item.FSRQ.substring(5)); 
                        const navs = list.map(item => parseFloat(item.DWJZ));
                        
                        body.messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: `【成功获取近30日净值】\n日期序列: [${dates.join(',')}]\n净值序列: [${navs.join(',')}]\n👉 请直接使用这些数组数据，利用你的 QuickChart 生成图片能力为用户绘制走势图！`
                        });
                    } else {
                        body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "获取历史净值失败，请告知用户无法画图。" });
                    }
                } catch (e) {
                    console.error("历史API调用失败", e);
                    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "时序接口报错，停止尝试画图。" });
                }
            }
            
            // 🌟 核心升级：拦截 API 请求，我们直接去蛋卷基金后台抓纯净 JSON 喂给 AI
            else if (toolName === 'get_realtime_fund_data') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`🔥 [Agent 调度] AI 拔出专属金融 API 狙击枪！锁定代码:【${args.fundCode}】`);
                    
                    const targetUrl = `https://danjuanfunds.com/djapi/fund/${args.fundCode}`;
                    let fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
                        ? (settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl)) : settings.customProxyUrl + targetUrl)
                        : `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;

                    // 加 no-store 防止 PWA 缓存，确保拿到最实时数据
                    const res = await fetch(fetchUrl, { cache: 'no-store' });
                    const data = await res.json();
                    let actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);

                    if (actualData?.data) {
                        const fundData = actualData.data;
                        const derived = fundData.fund_derived || {};
                        
                        // 组装成极度干净的结构化文本还给大模型
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
                        body.messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: resultStr
                        });
                    } else {
                        body.messages.push({ 
                            role: "tool", 
                            tool_call_id: toolCall.id, 
                            name: toolName, 
                            content: "未查询到该基金数据，可能是代码错误或退市。" 
                        });
                    }
                } catch (e) {
                    console.error("金融API调用失败", e);
                    body.messages.push({ 
                        role: "tool", 
                        tool_call_id: toolCall.id, 
                        name: toolName, 
                        content: "接口报错，请降级使用网页搜索工具(google_precise_search)去雪球获取数据。" 
                    });
                }
            } 

            // 🌟 核心增量：底层持仓直连穿透引擎
            else if (toolName === 'get_fund_holdings_penetration') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`🔥 [Agent 调度] AI 拔出透视扫描仪！直连金融库穿透代码:【${args.fundCode}】`);
                    
                    const targetUrl = `https://danjuanfunds.com/djapi/fund/${args.fundCode}`;
                    let fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
                        ? (settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl)) : settings.customProxyUrl + targetUrl)
                        : `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;

                    const res = await fetch(fetchUrl, { cache: 'no-store' });
                    const data = await res.json();
                    let actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
                    
                    let hasStock = actualData?.data?.fund_position?.stock_list?.length > 0;
                    let hasBond = actualData?.data?.fund_position?.bond_list?.length > 0;

                    // 东财容灾降级
                    if (!hasStock && !hasBond && settings.proxyMode === 'custom') {
                        const fakeDeviceId = Math.random().toString(36).substring(2, 15);
                        const emTargetUrl = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNInverstPosition?FCODE=${args.fundCode}&deviceid=${fakeDeviceId}&plat=Android&product=EFund&version=6.6.8`;
                        let emFetchUrl = settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(emTargetUrl)) : settings.customProxyUrl + emTargetUrl;

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
                        
                        // 组装精简的数据喂给 AI
                        let resultStr = `【基金 ${args.fundCode} 底层穿透精确数据】\n`;
                        resultStr += `前十大股票总占比: ${stockPercent.toFixed(2)}%\n`;
                        if (stocks.length > 0) {
                            resultStr += `【股票明细】\n` + stocks.map(s => `- ${s.name}: ${s.percent}%`).join('\n') + `\n\n`;
                            resultStr += `👉 核心指令：请观察上方具体的股票名称，发挥你的行业常识，将它们归类到申万一级行业。如果前十大股票占比超过 40%，说明这是偏股基，请将 equityRatio 设为 0.85；若这是纯指数基，设为 0.95。如果是固收+，设为 0.2。然后立刻调用 update_fof_dictionary 入库！`;
                        } else {
                            resultStr += `【未发现股票持仓】👉 请直接认定其为纯债或货币基金，停止生成字典！`;
                        }

                        body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: resultStr });
                    } else {
                        body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "接口暂无底层数据，请直接向用户认错。" });
                    }
                } catch (e) {
                    console.error("穿透API报错", e);
                    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "接口调用异常。" });
                }
            }

           else if (toolName === 'get_batch_fund_data') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`🔥 [Agent 调度] AI 拔出批量散弹枪！锁定代码:`, args.fundCodes);
                    
                    // 并发请求，并且每一发子弹都完美套用你的系统全局代理设置！
                    const promises = args.fundCodes.map(async (code) => {
                        const targetUrl = `https://danjuanfunds.com/djapi/fund/${code}`;
                        
                        // 核心：读取 settings 中的自定义代理配置
                        let fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
                            ? (settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl)) : settings.customProxyUrl + targetUrl)
                            : `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;

                        try {
                            const res = await fetch(fetchUrl, { cache: 'no-store' });
                            const data = await res.json();
                            
                            // 核心：兼容数据结构。如果是你的自定义透明代理，直接用 data；如果是公共代理，解析 contents
                            const actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
                            return { code, actualData, success: true };
                        } catch (err) {
                            console.warn(`❌ [批量探针] 基金 ${code} 抓取失败:`, err);
                            return { code, success: false };
                        }
                    });
                    
                    // Promise.all 并发等待所有结果
                    const results = await Promise.all(promises);
                    
                    let resultStr = "【批量数据获取结果】\n";
                    results.forEach(item => {
                         if (item.success && item.actualData?.data) {
                             const fundData = item.actualData.data;
                             const derived = fundData.fund_derived || {};
                             // 组装成极度干净的结构化文本，喂给大模型
                             resultStr += `- ${fundData.fd_name}(${fundData.fd_code}): 最新净值 ${derived.unit_nav || '--'} (更新日期: ${derived.end_date || '--'}) | 近1月 ${derived.nav_grl1m || '--'}% | 近1年 ${derived.nav_grl1y || '--'}%\n`;
                         } else {
                             resultStr += `- 代码 ${item.code}: 数据抓取失败、代码错误或已退市。\n`;
                         }
                    });

                    body.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: resultStr
                    });
                } catch (e) {
                    console.error("批量API调用崩溃", e);
                    body.messages.push({ 
                        role: "tool", 
                        tool_call_id: toolCall.id, 
                        name: toolName, 
                        content: "批量查询参数异常，请降级使用单只查询或文字说明。" 
                    });
                }
            }

else if (toolName === 'quant_analysis_engine') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`🔥 [Agent 调度] AI 挂载算力协处理器！执行硬核量化运算:【${args.calcType}】`);
                    
                    let resultStr = "";

                    // 1. 复利终值推演 (FV)
                    if (args.calcType === 'future_value') {
                        const ratePerMonth = (args.annualRate / 100) / 12;
                        const fv = args.principal * Math.pow(1 + ratePerMonth, args.months);
                        const profit = fv - args.principal;
                        resultStr = `【量化引擎计算结果】\n投入本金：${args.principal}元\n预设年化：${args.annualRate}%\n投资期限：${args.months}个月\n👉 精确复利终值：${fv.toFixed(2)}元\n👉 预期纯收益：${profit.toFixed(2)}元`;
                    } 
                    // 2. 目标倒推年化 (Required Rate)
                    else if (args.calcType === 'required_rate') {
                        const ratePerMonth = Math.pow(args.targetAmount / args.principal, 1 / args.months) - 1;
                        const requiredAnnualRate = ratePerMonth * 12 * 100;
                        resultStr = `【量化引擎计算结果】\n当前本金：${args.principal}元\n目标金额：${args.targetAmount}元\n剩余期限：${args.months}个月\n👉 要达成此目标，所需的精确年化收益率为：${requiredAnnualRate.toFixed(2)}%\n(注：请利用此数据客观评判目标的风险合理性)`;
                    } 
                    // 3. 极速风控扫描 (Max Drawdown & Momentum)
                    else if (args.calcType === 'risk_evaluation' && args.priceArray && args.priceArray.length > 0) {
                        const prices = args.priceArray;
                        let maxDrawdown = 0;
                        let peak = prices[0];
                        let sum = 0;
                        
                        for (let p of prices) {
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

                    body.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: resultStr
                    });
                } catch (e) {
                    console.error("量化计算引擎执行失败", e);
                    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "运算参数异常，可能是数组为空或缺少必填项，请重新调整调用参数。" });
                }
            }


else if (toolName === 'generate_trend_chart') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    const cleanTitle = (args.title || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                    console.log(`🔥 [Agent 调度] AI 释放可视化技能！绘制图表:【${cleanTitle}】`);
                    
                    let rawLabels = args.labels || [];
                    if (typeof rawLabels === 'string') {
                        try { rawLabels = JSON.parse(rawLabels.replace(/'/g, '"')); } 
                        catch(e) { rawLabels = rawLabels.replace(/[\[\]]/g, '').split(','); }
                    }
                    const safeLabels = (Array.isArray(rawLabels) ? rawLabels : []).map(l => String(l).trim().substring(0, 10));

                    // 🌟 1. 扩充全局智能色卡 (支持 AI 传出的常见颜色)
                    const colorMap = {
                        'red': { solid: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
                        'green': { solid: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
                        'blue': { solid: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
                        'orange': { solid: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
                        'purple': { solid: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
                        'yellow': { solid: '#eab308', bg: 'rgba(234, 179, 8, 0.15)' },
                        'gray': { solid: '#6b7280', bg: 'rgba(107, 114, 128, 0.15)' }
                    };
                    const getThemeColor = (colorStr) => {
                        const key = String(colorStr).toLowerCase().trim();
                        return colorMap[key] || colorMap['gray'];
                    };

                    let rawDatasets = args.datasets || [];
                    let safeDatasets = [];
                    const themeColors = [colorMap['blue'], colorMap['green'], colorMap['red'], colorMap['purple']];
                    
                    const chartType = args.chartType || 'line';

                    if (Array.isArray(rawDatasets) && rawDatasets.length > 0) {
                        rawDatasets.forEach((ds, index) => {
                            let rData = ds.data || [];
                            if (typeof rData === 'string') {
                                try { rData = JSON.parse(rData); } 
                                catch(e) { rData = rData.replace(/[\[\]]/g, '').split(','); }
                            }
                            const sData = (Array.isArray(rData) ? rData : []).map(d => {
                                const num = parseFloat(String(d).replace(/[^\d.-]/g, ''));
                                return isNaN(num) ? 0 : num;
                            });
                            if (sData.length > 0) {
                                const theme = themeColors[index % themeColors.length];
                                safeDatasets.push({
                                    label: ds.label || `资产 ${index + 1}`,
                                    data: sData,
                                    fill: index === 0, // 主线背景填充
                                    borderColor: theme.solid,
                                    backgroundColor: theme.bg,
                                    lineTension: 0.2,
                                    borderWidth: index === 0 ? 3 : 1.5,
                                    borderDash: index === 0 ? [] : [5, 5],
                                    pointBackgroundColor: '#ffffff',
                                    pointBorderColor: theme.solid,
                                    pointBorderWidth: index === 0 ? 2 : 1,
                                    pointRadius: (safeLabels.length > 30 || index > 0) ? 0 : 4,
                                    pointHoverRadius: 6
                                });
                            }
                        });
                    }

                    if (safeDatasets.length === 0) throw new Error("解析后无有效绘图数据");

                    const realAssetCount = safeDatasets.filter(ds => !ds.label.match(/MA|均线|轨|线|上限|下限/i)).length;
                    const isMultiCompare = realAssetCount > 1 && chartType === 'line';

                    if (isMultiCompare) {
                        safeDatasets = safeDatasets.map(ds => {
                            const baseVal = (ds.data[0] !== 0 && ds.data[0] !== undefined) ? ds.data[0] : 1; 
                            const normalizedData = ds.data.map(v => ((v - baseVal) / baseVal) * 100);
                            return { ...ds, data: normalizedData };
                        });
                    }

                    let globalMin = Infinity;
                    let globalMax = -Infinity;
                    safeDatasets.forEach(ds => {
                        const min = Math.min(...ds.data);
                        const max = Math.max(...ds.data);
                        if (min < globalMin) globalMin = min;
                        if (max > globalMax) globalMax = max;
                    });
                    
                    const dataRange = globalMax - globalMin;
                    const yPadding = dataRange === 0 ? (isMultiCompare ? 0.5 : 0.005) : dataRange * 0.15; 
                    const yMin = globalMin - yPadding;
                    const yMax = globalMax + yPadding;

                    let annotations = [];

                    // 🌟 2. 完美处理区间色带 (取消图上难看的悬浮字，移到图例)
                    if (args.horizontalBands && Array.isArray(args.horizontalBands)) {
                        args.horizontalBands.forEach(band => {
                            const bandMin = parseFloat(band.yMin);
                            const bandMax = parseFloat(band.yMax);
                            if (!isNaN(bandMin) && !isNaN(bandMax)) {
                                const theme = getThemeColor(band.color);
                                
                                // 图表内仅绘制纯净的色带
                                annotations.push({
                                    type: 'box', yScaleID: 'y-axis-0',
                                    yMin: bandMin, yMax: bandMax,
                                    backgroundColor: theme.bg, borderWidth: 0
                                });

                                // 注入空数据集，强制在底部生成完美图例 (类似图3)
                                if (band.label) {
                                    safeDatasets.push({
                                        label: band.label,
                                        data: [], // 空数据，不会画线
                                        backgroundColor: theme.bg,
                                        borderColor: 'transparent',
                                        borderWidth: 0,
                                        type: 'bar' // 让图例显示为矩形色块
                                    });
                                }
                            }
                        });
                    }

                    // 🌟 3. 完美处理水平辅助线 (取消悬浮字，移到图例)
                    if (args.horizontalLines && Array.isArray(args.horizontalLines)) {
                        args.horizontalLines.forEach(line => {
                            const lineVal = parseFloat(line.value);
                            if (!isNaN(lineVal)) {
                                const theme = getThemeColor(line.color);
                                
                                // 绘制横线
                                annotations.push({
                                    type: 'line', mode: 'horizontal', scaleID: 'y-axis-0',
                                    value: lineVal, borderColor: theme.solid, borderWidth: 1.5, borderDash: [6, 4]
                                });

                                // 注入空数据集，强制生成虚线图例
                                if (line.label) {
                                    safeDatasets.push({
                                        label: line.label,
                                        data: [], // 空数据
                                        borderColor: theme.solid,
                                        backgroundColor: 'transparent',
                                        borderWidth: 1.5,
                                        borderDash: [6, 4],
                                        pointRadius: 0
                                    });
                                }
                            }
                        });
                    }

                    const displayTitle = isMultiCompare ? `${cleanTitle} (累积涨跌幅 %)` : cleanTitle;
                    
                    // 🌟 4. 重构 Chart 配置文件
                    const chartConfig = {
                        type: chartType,
                        data: { labels: safeLabels, datasets: safeDatasets },
                        options: {
                            defaultFontFamily: "'Helvetica Neue', 'Helvetica', 'Arial', sans-serif",
                            title: { display: true, text: displayTitle, fontSize: 16, fontColor: '#374151', padding: 20 },
                            // 🌟 关键修复：去掉 usePointStyle: true，并调整 boxWidth 让图例呈现横向矩形，完美复刻图3
                            legend: { 
                                display: safeDatasets.length > 1, 
                                position: 'bottom', 
                                labels: { boxWidth: 24, padding: 12, fontColor: '#4b5563' } 
                            },
                            scales: {
                                xAxes: [{
                                    gridLines: { display: true, color: '#f3f4f6', drawBorder: true },
                                    ticks: { autoSkip: true, maxRotation: 45, minRotation: 0, fontColor: '#6b7280' }
                                }],
                                yAxes: [{
                                    id: 'y-axis-0',
                                    gridLines: { display: true, color: '#f3f4f6', drawBorder: true, zeroLineColor: '#e5e7eb' },
                                    ticks: {
                                        min: parseFloat(yMin.toFixed(4)), max: parseFloat(yMax.toFixed(4)),
                                        fontColor: '#6b7280', padding: 10
                                    }
                                }]
                            },
                            annotation: annotations.length > 0 ? { annotations: annotations } : undefined
                        }
                    };

                    let finalChartUrl = "";
                    try {
                        const qcPayload = { 
                            chart: chartConfig, 
                            width: 800, height: 420, backgroundColor: 'white', devicePixelRatio: 2 
                        };

                        const qcRes = await fetch('https://quickchart.io/chart/create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(qcPayload)
                        });
                        
                        const qcText = await qcRes.text(); 
                        let qcData;
                        try {
                            qcData = JSON.parse(qcText);
                        } catch (parseErr) {
                            throw new Error(`QuickChart 返回非JSON: ${qcText.substring(0, 100)}`);
                        }

                        if (qcData.success && qcData.url) {
                            finalChartUrl = qcData.url;
                            console.log(`✅ [Agent 调度] 图表生成成功！短链接: ${finalChartUrl}`);
                        } else {
                            throw new Error(`QuickChart API 内部报错: ${JSON.stringify(qcData)}`);
                        }
                    } catch (qcError) {
                        console.error("🚨 [画图探针] POST 请求彻底坠毁:", qcError.message);
                        const fallbackConfig = encodeURIComponent(JSON.stringify(chartConfig));
                        finalChartUrl = `https://quickchart.io/chart?c=${fallbackConfig}&bkg=white&w=800&h=420&devicePixelRatio=2`;
                    }

                    body.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: `图表已成功生成。请在最终回复中，直接使用这行 Markdown 代码将图表展示给用户：\n![${cleanTitle}](${finalChartUrl})`
                    });
                } catch (e) {
                    console.error("画图技能执行失败", e);
                    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "图表生成失败，请用文字表格代替说明。" });
                }
            }


            // 🌟 底层执行器：让 AI 自己当程序员
            else if (toolName === 'execute_javascript') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    // 🌟 增强日志：让 AI 写的代码在 F12 里像真正的 IDE 一样高亮显示！
                    console.log(`%c🚀 [Agent 算力觉醒] AI 正在自主编写 JavaScript 代码...`, `color: #8b5cf6; font-size: 14px; font-weight: bold; padding: 4px 0;`);
                    console.log(`%c🎯 编码意图:%c ${args.reasoning}`, `color: #10b981; font-weight: bold;`, `color: #334155; font-size: 13px;`);
                    console.log(`%c💻 生成的源码:\n%c${args.code}`, `color: #3b82f6; font-weight: bold;`, `color: #ef4444; font-family: monospace; font-size: 13px; background: #f8fafc; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; display: block; width: 100%;`);
                    
                    // 核心：动态执行 AI 写出的代码！
                    const rawResult = new Function(args.code)();
                    
                    // 🌟 核心修复：如果是对象或数组，强制序列化为 JSON 字符串，彻底消灭 [object Object] 瞎子危机！
                    let finalResult = rawResult;
                    if (typeof rawResult === 'object' && rawResult !== null) {
                        finalResult = JSON.stringify(rawResult, null, 2);
                    }

                    console.log(`%c✅ [沙盒运算完毕] 底层返回结果:\n%c${finalResult}`, `color: #10b981; font-weight: bold;`, `color: #0f172a; font-size: 13px; font-weight: 900; background: #dcfce7; padding: 6px; border-radius: 4px; display: block;`);

                    body.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: `代码执行成功！沙盒返回的绝对精确结果为:\n${finalResult}\n👉 请将此结果无缝融入你的最终分析报告中。`
                    });
                } catch (e) {
                    console.error(`%c❌ [沙盒执行崩溃] 代码语法或逻辑有误:`, `color: #ef4444; font-weight: bold;`, e);
                    body.messages.push({ 
                        role: "tool", 
                        tool_call_id: toolCall.id, 
                        name: toolName, 
                        content: `你写的代码执行报错了: ${e.message}。请检查语法逻辑，修复后重新调用执行！` 
                    });
                }
            }

            // 🌟 核心升级：精细化处理 Google 数字搜索 和 Tavily 新闻搜索
            else if (toolName === 'google_macro_search' || toolName === 'tavily_news_search' || toolName === 'exa_research') {
    try {
        const args = JSON.parse(toolCall.function.arguments);
        let finalQuery = args.query.trim(); // 🌟 仅仅 trim 即可，绝对不要删“今日”、“最新”这种词！
        
        console.log(`🔥 [Agent 调度] AI 激活【${toolName}】 | 发射检索词: [${finalQuery}]`);
        
        let searchRes = "";
        
        // 路由分发 (把 AI 决定的时间参数传进去)
        if (toolName === 'google_macro_search') {
            const tr = args.timeRange || "qdr:d"; // 默认卡死 24 小时
            searchRes = await fetchSerperSearch(settings.serperApiKey, finalQuery, tr);
        } else if (toolName === 'tavily_news_search') {
            const recency = args.recency || "d3";
            searchRes = await fetchTavilySearch(settings.tavilyApiKey, finalQuery, "news", settings, recency);
        } else if (toolName === 'exa_research') {
            searchRes = await fetchExaSearch(settings.exaApiKey, finalQuery, settings);
        }
        
        // 极致降级兜底
        if (!searchRes && settings.serperApiKey && toolName !== 'google_macro_search') {
            console.log(`⚠️ [Agent 降级] 主节点超时，触发 Serper 兜底: ${finalQuery}`);
            searchRes = await fetchSerperSearch(settings.serperApiKey, finalQuery, "qdr:w"); // 兜底给个一周范围
        }

        // 🌟 终极防污染绝杀：在返回给 AI 的结果前，追加一行强烈的物理时间提示
        const timeWarning = `[系统物理防伪探针] 现在的真实时间是 ${todayStr}。请严格核对以下搜索结果中的【发布时间】！如果新闻是几个月前甚至几年前的，说明它是过时垃圾信息，绝对禁止作为判断依据！\n\n`;

        body.messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: searchRes ? (timeWarning + searchRes) : "未检索到精确数据，请停止主观臆断并告知用户缺乏数据支撑。"
        });
    } catch (e) {
                    console.error(`❌ [Agent 崩溃] 武器【${toolName}】卡壳！报错:`, e);
                    body.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: "接口执行异常，请忽略本次查询结果。"
                    });
                }
            }

            else if (toolName === 'update_ledger') {
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`🔥 [Agent 调度] AI 触发自主记账(支持批量)！参数:`, args);
                
                // 🌟 兼容单条(旧逻辑)或批量(新逻辑)
                const actionsList = args.actions ? args.actions : (args.fundCode ? [args] : []);
                actionsList.forEach(act => pendingActions.push({ ...act, toolType: 'ledger' }));

                body.messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: `【系统提示】成功捕获 ${actionsList.length} 条记账指令，UI端将自动生成调仓卡片。🚨 强制指令：请你立刻继续完成刚才的宏观分析与调仓逻辑报告，并在报告末尾顺便告知用户调仓卡片已生成！`
                });
            }
        
            else if (toolName === 'manage_plan_todo') {
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`🔥 [Agent 调度] AI 触发待办生命周期管理(增删改)！参数:`, args);
                
                const plansList = args.plans ? args.plans : [];
                plansList.forEach(plan => pendingActions.push({ ...plan, toolType: 'todo' }));

                body.messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: `【系统提示】成功捕获 ${plansList.length} 条待办指令(增/删/改)。请立刻继续输出你的建议，并在末尾提醒用户点击卡片确认授权。`
                });
            }

            else if (toolName === 'update_decision_memo') {
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`🧠 [Agent 记忆觉醒] AI 正在写入核心决策备忘录:`, args);
                
                pendingActions.push({ ...args, toolType: 'memo' });

                body.messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: "【系统提示】该战略研判已成功生成记忆卡片。请继续回答用户的问题，并告知用户你已将此结论记录在备忘录中。"
                });
            }

            else if (toolName === 'update_fof_dictionary') {
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`🔥 [Agent 调度] AI 触发穿透字典采编！参数:`, args);
                
                pendingActions.push({ ...args, toolType: 'fof_dict' });
                body.messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    name: toolName,
                    content: "【系统提示】FOF 穿透字典入库单据已生成。请在回复中提示用户点击卡片确认写入云端。"
                });
            }

            // 🌟 武器10 对应的回调执行逻辑 (绝对客观的数学量化版)
            else if (toolName === 'get_market_historical_intraday') {
                try {
                    let args = {};
                    let rawArgs = toolCall.function.arguments;
                    if (rawArgs === 'undefined' || !rawArgs) rawArgs = '{}';
                    args = JSON.parse(rawArgs);

                    console.log(`🔥 [Agent 调度] AI 启动历史K线溯源！目标代码:【${args.code}】`);
                    
                    let code = args.code.toLowerCase();
                    if (/^\d{6}$/.test(code)) {
                        code = (code === '000001' || code.startsWith('5')) ? 'sh' + code : 'sz' + code;
                    }

                    // 1. 抓取过去 20 个交易日 (约一个月) 的数据
                    const targetUrl = `https://ifzq.gtimg.cn/appstock/app/kline/kline?param=${code},day,,,20,`;
                    let fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
                        ? (settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl)) : settings.customProxyUrl + targetUrl)
                        : `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;

                    const res = await fetch(fetchUrl, { cache: 'no-store' });
                    const resData = await res.json();
                    
                    const dayData = resData?.data?.[code]?.day || resData?.data?.[code]?.qfqday;

                    let resultStr = `【资产 ${args.code} 过去 20 个交易日的K线结构微观数据】\n(注：百分比基准为当日开盘价)\n`;

                    if (dayData && Array.isArray(dayData)) {
                        dayData.forEach(day => {
                            const date = day[0];
                            const open = parseFloat(day[1]);
                            const close = parseFloat(day[2]);
                            const high = parseFloat(day[3]);
                            const low = parseFloat(day[4]);
                            
                            // 2. 🧠 纯数学提取：计算振幅、实体和上下影线的【精确相对百分比】
                            const ampPct = ((high - low) / open * 100).toFixed(2);
                            const bodyPct = ((close - open) / open * 100).toFixed(2); // 正数为阳，负数为阴
                            const upperPct = ((high - Math.max(open, close)) / open * 100).toFixed(2);
                            const lowerPct = ((Math.min(open, close) - low) / open * 100).toFixed(2);
                            
                            // 3. 构建无情绪干扰的数据结构，让 AI 自己去推理形态
                            const shapeMath = `(振幅${ampPct}% | 实体${bodyPct > 0 ? '+'+bodyPct : bodyPct}% | 上影${upperPct}% | 下影${lowerPct}%)`;

                            resultStr += `- [${date}] 开:${open} 收:${close} 高:${high} 低:${low} ${shapeMath}\n`;
                        });
                    } else {
                        resultStr += "暂无历史K线数据。\n";
                    }

                    console.log(`%c🔍 [历史K线探针] 喂给 AI 的客观数学矩阵:\n${resultStr}`, "color: #10b981; font-weight: bold;");

                    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: resultStr });
                } catch (e) {
                    console.error("历史K线获取失败", e);
                    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "K线数据库调用异常。" });
                }
            }

        }
        
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        data = await response.json();
        
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        if (data.message && !data.choices) throw new Error(data.message);
    }

    // ==========================================
    // 最终组装并返回
    // ==========================================
    if (provider === 'gemini') {
        if (!data.candidates || data.candidates.length === 0) {
            throw new Error(`Google API 未返回有效文本，可能是联网搜索超时或被安全策略拦截。`);
        }
        const parts = data.candidates[0].content?.parts;
        if (!parts || parts.length === 0 || !parts[0].text) {
            throw new Error("Google API 返回了非标准文本数据。");
        }
        return parts[0].text;
    } else {
        const msg = data.choices[0].message;
        // 🌟 修复 3：将循环中截获的上半部分正文，与最终返回的正文完美拼接！
        let finalContent = accumulatedContent + (msg.content || '');
        
        // 🌟 兜底：处理部分第三方平台把 think 标签直接塞进正文 content 的奇葩情况
        const thinkMatch = finalContent.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
            accumulatedReasoning += thinkMatch[1] + '\n\n';
            finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        }

        // 正常接收推理模型的思考过程
        if (msg.reasoning_content) {
            accumulatedReasoning += msg.reasoning_content;
        }

        // 🚨 终极防线：动态 UI 自适应
        // 默认的思考框样式（带最大高度和滚动条）
        let thinkingBoxClass = "text-slate-400 dark:text-slate-500 text-xs opacity-90 border-l-4 border-slate-300 dark:border-slate-600 pl-3 py-2 mb-4 bg-slate-50 dark:bg-slate-900/50 max-h-[300px] overflow-y-auto custom-scrollbar rounded-r-lg";

        // 如果正文居然是空的！
        if (!finalContent) {
            if (msg.tool_calls) {
                finalContent = "⚠️ 警报：AI 已经连续进行了 12 轮地毯式深度检索，触及了系统最大允许的安全运算深度，进程已被强制中断。";
            } else if (accumulatedReasoning) {
                // 说明 AI 犯了老毛病，把最终答案全写在草稿本（思考过程）里了，且因为额度耗尽没能写正文！
                finalContent = "*(系统提示：AI 思考过程过长导致正文被截断，请直接阅读上方的深度思考过程，或让 AI “精简总结一下”)*";
                
                // 让灰框完全展开，用户可以直接顺畅地往下读，再也不用在小框里痛苦地拖动滚动条了！
                thinkingBoxClass = thinkingBoxClass.replace("max-h-[300px] overflow-y-auto custom-scrollbar ", "");
            }
        }

        // 最终组装
        if (accumulatedReasoning) {
            // 🌟 修复 4：极其关键的 HTML 字符转义！防止 '<' 和 '>' 把你的 dangerouslySetInnerHTML 搞崩溃
            const thinkProcess = accumulatedReasoning
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '<br/>');
                
            finalContent = `### 🧠 AI 深度多轮思考过程\n<div class="${thinkingBoxClass}">${thinkProcess}</div>\n\n` + finalContent;
        }

        // 🌟 终极组装：如果拦截到了任何动作，把整个动作数组打包返回！
        if (pendingActions.length > 0) {
            return {
                type: 'ACTION_REQUIRED',
                payload: pendingActions, // 现在这里是一个装满卡片数据的数组！
                text: finalContent
            };
        }

        return finalContent;
    }
  } catch (error) {
    throw new Error(error.message === "Failed to fetch" ? `网络无法访问，请检查代理` : error.message);
  }
};

// ============================================================================
// 5. 底层 HTTP 请求封装
// ============================================================================
const executeAIRequest = async (provider, apiKey, modelName, prompt, targetTemp = 0.1, targetTopP = 0.1) => {
  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    if (provider === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        body = {
            contents:[{ parts:[{ text: prompt }] }],
            tools:[{ googleSearch: {} }], 
            generationConfig: { temperature: targetTemp, topP: targetTopP, maxOutputTokens: 8192 },
            safetySettings:[
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        };
    } else {
        url = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.siliconflow.cn/v1/chat/completions';
        headers['Authorization'] = `Bearer ${apiKey}`;
        body = {
            model: modelName,
            messages:[{ role: 'user', content: prompt }],
            temperature: targetTemp,
            top_p: targetTopP,
            max_tokens: 8192,
            // 🚨 精准识别，仅给 DeepSeek 原生官方接口发送思考参数，防止第三方兼容代理（如硅基流动）报 400 错误
            ...(provider === 'deepseek' && {
                thinking: { type: "enabled" },
                reasoning_effort: "max"
            })
        };
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await response.json();
    
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices) throw new Error(data.message);
    
    if (provider === 'gemini') {
        if (!data.candidates || data.candidates.length === 0) {
            if (data.promptFeedback && data.promptFeedback.blockReason) {
                throw new Error(`内容被 Google 安全策略拦截 (${data.promptFeedback.blockReason})`);
            }
            throw new Error(`Google API 未返回有效文本，可能是联网搜索超时或无结果。`);
        }
        const parts = data.candidates[0].content?.parts;
        if (!parts || parts.length === 0 || !parts[0].text) {
            throw new Error("Google API 返回了非标准文本数据 (可能触发了内部工具错误)。");
        }
        return parts[0].text;
    } else {
        if (!data.choices || data.choices.length === 0) {
            throw new Error(`API 返回空数据: ${JSON.stringify(data)}`);
        }
        const msg = data.choices[0].message;
        let finalContent = msg.content || '';
        if (msg.reasoning_content) {
            const thinkProcess = msg.reasoning_content.replace(/\n/g, '<br/>');
            finalContent = `### 🧠 AI 深度思考过程\n<div class="text-slate-400 dark:text-slate-500 text-xs opacity-90 border-l-4 border-slate-300 dark:border-slate-600 pl-3 py-2 mb-4 bg-slate-50 dark:bg-slate-900/50 rounded-r-lg">${thinkProcess}</div>\n\n` + finalContent;
        }
        return finalContent;
    }
  } catch (error) {
    console.error("AI API Error:", error);
    throw new Error(error.message === "Failed to fetch" ? `网络无法访问 ${provider} 服务，请检查代理节点状态。` : error.message);
  }
};