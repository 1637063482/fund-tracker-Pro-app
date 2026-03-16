Fund Tracker Pro 个人资产与基金收益分析系统

📖 项目简介

Fund Tracker Pro 是一款现代化的个人资产与基金收益追踪应用。本项目采用了**“一套代码，多端运行”**的全栈跨平台策略。不仅可以通过浏览器直接访问并作为 PWA（渐进式 Web 应用）极速安装到电脑桌面，还能通过 Capacitor 打包为原生 Android APK，在手机端提供流畅的沉浸式体验。

🎯 核心功能

资产流水管理： 详尽记录基金的买入、卖出、单价与份额，支持历史记录追溯。

多维收益洞察： 实时聚合计算总资产、单日盈亏与累计盈亏，直观呈现资产波动趋势。

多端数据同步： 依托实时数据库，实现手机端与电脑端数据的毫秒级云端同步，拒绝数据割裂。

离线极速访问： 深度集成 Service Worker 技术，核心资源预缓存，实现无网状态下应用秒开。

🏗️ 技术架构设计

系统采用了前后端分离与 Serverless 架构，确保了极佳的性能与可维护性：

前端视图层： 基于 React 组件化开发，使用 Vite 提供极速构建，并由 Tailwind CSS 驱动响应式 UI 与暗黑模式切换。

跨平台容器层：

移动端： 使用 Capacitor 接入原生底层能力，配置沉浸式 Splash Screen，彻底消除 Web App 启动白屏痛点。

桌面/网页端： 严格遵循 PWA 规范，配置独立应用清单（Manifest），实现类原生桌面软件体验。

后端数据层： 接入 Firebase BaaS（后端即服务），免除服务器运维烦恼，专注于核心业务逻辑。

CI/CD 自动化部署： 源码托管于 GitHub，通过 Cloudflare Pages 构建流水线。实现提交代码即自动构建、全球边缘节点 CDN 加速分发。

🚀 极速无白屏构建与多端部署指南

如果你需要在本地重新初始化该项目，或将其打包为 Android 原生应用，请按以下步骤操作：

第 0 步：网络代理设置 (必需)

npm config set proxy [http://127.0.0.1:7890](http://127.0.0.1:7890)

npm config set https-proxy [http://127.0.0.1:7890](http://127.0.0.1:7890)

若无代理，可使用淘宝镜像：npm config set registry [https://registry.npmmirror.com](https://registry.npmmirror.com)


第 1 步：安装环境依赖

npm install


第 2 步：本地开发调试

npm run dev


第 3 步：转化为 Android 原生工程 (Capacitor)

1. 编译前端静态资源到 dist 目录
npm run build

2. 如果未初始化过，先执行 init
npx cap init "Fund Tracker" "com.your.app" --web-dir dist

3. 添加 Android 平台代码骨架并同步前端资源
npx cap add android
npx cap sync android


第 4 步：生成专属原生图标 (Android 必需)

确保根目录新建 assets 文件夹，并放入高清的 icon.png 和开屏图 splash.png，然后执行：

npm install -D @capacitor/assets
npx capacitor-assets generate


第 5 步：云端打包 (网页版 PWA & 安卓 APK)

当你完成所有代码修改后，只需将代码推送到 GitHub 主分支，即可触发双端更新：

git add .
git commit -m "feat: update system features"
git push origin main


网页端 (PWA)： Cloudflare Pages 会自动拉取最新代码并执行构建，访问专属域名即可看到更新。通过浏览器地址栏右侧图标即可一键安装到桌面。

安卓端 (APK)： 登录 Ionic Appflow 控制台，在 Commits 列表中选择最新提交，点击 New build -> Android Debug APK 即可在云端生成安装包并下载。
