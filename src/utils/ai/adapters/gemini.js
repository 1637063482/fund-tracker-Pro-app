// Gemini Adapter — functionCall / functionResponse 协议
import { AIAdapter } from './base';

export class GeminiAdapter extends AIAdapter {
  constructor() {
    super('gemini');
  }

  buildRequest(ctx) {
    const { targetModel, apiKey } = ctx.provider;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;

    // 构建 contents 序列 — 去掉 rulebook，纯历史+状态
    const mkPart = (text) => ({ parts: [{ text }] });

    const contents = [];

    // History (已降采样)
    if (ctx.history) {
      for (const msg of ctx.history) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
    }

    // State wrapper — 永远在最末尾，前面全是可缓存的前缀
    contents.push(mkPart(ctx.stateWrapper));

    // 工具声明（清洗 Gemini 不兼容字段）
    const sanitizeSchema = (node) => {
      if (!node || typeof node !== 'object') return node;
      if (Array.isArray(node)) return node.map(sanitizeSchema);
      const out = {};
      for (const key of Object.keys(node)) {
        if (key === 'additionalProperties') continue;
        if (key === 'enum' && Array.isArray(node.enum) && node.enum.some(v => typeof v === 'number')) {
          out[key] = node.enum.map(String);
        } else if (key === 'properties' || key === 'items') {
          out[key] = sanitizeSchema(node[key]);
        } else {
          out[key] = node[key];
        }
      }
      return out;
    };

    const geminiDeclarations = (ctx.toolRegistry?.getDefinitions() || []).map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: sanitizeSchema(t.function.parameters)
    }));

    const body = {
      systemInstruction: { parts: [{ text: ctx.systemPrompt }] },
      contents,
      tools: geminiDeclarations.length > 0
        ? [{ functionDeclarations: geminiDeclarations }]
        : (ctx.useWebSearch ? [{ googleSearch: {} }] : []),
      ...(geminiDeclarations.length > 0 ? { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
      generationConfig: {
        temperature: ctx.settings.temperature ?? 0.1,
        topP: ctx.settings.topP ?? 0.1,
        maxOutputTokens: ctx.settings.maxOutputTokens || 8192
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
      ]
    };

    return { url, headers: { 'Content-Type': 'application/json' }, body };
  }

  parseText(data) {
    if (!data.candidates || !data.candidates[0]) return '';
    const parts = data.candidates[0].content?.parts || [];
    return parts.filter(p => p.text).map(p => p.text).join('\n');
  }

  hasToolCalls(data) {
    if (!data.candidates || !data.candidates[0]) return false;
    const parts = data.candidates[0].content?.parts || [];
    return parts.some(p => p.functionCall);
  }

  extractToolCalls(data) {
    if (!data.candidates || !data.candidates[0]) return [];
    const parts = data.candidates[0].content?.parts || [];
    return parts
      .filter(p => p.functionCall)
      .map(p => ({
        id: `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: p.functionCall.name,
        args: p.functionCall.args || {}
      }));
  }

  applyToolResults(body, channel, prevData) {
    if (!prevData.candidates) return;

    // 添加 model 消息（含 functionCall parts）
    const parts = prevData.candidates[0].content?.parts || [];
    body.contents.push({ role: 'model', parts });

    // 构建 functionResponse parts
    const functionCalls = parts.filter(p => p.functionCall);
    const functionResponseParts = [];

    for (const fcPart of functionCalls) {
      const name = fcPart.functionCall.name;
      const output = channel.get(name) || '';
      functionResponseParts.push({
        functionResponse: {
          name,
          response: { result: output }
        }
      });
    }

    if (functionResponseParts.length > 0) {
      body.contents.push({ role: 'user', parts: functionResponseParts });
    }
  }
}
