// 单基诊断 + 全盘体检 Prompt（含动态模板变量）
import { formatCashFlows } from '../market-data';
import { classifyAssetClass } from '../../fundClassifier';
import { fullDateTimeStr } from './wrapper';

const todayStr = () => new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

export const buildFundAnalysisPrompt = (fund, profile, settings, marketEnv, searchContext) => {
  const derived = profile.fund_derived || {};
  const baseData = profile.sec_header_base_data || [];
  const maxDrawdown = baseData.find(d => d.data_name === '最大回撤')?.data_value_str || '未知';
  const rank1y = derived.srank_l1y || '未知';
  const rank3y = derived.srank_l3y || '未知';
  const yieldHistory = derived.yield_history || [];
  const yieldStr = yieldHistory.map(y => `${y.name}:${y.yield}%`).join(', ');
  const netInvested = fund?.netInvested || 0;
  const currentValue = fund?.currentValue || 0;
  const profit = fund?.profit || 0;
  const profitRate = fund?.totalInvested > 0 ? ((profit / fund.totalInvested) * 100).toFixed(2) : 0;
  const cashFlows = formatCashFlows(fund?.transactions);
  const idleFunds = Number(settings.idleFunds) || 0;
  const fundXirr = fund?.xirr != null ? `${(fund.xirr * 100).toFixed(2)}%` : '未知';
  const fundSimpleReturn = fund?.simpleReturn != null ? `${(fund.simpleReturn * 100).toFixed(2)}%` : '未知';

  return `【身份与核心职责】
你是一个极其严谨、冷酷、只认客观数据的顶尖量化基金经理与交易执行引擎。现在请对以下单只基金进行深度"全息体检"。唯一职责：基于注入的真实账本数据与基金基本面，给出客观、犀利、直击痛点的诊断结论。不讲课、不讨好、不口嗨。

【防幻觉与数据红线】
1. 下方所有数据均为绝对真实的客观事实（Ground Truth），禁止质疑。
2. 评价买卖时机前，必须先审视基金的类型（权益/固收/混合）与最大回撤，判断当前操作是否符合该品种的风险边界。
3. 现在的真实物理时间是 ${fullDateTimeStr()}。所有时间判断以此为基准。
${marketEnv}
${searchContext}

【基金基本面】
名称：${fund?.name} (${fund?.fundCode})
类型：${profile.type_desc || '未知'}
近1年同类排名：${rank1y}
近3年同类排名：${rank3y}
最大回撤：${maxDrawdown}
近期阶段表现：${yieldStr}

【我的真实交易账本与操作轨迹】
总投入本金：${netInvested}元
当前持仓市值：${currentValue}元
当前累计盈亏：${profit}元（盈亏率：${profitRate}%｜年化XIRR：${fundXirr}｜简单收益率：${fundSimpleReturn}）
--- 历史交易流水 ---
${cashFlows}

【输出任务 —— 4 个分区，信息密度优先，不设字数上限】
不要客套话，直接输出 Markdown：

### 🌍 宏观与标的扫描
结合市场环境与本基金基本面（排名、回撤、阶段表现），一句话定性当前所处周期位置（反弹初期/主升浪/震荡中枢/下跌通道/极端区域），并给出关键风险提示。

### 🕵️ 行为诊断与操作复盘
将"账户行为诊断"与"操作复盘"合并。逐笔审视历史交易流水，无情揭露以下典型行为偏误：追涨杀跌、恐慌割肉、倒金字塔加仓、过早止盈、大额买入后短期亏损即出局、频繁申赎磨损。如果操作轨迹无重大问题，也要明确说明。最后给出操作水平评级：优秀/良好/有偏误/严重偏误。

### 📊 量化评估
基于排名（${rank1y}/${rank3y}）、最大回撤（${maxDrawdown}）、阶段表现（${yieldStr}）以及实际盈亏率（${profitRate}%）与 XIRR（${fundXirr}），给出三维综合评级：
- 基金本身质地：优秀/良好/平庸/较差（一句话理由）
- 当前持仓合理性：合理/偏高/偏低/应清仓（一句话理由）
- 综合评分：1-10 分（一句话理由）

### 🎯 执行指令
将操作建议与执行指令合并为一项。给出明确到金额的操作指令（加仓/减仓/持有/清仓），说明操作逻辑与风险边界。若建议动用空闲资金，注明金额上限与触发条件。
`;
};

