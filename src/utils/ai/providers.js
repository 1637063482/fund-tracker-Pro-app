// 统一的 Provider 配置解析，消除 3 处重复代码
export const resolveProvider = (settings) => {
  const provider = settings.aiProvider || 'gemini';

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
  }

  if (!apiKey) {
    throw new Error(`请先在设置中配置 ${provider.toUpperCase()} 的 API Key`);
  }

  return { provider, apiKey, targetModel };
};
