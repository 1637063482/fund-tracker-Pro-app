# AGENTS.md — AI 开发者指南

本文档为后续 AI 开发者（Claude、Copilot、Cursor 等）提供项目结构说明和开发规范。

---

## 一、项目概览

| 项目 | 说明 |
|---|---|
| 名称 | Fund Tracker Pro |
| 类型 | React 19 SPA (PWA + Android APK) |
| 包管理 | npm |
| 构建 | Vite 8 |
| UI | Tailwind CSS 3 + Lucide React |
| 后端 | Firebase Auth + Firestore (BaaS) |
| AI | Gemini / DeepSeek / SiliconFlow / 自定义 OpenAI 兼容 |
| 移动端 | Capacitor 8 (Android) |

---

## 二、目录结构与文件用途

```
fund-tracker-pro/
├── index.html                         # HTML 入口：viewport、PWA manifest、开屏动画、Service Worker 注册
├── package.json                       # 依赖声明（react/vite/firebase/lucide-react/dompurify）
├── vite.config.js                     # Vite 构建配置（base: './' 相对路径，确保 PWA 正确加载）
├── tailwind.config.js                 # Tailwind 主题：自定义色板(positive/negative)、Apple 风格阴影、弹簧动画
├── postcss.config.js                  # PostCSS：Tailwind + Autoprefixer
├── eslint.config.js                   # ESLint：React Hooks 规则
├── capacitor.config.json              # Capacitor 打包配置
│
├── DEVELOPMENT.md                     # 项目 PRD、迭代记录、关键架构决策
├── AGENTS.md                          # 本文件
│
├── public/                            # 静态资源（构建时直接复制，不经过 Vite 处理）
│   ├── sw.js                          # PWA Service Worker：离线缓存策略
│   ├── manifest.json                  # PWA Web App Manifest
│   └── icon-*.png                     # PWA 各尺寸图标
│
├── assets/                            # 项目设计素材与原始图标
├── icons/                             # Capacitor 原生应用图标（多尺寸）
├── android/                           # Capacitor Android 原生壳工程（Gradle）
│
└── src/                               # === 前端源代码 ===
    ├── main.jsx                       # 应用入口：ReactDOM.createRoot + StrictMode + ErrorBoundary
    ├── App.jsx                        # 主组件（~1209 行）：全局状态、认证、行情轮询、所有子组件编排
    ├── worker.js                      # Cloudflare Worker 脚本：定时巡检、多通道推送、利润快照
    ├── index.css                      # 全局样式：Apple 设计 Token、组件工具类、动画关键帧
    │
    ├── config/
    │   ├── constants.js               # Firebase 配置 + PROXY_NODES 列表 + ASSET_NAMES 映射
    │   └── firebase.js                # Firebase SDK 初始化（auth + db 实例导出）
    │
    ├── contexts/
    │   └── PrivacyModeContext.jsx      # 金额隐私模式 Context（showAmounts + togglePrivacy）
    │
    ├── hooks/                         # 自定义 React Hooks
    │   ├── useBaseFundsData.js        # 基金基础数据计算：净投入、市值、盈亏、XIRR 现金流准备
    │   ├── usePortfolioStats.js       # 投资组合衍生统计：饼图、排名、大类资产、财富复盘
    │   ├── usePrivacyFormat.js        # 金额格式化（根据隐私模式显示/隐藏）
    │   ├── useScrollLock.js           # 弹窗打开时禁止背景滚动（嵌套调用安全）
    │   ├── useFocusTrap.js            # 模态框焦点陷阱（Tab 键焦点循环，无障碍）
    │   └── useModalAnimation.js       # FLIP 动画 Hook：弹窗从触发按钮位置弹性展开
    │
    ├── services/                      # 外部数据拉取服务（无状态，纯函数）
    │   ├── navFetcher.js              # 基金净值拉取：天天(JSONP)/新浪(GBK)/天天Web/蛋卷四源
    │   ├── marketFetcher.js           # 市场行情拉取：腾讯/新浪/雪球三源 + CORS 代理轮换
    │   └── fileParser.js              # 文件解析：Gemini Vision API OCR（支持图片 + PDF）
    │
    ├── utils/                         # 工具函数
    │   ├── helpers.js                 # 核心工具：safeMathEval(递归下降)、calculateXIRR、formatMoney/Percent、checkIsTradingTime、extractFundHoldings(穿透)、calculatePortfolioXRay(FOF)
    │   ├── holidayCalendar.js         # 法定节假日判定：周末 + 从 jsDelivr CDN 同步的中国假日数据
    │   ├── renderMarkdown.jsx         # Markdown → React 组件：自研块级解析器、表格、代码块、折叠思考、Print/PDF 内联样式渲染
    │   ├── feishuMarkdown.js          # 飞书卡片格式工具
    │   ├── ai.js                      # AI 模块重导出入口（向后兼容）
    │   └── ai/                        # AI 引擎子模块（10 个文件）
    │       ├── index.js               #   统一导出聚合入口
    │       ├── core.js                #   核心对话引擎：AI 请求封装、单基诊断、组合体检、多轮聊天（含 Gemini/OpenAI 双协议工具调用循环、Token 估算日志、推理过程提取）
    │       ├── providers.js           #   AI 供应商解析：Gemini / DeepSeek / SiliconFlow / 自定义 OpenAI
    │       ├── proxy.js               #   代理 URL 构建：CORS 前缀 + 基金代码转换
    │       ├── fifo.js                #   7 日内短线赎回惩罚费计算
    │       ├── prompts.js             #   提示词模板（~4000 行）：System Prompt 五层架构、单基诊断、组合体检、最新状态注入 Wrapper
    │       ├── market-data.js         #   行情数据抓取：分时路径、多周期 K 线、盘口数据
    │       ├── tool-handlers.js       #   工具执行器：22 个 handler 的策略模式分派（含 QuickChart 图表生成）
    │       ├── tools-definitions.js   #   工具注册表：所有 Function Calling 的 JSON Schema 定义
    │       ├── search-engines.js      #   搜索适配器：Tavily / Exa / Serper 统一封装
    │       └── financial-news.js      #   财经快讯聚合：新浪多栏目 + 搜索引擎并行拉取去重
    │
    └── components/                    # React 组件
        ├── Auth/
        │   └── LoginScreen.jsx        # 登录界面：邮箱密码登录 + 主题切换
        │
        ├── Chat/
        │   ├── PortfolioChat.jsx      # AI 对话面板（~1276 行）：多轮聊天、联网搜索、大盘雷达、文件上传、AI 参数面板、多对话管理、周五巡检、分享 PDF、备忘录编辑
        │   ├── ActionCard.jsx         # AI 操作卡片 UI：数据确认 / 交易录入 / 备忘录交互表单
        │   └── actionHandlers.js      # 操作处理器：按 toolType 分发（data_confirmation/memo/todo/fof_dict/ledger）
        │
        ├── Dashboard/
        │   ├── FundTable.jsx          # 持仓表格：双 Tab（投资组合 + 清仓历史）+ 排序
        │   ├── TodoListCard.jsx       # 待办清单卡片：增删改 + 优先级筛选
        │   └── MarketTimeIndicator.jsx # 市场时钟：A 股交易时段状态指示
        │
        ├── Fund/
        │   ├── FundEditor.jsx         # 基金编辑器：手动/自动双模式 + 交易流水 + 清仓归档
        │   ├── FundProfileModal.jsx   # 基金详情弹窗：AI 单基深度诊断（缓存 + 重新生成）
        │   └── SmartBadges.jsx        # 智能标签：基金类型自动渲染分类徽章
        │
        ├── Portfolio/
        │   └── PortfolioAnalysisModal.jsx # 组合分析弹窗：AI 全盘体检 + FOF X-Ray + 风险评级
        │
        ├── Settings/
        │   └── ProxySettingsModal.jsx  # 全局设置面板：AI/数据源/代理/刷新/通知等全部参数
        │
        └── UI/                        # 通用 UI 组件库
            ├── AnimatedNumber.jsx     #   数字滚动动画：逐位渐变过渡
            ├── DonutChart.jsx         #   环形图：纯 SVG 饼图/圆环 + 中心标签 + 悬停交互
            ├── SmartInput.jsx         #   智能输入：=公式计算 + 日期输入 + 失焦评估
            ├── ErrorBoundary.jsx      #   错误边界：未处理异常捕获 + 降级 UI + 重试
            ├── ImageModal.jsx         #   图片预览：双指缩放 + 滚轮缩放 + 拖拽平移
            ├── AppleSelect.jsx        #   选择器：Portal 下拉 + 键盘导航 + 外部点击关闭
            ├── Toast.jsx              #   全局通知：success/error/info + 自动排队
            ├── AnimatedModal.jsx      #   通用模态框：FLIP 过渡 + 遮罩层封装
            └── Tooltip.jsx            #   悬浮提示：Portal 渲染 + 智能定位
```

