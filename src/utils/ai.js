// AI 模块向后兼容重导出入口：所有逻辑已拆分到 src/utils/ai/ 子模块，原有 import 路径无需修改
export {
  analyzeFundWithAI,
  analyzePortfolioWithAI,
  chatWithPortfolioAI
} from './ai/core';

export { stripThinkingBlock } from './ai/context/history';
