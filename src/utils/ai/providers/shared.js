// AI Provider 共享模块：Token 估算、推理强度配置、HTTP 请求封装、状态标签
// 被 core.js 和各 provider 模块共同引用
import { debugLog } from '../../debugLog';

// 推理强度配置映射
export const buildReasoningConfig = (effort) => {
  if (effort === 'disabled') return {};
  if (effort === 'high') return { thinking: { type: "enabled" }, reasoning_effort: "high" };
  return { thinking: { type: "enabled" }, reasoning_effort: "max" };
};

// 工具名称 → 用户友好状态提示
export const TOOL_LABELS = {
  'get_realtime_fund_data': '📊 读取实时净值…',
  'get_batch_fund_data': '📊 批量拉取基金数据…',
  'get_fund_history_data': '📈 回溯历史走势…',
  'get_fund_comparison': '⚖️ 多维度对比分析…',
  'get_financial_news': '📰 速览财经快讯…',
  'google_macro_search': '🌐 检索宏观政策…',
  'tavily_news_search': '🔍 搜索相关资讯…',
  'exa_research': '📚 研读深度研报…',
  'get_fund_holdings_penetration': '🔬 透视底层持仓…',
  'get_fund_transaction_history': '🧾 查阅交易流水…',
  'get_market_historical_intraday': '📉 加载 K 线数据…',
  'generate_trend_chart': '🎨 渲染走势图表…',
  'execute_javascript': '⚡ 执行量化演算…',
  'update_ledger': '📝 记录交易明细…',
  'manage_plan_todo': '✅ 同步交易计划…',
  'update_decision_memo': '🗂️ 更新战略备忘…',
  'update_fof_dictionary': '📖 维护 FOF 字典…',
  'get_index_valuation': '📊 评估指数估值…',
  'get_cross_asset_data': '🌍 加载跨资产全景…',
  'get_bond_market_data': '🏦 解析债市数据…',
  'get_sector_ranking': '🏭 扫描行业板块…',
  'get_macro_data': '📡 采集宏观指标…',
  'get_recent_scores': '📋 查询历史打分…',
  'store_scoring_snapshot': '💾 保存打分快照…',
};

// Token 估算工具（中文约1.8字符/token）
export const estimateTokens = (body) => {
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

// 底层 HTTP 请求 — 单次调用（analyzeFundWithAI / analyzePortfolioWithAI 使用）
export const executeAIRequest = async (settings, provider, apiKey, modelName, prompt, targetTemp, targetTopP, apiBase = '') => {
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

    const estTokens = estimateTokens(body);
    const reasoningLabel = (provider === 'deepseek' || provider === 'siliconflow') ? (settings.reasoningEffort || 'max') : 'n/a';
    debugLog('%c📊 [Token 估算] ' + provider + ' | 推理: ' + reasoningLabel + ' | 预估输入: ≈' + estTokens + ' tokens | 模型: ' + modelName, 'color: #10b981; font-weight: bold;');

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
