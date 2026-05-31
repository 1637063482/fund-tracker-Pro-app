// AI 供应商配置解析模块：统一解析各 AI 供应商的 API Key、模型名称与端点地址，消除多处重复代码
export const resolveProvider = (settings) => {
  const providerId = settings.aiProvider || 'gemini';

  // 自定义提供商（ID 以 custom_ 开头）
  if (providerId.startsWith('custom_')) {
    const customs = settings.customAiProviders || [];
    const custom = customs.find(p => p.id === providerId);
    if (custom) {
      return {
        provider: 'openai',
        apiKey: custom.key || '',
        targetModel: custom.model || '',
        apiBase: custom.apiBase || ''
      };
    }
  }

  let provider = providerId;
  let apiKey = '';
  let targetModel = '';

  if (provider === 'gemini') {
    apiKey = settings.geminiApiKey;
    targetModel = settings.geminiModel || 'gemini-2.5-pro';
  } else if (provider === 'deepseek') {
    apiKey = settings.deepseekApiKey;
    targetModel = settings.deepseekModel || 'deepseek-v4-pro';
  } else if (provider === 'siliconflow') {
    apiKey = settings.siliconflowApiKey;
    targetModel = settings.siliconflowModel || 'deepseek-ai/DeepSeek-V3';
  } else if (provider === 'openai') {
    apiKey = settings.openaiApiKey;
    targetModel = settings.openaiModel || 'gpt-4o';
  }

  if (!apiKey) {
    throw new Error(`请先在设置中配置 ${provider.toUpperCase()} 的 API Key`);
  }

  return { provider, apiKey, targetModel };
};
