// 市场行情数据拉取服务：支持腾讯 / 新浪 / 雪球三种数据源
import { ASSET_NAMES, PROXY_NODES } from '../config/constants';

const MARKET_CODES = {
  sh: '000001',
  sz: '399001',
  cy: '399006',
  bond10: '511260',
  bond30: '511090',
};

function buildTargetUrl(dataSource) {
  const { sh, sz, cy, bond10, bond30 } = MARKET_CODES;
  if (dataSource === 'tencent') {
    return `https://qt.gtimg.cn/q=sh${sh},sz${sz},sz${cy},sh${bond10},sh${bond30}`;
  } else if (dataSource === 'sina') {
    return `https://hq.sinajs.cn/list=sh${sh},sz${sz},sz${cy},sh${bond10},sh${bond30}`;
  } else {
    return `https://stock.xueqiu.com/v5/stock/realtime/quotec.json?symbol=SH${sh},SZ${sz},SZ${cy},SH${bond10},SH${bond30}`;
  }
}

function parseXueqiuData(textData) {
  return textData.data.map(item => {
    const codeRaw = item.symbol.toLowerCase();
    return {
      id: codeRaw,
      name: ASSET_NAMES[codeRaw] || '未知资产',
      price: parseFloat(item.current),
      change: parseFloat(item.chg),
      percent: parseFloat(item.percent) / 100
    };
  });
}

function parseTextData(textData, dataSource) {
  const parsed = [];
  const blocks = textData.split(';').filter(b => b.includes('='));

  for (const block of blocks) {
    if (dataSource === 'tencent' && block.includes('v_')) {
      const codeMatch = block.match(/v_([a-z0-9]+)=/);
      if (!codeMatch) continue;
      const code = codeMatch[1];
      const vals = block.split('"')[1]?.split('~');
      if (!vals || vals.length < 33) continue;
      parsed.push({
        id: code, name: ASSET_NAMES[code] || vals[1],
        price: parseFloat(vals[3]), change: parseFloat(vals[31]), percent: parseFloat(vals[32]) / 100
      });
    } else if (dataSource === 'sina' && block.includes('hq_str_')) {
      const codeMatch = block.match(/hq_str_([a-z0-9]+)=/);
      if (!codeMatch) continue;
      const code = codeMatch[1];
      const vals = block.split('"')[1]?.split(',');
      if (!vals || vals.length < 4) continue;
      const currentPrice = parseFloat(vals[3]);
      const prevClose = parseFloat(vals[2]);
      parsed.push({
        id: code, name: ASSET_NAMES[code] || '未知资产',
        price: currentPrice, change: currentPrice - prevClose, percent: prevClose !== 0 ? (currentPrice - prevClose) / prevClose : 0
      });
    }
  }
  return parsed;
}

function sortByAssetOrder(parsedData) {
  const order = Object.keys(ASSET_NAMES);
  parsedData.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return parsedData;
}

export async function fetchMarketService({
  settings,
  activeProxyIndex,
  setMarketData,
  setMarketError,
}) {
  const dataSourceStr = settings.dataSource || 'tencent';
  const targetUrl = buildTargetUrl(dataSourceStr);

  let textData = '';
  let isJsonResp = false;

  if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
    const fetchUrl = settings.customProxyUrl.includes('{{url}}')
      ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl))
      : settings.customProxyUrl + targetUrl;
    const r = await fetch(fetchUrl);
    if (dataSourceStr === 'xueqiu') {
      textData = await r.json();
      isJsonResp = true;
    } else {
      textData = await r.text();
    }
  } else {
    const node = PROXY_NODES[activeProxyIndex];
    if (dataSourceStr === 'xueqiu') {
      const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`);
      const d = await r.json();
      textData = JSON.parse(d.contents);
      isJsonResp = true;
    } else {
      textData = await node.fetcher(targetUrl);
    }
  }

  if (textData) {
    let parsedData;

    if (dataSourceStr === 'xueqiu' && isJsonResp && textData.data) {
      parsedData = parseXueqiuData(textData);
    } else if (typeof textData === 'string') {
      parsedData = parseTextData(textData, dataSourceStr);
    } else {
      parsedData = [];
    }

    if (parsedData.length > 0) {
      sortByAssetOrder(parsedData);
      setMarketData(parsedData);
      setMarketError('');
      return true;
    }
  }
  throw new Error("Invalid data format or empty response");
}
