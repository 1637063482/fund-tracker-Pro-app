// AI core dialog engine - delegates to orchestrator
import { resolveProvider } from './providers';
import { fetchAdvancedMarketData } from './market-data';
import { fetchTavilySearch } from './search-engines';
import { buildFundAnalysisPrompt, buildPortfolioAnalysisPrompt } from './prompts/index';
import { orchestratorChat } from './orchestrator';
import { debugLog } from '../debugLog';

// ============================================================================
// 1. Single fund analysis - delegates to orchestrator
// ============================================================================
export const analyzeFundWithAI = async (settings, fund, profile, marketData) => {
  const marketEnv = await fetchAdvancedMarketData(settings);
  let searchContext = '';
  if (settings.tavilyApiKey) {
    const isBondFund = (fund?.name || '').includes('债');
    const marketFocus = isBondFund ? '中国债券市场 央行公开市场操作 市场利率走势' : 'A股走势 宏观经济';
    const query = '今日 ' + marketFocus + ' ' + (fund?.name || '') + ' 最新新闻 利空 利好';
    const res = await fetchTavilySearch(settings.tavilyApiKey, query, 'news', settings, 'd1', settings.searchResultCount);
    if (res) searchContext = '\n【实时联网搜索结果(来自 Tavily Search)】\n' + res + '\n';
  }
  const analysisPrompt = buildFundAnalysisPrompt(fund, profile, settings, marketEnv, searchContext);
  const analysisSystem = '你是一个极其严谨、冷静、只认客观数据的顶尖量化基金经理与交易执行引擎。现在请对以下单只基金进行深度"全息体检"。唯一职责：基于注入的真实账本数据与基金基本面，给出客观、克制、直击痛点的诊断结论。不讲课、不讨好、不口嗨。';

  return await orchestratorChat({
    settings,
    analysisMode: true,
    analysisPrompt,
    analysisSystem,
    portfolioStats: {},
    newMessage: analysisPrompt
  });
};

// ============================================================================
// 2. Full portfolio analysis - delegates to orchestrator
// ============================================================================
export const analyzePortfolioWithAI = async (settings, portfolioStats, marketData) => {
  const marketEnv = marketData && marketData.length > 0
    ? '\n【今日实时大盘与基准行情】\n' + marketData.map(m => '- ' + m.name + ': ' + m.price + ' (' + (m.change > 0 ? '+' : '') + (m.percent * 100).toFixed(2) + '%)').join('\n')
    : '\n【今日实时大盘与基准行情】\n大盘数据未获取。';
  let searchContext = '';
  if (settings.tavilyApiKey) {
    const query = '当前中国央行货币政策 债券市场走势 A股大盘走势 美联储降息预期 宏观经济';
    const res = await fetchTavilySearch(settings.tavilyApiKey, query, 'news', settings, 'd1', settings.searchResultCount);
    if (res) searchContext = '\n【实时联网搜索结果(来自 Tavily Search)】\n' + res + '\n';
  }
  const analysisPrompt = buildPortfolioAnalysisPrompt(portfolioStats, settings, marketEnv, searchContext);
  const analysisSystem = '你是一个极其严谨、冷静的顶尖量化基金经理。请对以下投资组合进行全面体检。';

  return await orchestratorChat({
    settings,
    analysisMode: true,
    analysisPrompt,
    analysisSystem,
    portfolioStats,
    newMessage: analysisPrompt
  });
};

// ============================================================================
// 3. Chat dialog - delegates to Orchestrator
// ============================================================================
export const chatWithPortfolioAI = async (
  settings, portfolioStats, chatHistory, newMessage, marketData,
  useWebSearch = true, todos = [], memos = [], onStatus = null, firestoreContext = null
) => {
  const pipelineResult = await orchestratorChat({
    settings, portfolioStats, chatHistory, newMessage, marketData,
    todos, memos, onStatus, firestoreContext
  });

  let { text: accumulatedContent, reasoning, pendingActions, roundNum } = pipelineResult;

  if (!accumulatedContent) {
    accumulatedContent = pipelineResult.data?.choices?.[0]?.message?.content || '';
    if (!accumulatedContent && pipelineResult.data?.candidates?.[0]?.content?.parts) {
      accumulatedContent = pipelineResult.data.candidates[0].content.parts
        .filter(p => p.text).map(p => p.text).join('\n');
    }
  }

  if (!accumulatedContent) {
    const configuredMax = settings.maxToolLoops || 12;
    if (roundNum >= configuredMax) {
      accumulatedContent = '警告：AI 已连续进行' + configuredMax + '轮地式深度检索，触及系统最大安全运算深度，进程已被强制中断。';
    } else if (reasoning) {
      accumulatedContent = '*(系统提示：AI 思考过程过长导致正文被截断，请直接阅读深度思考过程，或让 AI 精简总结)*';
    }
  }

  const thinkMatch = accumulatedContent.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    accumulatedContent = accumulatedContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }

  if (reasoning && reasoning.trim()) {
    const thinkingBoxClass = 'text-slate-400 dark:text-slate-500 text-xs opacity-90 border-l-4 border-slate-300 dark:border-slate-600 pl-3 py-2 mb-4 bg-slate-50 dark:bg-slate-900/50 max-h-[300px] overflow-y-auto custom-scrollbar rounded-r-lg';
    const thinkProcess = reasoning
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
    accumulatedContent = '### 🧠 AI 深度多轮思考过程\n<div class="' + thinkingBoxClass + '">' + thinkProcess + '</div>\n\n' + accumulatedContent;
  }

  debugLog(
    '%c[完成] 工具轮次: ' + roundNum + ' | 思考: ' + (reasoning || '').length + ' chars | 输出: ' + accumulatedContent.length + ' chars | 待确认: ' + pendingActions.length,
    'color: #10b981; font-weight: bold;'
  );

  if (pendingActions.length > 0) {
    return { type: 'ACTION_REQUIRED', payload: pendingActions, text: accumulatedContent };
  }
  return accumulatedContent;
};
