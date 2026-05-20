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

// 1. Tavily 搜索引擎调用函数 (投研定制版 - 强制信息源净化)
const fetchTavilySearch = async (apiKey, query, searchType = "news", settings = {}) => {
  if (!apiKey) return "";
  try {
    const targetUrl = 'https://api.tavily.com/search';
    
    // 🌟 核心引擎升级：为 Tavily 配置金融投研级“白名单”与“黑名单”
    const bodyPayload = { 
        api_key: apiKey, 
        query, 
        search_depth: "advanced", 
        max_results: 5,
        // ✅ 强制白名单：只允许从以下最顶尖的专业金融媒体和投研社区获取数据
        include_domains: [
            "wallstreetcn.com",  // 华尔街见闻（宏观数据、美联储、国债收益率最精准）
            "cls.cn",            // 财联社（A股电报快讯、资金面面精炼准确）
            "xueqiu.com",        // 雪球（大V深度解析、个股基金情绪面）
            "yicai.com",         // 第一财经（优质宏观分析）
            "stcn.com"           // 证券时报（官方权威且数据翔实）
        ],
        // ❌ 强制黑名单：屏蔽反爬虫网站、废话官媒、百科以及容易返回乱码 PDF 的源
        exclude_domains: [
            "1234567.com.cn", "eastmoney.com", // 东方财富系 (反爬极其严重，全是 JS 空壳)
            "chinabond.com.cn",                // 中债网 (图表渲染，爬虫只能抓到空表头)
            "baidu.com", "zhihu.com", "wikipedia.org", // 百科问答 (缺乏实时金融时效性)
            "gov.cn", "news.cn", "xinhuanet.com"       // 通稿网站 (缺乏量化交易所需的具体数字)
        ]
    };

    // 如果是查新闻，强制要求只看最近 3 天的，保证绝对的时效性
    if (searchType === "news") { 
        bodyPayload.topic = "news"; 
        bodyPayload.days = 3; 
    }

    // 判定是否走跨域代理
    let fetchUrl = targetUrl;
    if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
        fetchUrl = settings.customProxyUrl.includes('{{url}}') 
            ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl))
            : settings.customProxyUrl + targetUrl;
    }

    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      // 组装成给大模型看的干净摘要
      return data.results.map(r => `【信息源】${r.url}\n【标题】${r.title}\n【量化摘要】${r.content}`).join('\n\n');
    }
    return "";
  } catch (e) {
    console.warn("Tavily 搜索失败:", e);
    return "";
  }
};

// 2. Exa.ai 搜索引擎 (深度研报与机构博客提取)
const fetchExaSearch = async (apiKey, query, settings = {}) => {
  if (!apiKey) return "";
  try {
    const targetUrl = 'https://api.exa.ai/search';
    let fetchUrl = targetUrl;
    if (settings.proxyMode === 'custom' && settings.customProxyUrl) {
        fetchUrl = settings.customProxyUrl.includes('{{url}}') 
            ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl))
            : settings.customProxyUrl + targetUrl;
    }

    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ query, numResults: 3, useAutoprompt: true, contents: { text: { maxCharacters: 1500 } } })
    });
    const data = await res.json();
    if (data.results && data.results.length > 0) return data.results.map(r => `【深度文献】${r.title}\n【核心提取】${r.text}`).join('\n\n');
    return "";
  } catch (e) { console.warn("Exa 搜索失败:", e); return ""; }
};

// 3. Serper.dev 搜索引擎 (终极兜底 - Google原生)
const fetchSerperSearch = async (apiKey, query) => {
  if (!apiKey) return "";
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q: query, num: 4 })
    });
    const data = await res.json();
    if (data.organic && data.organic.length > 0) return data.organic.map(r => `【网页标题】${r.title}\n【摘要】${r.snippet}`).join('\n\n');
    return "";
  } catch (e) { console.warn("Serper 搜索失败:", e); return ""; }
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
      const isBondFund = (fund?.name || '').includes('债');
      const marketFocus = isBondFund ? "中国债券市场 央行公开市场操作 市场利率走势" : "A股走势 宏观经济";
      const query = `今日 ${marketFocus} ${fund?.name || ''} 最新新闻 利空 利好`;
      
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
5. 【带风控框架的独立裁判】：在评价我的买卖行为时，你拥有绝对的独立批判权，绝不能做只会迎合的“马屁精”。裁判标准请综合考量该资产的【真实绝对盈亏率】与【资金占用效率（排除短期失真年化）】。如果你发现我属于典型的“火场捡钢镚”（为了微小利差牺牲极大流动性或安全性），或者属于被短期高收益蒙蔽了双眼的高位接盘，请用最冷酷的数据戳穿我的幻觉，并建议纠正。只有当我的调仓在风控和收益预期上逻辑严密时，才予以肯定。
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

  return await executeAIRequest(provider, apiKey, targetModel, prompt, 0.2, 0.2);
};

