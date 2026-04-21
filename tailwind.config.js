import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // 【关键修复】：告诉 Tailwind 通过手动切换 class 来触发暗黑模式
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", 
  ],
  theme: {
    extend: {},
  },
  plugins: [
    tailwindcssAnimate
  ],
}