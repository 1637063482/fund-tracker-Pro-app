import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 【核心修复】强制使用相对路径寻址，防止移动端 WebView 及静态托管寻址失败
  base: './', 
})