/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // 【关键】：确保 Tailwind 能扫描到 App.jsx 中的类名
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require("tailwindcss-animate") // 【关键修复】：使界面的 fade-in, slide-in 动画生效
  ],
}