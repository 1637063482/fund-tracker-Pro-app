# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

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
