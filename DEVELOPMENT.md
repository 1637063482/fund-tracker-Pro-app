# Fund Tracker Pro — 项目开发文档

## 一、产品概述 (PRD)

### 1.1 产品定位

**个人基金资产管理 + AI 量化投资 Copilot 系统**，面向个人投资者的全栈资产管家。

核心价值主张：
- 用专业基金经理的工具武装个人投资者
- AI 驱动的"冷酷"量化分析，不讨好、不口嗨、只认数据
- 双层记账 + 实时行情 + 组合体检 + 云端巡检 四位一体

### 1.2 目标用户

- 持有 3 只以上公募基金的个人投资者
- 需要 XIRR 精确计算和组合分析的中级投资者
- 希望借助 AI 进行量化决策的进阶投资者

### 1.3 核心功能矩阵

| 模块 | 功能 | 优先级 |
|---|---|---|
| 基金记账 | 自动/手动双层记账、交易流水、清仓归档 | P0 |
| 实时行情 | 五大核心指数监控、多数据源容灾、节假日拦截 | P0 |
| AI Copilot | 28 工具调用、JS决策树打分引擎、三层记忆、多模型切换 | P0 |
| 量化引擎 | 5决策树+VaR/CVaR+O-U半衰期+Markov+蒙特卡洛+B-L优化+协方差 | P0 |
| 组合分析 | XIRR 计算、三大排行榜、FOF 穿透、财富目标复盘 | P1 |
| 云端巡检 | CF Worker 定时触发、多通道推送、6个量化端点 | P1 |
| 待办系统 | AI 自动生成交易计划、7 天赎回惩罚拦截 | P1 |
| 跨平台 | PWA + Android APK (Capacitor) | P2 |

### 1.4 技术架构

```
┌──────────────────────────────────────────────────────┐
│                   React 19 + Vite 8                   │
│                (Frontend SPA / PWA)                    │
├──────────────────────────────────────────────────────┤
│  UI Layer: Tailwind CSS 3 + Lucide React              │
│  State: React Hooks + Firestore Realtime              │
│  Auth: Firebase Auth (email/password)                  │
│  DB: Firestore (funds, settings, todos, chat)         │
├──────────────────────────────────────────────────────┤
│  量化引擎 (Browser):                                   │
│  ├─ 5 决策树分类器 (F1a/F1b/F2/F3/F4)                  │
│  ├─ VaR/CVaR + O-U 半衰期 (handler 自动附带)            │
│  ├─ Markov 机制转移 + 蒙特卡洛 (独立工具)               │
│  ├─ EWMA 协方差 + B-L 组合优化 (独立工具)               │
│  └─ Ω 置信度校准 + 宪法先验解析                          │
├──────────────────────────────────────────────────────┤
│  AI Engine: Gemini / DeepSeek / SiliconFlow            │
│  Search: Tavily / Exa / Serper                         │
│  Chart: QuickChart.io + Custom SVG Donut              │
├──────────────────────────────────────────────────────┤
│  CF Worker (my-cors-proxy.js):                        │
│  ├─ /api/market-microstructure (微观结构探测器)        │
│  ├─ /api/quant/covariance (EWMA协方差)                 │
│  ├─ /api/quant/black-litterman (B-L后验优化)           │
│  ├─ /api/quant/ou-half-life (O-U半衰期)               │
│  ├─ /api/quant/markov-regime (Markov机制转移)          │
│  └─ /api/quant/monte-carlo (蒙特卡洛模拟)              │
├──────────────────────────────────────────────────────┤
│  Mobile: Capacitor 8 (Android) + PWA                  │
│  Cloud: Cloudflare Worker (KV + Cron)                  │
│  Push: Ntfy / 飞书卡片 / 钉钉机器人                   │
└──────────────────────────────────────────────────────┘

"脑体分离"架构：
  🧠 LLM (脑): 读取标签 + 翻译人话 + 冲突裁决 + NLP情绪
  ⚙️ JS/Worker (体): 决策树分类 + 矩阵运算 + 概率模型 + 优化求解
```

---

## 二、需求迭代记录

### v1.0 — 基础记账与行情（已交付）

- [x] Firebase Auth 登录
- [x] 手动/自动双层记账
- [x] 五大指数实时行情（腾讯数据源）
- [x] 交易流水记录
- [x] 清仓归档
- [x] 基金净值拉取（天天基金 JSONP）
- [x] 暗黑模式
- [x] PWA 支持

