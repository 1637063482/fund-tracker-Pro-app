# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## [1.7.0] — 2026-06-10

### 新增
- **隔夜外盘信号注入**：Orchestrator 雷达开启时自动获取美股三大指数（纳指 `us.IXIC` / 标普 `us.INX` / 道指 `us.DJI`），注入 AI 上下文作为 F4 全球调整依据
- **仪表盘隔夜美股行情条**：`OvernightUSMarkets` 组件，Apple 风格浮标展示三大指数实时价格+涨跌幅+美东时间，受自动刷新开关+手动刷新+美股开收盘状态三重控制
- **F4 全球调整**：国内跨资产得分基础上 ±3 的全球 risk-on/off 修正，道指参与判定（3 指数中至少 2 个触发）
- **打分前置清单 f) 项**：`get_financial_news(topic=macro)` 强制获取全球宏观要闻，美股跌>2% 时强制搜索验证

### 变更
- **F3 量价验证全面重写为量比 (VR) 体系**：废弃绝对数值阈值，改用动态量比 `VR = 今日成交额 ÷ 近5日均量`
  - 拦截器双重 OR 门限：`(VR>1.5 或 成交>2.5万亿)` — VR 防熊市，绝对量防牛市高位钝化
  - VR 阈值基于 5 日均量统计学校准：VR>1.3=显著放量，VR>1.5=天量，VR>1.8=极端
  - 7 档全覆盖 + Default 兜底，全部精确数学不等式，零模糊词
  - VR 三层计算：🥇execute_javascript(禁心算) / 🥈上下文标签定性
- **F4 国内信号去模糊化**：`3中2偏多/偏空` 替换为 5 信号独立判定，自上而下匹配
- **K 线 handler 新增成交量字段**：每根 K 线输出 `量xxx万手`
- **`get_cross_asset_data` 精简**：外盘数据移除（已由 Orchestrator 注入）

### 修复
- **持仓穿透数据严重失真**：`normalizePct()` 将东方财富 `JZBL` 正确值 0.99% 炸成 99%。移除错误归一化，改用 API 自带 `INDEXNAME` 行业分类 + `PCTNVCHGTYPE/PCTNVCHG` 调仓信息
- **穿透百分比语义混淆**：明确标注"占净值比例(JZBL)"非"占股票市值比"，加业绩基准解析为权益仓位锚点
- **穿透+备忘同时出现**：System Prompt 加铁律 — 穿透同一轮禁写该基金备忘
- **打分历史 Firestore 丢弃量价/P&L**：`handleScoreRecord` 补全字段，UI 卡片新增量价行+P&L 行
- **FOF 字典卡片 AI 估算覆盖真实数据**：用户手动五栏(股票/债券/基金/现金/其他%) → `equityRatio` 用真实值
- **`renderMarkdown` 范围格式误着色**：`73-77%` 的 `-X%` 不再错误着色，范围值加 `whitespace-nowrap` 防断行
- **`classifyFundType` 替代 `classifyFundTypeShort`**：类型标记从 2 字扩展为完整分类
- **拦截器(b) `指数<0` 一刀切误杀**：加回 `上证<-0.3% 或 创业/科创<-1%`
- **System Prompt 清理重复兜底代码**

---

## [1.6.0] — 2026-06-09