// ============================================================================
// 3. 全盘体检引擎
// ============================================================================
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

  const marketEnv = marketData && marketData.length > 0 
    ? `\n【今日实时大盘与基准行情】\n` + marketData.map(m => `- ${m.name}: ${m.price} (${m.change > 0 ? '+' : ''}${(m.percent * 100).toFixed(2)}%)`).join('\n')
    : '\n【今日实时大盘与基准行情】\n大盘数据未获取。';

  let searchContext = "";
  if (provider !== 'gemini' && settings.tavilyApiKey) {
      const query = `当前中国央行货币政策 债券市场走势 A股大盘走势 美联储降息预期 宏观经济`;
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
### 🗑️ 存量资产清洗指令
### 🎯 【${idleFunds}元】空闲子弹精准打出方案 (极其重要)
`;

  return await executeAIRequest(provider, apiKey, targetModel, prompt, 0.4, 0.5);
};

// ============================================================================
// 4. 持续交互对话引擎 (聊天框专用)
// ============================================================================
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

  // 🌟 强化的时间锚点：加入星期几和具体到秒的时间，彻底唤醒 AI 的交易日历逻辑
  const todayStr = new Date().toLocaleString('zh-CN', { 
      timeZone: 'Asia/Shanghai', 
      year: 'numeric', month: '2-digit', day: '2-digit', 
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'long'
  });
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
  > 简单盈亏率: ${profitRate}% | 年化收益率(XIRR): ${xirrRate}% | 持有份额: ${f.shares || 0}
  > 操作流水:
    ${cashFlows.split('\n').join('\n    ')}`;
    }).join('\n');

  const marketStr = marketData && marketData.length > 0 
    ? `\n【今日实时大盘与基准行情】\n` + marketData.map(m => `- ${m.name}: ${m.price} (${m.change > 0 ? '+' : ''}${(m.percent * 100).toFixed(2)}%)`).join('\n')
    : '\n【今日实时大盘与基准行情】\n大盘数据未获取。';

  const systemPrompt = `
你是一个极其严谨、冷酷且只认数据的【量化交易执行引擎】。
你的唯一职责是：基于我提供的【真实账本数据】和外部搜索信息，直接下达操作指令。

【🚨 绝对不可触碰的红线（防幻觉与执行强制协议）】
1. 【强制穿透交易流水】（防瞎喷）：你看到的不仅是汇总数据，还有每一笔的【操作流水】！在评价某只基金表现（特别是 XIRR 和绝对盈亏）时，**必须先严格核对该基金大额买入或卖出的具体日期！** 绝对禁止把“近期刚大额建仓导致的低绝对收益”误判为“长期表现极差”！绝对禁止对用户“近期已经大额减仓”的基金再次提出重复的盲目减仓建议！
2. 【严禁常识幻觉与脱口而出】（防瞎编）：在进行收益对比时（例如提及余额宝、银行理财、存款利率等），**绝对不允许凭记忆、直觉或修辞惯性下判断！** 你必须明确调用搜索工具（如 tavily_search）查实该对比物当下的【真实最新收益率】后才能作为论据！严禁使用“连余额宝都不如”等毫无最新数据支撑的主观臆测废话！
3. 绝不推荐虚假代码：推荐任何资产必须是市场上真实存在的，必须附带正确的6位数代码，不知道就明确回答不知道。
4. 绝不讲废话：不要给我上宏观经济课，不要讲空泛的理论。我只需要直接、量化、精确到金额的“交易指令”。
5. 严禁目标倒逼风险（反PUA协议）：下方提供的【全局财富目标】只是一个期望值。如果该目标距离较远，你**允许**建议我拿小部分资金配置稳健型权益资产作为“卫星仓位”进行收益增强；但【绝对禁止】为了帮我填补缺口，而强行逼迫我大比例调仓去博取高弹性、高波动的风险资产！若目标脱离了策略极限，请坦诚建议我“降低目标预期”。
6. 尊重【固收为主，适度增强】的风险边界：我是一个稳健型投资者，资产结构以债券型基金为主力。你可以基于宏观推荐优质的“固收+”或“红利低波/宽基”，但绝不接受单一赛道重仓！
7. 【独立审查权与固收裁判框架】：你有绝对的权力批评我的操作，必须基于正确的专业逻辑，禁止盲目赞同。严禁将短期失真年化直接外推。用数据和“不可能三角”来裁判我的调仓是否划算。
8. 绝对的时间认知：请永远以用户提问时强制注入的【当前真实物理时间】为准，彻底抛弃历史聊天记录中的日期和环境！
9. 严禁估算净值（防工具惰性）：当用户问及某只基金状态，或你需要判断是否达到加/减仓击球区时，**绝对不允许使用“大概在xx区间”、“估算净值”这种词汇！** 你必须立刻调用检索工具去获取今天最新的精确净值。
10. 【禁止戏精与情绪化表达】：绝对禁止使用任何情绪化、拟人化或夸张的修辞（如“扇自己一巴掌”、“不可饶恕的错误”等）。即使你之前的判断有误，只需直接给出修正后的冷酷数据和最新结论，严禁长篇大论的自我检讨或道歉！
11. 【空闲子弹的择时与留白绝对纪律】(最核心！)：当要求你分配空闲资金时，**绝对禁止无脑满仓打光！** 你必须具备顶级投资经理的“择时”与“留白”思维：如果当前大盘或某只基金（特别是权益/混合型如019354等）点位偏高、追涨风险大、或者性价比不足，你必须果断建议【保持现金待命】或【仅小额定投试探】，并**明确且具体地给出你需要等待它跌至什么具体净值或区间，再出手的“击球区目标价”**。记住：“不操作”和“保留备用现金”本身就是极具价值的核心策略！
12. 【防死循环与 T+1 妥协常识】(极其重要！)：公募基金净值和宏观数据（如DR001、国债收益率）通常存在 T+1 的披露延迟，或搜索引擎存在快照缓存延迟。如果你查到了【昨天（T-1）或最近一个有效交易日】的数据，**【请立即接受该数据并停止重搜】！** 你只需要在最终回复的表格中如实标注“数据截至X月X日”即可。绝对禁止为了强行寻找“今天此时此刻”的数据而陷入疯狂的无限二次搜索死循环！！！
13. 【反海选与对比强迫症】：当用户要求“推荐基金”时，你作为顶级资管专家，绝对禁止为了寻找“全市场收益最高”的基金而在网上进行无休止的海选搜索和循环对比！严禁为了追求完美而陷入无尽的二次搜索！严禁摇摆不定！先决定要推荐什么类型的基金，再搜索该类型近期表现优异或者热门的前十作为候选，然后再进一步确认，最多搜索不超过6轮！

【🌟 你的专属技能库 (Skills)】
14. 你现在拥有一个全能的工具箱。当你需要查询净值时，自主调用"get_realtime_fund_data"；当你需要为用户直观展示一段走势、对比数据时，绝对禁止用文字拼凑，必须自主调用 "generate_trend_chart"技能生成可视化图表！作为顶级执行引擎，你要自己决定何时动用这些能力。

【🧠 Agent 智能觉醒与能力边界】
1. 你的核心身份：你是一个具备高度自主决策能力的【全能量化智能体】。你不受任何固定公式的束缚。
2. 善用你的能力：你手里有搜全球资讯的引擎（Tavily/Serper），也有直连金融数据库的接口（get_realtime_fund_data），现在你还拥有了【代码执行沙盒（execute_javascript）】。
3. 自主破局：当你遇到任何复杂的财务推演、收益率倒算、极端压测时，你应该像一个真正的量化工程师一样，**自己思考算法，自己编写 JS 代码，并调用沙盒得出绝对正确的数字**，然后再开口回答用户。你完全有能力自己决定何时搜数据，何时写代码计算！
4. 投资哲学底线：你可以自主思考所有方案，但请务必记住用户【稳健偏保守、固收为主】的画像。当你通过自主计算发现用户的目标不切实际时，请用你算出来的冷酷数据直接劝退他。

${provider === 'gemini' ? '15. 你拥有原生的 Google 搜索能力，请务必积极调用底层 Google 搜索来查实最新数据！' : ''}

【我的全局财富目标设定】
总目标金额：${settings.targetAmount || 0} 元 | 设定基准年化：${settings.targetAnnualRate || 5}%
剩余倒数时间：${portfolioStats.monthsLeft} 个月 | 为达成目标每月需新增收益：${portfolioStats.requiredMonthly.toFixed(2)} 元
超额收益(Alpha)：${(portfolioStats.alpha * 100).toFixed(2)}% | 偏离基准轨迹：${portfolioStats.deviationAmount >= 0 ? '+' : ''}${portfolioStats.deviationAmount.toFixed(2)} 元
`;

  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    // 清洗历史记录，剔除 AI 的深度思考 HTML 标签
    const cleanHistory = chatHistory.map(msg => {
        let content = msg.content;
        if (msg.role === 'assistant') {
            content = content.replace(/### 🧠 AI 深度多轮思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/, '');
            content = content.replace(/### 🧠 AI 深度思考过程\n<div[^>]*>[\s\S]*?<\/div>\n\n/, '');
        }
        return { role: msg.role, content };
    });

    const latestStateWrapper = `[系统底层强制注入：最新实时环境状态]
⚠️ 警告 AI：请立即清空历史时间认知！现在的真实物理时间是：${todayStr} ⚠️

${marketStr}

【当前全盘与子弹快照】
全盘总市值：${portfolioStats.totalCurrentValue} 元 | 累计总盈亏：${portfolioStats.totalProfit} 元
综合年化(XIRR)：${(portfolioStats.overallXirr * 100).toFixed(2)}% | 预备空闲子弹：${idleFunds} 元

【当前真实持仓明细】
${activeFundsDetail}

==============
【我的最新提问】
${newMessage}`;

    if (provider === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
        const geminiMessages = cleanHistory.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts:[{ text: msg.content }]
        }));
        geminiMessages.push({ role: 'user', parts:[{ text: latestStateWrapper }] });
        
        body = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: geminiMessages,
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
            // 🌟 核心修复 1：在 System Prompt 尾部追加“数据洁癖”强制审查指令
            { role: 'system', content: systemPrompt + `\n\n12. 【数据洁癖与交叉验证】：当你调用搜索工具获取基金净值或排名时，必须严格审视返回结果的【时间戳】！如果搜索返回的是过时数据（如几个月前的数据），或者是一堆毫不相干的文章，绝对不允许生搬硬套！你必须回答“无法获取可靠的最新数据”，或者换个更精确的关键词再搜一次！` },
            ...cleanHistory.map(msg => ({ role: msg.role, content: msg.content })),
            { role: 'user', content: latestStateWrapper }
        ];

        const isReasoner = targetModel.toLowerCase().includes('reasoner') || targetModel.toLowerCase().includes('r1');

        body = {
            model: targetModel,
            messages: openaiMessages,
            temperature: 0.1,
            top_p: 0.1,
            max_tokens: 8192,
            ...(provider === 'deepseek' && {
                thinking: { type: "enabled" },
                reasoning_effort: "high"
            })
        };

        if (useWebSearch && !isReasoner) {
            body.tools = [];
            
            // 🔫 武器1：基金专属 API (专治中国公募基金净值)
            body.tools.push({
                type: "function",
                function: {
                    name: "get_realtime_fund_data",
                    description: "【绝对精确金融API】当需要获取公募基金的最新精确净值、同类排名、阶段涨跌幅等结构化财务数据时，绝对优先调用此API！🚨 致命使用纪律：当用户要求“推荐基金”时，绝对禁止为了盲目比较全市场基金，而在多轮循环中疯狂调用此接口查几十只基金！",
                    parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
                }
            });

            // 🔫 武器2：宏观数字狙击枪 (Serper, 专治各种找不到精确数字)
            if (settings.serperApiKey) {
                body.tools.push({
                    type: "function",
                    function: {
                        name: "google_macro_search",
                        // 🌟 核心修正：严厉警告 AI 不要用搜索引擎去查历史连续数据
                        description: "【宏观定量数据引擎】当需要获取具体的宏观经济数字时调用！🚨 严厉警告：此工具是搜索引擎，不是数据库！仅限用于查询【今天此时此刻】的单个最新数值。绝对禁止用它来搜索“历史走势”、“X月到X月的数据”，否则你会引发死循环！🚨 致命警告：受搜索引擎缓存影响，若第一次查到的数据是昨天或前天的，请【直接使用该数据并停止重搜】，只需向用户说明数据更新日期即可，严禁陷入无限重复调用的死循环！🚨 致命红线：绝对禁止用此工具搜索【6位数代码的公募基金】的净值！查公募基金必须且只能调用 get_realtime_fund_data 或 get_fund_history_data！",
                        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
                    }
                });
            }

            // 🌟 核心增量：专门赋予 AI 查基金历史数组的超能力
            body.tools.push({
                type: "function",
                function: {
                    name: "get_fund_history_data",
                    description: "【基金时序数据库】专门用于获取公募基金过去 30 个交易日的历史净值序列。当用户要求看某只基金走势、画基金图表时，必须优先调用此工具获取底层数据数组。",
                    parameters: { type: "object", properties: { fundCode: { type: "string" } }, required: ["fundCode"] }
                }
            });

            // 🔫 武器3：新闻事件聚合器 (Tavily, 专治突发快讯)
            if (settings.tavilyApiKey) {
                body.tools.push({
                    type: "function",
                    function: {
                        name: "tavily_news_search",
                        description: "【定性新闻事件引擎】仅用于查询大盘异动原因、突发新闻、宏观政策解读等文字类信息。🚨 绝对禁止用此工具查询国债收益率等具体数字！",
                        parameters: { type: "object", properties: { query: { type: "string", description: "例如：'今日 A股 暴跌 核心原因'" } }, required: ["query"] }
                    }
                });
            }

            // 🔫 武器4：深度研报挖掘机 (Exa, 专治长期趋势与定性研报) 🌟 补回的神兵利器！
            if (settings.exaApiKey) {
                body.tools.push({
                    type: "function",
                    function: {
                        name: "exa_research",
                        description: "【深度长文研报引擎】当需要深挖特定资产的长期宏观逻辑、机构长篇定性研报、重大会议深入解读时调用。非常适合用于了解未来的中长期趋势分析！注意：绝对禁止用于查单日净值或实时报价。",
                        parameters: { type: "object", properties: { query: { type: "string", description: "例如：'2026年下半年 中国债市 资产荒 机构研报 深度分析'" } }, required: ["query"] }
                    }
                });
            }

            // 🔫 武器5：交易记账工具
            body.tools.push({
                type: "function",
                function: {
                    name: "update_ledger",
                    description: "【交易引擎】当用户明确表示已经买入、卖出某只基金，或要求补录历史交易时调用此工具。",
                    parameters: { 
                        type: "object", 
                        properties: { 
                            fundCode: { type: "string", description: "基金6位数代码" },
                            fundName: { type: "string" },
                            amount: { type: "number", description: "交易金额" },
                            actionType: { type: "string", enum:["buy", "sell", "delete"] },
                            // 🌟 核心升级：增加交易日期参数！
                            date: { type: "string", description: "交易发生的具体日期，格式 YYYY-MM-DD。如果用户说是'昨天'，请你根据今天的日期推算出昨天的精确日期并填入。如果未指明，则不填。" }
                        }, 
                        required: ["fundCode", "amount", "actionType"] 
                    }
                }
            });
        }

