# Fund Tracker Pro

个人基金资产管理 + AI 量化投资 Copilot 系统

## 核心能力

### 基金持仓与流水管理

- **双层记账模式**：支持自动模式（输入基金代码 + 份额，自动追踪净值）和手动模式（自由表达式计算市值）
- **完整交易流水**：记录买入、卖出、分红、手续费等所有流水类型
- **实时净值拉取**：多数据源自动切换（天天基金、新浪财经、蛋卷基金），可配置反代代理绕过跨域
- **清仓归档**：已清仓资产移入历史区，保留完整收益数据用于复盘

### 大盘行情监控

- **五大核心指数**：上证、深证、创业板、10年期国债 ETF、30年期国债 ETF 实时行情
- **多数据源容灾**：腾讯财经 / 新浪财经 / 雪球三源自动切换，支持 5 个公共 CORS 代理节点轮换
- **自动刷新**：交易时段内每 5 秒轮询，休市/节假日智能拦截，不浪费请求
- **法定节假日识别**：自动从 jsDelivr CDN 同步中国法定假日数据，周末 + 节假日双重过滤

### AI 量化投资 Copilot

聊天框内嵌的 AI 投资助手，支持三大模型（Gemini / DeepSeek / 硅基流动），具备：

**17 个专属工具调用能力**：
- 净值数据：单基 / 批量 / 历史序列 / 多基横向对比（含相关性矩阵 + 综合评级）
- 市场行情：历史 K 线 OHLC（开高低收）、分时路径、多周期共振
- 资讯搜索：新浪财经多栏目快讯聚合、Tavily 搜索引擎、Exa 深度研报、Serper Google 搜索
- 实体操作：记账（批量写入交易流水）、待办管理（增/删/改）、战略备忘录写入、FOF 字典入库
- 可视化：QuickChart 图表生成（支持线图/柱状图/色带/趋势线/双Y轴/数据点标注）
- 量化计算：Web Worker 沙箱执行 JS 代码（复利、相关性、波动率、最大回撤等精确计算）

**三层战略记忆系统**：
- 第一层「财富宪法」：全局投资目标与底线约束
- 第二层「宏观定价锚点」：当前市场环境与极值边界
- 第三层「资产身份挂牌」：每只基金的定调标签（战略看多 / 网格震荡 / 持有观望 / 黑名单）+ 纪律红线

**双核多周期打分卡**：
- 权益引擎：宏观赔率极值（40分）+ 战术微观反转（30分）+ 量价验证（30分）
- 固收引擎：宏观利率极值（50分）+ 股债跷跷板（50分）
- 自动交叉矩阵：根据标签 × 得分，输出买入 / 持有 / 卖出 / 网格指令

**周五自动巡检**：每周五弹出巡检提示，AI 自动遍历所有备忘录标的，核查最新净值，覆写过时快照数据

**防幻觉协议**：多层级系统约束（净值数据唯一通道、T+1 妥协、交易日历核对、资金交收物理规律校验）

### Cloudflare Worker 云端巡检

- 前端一键「上传至云大脑」将账本同步到 Worker KV
- Worker 定时触发（UTC 6/7/14/15），支持盘中异动 / 收盘快报 / 每日清算 / 每周复盘四种模式
- 规则引擎自动判定市场情绪（股债双牛/跷跷板/双杀等），生成机器交易信标
- **多通道推送**：飞书卡片 / 钉钉机器人 / Ntfy，支持 Markdown 富文本
- 利润快照 KV 持久化，区间盈亏自动计算

### 全盘资产分析

- **综合指标**：投资总净本金、全盘持仓总值、累计盈亏、XIRR 年化收益率、简单收益率
- **三大排行榜**：按 XIRR / 累计收益 / 简单收益率排序
- **可视化图表**：大类资产配置图、单一持仓比重分布、正向盈利贡献分布
- **财富目标复盘**：基于设定目标金额和基准年化，计算 Alpha 超额收益、偏离基准轨迹、缺口金额、所需月收益
- **复利推演**：基于当前 XIRR 推演至目标日期的预期资产规模
- **FOF X-Ray 穿透雷达**：底层持仓穿透 → 申万行业归类 → 全局集中度预警

### 待办事项系统

- AI 可自动生成交易计划卡片（买入/卖出/观察，含触发条件与金额）
- 用户手动添加操作备忘
- 优先级分级（高/中/低），完成状态追踪
- 7 天赎回惩罚费自动风控拦截

### 多端跨平台

- **PWA**：Service Worker 离线缓存，可安装到桌面
- **Android APK**：Capacitor 打包原生应用，沉浸式体验
- **暗黑模式**：CSS 类名驱动，手动切换
- **响应式布局**：Tailwind CSS，完整适配移动端 + PC 端

