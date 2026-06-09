// 历史消息降采样 — 今日全量 + 跨日摘要压缩
// 今日：保留最近 N 轮（默认 6 条消息 = 3 轮对话）
// 跨日：提取 [本轮摘要] 行 → 合并为单条 compact 消息
// 同时清洗掉雷达开关、thinking div 等噪音

const RADAR_PATTERNS = [
  /🚨\s*【[^】]*】?\s*大盘雷达[^\n]*\n?/g,
  /【系统指令：用户已手动关闭大盘雷达[^】]*】/g,
  /(?:纯净模式|雷达(?:状态|已(?:开启|关闭)))[^\n]*\n?/g,
];

const THINKING_PATTERN = /### 🧠 AI (?:深度多轮)?思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/g;

export const downsampleHistory = (msgs, settings) => {
  if (!msgs || msgs.length === 0) return [];

  const todayStr = new Date().toDateString();
  const MAX_TODAY_ROUNDS = settings?.maxHistoryMessages || 6;
  const MAX_OLDER_ROUNDS = Math.max(1, Math.floor(MAX_TODAY_ROUNDS / 3));
  const MAX_SUMMARY_CHARS = 500; // 每条跨日摘要最大字符数

  // 分离今日和跨日消息（按 user/assistant 配对）
  const todayMsgs = [];
  const olderMsgs = [];
  let i = 0;
  while (i < msgs.length) {
    const userMsg = msgs[i];
    const asstMsg = msgs[i + 1];
    const msgDate = userMsg?.timestamp ? new Date(userMsg.timestamp).toDateString() : null;
    if (msgDate === todayStr) {
      if (userMsg) todayMsgs.push(userMsg);
      if (asstMsg?.role === 'assistant') todayMsgs.push(asstMsg);
    } else {
      if (userMsg) olderMsgs.push(userMsg);
      if (asstMsg?.role === 'assistant') olderMsgs.push(asstMsg);
    }
    i += 2;
  }

  // 今日：截断最近 N 轮
  const recentToday = todayMsgs.slice(-MAX_TODAY_ROUNDS * 2);

  // 跨日：提取摘要 + 压缩
  const recentOlder = olderMsgs.slice(-MAX_OLDER_ROUNDS * 2);
  const olderCompressed = [];
  let j = 0;
  while (j < recentOlder.length) {
    const uMsg = recentOlder[j];
    const aMsg = recentOlder[j + 1];

    if (uMsg?.role === 'user') {
      let aiSummary = '';
      if (aMsg?.role === 'assistant' && aMsg.content) {
        // 尝试多种摘要提取格式（兼容 AI 可能偏离格式的情况）
        const patterns = [
          /\[本轮摘要\]\s*([\s\S]*?)(?:\n\n|$)/,       // 标准格式
          /(?:摘要|总结|核心结论)[：:]\s*([\s\S]*?)(?:\n\n|$)/i, // 备用格式
        ];
        for (const pat of patterns) {
          const m = aMsg.content.match(pat);
          if (m?.[1]?.trim()) {
            aiSummary = m[1].trim();
            break;
          }
        }
        // 若无摘要，从 AI 回复开头提取前一句话作为兜底
        if (!aiSummary) {
          const firstPara = aMsg.content
            .replace(THINKING_PATTERN, '')
            .replace(/^#{1,4}\s.*\n/gm, '')
            .trim();
          const firstSentence = firstPara.match(/^([^。！？\n]{20,200})/);
          if (firstSentence?.[1]) {
            aiSummary = firstSentence[1] + '…';
          }
        }
      }

      const dateLabel = uMsg.timestamp ? new Date(uMsg.timestamp).toDateString() : '?';
      const userText = (uMsg.content || '').substring(0, 200); // 截断过长用户消息
      const summaryText = aiSummary ? aiSummary.substring(0, MAX_SUMMARY_CHARS) : '';

      olderCompressed.push({
        role: 'user',
        content: `[跨日 ${dateLabel}] ${userText}${summaryText ? ` | AI摘要: ${summaryText}` : ''}`
      });
    }
    j += 2;
  }

  // 合并 + 清洗
  const merged = [...olderCompressed, ...recentToday];

  return merged.map(msg => {
    let content = msg.content || '';
    // 清洗 assistant 消息
    if (msg.role === 'assistant') {
      content = content.replace(THINKING_PATTERN, '');
    }
    // 清洗雷达相关噪音
    for (const pat of RADAR_PATTERNS) {
      content = content.replace(pat, '');
    }
    return { role: msg.role, content };
  });
};