### 优化
- **System Prompt 深度压缩（-47%）**：Core + SkillLibrary + ScoringSystem 三合一内联至 `system.js`，规则去重、`▸` 注意力锚点、冗余描述精简化。14,000→7,600 chars，DeepSeek 前缀缓存 100% 命中不变
- **备忘录结构化注入**：`coreLogic` 从自由文本全文注入改为 12 个可选字段解析（定调/净值锚/风格/网格/击球区/止盈/止损/仓位/相关性/建仓条件/红线），AI 直接读取决策参数而非阅读理解 600 字 Markdown。个基备忘 >30 只时截断
- **待办事项结构化注入**：`condition` 字段解析为冻结状态+触发条件+关键备注，三层分组（🟢可执行/⛔已冻结/✅在途），带金额汇总和统一冻结原因。优先级从纯 emoji 升级为 `🔴高/🟡中/🟢低`
- **待办新增时间戳**：`handleToggleTodo` 写入 `completedAt`/`updatedAt`，完成待办按时间倒序排列并过滤 30 天外历史数据
- **Tool Definitions 精简（-35%）**：参数描述最小化，移除与 System Prompt 重复的规则说明
- **持仓表格增强**：新增份额列、类型标记从 2 字短标签升级为 8 字详细分类（`基金分类器.classifyFundType`）、移除集中度告警、未标记 `⚠短` 的持仓明确标注无赎回费问题
- **State Wrapper 四层注意力锚点**：第一优先(硬数据+风控) → 第二优先(财富目标) → 第三优先(持仓) → 第四优先(待办)，视觉分隔符防 AI 注意力稀释
- **History 降采样增强**：多格式摘要提取兜底（`[本轮摘要]/摘要/总结/核心结论` + 首句 fallback）、更强的雷达噪音清洗
- **第五层批量巡检补回**：重构时丢失的 `INSPECTION_ROUTINE` 恢复，含前置打分/战术拦截/防污染墙/排版 6 步骤
- **第四层步骤四·双层自检回顾**：第 1 层 Score vs OHLC（模型是否钝化）+ 第 2 层 P&L vs 大盘 Beta（持仓是否风格错配），含 T+1 净值延迟陷阱免责声明和归因隔离铁律
- **打分快照新增量价+P&L 字段**：`turnoverYi/upCount/downCount/volumeRatio/f3Flags` + `totalValue/totalProfit/overallXirr`，一调用 `get_recent_scores` 同时获取分数趋势和盈亏趋势
- **Dev 模式完整 AI 思考日志**：`chat-pipeline.js` 使用 `console.groupCollapsed` 完整输出每轮思考过程、中间文本、工具结果、最终输出，折叠展示免刷屏

### 修复
- **持仓穿透数据严重失真**：东方财富 API `JZBL` 返回正确百分比值（如 `"0.99"`=0.99%），但 `normalizePct()` 将 <1 的值 ×100（0.99→99%）。移除错误归一化函数
- **持仓穿透百分比语义混淆**：标注 `占净值比例(JZBL)` 而非 `占股票市值比`，AI 不再误判权益仓位
- **穿透数据源盲区**：东方财富 fallback 不再限于 `proxyMode==='custom'`，全代理模式均尝试。蛋卷 API `performance_bench_mark` 解析为权益仓位锚点
- **穿透行业分类全凭 AI 猜**：东方财富 API 自带 `INDEXCODE/INDEXNAME`（申万行业）优先使用，本地 `STOCK_SECTOR_MAP`(~120 只)降级为 fallback。未利用的 `PCTNVCHGTYPE/PCTNVCHG`（调仓方向/幅度）现已输出
- **穿透+备忘同时出现**：AI 同一轮调 `update_fof_dictionary` + `update_decision_memo` 导致备忘写入 AI 估算的仓位。System Prompt 新增铁律：穿透同一轮禁写该基金备忘
- **FOF 字典卡片 AI 估算仓位覆盖真实数据**：`handleFofDictWrite` 改为用户手动填写五栏(股票/债券/基金/现金/其他%)后 `equityRatio=stockPct+fundPct`，覆盖 AI 估算。ActionCard 新增五栏输入框，留空不覆盖 Firestore
- **`renderMarkdown` 范围格式误着色**：`73-77%`、`~1-2%` 中的 `-X%` 被错误着色为绿色。加 `(?<![\d~])` 负向断言排除，同时 `whitespace-nowrap` 防止范围值中间断行
- `get_realtime_fund_data`/`get_batch_fund_data` 丢弃 `type_desc`/`risk_level`/`totshare`/`manager_name`/`max_drawdown`/`fund_rates` → 现全部注入（零额外 HTTP）
- `useWebSearch` 链路断裂：core→orchestrator 传递但未解构 → 移除无效传递
- `modules.js`/`context-router.js` 死代码清理
- 分隔线从 12 条减至 7 条，仅保留模块边界处

---

## [1.5.1] — 2026-06-09

