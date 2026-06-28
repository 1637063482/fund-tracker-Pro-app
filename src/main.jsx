// 应用入口文件：挂载 React 根组件到 DOM，包裹全局错误边界与样式
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { ErrorBoundary } from './components/UI/ErrorBoundary';
import { initQuantLogger } from './utils/quant/quantLogger';
import './index.css';

// 初始化量化引擎控制台探针
initQuantLogger();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);