// 编排器 — 收口所有 AI 入口，组合 Adapter + Pipeline + Context
// 流程：解析输入 → 判断轻量/全量 → 获取市场数据 → 构建上下文 → 运行管道
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

  // ── 1. 静态层：System Prompt（messages[0] 永不变化 → DeepSeek 前缀缓存 100% 命中）──
  const systemPrompt = buildFullSystemPrompt();

  // ── 2. 预计算：持仓洞察缓存（同次对话内有效）──
  const cache = getDataCache(portfolioStats, settings);

  // ── 3. 轻量判断：仅问候类 → 零业务注入 ──
  const isLight = isLightMessage(newMessage);

  // ── 4. 市场数据：雷达开启 → 执行 full 深度探针（分时+K线多周期共振）──
  const radarEnabled = marketData === 'FETCH_NOW';
  let marketStr = '';
  let radarOverride = '';

  if (radarEnabled) {
    onStatus && onStatus({ type: 'thinking', label: '📡 大盘雷达全量扫描中…' });
    marketStr = await fetchAdvancedMarketData(settings, 'full');

    // 隔夜外盘 — 纳斯达克/标普500/VIX（A股开盘前美股已收盘，无T+1延迟）
    let overnightStr = '';
    try {
      const usUrl = `https://qt.gtimg.cn/q=us.IXIC,us.INX,us.DJI`;
      const usRes = await fetch(usUrl, { cache: 'no-store' });
      if (usRes.ok) {
        const buf = await usRes.arrayBuffer();
        const text = new TextDecoder('gbk').decode(buf);
        const usParts = [];
        (text || '').split(';').filter(l => l.includes('v_')).forEach(line => {
          const arr = line.substring(line.indexOf('="') + 2).split('~');
          if (arr.length < 5) return;
          const name = arr[1], price = parseFloat(arr[3]);
          const pct = parseFloat(arr[32]) || 0; // API 自带涨跌幅
          if (name && !isNaN(price)) {
            const sigil = pct >= 1 ? '📈' : pct <= -1 ? '📉' : '➡️';
            usParts.push(`${sigil} ${name}: ${price.toFixed(2)} (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)`);
          }
        });
        if (usParts.length > 0) {
          const spxLine = usParts.find(p => p.includes('标普'));
          const ixLine = usParts.find(p => p.includes('纳斯达克'));
          let signal = '';
          const spxPct = parseFloat(spxLine?.match(/([+-]?[\d.]+)%/)?.[1] || 0);
          const ixPct = parseFloat(ixLine?.match(/([+-]?[\d.]+)%/)?.[1] || 0);
          const worstPct = Math.min(spxPct, ixPct);
          if (worstPct < -2) signal = '🚨 美股暴跌>2%,全球Risk-off';
          else if (worstPct < -1) signal = '📉 美股收跌>1%,偏空';
          else if (spxPct > 1) signal = '📈 美股收涨>1%,Risk-on';
          else signal = '➡️ 美股窄幅震荡,中性';
          overnightStr = `\n【隔夜外盘（A股开盘前美股已收盘）】\n${usParts.join('\n')}\n👉 全球信号: ${signal}\n`;
        }
      }
    } catch (e) { console.warn('[外盘] 获取失败:', e.message); }

    // 雷达开启时显式告知 AI 必须基于实时数据全面分析+双核打分
    radarOverride = '🚨 雷达全量开启：本轮已注入完整大盘盘口（日内分时+日K/周K/月K多周期共振）+ 隔夜外盘，你必须基于此实时数据进行全面分析与双核打分。\n\n';
    marketStr = marketStr + overnightStr;
  } else {
    marketStr = marketData; // 已经是纯文本关闭提示
  }

  // ── 5. 上下文构建：isLight 时零业务注入 ──
  const ctxManager = new ContextManager({
    memos, todos, portfolioStats, settings, marketStr,
    cache, radarEnabled, isLight
  });
  const { marketStr: mktOut, memosText, todosContext, activeFundsDetail, alertsText } = ctxManager.build();

  // ── 6. 状态注入 Wrapper（动态数据，放在最后一条 user 消息）──
  const stateWrapper = buildLatestStateWrapper(
    radarOverride + mktOut, memosText, portfolioStats, settings,
    activeFundsDetail, todosContext, alertsText, newMessage
  );

  // ── 7. 历史降采样 ──
  const history = downsampleHistory(chatHistory, settings);

  // ── 8. 组装上下文 → 运行管道 ──
  const ctx = {
    provider,
    settings,
    systemPrompt,
    history,
    stateWrapper,
    toolRegistry: new ToolRegistry(settings),
    portfolioStats,
    firestoreContext,
    fullDateTimeStr: fullDateTimeStr()
  };

  const adapter = getAdapter(provider.provider);
  const result = await runChatPipeline(adapter, ctx, onStatus);
  return result;
}
