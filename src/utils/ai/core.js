// AI 核心对话引擎：单基金分析、全盘组合体检、多轮聊天对话的主循环，含工具调用递归与流式响应处理
import { resolveProvider } from './providers';
import { fetchAdvancedMarketData } from './market-data';
import { fetchTavilySearch } from './search-engines';
import { precomputePortfolioInsights } from './precompute';
import { defineTools } from './tools-definitions';
import { dispatchToolCall } from './tool-handlers';
import {
  buildCoreSystemPrompt,
  buildSkillLibraryPrompt,
  buildScoringSystemPrompt,
  buildChatSystemPrompt,
  buildFundAnalysisPrompt,
  buildPortfolioAnalysisPrompt,
  buildLatestStateWrapper,
  fullDateTimeStr
} from './prompts';
import { analyzeIntent } from './intent-router';
import { buildReasoningConfig, TOOL_LABELS, estimateTokens, executeAIRequest } from './providers/shared';
import { debugLog } from '../debugLog';

// ============================================================================
// 1. 单基诊断引擎
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
export const chatWithPortfolioAI = async (settings, portfolioStats, chatHistory, newMessage, marketData, useWebSearch = true, todos = [], memos = [], onStatus = null, firestoreContext = null) => {
  const { provider, apiKey, targetModel, apiBase } = resolveProvider(settings);

  const idleFunds = Number(settings.idleFunds) || 0;

  // === 本地预计算：持仓洞察（赎回费陷阱、集中度、大类配置） ===
  const insights = precomputePortfolioInsights(portfolioStats, settings);

  // === 组装持仓明细（紧凑表格格式，替代原来的逐只文本段落） ===
  const activeFundsDetail = `基金        │代码    │   市值 │   盈亏率 │  XIRR │ 占比 │类型│陷阱
──────┼────┼─────┼───────┼─────┼────┼──┼──
${insights.portfolioTable}明细提示：如需某只基金的历史交易流水，请调用 get_fund_transaction_history 工具获取。`;

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
⚠️ 备忘录中的净值/价格数字为写入时的历史快照，仅作战略锚点参考（如"跌破1.5清仓"的1.5是纪律红线，非实时净值）。严禁将备忘录中的快照净值用于日收益计算、盈亏核算或任何需要当前净值的计算。凡涉净值计算，必须调用 get_realtime_fund_data / get_batch_fund_data / get_fund_history_data 工具。

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

  // === 构建 system prompt（纯静态层，利用 DeepSeek 上下文缓存，永不变化） ===
  const coreSystemPrompt = buildCoreSystemPrompt();

  // === 本地意图路由：分析用户消息，决定是否加载技能库（打分系统由雷达直接控制） ===
  const intent = analyzeIntent(newMessage, chatHistory);

  // === 打分系统加载策略：雷达 ON → 始终加载，雷达 OFF → 始终不加载 ===
  const radarEnabled = marketData === "FETCH_NOW";
  intent.needsScoring = radarEnabled;

  // === 📦 模块加载报告（Console 可视化） ===
  const CORE_TOKENS = 1400;
  const SKILL_TOKENS = 2000;
  const SCORING_TOKENS = 6300;
  const fullTokens = CORE_TOKENS + SKILL_TOKENS + SCORING_TOKENS;
  const loadedTokens = CORE_TOKENS
    + (intent.needsSkillLibrary ? SKILL_TOKENS : 0)
    + (intent.needsScoring ? SCORING_TOKENS : 0);
  const savedTokens = fullTokens - loadedTokens;
  const savedPct = Math.round((savedTokens / fullTokens) * 100);

  const lines = [
    { style: 'h',   text: '📦 模块加载报告' },
    { style: 'sep', text: '' },
    { style: 'g',   text: `Core (防幻觉+记忆+数据洁癖)       ✅  ~1,400 tok` },
    { style: intent.needsSkillLibrary ? 'g' : 'dim', text: `Skill Library (技能库+工具铁律)    ${intent.needsSkillLibrary ? '✅' : '⏭️'}  ${intent.needsSkillLibrary ? '~2,000 tok' : '    跳过 (Router判定)'}` },
    { style: radarEnabled ? 'g' : 'warn', text: `Scoring System (打分+CIO矩阵)      ${radarEnabled ? '✅  ~6,300 tok (雷达ON)' : '⏭️ 雷达关闭'}` },
    { style: 'sep', text: '' },
    { style: 'h2',  text: `System Prompt 合计: ~${loadedTokens.toLocaleString()} tokens  |  节省 ~${savedTokens.toLocaleString()} tokens (${savedPct}%)` },
    { style: confidenceColor(intent.confidence), text: `技能库置信度: ${intent.confidence.toUpperCase()}  |  雷达: ${radarEnabled ? '🟢 ON' : '🔴 OFF'}` },
    { style: 'dim2', text: `理由: ${intent.reason}` },
  ];

  // 简单表格样式输出，适配窄终端
  const W = 62;
  const boxTop    = '┌' + '─'.repeat(W) + '┐';
  const boxSep    = '├' + '─'.repeat(W) + '┤';
  const boxBottom = '└' + '─'.repeat(W) + '┘';
  const padLine = (text, w) => '│ ' + text + ' '.repeat(Math.max(0, w - 1 - text.length)) + '│';

  const styleMap = {
    'h':    'color: #c4b5fd; font-weight: bold;',
    'h2':   'color: #f59e0b; font-weight: bold;',
    'g':    'color: #10b981;',
    'dim':  'color: #6b7280;',
    'dim2': 'color: #94a3b8; font-style: italic;',
    'sep':  'color: #6366f1;',
    'warn': 'color: #f59e0b;',
    'red':  'color: #ef4444; font-weight: bold;',
  };

  debugLog(
    '%c' + boxTop + '\n' +
    lines.map((l, i) => '%c' + (l.style === 'sep' ? boxSep : padLine(l.text, W)) + '\n').join('') +
    '%c' + boxBottom,
    styleMap['sep'],
    ...lines.flatMap(l => [styleMap[l.style] || '']),
    styleMap['sep']
  );

  // === ⚠️ 低置信度独立警告 ===
  if (intent.confidence === 'low') {
    const msgPreview = newMessage.length > 40 ? newMessage.substring(0, 37) + '...' : newMessage;
    debugLog(
      '%c╔' + '═'.repeat(W) + '╗\n' +
      '%c║ ⚠️  LOW CONFIDENCE — 模块选择可能不准确' + ' '.repeat(Math.max(0, W - 33)) + '║\n' +
      '%c║ 消息: ' + msgPreview + ' '.repeat(Math.max(0, W - 9 - msgPreview.length)) + '║\n' +
      '%c║ 若分类有误 → 反馈至 intent-router.js 反哺规则' + ' '.repeat(Math.max(0, W - 35)) + '║\n' +
      '%c╚' + '═'.repeat(W) + '╝',
      'color: #ef4444; font-weight: bold;',
      'color: #fbbf24; font-weight: bold;',
      'color: #fca5a5;',
      'color: #fca5a5;',
      'color: #ef4444; font-weight: bold;'
    );
  }

  // 辅助函数
  function confidenceColor(c) {
    return c === 'high' ? 'g' : c === 'medium' ? 'warn' : 'red';
  }

  // === 构建最新状态注入（通过 prompts.js 统一模板构建，永远放在末尾 user message） ===
  // 预计算风控标记
  const alertsText = insights.alerts.length > 0
    ? `\n【系统预计算风控标记】\n${insights.alerts.map(a => a).join('\n')}\n`
    : '';

  const latestStateWrapper = buildLatestStateWrapper(radarOverride + marketStr, memosText, portfolioStats, settings, activeFundsDetail, todosContext, alertsText, newMessage);

  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    // === 历史降采样：今日保留最近 N 轮，跨日摘要，雷达指令去重 ===
    const todayStr = new Date().toDateString();
    const MAX_TODAY_ROUNDS = settings.maxHistoryMessages || 6;    // 今日最多保留的轮次数
    const MAX_OLDER_ROUNDS = Math.max(1, Math.floor(MAX_TODAY_ROUNDS / 3)); // 跨日最多保留轮次 = 今日的 1/3

    const downsampleHistory = (msgs) => {
      // 分离今日和跨日消息（消息已按时间排序）
      const todayMsgs = [];
      const olderMsgs = [];
      let i = 0;
      while (i < msgs.length) {
        const userMsg = msgs[i];
        const asstMsg = msgs[i + 1];
        const msgDate = userMsg?.timestamp ? new Date(userMsg.timestamp).toDateString() : null;
        if (msgDate === todayStr) {
          if (userMsg) todayMsgs.push(userMsg);
          if (asstMsg?.role === 'assistant') todayMsgs.push(asstMsg);
        } else {
          if (userMsg) olderMsgs.push(userMsg);
          if (asstMsg?.role === 'assistant') olderMsgs.push(asstMsg);
        }
        i += 2;
      }

      // 今日：截断到最近 MAX_TODAY_ROUNDS 轮
      const recentToday = todayMsgs.slice(-MAX_TODAY_ROUNDS * 2);

      // 跨日：仅保留最近 MAX_OLDER_ROUNDS 轮，提取 AI 摘要 + 保留用户消息
      const recentOlder = olderMsgs.slice(-MAX_OLDER_ROUNDS * 2);
      const olderCompressed = [];
      let j = 0;
      while (j < recentOlder.length) {
        const uMsg = recentOlder[j];
        const aMsg = recentOlder[j + 1];
        if (uMsg?.role === 'user') {
          // 从助理消息中提取 [本轮摘要] 行（AI 生成的压缩摘要）
          let aiSummary = '';
          if (aMsg?.role === 'assistant' && aMsg.content) {
            const m = aMsg.content.match(/\[本轮摘要\]\s*([\s\S]*?)(?:\n\n|$)/);
            if (m?.[1]?.trim()) aiSummary = ' | AI摘要: ' + m[1].trim();
          }
          olderCompressed.push({
            role: 'user',
            content: `[跨日 — ${uMsg.timestamp ? new Date(uMsg.timestamp).toDateString() : '?'}] ${uMsg.content || ''}${aiSummary}`
          });
        }
        j += 2;
      }

      // 合并：跨日摘要 + 今日最近 N 轮
      const merged = [...olderCompressed, ...recentToday];

      // 清洗：剥离历史消息中的雷达状态指令（最新雷达状态已在末尾注入）
      // 同时清洗助理消息中的 HTML 思考标签
      const RADAR_CLEAN_PATTERN = /(?:🚨\s*【状态变更】大盘雷达已开启[^\n]*\n*|【系统指令：用户已手动关闭大盘雷达[^】]*】)/g;
      return merged.map(msg => {
        let content = msg.content || '';
        if (msg.role === 'assistant') {
          content = content.replace(/### 🧠 AI 深度多轮思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/, '');
          content = content.replace(/### 🧠 AI 深度思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/, '');
        }
        // 历史中的雷达指令剥离（最新状态在 latestStateWrapper 末尾，具有绝对权威）
        if (content.includes('大盘雷达') || content.includes('纯净模式')) {
          content = content.replace(RADAR_CLEAN_PATTERN, '');
        }
        return { role: msg.role, content };
      });
    };

    const cleanHistory = downsampleHistory(chatHistory);

    // === 公共：按需构建静态 rulebook 消息（消除 3 套 provider 中的重复代码） ===
    const buildRulebookMessages = (format) => {
      const msgs = [];
      const isGemini = format === 'gemini';
      const mkMsg = (role, text) => isGemini
        ? { role, parts: [{ text }] }
        : { role: role === 'model' ? 'assistant' : role, content: text };

      if (intent.needsScoring) {
        msgs.push(mkMsg('user', '[系统加载] 双核打分与CIO战略矩阵规则手册'));
        msgs.push(mkMsg('model', '已加载打分规则手册，将在涉及市场时机判断时严格执行所有因子分析、动量修正、滞回锁定、CIO矩阵匹配和全局否决检查。'));
        msgs.push(mkMsg('user', buildScoringSystemPrompt()));
        msgs.push(mkMsg('model', '明白。所有打分规则已于本轮加载完毕，本轮回复将严格基于该规则体系执行。'));
      }
      if (intent.needsSkillLibrary) {
        msgs.push(mkMsg('user', '[系统加载] 高级工具技能库'));
        msgs.push(mkMsg('model', '已加载技能库，将按照跨工具调用铁律使用所有工具。'));
        msgs.push(mkMsg('user', buildSkillLibraryPrompt()));
        msgs.push(mkMsg('model', '明白。将严格遵守防海选、防死循环、防同质化、防口嗨、穿透链条等铁律。'));
      }
      return msgs;
    };

    if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

      const geminiPrefix = buildRulebookMessages('gemini');
      const geminiMessages = [
        ...geminiPrefix,
        ...cleanHistory.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        })),
        { role: 'user', parts: [{ text: latestStateWrapper }] }
      ];

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
        systemInstruction: { parts: [{ text: coreSystemPrompt }] },
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

      const rulebookPairs = buildRulebookMessages('openai');
      const openaiMessages = [
        { role: 'system', content: coreSystemPrompt },
        ...rulebookPairs,
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

      const rulebookPairs = buildRulebookMessages('openai');
      const openaiMessages = [
        { role: 'system', content: coreSystemPrompt },
        ...rulebookPairs,
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
    onStatus && onStatus({ type: 'thinking', label: '🧠 深度思考中…' });

    let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    let data = await response.json();

    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices) throw new Error(data.message);

    // Token 估算日志
    const estTokens = estimateTokens(body);
    const reasoningLabel = (provider === 'deepseek' || provider === 'siliconflow') ? (settings.reasoningEffort || 'max') : 'n/a';
    debugLog('%c📊 [Token 估算] ' + provider + ' | 推理: ' + reasoningLabel + ' | 预估输入: ≈' + estTokens + ' tokens | 模型: ' + targetModel, 'color: #10b981; font-weight: bold;');

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
        debugLog('%c🧠 [思考 R' + roundNum + '] ' + responseMsg.reasoning_content.substring(0, 200) + (responseMsg.reasoning_content.length > 200 ? '…' : ''), 'color: #a78bfa;');
      }

      if (responseMsg.content) {
        accumulatedContent += responseMsg.content + '\n\n';
        debugLog('%c💬 [文本 R' + roundNum + '] ' + responseMsg.content.substring(0, 150) + (responseMsg.content.length > 150 ? '…' : ''), 'color: #94a3b8;');
      }

      body.messages.push(responseMsg);

      // 策略模式分派每个工具调用
      for (const toolCall of responseMsg.tool_calls) {
        const toolName = toolCall.function.name;
        const label = TOOL_LABELS[toolName] || '⚙️ 调用 ' + toolName + '…';
        const roundTag = responseMsg.tool_calls.length > 1 ? ' (' + (responseMsg.tool_calls.indexOf(toolCall) + 1) + '/' + responseMsg.tool_calls.length + ')' : '';
        onStatus && onStatus({ type: 'tool', label: label + roundTag, tool: toolName, round: roundNum });

        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch (e) {
          args = {};
        }

        debugLog('%c🔧 [工具 R' + roundNum + '] ' + toolName + ' | ' + JSON.stringify(args).substring(0, 200), 'color: #60a5fa; font-weight: bold;');

        const ctx = {
          args,
          toolCall,
          settings,
          body,
          pendingActions,
          portfolioStats,
          firestoreContext,
          fullDateTimeStr: fullDateTimeStr(),
          todayStr: new Date().toISOString().split('T')[0]
        };

        await dispatchToolCall(toolName, ctx);
      }

      // 状态通知：进入下一轮
      if (maxLoops > 0) {
        onStatus && onStatus({ type: 'thinking', label: '🧠 综合研判 · 第 ' + (roundNum + 1) + ' 轮…', round: roundNum + 1 });
      }

      response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      data = await response.json();

      if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
      if (data.message && !data.choices) throw new Error(data.message);
    }

    // === Gemini 工具调用循环（functionCall / functionResponse 协议） ===
    // 使用独立的 toolMessages 变量承载工具结果，不再与 body.messages 混用
    if (provider === 'gemini') {
      let geminiAccumulatedContent = '';
      let geminiMaxLoops = settings.maxToolLoops || 12;
      let geminiRoundNum = 0;

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
          const geminiText = textParts.map(p => p.text).join('\n');
          geminiAccumulatedContent += geminiText + '\n\n';
          debugLog('%c💬 [Gemini R' + geminiRoundNum + '] ' + geminiText.substring(0, 150) + (geminiText.length > 150 ? '…' : ''), 'color: #94a3b8;');
        }

        // 添加 model 消息（含 functionCall parts）
        body.contents.push({ role: 'model', parts });

        // 执行每项工具调用 — 用独立 toolMessages 承载 handler 写入的结果
        const functionResponseParts = [];
        for (const part of functionCalls) {
          const fc = part.functionCall;
          const toolName = fc.name;
          const toolArgs = fc.args || {};

          const label = TOOL_LABELS[toolName] || '⚙️ 调用 ' + toolName + '…';
          onStatus && onStatus({ type: 'tool', label, tool: toolName, round: geminiRoundNum });
          debugLog('%c🔧 [Gemini R' + geminiRoundNum + '] ' + toolName + ' | ' + JSON.stringify(toolArgs).substring(0, 200), 'color: #60a5fa; font-weight: bold;');

          const fakeToolCall = {
            id: `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            function: { name: toolName, arguments: JSON.stringify(toolArgs) }
          };

          // 每轮新数组，handler 通过 ctx.body.messages push 结果
          const toolMessages = [];
          body.messages = toolMessages;

          const ctx = {
            args: toolArgs,
            toolCall: fakeToolCall,
            settings,
            body,
            pendingActions,
            portfolioStats,
            firestoreContext,
            fullDateTimeStr: fullDateTimeStr(),
            todayStr: new Date().toISOString().split('T')[0]
          };

          await dispatchToolCall(toolName, ctx);

          const resultContent = toolMessages.map(m => m.content).join('\n\n');

          functionResponseParts.push({
            functionResponse: {
              name: toolName,
              response: { result: resultContent }
            }
          });
        }

        // 清除 body.messages，避免被 JSON.stringify 发送给 Gemini
        delete body.messages;

        // 添加 user 消息（含 functionResponse parts）
        if (functionResponseParts.length > 0) {
          body.contents.push({ role: 'user', parts: functionResponseParts });
        }

        // 下一轮思考状态
        if (geminiMaxLoops > 0) {
          onStatus && onStatus({ type: 'thinking', label: '🧠 综合研判 · 第 ' + (geminiRoundNum + 1) + ' 轮…', round: geminiRoundNum + 1 });
        }

        // 发送请求（body 不含 messages 字段）
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
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

      debugLog('%c✅ [完成] 工具轮次: ' + roundNum + ' | 思考长度: ' + accumulatedReasoning.length + ' chars | 输出长度: ' + finalContent.length + ' chars | 待确认操作: ' + pendingActions.length, 'color: #10b981; font-weight: bold;');

      if (pendingActions.length > 0) {
        return { type: 'ACTION_REQUIRED', payload: pendingActions, text: finalContent };
      }

      return finalContent;
    }
  } catch (error) {
    throw new Error(error.message === "Failed to fetch" ? "网络无法访问，请检查代理" : error.message);
  }
};
