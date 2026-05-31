// AI 核心对话引擎：单基金分析、全盘组合体检、多轮聊天对话的主循环，含工具调用递归与流式响应处理
import { resolveProvider } from './providers';
import { fetchAdvancedMarketData } from './market-data';
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

// 推理强度配置映射
const buildReasoningConfig = (effort) => {
  if (effort === 'disabled') return {};
  if (effort === 'high') return { thinking: { type: "enabled" }, reasoning_effort: "high" };
  return { thinking: { type: "enabled" }, reasoning_effort: "max" }; // default/max
};

// 工具名称 → 用户友好状态提示
const TOOL_LABELS = {
  'get_realtime_fund_data': '正在获取基金净值…',
  'get_batch_fund_data': '正在批量获取基金数据…',
  'get_fund_history_data': '正在获取历史净值序列…',
  'get_fund_comparison': '正在执行多基金横向对比…',
  'get_financial_news': '正在获取最新财经快讯…',
  'google_macro_search': '正在搜索宏观政策资讯…',
  'tavily_news_search': '正在搜索相关新闻…',
  'exa_research': '正在检索深度研报…',
  'get_fund_holdings_penetration': '正在穿透底层持仓…',
  'get_fund_transaction_history': '正在查询交易流水…',
  'get_market_historical_intraday': '正在获取历史K线…',
  'generate_trend_chart': '正在生成走势图表…',
  'execute_javascript': '正在执行量化计算…',
  'update_ledger': '正在写入交易记录…',
  'manage_plan_todo': '正在更新交易计划…',
  'update_decision_memo': '正在更新战略备忘录…',
  'update_fof_dictionary': '正在更新FOF字典…',
  'get_index_valuation': '正在获取指数估值…',
  'get_cross_asset_data': '正在获取跨资产数据…',
  'get_bond_market_data': '正在获取债市深度数据…',
  'get_north_bound_flow': '正在获取北向资金流向…',
  'get_sector_ranking': '正在获取行业板块排名…',
  'get_macro_data': '正在获取宏观经济指标…',
};

// Token 估算工具（中文约1.8字符/token，用于开发调试和生产监控）
const estimateTokens = (body) => {
  let totalChars = 0;
  if (body.messages) {
    for (const msg of body.messages) {
      totalChars += (msg.content || '').length;
    }
  }
  if (body.tools) {
    totalChars += JSON.stringify(body.tools).length;
  }
  if (body.systemInstruction?.parts) {
    for (const p of body.systemInstruction.parts) {
      totalChars += (p.text || '').length;
    }
  }
  return Math.round(totalChars / 1.8);
};

