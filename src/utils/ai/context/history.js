// 历史消息降采样 — 纯滑窗截断 + 噪音清洗
// 删除了跨天压缩逻辑，完全由 UI 下拉菜单的 maxHistoryMessages 决定上下文窗口
// 保留 extractSummaryFromMessage 作为独立工具函数，供需要摘要的场景使用

const RADAR_PATTERNS = [
  /🚨\s*【[^】]*】?\s*大盘雷达[^\n]*\n?/g,
  /【系统指令：用户已手动关闭大盘雷达[^】]*】/g,
  /(?:纯净模式|雷达(?:状态|已(?:开启|关闭)))[^\n]*\n?/g,
];

const THINKING_PATTERN = /### 🧠 AI 深度(?:多轮)?思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/g;

/**
 * 从文本中剥离 AI 思考过程块（通用工具，UI 渲染 + AI 上下文共用）
 * 匹配 core.js 和 shared.js 两种格式：
 *   - "### 🧠 AI 深度多轮思考过程"
 *   - "### 🧠 AI 深度思考过程"
 */
export const stripThinkingBlock = (content) => {
  if (!content) return content;
  return content.replace(THINKING_PATTERN, '');
};

/**
 * 主降采样函数：纯滑窗截断 + 噪音清洗
 * - 不再按日分割，不再跨天压缩
 * - 保留最后 maxHistoryMessages 条消息（UI 下拉设置值）
 * - 清洗雷达指令和 thinking div
 */
export const downsampleHistory = (msgs, settings) => {
  if (!msgs || msgs.length === 0) return [];

  const maxMessages = settings?.maxHistoryMessages ?? 20;
  const recent = msgs.slice(-maxMessages);

  return recent.map(msg => {
    let content = msg.content || '';
    // 清洗 assistant 消息中的 AI 思考过程（复用 stripThinkingBlock）
    if (msg.role === 'assistant') {
      content = stripThinkingBlock(content);
    }
    // 清洗雷达相关噪音
    for (const pat of RADAR_PATTERNS) {
      content = content.replace(pat, '');
    }
    return { role: msg.role, content };
  });
};

/**
 * 从单条 assistant 消息中提取摘要内容
 * 保留此函数供 AI 在回复中携带 [本轮摘要] 时使用
 * 调用方无需再用此摘要做跨天压缩，可用于日志/展示等场景
 */
export const extractSummaryFromMessage = (msg) => {
  if (!msg || !msg.content) return '';

  const patterns = [
    /\[本轮摘要\]\s*([\s\S]*?)(?:\n\n|$)/,
    /(?:摘要|总结|核心结论)[：:]\s*([\s\S]*?)(?:\n\n|$)/i,
  ];

  for (const pat of patterns) {
    const m = msg.content.match(pat);
    if (m?.[1]?.trim()) {
      return m[1].trim();
    }
  }
  return '';
};