### v1.8.0 — 量化架构全面升级："脑体分离"（已交付）— 2026-06-19

- [x] **量化打分引擎**：5 个 JS 决策树分类器（`scoring-tree.js`），替代 LLM 语义匹配。输出标签 `{category, baseScore, scoreRange}`，LLM 在区间内 ±1 微调
- [x] **概率风险模型**：VaR(95%/99%) + CVaR 参数法/历史法（`handler` 自动附带）；O-U 均值回归半衰期（`handler` 自动附带 + 独立工具）；Markov 机制转移（`handler` 自动附带 + 独立工具）；蒙特卡洛模拟（独立工具 + 浏览器端工具）；EWMA 协方差矩阵（独立工具 + CF Worker 端点）
- [x] **B-L 组合优化**（独立工具 `run_portfolio_optimization` + CF Worker 端点）：AI 打分→观点向量→后验收益→最优权重→精确调仓建议
- [x] **Ω 置信度校准**（`bl-calibration.js`）：Sigmoid 缩放 + 观点数量惩罚 + 硬约束，防止极端值
- [x] **宪法先验解析**：GLOBAL_CONSTITUTION 备忘录→B-L 先验权重（6 种风险偏好映射）
- [x] **CF Worker 6 个量化端点**（`/api/quant/*`）：协方差/B-L/O-U/Markov/蒙特卡洛，含纯 JS 矩阵求逆
- [x] **LLM 工具从 23→28 个**：J 类组合优化 + K 类量化模型工具箱（4 个），全部含调用时机指引
- [x] **System Prompt Scoring 层压缩 -89%**：~3,750→~400 tokens，F1-F4 档位描述→JS 引擎读取指南
- [x] **巡检路由升级**：0-5 步→0-7 步（+Markov+O-U+协方差+B-L+蒙特卡洛）
- [x] **NLP 情绪分析**：`get_financial_news`→鹰鸽指数+F4 ±2分调整
- [x] **"脑体分离"架构确立**：LLM=读标签+翻译+裁决；JS/Worker=决策树+矩阵+概率模型
- [x] 新增 `src/utils/quant/` 目录（3 个模块 ~1,285 行）；新增 11 个量化单元测试

### v1.1 — AI Copilot 核心（已交付）

- [x] Gemini / DeepSeek / SiliconFlow 三模型切换
- [x] 22 个 Function Calling 工具
- [x] 多轮对话 + 工具调用循环
- [x] 联网搜索（Tavily / Exa / Serper）
- [x] 三层战略记忆系统
- [x] 双核多周期打分卡
- [x] 防幻觉协议
- [x] 自定义 AI 提供商（custom_ 前缀）

### v1.2 — 组合分析与可视化（已交付）

- [x] XIRR 年化收益率计算
- [x] 三大排行榜（XIRR / 收益 / 简单收益率）
- [x] 大类资产配置饼图
- [x] 财富目标复盘（Alpha、偏离、缺口、复利推演）
- [x] FOF X-Ray 穿透雷达
- [x] QuickChart 图表生成（线/柱/色带/趋势线/双Y轴）
- [x] SmartInput 公式计算引擎

### v1.3 — 多轮对话与推理（已交付）

- [x] 多对话管理（新建/切换/删除/重命名）
- [x] DeepSeek reasoning_effort 参数控制
- [x] AI 思考过程可视化（可折叠）
- [x] AI 参数面板（Temperature / Top-P / MaxTokens / 历史窗口 / 工具轮次）
- [x] 对话跨设备同步（Firestore cloud）
- [x] 文件上传解析（Gemini OCR）
- [x] 分享 PDF 功能

### v1.5.1 — AI 架构重构与设置数据修复（已交付）— 2026-06-09

