// AI 工具执行处理器 - 兼容层（旧代码路由 -> 新 tools/handlers）
// @deprecated 所有新代码应直接使用 tools/handlers.js 中的 HANDLER_MAP
// core.js 仍通过 dispatchToolCall 调用，但实际执行已被委托给 tools/handlers.js
import { HANDLER_MAP } from './tools/handlers';
import { debugLog } from '../debugLog';

/** @deprecated 使用 tools/handlers.js 中的 HANDLER_MAP 代替 */
export const dispatchToolCall = async (toolName, ctx) => {
  const handler = HANDLER_MAP.get(toolName);
  if (!handler) {
    console.warn('[Agent] 未知工具调用: ' + toolName);
    ctx.body.messages.push({
      role: 'tool', tool_call_id: ctx.toolCall?.id, name: toolName,
      content: '未知工具: ' + toolName
    });
    return;
  }

  try {
    const handlerCtx = {
      args: ctx.args,
      toolName,
      toolCallId: ctx.toolCall?.id,
      settings: ctx.settings,
      portfolioStats: ctx.portfolioStats,
      firestoreContext: ctx.firestoreContext,
      fullDateTimeStr: ctx.fullDateTimeStr,
      todayStr: ctx.todayStr || new Date().toISOString().split('T')[0]
    };

    const result = await handler(handlerCtx);

    ctx.body.messages.push({
      role: 'tool',
      tool_call_id: ctx.toolCall?.id || ctx.toolCallId,
      name: toolName,
      content: result.output
    });

    if (result.pendingActions && result.pendingActions.length > 0) {
      for (const act of result.pendingActions) {
        ctx.pendingActions.push(act);
      }
    }
  } catch (e) {
    console.error('[工具执行异常] ' + toolName + ':', e);
    ctx.body.messages.push({
      role: 'tool',
      tool_call_id: ctx.toolCall?.id,
      name: toolName,
      content: '工具执行异常: ' + e.message
    });
  }
};