// 🌟 新增史诗级超能力：硬核量化与风控计算引擎
            body.tools.push({
                type: "function",
                function: {
                    name: "quant_analysis_engine",
                    description: "【核心量化算力协处理器】大语言模型天生不擅长精确数学运算！当且仅当需要预测未来收益、推算回本年化要求、或评估历史最大回撤风险时，【绝对禁止】你在脑海中自行计算，必须立刻调用此硬核算力引擎！",
                    parameters: {
                        type: "object",
                        properties: {
                            calcType: { type: "string", enum: ["future_value", "required_rate", "risk_evaluation"], description: "计算类型：future_value(计算复利终值), required_rate(计算达成目标所需年化), risk_evaluation(评估最大回撤等风险)" },
                            principal: { type: "number", description: "本金金额 (future_value/required_rate 时必填)" },
                            targetAmount: { type: "number", description: "目标金额 (required_rate 时必填)" },
                            annualRate: { type: "number", description: "预计年化收益率%，例如 3.5 (future_value 时必填)" },
                            months: { type: "number", description: "投资期限(月数) (future_value/required_rate 时必填)" },
                            priceArray: { type: "array", items: { type: "number" }, description: "价格或净值历史序列数组 (risk_evaluation 时必填)" }
                        },
                        required: ["calcType"]
                    }
                }
            });



        // 🌟 新增超能力：动态画图技能
            body.tools.push({
                type: "function",
                function: {
                    name: "generate_trend_chart",
                    description: "【可视化超能力】绘制图表。🚨 致命纪律：底层绘图引擎已具备 Y 轴【极度微观自适应缩放能力】！请【直接传入真实的原始净值数据】（如 1.1193, 1.1205），引擎会自动放大微弱波动。绝对禁止你自己为了放大波动而乘以 10000 或做任何缩放计算！",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "图表的标题，例如 '10年期国债近三个月走势'" },
                            chartType: { type: "string", enum: ["line", "bar", "pie"], description: "图表类型" },
                            labels: { type: "array", items: { type: "string" }, description: "X轴标签数组。🚨 警告：标签必须极其简短（如 '2-19', '3月'），绝对禁止写入长文本！" },
                            data: { type: "array", items: { type: "number" }, description: "Y轴数据数组，必须是真实的原始纯数字（如 1.1193）" }
                        },
                        required: ["title", "chartType", "labels", "data"]
                    }
                }
            });

