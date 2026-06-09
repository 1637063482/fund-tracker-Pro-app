// 聊天对话管道 — 使用 Adapter + ToolRegistry 驱动工具循环
import { ToolResultChannel } from '../tools/channel';
import { estimateTokens } from '../providers/shared';
import { debugLog } from '../../debugLog';

const TOOL_LABELS_MAP = {
  'get_realtime_fund_data': '📊 读取实时净值',
  'get_batch_fund_data': '📊 批量拉取基金数据',
  'get_fund_history_data': '📈 回溯历史走势',
  'get_fund_comparison': '⚖️ 多维度对比分析',
  'get_financial_news': '📰 速览财经快讯',
  'google_macro_search': '🌐 检索宏观政策',
  'tavily_news_search': '🔍 搜索相关资讯',
  'exa_research': '📚 研读深度研报',
  'get_fund_holdings_penetration': '🔬 透视底层持仓',
  'get_fund_transaction_history': '🧾 查阅交易流水',
  'get_market_historical_intraday': '📉 加载 K 线数据',
  'generate_trend_chart': '🎨 渲染走势图表',
  'execute_javascript': '⚡ 执行量化演算',
  'update_ledger': '📝 记录交易明细',
  'manage_plan_todo': '✅ 同步交易计划',
  'update_decision_memo': '🗂️ 更新战略备忘',
  'update_fof_dictionary': '📖 维护 FOF 字典',
  'get_index_valuation': '📊 评估指数估值',
  'get_cross_asset_data': '🌍 加载跨资产全景',
  'get_bond_market_data': '🏦 解析债市数据',
  'get_macro_data': '📡 采集宏观指标',
  'get_recent_scores': '📋 查询历史打分',
  'store_scoring_snapshot': '💾 保存打分快照',
};

function _truncate(s, maxLen) {
  if (!s) return '(空)';
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen) + '…';
}

