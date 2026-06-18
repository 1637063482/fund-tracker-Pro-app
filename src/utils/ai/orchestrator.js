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
    const adapter = getAdapter(provider.provider);
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
    onStatus && onStatus({ type: 'thinking', label: '大盘雷达全量扫描中...' });
    marketStr = await fetchAdvancedMarketData(settings, 'full');
    let overnightStr = '';
    try {
      const usUrl = 'https://qt.gtimg.cn/q=us.IXIC,us.INX,us.DJI';
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
    radarOverride = '雷达全量开启：本轮已注入完整大盘盘口，你必须基于此实时数据进行全面分析与双核打分。\n\n';
    marketStr = marketStr + overnightStr;
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

  const adapter = getAdapter(provider.provider);
  const result = await runChatPipeline(adapter, ctx, onStatus);
  return result;
}
