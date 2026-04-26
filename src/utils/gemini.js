export const analyzeFundWithGemini = async (apiKey, fund, profile, marketData) => {
  if (!apiKey) {
    throw new Error("请先在设置中配置 Gemini API Key");
  }

  // 1. 提取大盘数据 (以上证指数为例)
  const shIndex = marketData.find(m => m.id === 'sh000001');
  const marketEnv = shIndex 
    ? `今天上证指数表现：${shIndex.change > 0 ? '+' : ''}${(shIndex.percent * 100).toFixed(2)}%。` 
    : '大盘数据未获取。';

  // 2. 提取基金基础与历史表现数据
  const derived = profile.fund_derived || {};
  const baseData = profile.sec_header_base_data ||[];
  const maxDrawdown = baseData.find(d => d.data_name === '最大回撤')?.data_value_str || '未知';
  const rank1y = derived.srank_l1y || '未知';
  const rank3y = derived.srank_l3y || '未知';
  const yieldHistory = derived.yield_history ||[];
  const yieldStr = yieldHistory.map(y => `${y.name}:${y.yield}%`).join(', ');
  
  // 3. 提取用户真实持仓数据
  const profitRate = fund.totalInvested > 0 ? ((fund.profit / fund.totalInvested) * 100).toFixed(2) : 0;

  // 4. 组装极具专业投顾视角的 Prompt
  const prompt = `
你是一个拥有20年经验的顶尖公募基金分析师，以眼光毒辣、直言不讳著称。现在请你为我的单只基金持仓进行深度"体检"。

【大盘环境】
${marketEnv}

【基金基本面】
名称：${fund.name} (${fund.fundCode})
类型：${profile.type_desc || '未知'}

【历史业绩 (核心诊断指标)】
近1年同类排名：${rank1y}
近3年同类排名：${rank3y}
最大回撤：${maxDrawdown}
近期阶段表现：${yieldStr}

【我的真实持仓账本】
持仓本金：${fund.netInvested} 元
当前市值：${fund.currentValue} 元
累计盈亏：${fund.profit} 元 (盈亏率: ${profitRate}%)

【你的分析任务】
1. 质量定性：结合近1年和近3年排名，判断它是不是一只长期跑输的"垃圾基金"。如果是，请直接严厉指出，不要用回撤做借口。
2. 波动定性：结合最大回撤和类型，评估它的风险控制能力。
3. 行动建议：结合我的实际盈亏状态。如果是好基且浮亏，可建议"黄金坑"分批加仓；如果是垃圾基，请果断建议"止损/调仓"；如果是已达到止盈区的好基，提示防范回撤。

请使用 Markdown 格式输出，包含以下三个部分，总字数控制在 400 字以内：
### 📊 核心诊断 (准确定性)
### 💡 操作建议 (明确动作)
### ⚠️ 风险提示
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
        })
      }
    );

    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || "Gemini API 请求失败");
    }

    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    console.error("Gemini AI Analysis Error:", error);
    throw new Error(error.message === "Failed to fetch" ? "网络无法访问 Google 服务，请检查代理环境" : error.message);
  }
};