// 🌟 终极超能力：图灵完备的代码沙盒 (Code Interpreter)
            body.tools.push({
                type: "function",
                function: {
                    name: "execute_javascript",
                    description: "【全能逻辑与数学沙盒】大语言模型天生不擅长复杂计算。当你需要进行任何宏观压力测试、复利终值推演、最大回撤计算、或者任何超越你直接回答能力的量化模型时，【绝对禁止】自己猜测结果！你必须自主编写一段 JavaScript 代码交给我执行。你必须通过 `return` 返回最终结果。支持使用标准 Math 库。",
                    parameters: {
                        type: "object",
                        properties: {
                            code: { 
                                type: "string", 
                                description: "合法的 JS 代码。例如计算复利：'let p=80000; let r=0.035/12; let m=7; return p*Math.pow(1+r,m);'" 
                            },
                            reasoning: {
                                type: "string",
                                description: "一句话解释你为什么要写这段代码（供审计使用）"
                            }
                        },
                        required: ["code", "reasoning"]
                    }
                }
            });

    }

    let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    let data = await response.json();
    
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (data.message && !data.choices) throw new Error(data.message);

    let accumulatedReasoning = '';
    let maxLoops = 8; 

    // 🌟 循环拦截 Agent 的多轮工具调用
    while (provider !== 'gemini' && data.choices && data.choices[0].message.tool_calls && maxLoops > 0) {
        maxLoops--;
        const responseMsg = data.choices[0].message;
        
        // 🌟 增强日志：把 AI 的内在深度思考（Chain of Thought）实时投射到 F12 控制台！
        if (responseMsg.reasoning_content) {
            console.log(`%c🧠 [AI 大脑神经元活动] 第 ${8 - maxLoops} 轮思考:`, `color: #f59e0b; font-size: 13px; font-weight: bold; background: #fffbeb; padding: 2px 6px; border-radius: 4px;`);
            console.log(`%c${responseMsg.reasoning_content}`, `color: #64748b; font-style: italic; border-left: 3px solid #f59e0b; padding-left: 10px; margin-bottom: 10px;`);
            accumulatedReasoning += responseMsg.reasoning_content + '\n\n';
        }
        
        body.messages.push(responseMsg);
        
        for (const toolCall of responseMsg.tool_calls) {
            const toolName = toolCall.function.name;
            
            // 🌟 核心增量执行层：拉取历史 30 天的数组数据
            if (toolName === 'get_fund_history_data') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`🔥 [Agent 调度] AI 激活时序数据库！拉取基金 [${args.fundCode}] 历史走势`);
                    
                    const targetUrl = `http://api.fund.eastmoney.com/f10/lsjz?fundCode=${args.fundCode}&pageIndex=1&pageSize=30`;
                    let fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
                        ? (settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl)) : settings.customProxyUrl + targetUrl)
                        : `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;

                    const res = await fetch(fetchUrl, { cache: 'no-store' });
                    const data = await res.json();
                    let actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);

                    if (actualData?.Data?.LSJZList) {
                        // 倒序处理，让日期从旧到新排列，符合画图逻辑
                        const list = actualData.Data.LSJZList.reverse();
                        // 提取日期标签 (只要月-日) 和 净值数组
                        const dates = list.map(item => item.FSRQ.substring(5)); 
                        const navs = list.map(item => parseFloat(item.DWJZ));
                        
                        body.messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: `【成功获取近30日净值】\n日期序列: [${dates.join(',')}]\n净值序列: [${navs.join(',')}]\n👉 请直接使用这些数组数据，利用你的 QuickChart 生成图片能力为用户绘制走势图！`
                        });
                    } else {
                        body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "获取历史净值失败，请告知用户无法画图。" });
                    }
                } catch (e) {
                    console.error("历史API调用失败", e);
                    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "时序接口报错，停止尝试画图。" });
                }
            }
            
            // 🌟 核心升级：拦截 API 请求，我们直接去蛋卷基金后台抓纯净 JSON 喂给 AI
            else if (toolName === 'get_realtime_fund_data') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`🔥 [Agent 调度] AI 拔出专属金融 API 狙击枪！锁定代码:【${args.fundCode}】`);
                    
                    const targetUrl = `https://danjuanfunds.com/djapi/fund/${args.fundCode}`;
                    let fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
                        ? (settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl)) : settings.customProxyUrl + targetUrl)
                        : `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;

                    // 加 no-store 防止 PWA 缓存，确保拿到最实时数据
                    const res = await fetch(fetchUrl, { cache: 'no-store' });
                    const data = await res.json();
                    let actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);

                    if (actualData?.data) {
                        const fundData = actualData.data;
                        const derived = fundData.fund_derived || {};
                        
                        // 组装成极度干净的结构化文本还给大模型
                        const resultStr = `