### 变更
- **AI 引擎全面重构**：核心对话引擎 `core.js` 从 653 行单体架构拆分为模块化架构
  - `orchestrator.js` — 编排器，收口所有 AI 入口，组合 Adapter + Pipeline + Context
  - `adapters/` — AI 厂商适配层（Gemini / OpenAI / DeepSeek / SiliconFlow），统一 `buildRequest` / `parseText` / `extractToolCalls` / `applyToolResults` 接口
  - `pipelines/chat-pipeline.js` — 工具调用循环管道，独立于厂商协议
  - `context-manager.js` — 按意图精准选取注入数据的上下文管理器（4 个 Selector + Token 预算控制）
  - `context-router.js` — 双层意图路由器（FastPath 关键词零成本 + SlowPath 轻量 AI 5s 超时兜底）
  - `tools/registry.js` — 工具注册中心，策略模式映射 22 个 handler
  - `prompts/system.js` — System Prompt 独立模块，纯静态无参数
  - `prompts/wrapper.js` — 最新状态注入 Wrapper
  - `prompts/modules.js` — 技能库 + 打分系统按需注入模块
  - `context/history.js` — 历史消息降采样（今日完整 + 跨日摘要压缩）
- 旧架构入口 `chatWithPortfolioAI` 保留为向后兼容委托层，无缝过渡
- `fetchAdvancedMarketData` 新增 `depth` 参数（`'full'` / `'summary'`），摘要模式跳过 ~20 次分时+K线请求，大幅减少 Token 输入
- `precompute.js` 新增 `getDataCache` 模块级缓存，同日内持仓状态不变时复用预计算结果

### 修复
- **修复设置数据丢失问题**：`firestore.rules` 中 `settings/general` 的 `targetAmount` / `targetDate` 强制约束导致 `merge:true` 局部更新被整批拒绝，API Key 等敏感字段从未成功持久化。规则放宽为 `allow read, create, update, delete: if isOwner(userId)`
- **修复敏感字段被空字符串覆盖**：`ProxySettingsModal` 保存时无条件写入所有字段（含空字符串 API Key），现剔除敏感字段的空字符串值后写入，防止 `merge:true` 覆盖 Firestore 中的真实值
- `handleSaveSettings` 写入失败时新增 toast 错误提示，避免静默失败

---

## [1.5.0] — 2026-06-06

### 新增
- System Prompt 三层动态加载架构：Core（防幻觉+记忆+数据洁癖）/ Skill Library（技能库+工具铁律）/ Scoring（双核打分+CIO矩阵），按需注入降低 Token
- 本地意图路由器（`intent-router.js`）：5 层分类引擎（短消息/显式关键词/纯轻量/分析兜底/资产检测），智能判断是否加载技能库
- 大盘雷达与打分系统联动：雷达 ON → 始终加载 Scoring，雷达 OFF → 始终不加载，消除误判风险
- 本地预计算层（`precompute.js`）：赎回费陷阱/集中度风险/大类配置偏离等规则化计算前置，紧凑表格替代冗长文本注入
- 历史对话降采样引擎（`downsampleHistory`）：同日轮次完整保留（可配置上限），跨日轮次压缩为 AI 摘要，雷达指令去重
- AI 跨日摘要协议（`[本轮摘要]` / `AI摘要:`）：每轮 AI 输出末尾生成摘要，次日通过 `[跨日]` 标记注入，保留操作承诺、丢弃过时市场判断
- Console 模块加载可视化报告：每次 AI 调用输出彩色表格展示 Core/Skill/Scoring 加载状态、Token 节省量、分类置信度
- 低置信度分类警告框：意图路由器在置信度 `low` 时输出红色醒目标识，引导反哺规则
- 生产环境 `debugLog` 工具（`import.meta.env.DEV` 门控）：17 处 `console.log` 替换为生产自动移除
- 基金分类统一模块（`fundClassifier.js`）：`RULES` 数组驱动 `classifyFundType` / `classifyAssetClass` / `classifyFundTypeShort` 三合一