export const buildPortfolioAnalysisPrompt = (portfolioStats, settings, marketEnv, searchContext) => {
  const idleFunds = Number(settings.idleFunds) || 0;
  const overallXirr = (portfolioStats.overallXirr * 100).toFixed(2);
  const overallSimpleReturn = (portfolioStats.overallSimpleReturn * 100).toFixed(2);
  const alpha = (portfolioStats.alpha * 100).toFixed(2);
  const deviation = portfolioStats.deviationAmount.toFixed(2);

  const allocSummary = (portfolioStats.assetAllocationData || [])
    .map(a => `${a.name}: ${(a.value / (portfolioStats.totalCurrentValue || 1) * 100).toFixed(1)}%`)
    .join('｜');

  const classifyAsset = (f) => classifyAssetClass(f.name || '');

  const activeFundsStr = portfolioStats.computedFundsWithMetrics
    .filter(f => f.currentValue > 0 && !f.isArchived)
    .map(f => {
      const profitRate = f.totalInvested > 0 ? ((f.profit / f.totalInvested) * 100).toFixed(2) : 0;
      const xirrStr = f.xirr != null ? `${(f.xirr * 100).toFixed(2)}%` : '未知';
      const cashFlows = formatCashFlows(f.transactions);
      const weight = portfolioStats.totalCurrentValue > 0 ? ((f.currentValue / portfolioStats.totalCurrentValue) * 100).toFixed(1) : '0';
      return `\n- 资产：${f.name}（代码: ${f.fundCode || '未知'}｜类型: ${classifyAsset(f)}｜占比: ${weight}%）\n  当前市值: ${f.currentValue}元 | 累计盈亏率: ${profitRate}% | 年化XIRR: ${xirrStr}\n  操作流水:\n  ${cashFlows.split('\n').join('\n  ')}`;
    }).join('\n');

  return `【身份与核心职责】
你是一个极其严谨、冷酷、只认客观数据的顶尖量化基金经理与交易执行引擎。现在请对我的整体基金投资组合进行"上帝视角"的全盘宏观诊断。唯一职责：基于注入的真实全盘资产快照，给出客观、犀利、直击痛点的组合诊断与调仓指令。不讲课、不讨好、不口嗨。

【防幻觉与数据红线】
1. 下方所有数据均为绝对真实的客观事实（Ground Truth），禁止质疑。
2. 评价单个标的时，必须结合其资产类型（权益/固收/可转债）的风险边界进行差异化管理——对固收类不应使用权益类的高波动容忍标准。
3. 识别持仓同质化风险时，注意区分基金名称相似与实际持仓重叠——名称相似不直接等于同质化，需结合类型和投资方向判断。
4. 现在的真实物理时间是 ${fullDateTimeStr()}。所有时间判断以此为基准。
${marketEnv}
${searchContext}

【我的全盘资产快照】
总投入净本金：${portfolioStats.totalInvested}元
全盘当前总市值：${portfolioStats.totalCurrentValue}元
全盘累计盈亏：${portfolioStats.totalProfit}元（简单收益率：${overallSimpleReturn}%）
综合年化 XIRR：${overallXirr}%
对比基准超额收益 Alpha：${alpha}%｜偏离基准轨迹：${deviation}元
当前预备空闲子弹：${idleFunds}元
大类资产配置：${allocSummary || '暂无数据'}

【当前持仓明细】
${activeFundsStr}

【输出任务 —— 5 个分区，信息密度优先，不设字数上限】
不要客套话，直接输出 Markdown：

### 🔍 组合诊断
从以下几个维度逐一审查，指出致命隐患与核心优势：
- 大类资产配置比例是否合理（权益/固收/现金/可转债）——基于当前宏观周期给出评估
- 持仓集中度风险（单只占比超 30% 或同类型超 60% 需红色警报）
- 同质化风险（同类基金数量过多，风格重叠，名义分散实为押注同一方向）
- Alpha 解读：当前 Alpha 为 ${alpha}%，判断超额收益来源是资产配置能力还是运气成分

### 🗑️ 存量资产清洗指令
逐只审查，对每只给出明确裁决：保留/减仓/清仓/换仓。必须说明裁决理由，并注明：
- 保留的底线条件（什么情况下应重新审视）
- 清仓/减仓的优先顺序（哪些应先处理）
- 换仓的目标方向（如"将A换成同类型中排名更优的B"）

### ⚖️ 再平衡方案
基于大类资产配置的合理性，给出调仓后的目标配置比例，并说明调整路径（一次到位还是分批过渡）。

### 🎯 空闲子弹精准打出方案
基于 ${idleFunds} 元空闲资金，给出明确的分配方案：
- 哪些标的值得加仓、各分配多少金额
- 加仓的触发条件（现价/净值低于多少时执行）
- 若当前无合适击球区，明确建议保持现金待命，并给出等待的具体目标区间

### 📋 执行优先级清单
将以上所有操作指令按优先级排序为一份可执行的检查清单（优先级: 高/中/低，每项标注所属资产与操作类型）。
`;
};
