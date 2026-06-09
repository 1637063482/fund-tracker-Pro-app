// 轻量判断 — 仅问候/感谢/帮助类 → true，其余全部 false（走全量注入）
const LIGHT_PATTERNS = [
  /^(你好|hi|hello|谢谢|感谢|再见|拜拜|帮助|help|你能做什么|你会什么|功能|介绍一下)[！!。.]*$/i,
  /^(嗯|哦|好|ok|好的|知道了|明白了)[！!。.]*$/i,
];

export const isLightMessage = (message) => {
  if (!message || !message.trim()) return true;
  const msg = message.trim();
  for (const pattern of LIGHT_PATTERNS) {
    if (pattern.test(msg)) return true;
  }
  return false;
};

// 已废弃 — 以前用于异步上下文分析，现在由 orchestrator 直接调用 isLightMessage
// 保留符号以维持 index.js 的导出兼容
export const analyzeContext = async () => ({ isLight: false });
export const fastPath = () => ({ isLight: false });