export async function runChatPipeline(adapter, ctx, onStatus) {
  const request = adapter.buildRequest(ctx);
  const maxLoops = ctx.settings.maxToolLoops || 12;
  const allPendingActions = [];
  let accumulatedReasoning = '';
  let accumulatedContent = '';
  let roundNum = 0;

  const handlerCtx = {
    settings: ctx.settings,
    portfolioStats: ctx.portfolioStats,
    firestoreContext: ctx.firestoreContext,
    fullDateTimeStr: ctx.fullDateTimeStr,
    todayStr: new Date().toISOString().split('T')[0]
  };

  debugLog('%c🚀 [Pipeline] 启动 | adapter=' + adapter.provider + ' | maxLoops=' + maxLoops + ' | tools=' + ctx.toolRegistry.getDefinitions().length, 'color: #6366f1; font-weight: bold;');
  const estInput = estimateTokens(request.body);
  debugLog('%c📊 [Pipeline] 初始输入 ≈' + estInput + ' tok | sys=' + ctx.systemPrompt.length + ' chars | wrapper=' + ctx.stateWrapper.length + ' chars | history=' + ctx.history.length + ' msgs', 'color: #6366f1;');

  onStatus && onStatus({ type: 'thinking', label: '🧠 深度思考中…' });

  // 首次执行
  let data = await adapter.executeOnce(request);

  // 主工具循环
  while (adapter.hasToolCalls(data) && roundNum < maxLoops) {
    roundNum++;

    // 提取本轮文本和推理
    const text = adapter.parseText(data);
    const reasoning = adapter.parseReasoning(data);
    if (text) accumulatedContent += text + '\n\n';
    if (reasoning) accumulatedReasoning += reasoning + '\n\n';

    // 本轮思考过程 — 完整输出，用于调试审查
    if (reasoning) {
      console.groupCollapsed('%c🧠 [R' + roundNum + '] 思考过程 ' + reasoning.length + ' chars', 'color: #a78bfa; font-weight: bold;');
      console.log(reasoning);
      console.groupEnd();
    }
    if (text) {
      console.groupCollapsed('%c💬 [R' + roundNum + '] 中间文本 ' + text.length + ' chars', 'color: #c4b5fd; font-weight: bold;');
      console.log(text);
      console.groupEnd();
    }

    // 提取工具调用
    const rawToolCalls = adapter.extractToolCalls(data);
    debugLog('%c🔧 [R' + roundNum + '] 触发 ' + rawToolCalls.length + ' 个工具调用:', 'color: #f59e0b; font-weight: bold;');

    for (const tc of rawToolCalls) {
      const label = TOOL_LABELS_MAP[tc.name] || '⚙️ ' + tc.name;
      const argsPreview = _truncate(JSON.stringify(tc.args), 200);
      debugLog('  ' + label + ' | ' + tc.name + '(' + argsPreview + ')');
    }

    const toolCalls = rawToolCalls.map(tc => ({
      id: tc.id,
      function: { name: tc.name, arguments: JSON.stringify(tc.args) }
    }));

    // UI 状态通知
    for (const tc of rawToolCalls) {
      const label = TOOL_LABELS_MAP[tc.name] || `⚙️ ${tc.name}`;
      onStatus && onStatus({ type: 'tool', label, tool: tc.name, round: roundNum });
    }

    // 并行执行所有工具
    const channel = new ToolResultChannel();
    await ctx.toolRegistry.executeAll(toolCalls, handlerCtx, channel);

    // 记录工具结果 — 过长时折叠
    for (const tc of rawToolCalls) {
      const result = channel.get(tc.id);
      if (result.length > 500) {
        console.groupCollapsed('%c  ✅ ' + tc.name + ' → ' + result.length + ' chars', 'color: #10b981; font-weight: bold;');
        console.log(result);
        console.groupEnd();
      } else {
        debugLog('%c  ✅ ' + tc.name + ' → ' + result.substring(0, 500), 'color: #10b981;');
      }
    }

    allPendingActions.push(...channel.getPendingActions());

    // 将工具结果写入请求 body 供下一轮
    adapter.applyToolResults(request.body, channel, data);

    // Token 预估日志
    const estTokens = estimateTokens(request.body);
    debugLog('%c📊 [R' + roundNum + '] Token ≈' + estTokens + ' | 累积文本=' + accumulatedContent.length + ' chars | 累积推理=' + accumulatedReasoning.length + ' chars', 'color: #10b981; font-weight: bold;');

    // 下一轮
    if (roundNum < maxLoops) {
      onStatus && onStatus({ type: 'thinking', label: `🧠 综合研判 · R${roundNum + 1}…`, round: roundNum + 1 });
      data = await adapter.executeOnce(request);
    }
  }

  // 最终轮文本（无工具调用）
  const finalText = adapter.parseText(data);
  const finalReasoning = adapter.parseReasoning(data);
  if (finalText) accumulatedContent += finalText;
  if (finalReasoning) accumulatedReasoning += finalReasoning;

  if (finalReasoning) {
    console.groupCollapsed('%c🧠 [最终] 思考过程 ' + finalReasoning.length + ' chars', 'color: #a78bfa; font-weight: bold;');
    console.log(finalReasoning);
    console.groupEnd();
  }

  debugLog('%c🏁 [Pipeline] 完成 | 总轮次=' + roundNum + ' | 输出=' + accumulatedContent.length + ' chars | 推理=' + accumulatedReasoning.length + ' chars | pendingActions=' + allPendingActions.length, 'color: #06b6d4; font-weight: bold;');

  // 完整输出到 console（不截断）
  if (accumulatedContent.trim()) {
    console.groupCollapsed('%c📝 [Pipeline] 完整输出 ' + accumulatedContent.length + ' chars', 'color: #06b6d4; font-weight: bold;');
    console.log(accumulatedContent);
    console.groupEnd();
  }

  if (allPendingActions.length > 0) {
    debugLog('%c📋 [Pipeline] 待处理操作: ' + allPendingActions.length + ' 条', 'color: #f59e0b;');
    for (const act of allPendingActions) {
      debugLog('  - ' + (act.toolType || '?') + ': ' + _truncate(JSON.stringify({ fundCode: act.fundCode, fundName: act.fundName, actionType: act.actionType, amount: act.amount }), 150));
    }
  }

  return {
    data,
    text: accumulatedContent,
    reasoning: accumulatedReasoning,
    pendingActions: allPendingActions,
    roundNum
  };
}