### 变更
- System Prompt 从单一 13,800 token 巨块拆为 3 个纯静态函数：Core ~1,950 tok / Skill ~2,000 tok / Scoring ~3,750 tok
- Skill Library / Scoring 从 System Prompt 移出，改为按需作为静态 user message 注入 → DeepSeek 缓存独立命中
- Core Prompt 新增规则 13-15：跨日历史可靠性分层（操作承诺引用 ✅ / 市场判断引用 ❌）、回复格式铁律（结论先行+压缩评分格式）、雷达状态绝对权威
- Scoring Prompt 压缩 41%：移除触发条件判断（已由 radarEnabled 控制）、CIO 矩阵 A/B/C 三标签表格化、第五层巡检流程简化为单行流程链
- Core Prompt 新增输出简洁性指令：F1:28/35 F2:18/25 压缩格式、多基金单行格式、禁填充词
- `get_recent_scores` 工具被设定为动量修正和滞回锁定的唯一数据源（禁止从对话文本推断）
- `analyzeHoldingPeriods` 引用从 `core.js` 移至 `precompute.js`，core.js 不再直接调用
- `onSnapshot` 对话消息监听改为 `getDoc` 一次性读取，切断 AI 工具调用期 12+ 次 Firestore 回环
- 静默 `catch(() => {})` 全部替换为 `catch(err => console.warn(...))`，数据持久化失败可追溯
- `App.jsx` 抽出 `PortfolioSummaryCards` 和 `RankingPanels` 两个 `React.memo` 组件，阻断无关状态渲染传播
- `PortfolioChat.jsx` 抽出 `persistConversation()` 统一 Firestore 写入，消除 6 处重复模板
- `handleConfirmAction` 依赖数组移除 `activeConvId`（改为 `activeConvIdRef.current`），消除切对话时的级联重建

### 修复
- 修复 Gemini 工具循环 `body.messages` 与 `body.contents` 状态不一致：改为独立 `toolMessages` 变量，`delete body.messages` 仅清除不重建
- 修复 `actionHandlers.js` `handleDataConfirmation` 中 `formData.extractedText` 可能为空时不校验直接发给 AI 的问题（新增空数据防御）
- 修复 `helpers.js` XIRR 二分法上限 `high=10000`（1,000,000%）导致精度溢出的潜在风险 → 降为 `high=10`（1000%）
- 修复 `App.jsx` 死代码 `ref={el => el && setProxyModalOpen && null}` → 移除
- 修复 `buildChatSystemPrompt` DeepSeek 路径每次拼接"数据洁癖"规则导致缓存失效 → 移入 Core Prompt 静态层
- 修复雷达指令去重正则过于激进：`纯净模式` 和 `关闭大盘雷达` 裸词移除，仅保留完整系统模板匹配
- 修复 `[本轮摘要]` 正则仅捕获到首行 → 改为捕获到段落分隔 `\n\n`
- 修复跨日摘要截断用户消息 → 用户消息全文保留，仅丢弃助理分析正文

### 性能
- **Token 节省**：轻量场景（查净值/记账）输入从 ~29,800 → ~12,300 tok（-59%），FULL 场景跨日 ~18,100 tok（78% 缓存率）
- **渲染优化**：`useBaseFundsData` + `usePortfolioStats` 合并为 `useFundMetrics`，XIRR 同步计算消除 `setTimeout(0)` 双重重算
- **代码消重**：基金分类 4→1、Firestore 写入 6→1、rulebook 注入 3→1，净消除 ~250 行重复/死代码

---

## [1.4.3] — 2026-06-05

### 新增
- 基金赎回费率编辑器（FundEditor 可折叠卡片）：支持自定义天数阈值 + 对应费率，覆盖任意基金的实际赎回规则
- 持仓分层分析引擎（`analyzeHoldingPeriods`）：基于 FIFO 原则将当前持仓按买入批次拆分为持有天数区间，精确计算各层金额
- AI 赎回费精确计算：每只基金的持仓分层 × 真实费率注入 AI 上下文，AI 可输出逐档费用明细和总预估赎回费
- System Prompt 新增"短期赎回绝对亏损红线"：强制 AI 在建议卖出 <30 天份额前对比下跌风险与赎回费确定性损耗
- 打分历史面板支持固收打分展示：权益分和固收分双标签并列，CIO 判定区分权益/固收指令