- [x] AI 引擎模块化重构：core.js (653→99行) → orchestrator + pipeline + adapter + context 分层架构
- [x] AI 厂商适配层：GeminiAdapter / OpenAIAdapter 统一协议序列化
- [x] 上下文管理器 (ContextManager)：4 个 Selector 按意图精准选取注入数据 + Token 预算控制
- [x] 双层意图路由器 (context-router)：FastPath 关键词零成本 + SlowPath 轻量 AI 5s 超时兜底
- [x] JS 层预计算缓存 (DataCache)：同日+同持仓状态下复用预计算结果
- [x] 行情数据 depth 参数：summary 模式跳过 ~20 次分时+K线请求
- [x] 修复 Firestore rules 导致设置从未成功持久化的问题
- [x] 修复 ProxySettingsModal 空字符串覆盖真实 API Key 的问题
- [x] handleSaveSettings 写入失败 toast 提示

### v1.7.0 — AI 深度质量优化 + 全球市场信号（已交付）— 2026-06-10

- [x] F3 量价验证全面重写：绝对阈值→动态量比 VR（今日成交÷近5日均量），7 档全覆盖，精确数学不等式零模糊词
- [x] F4 全球调整：隔夜美股（纳指/标普/道指）±3 修正，国内 5 信号独立判定
- [x] 隔夜外盘信号 Orchestrator 注入 + 仪表盘行情条（Apple 浮标+美东时间+三重刷新控制）
- [x] 持仓穿透数据修复：JZBL 归一化 bug、百分比语义、东方财富双源降级、行业预分类
- [x] System Prompt 五层重构：14,000→7,600 chars(-47%)，去重+注意力锚点+结构化写入规范
- [x] 备忘录/待办结构化注入：字段提取→紧凑格式，备忘 12 字段按需+待办三层分组+时间戳+30日归档
- [x] 双层自检回顾(Meta-Vigilance)：Score vs OHLC + P&L vs 大盘Beta，T+1错位免责
- [x] 打分快照量价+P&L 存储：Firestore 写入+UI 卡片渲染
- [x] FOF 字典用户手动五栏补充：股票/债券/基金/现金/其他%，留空不覆盖
- [x] K线 handler 成交量字段、Dev 模式完整 AI 思考日志、renderMarkdown 范围格式修复
- [x] 待办 completedAt/createdAt 时间戳、优先级 🔴高/🟡中/🟢低 文字标签
- [x] 死代码清理：modules.js/context-router.js/useWebSearch 链路

### v1.6.0 — AI 上下文质量重构（已交付）— 2026-06-09

- [x] System Prompt 压缩 47% + 备忘录/待办结构化注入 + 持仓表格份额/类型增强
- [x] 持仓穿透数据源双源降级 + 行业预分类 + 业绩基准 equityRatio 解析
- [x] FOF 字典用户手动五栏 + 穿透备忘分离铁律
- [x] 第五层巡检路由恢复 + 第四层双层自检回顾 + 打分快照量价/P&L

### v1.4 — 体验优化（部分交付）

- [x] 金额隐私模式（一键隐藏/显示）
- [x] 15 分钟无操作自动登出
- [x] 行情 Tick 动画（涨跌色 + 蒙版闪烁）
- [x] 手机端放大镜穿透防护
- [x] 多数据源容灾（腾讯/新浪/雪球 + 5 CORS 代理）
- [x] 法定节假日自动识别
- [x] 周五巡检黄条提醒
- [x] 行情数据源迁移（push2.eastmoney.com → qt.gtimg.cn + hq.sinajs.cn）
- [x] 基金赎回费率编辑器（自定义天数阈值 + 费率）
- [x] 持仓分层分析引擎（FIFO 买入批次 × 持有天数区间）
- [x] AI 赎回费精确计算（分层金额 × 真实费率注入 AI 上下文）
- [x] 打分快照完整修复（写入/读取/显示/动画）
- [x] 打分历史面板双核展示（权益分 + 固收分）
- [ ] iOS 适配（Capacitor iOS 打包）
- [ ] 数据导入（JSON 文件恢复）

---

## 三、关键架构决策

### ADR-001: 纯前端 SPA 架构，Firebase BaaS

**日期**: 项目初始
**决策**: 采用纯前端 React SPA，Firebase 作为唯一后端（Auth + Firestore），不自建 API 服务器。
**理由**:
- 个人工具，无复杂业务逻辑需要服务端
- Firestore 实时同步天然支持多端数据一致
- 零运维成本
**代价**: 安全规则复杂度高，客户端 API Key 暴露（已通过 Firestore 规则限制）

### ADR-002: AI 工具调用采用 Function Calling + 策略模式