---

## 三、开发规则

### 3.1 代码风格

1. **React 组件**：使用函数组件 + Hooks，禁止 class 组件。
2. **组件文件**：一个文件一个组件（默认导出），文件名与组件名一致。
3. **注释风格**：文件头必须有一行中文注释说明文件用途。行内注释用 `//`。
4. **命名规范**：
   - 组件：PascalCase（`FundEditor`、`DonutChart`）
   - 函数/变量：camelCase（`fetchFundNavService`、`fundNavs`）
   - 常量：UPPER_SNAKE_CASE（`PROXY_NODES`、`ASSET_NAMES`）
   - CSS 类名：kebab-case（`apple-card`、`table-row-lift`）
5. **导入顺序**：React 核心 → 第三方库（firebase/lucide）→ 项目内部模块 → 组件。用注释 `// ---` 分隔功能区。

### 3.2 状态管理规则

1. **全局状态**：App.jsx 是唯一的状态管理中心，所有业务状态在此定义，通过 props 向下传递。
2. **Firestore 实时同步**：使用 `onSnapshot` 而非 `getDocs` 实现数据实时同步。返回的 unsubscribe 函数必须在 useEffect 中正确清理。
3. **设置保存**：设置项修改后通过 `setDoc(..., { merge: true })` 增量更新（不要覆盖整个文档）。输入框修改使用 800ms 防抖自动保存。
4. **异步 XIRR**：XIRR 计算使用 `setTimeout(..., 0)` 异步执行，避免阻塞 UI 渲染。
5. **双 ref 防串线**：多对话场景下使用 `activeConvIdRef` + `pendingConvIdRef` 双 ref 防止 AI 回复串到错误对话。

