// OpenAI-compatible Adapter — 统一处理 OpenAI / DeepSeek / SiliconFlow
import { AIAdapter } from './base';
import { buildReasoningConfig } from '../providers/shared';

const API_ENDPOINTS = {
  deepseek: 'https://api.deepseek.com/chat/completions',
  siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
};

export class OpenAIAdapter extends AIAdapter {
  constructor(provider) {
    super(provider);
    this.providerType = provider; // 'openai' | 'deepseek' | 'siliconflow'
  }

  buildRequest(ctx) {
    const { apiKey, targetModel, apiBase } = ctx.provider;
    const url = this.providerType === 'openai'
      ? ((apiBase || '').replace(/\/+$/, '') + '/chat/completions')
      : (API_ENDPOINTS[this.providerType] || 'https://api.deepseek.com/chat/completions');

    const messages = [{ role: 'system', content: ctx.systemPrompt }];

    // History (已降采样)
    if (ctx.history) {
      for (const msg of ctx.history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // State wrapper — 永远在最末尾，前面全是可缓存的前缀
    messages.push({ role: 'user', content: ctx.stateWrapper });

    const body = {
      model: targetModel,
      messages,
      temperature: ctx.settings.temperature ?? 0.1,
      top_p: ctx.settings.topP ?? 0.1,
      max_tokens: ctx.settings.maxOutputTokens || 8192,
      tools: ctx.toolRegistry?.getDefinitions() || [],
      ...((this.providerType === 'deepseek' || this.providerType === 'siliconflow') &&
        buildReasoningConfig(ctx.settings.reasoningEffort))
    };

    return {
      url,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body
    };
  }

  parseText(data) {
    return data?.choices?.[0]?.message?.content || '';
  }

  parseReasoning(data) {
    return data?.choices?.[0]?.message?.reasoning_content || null;
  }

  hasToolCalls(data) {
    return !!(data?.choices?.[0]?.message?.tool_calls?.length);
  }

  extractToolCalls(data) {
    const toolCalls = data?.choices?.[0]?.message?.tool_calls || [];
    return toolCalls.map(tc => {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore */ }
      return { id: tc.id, name: tc.function.name, args };
    });
  }

  applyToolResults(body, channel, prevData) {
    const responseMsg = prevData?.choices?.[0]?.message;
    if (!responseMsg) return;

    // Push assistant message with tool_calls
    body.messages.push(responseMsg);

    // Push tool results
    if (responseMsg.tool_calls) {
      for (const tc of responseMsg.tool_calls) {
        const output = channel.get(tc.id) || '';
        body.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: output
        });
      }
    }
  }
}
