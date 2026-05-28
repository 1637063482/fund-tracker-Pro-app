// 核心逻辑：单基诊断、全盘体检、聊天对话引擎
import { resolveProvider } from './providers';
import { buildProxyUrl } from './proxy';
import { formatCashFlows, fetchAdvancedMarketData } from './market-data';
import { fetchTavilySearch } from './search-engines';
import { calculate7DayPenalty } from './fifo';
import { defineTools } from './tools-definitions';
import { dispatchToolCall } from './tool-handlers';
import {
  buildChatSystemPrompt,
  buildFundAnalysisPrompt,
  buildPortfolioAnalysisPrompt,
  buildLatestStateWrapper,
  fullDateTimeStr
} from './prompts';

// ============================================================================
// 1. 底层 HTTP 请求封装
// ============================================================================
const executeAIRequest = async (provider, apiKey, modelName, prompt, targetTemp = 0.1, targetTopP = 0.1) => {
  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      body = {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: targetTemp, topP: targetTopP, maxOutputTokens: 8192 },
        safetySettings: [
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
        messages: [{ role: 'user', content: prompt }],
        temperature: targetTemp,
        top_p: targetTopP,
        max_tokens: 8192,
        ...(provider === 'deepseek' && { thinking: { type: "enabled" }, reasoning_effort: "max" })
      };
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await response.json();

    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices) throw new Error(data.message);

    if (provider === 'gemini') {
      if (!data.candidates || data.candidates.length === 0) {
        if (data.promptFeedback?.blockReason) {
          throw new Error(`内容被 Google 安全策略拦截 (${data.promptFeedback.blockReason})`);
        }
        throw new Error("Google API 未返回有效文本");
      }
      const parts = data.candidates[0].content?.parts;
      if (!parts || parts.length === 0 || !parts[0].text) {
        throw new Error("Google API 返回了非标准文本数据");
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

// ============================================================================
// 2. 单基诊断引擎
// ============================================================================
export const analyzeFundWithAI = async (settings, fund, profile, marketData) => {
  const { provider, apiKey, targetModel } = resolveProvider(settings);

  const marketEnv = await fetchAdvancedMarketData(settings);
  const derived = profile.fund_derived || {};
  const baseData = profile.sec_header_base_data || [];
  const maxDrawdown = baseData.find(d => d.data_name === '最大回撤')?.data_value_str || '未知';
  const rank1y = derived.srank_l1y || '未知';
  const rank3y = derived.srank_l3y || '未知';
  const yieldHistory = derived.yield_history || [];
  const yieldStr = yieldHistory.map(y => `${y.name}:${y.yield}%`).join(', ');
  const netInvested = fund?.netInvested || 0;
  const currentValue = fund?.currentValue || 0;
  const profit = fund?.profit || 0;
  const profitRate = fund?.totalInvested > 0 ? ((profit / fund.totalInvested) * 100).toFixed(2) : 0;
  const idleFunds = Number(settings.idleFunds) || 0;

  // 联网检索
  let searchContext = "";
  if (provider !== 'gemini' && settings.tavilyApiKey) {
    const isBondFund = (fund?.name || '').includes('债');
    const marketFocus = isBondFund ? "中国债券市场 央行公开市场操作 市场利率走势" : "A股走势 宏观经济";
    const query = `今日 ${marketFocus} ${fund?.name || ''} 最新新闻 利空 利好`;
    const searchRes = await fetchTavilySearch(settings.tavilyApiKey, query);
    if (searchRes) {
      searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n${searchRes}\n`;
    }
  }

  const prompt = `
你是一位拥有30年经验的华尔街顶尖宏观策略与量化分析师，以"客观、犀利、直击痛点"著称。

【分析前置要求 (极其重要)】
0. 绝对信任数据：下方提供的所有数据均为绝对真实的客观事实（Ground Truth），禁止质疑其真实性！
1. 现在的真实物理时间是 ${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}。
2. 请直接读取下方数据作为当前市场基准，绝对不允许凭记忆瞎编点位！${marketEnv}
3. 宏观资产温度与历史纵深：结合 A股、美股、黄金、中美国债收益率等核心资产【近3个月、近半年、近1年】的中长线走势趋势，评估当前处于反弹初期、主升浪还是下跌通道。
4. 标的雷达：这只基金（${fund?.name}）近期是否有重要新闻，或其所属核心板块近期的政策/行业利好利空。
5. 【带风控框架的独立裁判】：在评价我的买卖行为时，你拥有绝对的独立批判权。如果你发现我属于典型的"火场捡钢镚"，请用最冷酷的数据戳穿我的幻觉，并建议纠正。
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
${formatCashFlows(fund?.transactions)}

【你的输出任务】
使用 Markdown 输出以下几部分（500字左右）：
### 🌍 宏观与标的实时扫描
### 🕵️ 账户行为诊断
### 💡 极简操作建议
### 🕵️ 操作复盘与现状诊断
### 🎯 当前标的执行指令
### 💰 【${idleFunds}元】空闲资金利用建议
`;

  return await executeAIRequest(provider, apiKey, targetModel, prompt, 0.2, 0.2);
};

// ============================================================================
// 3. 全盘体检引擎
// ============================================================================
export const analyzePortfolioWithAI = async (settings, portfolioStats, marketData) => {
  const { provider, apiKey, targetModel } = resolveProvider(settings);

  const activeFunds = portfolioStats.computedFundsWithMetrics
    .filter(f => f.currentValue > 0 && !f.isArchived)
    .map(f => {
      const profitRate = f.totalInvested > 0 ? ((f.profit / f.totalInvested) * 100).toFixed(2) : 0;
      const cashFlows = formatCashFlows(f.transactions);
      return `\n- 资产：${f.name} (代码: ${f.fundCode || '未知'})\n  当前市值: ${f.currentValue}元 | 累计盈亏率: ${profitRate}% | 资产类型: ${f.name.includes('债') ? '固收' : '权益/其他'}\n  操作流水:\n  ${cashFlows.split('\n').join('\n  ')}`;
    }).join('\n');

  const marketEnv = marketData && marketData.length > 0
    ? `\n【今日实时大盘与基准行情】\n${marketData.map(m => `- ${m.name}: ${m.price} (${m.change > 0 ? '+' : ''}${(m.percent * 100).toFixed(2)}%)`).join('\n')}`
    : '\n【今日实时大盘与基准行情】\n大盘数据未获取。';

  let searchContext = "";
  if (provider !== 'gemini' && settings.tavilyApiKey) {
    const query = `当前中国央行货币政策 债券市场走势 A股大盘走势 美联储降息预期 宏观经济`;
    const searchRes = await fetchTavilySearch(settings.tavilyApiKey, query);
    if (searchRes) {
      searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n${searchRes}\n`;
    }
  }

  const idleFunds = Number(settings.idleFunds) || 0;
  const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

  const prompt = `
你是一位面向高净值客户的首席资产配置官(CIO)。请对我的整体基金投资组合进行"上帝视角"的宏观诊断。

【分析前置要求 (极其重要)】
0. 绝对信任数据：下方提供的全盘资产快照、大盘行情等数据，均为绝对真实的客观事实（Ground Truth），禁止质疑！
1. 现在的真实物理时间是 ${todayStr}。
2. 请直接读取下方数据作为当前市场基准，绝对不允许自己瞎编点位！${marketEnv}
3. 梳理全球核心资产（中美股市、大宗商品、债券利率）在【近3个月、近半年、近1年】的大周期趋势。
4. 结合美联储最新降息/加息预期、中美股市的核心矛盾等宏观指标。
5. 【无情鞭挞与客观诊断】：请作为独立客观的第三方进行评估！仔细阅读我的【操作流水】，不要因为我近期有大额加仓操作，就当老好人建议"继续观察"。
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
使用 Markdown 格式输出以下三部分（500字左右）：
### 🔍 组合致命隐患与优势
### 🗑️ 存量资产清洗指令
### 🎯 【${idleFunds}元】空闲子弹精准打出方案
`;

  return await executeAIRequest(provider, apiKey, targetModel, prompt, 0.4, 0.5);
};

// ============================================================================
// 4. 持续交互对话引擎 (聊天框专用) — 核心重构
// ============================================================================
export const chatWithPortfolioAI = async (settings, portfolioStats, chatHistory, newMessage, marketData, useWebSearch = true, todos = [], memos = []) => {
  const { provider, apiKey, targetModel } = resolveProvider(settings);

  const idleFunds = Number(settings.idleFunds) || 0;

  // === 组装持仓明细 ===
  const activeFundsDetail = portfolioStats.computedFundsWithMetrics
    .filter(f => f.currentValue > 0 && !f.isArchived)
    .map(f => {
      const profitRate = f.totalInvested > 0 ? ((f.profit / f.totalInvested) * 100).toFixed(2) : 0;
      const xirrRate = (f.xirr * 100).toFixed(2);
      const cashFlows = formatCashFlows(f.transactions);

      let fundTypeTag = "其他类型/混合";
      const name = f.name || '';
      if (name.includes('短债') || name.includes('理财') || name.includes('货币')) fundTypeTag = "中短债/货币 (防守底仓)";
      else if (name.includes('债') || name.includes('定期开放')) fundTypeTag = "长债/纯债 (收益底仓)";
      else if (name.includes('混合') || name.includes('固收+') || name.includes('平衡')) fundTypeTag = "固收+ / 混合 (弹性增强)";
      else if (name.includes('红利') || name.includes('低波')) fundTypeTag = "红利策略 (权益保护)";
      else if (name.includes('指数') || name.includes('联接') || name.includes('ETF')) fundTypeTag = "被动宽基/行业 (高弹性)";

      const sortedTx = [...(f.transactions || [])].sort((a, b) => new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt));
      const todayIso = new Date().toISOString().split('T')[0];
      const { lockedAmount, penaltyFee } = calculate7DayPenalty(sortedTx, todayIso);

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

  // === 组装待办上下文 ===
  const pendingTodos = todos.filter(t => !t.isCompleted);
  const completedTodos = todos.filter(t => t.isCompleted).slice(-5);
  const displayTodos = [...pendingTodos, ...completedTodos];

  let todosContext = "暂无任何计划。";
  if (displayTodos.length > 0) {
    todosContext = displayTodos.map(t => {
      const statusLabel = t.isCompleted ? '✅ 已完成 (历史记录，不可修改)' : '⏳ 待执行/排队中 (可操作)';
      const pLabel = t.priority === 'high' ? '高(紧急)' : t.priority === 'low' ? '低(远端)' : '中(常规)';
      if (t.type === 'ai_plan') {
        return `- [待办ID: ${t.id}] [状态: ${statusLabel}] [优先级: ${pLabel}] AI计划 | 标的: ${t.fundName}(${t.fundCode}) | 方向: ${t.actionType === 'buy' ? '买入' : t.actionType === 'sell' ? '卖出' : '观察'} | 触发条件: ${t.condition} | 预备金额: ${t.amount || '未定'}元`;
      }
      return `- [待办ID: ${t.id}] [状态: ${statusLabel}] [优先级: ${pLabel}] 用户手动记录 | 内容: ${t.text}`;
    }).join('\n');
  }

  // === 组装备忘录三层结构 ===
  const constitutionMemo = memos.find(m => m.target === 'GLOBAL_CONSTITUTION');
  const marketMemo = memos.find(m => m.target === 'GLOBAL_MARKET');
  const fundMemos = memos.filter(m => m.target !== 'GLOBAL_CONSTITUTION' && m.target !== 'GLOBAL_MARKET');

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

  // === 获取大盘数据 ===
  let marketStr = "";
  if (marketData === "FETCH_NOW") {
    marketStr = await fetchAdvancedMarketData(settings);
  } else {
    marketStr = marketData;
  }

  // === 构建 system prompt ===
  const systemPrompt = buildChatSystemPrompt(provider, settings, portfolioStats);

  // === 构建最新状态注入 ===
  const latestStateWrapper = `
====================================================
🚨 [最高优先级指令：系统底层强制注入最新状态] 🚨
====================================================
⚠️ 致命纪律：请立即忽略上方历史对话中的旧盘口与旧资产记忆！你必须且只能基于以下【最新客观事实】进行本次分析与决策！现在的真实物理时间是：${fullDateTimeStr()}。

${marketStr}
${memosText}
🚨 【逻辑一致性强制防线】：在给出建议前必须优先审视上述备忘录。除非今天的盘口发生了极其重大且根本性的反转，否则绝对禁止推翻你自己的定调！

【当前全盘与子弹快照】
全盘总市值：${portfolioStats.totalCurrentValue} 元 | 累计总盈亏：${portfolioStats.totalProfit} 元
综合年化(XIRR)：${(portfolioStats.overallXirr * 100).toFixed(2)}% | 预备空闲子弹：${idleFunds} 元

【当前真实持仓明细】
${activeFundsDetail}

【当前交易计划池 (包含排队中与近期已执行)】
${todosContext}

🚨 【防重防漏与资金风控纪律】：
1. 拦截重复建仓，但允许网格交易。
2. 流动性压测与子弹预扣：评估空闲资金时，必须在脑海中【先扣除】待办列表中所有独立消耗现金的"计划买入"金额！
3. 隐性摩擦成本绝对防线：上方持仓明细中带有"🚨 [系统底层强制风控拦截]"警告的资产，【绝对禁止】下达立刻卖出或转换指令！
4. 交易日历核对防线：在设定任何未来的交易日期时，请基于当前的物理日期推算，周末及法定节假日不交易，赎回资金 T+2 至 T+4 到账。
====================================================
【用户最新指令】
${newMessage}

👉(系统级注入器警报：如果你判定需要修改备忘录、增删改待办、画图或记账，请务必直接触发对应的 Tool Call 接口！)
`;

  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    // 历史消息窗口
    const MAX_HISTORY_MESSAGES = 20;
    const recentHistory = chatHistory.slice(-MAX_HISTORY_MESSAGES);

    // 清洗历史中的 HTML 思考标签
    const cleanHistory = recentHistory.map(msg => {
      let content = msg.content;
      if (msg.role === 'assistant') {
        content = content.replace(/### 🧠 AI 深度多轮思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/, '');
        content = content.replace(/### 🧠 AI 深度思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/, '');
      }
      return { role: msg.role, content };
    });

    if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
      const geminiMessages = cleanHistory.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));
      geminiMessages.push({ role: 'user', parts: [{ text: latestStateWrapper }] });

      body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: geminiMessages,
        tools: useWebSearch ? [{ googleSearch: {} }] : [],
        generationConfig: { temperature: 0.1, topP: 0.1, maxOutputTokens: 8192 },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      };
    } else {
      url = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.siliconflow.cn/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;

      const isReasoner = targetModel.toLowerCase().includes('reasoner') || targetModel.toLowerCase().includes('r1');

      const openaiMessages = [
        { role: 'system', content: systemPrompt + `\n\n12. 【数据洁癖与交叉验证】：当你调用搜索工具获取基金净值或排名时，必须严格审视返回结果的【时间戳】！如果搜索返回的是过时数据，你必须回答"无法获取可靠的最新数据"，或者换个更精确的关键词再搜一次！` },
        ...cleanHistory.map(msg => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: latestStateWrapper }
      ];

      body = {
        model: targetModel,
        messages: openaiMessages,
        temperature: 0.1,
        top_p: 0.1,
        max_tokens: 8192,
        ...(provider === 'deepseek' && { thinking: { type: "enabled" }, reasoning_effort: "max" })
      };

      // 加载工具定义
      body.tools = [];

      if (useWebSearch && !isReasoner) {
        if (useWebSearch && !isReasoner) {
          const allTools = defineTools(settings);
          body.tools.push(...allTools);
        }

        // 剥离 tools 防止 400 报错
        if (isReasoner || body.tools.length === 0) {
          delete body.tools;
        }
      }
    }

    let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    let data = await response.json();

    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices) throw new Error(data.message);

    let accumulatedReasoning = '';
    let accumulatedContent = '';
    let maxLoops = 12;
    let pendingActions = [];

    // === 工具调用循环（策略模式分派） ===
    while (provider !== 'gemini' && data.choices && data.choices[0].message.tool_calls && maxLoops > 0) {
      maxLoops--;
      const responseMsg = data.choices[0].message;

      if (responseMsg.reasoning_content) {
        console.log(`%c🧠 [AI 大脑神经元活动] 第 ${12 - maxLoops} 轮思考:`, `color: #f59e0b; font-size: 13px; font-weight: bold; background: #fffbeb; padding: 2px 6px; border-radius: 4px;`);
        console.log(`%c${responseMsg.reasoning_content}`, `color: #64748b; font-style: italic; border-left: 3px solid #f59e0b; padding-left: 10px; margin-bottom: 10px;`);
        accumulatedReasoning += responseMsg.reasoning_content + '\n\n';
      }

      if (responseMsg.content) {
        accumulatedContent += responseMsg.content + '\n\n';
      }

      body.messages.push(responseMsg);

      // 策略模式分派每个工具调用
      for (const toolCall of responseMsg.tool_calls) {
        const toolName = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch (e) {
          args = {};
        }

        const ctx = {
          args,
          toolCall,
          settings,
          body,
          pendingActions,
          fullDateTimeStr: fullDateTimeStr(),
          todayStr: new Date().toISOString().split('T')[0]
        };

        await dispatchToolCall(toolName, ctx);
      }

      response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      data = await response.json();

      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      if (data.message && !data.choices) throw new Error(data.message);
    }

    // === 最终组装返回 ===
    if (provider === 'gemini') {
      if (!data.candidates || data.candidates.length === 0) {
        throw new Error("Google API 未返回有效文本");
      }
      const parts = data.candidates[0].content?.parts;
      if (!parts || parts.length === 0 || !parts[0].text) {
        throw new Error("Google API 返回了非标准文本数据");
      }
      return parts[0].text;
    } else {
      const msg = data.choices[0].message;
      let finalContent = accumulatedContent + (msg.content || '');

      const thinkMatch = finalContent.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        accumulatedReasoning += thinkMatch[1] + '\n\n';
        finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
      }

      if (msg.reasoning_content) {
        accumulatedReasoning += msg.reasoning_content;
      }

      let thinkingBoxClass = "text-slate-400 dark:text-slate-500 text-xs opacity-90 border-l-4 border-slate-300 dark:border-slate-600 pl-3 py-2 mb-4 bg-slate-50 dark:bg-slate-900/50 max-h-[300px] overflow-y-auto custom-scrollbar rounded-r-lg";

      if (!finalContent) {
        if (msg.tool_calls) {
          finalContent = "⚠️ 警报：AI 已经连续进行了 12 轮地毯式深度检索，触及了系统最大允许的安全运算深度，进程已被强制中断。";
        } else if (accumulatedReasoning) {
          finalContent = "*(系统提示：AI 思考过程过长导致正文被截断，请直接阅读上方的深度思考过程，或让 AI “精简总结一下”)*";
          thinkingBoxClass = thinkingBoxClass.replace("max-h-[300px] overflow-y-auto custom-scrollbar ", "");
        }
      }

      if (accumulatedReasoning) {
        const thinkProcess = accumulatedReasoning
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br/>');
        finalContent = `### 🧠 AI 深度多轮思考过程\n<div class="${thinkingBoxClass}">${thinkProcess}</div>\n\n` + finalContent;
      }

      if (pendingActions.length > 0) {
        return { type: 'ACTION_REQUIRED', payload: pendingActions, text: finalContent };
      }

      return finalContent;
    }
  } catch (error) {
    throw new Error(error.message === "Failed to fetch" ? "网络无法访问，请检查代理" : error.message);
  }
};
