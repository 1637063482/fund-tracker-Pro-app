// 调试日志包装器：开发环境输出，生产环境自动静默
// import.meta.env.DEV 由 Vite 在构建时静态替换为 true/false
const DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

export const debugLog = (...args) => {
  if (DEV) console.log(...args);
};

// 带 scope 前缀的便捷方法
export const createLogger = (scope) => (...args) => {
  if (DEV) console.log(`[${scope}]`, ...args);
};

export default debugLog;