### 3.3 AI 模块规则

1. **System Prompt 架构**：五层结构不可随意更改顺序。第一层防幻觉协议必须在最前面。利用 DeepSeek 上下文缓存特性，静态内容放 System Prompt，动态内容用 `buildLatestStateWrapper` 注入。
2. **新增 Tool**：
   - 在 `tools-definitions.js` 中注册 JSON Schema
   - 在 `tool-handlers.js` 中添加 handler 函数
   - 在 `core.js` 的 `TOOL_LABELS` 中添加状态提示
   - 在 `prompts.js` 的 System Prompt 工具列表中添加说明
3. **禁止在 Prompt 中撒谎**：Prompt 中的工具能力描述必须与实际实现完全一致。新增工具后务必更新 Prompt 文档。
4. **模型兼容**：新增功能需兼容 Gemini（functionDeclarations）和 OpenAI（tools）两种协议。注意 Gemini 不支持 `additionalProperties`，enum 值必须为字符串。
5. **Token 估算**：`estimateTokens()` 用于开发调试，基于中文 1.8 chars/token 粗略估算。不要移除此日志。

### 3.4 数据拉取规则

1. **必须处理 CORS**：所有外部 API 请求（天天基金/新浪/蛋卷/腾讯行情）必须通过代理节点或 JSONP 方式。禁止直连。
2. **必须处理编码**：新浪 API 使用 GBK 编码，必须用 `TextDecoder('gbk')` 解码。
3. **必须容灾**：数据源失败时自动切换下一个源（通过 `activeProxyIndex` 递增轮换）。
4. **必须拦截非交易时段**：`checkIsTradingTime()` 函数判定周末 + 法定节假日 + 非交易时间。即使前端设置了自动刷新，在非交易时段也必须静默跳过请求。

### 3.5 安全规则

1. **XSS 防护**：所有 Markdown → HTML 渲染必须经过 `DOMPurify.sanitize()`，白名单模式（`ALLOWED_TAGS` + `ALLOWED_ATTR`）。
2. **安全求值**：金额表达式必须使用 `safeMathEval()`（手写递归下降解析器），严禁使用 `eval` 或 `new Function`。
3. **JS 沙箱**：AI 生成的 JS 代码必须在 Web Worker 中执行，Worker 不暴露 DOM API。
4. **Firestore 规则**：`src/firestore.rules` 定义了安全规则，修改数据结构后必须同步更新。核心原则：用户只能读写自己的数据（`/users/{uid}/**`）。
5. **API Key 暴露**：Firebase API Key 在前端是公开的（`constants.js`），安全依赖 Firestore 规则而非 Key 保密。AI API Key 存储在 Firestore 中（而非前端源码），通过 Firestore 规则保护。

