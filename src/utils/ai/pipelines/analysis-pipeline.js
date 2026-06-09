// 单次分析管道 — 无工具循环，用于单基诊断和全盘体检
export async function runAnalysisPipeline(adapter, ctx) {
  const request = adapter.buildRequest(ctx);
  const data = await adapter.executeOnce(request);
  const text = adapter.parseText(data);
  const reasoning = adapter.parseReasoning(data);

  if (!text) throw new Error('API 未返回有效文本');

  if (reasoning) {
    const thinkProcess = reasoning.replace(/\n/g, '<br/>');
    return `### 🧠 AI 深度思考过程\n<div class="text-slate-400 dark:text-slate-500 text-xs opacity-90 border-l-4 border-slate-300 dark:border-slate-600 pl-3 py-2 mb-4 bg-slate-50 dark:bg-slate-900/50 rounded-r-lg">${thinkProcess}</div>\n\n` + text;
  }
  return text;
}