### 变更
- 行情数据源迁移：`push2.eastmoney.com` 全部替换为 `qt.gtimg.cn`（指数现价/债市数据）和 `hq.sinajs.cn`（期货数据），消除 502 错误
- 打分快照存储简化：移除冗余调试日志和探针，保留必要错误处理
- AI 对话消息气泡增加 `min-w-0 overflow-x-auto`，超宽表格在气泡内横向滚动而非撑开对话框
- System Prompt 中赎回费率相关描述精简，`store_scoring_snapshot` 指令从 4 处合并为 3 处

### 修复
- 修复 `chat_convs` 写入失败：消息对象中 `actions: undefined` 改为条件属性展开，Firestore 不再拒绝 undefined 字段
- 修复打分历史面板不显示：`absolute` 定位改为 `fixed`，与遮罩层对齐
- 修复 Tooltip 在打分面板打开后残留：Tooltip 添加动态 `key`，面板状态变化时强制重新挂载
- 修复打分面板打开无动画：`scoringHistory` 改为同步挂载空数组触发 FLIP，异步填充数据
- 修复 `rate > 0` 导致 0% 费率被误判为"未设置"

---

## [1.4.2] — 2026-06-04

### 新增
- 聊天消息时间戳：每条消息记录发送/接收时间，默认隐藏，鼠标悬停显示（格式：今天/昨天 + HH:mm），向下兼容旧消息
- 静态复利推演卡片烟花动画（`FireworksBackground` 组件）：Canvas 真实物理粒子系统 + 加法混合渲染

### 变更
- 烟花动画含 6 种真实爆炸类型（牡丹/垂柳/菊花/光环/棕榈/频闪），流光拖尾非圆点渲染，星芒闪光，全卡片高度随机位置
- 烟花火箭轨迹加入曲率漂移 + 正弦摆动，非匀速直线
- 烟花发射频率约 0.7s~2.0s 间隔，循环播放

### 修复
- 修复编辑对话标题后发送消息导致标题被覆盖的 Bug：`handleSend` 内 3 处 `setDoc` 调用统一改为仅在新建对话时写入 `title`，已有对话省略 `title` 字段以保留用户手动编辑的标题
- 修复 AI 修改待办计划标题后点击确认不生效的 Bug：`handleTodoCRUD` 更新 payload 补充 `fundName`、`actionType`、`fundCode` 三个字段

---

## [1.4.1] — 2026-06-03

### 新增
- 项目根目录新增 `DEVELOPMENT.md`（PRD + ADR + 需求迭代记录）
- 项目根目录新增 `AGENTS.md`（AI 开发者指南）
- 项目根目录新增 `CHANGELOG.md`（本文件）

---

## [1.4.0] — 2026-05-27

### 新增
- 多对话管理：新建 / 切换 / 删除 / 重命名对话，数据存储在 `chat_convs/{convId}`
- 对话跨设备同步：所有对话实时同步至 Firestore，任意设备登录即可恢复
- AI 参数面板：支持运行时调节 Temperature、Top-P、最大输出 Token、聊天历史窗口、工具调用最大轮次
- DeepSeek / SiliconFlow 推理深度控制（`reasoningEffort`: disabled/high/max）
- AI 思考过程可视化：可折叠面板展示推理链，支持多轮思考合并
- 文件上传解析：支持图片 + PDF，Gemini Vision API OCR → AI 自动分析
- 一键分享 PDF：AI 回复可导出为排版精美的 A4 打印文档
- 金额隐私模式：一键切换全局金额显示/隐藏，敏感输入框自动切换 `type="password"`
- 自定义 AI 提供商：支持填写任意 OpenAI 兼容 API（以 `custom_` 前缀识别）

### 变更
- 对话存储路径从 `chat/history` 迁移至 `chat_convs/{convId}` 集合，启动时自动迁移旧数据
- 多对话架构使用 `activeConvIdRef` + `pendingConvIdRef` 双 ref 防止不同对话的 AI 回复串线
- 行情卡片升级为双图层 Tick 动画：底层持久涨跌色 + `::after` 伪元素独立透明度闪烁
- 移动端放大镜穿透问题彻底修复：开屏移除前物理摧毁 DOM 节点尺寸和位置

