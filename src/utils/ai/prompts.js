// 向后兼容 — 所有函数定义已迁移至 prompts/ 目录
export {
  buildCoreSystemPrompt,
  buildSkillLibraryPrompt,
  buildScoringSystemPrompt,
  buildChatSystemPrompt,
  buildFundAnalysisPrompt,
  buildPortfolioAnalysisPrompt,
  buildLatestStateWrapper,
  fullDateTimeStr
} from './prompts/index';
