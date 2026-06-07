// AI 意图路由器 — 判断是否需要加载技能库模块
// 打分系统不再由此路由：雷达 ON → 始终加载；雷达 OFF → 始终不加载（core.js 控制）
// 核心原则：宁可多加载（+2,000 tok），绝不漏加载技能库（导致 AI 缺少工具使用铁律）

// ============================================================================
// 技能库触发器 — 需要复杂工具组合的场景
// ============================================================================
const SKILL_LIBRARY_TRIGGERS = [
  // --- 选基/对比 ---
  '对比', '比较', '横向对比', '帮我对比', '对比一下',
  '哪个更好', '选哪只', '选哪个', '怎么选', '二选一', '三选一',
  '替换', '换仓', '替代基金', '换一只', '换成', '有没有更好的', '更好的选择',
  '推荐基金', '推荐一只', '给我推荐', '有什么推荐', '值得买',
  '帮我选', '挑一只', '选一只',

  // --- 穿透分析 ---
  '穿透', '重仓股', '底层持仓', '十大重仓', '持仓明细',
  'FOF', 'fof', 'fof字典', 'fof入库', 'X-Ray', 'x-ray',

  // --- 相关性/同质化 ---
  '相关性', '皮尔逊', '同质化', '重叠', '风格重复',

  // --- 基金诊断/体检 ---
  '诊断基金', '基金诊断', '分析这只基金', '分析一下这只', '分析一下这个', '分析一下基金',
  '这只基金怎么样', '这个基金怎么样',
  '体检', '组合体检', '组合诊断', '资产配置', '配置分析',
  '持仓分析', '组合分析', 'portfolio',
  '基本面', '基金评测', '基金评估',

  // --- 深度研究 ---
  '基金经理', '管理团队', '基金公司', '管理人',
  '行业分布', '申万行业', '板块分布',
  '费率对比', '规模对比', '回撤对比',

  // --- 基金转换/换仓 ---
  '转换成', '转换到', '转入', '转出', '换到',
];

// ============================================================================
// 纯轻量场景 — 明确只需要 Core Prompt 的操作
// ============================================================================
const LIGHT_MODE_TRIGGERS = [
  // --- 记账操作 ---
  '记账', '记一笔', '补录', '添加记录', '录入交易', '帮我记',
  '记录一下', '登记', '登记一下',

  // --- 纯数据查询 ---
  '查净值', '净值多少', '最新净值', '当前净值', '今天净值',
  '查一下净值', '看一下净值',
  '查一下', '看一下', '帮我查',

  // --- 待办操作 ---
  '待办', '计划', '新增计划', '删除待办', '修改计划',

  // --- 备忘录操作 ---
  '备忘录', '修改备忘', '更新备忘',

  // --- 纯画图 ---
  '画图', '走势图', '帮我画', '画一下', '画个图',

  // --- 纯计算 ---
  '计算', '帮我算', '复利', 'XIRR', '收益率计算',

  // --- 新闻查询 ---
  '新闻', '快讯', '财经新闻', '最新消息', '有什么消息',

  // --- 交易流水 ---
  '流水', '交易记录', '历史交易',

  // --- 问候/帮助 ---
  '你好', '谢谢', '帮助', '功能', '能做什么', '你会什么',

  // --- 纯信息查询（基金基本信息） ---
  '基金代码', '基金类型', '是什么基金', '是什么类型', '属于什么',
];

// ============================================================================
// 上下文感知：检查对话历史中是否存在活跃分析
// ============================================================================
const hasActiveAnalysisContext = (chatHistory) => {
  if (!chatHistory || chatHistory.length === 0) return false;
  const recent = chatHistory.slice(-5);
  const indicators = [
    '对比', '比较', '选哪只', '推荐', '穿透', '重仓股',
    '组合分析', '组合体检', '组合诊断', '资产配置', '持仓分析',
    '基金经理', '行业分布', '相关性', '同质化',
  ];
  for (const msg of recent) {
    const content = (msg.content || '').toLowerCase();
    for (const ind of indicators) {
      if (content.includes(ind.toLowerCase())) return true;
    }
  }
  return false;
};

