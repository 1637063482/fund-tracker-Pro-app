// Cloudflare Worker 云端定时巡检脚本：通过 Cron 触发器在盘中/收盘/每日/每周自动执行数据抓取与推送通知
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 统一规范化 pathname：合并多余斜杠（如 //api/sync → /api/sync）
    const normalizedPath = url.pathname.replace(/\/{2,}/g, '/');

    // CORS 预检：对所有 OPTIONS 请求统一响应
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // 受保护的 POST：完整账本同步
    if (request.method === 'POST' && normalizedPath === '/api/sync') {
      try {
        const data = await request.json();
        if (data.syncSecret !== env.SYNC_SECRET) {
          return new Response('Unauthorized: 同步密码错误', { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } });
        }
        await env.FUND_DB.put('USER_DATA', JSON.stringify({ funds: data.funds, settings: data.settings, portfolioStats: data.portfolioStats }));
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      } catch (e) {
        return new Response('Sync Error: ' + e.message, { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
    }

    // 手动测试巡检
    if (request.method === 'GET' && normalizedPath === '/api/test_cron') {
      try {
        const result = await this.runInspection(env, true, request);
        return new Response('测试巡检执行成功！\n\n推送结果：\n' + result, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
      } catch (e) {
        return new Response('测试执行失败: ' + e.message, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // 默认响应也带上 CORS 头，方便前端调试
    return new Response('Fund Tracker Pro - Cloudflare Worker is active.', {
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(this.runInspection(env, false, null));
  },

  async runInspection(env, isManualTest, request) {
    // 1. 获取账本基础数据
    const rawData = await env.FUND_DB.get('USER_DATA');
    if (!rawData) return "未找到用户数据，请先同步。";

    const { funds, settings } = JSON.parse(rawData);
    if (!funds || funds.length === 0) return "当前没有任何持仓记录。";

    // 2. 判定运行模式
    let runMode = 'daily';
    const utcHour = new Date().getUTCHours();
    const utcDay = new Date().getUTCDay();

    if (utcHour === 6) runMode = 'intraday';
    else if (utcHour === 7) runMode = 'market_close';
    else if (utcHour === 15 && utcDay === 5) runMode = 'weekly';
    else if (utcHour === 14 || utcHour === 15) runMode = 'daily';

    if (isManualTest && request) {
      const testUrl = new URL(request.url);
      const forceMode = testUrl.searchParams.get('mode');
      if (forceMode) runMode = forceMode;
    }

    // 3. 交易日历检查
    const beijingTime = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const targetYear = beijingTime.getFullYear();
    let holidayData = [];

    try {
      const cacheKey = 'HOLIDAY_CN_' + targetYear;
      let cached = await env.FUND_DB.get(cacheKey);
      if (!cached) {
        const res = await fetch('https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/' + targetYear + '.json');
        if (res.ok) {
          const data = await res.json();
          holidayData = data.days || [];
          await env.FUND_DB.put(cacheKey, JSON.stringify(holidayData));
        }
      } else {
        holidayData = JSON.parse(cached);
      }
    } catch (e) { console.warn("日历同步失败, 降级为周末判断", e); }

    const checkIsTradingDay = (dateObj) => {
      const day = dateObj.getDay();
      if (day === 0 || day === 6) return false;
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(dateObj.getDate()).padStart(2, '0');
      const checkDateStr = yyyy + '-' + mm + '-' + dd;
      const holiday = holidayData.find(h => h.date === checkDateStr);
      if (holiday && holiday.isOffDay) return false;
      return true;
    };

    const isTodayTradingDay = checkIsTradingDay(beijingTime);
    if (!isTodayTradingDay && !isManualTest) {
      return '【休市静默】今日（' + beijingTime.toLocaleDateString() + '）为周末或法定节假日，A股休市，已拦截自动推送。';
    }

    // 推算下一个交易日
    let nextTradeDate = new Date(beijingTime.getTime());
    nextTradeDate.setDate(nextTradeDate.getDate() + 1);
    let daysToNextTrade = 1;
    while (!checkIsTradingDay(nextTradeDate) && daysToNextTrade < 30) {
      nextTradeDate.setDate(nextTradeDate.getDate() + 1);
      daysToNextTrade++;
    }
    const nextTradeStr = (nextTradeDate.getMonth() + 1) + '月' + nextTradeDate.getDate() + '日';
    const marketCalendarStatus = daysToNextTrade === 1
      ? '【交易日历】明日为正常交易日。'
      : '【休市警报】明日起休市！下一个交易日为 ' + nextTradeStr + '（需等待 ' + daysToNextTrade + ' 天）。';

    // 4. 获取历史快照
    const historyRaw = await env.FUND_DB.get('PROFIT_HISTORY_V2');
    let historyObj = historyRaw ? JSON.parse(historyRaw) : { daily: { totalProfit: undefined, funds: {} }, weekly: { totalProfit: undefined, funds: {} } };
    const baseHistory = runMode === 'weekly' ? historyObj.weekly : historyObj.daily;
    const periodLabel = runMode === 'weekly' ? '本周盈亏' : '今日盈亏';
    let currentFundProfitsMap = {};

    // 5. 大盘数据抓取
    let marketDataStr = "无大盘数据";
    let feishuMarketTable = "无大盘数据";
    let isExtremeMarket = false;
    let mainEqChange = 0;
    let shPct = 0, bondPct = 0;

    try {
      const res = await fetch('https://qt.gtimg.cn/q=sh000001,sz399001,sz399006,sh511260,sh511090,hkHSI,sh518880,sh510300&rt=' + Date.now());
      const buffer = await res.arrayBuffer();
      const text = new TextDecoder('gbk').decode(buffer);
      const lines = text.split(';');
      const marketInfos = [];
      let feishuList = "";

      lines.forEach(line => {
        if (!line.trim()) return;
        const vals = line.split('~');
        if (vals.length > 32) {
          let name = vals[1];
          if (name.includes("ETF")) {
            name = name.substring(0, name.indexOf("ETF") + 3);
          }
          const price = vals[3];
          const changePercent = parseFloat(vals[32]);

          if (name.includes("上证")) { mainEqChange = changePercent; shPct = changePercent; }
          if (name.includes("国债")) bondPct = changePercent;

          marketInfos.push('- ' + name + ': ' + price + ' (' + (changePercent > 0 ? '+' : '') + changePercent + '%)');

          const color = changePercent > 0 ? "red" : (changePercent < 0 ? "green" : "grey");
          const sign = changePercent > 0 ? "+" : "";
          const icon = name.includes("债") ? "🏦" : (name.includes("黄金") ? "🪙" : "📈");
          feishuList += icon + ' **' + name + '**：' + price + ' ｜ <font color=\'' + color + '\'>**' + sign + changePercent + '%**</font>\n\n';

          // 异动判定
          if (name.includes("债")) {
            if (changePercent <= -0.3 || changePercent >= 0.3) isExtremeMarket = true;
          } else if (!name.includes("黄金")) {
            if (changePercent <= -1.5 || changePercent >= 2.0) isExtremeMarket = true;
          }
        }
      });
      marketDataStr = marketInfos.length > 0 ? marketInfos.join('\n') : "获取数据为空";
      feishuMarketTable = feishuList;
    } catch (e) { console.error("获取大盘数据失败", e); }

    // 盘中静默拦截
    if (runMode === 'intraday') {
      if (!isExtremeMarket && !isManualTest) {
        return '盘中巡检：当前跨市场情绪平稳，未触发极端阈值，静默休眠。';
      }
    }

    // 6. 组合核算引擎
    const safeMathEval = (s) => {
      s = s.replace(/\s/g, '');
      let i = 0;
      const expr = () => {
        let left = term();
        while (i < s.length) {
          if (s[i] === '+') { i++; left += term(); }
          else if (s[i] === '-') { i++; left -= term(); }
          else break;
        }
        return left;
      };
      const term = () => {
        let left = factor();
        while (i < s.length) {
          if (s[i] === '*') { i++; left *= factor(); }
          else if (s[i] === '/') { i++; const divisor = factor(); left = divisor === 0 ? 0 : left / divisor; }
          else break;
        }
        return left;
      };
      const factor = () => {
        if (i >= s.length) return 0;
        if (s[i] === '(') { i++; const val = expr(); if (i < s.length && s[i] === ')') i++; return val; }
        if (s[i] === '-') { i++; return -factor(); }
        if (s[i] === '+') { i++; return factor(); }
        let start = i;
        while (i < s.length && /[0-9.]/.test(s[i])) i++;
        if (start === i) return 0;
        return parseFloat(s.slice(start, i));
      };
      const result = expr();
      return isNaN(result) || !isFinite(result) ? 0 : result;
    };
    const evaluateExpression = (expr) => {
      if (typeof expr !== 'string') return expr || 0;
      let toEval = expr.trim();
      if (toEval.startsWith('=')) toEval = toEval.substring(1);
      if (!toEval) return 0;
      if (!/^[0-9+\-*/().\s]*$/.test(toEval)) return isNaN(parseFloat(expr)) ? 0 : parseFloat(expr);
      try {
        const result = safeMathEval(toEval);
        return isNaN(result) || !isFinite(result) ? 0 : Number(result.toFixed(2));
      } catch (e) { return isNaN(parseFloat(expr)) ? 0 : parseFloat(expr); }
    };

    let portfolioTotalCurrentValue = 0;
    let portfolioTotalProfit = 0;
    let lastBuyTimestamp = 0;
    let buyList = [], sellList = [], warnList = [], displayFundList = [];

    for (const fund of funds) {
      let totalInvested = 0;
      let realizedReturns = 0;
      let lastBuyTimestampForThisFund = 0;

      (fund.transactions || []).forEach(tx => {
        const rawAmt = evaluateExpression(tx.amountRaw);
        const inferredType = tx.type || (rawAmt < 0 ? 'buy' : 'sell');
        let amt = Math.round(Math.abs(rawAmt) * 100) / 100;
        if (inferredType === 'buy' || inferredType === 'fee') {
          totalInvested += amt;
          const txTime = new Date(tx.date).getTime();
          if (txTime > lastBuyTimestamp) lastBuyTimestamp = txTime;
          if (txTime > lastBuyTimestampForThisFund) lastBuyTimestampForThisFund = txTime;
        } else if (inferredType === 'sell' || inferredType === 'dividend_cash') {
          realizedReturns += amt;
        }
      });

      let currentVal = 0;
      let grl1m = 0;
      let rankPercentile = 0.5;
      const classifyFundType = (name, apiTypeDesc) => {
        const combined = (name + ' ' + (apiTypeDesc || ''));
        if (/短债|理财|货币|收蛋|纯债|债券|中短债|定期开放|债/.test(combined)) return 'bond';
        if (/混合|固收\+|平衡/.test(combined)) return 'balanced';
        return 'equity';
      };
      let fundType = 'equity';

      if (fund.isArchived) {
        currentVal = 0;
      } else if (fund.mode === 'auto') {
        let nav = fund.lastNav || 0;
        let apiTypeDesc = '';
        if (fund.fundCode) {
          try {
            const res = await fetch('https://danjuanfunds.com/djapi/fund/' + fund.fundCode, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const data = await res.json();
            if (data && data.data && data.data.fund_derived) {
              nav = parseFloat(data.data.fund_derived.unit_nav) || nav;
              grl1m = parseFloat(data.data.fund_derived.nav_grl1m) || 0;
              const srank = data.data.fund_derived.srank_l1y;
              if (srank && srank.includes('/')) {
                const parts = srank.split('/');
                if (parseFloat(parts[1]) > 0) rankPercentile = parseFloat(parts[0]) / parseFloat(parts[1]);
              }
              apiTypeDesc = data.data.type_desc || '';
            } else {
              const res2 = await fetch('https://fundgz.1234567.com.cn/js/' + fund.fundCode + '.js?rt=' + Date.now());
              const text2 = await res2.text();
              const match = text2.match(/jsonpgz\((.*)\);/);
              if (match && match[1]) nav = parseFloat(JSON.parse(match[1]).dwjz) || nav;
            }
          } catch (e) {}
        }
        fundType = classifyFundType(fund.name, apiTypeDesc);
        currentVal = (Number(fund.shares) || 0) * nav;
        if (currentVal === 0 && fund.currentValueRaw) {
          const oldVal = evaluateExpression(fund.currentValueRaw);
          if (!isNaN(oldVal)) currentVal = oldVal;
        }
      } else {
        fundType = classifyFundType(fund.name, '');
        currentVal = evaluateExpression(fund.currentValueRaw) || 0;
      }

      currentVal = Math.round(currentVal * 100) / 100;
      const profit = currentVal + realizedReturns - totalInvested;

      portfolioTotalCurrentValue += currentVal;
      portfolioTotalProfit += profit;

      const fundIdentityKey = fund.fundCode || fund.name;
      currentFundProfitsMap[fundIdentityKey] = profit;

      let actionSignal = "持仓观望";
      if (!fund.isArchived && currentVal > 0) {
        const returnRate = totalInvested > 0 ? profit / totalInvested : 0;
        const isGarbage = rankPercentile > 0.7 && returnRate < 0;
        const isMediocre = rankPercentile > 0.7 && returnRate >= 0;
        const isTopTier = rankPercentile < 0.2;
        const daysSinceLastBuyThisFund = lastBuyTimestampForThisFund > 0 ? (Date.now() - lastBuyTimestampForThisFund) / (1000 * 3600 * 24) : 999;
        const isNewPosition = daysSinceLastBuyThisFund <= 7;

        if (isGarbage && !isNewPosition) {
          actionSignal = "长期垫底且亏损 (触及风控底线)";
          warnList.push(fund.name);
        } else if (isGarbage && isNewPosition) {
          actionSignal = '排名垫底但近期(' + Math.floor(daysSinceLastBuyThisFund) + '天前)刚建仓，处于免死保护期';
        } else if (isMediocre) {
          actionSignal = "表现平庸，底仓观望";
        } else {
          const thresholds = {
            bond:    { profit: 0.08, drop: -1.5 },
            balanced:{ profit: 0.10, drop: -2.0 },
            equity:  { profit: 0.15, drop: (isTopTier ? -3.0 : -5.0) }
          };
          const t = thresholds[fundType] || thresholds.equity;
          if (returnRate > t.profit) {
            actionSignal = "触发机械止盈线 (建议评估抛售)";
            sellList.push(fund.name);
          } else if (grl1m < t.drop) {
            actionSignal = "触发机械超跌线 (建议评估抄底)";
            buyList.push(fund.name);
          }
        }

        let periodFundProfitStr = "";
        if (baseHistory.funds && baseHistory.funds[fundIdentityKey] !== undefined) {
          const diff = profit - baseHistory.funds[fundIdentityKey];
          periodFundProfitStr = ' | ' + periodLabel + ': ' + (diff >= 0 ? '+' : '') + diff.toFixed(2);
          const sign = diff > 0 ? '+' : '';
          const dot = diff > 0 ? '🔴' : (diff < 0 ? '🟢' : '⚪');
          displayFundList.push(dot + ' ' + fund.name + '：**' + sign + diff.toFixed(2) + '**');
        } else {
          displayFundList.push('⚪ ' + fund.name + '：等待收盘生成基准数据');
        }
      }
    }

    const idleFunds = Number(settings.idleFunds) || 0;
    const targetAmt = Number(settings.targetAmount) || 0;
    const daysSinceLastBuy = lastBuyTimestamp > 0 ? Math.floor((Date.now() - lastBuyTimestamp) / (1000 * 3600 * 24)) : 999;

    // 7. 计算区间盈亏
    let periodTotalProfit = 0;
    let periodTotalProfitStr = "初始核算中(等待明日生成快照)";
    if (baseHistory.totalProfit !== undefined) {
      periodTotalProfit = portfolioTotalProfit - baseHistory.totalProfit;
      periodTotalProfitStr = (periodTotalProfit >= 0 ? '+' : '') + periodTotalProfit.toFixed(2) + ' 元';
    }

    // 8. 机器信号
    let hardcodedActions = "";
    if (buyList.length > 0 || sellList.length > 0 || warnList.length > 0) {
      hardcodedActions += "【机器交易信标】\n";
      if (buyList.length > 0) hardcodedActions += '🟢 触底加仓池：' + buyList.join('、') + '\n';
      if (sellList.length > 0) hardcodedActions += '🔴 达标止盈池：' + sellList.join('、') + '\n';
      if (warnList.length > 0) hardcodedActions += '⚠️ 劣质止损池：' + warnList.join('、') + '\n';
    } else {
      hardcodedActions += "【机器交易信标】\n当前无极端触发条件，全盘维持持仓观望。\n";
    }

    // 9. 单基明细
    let fundDetailDisplayStr = "";
    if ((runMode === 'daily' || runMode === 'weekly') && displayFundList.length > 0) {
      fundDetailDisplayStr = '\n\n---\n**🧾 ' + periodLabel + '单基明细**\n> ' + displayFundList.join('\n> ');
    }

    // 10. 组装推送内容（纯数据，无 AI）
    let reportTitle = "";
    let reportBody = "";

    if (runMode === 'intraday') {
      reportTitle = '🚨 盘中极端异动警报';
      reportBody = '**⏱️ 盘中异动监测**\n\n' +
        '**📊 跨资产大盘快报**\n\n' + feishuMarketTable + '\n\n' +
        '⚠️ 当前触发极端波动阈值，请注意风险！\n\n' +
        '全盘总市值：' + portfolioTotalCurrentValue.toFixed(2) + ' 元 | 备用子弹：' + idleFunds + ' 元\n' +
        periodLabel + '预估：' + periodTotalProfitStr + '\n\n' +
        hardcodedActions;
    } else if (runMode === 'market_close') {
      // 规则引擎：一句话市场情绪判定
      let mood = "";
      if (shPct > 0.5 && bondPct > 0.05) mood = "股债双牛，风险偏好显著回升";
      else if (shPct > 0.5 && bondPct < -0.1) mood = "股强债弱，资金跷跷板偏向权益端";
      else if (shPct < -0.5 && bondPct > 0.1) mood = "股市承压，避险资金涌入债市";
      else if (shPct < -0.5 && bondPct < -0.1) mood = "股债双杀，市场流动性偏紧";
      else if (shPct > 0) mood = "权益温和收涨，情绪偏暖";
      else if (shPct < 0) mood = "权益小幅收跌，市场偏谨慎";
      else mood = "大盘横盘整理，情绪中性";

      reportTitle = '🔔 15:00 收盘快报';
      reportBody = '> **📊 15:00 收盘跨资产快报**\n\n' + feishuMarketTable + '\n\n' +
        '> **💬 今日情绪**：' + mood;
    } else if (runMode === 'weekly') {
      const milestoneProgress = targetAmt > 0 ? ((portfolioTotalProfit / targetAmt) * 100).toFixed(2) : '未知';
      reportTitle = '📅 资产深度操作周报';
      reportBody = '**📊 本周跨资产大盘概览**\n\n' + feishuMarketTable + '\n\n' +
        '---\n\n' +
        '**💰 本周全盘清算**\n\n' +
        periodLabel + '：**' + periodTotalProfitStr + '**\n' +
        '累计总盈亏：' + portfolioTotalProfit.toFixed(2) + ' 元\n' +
        '全盘总市值：' + portfolioTotalCurrentValue.toFixed(2) + ' 元\n' +
        '财富目标进度：' + milestoneProgress + '%\n' +
        '备用空闲资金：' + idleFunds + ' 元\n' +
        '距离上次买入已防守：' + daysSinceLastBuy + ' 天\n\n' +
        marketCalendarStatus + '\n\n' +
        hardcodedActions +
        fundDetailDisplayStr;
    } else {
      // daily
      reportTitle = '📝 晚间量化核算';
      reportBody = '**📊 今日跨资产大盘**\n\n' + feishuMarketTable + '\n\n' +
        '---\n\n' +
        '**💰 今日清算**\n\n' +
        periodLabel + '：**' + periodTotalProfitStr + '**\n' +
        '累计总盈亏：' + portfolioTotalProfit.toFixed(2) + ' 元\n' +
        '全盘总市值：' + portfolioTotalCurrentValue.toFixed(2) + ' 元\n' +
        '备用空闲资金：' + idleFunds + ' 元\n\n' +
        marketCalendarStatus + '\n\n' +
        hardcodedActions +
        fundDetailDisplayStr;
    }

    // 11. 推送长度保护
    const fullReport = reportBody;
    const shortReport = fullReport.length > 4000 ? fullReport.substring(0, 4000) + '\n\n...(内容过长已截断)' : fullReport;

    // 12. 多通道推送
    let pushResult = "推送未执行";
    const pushToken = (settings.ntfyTopic || '').trim();

    if (pushToken) {
      try {
        const titleText = isManualTest ? '🛠️ [测试] 云端量化巡检' : reportTitle;

        if (pushToken.startsWith('https://open.feishu.cn') || pushToken.startsWith('https://open.larksuite.com')) {
          // 飞书卡片
          let cardColor = "blue";
          if (runMode === 'market_close') {
            cardColor = mainEqChange > 0 ? "red" : (mainEqChange < 0 ? "green" : "blue");
          } else if (runMode === 'weekly') {
            cardColor = "purple";
          } else if (runMode === 'daily') {
            cardColor = periodTotalProfit >= 0 ? "red" : "green";
          } else {
            cardColor = isExtremeMarket ? (mainEqChange <= -1.5 ? "red" : "orange") : "blue";
          }

          const cardRes = await fetch(pushToken, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
              msg_type: "interactive",
              card: {
                config: { wide_screen_mode: true },
                header: {
                  title: { tag: "plain_text", content: titleText },
                  template: cardColor
                },
                elements: [
                  { tag: "markdown", content: fullReport },
                  { tag: "hr" },
                  { tag: "note", elements: [{ tag: "plain_text", content: '✅ 核算完毕 | ' + periodLabel + ': ' + periodTotalProfitStr + ' | 累计总利润: ' + portfolioTotalProfit.toFixed(2) }] }
                ]
              }
            })
          });
          const cardData = await cardRes.json();
          if (cardData.code === 0) pushResult = "✅ 已成功推送到【飞书】客户端！";
          else pushResult = '飞书报错: ' + cardData.msg;

        } else if (pushToken.startsWith('https://oapi.dingtalk.com')) {
          // 钉钉
          const ddRes = await fetch(pushToken, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
              msgtype: "markdown",
              markdown: {
                title: "资产巡检",
                text: '### ' + titleText + '\n\n**' + periodLabel + '：' + periodTotalProfitStr + '**\n\n' + fullReport
              }
            })
          });
          const ddData = await ddRes.json();
          if (ddData.errcode === 0) pushResult = "✅ 已成功推送到【钉钉】客户端！";
          else pushResult = '钉钉报错: ' + ddData.errmsg;

        } else {
          // Ntfy
          const topic = encodeURIComponent(pushToken);
          const title = encodeURIComponent(titleText);
          const tags = periodTotalProfit >= 0 ? 'chart_with_upwards_trend,robot' : 'chart_with_downwards_trend,robot';
          const ntfyUrl = 'https://ntfy.sh/' + topic + '?title=' + title + '&tags=' + tags + '&markdown=yes';
          let pushHeaders = {};
          if (request) {
            const clientIp = request.headers.get('CF-Connecting-IP');
            if (clientIp) pushHeaders['X-Forwarded-For'] = clientIp;
          }
          let pushRes = await fetch(ntfyUrl, { method: 'POST', body: '**' + periodLabel + '：' + periodTotalProfitStr + '**\n\n' + shortReport, headers: pushHeaders });
          if (pushRes.status === 429) {
            await new Promise(r => setTimeout(r, 2000));
            pushRes = await fetch(ntfyUrl, { method: 'POST', body: '**' + periodLabel + '：' + periodTotalProfitStr + '**\n\n' + shortReport, headers: pushHeaders });
          }
          if (pushRes.ok) pushResult = "✅ 已推送到 Ntfy 客户端！";
          else pushResult = 'Ntfy 报错: HTTP ' + pushRes.status;
        }
      } catch (e) {
        pushResult = '推送网络请求失败: ' + e.message;
      }
    } else {
      pushResult = "未在设置中配置推送凭证，跳过推送。";
    }

    // 13. KV 利润快照写入
    if (!isManualTest && (runMode === 'daily' || runMode === 'weekly')) {
      try {
        historyObj.daily = { totalProfit: portfolioTotalProfit, funds: currentFundProfitsMap };
        if (runMode === 'weekly') {
          historyObj.weekly = { totalProfit: portfolioTotalProfit, funds: currentFundProfitsMap };
        }
        await env.FUND_DB.put('PROFIT_HISTORY_V2', JSON.stringify(historyObj));
        pushResult += "\n💾 (系统) 利润快照已成功安全回写 KV。";
      } catch (e) {
        pushResult += '\n⚠️ (系统) KV 写入失败: ' + e.message;
      }
    }

    return '账本核算：成功 (' + periodLabel + ': ' + periodTotalProfitStr + ' | 累计总利润: ' + portfolioTotalProfit.toFixed(2) + ')\n\n推送内容预览：\n' + fullReport + '\n\n推送状态：' + pushResult;
  },

  // [microstructure 端点已迁移至 my-cors-proxy.js — 统一在一个 Worker 中管理]
  async _fetchMicrostructure_removed(env) {
    const result = {
      liquidity: {},        // 银行间流动性
      derivatives: {},      // 期指基差
      repo_rates: {},       // 回购利率（SHIBOR/DR007 代理）
      indices_spot: {},     // 现货指数快照
      overall_signal: ''    // 综合定性结论
    };

    // ── 并行抓取 3 路数据（涨跌家数由大盘雷达注入，此处不重复拉取）──
    const [sinaIndices, sinaFutures, sinaRepo] = await Promise.allSettled([
      fetch('https://hq.sinajs.cn/list=sh000001,sz399001,sh000300,sh000016,sh000905,sh000852,sh000688', {
        headers: { 'Referer': 'https://finance.sina.com.cn' }
      }).then(r => r.text()).catch(() => ''),
      fetch('https://hq.sinajs.cn/list=CFF_RE_IM0,CFF_RE_IF0,CFF_RE_IC0', {
        headers: { 'Referer': 'https://finance.sina.com.cn' }
      }).then(r => r.text()).catch(() => ''),
      fetch('https://hq.sinajs.cn/list=sh204001,sh204007', {
        headers: { 'Referer': 'https://finance.sina.com.cn' }
      }).then(r => r.text()).catch(() => '')
    ]);

    // ── 1. 解析回购利率（GC001=隔夜/SHIBOR代理, GC007=7天/DR007代理）──
    if (sinaRepo.status === 'fulfilled' && sinaRepo.value) {
      const parseRepo = (line, label) => {
        const m = line.match(/var hq_str_\w+="([^"]+)"/);
        if (!m) return null;
        const p = m[1].split(',');
        if (p.length < 4) return null;
        const name = p[0];
        const open = parseFloat(p[1]) || 0;
        const prevClose = parseFloat(p[2]) || 0;    // 昨日收盘（利率基准）
        const current = parseFloat(p[3]) || 0;       // 当前价=最新利率
        const high = parseFloat(p[4]) || 0;
        const low = parseFloat(p[5]) || 0;
        const change = current - prevClose;           // 利率变动（bp）
        return { name, current, prevClose, high, low, change, open };
      };
      const lines = sinaRepo.value.split(';').filter(l => l.includes('hq_str_'));
      for (const line of lines) {
        const parsed = parseRepo(line);
        if (!parsed) continue;
        if (parsed.name === 'GC001') {
          result.repo_rates.GC001 = parsed;
          // 定性判定：隔夜利率 < 1.5% 宽松, 1.5-2.0% 中性, 2.0-2.5% 偏紧, >2.5% 紧缩
          const r = parsed.current;
          const delta = parsed.change;
          let level = '中性';
          if (r < 1.5) level = '宽松';
          else if (r < 2.0) level = '中性';
          else if (r < 2.5) level = '偏紧';
          else level = '紧缩';
          // 日变动 > 30bp = 急剧变化
          if (Math.abs(delta) > 0.30) level = delta > 0 ? '急剧收紧（央行可能在收水）' : '急剧放松（央行可能在放水）';
          result.liquidity.ON_rate = r;
          result.liquidity.ON_level = level;
          result.liquidity.ON_change_bp = Math.round(delta * 100);
        }
        if (parsed.name === 'GC007') {
          result.repo_rates.GC007 = parsed;
          const r = parsed.current;
          const delta = parsed.change;
          let level = '中性';
          if (r < 1.7) level = '宽松';
          else if (r < 2.2) level = '中性';
          else if (r < 2.8) level = '偏紧';
          else level = '紧缩';
          if (Math.abs(delta) > 0.30) level = delta > 0 ? '急剧收紧' : '急剧放松';
          result.liquidity.DR007_proxy_rate = r;
          result.liquidity.DR007_proxy_level = level;
          result.liquidity.DR007_change_bp = Math.round(delta * 100);
        }
      }
    }

    // ── 2. 解析指数现货快照 ──
    if (sinaIndices.status === 'fulfilled' && sinaIndices.value) {
      const parseIndex = (line) => {
        const m = line.match(/var hq_str_\w+="([^"]+)"/);
        if (!m) return null;
        const p = m[1].split(',');
        if (p.length < 6) return null;
        return {
          name: p[0],
          open: parseFloat(p[1]) || 0,
          prevClose: parseFloat(p[2]) || 0,
          current: parseFloat(p[3]) || 0,
          high: parseFloat(p[4]) || 0,
          low: parseFloat(p[5]) || 0,
          changePct: p[2] > 0 ? ((parseFloat(p[3]) - parseFloat(p[2])) / parseFloat(p[2]) * 100) : 0
        };
      };
      const indexLines = sinaIndices.value.split(';').filter(l => l.includes('hq_str_'));
      for (const line of indexLines) {
        const d = parseIndex(line);
        if (!d) continue;
        const key = d.name.includes('上证综') || d.name.includes('上证指') ? 'SH' :
                    d.name.includes('沪深300') ? 'HS300' :
                    d.name.includes('上证50') ? 'SZ50' :
                    d.name.includes('中证500') ? 'ZZ500' :
                    d.name.includes('中证1000') ? 'ZZ1000' :
                    d.name.includes('科创') ? 'STAR50' :
                    d.name.includes('深证') ? 'SZ' : null;
        if (key) result.indices_spot[key] = d;
      }
    }

    // ── 3. 解析期指 → 计算基差（升贴水）──
    if (sinaFutures.status === 'fulfilled' && sinaFutures.value) {
      const parseFuture = (line) => {
        const m = line.match(/var hq_str_\w+="([^"]+)"/);
        if (!m) return null;
        const p = m[1].split(',');
        if (p.length < 38) return null;
        return {
          name: p[37] || '',
          open: parseFloat(p[0]) || 0,
          settlement: parseFloat(p[1]) || 0,   // 最新价（结算价）
          high: parseFloat(p[3]) || 0,
          low: parseFloat(p[2]) || 0,
          volume: parseInt(p[4]) || 0,
          amount: parseFloat(p[5]) || 0,
          openInterest: parseInt(p[6]) || 0,
          prevSettlement: parseFloat(p[7]) || 0
        };
      };
      const futLines = sinaFutures.value.split(';').filter(l => l.includes('hq_str_'));
      for (const line of futLines) {
        const d = parseFuture(line);
        if (!d) continue;
        let spotKey = null;
        let futKey = null;
        if (d.name.includes('中证1000')) { spotKey = 'ZZ1000'; futKey = 'IM'; }
        else if (d.name.includes('沪深300')) { spotKey = 'HS300'; futKey = 'IF'; }
        else if (d.name.includes('中证500')) { spotKey = 'ZZ500'; futKey = 'IC'; }
        if (!spotKey || !futKey) continue;

        const spot = result.indices_spot[spotKey];
        const basis = spot ? (d.settlement - spot.current) : null;
        const basisPct = spot && spot.current > 0 ? ((basis / spot.current) * 100) : null;

        result.derivatives[futKey] = {
          name: d.name,
          settlement: d.settlement,
          spotClose: spot?.current || null,
          basis,
          basisPct: basisPct !== null ? basisPct.toFixed(2) + '%' : null,
          volume: d.volume,
          openInterest: d.openInterest
        };
      }
    }

    // ── 4. 综合信号 — 纯机器旗标，系统提示做F3熔断匹配（涨跌家数由大盘雷达注入，此处不判定）──
    const warnings = [];

    // 4a. 流动性极端判定
    const onLevel = result.liquidity.ON_level || '';
    const d7Level = result.liquidity.DR007_proxy_level || '';
    if (onLevel.includes('收紧') || d7Level.includes('收紧')) {
      warnings.push('资金面紧缩');
    }

    // 4b. 期指基差极端判定
    const imBasis = result.derivatives.IM?.basisPct || null;
    const ifBasis = result.derivatives.IF?.basisPct || null;
    const icBasis = result.derivatives.IC?.basisPct || null;
    if (imBasis && parseFloat(imBasis) < -0.8) warnings.push('IM深度贴水');
    if (ifBasis && parseFloat(ifBasis) < -0.8) warnings.push('IF深度贴水');
    if (icBasis && parseFloat(icBasis) < -0.8) warnings.push('IC深度贴水');

    // 4c. 旗标输出
    const tight = onLevel.includes('收紧') || d7Level.includes('收紧');
    const loose = onLevel === '宽松' && d7Level === '宽松';
    if (warnings.length >= 2) {
      result.overall_signal = '🚨 fatal';
    } else if (warnings.length === 1) {
      result.overall_signal = '⚠️ warn';
    } else if (loose && !tight) {
      result.overall_signal = '✅ clear';
    } else {
      result.overall_signal = '⚪ neutral';
    }

    result.warnings = warnings;
    result.timestamp = new Date().toISOString();

    return result;
  }
};
