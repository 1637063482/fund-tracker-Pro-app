// Vite build configuration: React plugin, path aliases, proxy rules, PWA and mobile build optimization
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test/setup.js'],
    include: ['src/test/**/*.test.{js,jsx}']
  }
})
