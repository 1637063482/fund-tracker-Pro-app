// 基金净值拉取服务：支持天天基金（盘中估值）/ 新浪财经 / 天天历史 / 蛋卷基金四种数据源
export async function fetchFundNavService({
  codeToFetch = null,
  funds,
  fundNavs,
  settings,
  setFundNavs,
  setFetchingNavCodes,
}) {
  let codesToQuery = [];
  if (codeToFetch) {
    codesToQuery.push(codeToFetch);
    setFetchingNavCodes(prev => ({ ...prev, [codeToFetch]: true }));
  } else {
    codesToQuery = funds.filter(f => f.mode === 'auto' && !f.isArchived && f.fundCode).map(f => f.fundCode);
  }

  if (codesToQuery.length === 0) return false;
  codesToQuery = [...new Set(codesToQuery)];
  const newNavs = { ...fundNavs };
  let hasChanges = false;
  let fetchSuccess = false;
  const currentDataSource = settings.navDataSource || 'tiantian';

  const fetchViaProxy = async (targetUrl) => {
    let fetchUrl = '';
    if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
      fetchUrl = settings.customProxyUrl.includes('{{url}}')
        ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl))
        : settings.customProxyUrl + targetUrl;
    } else {
      fetchUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    }
    return await fetch(fetchUrl);
  };

  for (const code of codesToQuery) {
    try {
      const fundObj = funds.find(f => f.fundCode === code);
      const fallbackName = fundNavs[code]?.name || fundObj?.name || '未知名称';

      if (currentDataSource === 'tiantian') {
        const result = await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.referrerPolicy = "no-referrer";
          script.charset = "utf-8";
          const timer = setTimeout(() => { script.remove(); reject(new Error('Timeout')); }, 8000);

          script.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;

          script.onload = () => {
            clearTimeout(timer);
            script.remove();
            resolve();
          };
          script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('加载失败')); };

          const originalCallback = window.jsonpgz;
          window.jsonpgz = (data) => {
            if (data && data.fundcode === code) {
              const actualNav = parseFloat(data.dwjz);
              if (!isNaN(actualNav)) {
                const dateStr = data.gztime ? data.gztime.substring(5, 16) : (data.jzrq || '');
                resolve({ nav: actualNav, name: data.name, source: '天天(盘中估值)', date: dateStr });
              } else {
                reject(new Error('无实际净值数据'));
              }
            }
            if (originalCallback) originalCallback(data);
          };

          document.head.appendChild(script);
        });

        if (result && !isNaN(result.nav)) {
          newNavs[code] = { nav: result.nav, name: result.name, source: result.source, date: result.date };
          hasChanges = true;
          fetchSuccess = true;
        }
      } else if (currentDataSource === 'sina') {
        const targetUrl = `https://hq.sinajs.cn/list=f_${code}`;
        const res = await fetchViaProxy(targetUrl);

        const buffer = await res.arrayBuffer();
        const decoder = new TextDecoder('gbk');
        const text = decoder.decode(buffer);
        const match = text.match(new RegExp(`hq_str_f_${code}="([^"]*)";`));
        if (match && match[1]) {
          const parts = match[1].split(',');
          const currentNav = parseFloat(parts[1]);

          if (!isNaN(currentNav)) {
            const dateStr = parts[4] ? parts[4].substring(5) : '';
            newNavs[code] = { nav: currentNav, name: parts[0], source: '新浪财经', date: dateStr };
            hasChanges = true;
            fetchSuccess = true;
          }
        }
      } else if (currentDataSource === 'tiantian_lsjz') {
        const targetUrl = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`;
        const res = await fetchViaProxy(targetUrl);
        const data = await res.json();
        const navStr = data?.Data?.LSJZList?.[0]?.DWJZ;
        if (navStr) {
          const nav = parseFloat(navStr);
          if (!isNaN(nav)) {
            const dateStr = data?.Data?.LSJZList?.[0]?.FSRQ?.substring(5) || '';
            newNavs[code] = { nav, name: fallbackName, source: '天天(Web历史)', date: dateStr };
            hasChanges = true; fetchSuccess = true;
          }
        }
      } else if (currentDataSource === 'danjuan') {
        const targetUrl = `https://danjuanfunds.com/djapi/fund/${code}`;
        const res = await fetchViaProxy(targetUrl);
        const data = await res.json();
        const nav = parseFloat(data?.data?.fund_derived?.unit_nav);
        const name = data?.data?.fd_name || fallbackName;
        if (!isNaN(nav)) {
          const dateStr = data?.data?.fund_derived?.end_date?.substring(5) || '';
          newNavs[code] = { nav, name, source: '蛋卷基金', date: dateStr };
          hasChanges = true; fetchSuccess = true;
        }
      }

    } catch (e) {
      console.warn(`拉取基金 ${code} 净值失败 (${currentDataSource}):`, e);
    }
  }

  if (hasChanges) {
    setFundNavs(newNavs);
  }

  if (codeToFetch) {
    setFetchingNavCodes(prev => ({ ...prev, [codeToFetch]: false }));
    return fetchSuccess ? newNavs[codeToFetch] : false;
  }
  return fetchSuccess;
}