// ============================================================================
// 主分类函数 — 仅判断是否需要技能库
// ============================================================================
export const analyzeIntent = (message, chatHistory = []) => {
  if (!message || message.trim().length === 0) {
    return {
      needsSkillLibrary: false,
      confidence: 'high',
      reason: '空消息，默认不加载技能库'
    };
  }

  const msg = message.trim();
  const msgLower = msg.toLowerCase();

  // ================================================================
  // Pass 0: 短消息上下文继承
  // ================================================================
  const isShortMessage = msg.length <= 10;
  const isContinuationMessage = /^(继续|然后呢|接着呢|还有呢|然后|接着说|go on|继续啊|下一步|接下来|然后怎么样|所以呢)$/.test(msg);
  const shortMsgHasSkillIntent = isShortMessage && /(?:对比|比较|穿透|诊断|体检|分析|推荐|持仓|组合|风险|集中|同质|怎么样|如何|怎么|选哪|换仓|替代|重仓)/.test(msg);

  if ((isShortMessage && !hasExplicitTriggers(msg)) || isContinuationMessage) {
    if (shortMsgHasSkillIntent) {
      // 短但明确需要技能库
    } else if (hasActiveAnalysisContext(chatHistory)) {
      return {
        needsSkillLibrary: true,
        confidence: 'high',
        reason: '短消息/续接消息，对话历史中存在活跃分析上下文，继承技能库'
      };
    } else {
      return {
        needsSkillLibrary: false,
        confidence: 'medium',
        reason: '短消息，无活跃分析上下文，不加载技能库'
      };
    }
  }

  // ================================================================
  // Pass 1: 显式技能库关键词
  // ================================================================
  for (const trigger of SKILL_LIBRARY_TRIGGERS) {
    if (msgLower.includes(trigger.toLowerCase())) {
      return {
        needsSkillLibrary: true,
        confidence: 'high',
        reason: `命中技能库关键词: "${trigger}"`
      };
    }
  }

  // ================================================================
  // Pass 2: 纯轻量场景
  // ================================================================
  let isDefinitelyLight = false;
  for (const trigger of LIGHT_MODE_TRIGGERS) {
    if (msgLower.includes(trigger.toLowerCase())) {
      isDefinitelyLight = true;
      break;
    }
  }

  if (isDefinitelyLight) {
    return {
      needsSkillLibrary: false,
      confidence: 'high',
      reason: '纯数据查询/记账/待办/备忘录/画图/计算/新闻/问候操作'
    };
  }

  // ================================================================
  // Pass 3: 分析意图兜底检测
  // ================================================================
  const analysisIndicators = [
    /怎么(?:看|操作|处理|办)/, /如何(?:看|操作|处理)/,
    /分析/, /评估/, /检查/, /审核/, /审计/,
    /建议/, /意见/, /推荐/, /策略/,
    /风险/, /隐患/, /问题/, /机会/,
    /走势/, /趋势/, /方向/, /涨跌/,
    /亏损/, /盈利/, /收益/, /回撤/,
    /仓位/, /持仓/, /持有/,
    /全部基金/, /所有基金/, /整个组合/, /我的组合/,
  ];

  let hasAnalysisIntent = false;
  for (const pattern of analysisIndicators) {
    if (pattern.test(msg)) {
      hasAnalysisIntent = true;
      break;
    }
  }

  const hasRecentAnalysis = hasActiveAnalysisContext(chatHistory);

  if (hasAnalysisIntent) {
    return {
      needsSkillLibrary: true,
      confidence: hasRecentAnalysis ? 'high' : 'medium',
      reason: '消息含分析意图（组合/持仓/趋势/建议等），加载技能库'
    };
  }

  // ================================================================
  // Pass 4: 上下文继承
  // ================================================================
  if (hasRecentAnalysis) {
    return {
      needsSkillLibrary: true,
      confidence: 'medium',
      reason: '消息意图不明确，但对话历史存在活跃分析上下文，保守加载技能库'
    };
  }

  // ================================================================
  // Pass 5: 最终兜底 — 涉及基金/资产 + 意图不明 → 保守加载技能库
  // ================================================================
  const hasFundCode = /\b\d{6}\b/.test(msg);
  const hasAssetReference = /基金|持仓|组合|股票|债券|仓位/.test(msg);
  if (hasFundCode || hasAssetReference) {
    return {
      needsSkillLibrary: true,
      confidence: 'low',
      reason: '消息涉及基金/资产但意图不明确，保守加载技能库'
    };
  }

  return {
    needsSkillLibrary: false,
    confidence: 'high',
    reason: '无任何分析/操作信号，不加载技能库'
  };
};

// ============================================================================
// 辅助函数
// ============================================================================
const hasExplicitTriggers = (msg) => {
  const allTriggers = [
    ...SKILL_LIBRARY_TRIGGERS,
    ...LIGHT_MODE_TRIGGERS,
    '买', '卖', '加', '减', '清', '进', '出', '换',
    '查', '看', '问', '帮', '请', '来',
  ];
  return allTriggers.some(t => msg.includes(t));
};

export { SKILL_LIBRARY_TRIGGERS, LIGHT_MODE_TRIGGERS };
