// 工具结果通道 — 隔离工具执行结果，替代 body.messages 全局副作用
// 每个工具调用的结果按 toolCallId 存储，Adapters 按各自协议格式取用

export class ToolResultChannel {
  constructor() {
    this._results = new Map();
    this._pendingActions = [];
  }

  // 记录一次工具调用的结果
  record(toolCallId, output, pendingActions = []) {
    this._results.set(toolCallId, {
      output,
      pendingActions: pendingActions || [],
      timestamp: Date.now()
    });
    if (pendingActions && pendingActions.length > 0) {
      this._pendingActions.push(...pendingActions);
    }
  }

  // 获取单条结果文本
  get(toolCallId) {
    return this._results.get(toolCallId)?.output || '';
  }

  // 获取所有未完成的 pendingActions
  getPendingActions() {
    return this._pendingActions;
  }

  // 格式化所有工具结果为 OpenAI 格式的 tool messages
  formatForOpenAI(toolCallIds) {
    const messages = [];
    for (const id of toolCallIds) {
      const result = this._results.get(id);
      if (result) {
        messages.push({
          role: 'tool',
          tool_call_id: id,
          content: result.output
        });
      }
    }
    return messages;
  }

  // 格式化所有工具结果为 Gemini 格式的 functionResponse parts
  formatForGemini(toolNames) {
    const parts = [];
    for (const name of toolNames) {
      // Gemini 的 functionCall id 无意义，按 name 匹配
      const result = this._results.get(name);
      if (result) {
        parts.push({
          functionResponse: {
            name,
            response: { result: result.output }
          }
        });
      }
    }
    return parts;
  }

  // 清空（每轮 tool loop 开始时调用）
  clear() {
    this._results.clear();
  }

  get size() {
    return this._results.size;
  }
}
