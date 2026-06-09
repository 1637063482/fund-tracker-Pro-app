// 工具注册中心 — 统一管理工具定义、handler 映射、执行调度
import { defineTools } from '../tools-definitions';
import { HANDLER_MAP } from './handlers';

export class ToolRegistry {
  constructor(settings) {
    this.settings = settings;
    this._handlers = HANDLER_MAP;
  }

  // 返回 AI 所需的 tools definitions (JSON Schema)
  getDefinitions() {
    return defineTools(this.settings);
  }

  // 检查某个工具是否存在
  has(toolName) {
    return this._handlers.has(toolName);
  }

  // 一次性执行一个工具，结果写入 channel
  async executeOne(toolName, args, toolCallId, ctx, channel) {
    const handler = this._handlers.get(toolName);
    if (!handler) {
      channel.record(toolCallId || toolName, `未知工具: ${toolName}`);
      return;
    }

    try {
      const handlerCtx = {
        ...ctx,
        args,
        toolName,
        toolCallId
      };
      const result = await handler(handlerCtx);
      channel.record(
        toolCallId || toolName,
        result.output || '',
        result.pendingActions || []
      );
    } catch (e) {
      console.error(`❌ [工具执行失败] ${toolName}:`, e);
      channel.record(toolCallId || toolName, `工具执行异常: ${e.message}`);
    }
  }

  // 并行执行一组工具调用
  async executeAll(toolCalls, ctx, channel) {
    const promises = toolCalls.map(tc => {
      const name = tc.function?.name || tc.name;
      let args = {};
      try {
        args = JSON.parse(tc.function?.arguments || tc.args || '{}');
      } catch (e) { /* 忽略解析错误 */ }
      return this.executeOne(name, args, tc.id || name, ctx, channel);
    });
    await Promise.all(promises);
  }
}