### 修复
- 修复切换对话时旧对话消息残留的串线 Bug
- 修复 Firestore 设置未就绪时提前拉取行情导致的虚假失败
- 修复暗黑模式下日期选择器图标不可见（`filter: invert(1)`）

---

## [1.3.0] — 2026-04-18

### 新增
- 双核多周期打分卡完整重构：权益引擎 4 因子（35+25+25+15） + 固收引擎 2 因子（50+50）
- 动量修正项（±10 分）：基于上一交易日得分与价格趋势的动态修正
- 滞回锁定（Hysteresis Lock）：35 分边界 ±5 分缓冲带，防止 T+1 延迟导致的反复横跳
- 全局前置否决：因子 1 < 7 分（权益）/ < 10 分（纯债）触发无条件减仓指令
- 战术警戒区：因子 1 处于 7-12 分（权益）/ 10-20 分（纯债）标注"不加仓"
- 天量掩护出货拦截器：三条件触发 F3 自动否决（量能阈值动态校准）
- 4 个宏观/估值新工具：`get_index_valuation`、`get_cross_asset_data`、`get_bond_market_data`、`get_macro_data`
- 多数据源容灾：行情数据源腾讯/新浪/雪球三源自动切换，5 CORS 代理节点轮换
- 净值数据源扩展到四源：天天基金 JSONP / 新浪财经 / 天天 Web 历史 / 蛋卷基金
- 法定节假日自动识别：从 jsDelivr CDN 同步中国法定假日数据，周末 + 节假日双重过滤
- 周五例行巡检黄条提醒：检测周五 + 未巡检，弹窗引导一键触发 AI 批量巡检

### 变更
- AI System Prompt 从单一长文本重构为五层架构（防幻觉 → 记忆 → 技能 → 打分 → 巡检）
- 防幻觉协议升级：新增资金交收物理规律校验（T+2~T+4）、在途资产信任机制
- `checkIsTradingTime` 函数升级为支持法定节假日拦截
- Prompt 中的动态变量（财富目标等）从 System Prompt 移至 `buildLatestStateWrapper` 每轮注入

### 修复
- 修复 AI 在无行情数据时仍强行打分的问题（新增雷达状态检查）
- 修复纯债基金被错误套用权益打分标准的问题
- 修复非交易时段轮询持续浪费请求的问题

---

## [1.2.0] — 2026-03-22

### 新增
- XIRR 年化收益率计算：逐基金 + 全盘综合，支持异步计算不阻塞 UI
- 三大排行榜：按 XIRR / 累计收益 / 简单收益率排序，金银铜牌视觉
- 大类资产配置饼图（DonutChart 组件，纯 SVG 实现）
- 单一持仓比重分布图
- 正向盈利贡献分布图
- 财富目标复盘面板：Alpha 超额收益、偏离基准轨迹、缺口金额、所需月收益
- 静态复利推演卡片：基于当前 XIRR 推演目标日期的预期资产规模
- 回本周期估算：当前亏损状态下自动计算以基准年化回本所需天数
- FOF X-Ray 穿透雷达引擎：底层持仓穿透 → 申万行业归类 → 全局集中度预警
- `calculatePortfolioXRay` 双核重构版：接收云端 FOF 字典替代硬编码常量
- QuickChart 图表生成工具升级：支持水平线/色带/竖直线/趋势线/数据点标注 5 种标注
- SmartInput 组件：公式计算（`=` 前缀触发的安全四则运算）+ 日期输入 + 失焦自动评估

### 变更
- 基金数据流重构：`useBaseFundsData` → `usePortfolioStats` 两层 Hook 分离基础计算与衍生统计
- `helpers.js` 新增 `extractFundHoldings`（前十重仓提取）和 `calculatePortfolioXRay`（FOF 穿透）
- 空闲资金输入框从设置弹窗提升至主界面财富目标卡片

### 修复
- 修复手动模式基金归档后当前市值未归零的问题
- 修复 `safeMathEval` 对负数开头的表达式解析错误

