// Orchestrator - unified AI entry point
// Supports: chat mode (full pipeline) and analysis mode (single-shot)
import { resolveProvider } from './providers';
import { fetchAdvancedMarketData } from './market-data';
import { getDataCache } from './precompute';
import { getAdapter } from './adapters/index';
import { isLightMessage } from './context-router';
import { ContextManager } from './context-manager';
import { downsampleHistory } from './context/history';
import { ToolRegistry } from './tools/registry';
import { runChatPipeline } from './pipelines/chat-pipeline';
import { buildFullSystemPrompt, buildLatestStateWrapper, fullDateTimeStr } from './prompts/index';

export async function orchestratorChat(input) {
  const { settings, portfolioStats, chatHistory, newMessage, marketData, todos, memos, onStatus, firestoreContext } = input;
  const provider = resolveProvider(settings);

  // === Analysis Mode (single-shot, no tool loops) ===
  if (input.analysisMode) {
    const analysisPrompt = input.analysisPrompt || newMessage;
    const analysisSystem = input.analysisSystem || buildFullSystemPrompt();
    const adapter = getAdapter(provider.protocol ? provider : provider.provider);
    const messages = [
      { role: 'system', content: analysisSystem },
      { role: 'user', content: analysisPrompt }
    ];
    try {
      const response = await adapter.sendMessage(messages, {
        settings,
        systemPrompt: analysisSystem,
        toolRegistry: null,
        portfolioStats: portfolioStats || {},
        firestoreContext,
        fullDateTimeStr: fullDateTimeStr()
      });
      if (typeof response === 'string') return response;
      if (response?.data?.choices?.[0]?.message?.content) return response.data.choices[0].message.content;
      if (response?.data?.candidates?.[0]?.content?.parts) {
        return response.data.candidates[0].content.parts.filter(p => p.text).map(p => p.text).join('\n');
      }
      return String(response?.text || response || '');
    } catch (e) {
      console.error('Analysis mode error:', e);
      throw e;
    }
  }

  // === Normal Chat Mode ===
  const systemPrompt = buildFullSystemPrompt();
  const cache = getDataCache(portfolioStats, settings);
  const isLight = isLightMessage(newMessage);
  const radarEnabled = marketData === 'FETCH_NOW';
  let marketStr = '';
  let radarOverride = '';

  if (radarEnabled) {
    // 前置拉取微观结构信号
    let microstructureSignal = '⚪ neutral';
    let microstructureRaw = null; // 保留完整 Worker 响应，供 LLM 查看原始数据
    try {
      const proxyUrl = (settings?.customProxyUrl || '').trim();
      const cfUrl = (settings?.cfWorkerUrl || '').trim();
      const workerUrl = proxyUrl || cfUrl;
      if (workerUrl) {
        const base = workerUrl.split('?')[0].replace(/\/+$/, '');
        const msRes = await fetch(base + '/api/market-microstructure', {
          signal: AbortSignal.timeout(8000),
          headers: settings.workerSecret ? { 'Authorization': `Bearer ${settings.workerSecret}` } : {}
        });
        if (msRes.ok) {
          const msData = await msRes.json();
          microstructureSignal = msData.overall_signal || '⚪ neutral';
          microstructureRaw = msData; // 保留完整数据
        }
      }
    } catch (e) { console.warn('[微观结构] 前置拉取失败:', e.message); }

    onStatus && onStatus({ type: 'thinking', label: '大盘雷达全量扫描中...' });
    marketStr = await fetchAdvancedMarketData(settings, 'full', microstructureSignal, firestoreContext);
    let overnightStr = '';
    try {
      const usUrl = 'https://qt.gtimg.cn/q=us.IXIC,us.INX,us.DJI,us.VIX';
      const usRes = await fetch(usUrl, { cache: 'no-store' });
      if (usRes.ok) {
        const buf = await usRes.arrayBuffer();
        const text = new TextDecoder('gbk').decode(buf);
        const usParts = [];
        (text || '').split(';').filter(l => l.includes('v_')).forEach(line => {
          const arr = line.substring(line.indexOf('="') + 2).split('~');
          if (arr.length < 5) return;
          const name = arr[1], price = parseFloat(arr[3]);
          const pct = parseFloat(arr[32]) || 0;
          if (name && !isNaN(price)) {
            usParts.push(name + ': ' + price.toFixed(2) + ' (' + (pct > 0 ? '+' : '') + pct.toFixed(2) + '%)');
          }
        });
        if (usParts.length > 0) overnightStr = '\n【隔夜外盘参考】\n' + usParts.join('\n') + '\n';
      }
    } catch (e) { console.warn('[外盘] 获取失败:', e.message); }

    // 美10Y / DXY / 美2Y — 国内直连不可达，通过 Worker 代理获取
    let usBondStr = '';
    try {
      const workerBase = ((settings?.customProxyUrl || settings?.cfWorkerUrl || '').trim()).split('?')[0].replace(/\/+$/, '');
      if (workerBase) {
        const bondRes = await fetch(workerBase + '/api/us-treasury', {
          signal: AbortSignal.timeout(8000),
          headers: settings.workerSecret ? { 'Authorization': `Bearer ${settings.workerSecret}` } : {}
        });
        if (bondRes.ok) {
          const bondData = await bondRes.json();
          if (bondData && !bondData.error) {
            usBondStr = `\n【美国利率与美元】\n`;
            if (bondData.us10y != null) usBondStr += `美10Y: ${bondData.us10y.toFixed(2)}%`;
            if (bondData.us2y != null) usBondStr += ` | 美2Y: ${bondData.us2y.toFixed(2)}%`;
            if (bondData.us10y != null && bondData.us2y != null) {
              const spread = (bondData.us10y - bondData.us2y).toFixed(0);
              usBondStr += ` | 2-10利差: ${spread > 0 ? '+' : ''}${spread}bp`;
            }
            if (bondData.dxy != null) usBondStr += ` | 美元指数: ${bondData.dxy.toFixed(2)}`;
            if (bondData.vix != null) usBondStr += ` | VIX: ${bondData.vix.toFixed(1)}`;
            usBondStr += '\n';
          }
        }
      }
    } catch (e) { /* Worker 美债端点暂未部署，静默跳过 */ }

    // 组合回撤检测 — 数据参考，LLM最终裁定
    const currentValue = portfolioStats?.totalCurrentValue || 0;
    const peakValue = portfolioStats?.peakValue || currentValue;
    let drawdownCap = null;
    if (peakValue > 0 && currentValue > 0) {
      const drawdown = (peakValue - currentValue) / peakValue;
      if (drawdown >= 0.15) {
        drawdownCap = { level: '🚨 回撤≥15%', totalEquityCap: 0, message: `组合从峰值回撤${(drawdown*100).toFixed(1)}%，JS建议权益总分≤0（清仓权益）。LLM请结合市场环境自行裁定。` };
      } else if (drawdown >= 0.10) {
        drawdownCap = { level: '🔴 回撤≥10%', totalEquityCap: 15, message: `组合从峰值回撤${(drawdown*100).toFixed(1)}%，JS建议权益总分≤15。LLM请结合市场环境自行裁定。` };
      } else if (drawdown >= 0.08) {
        drawdownCap = { level: '⚠️ 回撤≥8%', totalEquityCap: 25, message: `组合从峰值回撤${(drawdown*100).toFixed(1)}%，JS建议权益总分≤25。此为数据参考，最终裁定权归LLM。` };
      }
      if (drawdownCap) {
        marketStr += `\n\n【组合回撤数据】\n等级: ${drawdownCap.level}\n${drawdownCap.message}\n峰值: ${peakValue.toLocaleString()}元 | 当前: ${currentValue.toLocaleString()}元\n`;
      }
    }

    // 微观结构原始数据注入（LLM 可交叉验证熔断信号）
    if (microstructureRaw) {
      let microRawStr = '\n【微观结构原始数据 — 交叉验证熔断信号】\n';
      const lq = microstructureRaw.liquidity || {};
      microRawStr += `GC001: ${lq.ON_rate?.toFixed(3) ?? '?'}% (${lq.ON_level || '?'}) | GC007: ${lq.DR007_proxy_rate?.toFixed(3) ?? '?'}% (${lq.DR007_proxy_level || '?'})\n`;
      const der = microstructureRaw.derivatives || {};
      for (const [k, v] of Object.entries(der)) {
        microRawStr += `${k}: 结算${v.settlement ?? '?'} | 基差${v.basisPct ?? '?'} | 量${(v.volume||0)}手 仓${(v.openInterest||0)}手\n`;
      }
      microRawStr += `VIX: ${microstructureRaw.vix ?? '?'}\n`;
      microRawStr += `信号: ${microstructureRaw.overall_signal} | 触发: ${(microstructureRaw.warnings||[]).join(', ') || '无'} | 判定: ${microstructureRaw.signal_detail || '?'}`;
      marketStr += microRawStr + '\n';
    }

    radarOverride = '雷达已开启：本轮已注入大盘行情数据。\n\n';
    marketStr = marketStr + overnightStr + usBondStr;
  } else {
    marketStr = marketData;
  }

  const ctxManager = new ContextManager({
    memos, todos, portfolioStats, settings, marketStr,
    cache, radarEnabled, isLight
  });
  const { marketStr: mktOut, memosText, todosContext, activeFundsDetail, alertsText } = ctxManager.build();

  const stateWrapper = buildLatestStateWrapper(
    radarOverride + mktOut, memosText, portfolioStats, settings,
    activeFundsDetail, todosContext, alertsText, newMessage
  );

  const history = downsampleHistory(chatHistory, settings);

  const ctx = {
    provider, settings, systemPrompt, history, stateWrapper,
    toolRegistry: new ToolRegistry(settings),
    portfolioStats, firestoreContext,
    fullDateTimeStr: fullDateTimeStr()
  };

  const adapter = getAdapter(provider.protocol ? provider : provider.provider);
  const result = await runChatPipeline(adapter, ctx, onStatus);
  return result;
}
