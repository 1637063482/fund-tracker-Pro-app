// === my-cors-proxy.js 彻底隐身版 ===
let cachedXueqiuCookie = '';

export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie, x-api-key, accept",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ── 深度微观结构探测器（独立路由，不走代理）──
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/market-microstructure') {
      try {
        const result = await this.fetchMicrostructure();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, overall_signal: '数据获取失败' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    const targetUrlStr = url.searchParams.get('url');

    if (!targetUrlStr) {
      return new Response('Missing parameter: url', { status: 400, headers: corsHeaders });
    }

    try {
      const targetUrl = new URL(targetUrlStr);
      
      const allowedDomains = [
        'gtimg.cn', 'sina.com.cn', 'sinajs.cn', 'xueqiu.com',
        '163.com', '1234567.com.cn', 'eastmoney.com', 'danjuanfunds.com',
        'api.exa.ai', 'api.tavily.com', 'google.serper.dev', 'baidu.com', '10jqka.com.',
        'baidubce.com','quickchart.io',
        'cls.cn', 'jin10.com' // 财经快讯 API
      ];
      const isAllowed = allowedDomains.some(domain => targetUrl.hostname.includes(domain));
      if (!isAllowed) {
        return new Response(`Forbidden: Target domain not in whitelist`, { status: 403, headers: corsHeaders });
      }

      let referer = 'https://finance.sina.com.cn/'; 
      let charset = 'GBK'; 
      let isXueqiu = false;
      let userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

      if (targetUrl.hostname.includes('gtimg.cn')) {
        referer = 'https://finance.qq.com/';
      } else if (targetUrl.hostname.includes('fundmobapi.eastmoney.com')) {
        referer = ''; 
        charset = 'UTF-8';
        userAgent = 'Mozilla/5.0 (Linux; Android 12; SM-G998B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.127 Mobile Safari/537.36 EastMoney/6.6.8';
      } else if (targetUrl.hostname.includes('api.fund.eastmoney.com')) {
        referer = 'http://fundf10.eastmoney.com/';
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('danjuanfunds.com')) {
        referer = 'https://danjuanfunds.com/';
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('sinajs.cn') || targetUrl.hostname.includes('sina.com.cn')) {
        referer = 'https://finance.sina.com.cn/'; 
      } else if (targetUrl.hostname.includes('xueqiu.com')) {
        referer = 'https://xueqiu.com/';
        charset = 'UTF-8';
        isXueqiu = true;
      } else if (targetUrl.hostname.includes('163.com')) {
        referer = 'https://money.163.com/';
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('api.exa.ai') || targetUrl.hostname.includes('api.tavily.com') || targetUrl.hostname.includes('google.serper.dev')) {
        referer = '';
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('push2.eastmoney.com')) {
        // 🌟 核心修复 1：针对东财高频行情接口，必须置空 Referer 或使用 quote 域名
        referer = ''; 
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('np-listapi.eastmoney.com')) {
        // 东财快讯 API：必须模拟真实浏览器 Referer
        referer = 'https://www.eastmoney.com/';
        charset = 'UTF-8';
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      } else if (targetUrl.hostname.includes('cls.cn')) {
        // 财联社快讯 API：需要正确的 Referer 和现代浏览器 UA
        referer = 'https://www.cls.cn/telegraph';
        charset = 'UTF-8';
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      } else if (targetUrl.hostname.includes('1234567.com.cn') || targetUrl.hostname.includes('eastmoney.com')) {
        // 兜底逻辑：其他的东财接口（如基金、资讯）依然使用 fund 作为 referer
        referer = 'https://fund.eastmoney.com/';
        charset = 'UTF-8';
      }
      else if (targetUrl.hostname.includes('baidu.com')) {
        referer = 'https://finance.baidu.com/';
        charset = 'UTF-8';
      } else if (targetUrl.hostname.includes('10jqka.com.cn')) {
        referer = 'http://q.10jqka.com.cn/';
        charset = 'GBK'; // 🌟 核心修复：同花顺是老牌网站，必须指定 GBK 防乱码
      }

      const executeRequest = async (useCache = true) => {
        let currentCookie = request.headers.get('Cookie') || '';

        if (isXueqiu) {
          if (!cachedXueqiuCookie || !useCache) {
            const xqRes = await fetch('https://xueqiu.com/', { headers: { 'User-Agent': userAgent } });
            const setCookieHeader = xqRes.headers.get('set-cookie') || '';
            const match = setCookieHeader.match(/xq_a_token=([^;]+)/);
            if (match) cachedXueqiuCookie = `xq_a_token=${match[1]};`;
          }
          currentCookie = currentCookie ? `${currentCookie}; ${cachedXueqiuCookie}` : cachedXueqiuCookie;
        }

        // 🚨 核心修复：严禁全盘透传前端 Headers！
        // 只挑选安全的 Header 透传，绝对不能带入 PWA 的 Origin 和 Host
        const safeHeaders = new Headers();
        const allowedClientHeaders =['content-type', 'authorization', 'x-api-key']; // 移除了 accept，交由下方统一定义
        for (const [key, value] of request.headers.entries()) {
            if (allowedClientHeaders.includes(key.toLowerCase())) {
                safeHeaders.set(key, value);
            }
        }
        
        safeHeaders.set('User-Agent', userAgent);
        if (currentCookie) safeHeaders.set('Cookie', currentCookie);
        if (referer) safeHeaders.set('Referer', referer);

        // 🌟 浏览器指纹模拟：仅设置安全请求头，严禁伪造 Sec-Fetch-* 系列
        // Fetch Metadata Headers (Sec-Fetch-*) 是浏览器自动附加的，服务端代理绝不能设置
        // 伪造这些头会导致目标站点的 WAF (如 Cloudflare) 检测到不一致而拦截请求
        safeHeaders.set('Accept', 'application/json, text/plain, */*');
        safeHeaders.set('Accept-Language', 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
        safeHeaders.set('Cache-Control', 'no-cache');
        safeHeaders.set('Pragma', 'no-cache');

        const fetchOptions = {
          method: request.method,
          headers: safeHeaders
        };

        if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
            fetchOptions.body = request.body;
        }

        return await fetch(new Request(targetUrl, fetchOptions));
      };

      let response = await executeRequest(true);

      if (isXueqiu && (response.status === 400 || response.status === 403)) {
        cachedXueqiuCookie = ''; 
        response = await executeRequest(false); 
      }

      const newResponse = new Response(response.body, response);
      Object.keys(corsHeaders).forEach(key => newResponse.headers.set(key, corsHeaders[key]));

      if (charset === 'GBK') {
         newResponse.headers.set('Content-Type', 'text/plain;charset=GBK');
      } else {
         newResponse.headers.set('Content-Type', 'application/json;charset=UTF-8');
      }

      return newResponse;

    } catch (e) {
      return new Response(JSON.stringify({ error: 'Proxy fetch failed', details: e.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json;charset=UTF-8' }
      });
    }
  },

  // ============================================================================
  // 深度微观结构探测器：聚合多源数据 → 降维为定性信号 → 喂给 AI
  // 不依赖 KV，纯外部 API 聚合
  // ============================================================================
  async fetchMicrostructure() {
    const result = {
      liquidity: {},
      derivatives: {},
      repo_rates: {},
      market_breadth: null,
      overall_signal: ''
    };

    // ── 并行抓取 3 路数据（涨跌家数由大盘雷达注入，此处不重复拉取）──
    // Sina 返回 GBK 编码，必须用 TextDecoder 解码，否则中文乱码导致名称匹配失败
    const fetchSinaGBK = async (url) => {
      const r = await fetch(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } });
      const buf = await r.arrayBuffer();
      return new TextDecoder('gbk').decode(buf);
    };
    const [sinaIndices, sinaFutures, sinaRepo] = await Promise.allSettled([
      fetchSinaGBK('https://hq.sinajs.cn/list=sh000001,sz399001,sh000300,sh000016,sh000905,sh000852,sh000688').catch(() => ''),
      fetchSinaGBK('https://hq.sinajs.cn/list=CFF_RE_IM0,CFF_RE_IF0,CFF_RE_IC0').catch(() => ''),
      fetchSinaGBK('https://hq.sinajs.cn/list=sh204001,sh204007').catch(() => '')
    ]);


    // 1. 回购利率
    if (sinaRepo.status === 'fulfilled' && sinaRepo.value) {
      const lines = sinaRepo.value.split(';').filter(l => l.includes('hq_str_'));
      for (const line of lines) {
        const m = line.match(/var hq_str_\w+="([^"]+)"/);
        if (!m) continue;
        const p = m[1].split(',');
        if (p.length < 6) continue;
        const name = p[0], open = parseFloat(p[1]) || 0, prevClose = parseFloat(p[2]) || 0,
              current = parseFloat(p[3]) || 0, high = parseFloat(p[4]) || 0, low = parseFloat(p[5]) || 0,
              change = current - prevClose;
        result.repo_rates[name] = { name, current, prevClose, high, low, change, open };
        if (name === 'GC001') {
          result.liquidity.ON_rate = current;
          result.liquidity.ON_change_bp = Math.round(change * 100);
          let level = current < 1.5 ? '宽松' : current < 2.0 ? '中性' : current < 2.5 ? '偏紧' : '紧缩';
          if (Math.abs(change) > 0.30) level = change > 0 ? '急剧收紧' : '急剧放松';
          result.liquidity.ON_level = level;
        }
        if (name === 'GC007') {
          result.liquidity.DR007_proxy_rate = current;
          result.liquidity.DR007_change_bp = Math.round(change * 100);
          let level = current < 1.7 ? '宽松' : current < 2.2 ? '中性' : current < 2.8 ? '偏紧' : '紧缩';
          if (Math.abs(change) > 0.30) level = change > 0 ? '急剧收紧' : '急剧放松';
          result.liquidity.DR007_proxy_level = level;
        }
      }
    }

    // 2. 指数现货（仅用于计算基差，不对外输出）
    const spots = {};
    if (sinaIndices.status === 'fulfilled' && sinaIndices.value) {
      const lines = sinaIndices.value.split(';').filter(l => l.includes('hq_str_'));
      for (const line of lines) {
        const m = line.match(/var hq_str_\w+="([^"]+)"/);
        if (!m) continue;
        const p = m[1].split(',');
        if (p.length < 6) continue;
        const name = p[0];
        const key = name.includes('上证综') || name.includes('上证指') ? 'SH' :
                    name.includes('沪深300') ? 'HS300' : name.includes('上证50') ? 'SZ50' :
                    name.includes('中证500') ? 'ZZ500' : name.includes('中证1000') ? 'ZZ1000' :
                    name.includes('科创') ? 'STAR50' : name.includes('深证') ? 'SZ' : null;
        if (key) spots[key] = { current: parseFloat(p[3]) || 0, prevClose: parseFloat(p[2]) || 0,
                                high: parseFloat(p[4]) || 0, low: parseFloat(p[5]) || 0 };
      }
    }

    // 3. 期指基差
    if (sinaFutures.status === 'fulfilled' && sinaFutures.value) {
      const lines = sinaFutures.value.split(';').filter(l => l.includes('hq_str_'));
      for (const line of lines) {
        const m = line.match(/var hq_str_\w+="([^"]+)"/);
        if (!m) continue;
        const p = m[1].split(',');
        if (p.length < 8) continue;
        // 名称在最后几个字段，从后往前扫找包含"股指期货"的中文名
        let name = '';
        for (let j = p.length - 1; j >= Math.max(0, p.length - 6); j--) {
          if (p[j] && /[一-龥]/.test(p[j])) { name = p[j]; break; }
        }
        const settlement = parseFloat(p[1]) || 0,
              vol = parseInt(p[4]) || 0, oi = parseInt(p[6]) || 0;
        const spotKey = name.includes('中证1000') ? 'ZZ1000' : name.includes('沪深300') ? 'HS300' :
                        name.includes('中证500') ? 'ZZ500' : null;
        const futKey  = name.includes('中证1000') ? 'IM' : name.includes('沪深300') ? 'IF' :
                        name.includes('中证500') ? 'IC' : null;
        if (!spotKey || !futKey) continue;
        const spot = spots[spotKey];
        const basis = spot ? settlement - spot.current : null;
        const basisPct = spot && spot.current > 0 ? (basis / spot.current * 100) : null;
        result.derivatives[futKey] = { name, settlement, spotClose: spot?.current || null, basis,
          basisPct: basisPct !== null ? basisPct.toFixed(2) + '%' : null, volume: vol, openInterest: oi };
      }
    }

    // 4. 综合信号 — 纯机器旗标，系统提示做F3熔断匹配（涨跌家数由大盘雷达注入，此处不判定）
    const warnings = [];
    const onLvl = result.liquidity.ON_level || '', d7Lvl = result.liquidity.DR007_proxy_level || '';
    if (onLvl.includes('收紧') || d7Lvl.includes('收紧')) warnings.push('资金面紧缩');
    const imBasis = result.derivatives.IM?.basisPct || null;
    const ifBasis = result.derivatives.IF?.basisPct || null;
    const icBasis = result.derivatives.IC?.basisPct || null;
    if (imBasis && parseFloat(imBasis) < -0.8) warnings.push('IM深度贴水');
    if (ifBasis && parseFloat(ifBasis) < -0.8) warnings.push('IF深度贴水');
    if (icBasis && parseFloat(icBasis) < -0.8) warnings.push('IC深度贴水');

    const tight = onLvl.includes('收紧') || d7Lvl.includes('收紧');
    const loose = onLvl === '宽松' && d7Lvl === '宽松';
    if (warnings.length >= 2) { result.overall_signal = '🚨 fatal'; }
    else if (warnings.length === 1) { result.overall_signal = '⚠️ warn'; }
    else if (loose && !tight) { result.overall_signal = '✅ clear'; }
    else { result.overall_signal = '⚪ neutral'; }
    result.warnings = warnings;
    result.timestamp = new Date().toISOString();
    return result;
  }
};