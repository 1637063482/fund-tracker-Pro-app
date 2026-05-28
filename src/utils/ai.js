// 向后兼容重导出：所有逻辑已拆分到 src/utils/ai/ 各子模块
// 原有 import 路径无需修改，功能完全一致
export {
  analyzeFundWithAI,
  analyzePortfolioWithAI,
  chatWithPortfolioAI
} from './ai/core';
