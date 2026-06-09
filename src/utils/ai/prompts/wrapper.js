// 最新状态注入 Wrapper + 时间函数 + 向后兼容组合 Prompt
import { buildFullSystemPrompt } from './system';

export const fullDateTimeStr = () => new Date().toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  weekday: 'long'
});

export const buildChatSystemPrompt = () => buildFullSystemPrompt();

export const buildLatestStateWrapper = (
  marketStr, memosText, portfolioStats, settings,
  activeFundsDetailCompact, todosContext, alertsText, newMessage
) => {
  const idleFunds = Number(settings.idleFunds) || 0;
  const targetAmount = settings.targetAmount || 0;
  const targetRate = settings.targetAnnualRate || 5;

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 ▸▸▸ 最高优先级：系统强制注入最新状态 ◂◂◂ 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ 致命纪律：立即忽略上方历史对话中的旧数据！只能基于以下【最新客观事实】决策。
现在真实物理时间：${fullDateTimeStr()}

▸▸▸ 第一优先：立即关注的硬数据 ▸▸▸
${alertsText}
${marketStr}
${memosText}

▸▸▸ 第二优先：全局财富目标与全盘快照 ▸▸▸
总目标: ${targetAmount.toLocaleString()} 元 | 基准年化: ${targetRate}% | 剩余: ${portfolioStats.monthsLeft} 个月 | 月需新增: ${portfolioStats.requiredMonthly.toFixed(0)} 元
Alpha: ${(portfolioStats.alpha * 100).toFixed(2)}% | 偏离: ${portfolioStats.deviationAmount >= 0 ? '+' : ''}${portfolioStats.deviationAmount.toFixed(0)} 元
全盘市值: ${Math.round(portfolioStats.totalCurrentValue).toLocaleString()} 元 | 累计盈亏: ${Math.round(portfolioStats.totalProfit).toLocaleString()} 元 | 年化XIRR: ${(portfolioStats.overallXirr * 100).toFixed(2)}% | 简单收益率: ${(portfolioStats.overallSimpleReturn * 100).toFixed(2)}% | 空闲子弹: ${idleFunds.toLocaleString()} 元

▸▸▸ 第三优先：持仓明细 ▸▸▸
⚠️ 份额为系统记录值（有微小舍入误差），可用于估算但非精确值。
⚠️ 表格中的市值/盈亏率为快照，严禁用于：
  · 反推基金净值（净值=市值÷份额 不准）
  · 将快照盈亏率当作实时数据
  · 计算日收益（需调工具获取T日和T-1日净值后套公式：(T日净值-T-1日净值)×份额）
  凡涉净值 → 必须调用 get_realtime_fund_data / get_batch_fund_data / get_fund_history_data
  ⚠短 = 持有<30天份额有赎回费 | 无标记 = 无赎回费问题
${activeFundsDetailCompact}

▸▸▸ 第四优先：交易计划池 ▸▸▸
${todosContext}

▸▸▸ 防重防漏与资金风控 ▸▸▸
1. 拦截重复建仓（允许网格交易）。
2. 空闲资金评估前必须【先扣除】待办中排队买入金额。
3. ⚠️短 标记的持仓存在<30天赎回费陷阱 → 卖出前列出预估赎回费。预期跌幅<赎回费率 → 禁止卖出。
4. 交易日历：周末及法定节假日不交易。公募赎回 T+2 至 T+4 到账。
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▸▸▸ 用户最新指令 ▸▸▸
${newMessage}

👉 若需修改备忘录/增删改待办/画图/记账，必须触发对应的 Tool Call 接口！
`;
};
