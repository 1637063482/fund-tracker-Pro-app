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
| AI Copilot | 22 工具调用、双核打分、三层记忆、多模型切换 | P0 |
| 组合分析 | XIRR 计算、三大排行榜、FOF 穿透、财富目标复盘 | P1 |
| 云端巡检 | CF Worker 定时触发、多通道推送、机器信标 | P1 |
| 待办系统 | AI 自动生成交易计划、7 天赎回惩罚拦截 | P1 |
| 跨平台 | PWA + Android APK (Capacitor) | P2 |

### 1.4 技术架构

```
┌──────────────────────────────────────────────────┐
│                   React 19 + Vite 8               │
│                (Frontend SPA / PWA)                │
├──────────────────────────────────────────────────┤
│  UI Layer: Tailwind CSS 3 + Lucide React          │
│  State: React Hooks + Firestore Realtime          │
│  Auth: Firebase Auth (email/password)              │
│  DB: Firestore (funds, settings, todos, chat)     │
├──────────────────────────────────────────────────┤
│  AI Engine: Gemini / DeepSeek / SiliconFlow        │
│  Search: Tavily / Exa / Serper                     │
│  Chart: QuickChart.io + Custom SVG Donut          │
│  Sandbox: Web Worker JS execution                 │
├──────────────────────────────────────────────────┤
│  Mobile: Capacitor 8 (Android) + PWA              │
│  Cloud: Cloudflare Worker (KV + Cron)              │
│  Push: Ntfy / 飞书卡片 / 钉钉机器人               │
└──────────────────────────────────────────────────┘
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

**日期**: v1.2
**决策**: 评分系统分为权益引擎（4 因子 100 分）和固收引擎（2 因子 100 分），严格禁止交叉使用。
**理由**:
- 权益和固收的估值逻辑完全不同
- 混合使用会导致纯债基金套用权益打分标准
- 滞回锁定（Hysteresis Lock）防止 35 分边界反复横跳
**代价**: Prompt 长达约 3000 tokens，且每次打分前需调用 4-5 个工具获取数据

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

## 五、AI System Prompt 架构（v1.5 重构）

### 三层动态加载模型

```
┌─────────────────────────────────────────────────────┐
│  Core Prompt (~1,950 tok)                           │
│  始终加载 | messages[0] | DeepSeek 100% 缓存命中    │
│  · 防幻觉协议（净值唯一通道/T+1/资金交收）          │
│  · 活体战略记忆（双层结构/动态验证/反讨好）         │
│  · 系统变量 + 数据洁癖 + 历史引用规则 + 格式铁律    │
├─────────────────────────────────────────────────────┤
│  Skill Library (~2,000 tok)                         │
│  意图路由器判定 | 静态 user message 注入            │
│  · 22 工具 × 6 分类详细说明                         │
│  · 跨工具调用铁律（防海选/防死循环/防同质化/穿透链）│
├─────────────────────────────────────────────────────┤
│  Scoring System (~3,750 tok)                        │
│  雷达 ON → 始终加载 | 雷达 OFF → 始终不加载         │
│  · 双核打分卡（权益4因子 + 固收2因子）              │
│  · CIO 矩阵（表格化 A/B/C 三标签）                  │
│  · 全局否决 + 滞回锁定 + 动量修正 + 巡检流程        │
└─────────────────────────────────────────────────────┘
```

### 上下文组装流程

```
1. downsampleHistory(chatHistory)
   ├─ 同日轮次: 完整保留（默认最近 6 轮）
   ├─ 跨日轮次: AI 摘要 + 用户问题全文
   └─ 雷达指令: 历史中的旧指令剥离

2. buildRulebookMessages(intent)
   ├─ needsScoring → 注入 Scoring rulebook
   └─ needsSkillLibrary → 注入 Skill rulebook

3. messages = [system(Core)] + [rulebooks] + [history] + [stateWrapper]
   └─ Core 和 rulebooks 均为纯静态字符串 → DeepSeek 缓存命中
```

### Token 预算（v1.5）

| 模块 | Tokens | 缓存 |
|------|--------|------|
| Core | 1,947 | 🟢 永久 |
| Skill Library + 典礼帧 | 2,054 | 🟡 场景 |
| Scoring + 典礼帧 | 3,811 | 🟡 场景 |
| Tools JSON | 6,307 | 🟢 永久 |
| **FULL 模式可缓存** | **14,119** | **78%** |

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
| 2026-06 | v1.5.0 | AI 架构重构：三层动态Prompt/意图路由/历史降采样/预计算/消重/缓存优化 | wangwang |
| 2026-06 | v1.4.3 | 赎回费率系统、数据源迁移、打分快照修复 | wangwang |
| 2026-05 | v1.4.0 | 多对话管理、AI 参数面板、金额隐私模式、文件解析 | wangwang |
| 2026-04 | v1.3.0 | 双核打分卡重构、多数据源容灾、防幻觉升级 | wangwang |
| 2026-03 | v1.2.0 | FOF 穿透、财富复盘、QuickChart 升级 | wangwang |
| 2026-02 | v1.1.0 | AI Copilot 核心、22 工具、三层记忆 | wangwang |
| 2026-01 | v1.0.0 | 初始版本：记账、行情、Firebase 集成 | wangwang |
