// Adapter 工厂 — 根据 provider 返回对应 Adapter 实例
import { GeminiAdapter } from './gemini';
import { OpenAIAdapter } from './openai';

export function getAdapter(provider) {
  if (provider === 'gemini') return new GeminiAdapter();
  if (provider === 'openai' || provider === 'deepseek' || provider === 'siliconflow') {
    return new OpenAIAdapter(provider);
  }
  // 自定义提供商 → 使用 OpenAI-compatible
  return new OpenAIAdapter('openai');
}
