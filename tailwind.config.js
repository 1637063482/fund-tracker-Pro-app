// Tailwind CSS 主题配置文件：自定义色板、字体、阴影、毛玻璃、Apple 风格动画关键帧
import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      borderRadius: {
        card: '0.875rem',
        modal: '1.25rem',
        bubble: '1.125rem',
        button: '0.625rem',
        input: '0.75rem',
      },
      boxShadow: {
        'apple-sm': '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)',
        'apple-md': '0 4px 6px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.02)',
        'apple-lg': '0 10px 15px rgba(0,0,0,0.05), 0 4px 6px rgba(0,0,0,0.02)',
        'apple-xl': '0 20px 25px rgba(0,0,0,0.08), 0 10px 10px rgba(0,0,0,0.02)',
        'apple-2xl': '0 30px 50px rgba(0,0,0,0.12)',
      },
      colors: {
        glass: {
          light: 'rgba(255,255,255,0.72)',
          border: 'rgba(255,255,255,0.25)',
          dark: 'rgba(15,23,42,0.72)',
          'dark-border': 'rgba(51,65,85,0.40)',
        },
        positive: {
          DEFAULT: '#e05252',
          light: '#fef2f2',
          dark: '#450a0a',
          muted: '#fca5a5',
        },
        negative: {
          DEFAULT: '#34a853',
          light: '#f0fdf4',
          dark: '#052e16',
          muted: '#4ade80',
        },
      },
      backdropBlur: {
        glass: '20px',
        'glass-heavy': '40px',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'apple-ease': 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      animation: {
        'spring-up': 'spring-up 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'spring-in': 'spring-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'fade-in-up': 'fade-in-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'toast-in': 'toast-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'toast-out': 'toast-out 0.3s ease-in forwards',
        'bounce-dot': 'bounce-dot 1.2s ease-in-out infinite',
      },
      keyframes: {
        'spring-up': {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'spring-in': {
          '0%': { transform: 'scale(0.94)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'fade-in-up': {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'toast-in': {
          '0%': { transform: 'translateX(100%) scale(0.92)', opacity: '0' },
          '100%': { transform: 'translateX(0) scale(1)', opacity: '1' },
        },
        'toast-out': {
          '0%': { transform: 'translateX(0) scale(1)', opacity: '1' },
          '100%': { transform: 'translateX(100%) scale(0.92)', opacity: '0' },
        },
        'bounce-dot': {
          '0%, 80%, 100%': { transform: 'scale(0) translateY(0)' },
          '40%': { transform: 'scale(1) translateY(-4px)' },
        },
      },
    },
  },
  plugins: [
    tailwindcssAnimate
  ],
};
