// AI Adapter 抽象基类 — Adapter 只处理协议序列化/反序列化
// 工具循环由 Pipeline 统一驱动

export class AIAdapter {
  constructor(provider) {
    this.provider = provider;
  }

  // 判断是否需要通过 SW 代理绕过 CORS
  _needsProxy(url) {
    try {
      const u = new URL(url);
      // 仅对同源之外且非 Google API 的请求启用 SW 代理
      // Gemini 一直正常工作（自己的 API key 在 query 参数），不必走代理
      return u.origin !== location.origin &&
             !u.hostname.endsWith('googleapis.com');
    } catch { return false; }
  }

  // 执行一次 HTTP 请求（自动检测跨域，通过 SW 代理绕过 CORS）
  async executeOnce(request) {
    if (this._needsProxy(request.url)) {
      return this._executeViaSwProxy(request);
    }
    return this._executeDirect(request);
  }

  // 直接 fetch（适用于非跨域或已有 CORS 支持的端点）
  async _executeDirect(request) {
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

  // 通过 Service Worker /api/ai-proxy 转发（绕过 CORS 限制）
  async _executeViaSwProxy(request) {
    const forwardedHeaders = {};
    if (request.headers.Authorization) forwardedHeaders.Authorization = request.headers.Authorization;
    if (request.headers['anthropic-version']) forwardedHeaders['anthropic-version'] = request.headers['anthropic-version'];
    if (request.headers['anthropic-beta']) forwardedHeaders['anthropic-beta'] = request.headers['anthropic-beta'];

    console.log('[AI-Proxy] target URL:', (request.url || '').substring(0, 100), '| body keys:', Object.keys(request.body || {}));
    console.trace('[AI-Proxy] stack trace');

    const res = await fetch('/api/ai-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: request.url,
        headers: forwardedHeaders,
        body: request.body
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices && !data.candidates) throw new Error(data.message);
    return data;
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
}