### 数据安全

- Firebase Authentication 认证登录
- Firestore 实时数据库，多端数据实时同步
- 15 分钟无操作自动登出
- 数据导出为 JSON 本地备份
- 聊天记录云端持久化，跨设备恢复对话上下文

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 19 + Vite 8 |
| UI 框架 | Tailwind CSS 3 + Lucide React 图标 |
| 跨平台 | Capacitor 8 (Android) + PWA |
| 后端服务 | Firebase Auth + Firestore |
| AI 引擎 | Gemini API / DeepSeek API / 硅基流动 (SiliconFlow) |
| 搜索 | Tavily / Exa / Serper (Google) |
| 推送 | Cloudflare Worker + Ntfy / 飞书 / 钉钉 |
| 图表 | QuickChart.io (Chart.js 渲染) + 自定义 DonutChart |
| Markdown | 自研解析器 + DOMPurify 安全净化 |
| 安全 | Web Worker 沙箱执行 JS / DOMPurify XSS 防护 |

## 目录架构

```
fund-tracker-pro/
├── index.html                     # 应用 HTML 入口：viewport、PWA manifest、React 挂载点
├── package.json                   # NPM 依赖与脚本声明
├── vite.config.js                 # Vite 构建配置：React 插件、路径别名、代理与 PWA
├── tailwind.config.js             # Tailwind CSS 主题：自定义色板、字体、毛玻璃与 Apple 动画
├── postcss.config.js              # PostCSS 构建配置：Tailwind + Autoprefixer
├── eslint.config.js               # ESLint 代码规范：JS/JSX/TSX 语法检查与 React Hooks 规则
├── capacitor.config.json          # Capacitor 移动端打包配置（Android APK）
│
├── public/                        # 静态资源目录（构建时直接复制）
│   ├── sw.js                      # PWA Service Worker：离线缓存策略与推送通知
│   ├── manifest.json              # PWA 清单：应用名、图标、启动屏配置
│   ├── manifest.webmanifest       # Web App Manifest 副本
│   ├── favicon.svg                # 浏览器标签页图标
│   ├── icons.svg                  # SVG 图标精灵集
│   └── icon-*.png                 # PWA 各尺寸应用图标
│
├── .github/workflows/
│   └── main.yml                   # GitHub Actions CI：推送 main 分支自动构建 Android APK
│
├── assets/                        # 项目设计素材与原始图标资源
├── icons/                         # Capacitor 原生应用图标集
├── android/                       # Capacitor Android 原生壳工程
│
└── src/                           # 前端源代码
    ├── main.jsx                   # 应用入口：挂载 React 根组件 + ErrorBoundary
    ├── App.jsx                    # 应用主组件：全局状态管理、业务编排、子组件调度
    ├── worker.js                  # Cloudflare Worker 云端定时巡检脚本
    ├── index.css                  # 全局样式：基础重置、Apple 风格变量、滚动条与动画
    │
    ├── config/
    │   ├── constants.js           # 全局常量：Firebase 配置、代理节点列表、资产名称映射
    │   └── firebase.js            # Firebase SDK 初始化：auth（认证）、db（Firestore）
    │
    ├── hooks/
    │   ├── useBaseFundsData.js    # 基金基础数据计算：净投入、市值、盈亏、XIRR 汇总
    │   ├── usePortfolioStats.js   # 投资组合统计：饼图、占比、排名、资产配置衍生指标
    │   ├── useScrollLock.js       # 滚动锁定：弹窗打开时禁止背景滚动（嵌套调用安全）
    │   ├── useFocusTrap.js        # 焦点陷阱：模态框内 Tab 键焦点循环锁定（无障碍）
    │   └── useModalAnimation.js   # FLIP 动画 Hook：模态框弹出/关闭弹性过渡
    │
    ├── services/
    │   ├── navFetcher.js          # 基金净值服务：天天/新浪/蛋卷四源多批次智能调度
    │   ├── marketFetcher.js       # 市场行情服务：腾讯/新浪/雪球三源轮换 + CORS 代理
    │   └── fileParser.js          # 文件解析服务：Gemini OCR 引擎（图片截图 + PDF 季报）
    │
    ├── utils/
    │   ├── helpers.js             # 通用工具集：安全求值、格式化、XIRR 计算、交易时间判定
    │   ├── holidayCalendar.js     # 节假日日历：判定 A 股非交易日（周末 + 法定假日）
    │   ├── renderMarkdown.jsx     # Markdown 渲染：AI 输出转 React 组件 + XSS 防护
    │   ├── ai.js                  # AI 模块重导出入口（向后兼容）
    │   └── ai/                    # AI 引擎子模块（10 个文件）
    │       ├── index.js           #   子模块统一导出聚合入口
    │       ├── core.js            #   核心对话引擎：单基诊断、组合体检、聊天主循环
    │       ├── providers.js       #   AI 供应商解析：Gemini / DeepSeek / SiliconFlow
    │       ├── proxy.js           #   代理 URL 构建：CORS 前缀 + 基金代码转换
    │       ├── fifo.js            #   FIFO 风控：7 日内短线赎回惩罚费计算
    │       ├── prompts.js         #   提示词模板：系统角色 + 分层场景 Prompt 构建
    │       ├── market-data.js     #   行情抓取：腾讯分时、多周期 K 线、东财情绪
    │       ├── tool-handlers.js   #   工具执行器：策略模式分发 17 个 AI Function Call
    │       ├── tools-definitions.js # 工具注册表：所有 Function Calling JSON Schema
    │       ├── search-engines.js  #   搜索适配器：Tavily / Exa / Serper 统一封装
    │       └── financial-news.js  #   财经快讯聚合：新浪 + 搜索引擎并行拉取去重
    │
    └── components/
        ├── Auth/
        │   └── LoginScreen.jsx    # 登录界面：邮箱密码 + Firebase 认证 + 主题切换
        │
        ├── Chat/
        │   ├── PortfolioChat.jsx  # AI 对话面板：多轮聊天、联网搜索、文件上传、记忆库
        │   ├── ActionCard.jsx     # AI 操作卡片：数据确认 / 交易录入 / 备忘录交互表单
        │   └── actionHandlers.js  # 操作处理器：按 toolType 分发写入 Firestore
        │
        ├── Dashboard/
        │   ├── FundTable.jsx      # 持仓表格：双 Tab 表格（投资组合 + 清仓历史）+ 排序
        │   ├── TodoListCard.jsx   # 待办清单：投资纪律卡片（增/删/改/优先级）
        │   └── MarketTimeIndicator.jsx # 市场时钟：A 股交易时段状态 + 收盘提醒
        │
        ├── Fund/
        │   ├── FundEditor.jsx     # 基金编辑器：手动/自动双模式录入、交易流水、清仓归档
        │   ├── FundProfileModal.jsx # 基金详情弹窗：AI 深度分析报告（缓存 + 重新生成）
        │   └── SmartBadges.jsx    # 智能标签：基金类型/指标自动渲染分类徽章
        │
        ├── Portfolio/
        │   └── PortfolioAnalysisModal.jsx # 组合分析弹窗：AI 全盘体检 + X 光透视 + 风险评级
        │
        ├── Settings/
        │   └── ProxySettingsModal.jsx # 全局设置面板：AI/数据源/代理/刷新/通知等参数配置
        │
        └── UI/                    # 通用 UI 组件库（10 个组件）
            ├── AnimatedNumber.jsx #   数字动画：滚动渐变过渡 + 自定义格式化
            ├── DonutChart.jsx     #   环形图：纯 SVG 饼图/圆环 + 中心标签 + 悬停交互
            ├── SmartInput.jsx     #   智能输入：公式计算（= 开头）+ 日期输入 + 失焦评估
            ├── ErrorBoundary.jsx  #   错误边界：未处理异常捕获 + 友好降级 UI + 重试
            ├── ImageModal.jsx     #   图片预览：双指缩放 + 滚轮缩放 + 拖拽平移
            ├── AppleSelect.jsx    #   选择器：Portal 自定义下拉 + 键盘导航 + 外部点击关闭
            ├── Toast.jsx          #   全局通知：success/error/info + 自动排队 + 定时消失
            ├── AnimatedModal.jsx  #   通用模态框：FLIP 过渡遮罩层 + 面板容器封装
            └── Tooltip.jsx        #   悬浮提示：Portal 渲染淡黄色气泡 + 智能定位
```

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## Firebase 配置

需要创建 Firebase 项目并启用 Authentication（邮箱登录）和 Firestore 数据库。配置信息可在 `src/config/constants.js` 中修改。

## Cloudflare Worker 部署

将 `src/worker.js` 部署为 Cloudflare Worker，配置环境变量 `SYNC_SECRET`，并绑定 KV 命名空间 `FUND_DB`。在前端设置中配置 Worker URL 和同步密码后即可使用云端巡检推送。

## AI 模型配置

在系统设置中心配置：
- **Gemini**：需 Google API Key
- **DeepSeek**：需 DeepSeek API Key，支持 reasoning_effort 调节（disabled/high/max），推理过程可视化展示
- **硅基流动**：需 SiliconFlow API Key

可选配置 Tavily / Exa / Serper API Key 以启用联网搜索能力。