**日期**: v1.1
**决策**: 使用 OpenAI 兼容的 Function Calling 协议，工具分发采用策略模式（`tool-handlers.js`），而非 if-else 链。
**理由**:
- 工具数量多（22+），策略模式可扩展性更好
- OpenAI 协议兼容 Gemini（自动转换 functionDeclarations）
- 每个 handler 为独立异步函数，便于单元测试
**代价**: Gemini 的 functionDeclarations 转换层需要额外维护（sanitizeSchema）

### ADR-003: 防幻觉协议作为 System Prompt 第一层

**日期**: v1.1
**决策**: 在 System Prompt 的第一层嵌入"绝对不可触碰的执行红线"，而非通过外部中间件拦截。
**理由**:
- 无法在客户端验证 AI 的所有输出
- System Prompt 层约束对所有模型生效
- 包含多条硬规则：净值数据唯一通道、T+1 妥协、交易日历核对、资金交收物理规律
**代价**: 消耗大量 Token（约 ~1500 tokens），但利用 DeepSeek 上下文缓存降低了边际成本

### ADR-004: 四数据源净值拉取 + 多 CORS 代理容灾

**日期**: v1.0 → v1.4 迭代
**决策**: 基金净值支持天天基金（JSONP 实时估值）、新浪财经（GBK 编码）、天天基金 Web 历史 API、蛋卷基金四种数据源，行情支持腾讯/新浪/雪球三种数据源，外加 5 个公共 CORS 代理节点轮换。
**理由**:
- 纯前端无法直连交易所 API，必须依赖第三方数据源
- 单一数据源容易因 CORS/限流/变更而失效
- JSONP 方式（天天基金）在生产环境绕过了 CORS
**代价**: 每个数据源的返回格式不同，需要独立解析器

### ADR-005: SmartInput 安全求值引擎 — 禁 eval/new Function

**日期**: v1.0
**决策**: 手写递归下降解析器（`safeMathEval`），禁止使用 `eval` 或 `new Function`。
**理由**: 金额表达式直接来自用户输入，eval 存在代码注入风险。CSP 策略也限制了 eval 使用。
**代价**: 仅支持四则运算 + 括号，不支持更复杂的数学函数。

### ADR-006: 多对话架构 — 每对话独立 Firestore 文档

**日期**: v1.3
**决策**: 对话存储从单一 `chat/history` 文档迁移至 `chat_convs/{convId}` 集合，每个对话独立一个文档。
**理由**:
- 单文档模式无法支持多对话
- 独立文档支持按需加载，避免一次性拉取所有历史
- 旧版数据自动迁移，迁移完成后删除旧文档
**代价**: 需维护 `activeConvIdRef` + `pendingConvIdRef` 双 ref 防止串线

### ADR-007: 双核打分系统 — 权益引擎与固收引擎分离

**日期**: v1.2（v1.7.1 重构：F1→F1a+F1b 双指数并行）
**决策**: 评分系统分为权益引擎（5 因子 100 分：F1a 上证赔率 20 + F1b 双创校验 15 + F2 微观反转 25 + F3 量价验证 25 + F4 跨资产确认 15）和固收引擎（2 因子 100 分），严格禁止交叉使用。F1a+F1b 双指数并行评估后相加，F1a 仅看上证系统性风险、F1b 捕捉创业板/科创50独立风格信号。
**理由**:
- 权益和固收的估值逻辑完全不同
- 混合使用会导致纯债基金套用权益打分标准
- 滞回锁定（Hysteresis Lock）防止 35 分边界反复横跳
- v1.7.1 拆分 F1 为 F1a+F1b：消除上证与双创信号混淆，创业板/科创50波动率远超上证，合并打分导致极端行情误判
**代价**: 每次打分前需调用 8+ 个工具（新增 a3/a4/a5 双创K线常态化拉取），Prompt 打分部分从 ~3000 增至 ~4500 tokens

### ADR-008: Web Worker 沙箱执行 AI 生成的 JS 代码

**日期**: v1.1
**决策**: AI 的 `execute_javascript` 工具通过 Web Worker 沙箱执行，使用 `new Function` 但完全隔离 DOM 访问。
**理由**: AI 可能生成包含 `while(true)` 或 `fetch()` 的恶意代码，Worker 环境不提供 DOM API，且有独立的执行上下文。
**代价**: 无法使用 `Math.random()` 或 `Date.now()` 等非确定性 API

