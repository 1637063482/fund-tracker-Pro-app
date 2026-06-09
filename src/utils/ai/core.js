// AI 核心对话引擎 — 向后兼容，委托给编排器/管道/适配器
import { resolveProvider } from './providers';
import { fetchAdvancedMarketData } from './market-data';
import { fetchTavilySearch } from './search-engines';
import { buildFundAnalysisPrompt, buildPortfolioAnalysisPrompt } from './prompts/index';
import { executeAIRequest } from './providers/shared';
import { orchestratorChat } from './orchestrator';
import { debugLog } from '../debugLog';

// ============================================================================
// 1. 单基诊断引擎（不变）
// ============================================================================
export const analyzeFundWithAI = async (settings, fund, profile, marketData) => {
  const { provider, apiKey, targetModel, apiBase } = resolveProvider(settings);
  const marketEnv = await fetchAdvancedMarketData(settings);
  let searchContext = '';
  if (settings.tavilyApiKey) {
    const isBondFund = (fund?.name || '').includes('债');
    const marketFocus = isBondFund ? '中国债券市场 央行公开市场操作 市场利率走势' : 'A股走势 宏观经济';
    const query = `今日 ${marketFocus} ${fund?.name || ''} 最新新闻 利空 利好`;
    const res = await fetchTavilySearch(settings.tavilyApiKey, query, 'news', settings, 'd1', settings.searchResultCount);
    if (res) searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n${res}\n`;
  }
  const prompt = buildFundAnalysisPrompt(fund, profile, settings, marketEnv, searchContext);
  return await executeAIRequest(settings, provider, apiKey, targetModel, prompt, undefined, undefined, apiBase);
};

// ============================================================================
// 2. 全盘体检引擎（不变）
// ============================================================================
export const analyzePortfolioWithAI = async (settings, portfolioStats, marketData) => {
  const { provider, apiKey, targetModel, apiBase } = resolveProvider(settings);
  const marketEnv = marketData && marketData.length > 0
    ? `\n【今日实时大盘与基准行情】\n${marketData.map(m => `- ${m.name}: ${m.price} (${m.change > 0 ? '+' : ''}${(m.percent * 100).toFixed(2)}%)`).join('\n')}`
    : '\n【今日实时大盘与基准行情】\n大盘数据未获取。';
  let searchContext = '';
  if (settings.tavilyApiKey) {
    const query = '当前中国央行货币政策 债券市场走势 A股大盘走势 美联储降息预期 宏观经济';
    const res = await fetchTavilySearch(settings.tavilyApiKey, query, 'news', settings, 'd1', settings.searchResultCount);
    if (res) searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n${res}\n`;
  }
  const prompt = buildPortfolioAnalysisPrompt(portfolioStats, settings, marketEnv, searchContext);
  return await executeAIRequest(settings, provider, apiKey, targetModel, prompt, undefined, undefined, apiBase);
};

// ============================================================================
// 3. 聊天对话引擎 — 委托给 Orchestrator
// ============================================================================
export const chatWithPortfolioAI = async (
  settings, portfolioStats, chatHistory, newMessage, marketData,
  useWebSearch = true, todos = [], memos = [], onStatus = null, firestoreContext = null
) => {
  // useWebSearch 不再传递 — 联网搜索由工具定义(tavily_news_search/google_macro_search等)自动覆盖
  const pipelineResult = await orchestratorChat({
    settings, portfolioStats, chatHistory, newMessage, marketData,
    todos, memos, onStatus, firestoreContext
  });

  let { text: accumulatedContent, reasoning, pendingActions, roundNum } = pipelineResult;

  // ── 兜底提取 ──
  if (!accumulatedContent) {
    // OpenAI-compatible 格式
    accumulatedContent = pipelineResult.data?.choices?.[0]?.message?.content || '';
    // Gemini 格式
    if (!accumulatedContent && pipelineResult.data?.candidates?.[0]?.content?.parts) {
      accumulatedContent = pipelineResult.data.candidates[0].content.parts
        .filter(p => p.text).map(p => p.text).join('\n');
    }
  }

  // ── 极端兜底：纯工具调用达到上限 ──
  if (!accumulatedContent) {
    const configuredMax = settings.maxToolLoops || 12;
    if (roundNum >= configuredMax) {
      accumulatedContent = `⚠️ 警报：AI 已连续进行 ${configuredMax} 轮地毯式深度检索，触及系统最大安全运算深度，进程已被强制中断。`;
    } else if (reasoning) {
      accumulatedContent = "*(系统提示：AI 思考过程过长导致正文被截断，请直接阅读深度思考过程，或让 AI 精简总结)*";
    }
  }

  // ── 清洗 <think> 标签（DeepSeek 原始格式）──
  const thinkMatch = accumulatedContent.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    accumulatedContent = accumulatedContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }

  // ── Reasoning → HTML 包装（可折叠思考过程）──
  if (reasoning && reasoning.trim()) {
    const thinkingBoxClass = "text-slate-400 dark:text-slate-500 text-xs opacity-90 border-l-4 border-slate-300 dark:border-slate-600 pl-3 py-2 mb-4 bg-slate-50 dark:bg-slate-900/50 max-h-[300px] overflow-y-auto custom-scrollbar rounded-r-lg";
    const thinkProcess = reasoning
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
    accumulatedContent = `### 🧠 AI 深度多轮思考过程\n<div class="${thinkingBoxClass}">${thinkProcess}</div>\n\n` + accumulatedContent;
  }

  debugLog(
    `%c✅ [完成] 工具轮次: ${roundNum} | 思考: ${(reasoning || '').length} chars | 输出: ${accumulatedContent.length} chars | 待确认: ${pendingActions.length}`,
    'color: #10b981; font-weight: bold;'
  );

  if (pendingActions.length > 0) {
    return { type: 'ACTION_REQUIRED', payload: pendingActions, text: accumulatedContent };
  }
  return accumulatedContent;
};
