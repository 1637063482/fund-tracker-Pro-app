// 代理 URL 构建模块：统一拼接 CORS 代理前缀与基金代码转换，消除 20+ 处重复的模板字符串拼接
export const buildProxyUrl = (settings, targetUrl) => {
  if (settings.proxyMode !== 'custom' || !settings.customProxyUrl) {
    return targetUrl;
  }
  const proxy = settings.customProxyUrl;
  return proxy.includes('{{url}}')
    ? proxy.replace('{{url}}', encodeURIComponent(targetUrl))
    : proxy + targetUrl;
};

// 公共 CORS 代理降级（用于非 custom 模式的外部 API 调用）
export const buildAllOriginsUrl = (targetUrl) => {
  return `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
};

// 智能前缀：000001 和 5 开头(沪市 ETF)加 sh，其他加 sz
export const toIfzqCode = (code) => {
  return (code === '000001' || code.startsWith('5')) ? 'sh' + code : 'sz' + code;
};
