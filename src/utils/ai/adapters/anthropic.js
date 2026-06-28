// Anthropic Messages API Adapter — 兼容 OpenModel / Anthropic 原生 API
// 使用 Anthropic Messages API 格式 (POST /v1/messages)
import { AIAdapter } from './base';

export class AnthropicAdapter extends AIAdapter {
  constructor() {
    super('anthropic');
  }

  buildRequest(ctx) {
    const { apiKey, targetModel, apiBase } = ctx.provider;
    // 兼容 apiBase 带/不带 /v1/messages 或 /messages 后缀
    let base = (apiBase || 'https://api.anthropic.com').replace(/\/+$/, '');
    base = base.replace(/\/v1\/messages\/?$/, '').replace(/\/messages\/?$/, '');
    const url = base.includes('/v1') ? base + '/messages' : base + '/v1/messages';

    const messages = [];

    // History (已降采样)
    if (ctx.history) {
      for (const msg of ctx.history) {
        messages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content
        });
      }
    }

    // State wrapper — 永远在最末尾
    messages.push({ role: 'user', content: ctx.stateWrapper });

    const body = {
      model: targetModel,
      messages,
      system: ctx.systemPrompt,
      max_tokens: ctx.settings.maxOutputTokens || 8192,
      temperature: ctx.settings.temperature ?? 0.1,
      top_p: ctx.settings.topP ?? 0.1,
    };

    // Tools (Anthropic 格式: input_schema 而非 parameters)
    const toolDefs = ctx.toolRegistry?.getDefinitions() || [];
    if (toolDefs.length > 0) {
      body.tools = toolDefs.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters
      }));
    }

    return {
      url,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01'
      },
      body
    };
  }

  parseText(data) {
    if (!data.content) return '';
    const textBlocks = data.content.filter(b => b.type === 'text');
    return textBlocks.map(b => b.text).join('\n');
  }

  parseReasoning(data) {
    if (!data.content) return null;
    const thinkingBlocks = data.content.filter(b => b.type === 'thinking');
    return thinkingBlocks.map(b => b.thinking || b.text || '').join('\n') || null;
  }

  hasToolCalls(data) {
    if (!data.content) return false;
    return data.content.some(b => b.type === 'tool_use') || data.stop_reason === 'tool_use';
  }

  extractToolCalls(data) {
    if (!data.content) return [];
    return data.content
      .filter(b => b.type === 'tool_use')
      .map(b => ({
        id: b.id,
        name: b.name,
        args: b.input || {}
      }));
  }

  applyToolResults(body, channel, prevData) {
    if (!prevData.content) return;

    // 构建 assistant 消息 (含 text + tool_use + thinking blocks)
    const assistantContent = prevData.content.map(b => {
      if (b.type === 'text') return { type: 'text', text: b.text };
      if (b.type === 'tool_use') return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
      if (b.type === 'thinking') return { type: 'thinking', thinking: b.thinking, signature: b.signature };
      return b;
    });

    body.messages.push({ role: 'assistant', content: assistantContent });

    // 构建 tool_result content blocks
    const toolResultBlocks = [];
    for (const b of prevData.content) {
      if (b.type === 'tool_use') {
        const output = channel.get(b.id) || '';
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: b.id,
          content: output
        });
      }
    }

    if (toolResultBlocks.length > 0) {
      body.messages.push({ role: 'user', content: toolResultBlocks });
    }
  }
}
