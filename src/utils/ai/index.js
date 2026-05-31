// AI 模块统一导出入口：聚合 providers / proxy / fifo / market-data / search-engines / tools / prompts / core 所有子模块
export { resolveProvider } from './providers';
export { buildProxyUrl, buildAllOriginsUrl, toIfzqCode } from './proxy';
export { calculate7DayPenalty } from './fifo';
export { formatCashFlows, fetchIntradayTrend, fetchMultiPeriodKLines, fetchAdvancedMarketData } from './market-data';
export { fetchTavilySearch, fetchExaSearch, fetchSerperSearch } from './search-engines';
export { defineTools } from './tools-definitions';
export { dispatchToolCall } from './tool-handlers';
export { buildChatSystemPrompt, buildFundAnalysisPrompt, buildPortfolioAnalysisPrompt, buildLatestStateWrapper } from './prompts';
export { analyzeFundWithAI, analyzePortfolioWithAI, chatWithPortfolioAI } from './core';
