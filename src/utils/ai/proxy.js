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

// 公共 CORS 代理降级列表（按优先级排列，含轮换机制）
const CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/get?url=',
  'https://api.codetabs.com/v1/proxy?quest=',
];
let _proxyFailCount = 0;
let _activeProxyIdx = 0;

// 公共 CORS 代理降级（用于非 custom 模式的外部 API 调用，含自动轮换）
export const buildAllOriginsUrl = (targetUrl) => {
  const encoded = encodeURIComponent(targetUrl);
  const proxy = CORS_PROXIES[_activeProxyIdx];
  return `${proxy}${encoded}`;
};

// 上报代理失败→自动轮换到下一个
export const reportProxyFailure = () => {
  _proxyFailCount++;
  if (_proxyFailCount >= 2) {
    _activeProxyIdx = (_activeProxyIdx + 1) % CORS_PROXIES.length;
    _proxyFailCount = 0;
    console.warn(`[代理] 切换到备用代理 #${_activeProxyIdx}: ${CORS_PROXIES[_activeProxyIdx]}`);
  }
};

// 上报代理成功→重置失败计数
export const reportProxySuccess = () => {
  if (_proxyFailCount > 0) _proxyFailCount = 0;
};

// ============================================================================
// Worker 请求并发控制 — 核心修复：防止短时间密集请求触发东财 IP 级别限流
// 策略：同域请求最小间隔 1500ms，跨域不阻塞，最大排队等待 6s
// ============================================================================
const _domainQueues = {}; // { domain: Promise }

/**
 * 对代理 URL 提取最终目标域（用于排队分组）
 * 代理 URL 格式: https://proxy/?url=https%3A%2F%2Fpush2.eastmoney.com%2F...
 * → 提取 push2.eastmoney.com → 归类为 eastmoney.com
 * 仅对 custom Worker 代理限流（allorigins/codetabs 用各自 IP，不会触发东财 Worker IP 限流）
 */
const _extractRateLimitDomain = (url) => {
  try {
    const targetUrl = new URL(url).searchParams.get('url');
    if (targetUrl) {
      const targetHost = new URL(targetUrl).hostname;
      if (targetHost.includes('eastmoney.com')) return 'eastmoney.com';
      if (targetHost.includes('gtimg.cn')) return 'gtimg.cn';
      return targetHost;
    }
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

/**
 * 带域级别限流的 fetch — 确保对同一目标域（尤其是东财）的 Worker 请求有最小间隔
 * @param {string} url - 完整请求 URL（含代理前缀）
 * @param {object} options - fetch 选项
 * @param {number} minGap - 最小间隔 ms（默认 1500ms）
 * @param {number} maxWait - 最大排队等待 ms（默认 6000ms）
 */
export const rateLimitedFetch = async (url, options = {}, minGap = 1500, maxWait = 6000) => {
  const domain = _extractRateLimitDomain(url);
  const hadPrior = !!_domainQueues[domain];

  // 等待前一个同域请求完成（有最大排队超时保护）
  if (hadPrior) {
    const startWait = Date.now();
    try {
      await Promise.race([
        _domainQueues[domain],
        new Promise((_, reject) => setTimeout(() => reject(new Error('rate-limit-wait-timeout')), maxWait))
      ]);
    } catch (e) {
      if (e.message === 'rate-limit-wait-timeout') {
        console.warn(`[并发控制] ${domain} 排队超时(${maxWait}ms)，强制执行`);
      }
    }
    const waited = Date.now() - startWait;
    if (waited > 1000) {
      console.warn(`[并发控制] ${domain} 等待前序请求完成耗时 ${waited}ms`);
    }
  }

  // 仅当有前序请求时才加间隔延迟（首个请求无需等待）
  if (hadPrior) {
    await new Promise(r => setTimeout(r, minGap));
  }

  // 执行实际 fetch，最后延迟释放锁
  const fetchPromise = (async () => {
    try {
      const res = await fetch(url, options);
      return res;
    } finally {
      // 延迟释放锁（确保下一个请求有间隔），仅当锁仍属于本请求时释放
      setTimeout(() => {
        if (_domainQueues[domain] === fetchPromise) {
          delete _domainQueues[domain];
        }
      }, minGap);
    }
  })();

  _domainQueues[domain] = fetchPromise;
  return fetchPromise;
};

// 智能前缀：000001 和 5 开头(沪市 ETF)加 sh，其他加 sz
export const toIfzqCode = (code) => {
  return (code === '000001' || code.startsWith('5')) ? 'sh' + code : 'sz' + code;
};