【基金名称】${fundData.fd_name} (${fundData.fd_code})
【最新净值】${derived.unit_nav || '未知'} (数据更新日期: ${derived.end_date || '未知'})
【近1月涨跌】${derived.nav_grl1m || '--'}%
【近3月涨跌】${derived.nav_grl3m || '--'}%
【近6月涨跌】${derived.nav_grl6m || '--'}%
【近1年涨跌】${derived.nav_grl1y || '--'}% (近1年同类排名: ${derived.srank_l1y || '未知'})
【近3年涨跌】${derived.nav_grl3y || '--'}% (近3年同类排名: ${derived.srank_l3y || '未知'})
【成立以来收益】${derived.nav_grbase || '--'}%
`;
                        body.messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            name: toolName,
                            content: resultStr
                        });
                    } else {
                        body.messages.push({ 
                            role: "tool", 
                            tool_call_id: toolCall.id, 
                            name: toolName, 
                            content: "未查询到该基金数据，可能是代码错误或退市。" 
                        });
                    }
                } catch (e) {
                    console.error("金融API调用失败", e);
                    body.messages.push({ 
                        role: "tool", 
                        tool_call_id: toolCall.id, 
                        name: toolName, 
                        content: "接口报错，请降级使用网页搜索工具(google_precise_search)去雪球获取数据。" 
                    });
                }
            } 

else if (toolName === 'quant_analysis_engine') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`🔥 [Agent 调度] AI 挂载算力协处理器！执行硬核量化运算:【${args.calcType}】`);
                    
                    let resultStr = "";

                    // 1. 复利终值推演 (FV)
                    if (args.calcType === 'future_value') {
                        const ratePerMonth = (args.annualRate / 100) / 12;
                        const fv = args.principal * Math.pow(1 + ratePerMonth, args.months);
                        const profit = fv - args.principal;
                        resultStr = `【量化引擎计算结果】\n投入本金：${args.principal}元\n预设年化：${args.annualRate}%\n投资期限：${args.months}个月\n👉 精确复利终值：${fv.toFixed(2)}元\n👉 预期纯收益：${profit.toFixed(2)}元`;
                    } 
                    // 2. 目标倒推年化 (Required Rate)
                    else if (args.calcType === 'required_rate') {
                        const ratePerMonth = Math.pow(args.targetAmount / args.principal, 1 / args.months) - 1;
                        const requiredAnnualRate = ratePerMonth * 12 * 100;
                        resultStr = `【量化引擎计算结果】\n当前本金：${args.principal}元\n目标金额：${args.targetAmount}元\n剩余期限：${args.months}个月\n👉 要达成此目标，所需的精确年化收益率为：${requiredAnnualRate.toFixed(2)}%\n(注：请利用此数据客观评判目标的风险合理性)`;
                    } 
                    // 3. 极速风控扫描 (Max Drawdown & Momentum)
                    else if (args.calcType === 'risk_evaluation' && args.priceArray && args.priceArray.length > 0) {
                        const prices = args.priceArray;
                        let maxDrawdown = 0;
                        let peak = prices[0];
                        let sum = 0;
                        
                        for (let p of prices) {
                            sum += p;
                            if (p > peak) peak = p;
                            const drawdown = (peak - p) / peak;
                            if (drawdown > maxDrawdown) maxDrawdown = drawdown;
                        }
                        const currentPrice = prices[prices.length - 1];
                        const ma = sum / prices.length;
                        const currentDrawdownFromPeak = (peak - currentPrice) / peak;

                        resultStr = `【量化风控扫描结果】\n该序列区间内极值：最高 ${peak.toFixed(4)}\n区间最大回撤 (Max Drawdown)：${(maxDrawdown * 100).toFixed(2)}%\n当前相对最高点回撤：${(currentDrawdownFromPeak * 100).toFixed(2)}%\n区间均值 (MA)：${ma.toFixed(4)}\n当前净值位：${currentPrice >= ma ? '均线之上(趋势偏强)' : '均线之下(趋势偏弱)'}`;
                    }

                    body.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: resultStr
                    });
                } catch (e) {
                    console.error("量化计算引擎执行失败", e);
                    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "运算参数异常，可能是数组为空或缺少必填项，请重新调整调用参数。" });
                }
            }


else if (toolName === 'generate_trend_chart') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`🔥 [Agent 调度] AI 释放可视化技能！绘制图表:【${args.title}】`);
                    
                    const safeLabels = (args.labels || []).map(l => String(l).substring(0, 10));
                    const safeData = (args.data || []).map(d => {
                        const num = parseFloat(String(d).replace(/[^\d.-]/g, ''));
                        return isNaN(num) ? 0 : num;
                    });

                    // 🌟 核心升级：底层自动计算微观极值，强制 QuickChart 自适应 Y 轴
                    const dataMin = Math.min(...safeData);
                    const dataMax = Math.max(...safeData);
                    const dataRange = dataMax - dataMin;
                    
                    // 动态留白算法：上下增加 15% 的舒适区间。如果是直线（range=0），给个默认微小区间。
                    const yPadding = dataRange === 0 ? 0.005 : dataRange * 0.15; 
                    const yMin = dataMin - yPadding;
                    const yMax = dataMax + yPadding;

                    const chartConfig = {
                        type: args.chartType || 'line',
                        data: {
                            labels: safeLabels,
                            datasets: [{
                                label: args.title,
                                data: safeData,
                                fill: false,
                                borderColor: 'rgb(79, 70, 229)',
                                backgroundColor: 'rgba(79, 70, 229, 0.5)',
                                tension: 0.1,
                                borderWidth: 2,
                                pointRadius: 3 // 让数据点更清晰
                            }]
                        },
                        options: {
                            title: { display: true, text: args.title },
                            legend: { display: false },
                            // 🚨 强行锁死 Y 轴的微观可视范围，彻底治愈微小波动看不见的问题！
                            scales: {
                                yAxes: [{
                                    ticks: {
                                        min: parseFloat(yMin.toFixed(4)),
                                        max: parseFloat(yMax.toFixed(4))
                                    }
                                }]
                            }
                        }
                    };

                    // 2. 🚀 核心升级：改用 QuickChart 的 POST 接口获取无长度限制的 Short URL
                    let finalChartUrl = "";
                    try {
                        const qcRes = await fetch('https://quickchart.io/chart/create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                chart: chartConfig, 
                                width: 600, 
                                height: 350, 
                                backgroundColor: 'white' 
                            })
                        });
                        const qcData = await qcRes.json();
                        if (qcData.success && qcData.url) {
                            finalChartUrl = qcData.url; // 拿到类似 https://quickchart.io/chart/render/zf-xxx 的短链接
                        } else {
                            throw new Error("QuickChart POST API failed");
                        }
                    } catch (qcError) {
                        console.warn("POST to QuickChart failed, falling back to GET URL", qcError);
                        // 降级方案：传统 GET 方式兜底
                        const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
                        finalChartUrl = `https://quickchart.io/chart?c=${encodedConfig}&bkg=white&w=600&h=350`;
                    }

                    body.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: `图表已成功生成。请在你的最终回复中，直接使用这行 Markdown 代码将图表展示给用户：\n![${args.title}](${finalChartUrl})`
                    });
                } catch (e) {
                    console.error("画图技能执行失败", e);
                    body.messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: "图表生成失败，请用文字表格代替。" });
                }
            }

            // 🌟 底层执行器：让 AI 自己当程序员
            else if (toolName === 'execute_javascript') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    
                    // 🌟 增强日志：让 AI 写的代码在 F12 里像真正的 IDE 一样高亮显示！
                    console.log(`%c🚀 [Agent 算力觉醒] AI 正在自主编写 JavaScript 代码...`, `color: #8b5cf6; font-size: 14px; font-weight: bold; padding: 4px 0;`);
                    console.log(`%c🎯 编码意图:%c ${args.reasoning}`, `color: #10b981; font-weight: bold;`, `color: #334155; font-size: 13px;`);
                    console.log(`%c💻 生成的源码:\n%c${args.code}`, `color: #3b82f6; font-weight: bold;`, `color: #ef4444; font-family: monospace; font-size: 13px; background: #f8fafc; padding: 8px; border: 1px solid #e2e8f0; border-radius: 6px; display: block; width: 100%;`);
                    
                    // 核心：动态执行 AI 写出的代码！
                    const rawResult = new Function(args.code)();
                    
                    // 🌟 核心修复：如果是对象或数组，强制序列化为 JSON 字符串，彻底消灭 [object Object] 瞎子危机！
                    let finalResult = rawResult;
                    if (typeof rawResult === 'object' && rawResult !== null) {
                        finalResult = JSON.stringify(rawResult, null, 2);
                    }

                    console.log(`%c✅ [沙盒运算完毕] 底层返回结果:\n%c${finalResult}`, `color: #10b981; font-weight: bold;`, `color: #0f172a; font-size: 13px; font-weight: 900; background: #dcfce7; padding: 6px; border-radius: 4px; display: block;`);

                    body.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: `代码执行成功！沙盒返回的绝对精确结果为:\n${finalResult}\n👉 请将此结果无缝融入你的最终分析报告中。`
                    });
                } catch (e) {
                    console.error(`%c❌ [沙盒执行崩溃] 代码语法或逻辑有误:`, `color: #ef4444; font-weight: bold;`, e);
                    body.messages.push({ 
                        role: "tool", 
                        tool_call_id: toolCall.id, 
                        name: toolName, 
                        content: `你写的代码执行报错了: ${e.message}。请检查语法逻辑，修复后重新调用执行！` 
                    });
                }
            }

            // 🌟 核心升级：精细化处理 Google 数字搜索 和 Tavily 新闻搜索
            else if (toolName === 'google_macro_search' || toolName === 'tavily_news_search' || toolName === 'exa_research') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    let finalQuery = args.query;
                    
                    // 🌟 终极清洗正则：连根拔起“2026年”、“5月19日”、“今日”等限制搜索引擎发挥的时间词
                    finalQuery = finalQuery
                        .replace(/202\d年/g, '')
                        .replace(/\d{1,2}月\d{1,2}日/g, '')
                        .replace(/今天|今日|最新/g, '') // Google自己知道给最新的，加上反而容易匹配到新闻标题
                        .trim();

                    console.log(`🔥 [Agent 调度] AI 激活【${toolName}】 | 发射检索词: [${finalQuery}]`);
                    
                    let searchRes = "";
                    
                    // 路由分发
                    if (toolName === 'google_macro_search') {
                        // 查数字，直接走 Serper (Google)
                        searchRes = await fetchSerperSearch(settings.serperApiKey, finalQuery);
                    } else if (toolName === 'tavily_news_search') {
                        // 查新闻，走 Tavily
                        searchRes = await fetchTavilySearch(settings.tavilyApiKey, finalQuery, "news", settings);
                    } else if (toolName === 'exa_research') {
                        searchRes = await fetchExaSearch(settings.exaApiKey, finalQuery, settings);
                    }
                    
                    // 极致降级兜底：如果 Tavily 新闻挂了，用 Serper 抢救
                    if (!searchRes && settings.serperApiKey && toolName !== 'google_macro_search') {
                        console.log(`⚠️ [Agent 降级] 主节点超时，触发 Serper 兜底: ${finalQuery}`);
                        searchRes = await fetchSerperSearch(settings.serperApiKey, finalQuery);
                    }

                    body.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: searchRes ? `【高质量检索返回】\n${searchRes}` : "未检索到精确数据，请停止主观臆断并告知用户缺乏数据支撑。"
                    });
                } catch (e) {
                    console.error(`❌ [Agent 崩溃] 武器【${toolName}】卡壳！报错:`, e);
                    body.messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolName,
                        content: "接口执行异常，请忽略本次查询结果。"
                    });
                }
            } else if (toolName === 'update_ledger') {
                const args = JSON.parse(toolCall.function.arguments);
                console.log(`🔥 [Agent 调度] AI 触发自主记账！参数:`, args);
                return { type: 'ACTION_REQUIRED', payload: args }; 
            }
        }
        
        response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        data = await response.json();
        
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        if (data.message && !data.choices) throw new Error(data.message);
    }

    // ==========================================
    // 最终组装并返回
    // ==========================================
    if (provider === 'gemini') {
        if (!data.candidates || data.candidates.length === 0) {
            throw new Error(`Google API 未返回有效文本，可能是联网搜索超时或被安全策略拦截。`);
        }
        const parts = data.candidates[0].content?.parts;
        if (!parts || parts.length === 0 || !parts[0].text) {
            throw new Error("Google API 返回了非标准文本数据。");
        }
        return parts[0].text;
    } else {
        const msg = data.choices[0].message;
        let finalContent = msg.content || '';
        
        // 🌟 兜底：处理部分第三方平台把 think 标签直接塞进正文 content 的奇葩情况
        const thinkMatch = finalContent.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
            accumulatedReasoning += thinkMatch[1] + '\n\n';
            finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
        }

        // 正常接收推理模型的思考过程
        if (msg.reasoning_content) {
            accumulatedReasoning += msg.reasoning_content;
        }

        // 🚨 终极防线：动态 UI 自适应
        // 默认的思考框样式（带最大高度和滚动条）
        let thinkingBoxClass = "text-slate-400 dark:text-slate-500 text-xs opacity-90 border-l-4 border-slate-300 dark:border-slate-600 pl-3 py-2 mb-4 bg-slate-50 dark:bg-slate-900/50 max-h-[300px] overflow-y-auto custom-scrollbar rounded-r-lg";

        // 如果正文居然是空的！
        if (!finalContent) {
            if (msg.tool_calls) {
                finalContent = "⚠️ 警报：AI 已经连续进行了 8 轮地毯式深度检索，触及了系统最大允许的安全运算深度，进程已被强制中断。";
            } else if (accumulatedReasoning) {
                // 说明 AI 犯了老毛病，把最终答案全写在草稿本（思考过程）里了，且因为额度耗尽没能写正文！
                finalContent = "*(系统提示：AI 思考过程过长导致正文被截断，请直接阅读上方的深度思考过程，或让 AI “精简总结一下”)*";
                
                // 🌟 绝杀 UI 优化：既然答案被困在思考框里了，我们强行拔掉思考框的 300px 高度限制！
                // 让灰框完全展开，用户可以直接顺畅地往下读，再也不用在小框里痛苦地拖动滚动条了！
                thinkingBoxClass = thinkingBoxClass.replace("max-h-[300px] overflow-y-auto custom-scrollbar ", "");
            }
        }

        // 最终组装
        if (accumulatedReasoning) {
            const thinkProcess = accumulatedReasoning.replace(/\n/g, '<br/>');
            finalContent = `### 🧠 AI 深度多轮思考过程\n<div class="${thinkingBoxClass}">${thinkProcess}</div>\n\n` + finalContent;
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
const executeAIRequest = async (provider, apiKey, modelName, prompt, targetTemp = 0.1, targetTopP = 0.1) => {
  try {
    let url = '';
    let body = {};
    let headers = { 'Content-Type': 'application/json' };

    if (provider === 'gemini') {
        url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        body = {
            contents:[{ parts:[{ text: prompt }] }],
            tools:[{ googleSearch: {} }], 
            generationConfig: { temperature: targetTemp, topP: targetTopP, maxOutputTokens: 8192 },
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
            temperature: targetTemp,
            top_p: targetTopP,
            max_tokens: 8192,
            // 🚨 精准识别，仅给 DeepSeek 原生官方接口发送思考参数，防止第三方兼容代理（如硅基流动）报 400 错误
            ...(provider === 'deepseek' && {
                thinking: { type: "enabled" },
                reasoning_effort: "high"
            })
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