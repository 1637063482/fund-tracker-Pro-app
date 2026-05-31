// 全局错误边界组件：捕获子组件渲染时的未处理异常，展示友好降级 UI 并提供重试按钮
import React, { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary 捕获到组件崩溃:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-6">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8 max-w-md w-full text-center space-y-4 animate-in fade-in zoom-in-95 duration-300">
            <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
              <AlertTriangle size={32} className="text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">页面组件发生异常</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              应用遇到了一个未预期的错误。请尝试刷新页面，如果问题持续存在请联系技术支持。
            </p>
            {this.state.error && (
              <pre className="mt-2 p-3 bg-slate-100 dark:bg-slate-900 rounded-[0.875rem] text-xs text-left text-red-600 dark:text-red-400 overflow-auto max-h-32 font-mono">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="inline-flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors shadow-md active:scale-95"
            >
              <RefreshCw size={16} className="mr-2" />
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