// ============================================================================
// 1. 底层 HTTP 请求封装
// ============================================================================
const executeAIRequest = async (settings, provider, apiKey, modelName, prompt, targetTemp, targetTopP, apiBase = '') => {
  try {
    const temperature = targetTemp ?? settings.temperature ?? 0.1;
    const topP = targetTopP ?? settings.topP ?? 0.1;
    const maxTokens = settings.maxOutputTokens || 8192;

    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
      body = {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature, topP, maxOutputTokens: maxTokens },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
        ]
      };
    } else if (provider === 'openai') {
      url = apiBase.replace(/\/+$/, '') + '/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = {
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        top_p: topP,
        max_tokens: maxTokens
      };
    } else {
      url = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.siliconflow.cn/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = {
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        top_p: topP,
        max_tokens: maxTokens,
        ...((provider === 'deepseek' || provider === 'siliconflow') && buildReasoningConfig(settings.reasoningEffort))
      };
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await response.json();

    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices) throw new Error(data.message);

    // Token 估算日志
    const estTokens = estimateTokens(body);
    const reasoningLabel = (provider === 'deepseek' || provider === 'siliconflow') ? (settings.reasoningEffort || 'max') : 'n/a';
    console.log('%c📊 [Token 估算] ' + provider + ' | 推理: ' + reasoningLabel + ' | 预估输入: ≈' + estTokens + ' tokens | 模型: ' + modelName, 'color: #10b981; font-weight: bold;');

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
  const { provider, apiKey, targetModel, apiBase } = resolveProvider(settings);

  const marketEnv = await fetchAdvancedMarketData(settings);

  let searchContext = "";
  if (settings.tavilyApiKey) {
    const isBondFund = (fund?.name || '').includes('债');
    const marketFocus = isBondFund ? "中国债券市场 央行公开市场操作 市场利率走势" : "A股走势 宏观经济";
    const query = `今日 ${marketFocus} ${fund?.name || ''} 最新新闻 利空 利好`;
    const searchRes = await fetchTavilySearch(settings.tavilyApiKey, query, 'news', settings, 'd1', settings.searchResultCount);
    if (searchRes) {
      searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n${searchRes}\n`;
    }
  }

  const prompt = buildFundAnalysisPrompt(fund, profile, settings, marketEnv, searchContext);

  return await executeAIRequest(settings, provider, apiKey, targetModel, prompt, undefined, undefined, apiBase);
};
export const analyzePortfolioWithAI = async (settings, portfolioStats, marketData) => {
  const { provider, apiKey, targetModel, apiBase } = resolveProvider(settings);

  const marketEnv = marketData && marketData.length > 0
    ? `\n【今日实时大盘与基准行情】\n${marketData.map(m => `- ${m.name}: ${m.price} (${m.change > 0 ? '+' : ''}${(m.percent * 100).toFixed(2)}%)`).join('\n')}`
    : '\n【今日实时大盘与基准行情】\n大盘数据未获取。';

  let searchContext = "";
  if (settings.tavilyApiKey) {
    const query = `当前中国央行货币政策 债券市场走势 A股大盘走势 美联储降息预期 宏观经济`;
    const searchRes = await fetchTavilySearch(settings.tavilyApiKey, query, 'news', settings, 'd1', settings.searchResultCount);
    if (searchRes) {
      searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n${searchRes}\n`;
    }
  }

  const prompt = buildPortfolioAnalysisPrompt(portfolioStats, settings, marketEnv, searchContext);

  return await executeAIRequest(settings, provider, apiKey, targetModel, prompt, undefined, undefined, apiBase);
};

