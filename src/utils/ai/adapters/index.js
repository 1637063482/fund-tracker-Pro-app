// Adapter 工厂 — 根据 provider + protocol 返回对应 Adapter 实例
// provider 可以是字符串（内置提供商名）或对象（自定义提供商含 protocol）
import { GeminiAdapter } from './gemini';
import { OpenAIAdapter } from './openai';
import { AnthropicAdapter } from './anthropic';

export function getAdapter(provider) {
  // 对象形式：自定义提供商
  if (typeof provider === 'object' && provider !== null) {
    if (provider.protocol === 'anthropic') return new AnthropicAdapter();
    if (provider.protocol === 'openai') return new OpenAIAdapter('openai');
    // 兼容旧版：无 protocol 字段时也走 OpenAI
    return new OpenAIAdapter('openai');
  }

  // 字符串形式：内置提供商
  if (provider === 'gemini') return new GeminiAdapter();
  if (provider === 'openai' || provider === 'deepseek' || provider === 'siliconflow') {
    return new OpenAIAdapter(provider);
  }
  return new OpenAIAdapter('openai');
}
