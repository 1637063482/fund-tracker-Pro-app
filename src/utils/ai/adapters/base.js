// AI Adapter 抽象基类 — Adapter 只处理协议序列化/反序列化
// 工具循环由 Pipeline 统一驱动

export class AIAdapter {
  constructor(provider) {
    this.provider = provider;
  }

  // 构建完整请求: { url, headers, body }
  buildRequest(ctx) {
    throw new Error('subclass must implement buildRequest');
  }

  // 从响应提取最终文本
  parseText(data) {
    throw new Error('subclass must implement parseText');
  }

  // 从响应提取推理过程
  parseReasoning(data) {
    return null;  // optional
  }

  // 检查是否有工具调用
  hasToolCalls(data) {
    return false;
  }

  // 提取工具调用 → [{ id, name, args }]
  extractToolCalls(data) {
    return [];
  }

  // 将工具结果写入 body 供下一轮使用
  applyToolResults(body, toolCallResults, prevData) {
    // subclass implements
  }

  // 执行一次 HTTP 请求
  async executeOnce(request) {
    const res = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices && !data.candidates) throw new Error(data.message);
    return data;
  }
}
