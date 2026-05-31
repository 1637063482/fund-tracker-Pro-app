// Vite 构建配置文件：React 插件、路径别名、代理规则、PWA 与移动端构建优化
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './', // 【核心修复】：指定为相对路径，确保 WebView 和 PWA 能正确加载 assets 下的 JS/CSS 资源
  plugins: [react()],
})