### ADR-009: 金额隐私模式 — CSS Class + Context 驱动

**日期**: v1.4
**决策**: 金额隐藏通过 `PrivacyModeContext` + `usePrivacyFormat` hook 实现，密码框 `type="password"` 加固数字输入。
**理由**: 单层 CSS `filter: blur()` 可被浏览器 DevTools 绕过。`type="password"` 提供原生级保护。
**代价**: 需要所有金额展示处统一使用 `fmt.money()` / `fmt.percent()` 包装。

### ADR-010: DI (依赖注入) 模式用于 AI 上下文组装

**日期**: v1.1
**决策**: AI 对话使用 `buildLatestStateWrapper` 每次注入最新账本状态，而非将状态写入 System Prompt。
**理由**:
- System Prompt 内容极少变动，利用 DeepSeek 上下文缓存
- 动态数据（账本、行情、备忘录）每轮必变，单独注入可复用缓存的静态部分
- 避免"数据污染"→ AI 可能用旧的账本数据做决策
**代价**: 每轮对话注入约 2000-3000 tokens 的数据状态

### ADR-011: System Prompt 三层动态加载 + 意图路由

**日期**: v1.5
**决策**: System Prompt 拆为 Core（~1,950 tok）/ Skill Library（~2,000 tok）/ Scoring（~3,750 tok）三层。Core 始终加载，Skill Library 由意图路由器按需注入，Scoring 由大盘雷达开关直接控制。
**理由**:
- 80% 日常操作（查净值、记账）不需要打分系统
- Scoring 的 6,300 token 原始版本仅在雷达 ON 时需要
- 意图路由器 5 层分类（短消息/显式关键词/纯轻量/分析兜底/资产检测）确保漏判率最低
- DeepSeek 上下文缓存：Core 始终在 messages[0] 100% 命中，Skill/Scoring 作为静态 user message 独立缓存
**代价**: FULL 模式比原版多 ~400 token rulebook 典礼帧，雷达 ON 时无 Token 节省

### ADR-012: 历史对话降采样 — 同日保留 + 跨日摘要

**日期**: v1.5
**决策**: 跨日对话历史不再完整发送给 AI。同日轮次完整保留（默认 6 轮），跨日轮次仅保留 AI 生成的摘要（`[本轮摘要]` 协议）和用户问题全文，丢弃过时的助理市场分析正文。
**理由**:
- 多日持续对话中，前几轮的市场分析和打分结论基于过时数据，与最新状态注入矛盾
- Core Prompt 规则 3："永远且只能以每次对话末尾系统注入的最新状态为决策基准"
- 跨日操作承诺（买入建议、价格锚点）通过 AI 摘要协议保留，不会丢失
**代价**: 跨日摘要由 AI 生成，质量依赖 AI 输出稳定性；摘要协议要求 AI 在每轮末尾多输出 ~30 tokens

### ADR-013: 基金分类统一模块 — RULES 数组驱动

**日期**: v1.5
**决策**: 全项目唯一的基金名称分类逻辑集中在 `fundClassifier.js`，一个 `RULES` 数组驱动 `classifyFundType` / `classifyAssetClass` / `classifyFundTypeShort` 三个函数。
**理由**: 之前 4 处各自实现分类逻辑（precompute.js ×3 + prompts.js ×1），修改规则需要同步 4 处。
**代价**: RULES 数组的顺序敏感（如"短债"必须在"债"之前匹配），添加新规则需注意优先级

### ADR-014: 量化打分引擎"脑体分离" — JS 决策树 + LLM 微调

**日期**: v1.8.0
**决策**: F1-F4 打分从 LLM 在 Prompt 中语义匹配 60+ 条档位规则 → JS 决策树输出 `{category, baseScore, scoreRange}` 标签，LLM 仅在 `scoreRange` 内做 ±1 微调。
**理由**:
- LLM 对同一组 K 线数据可能打出不同分数（非确定性），无法复现
- LLM 数学计算不可靠（Prompt 中多次出现"🚨严禁心算"）
- JS 决策树是确定性的——同输入=同输出
- LLM 保留 ±1 微调权，利用其对盘面微小异动的模糊理解能力（防坑3：软硬结合）
**代价**: 5 个分类器维护成本（12+6+6+11+6 档位），但每个档位的 if-else 逻辑明确、可单元测试