// ============================================================================
// 3. 持续交互对话引擎 (聊天框专用) — 核心重构
// ============================================================================
export const chatWithPortfolioAI = async (settings, portfolioStats, chatHistory, newMessage, marketData, useWebSearch = true, todos = [], memos = [], onStatus = null) => {
  const { provider, apiKey, targetModel, apiBase } = resolveProvider(settings);

  const idleFunds = Number(settings.idleFunds) || 0;

  // === 组装持仓明细 ===
  const activeFundsDetail = portfolioStats.computedFundsWithMetrics
    .filter(f => f.currentValue > 0 && !f.isArchived)
    .map(f => {
      const profitRate = f.totalInvested > 0 ? ((f.profit / f.totalInvested) * 100).toFixed(2) : 0;
      const xirrRate = (f.xirr * 100).toFixed(2);

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
> 简单盈亏率: ${profitRate}% | 年化收益率(XIRR): ${xirrRate}% | 持有份额: ${f.shares || 0}${penaltyWarning}`;
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
  let radarOverride = "";
  if (marketData === "FETCH_NOW") {
    marketStr = await fetchAdvancedMarketData(settings);
    radarOverride = `🚨 【状态变更】大盘雷达已开启！此前的"纯净模式"指令已作废。你必须基于下方注入的实时盘口数据进行全面的大盘分析与多因子打分。\n\n`;
  } else {
    marketStr = marketData;
  }

  // === 构建 system prompt（纯静态层，利用 DeepSeek 上下文缓存） ===
  const systemPrompt = buildChatSystemPrompt(provider);

  // === 构建最新状态注入（通过 prompts.js 统一模板构建） ===
  const latestStateWrapper = buildLatestStateWrapper(radarOverride + marketStr, memosText, portfolioStats, settings, activeFundsDetail, todosContext, newMessage);

  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    // 历史消息窗口
    const MAX_HISTORY_MESSAGES = settings.maxHistoryMessages || 20;
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

      // 转换 OpenAI 工具格式为 Gemini functionDeclarations（并清洗不兼容字段）
      const openaiTools = defineTools(settings);
      const sanitizeSchema = (node) => {
        if (!node || typeof node !== 'object') return node;
        if (Array.isArray(node)) return node.map(sanitizeSchema);
        const out = {};
        for (const key of Object.keys(node)) {
          if (key === 'additionalProperties') continue;       // Gemini 不支持
          if (key === 'enum' && Array.isArray(node.enum) && node.enum.some(v => typeof v === 'number')) {
            out[key] = node.enum.map(String);                 // Gemini 要求 enum 值为字符串
          } else if (key === 'properties' || key === 'items') {
            out[key] = sanitizeSchema(node[key]);
          } else {
            out[key] = node[key];
          }
        }
        return out;
      };
      const geminiDeclarations = openaiTools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: sanitizeSchema(t.function.parameters)
      }));

      body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: geminiMessages,
        tools: geminiDeclarations.length > 0
          ? [{ functionDeclarations: geminiDeclarations }]
          : (useWebSearch ? [{ googleSearch: {} }] : []),
        ...(geminiDeclarations.length > 0 ? { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
        generationConfig: { temperature: settings.temperature ?? 0.1, topP: settings.topP ?? 0.1, maxOutputTokens: settings.maxOutputTokens || 8192 },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
        ]
      };
    } else if (provider === 'openai') {
      url = (apiBase || '').replace(/\/+$/, '') + '/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;

      const openaiMessages = [
        { role: 'system', content: systemPrompt },
        ...cleanHistory.map(msg => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: latestStateWrapper }
      ];

      body = {
        model: targetModel,
        messages: openaiMessages,
        temperature: settings.temperature ?? 0.1,
        top_p: settings.topP ?? 0.1,
        max_tokens: settings.maxOutputTokens || 8192,
        tools: defineTools(settings)
      };
    } else {
      url = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.siliconflow.cn/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;

      const openaiMessages = [
        { role: 'system', content: systemPrompt + `\n\n12. 【数据洁癖与交叉验证】：当你调用搜索工具获取基金净值或排名时，必须严格审视返回结果的【时间戳】！如果搜索返回的是过时数据，你必须回答"无法获取可靠的最新数据"，或者换个更精确的关键词再搜一次！` },
        ...cleanHistory.map(msg => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: latestStateWrapper }
      ];

      body = {
        model: targetModel,
        messages: openaiMessages,
        temperature: settings.temperature ?? 0.1,
        top_p: settings.topP ?? 0.1,
        max_tokens: settings.maxOutputTokens || 8192,
        tools: defineTools(settings),
        ...((provider === 'deepseek' || provider === 'siliconflow') && buildReasoningConfig(settings.reasoningEffort))
      };
    }

    // 状态通知：开始思考
    onStatus && onStatus({ type: 'thinking', label: '正在深度思考…' });

    let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    let data = await response.json();

    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices) throw new Error(data.message);

    // Token 估算日志
    const estTokens = estimateTokens(body);
    const reasoningLabel = (provider === 'deepseek' || provider === 'siliconflow') ? (settings.reasoningEffort || 'max') : 'n/a';
    console.log('%c📊 [Token 估算] ' + provider + ' | 推理: ' + reasoningLabel + ' | 预估输入: ≈' + estTokens + ' tokens | 模型: ' + targetModel, 'color: #10b981; font-weight: bold;');

    let accumulatedReasoning = '';
    let accumulatedContent = '';
    let maxLoops = settings.maxToolLoops || 12;
    let pendingActions = [];
    let roundNum = 0;

    // === 工具调用循环（策略模式分派） ===
    while (provider !== 'gemini' && data.choices && data.choices[0].message.tool_calls && maxLoops > 0) {
      maxLoops--;
      roundNum++;
      const responseMsg = data.choices[0].message;

      if (responseMsg.reasoning_content) {
        accumulatedReasoning += responseMsg.reasoning_content + '\n\n';
      }

      if (responseMsg.content) {
        accumulatedContent += responseMsg.content + '\n\n';
      }

      body.messages.push(responseMsg);

      // 策略模式分派每个工具调用
      for (const toolCall of responseMsg.tool_calls) {
        const toolName = toolCall.function.name;
        const label = TOOL_LABELS[toolName] || '正在调用 ' + toolName + '…';
        const roundTag = responseMsg.tool_calls.length > 1 ? ' (' + (responseMsg.tool_calls.indexOf(toolCall) + 1) + '/' + responseMsg.tool_calls.length + ')' : '';
        onStatus && onStatus({ type: 'tool', label: label + roundTag, tool: toolName, round: roundNum });

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
          portfolioStats,
          fullDateTimeStr: fullDateTimeStr(),
          todayStr: new Date().toISOString().split('T')[0]
        };

        await dispatchToolCall(toolName, ctx);
      }

      // 状态通知：进入下一轮
      if (maxLoops > 0) {
        onStatus && onStatus({ type: 'thinking', label: '正在综合分析第 ' + (roundNum + 1) + ' 轮结果…', round: roundNum + 1 });
      }

      response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      data = await response.json();

      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      if (data.message && !data.choices) throw new Error(data.message);
    }

    // === Gemini 工具调用循环（functionCall / functionResponse 协议） ===
    if (provider === 'gemini') {
      let geminiAccumulatedContent = '';
      let geminiMaxLoops = settings.maxToolLoops || 12;
      let geminiRoundNum = 0;
      body.messages = [];

      while (geminiMaxLoops > 0) {
        geminiMaxLoops--;
        geminiRoundNum++;

        if (!data.candidates || data.candidates.length === 0) {
          if (data.promptFeedback?.blockReason) {
            throw new Error(`内容被 Google 安全策略拦截 (${data.promptFeedback.blockReason})`);
          }
          if (geminiAccumulatedContent) return geminiAccumulatedContent;
          throw new Error("Google API 未返回有效文本");
        }

        const parts = data.candidates[0].content?.parts || [];
        const functionCalls = parts.filter(p => p.functionCall);

        if (functionCalls.length === 0) break;

        // 收集本轮文本
        const textParts = parts.filter(p => p.text);
        if (textParts.length > 0) {
          geminiAccumulatedContent += textParts.map(p => p.text).join('\n') + '\n\n';
        }

        // 添加 model 消息（含 functionCall parts）
        body.contents.push({ role: 'model', parts });

        // 执行每项工具调用
        const functionResponseParts = [];
        for (const part of functionCalls) {
          const fc = part.functionCall;
          const toolName = fc.name;
          const toolArgs = fc.args || {};

          const label = TOOL_LABELS[toolName] || '正在调用 ' + toolName + '…';
          onStatus && onStatus({ type: 'tool', label, tool: toolName, round: geminiRoundNum });

          const fakeToolCall = {
            id: `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            function: { name: toolName, arguments: JSON.stringify(toolArgs) }
          };

          const prevLen = body.messages.length;
          const ctx = {
            args: toolArgs,
            toolCall: fakeToolCall,
            settings,
            body,
            pendingActions,
            portfolioStats,
            fullDateTimeStr: fullDateTimeStr(),
            todayStr: new Date().toISOString().split('T')[0]
          };

          await dispatchToolCall(toolName, ctx);

          const newResults = body.messages.splice(prevLen);
          const resultContent = newResults.map(m => m.content).join('\n\n');

          functionResponseParts.push({
            functionResponse: {
              name: toolName,
              response: { result: resultContent }
            }
          });
        }

        // 添加 user 消息（含 functionResponse parts）
        if (functionResponseParts.length > 0) {
          body.contents.push({ role: 'user', parts: functionResponseParts });
          body.messages = [];
        }

        // 下一轮思考状态
        if (geminiMaxLoops > 0) {
          onStatus && onStatus({ type: 'thinking', label: '正在综合分析第 ' + (geminiRoundNum + 1) + ' 轮结果…', round: geminiRoundNum + 1 });
        }

        delete body.messages;
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        body.messages = [];
        data = await response.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      }

      // 提取最终文本响应
      if (!data.candidates || data.candidates.length === 0) {
        if (geminiAccumulatedContent) return geminiAccumulatedContent;
        throw new Error("Google API 未返回有效文本");
      }
      const finalParts = data.candidates[0].content?.parts || [];
      const finalText = finalParts.filter(p => p.text).map(p => p.text).join('\n');

      if (!finalText && geminiAccumulatedContent) return geminiAccumulatedContent;

      const geminiResult = finalText || geminiAccumulatedContent;
      if (pendingActions.length > 0) {
        return { type: 'ACTION_REQUIRED', payload: pendingActions, text: geminiResult };
      }
      return geminiResult;
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
          const configuredMax = settings.maxToolLoops || 12;
          finalContent = `⚠️ 警报：AI 已经连续进行了 ${configuredMax} 轮地毯式深度检索，触及了系统最大允许的安全运算深度，进程已被强制中断。`;
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
