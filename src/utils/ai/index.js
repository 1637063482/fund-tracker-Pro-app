// AI 模块统一导出入口 — 支持新旧两套架构
// 外部使用者（PortfolioChat.jsx / actionHandlers.js）只需 import { chatWithPortfolioAI } ... 即可

// === 旧架构导出（稳定接口） ===
export { resolveProvider } from './providers';
export { buildProxyUrl, buildAllOriginsUrl, toIfzqCode } from './proxy';
export { calculate7DayPenalty } from './fifo';
export { formatCashFlows, fetchIntradayTrend, fetchMultiPeriodKLines, fetchAdvancedMarketData } from './market-data';
export { fetchTavilySearch, fetchExaSearch, fetchSerperSearch } from './search-engines';
export { defineTools } from './tools-definitions';
export { dispatchToolCall } from './tool-handlers';
export { buildChatSystemPrompt, buildFundAnalysisPrompt, buildPortfolioAnalysisPrompt, buildLatestStateWrapper } from './prompts/index';
export { analyzeFundWithAI, analyzePortfolioWithAI, chatWithPortfolioAI } from './core';

// === 新架构导出 ===
export { analyzeContext, fastPath } from './context-router';
export { ContextManager } from './context-manager';
export { getDataCache, clearDataCache } from './precompute';
export { orchestratorChat } from './orchestrator';
export { getAdapter } from './adapters/index';
export { ToolRegistry } from './tools/registry';
export { ToolResultChannel } from './tools/channel';
export { runChatPipeline } from './pipelines/chat-pipeline';
export { downsampleHistory, extractSummaryFromMessage, stripThinkingBlock } from './context/history';