### ADR-015: B-L 先验权重来源于 GLOBAL_CONSTITUTION 备忘录

**日期**: v1.8.0
**决策**: B-L 模型的先验市场权重 w_mkt 不使用外部指数（如沪深300），而是从 `GLOBAL_CONSTITUTION` 备忘录的结构化字段中解析——"固收为主+适度增强" → `{bond:0.70, equity:0.20, cash:0.10}`。
**理由**:
- 传统 B-L 用沪深300市值权重对个人 FOF 组合无意义——用户不是在跑对标指数的基金
- 宪法备忘录是用户明确声明的风险偏好，语义清晰、有约束力
- "AI Views" 的语义变成"相对于我的基准应该超配/低配多少"，逻辑自洽
**代价**: 依赖备忘录的结构化格式正确填写；年化目标推断兜底为保守估计

### ADR-016: Ω 置信度三重校准 — 防 B-L 极端权重

**日期**: v1.8.0
**决策**: B-L 观点置信度 Ω 不能直接使用 Meta-Vigilance 准确率，必须过三层校准：(1) Sigmoid 映射到 [0.1, 0.89]；(2) 除以 √N_views 惩罚观点膨胀；(3) 硬约束 [0.05, 0.90]。
**理由**: 准确率 0%→AI 观点被忽略、满仓均衡权重；准确率 100%→满仓梭哈单基。两者都不可接受。
**代价**: Sigmoid 斜率(5)和范围 [0.1, 0.9] 是主观设定，可后续根据实盘数据调参

### ADR-017: 量化模型双轨制 — 浏览器端 + CF Worker

**日期**: v1.8.0
**决策**: 每个量化模型同时有浏览器端 JS 实现（LLM 工具直接调用）和 CF Worker 端点（`/api/quant/*`）。浏览器端用于日常 LLM 交互，CF Worker 端用于重计算（蒙特卡洛 >5000 次）和外部 API 调用。
**理由**:
- 浏览器端可即时响应 LLM 工具调用，无需网络往返
- CF Worker 可卸载重计算，且可被 `worker.js` 巡检脚本调用
- 双轨避免单点故障——CF Worker 未部署时浏览器端仍可用
**代价**: 逻辑在两端各自实现，需保持同步

---

## 四、数据库结构 (Firestore)

```
artifacts/
  └── {appId}/
      └── users/
          └── {uid}/
              ├── funds/{fundId}         # 基金持仓
              │   ├── name, fundCode, mode
              │   ├── transactions[]     # 交易流水
              │   ├── shares, currentValue
              │   ├── isArchived, exitValue
              │   └── lastNav, lastNavDate
              ├── settings/general       # 全局设置
              │   ├── aiProvider, aiApiKey(s)
              │   ├── dataSource, proxyMode
              │   ├── targetAmount, targetDate
              │   └── ...所有设置项
              ├── todos/{todoId}         # 待办事项
              │   ├── type, fundCode, fundName
              │   ├── actionType, amount, condition
              │   ├── priority, isCompleted
              │   └── createdAt
              ├── ai_memos/{memoId}      # AI 战略记忆
              │   ├── target, targetName
              │   ├── decisionType, coreLogic
              │   └── updatedAt
              ├── chat_convs/{convId}    # 对话记录
              │   ├── messages[]         # 完整的消息数组
              │   ├── title, createdAt
              │   └── updatedAt
              └── fof_dict/{fundCode}    # FOF 穿透字典
                  ├── fundCode, fundName
                  ├── equityRatio
                  └── sectors{}
```

---

## 五、AI System Prompt 架构（v1.8 重构）

### 全量合并模型（v1.6+ 架构，v1.8 深度压缩）