### 3.6 UI 规范

1. **Apple 设计风格**：圆角（`rounded-[0.875rem]`）、毛玻璃（`backdrop-blur`）、弹簧动画（`cubic-bezier(0.34, 1.56, 0.64, 1)`）、微阴影。
2. **暗黑模式**：通过 `html.dark` 类名驱动，使用 Tailwind 的 `dark:` 前缀。切换函数在 `index.css` 的组件类中已预设。
3. **响应式**：移动优先，使用 Tailwind 断点 `sm/md/lg/xl`。移动端：触摸目标最小 44×44px（`.touch-target` 类）。
4. **Safe Area**：使用 `safe-top`/`safe-bottom` 等工具类适配刘海屏和底部指示条（`env(safe-area-inset-*)`）。
5. **颜色语义**：A 股红色 = 涨 = positive（`#e05252`），绿色 = 跌 = negative（`#34a853`）。使用 `positive-text`/`negative-text` 工具类而非硬编码颜色。

### 3.7 性能规则

1. **useMemo 阻断**：聊天消息列表使用 `useMemo` 缓存渲染结果，防止打字时触发全量重渲染。
2. **行情 Tick**：每个卡片独立的 `setTimeout` 计时器，1.25s 后自动清除动画状态。组件卸载时 `clearTimeout` 清除所有未完成的计时器。
3. **基金净值去重**：`codesToQuery = [...new Set(codesToQuery)]` 确保同一基金代码不重复请求。
4. **惰性加载**：基金详情配置文件按需拉取（`fetchDanjuanProfile` 仅当用户在基金列表中查看时触发）。

### 3.8 禁止事项

- ❌ 不要在组件内部定义全局常量（应放在 `config/constants.js`）
- ❌ 不要直接在 JSX 中调用 `fetch` 或其他副作用操作（应放在 useEffect 或事件处理器中）
- ❌ 不要修改 `funds` 数组的形状而不更新 `useBaseFundsData` 和 `usePortfolioStats`
- ❌ 不要在 Prompt 中硬编码具体日期、净值数字、或任何会过时的数据
- ❌ 不要绕过 `safeMathEval` 使用 eval
- ❌ 不要移除或注释掉 Token 估算日志（`estimateTokens`），它是生产监控的重要组成部分
- ❌ 不要在 AI 回复的 Markdown 中插入未经 DOMPurify 净化的 HTML
- ❌ 不要在其他组件中直接操作 Firestore（状态写入统一通过 App.jsx 的 handler 函数或 actionHandlers.js）

---

## 四、常用开发命令

```bash
npm install          # 安装依赖
npm run dev          # 启动开发服务器（默认 localhost:5173）
npm run build        # 生产构建（输出到 dist/）
npm run preview      # 预览生产构建
npm run lint         # ESLint 代码检查
```

## 五、关键依赖版本锁定

| 依赖 | 版本 | 备注 |
|---|---|---|
| react | ^19.2.4 | 最新主版本，使用 Hooks |
| vite | ^8.0.0 | 构建工具 |
| firebase | ^10.14.0 | BaaS 后端 |
| tailwindcss | ^3.4.19 | CSS 框架 |
| lucide-react | ^0.577.0 | 图标库 |
| dompurify | ^3.4.7 | XSS 防护 |
| @capacitor/core | ^8.2.0 | 跨平台运行时 |

## 六、Cloudflare Worker 部署

1. 将 `src/worker.js` 部署到 Cloudflare Workers
2. 配置环境变量 `SYNC_SECRET`（同步密码）
3. 绑定 KV 命名空间 `FUND_DB`
4. 在 CF Dashboard 添加 Cron 触发器（UTC 6/7/14/15）
5. 在前端设置中填入 Worker URL 和同步密码

## 七、Firebase 项目配置

1. 创建 Firebase 项目 → 启用 Authentication（邮箱/密码登录）
2. 创建 Firestore 数据库 → 部署 `src/firestore.rules`
3. 修改 `src/config/constants.js` 中的 Firebase 配置
