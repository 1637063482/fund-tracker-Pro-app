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

    const url = new URL(request.url);
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

        // 🌟 核心修复 2：注入强力仿生指纹，绕过金融 WAF 对机房 IP 的封锁
        safeHeaders.set('Accept', 'application/json, text/plain, */*');
        safeHeaders.set('Accept-Language', 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
        safeHeaders.set('Cache-Control', 'no-cache');
        safeHeaders.set('Pragma', 'no-cache');
        // 模拟现代浏览器的 Fetch Metadata
        safeHeaders.set('Sec-Fetch-Dest', 'empty');
        safeHeaders.set('Sec-Fetch-Mode', 'cors');
        safeHeaders.set('Sec-Fetch-Site', 'same-site');

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
  }
};