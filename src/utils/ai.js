// ============================================================================
// 1. 辅助函数区
// ============================================================================

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

// Tavily 搜索引擎调用函数 (DeepSeek 联网必备)
const fetchTavilySearch = async (apiKey, query) => {
  if (!apiKey) return "";
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        search_depth: "basic",
        include_answer: false,
        max_results: 3 
      })
    });
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      return data.results.map(r => `新闻标题：${r.title}\n内容摘要：${r.content}`).join('\n\n');
    }
    return "";
  } catch (e) {
    console.warn("Tavily 搜索失败:", e);
    return "";
  }
};

// ============================================================================
// 2. 单基诊断引擎
// ============================================================================
export const analyzeFundWithAI = async (settings, fund, profile, marketData) => {
  const provider = settings.aiProvider || 'gemini';
  
  let apiKey = '';
  let targetModel = '';
  if (provider === 'gemini') {
      apiKey = settings.geminiApiKey;
      targetModel = settings.geminiModel || 'gemini-2.5-pro';
  } else if (provider === 'deepseek') {
      apiKey = settings.deepseekApiKey;
      targetModel = settings.deepseekModel || 'deepseek-v4-pro';
  } else if (provider === 'siliconflow') {
      apiKey = settings.siliconflowApiKey;
      targetModel = settings.siliconflowModel || 'deepseek-ai/DeepSeek-V3';
  }

  if (!apiKey) throw new Error(`请先在设置中配置 ${provider.toUpperCase()} 的 API Key`);

  // 【关键修复】将股债基准数据全量打包，让 AI 拥有完整的宏观视野
  const marketEnv = marketData && marketData.length > 0 
    ? `\n【今日实时大盘与基准行情】\n` + marketData.map(m => `- ${m.name}: ${m.price} (${m.change > 0 ? '+' : ''}${(m.percent * 100).toFixed(2)}%)`).join('\n')
    : '\n【今日实时大盘与基准行情】\n大盘数据未获取。';

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
  
  const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const idleFunds = Number(settings.idleFunds) || 0;

  // 【真实联网检索】
  let searchContext = "";
  if (provider !== 'gemini' && settings.tavilyApiKey) {
      const query = `今天A股美股宏观走势 ${fund?.name || ''} 最新新闻 利好 利空`;
      const searchRes = await fetchTavilySearch(settings.tavilyApiKey, query);
      if (searchRes) {
          searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n以下是刚刚检索到的最新真实互联网资讯，请务必基于这些数据进行判断，绝不允许自己捏造新闻：\n${searchRes}\n`;
      }
  }

  const prompt = `
你是一位拥有30年经验的华尔街顶尖宏观策略与量化分析师，以"客观、犀利、直击痛点"著称。现在请为我的这笔单只基金投资进行深度的"全息体检"。

【分析前置要求 (极其重要)】
0. 绝对信任数据：下方提供的所有数据均为**绝对真实的客观事实（Ground Truth）**，禁止质疑其真实性！
1. 现在的真实物理时间是 ${todayStr}。
2. 请直接读取下方数据作为当前市场基准，绝对不允许凭记忆瞎编点位！${marketEnv}
3. 宏观资产温度与历史纵深：在回答前，请结合你的最新知识库(如果是Gemini请强制使用Google Search获取最新资讯)。结合 A股、美股、黄金、中美国债收益率等核心资产【近3个月、近半年、近1年】的中长线走势趋势，评估当前处于反弹初期、主升浪还是下跌通道。
4. 标的雷达：这只基金（${fund?.name}）近期是否有重要新闻，或其所属核心板块近期的政策/行业利好利空。
${searchContext}

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

// ============================================================================
// 3. 全盘体检引擎
// ============================================================================
// 【关键修复】确保接收 marketData 参数
export const analyzePortfolioWithAI = async (settings, portfolioStats, marketData) => {
  const provider = settings.aiProvider || 'gemini';
  
  let apiKey = '';
  let targetModel = '';
  if (provider === 'gemini') {
      apiKey = settings.geminiApiKey;
      targetModel = settings.geminiModel || 'gemini-2.5-pro';
  } else if (provider === 'deepseek') {
      apiKey = settings.deepseekApiKey;
      targetModel = settings.deepseekModel || 'deepseek-v4-pro';
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
       return `\n- 资产：${f.name} (代码: ${f.fundCode || '未知'})\n  当前市值: ${f.currentValue}元 | 累计盈亏率: ${profitRate}% | 资产类型: ${f.name.includes('债') ? '固收' : '权益/其他'}\n  操作流水:\n  ${cashFlows.split('\n').join('\n  ')}`;
    })
    .join('\n');
    
  const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const idleFunds = Number(settings.idleFunds) || 0;

  // 【关键修复】将股债基准数据全量打包注入全盘分析
  const marketEnv = marketData && marketData.length > 0 
    ? `\n【今日实时大盘与基准行情】\n` + marketData.map(m => `- ${m.name}: ${m.price} (${m.change > 0 ? '+' : ''}${(m.percent * 100).toFixed(2)}%)`).join('\n')
    : '\n【今日实时大盘与基准行情】\n大盘数据未获取。';

  let searchContext = "";
  if (provider !== 'gemini' && settings.tavilyApiKey) {
      const query = `当前全球宏观经济走势 美联储降息预期 股市 大宗商品 黄金 趋势`;
      const searchRes = await fetchTavilySearch(settings.tavilyApiKey, query);
      if (searchRes) {
          searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n以下是刚刚检索到的最新真实互联网资讯，请务必基于这些数据进行判断，绝不允许自己捏造新闻：\n${searchRes}\n`;
      }
  }

  const prompt = `
你是一位面向高净值客户的首席资产配置官(CIO)。请对我的整体基金投资组合进行"上帝视角"的宏观诊断。

【分析前置要求 (极其重要)】
0. 绝对信任数据：下方提供的全盘资产快照、大盘行情等数据，均为**绝对真实的客观事实（Ground Truth）**，禁止质疑！
1. 现在的真实物理时间是 ${todayStr}。
2. 请直接读取下方数据作为当前市场基准，绝对不允许自己瞎编点位！${marketEnv}
3. 梳理全球核心资产（中美股市、大宗商品、债券利率）在【近3个月、近半年、近1年】的大周期趋势。
4. 结合美联储最新降息/加息预期、中美股市的核心矛盾等宏观指标，判断当前处于"风险偏好上升"还是"防御为主"的阶段。
5. 【无情鞭挞与客观诊断】：请作为独立客观的第三方进行评估！仔细阅读我的【操作流水】，不要因为我近期有大额加仓操作，就当老好人建议“继续观察”。如果我加仓的是长期跑输、毫无前景的劣质资产，或者是在高位追涨，请毫不留情地指出我的错误操作，并果断建议调仓止损！只有标的本身优质且处于底部时，才建议继续持有。
${searchContext}

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
2. 如果我的组合缺乏防守、红利或海外对冲资产等等，**请你务必直接推荐市场上优质的具体基金名称，并必须附上6位数的基金代码**。
3. 绝不允许只给“建议配置债券”这种模糊废话，必须精确到基金名字和配置金额！必须使用市场上真实存在的公募基金。如果不确定具体代码，直接输出“数据不足以推荐代码”。)
`;

  return await executeAIRequest(provider, apiKey, targetModel, prompt);
};

// ============================================================================
// 4. 持续交互对话引擎 (聊天框专用)
// ============================================================================
// 【关键修改1】函数签名增加 useWebSearch 参数
export const chatWithPortfolioAI = async (settings, portfolioStats, chatHistory, newMessage, marketData, useWebSearch = true) => {
  const provider = settings.aiProvider || 'gemini';
  
  let apiKey = '';
  let targetModel = '';
  if (provider === 'gemini') {
      apiKey = settings.geminiApiKey;
      targetModel = settings.geminiModel || 'gemini-2.5-pro';
  } else if (provider === 'deepseek') {
      apiKey = settings.deepseekApiKey;
      targetModel = settings.deepseekModel || 'deepseek-v4-pro';
  } else if (provider === 'siliconflow') {
      apiKey = settings.siliconflowApiKey;
      targetModel = settings.siliconflowModel || 'deepseek-ai/DeepSeek-V3';
  }

  if (!apiKey) throw new Error(`请配置 ${provider.toUpperCase()} 的 API Key`);

  const todayStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const idleFunds = Number(settings.idleFunds) || 0;

  const activeFundsDetail = portfolioStats.computedFundsWithMetrics
    .filter(f => f.currentValue > 0 && !f.isArchived)
    .map(f => {
       const profitRate = f.totalInvested > 0 ? ((f.profit / f.totalInvested) * 100).toFixed(2) : 0;
       const xirrRate = (f.xirr * 100).toFixed(2);
       const cashFlows = formatCashFlows(f.transactions);
       return `\n- 资产：${f.name} (代码: ${f.fundCode || '未知'})
  > 当前市值: ${f.currentValue} 元 | 累计盈亏: ${f.profit} 元
  > 累计投入: ${f.totalInvested} 元 | 净本金: ${f.netInvested} 元
  > 简单盈亏率: ${profitRate}% | 年化收益率(XIRR): ${xirrRate}% | 持持有份额: ${f.shares || 0}
  > 操作流水:
    ${cashFlows.split('\n').join('\n    ')}`;
    }).join('\n');

  // 【关键修复】将股债基准数据全量打包喂给聊天框
  const marketStr = marketData && marketData.length > 0 
    ? `\n【今日实时大盘与基准行情】\n` + marketData.map(m => `- ${m.name}: ${m.price} (${m.change > 0 ? '+' : ''}${(m.percent * 100).toFixed(2)}%)`).join('\n')
    : '\n【今日实时大盘与基准行情】\n大盘数据未获取。';

  let searchContext = "";
  // 【关键修改2】只有当 useWebSearch 为 true 时，才调用 Tavily
  if (useWebSearch && provider !== 'gemini' && settings.tavilyApiKey) {
      const searchRes = await fetchTavilySearch(settings.tavilyApiKey, newMessage);
      if (searchRes) {
          searchContext = `\n【实时联网搜索结果 (来自 Tavily Search)】\n针对用户的问题，系统自动在互联网上检索到了以下最新资料，请务必基于这些真实数据进行判断，绝不允许自己捏造新闻：\n${searchRes}\n`;
      }
  }

  const systemPrompt = `
你是一个极其严谨、冷酷且只认数据的【量化交易执行引擎】。今天是 ${todayStr}。
你的唯一职责是：基于我提供的【真实账本数据】和外部搜索信息，直接下达操作指令。

【🚨 绝对不可触碰的四条红线（防幻觉强制协议）】
1. 绝不捏造账本数据：你看到的【操作流水】就是全部！绝对不允许凭空捏造“资金即将到期”等任何不存在的事件！公募基金没有到期日！
2. 绝不瞎编大盘点位：必须严格读取下方的【今日实时大盘与基准行情】或搜索结果，绝不凭记忆编造。
3. 绝不推荐虚假代码：推荐任何资产必须是市场上真实存在的，必须附带正确的6位数代码，不知道就明确回答不知道。
4. 绝不讲废话：不要给我上宏观经济课，不要讲空泛的理论。我只需要直接、量化、精确到金额的“交易指令”。

【我的投资偏好与用户画像】
我是一个务实的投资者，需要你像机器一样精准。结合我手里的【${idleFunds}元】空闲子弹，告诉我具体的资金分配方案（买哪只？买多少？卖哪只？卖多少？）。如果我的历史操作存在追高杀跌，请毫不留情地严厉批评。

${searchContext}
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

    // 清洗历史记录，剔除 AI 的深度思考 HTML 标签，节省 Token 并防止幻觉
    const cleanHistory = chatHistory.map(msg => {
        let content = msg.content;
        if (msg.role === 'assistant') {
            content = content.replace(/### 🧠 AI 深度思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/, '');
        }
        return { role: msg.role, content };
    });

    if (provider === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
        
        const geminiMessages = cleanHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts:[{ text: msg.content }]
        }));
        
        geminiMessages.push({ role: 'user', parts:[{ text: `[系统底层账本与大盘数据注入]\n${systemPrompt}\n\n[我的最新提问]\n${newMessage}` }] });

         body = {
            contents: geminiMessages,
            // 【关键修改3】只有当 useWebSearch 为 true 时，才挂载 Google Search 工具
            tools: useWebSearch ? [{ googleSearch: {} }] :[],
            generationConfig: { temperature: 0.1, topP: 0.1, maxOutputTokens: 8192 },
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
            ...cleanHistory.map(msg => ({ role: msg.role, content: msg.content })),
            { role: 'user', content: newMessage }
        ];

        body = {
            model: targetModel,
            messages: openaiMessages,
            temperature: 0.1,
            top_p: 0.1,
            max_tokens: 8192,
            // 显式锁定思考模式
            thinking: { type: "enabled" },
            reasoning_effort: "high"
        };
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await response.json();
    
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices) throw new Error(data.message); 
    
    if (provider === 'gemini') {
        if (!data.candidates || data.candidates.length === 0) {
            if (data.promptFeedback && data.promptFeedback.blockReason) {
                throw new Error(`内容被 Google 安全策略拦截 (${data.promptFeedback.blockReason})`);
            }
            throw new Error(`Google API 未返回有效文本，可能是联网搜索超时或无结果。`);
        }
        const parts = data.candidates[0].content?.parts;
        if (!parts || parts.length === 0 || !parts[0].text) {
            throw new Error("Google API 返回了非标准文本数据 (可能触发了内部工具错误)。");
        }
        return parts[0].text;
    } else {
        if (!data.choices || data.choices.length === 0) {
            throw new Error(`API 返回空数据: ${JSON.stringify(data)}`);
        }
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

// ============================================================================
// 5. 底层 HTTP 请求封装
// ============================================================================
const executeAIRequest = async (provider, apiKey, modelName, prompt) => {
  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    if (provider === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        body = {
            contents:[{ parts:[{ text: prompt }] }],
            tools:[{ googleSearch: {} }], 
            generationConfig: { temperature: 0.1, topP: 0.1, maxOutputTokens: 8192 },
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
            temperature: 0.1,
            top_p: 0.1,
            max_tokens: 8192,
            // 显式锁定思考模式
            thinking: { type: "enabled" },
            reasoning_effort: "high"
        };
    }

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await response.json();
    
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices) throw new Error(data.message);
    
    if (provider === 'gemini') {
        if (!data.candidates || data.candidates.length === 0) {
            if (data.promptFeedback && data.promptFeedback.blockReason) {
                throw new Error(`内容被 Google 安全策略拦截 (${data.promptFeedback.blockReason})`);
            }
            throw new Error(`Google API 未返回有效文本，可能是联网搜索超时或无结果。`);
        }
        const parts = data.candidates[0].content?.parts;
        if (!parts || parts.length === 0 || !parts[0].text) {
            throw new Error("Google API 返回了非标准文本数据 (可能触发了内部工具错误)。");
        }
        return parts[0].text;
    } else {
        if (!data.choices || data.choices.length === 0) {
            throw new Error(`API 返回空数据: ${JSON.stringify(data)}`);
        }
        const msg = data.choices[0].message;
        let finalContent = msg.content || '';
        if (msg.reasoning_content) {
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