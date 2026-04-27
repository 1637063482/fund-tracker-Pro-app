// 格式化现金流数据的辅助函数
const formatCashFlows = (transactions) => {
  if (!transactions || transactions.length === 0) return "无交易记录";
  const sorted =[...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
  return sorted.map(t => {
    let action = '操作';
    if (t.type === 'buy') action = '买入建仓/加仓';
    if (t.type === 'sell') action = '卖出提现/减仓';
    if (t.type === 'dividend_cash') action = '现金分红';
    if (t.type === 'dividend_reinvest') action = '红利再投';
    if (t.type === 'fee') action = '扣除手续费';
    return `- ${t.date}：${action} ${t.amountRaw} 元`;
  }).join('\n');
};

export const analyzeFundWithAI = async (settings, fund, profile, marketData) => {
  const provider = settings.aiProvider || 'gemini';
  
  let apiKey = '';
  let targetModel = '';
  if (provider === 'gemini') {
      apiKey = settings.geminiApiKey;
      targetModel = settings.geminiModel || 'gemini-2.5-pro';
  } else if (provider === 'deepseek') {
      apiKey = settings.deepseekApiKey;
      targetModel = settings.deepseekModel || 'deepseek-chat';
  } else if (provider === 'siliconflow') {
      apiKey = settings.siliconflowApiKey;
      targetModel = settings.siliconflowModel || 'deepseek-ai/DeepSeek-V3';
  }

  if (!apiKey) throw new Error(`请先在设置中配置 ${provider.toUpperCase()} 的 API Key`);

  const shIndex = marketData.find(m => m.id === 'sh000001');
  const marketEnv = shIndex 
    ? `今天上证指数表现：${shIndex.change > 0 ? '+' : ''}${(shIndex.percent * 100).toFixed(2)}%。` 
    : '大盘数据未获取。';

  const derived = profile.fund_derived || {};
  const baseData = profile.sec_header_base_data ||[];
  const maxDrawdown = baseData.find(d => d.data_name === '最大回撤')?.data_value_str || '未知';
  const rank1y = derived.srank_l1y || '未知';
  const rank3y = derived.srank_l3y || '未知';
  const yieldHistory = derived.yield_history ||[];
  const yieldStr = yieldHistory.map(y => `${y.name}:${y.yield}%`).join(', ');
  
  const netInvested = fund?.netInvested || 0;
  const currentValue = fund?.currentValue || 0;
  const profit = fund?.profit || 0;
  const profitRate = fund?.totalInvested > 0 ? ((profit / fund.totalInvested) * 100).toFixed(2) : 0;
  const cashFlowStr = formatCashFlows(fund?.transactions);
  // 【新增】获取当前动态物理日期
  const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const idleFunds = Number(settings.idleFunds) || 0;

  const prompt = `
你是一位拥有30年经验的华尔街顶尖宏观策略与量化分析师，以"客观、犀利、直击痛点"著称。现在请为我的这笔单只基金投资进行深度的"全息体检"。

【分析前置要求 (极其重要)】
现在的真实物理时间是 ${todayStr}。在回答前，请务必结合你的最新知识库(如果是Gemini请强制使用Google Search获取最新资讯)：
1. 宏观资产温度与历史纵深：不仅要关注当下的异动，请务必结合 A股(上证/沪深300)、美股、黄金等核心资产【近3个月、近半年、近1年】的中长线走势趋势，评估当前处于反弹初期、主升浪还是下跌通道。
2. 标的雷达：这只基金（${fund?.name}）近期是否有重要新闻，或其所属核心板块近期的政策/行业利好利空。

【基金基本面】
名称：${fund?.name} (${fund?.fundCode})
类型：${profile.type_desc || '未知'}
近1年同类排名：${rank1y}
近3年同类排名：${rank3y}
最大回撤：${maxDrawdown}
近期阶段表现：${yieldStr}

【我的真实交易账本与操作轨迹】
总投入本金：${netInvested} 元
当前持仓市值：${currentValue} 元
当前累计盈亏：${profit} 元 (盈亏率: ${profitRate}%)
--- 历史操作轨迹 ---
${cashFlowStr}

【你的输出任务】
不要输出任何客套话。请结合你的检索结果、基金基本面，以及**重点剖析我的历史操作轨迹**，使用 Markdown 输出以下几部分（字数必须充足，展开详细分析，500字左右）：
### 🌍 宏观与标的实时扫描 (一针见血指出大环境利弊)
### 🕵️ 账户行为诊断 (评价我的建仓/加减仓时机是否合理，是否追高杀跌)
### 💡 极简操作建议 (结合当前浮盈/浮亏，明确给出：继续持有/分批定投/果断止损/逢高止盈的建议)
### 🕵️ 操作复盘与现状诊断(直接锐评这只基金现在的死活状态，以及我之前的买卖操作是不是在乱来、追涨杀跌。)
### 🎯 当前标的执行指令(明确告诉我这只基金现在该怎么办。如果该止损，告诉我是全抛还是减半；如果该继续持有，说明理由。)
### 💰 【${idleFunds}元】空闲资金利用建议(如果该基金跌出了黄金坑且质量优秀，请明确告诉我从这 ${idleFunds} 元里抽出多少钱来补仓。如果不值得补仓，请直接推荐一只更适合当前大盘的、带有具体6位数代码的替代基金，并告诉我买入多少。)
`;

  return await executeAIRequest(provider, apiKey, targetModel, prompt);
};

export const analyzePortfolioWithAI = async (settings, portfolioStats) => {
  const provider = settings.aiProvider || 'gemini';
  
  let apiKey = '';
  let targetModel = '';
  if (provider === 'gemini') {
      apiKey = settings.geminiApiKey;
      targetModel = settings.geminiModel || 'gemini-2.5-pro';
  } else if (provider === 'deepseek') {
      apiKey = settings.deepseekApiKey;
      targetModel = settings.deepseekModel || 'deepseek-chat';
  } else if (provider === 'siliconflow') {
      apiKey = settings.siliconflowApiKey;
      targetModel = settings.siliconflowModel || 'deepseek-ai/DeepSeek-V3';
  }

  if (!apiKey) throw new Error(`请先在设置中配置 ${provider.toUpperCase()} 的 API Key`);

  const activeFunds = portfolioStats.computedFundsWithMetrics
    .filter(f => f.currentValue > 0 && !f.isArchived)
    .map(f => {
       const profitRate = f.totalInvested > 0 ? ((f.profit / f.totalInvested) * 100).toFixed(2) : 0;
       const cashFlows = formatCashFlows(f.transactions);
       // 【修复】加上 fund.fundCode，防止出现"暂无代码"
       return `\n- 资产：${f.name} (代码: ${f.fundCode || '未知'})\n  当前市值: ${f.currentValue}元 | 累计盈亏率: ${profitRate}% | 资产类型: ${f.name.includes('债') ? '固收' : '权益/其他'}\n  操作流水:\n  ${cashFlows.split('\n').join('\n  ')}`;
    })
    .join('\n');
    
  // 【关键修复】将这两个变量的声明移到了反引号字符串的外部！
  const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const idleFunds = Number(settings.idleFunds) || 0;

  const prompt = `
你是一位面向高净值客户的首席资产配置官(CIO)。请对我的整体基金投资组合进行"上帝视角"的宏观诊断。

【分析前置要求 (极其重要)】
现在的真实物理时间是 ${todayStr}。在回答前，请务必结合你的知识库和实时搜索当下的全球宏观周期：
1. 梳理全球核心资产（中美股市、大宗商品）在【近3个月、近半年、近1年】的大周期趋势。
2. 结合美联储最新降息/加息预期、中美股市的核心矛盾等宏观指标，判断当前处于"风险偏好上升"还是"防御为主"的阶段。
3. 【无情鞭挞与客观诊断】：请作为独立客观的第三方进行评估！仔细阅读我的【操作流水】，不要因为我近期有大额加仓操作，就当老好人建议“继续观察”。如果我加仓的是长期跑输、毫无前景的劣质资产，或者是在高位追涨，请毫不留情地指出我的错误操作，并果断建议调仓止损！只有标的本身优质且处于底部时，才建议继续持有。

【我的全盘资产快照】
总投入净本金：${portfolioStats.totalInvested} 元
全盘当前总市值：${portfolioStats.totalCurrentValue} 元
全盘累计盈亏：${portfolioStats.totalProfit} 元
综合年化收益率(XIRR)：${(portfolioStats.overallXirr * 100).toFixed(2)}%
当前预备空闲资金(子弹)：${idleFunds} 元


【当前持仓明细与比重】
${activeFunds}

【你的输出任务】
请跳过所有晦涩的宏观金融术语，直接给我一份"傻瓜式"的、极其明确的执行清单。注意：对于带有【🌟新近建仓观察期】标签的资产，属于近期刚买入。使用 Markdown 格式输出以下三部分（500字左右）：

### 🔍 组合致命隐患与优势
(用最直白的语言告诉我，目前的持仓结构最大的危险是什么？是过于集中某个赛道，还是股债配比失衡？)

### 🗑️ 存量资产清洗指令
(明确点名：现有持仓中，哪几只必须果断清仓止损？哪几只可以逢高止盈？哪几只继续躺平？)

### 🎯 【${idleFunds}元】空闲子弹精准打出方案 (极其重要)
(必须给出一份精确到具体金额的配置清单！
1. 如果建议加仓现有基金，请直接写明加仓金额。
2. 如果我的组合缺乏防守、红利或海外对冲资产等等，**请你务必直接推荐市场上优质的具体基金名称，并必须附上6位数的基金代码**（例如：建议分配 3000元 买入 黄金ETF 518880，2000元 买入 纳指ETF 513100）。
3. 绝不允许只给“建议配置债券”这种模糊废话，必须精确到基金名字和配置金额！必须使用市场上真实存在的公募基金。如果不确定具体代码，直接输出“数据不足以推荐代码”。)
`;

  return await executeAIRequest(provider, apiKey, targetModel, prompt);
};

const executeAIRequest = async (provider, apiKey, modelName, prompt) => {
  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    // 统一设置成 4096 安全上限，防止部分兼容 OpenAI 接口的 API 在接收过大 max_tokens 时默默截断
    if (provider === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        body = {
            contents:[{ parts:[{ text: prompt }] }],
            tools: [{ googleSearch: {} }], 
            // 【金融级严谨参数】极低温度与严格核采样
            generationConfig: { 
                temperature: 0.1, 
                topP: 0.1, 
                maxOutputTokens: 4096 
            },
            safetySettings:[
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        };
    } else {
        url = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.siliconflow.cn/v1/chat/completions';
        headers['Authorization'] = `Bearer ${apiKey}`;
        body = {
            model: modelName,
            messages:[{ role: 'user', content: prompt }],
            // 【金融级严谨参数】极低温度与严格核采样
            temperature: 0.1,
            top_p: 0.1,
            max_tokens: 4096 
        };
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await response.json();
    
    if (data.error) throw new Error(data.error.message);
    
    if (provider === 'gemini') {
        return data.candidates[0].content.parts[0].text;
    } else {
        // 【新增体验优化】兼容 DeepSeek-R1 等推理模型，提取并优雅展示隐藏的“思维链”过程
        const msg = data.choices[0].message;
        let finalContent = msg.content || '';
        
        if (msg.reasoning_content) {
            // 把换行转为 <br/>，并在外面包裹一个优雅的 div (前端已用 dangerouslySetInnerHTML 渲染)
            const thinkProcess = msg.reasoning_content.replace(/\n/g, '<br/>');
            finalContent = `### 🧠 AI 深度思考过程\n<div class="text-slate-400 dark:text-slate-500 text-xs opacity-90 border-l-4 border-slate-300 dark:border-slate-600 pl-3 py-2 mb-4 bg-slate-50 dark:bg-slate-900/50 rounded-r-lg">${thinkProcess}</div>\n\n` + finalContent;
        }
        
        return finalContent;
    }
    
  } catch (error) {
    console.error("AI API Error:", error);
    throw new Error(error.message === "Failed to fetch" ? `网络无法访问 ${provider} 服务，请检查代理节点状态。` : error.message);
  }
};

// ============================================================================
// 【新增】持续交互的对话引擎 (支持上下文记忆与系统账本注入)
// ============================================================================
export const chatWithPortfolioAI = async (settings, portfolioStats, chatHistory, newMessage, marketData) => {
  const provider = settings.aiProvider || 'gemini';
  
  let apiKey = '';
  let targetModel = '';
  if (provider === 'gemini') {
      apiKey = settings.geminiApiKey;
      targetModel = settings.geminiModel || 'gemini-2.5-pro';
  } else if (provider === 'deepseek') {
      apiKey = settings.deepseekApiKey;
      targetModel = settings.deepseekModel || 'deepseek-chat';
  } else if (provider === 'siliconflow') {
      apiKey = settings.siliconflowApiKey;
      targetModel = settings.siliconflowModel || 'deepseek-ai/DeepSeek-V3';
  }

  if (!apiKey) throw new Error(`请配置 ${provider.toUpperCase()} 的 API Key`);

  const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const idleFunds = Number(settings.idleFunds) || 0;

  // 1. 组装极其详细的底层账本
  const activeFundsDetail = portfolioStats.computedFundsWithMetrics
    .filter(f => f.currentValue > 0 && !f.isArchived)
    .map(f => {
       const profitRate = f.totalInvested > 0 ? ((f.profit / f.totalInvested) * 100).toFixed(2) : 0;
       const xirrRate = (f.xirr * 100).toFixed(2);
       const cashFlows = formatCashFlows(f.transactions);
       return `\n- 资产：${f.name} (代码: ${f.fundCode || '未知'})
  > 当前市值: ${f.currentValue} 元 | 累计盈亏: ${f.profit} 元
  > 累计投入: ${f.totalInvested} 元 | 净本金: ${f.netInvested} 元
  > 简单盈亏率: ${profitRate}% | 年化收益率(XIRR): ${xirrRate}% | 持有份额: ${f.shares || 0}
  > 操作流水:
    ${cashFlows.split('\n').join('\n    ')}`;
    }).join('\n');

  // 2. 【关键修复】提取实时大盘数据，直接喂到 AI 嘴里，杜绝瞎编点位
  const shIndex = marketData?.find(m => m.id === 'sh000001');
  const szIndex = marketData?.find(m => m.id === 'sz399001');
  const marketStr = shIndex && szIndex 
    ? `\n【今日实时大盘行情】\n上证指数: ${shIndex.price}点 (${(shIndex.percent * 100).toFixed(2)}%) | 深证成指: ${szIndex.price}点 (${(szIndex.percent * 100).toFixed(2)}%)` 
    : '';

  // 3. 组装 System Prompt (加入严厉的防幻觉警告)
  const systemPrompt = `
你是我专属的私人量化基金经理和财富副驾驶。今天是 ${todayStr}。
请根据以下我的【最新全局账本底表】，回答我的提问。
要求：把我当成小白，直接给出明确的操作建议（加仓/减仓/换车/具体金额），不要讲空泛的理论。

【🚨 严厉警告：反幻觉与数据真实性】
1. 如果我询问今天的大盘点位，请直接读取下方的【今日实时大盘行情】，绝对不允许自己瞎编！
2. 如果我询问其他外部资讯（如宏观政策、美股走势、某只基金的具体新闻），你**必须强制调用 Google Search 工具**进行联网检索，绝不允许凭记忆捏造数据！
${marketStr}

【我的全局财富目标设定】
总目标金额：${settings.targetAmount || 0} 元 | 设定基准年化：${settings.targetAnnualRate || 5}%
剩余倒数时间：${portfolioStats.monthsLeft} 个月 | 为达成目标每月需新增收益：${portfolioStats.requiredMonthly.toFixed(2)} 元
超额收益(Alpha)：${(portfolioStats.alpha * 100).toFixed(2)}% | 偏离基准轨迹：${portfolioStats.deviationAmount >= 0 ? '+' : ''}${portfolioStats.deviationAmount.toFixed(2)} 元

【我的全盘资产快照】
总投入净本金：${portfolioStats.totalInvested} 元 | 全盘总市值：${portfolioStats.totalCurrentValue} 元 | 累计总盈亏：${portfolioStats.totalProfit} 元
综合年化(XIRR)：${(portfolioStats.overallXirr * 100).toFixed(2)}% | 预备空闲子弹：${idleFunds} 元

【我的详细持仓与流水】
${activeFundsDetail}
`;

  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    if (provider === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
        
        const geminiMessages = chatHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts:[{ text: msg.content }]
        }));
        
        geminiMessages.push({ role: 'user', parts:[{ text: `[系统底层账本与大盘数据注入]\n${systemPrompt}\n\n[我的最新提问]\n${newMessage}` }] });

        body = {
            contents: geminiMessages,
            tools: [{ googleSearch: {} }],
            // 降低温度，使其在聊天中也保持金融数据的严谨性
            generationConfig: { temperature: 0.1, topP: 0.1, maxOutputTokens: 4096 },
            safetySettings:[
                { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
        };
    } else {
        url = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.siliconflow.cn/v1/chat/completions';
        headers['Authorization'] = `Bearer ${apiKey}`;
        
        const openaiMessages =[
            { role: 'system', content: systemPrompt },
            ...chatHistory.map(msg => ({ role: msg.role, content: msg.content })),
            { role: 'user', content: newMessage }
        ];

        body = {
            model: targetModel,
            messages: openaiMessages,
            temperature: 0.1,
            top_p: 0.1,
            max_tokens: 4096
        };
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await response.json();
    
    if (data.error) throw new Error(data.error.message);
    
    if (provider === 'gemini') {
        return data.candidates[0].content.parts[0].text;
    } else {
        const msg = data.choices[0].message;
        let finalContent = msg.content || '';
        if (msg.reasoning_content) {
            const thinkProcess = msg.reasoning_content.replace(/\n/g, '<br/>');
            finalContent = `### 🧠 AI 深度思考过程\n<div class="text-slate-400 dark:text-slate-500 text-xs opacity-90 border-l-4 border-slate-300 dark:border-slate-600 pl-3 py-2 mb-4 bg-slate-50 dark:bg-slate-900/50 rounded-r-lg">${thinkProcess}</div>\n\n` + finalContent;
        }
        return finalContent;
    }
  } catch (error) {
    throw new Error(error.message === "Failed to fetch" ? `网络无法访问，请检查代理` : error.message);
  }
};