```
┌─────────────────────────────────────────────────────┐
│  全量 System Prompt (~4,900 tok)                    │
│  单一静态字符串 | messages[0] | 100% 缓存命中        │
│                                                     │
│  Layer 0: Core System (~1,950 tok)                  │
│  · 防幻觉协议 + 活体战略记忆 + 格式铁律              │
│  · 数据洁癖 + 跨日可靠性 + 雷达权威                  │
│                                                     │
│  Layer 1: Skill Library (~2,100 tok)                │
│  · 28 工具 × 10 分类 (A-K)                          │
│  · K 类·量化模型工具箱含自主调用时机指引              │
│  · 跨工具调用铁律 + 打分前置清单                     │
│                                                     │
│  Layer 2: Scoring System (~400 tok, -89%)           │
│  · 5 行 JS 引擎读取指南（替代 60+ 条档位描述）       │
│  · CIO 矩阵 + 全局否决 + 滞回锁定 + 动量修正         │
│  · VaR 风控日报 + NLP 情绪指引 + 量化预判聚合        │
│                                                     │
│  Layer 3: Inspection Routine (~350 tok)             │
│  · 量化增强版 0-7 步（+Markov+O-U+B-L+蒙特卡洛）     │
│  · 自检回顾(Meta-Vigilance)                         │
└─────────────────────────────────────────────────────┘
```

### 上下文组装流程

```
1. downsampleHistory(chatHistory)
   ├─ 同日轮次: 完整保留（默认最近 6 轮）
   ├─ 跨日轮次: AI 摘要 + 用户问题全文
   └─ 雷达指令: 历史中的旧指令剥离

2. buildFullSystemPrompt() → 全量静态字符串
   └─ Core + SkillLibrary + ScoringSystem + InspectionRoutine

3. messages = [system(Core)] + [rulebooks] + [history] + [stateWrapper]
   └─ Core 和 rulebooks 均为纯静态字符串 → DeepSeek 缓存命中
```

### Token 预算（v1.8 压缩后）

| 模块 | Tokens | 缓存 | 变动 |
|------|--------|------|------|
| Core | ~1,950 | 🟢 永久 | — |
| Skill Library | ~2,100 | 🟢 永久 | +100 (新增J/K类) |
| Scoring System | ~400 | 🟢 永久 | **-3,350 (-89%)** |
| Inspection Routine | ~350 | 🟢 永久 | +50 (新增2步) |
| Tools JSON | ~7,200 | 🟢 永久 | +900 (新增5工具) |
| **System Prompt 总计** | **~4,900** | **100%** | **-2,700 (-36%)** |

---

## 六、环境变量与配置

当前所有配置存储在 Firestore `settings/general` 文档中，前端 `config/constants.js` 仅存放 Firebase 配置和代理节点列表。如需迁移到环境变量：

```env
VITE_FIREBASE_API_KEY=xxx
VITE_FIREBASE_AUTH_DOMAIN=xxx
VITE_FIREBASE_PROJECT_ID=xxx
```

---

## 七、变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|---|---|---|---|
| 2026-06-19 | v1.8.0 | 量化架构全面升级：5决策树+VaR/CVaR+O-U+Markov+蒙特卡洛+B-L+协方差；28工具；Scoring层-89%；"脑体分离" | wangwang |
| 2026-06-18 | v1.7.1 | 修复状态栏云端连接状态永久"连接中" bug；F1 打分架构重构(F1a+F1b)；双创数据常态化拉取 | wangwang |
| 2026-06-10 | v1.7.0 | F3量比VR体系/隔夜外盘信号/F4全球调整/穿透修复/SysPrompt 47%压缩/结构化注入 | wangwang |
| 2026-06-09 | v1.6.0 | System Prompt 深度压缩/备忘录结构化注入/待办结构化注入/工具精简/穿透修复包 | wangwang |
| 2026-06 | v1.5.1 | AI 引擎模块化重构(core→orchestrator+pipeline+adapter+context)/设置数据修复 | wangwang |
| 2026-06 | v1.5.0 | AI 架构重构：三层动态Prompt/意图路由/历史降采样/预计算/消重/缓存优化 | wangwang |
| 2026-06 | v1.4.3 | 赎回费率系统、数据源迁移、打分快照修复 | wangwang |
| 2026-05 | v1.4.0 | 多对话管理、AI 参数面板、金额隐私模式、文件解析 | wangwang |
| 2026-04 | v1.3.0 | 双核打分卡重构、多数据源容灾、防幻觉升级 | wangwang |
| 2026-03 | v1.2.0 | FOF 穿透、财富复盘、QuickChart 升级 | wangwang |
| 2026-02 | v1.1.0 | AI Copilot 核心、22 工具、三层记忆 | wangwang |
| 2026-01 | v1.0.0 | 初始版本：记账、行情、Firebase 集成 | wangwang |