---

## [1.1.0] — 2026-02-10

### 新增
- AI 投资 Copilot 聊天面板（`PortfolioChat` 组件）
- 三大 AI 模型支持：Gemini（含 Google Search 工具）/ DeepSeek（含推理过程）/ 硅基流动
- 22 个 Function Calling 工具（详见 `tools-definitions.js`）：
  - 净值数据：单基 / 批量 / 历史序列 / 多基横向对比（含相关性矩阵 + 综合评级）
  - 市场行情：分时路径 / 多周期 K 线 OHLC
  - 资讯搜索：新浪多栏目快讯聚合 / Tavily / Exa / Serper
  - 实体操作：批量记账 / 待办管理 / 战略备忘录写入 / FOF 字典入库
  - 可视化：QuickChart 图表生成（线图/柱状图/色带/趋势线/双Y轴）
  - 量化计算：Web Worker 沙箱执行 JS 代码
- 三层战略记忆系统：财富宪法 / 宏观定价锚点 / 资产身份挂牌 + 纪律红线
- 联网搜索开关 + 大盘雷达开关（对话面板底部工具栏）
- AI 操作卡片交互：数据确认卡 / 交易录入卡 / 备忘录卡 → 用户确认后写入 Firestore
- 7 日赎回惩罚费自动风控：`calculate7DayPenalty` 拦截短线卖出
- AI 生成的 Markdown 渲染引擎（`renderMarkdown.jsx`）：自研块级解析器 + DOMPurify 净化
- Token 估算日志：每次 API 调用打印预估输入 Token 数 + 推理模式
- 多通道推送支持：Cloudflare Worker 通过飞书卡片 / 钉钉机器人 / Ntfy 发送巡检报告

### 变更
- 聊天组件从 App.jsx 内联代码拆分为独立模块 `Chat/` + `utils/ai/`（10 个文件）
- System Prompt 从单文件硬编码重构为 `prompts.js` 模板函数，支持按场景分层注入
- 工具分发从 if-else 链重构为策略模式（`tool-handlers.js`）
- Ntfy 推送渠道名称从 `settings.ntfyChannel` 改为 `settings.ntfyTopic`（兼容直接填 URL）

### 修复
- 修复 Gemini 模型 Function Calling 中 `additionalProperties` 字段不兼容的问题（sanitizeSchema）
- 修复 Gemini 工具调用后 `body.messages` 与 `body.contents` 状态不一致的问题

---

## [1.0.0] — 2026-01-15

### 新增
- Firebase Authentication 邮箱密码登录
- 基金持仓管理：新增 / 编辑 / 删除
- 双层记账模式：自动模式（基金代码 + 份额追踪净值）/ 手动模式（自由表达式计算市值）
- 完整交易流水：买入、卖出、分红、手续费等类型
- 清仓归档：已清仓资产移入历史区，保留完整收益数据
- 实时净值拉取：天天基金 JSONP 接口
- 五大核心指数实时行情：上证、深证、创业板、10 年期国债 ETF、30 年期国债 ETF
- 行情自动刷新：交易时段内 5 秒轮询
- 全盘统计卡片：投资总净本金 / 全盘持仓总值 / 累计盈亏 / 简单收益率
- 基金详情弹窗（蛋卷基金 API 拉取配置信息）
- 数据导出为 JSON 本地备份
- 全局设置面板
- 暗黑模式（class 驱动 + 手动切换）
- PWA 支持：Service Worker 离线缓存 + 可安装到桌面
- Capacitor Android APK 打包
- Cloudflare Worker 云端定时巡检：UTC 6/7/14/15 四个 Cron 触发器
- 机器交易信号：止盈池 / 超跌池 / 劣质止损池自动判定
- 利润快照 KV 持久化：区间盈亏自动计算
- 飞书卡片富文本推送
- Apple 风格 UI：毛玻璃导航栏、弹簧动画、微阴影、自定义滚动条
- 响应式布局：Tailwind CSS 完整适配移动端 + PC 端
- Safe Area 适配：刘海屏和底部指示条
- 开屏动画：SVG 脉冲 logo + 加载进度条
