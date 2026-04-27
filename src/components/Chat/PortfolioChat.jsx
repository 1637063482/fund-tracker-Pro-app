import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, RefreshCw, Trash2, Bot, User, Sparkles } from 'lucide-react';
import { chatWithPortfolioAI } from '../../utils/ai';

export const PortfolioChat = ({ portfolioStats, settings, marketData }) => {
  const [isOpen, setIsOpen] = useState(false);
  const[messages, setMessages] = useState([
    { role: 'assistant', content: '您好！我是您的私人基金副驾驶。我已经读取了您当前的全部持仓和流水，以及您手握的空闲资金。请问有什么可以帮您？' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // 自动滚动到底部
  const scrollToBottom = () => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  };
  // 【关键修复】把 isOpen 加入依赖，并在打开聊天框时也触发一次滚动
  useEffect(() => { scrollToBottom(); }, [messages, isLoading, isOpen]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    const newMessages =[...messages, { role: 'user', content: userMessage }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      // 过滤掉第一条欢迎语，只把真实对话发给 AI
      const chatHistory = newMessages.filter((_, idx) => idx > 0 && idx < newMessages.length - 1);
      const reply = await chatWithPortfolioAI(settings, portfolioStats, chatHistory, userMessage, marketData);
      setMessages([...newMessages, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages([...newMessages, { role: 'assistant', content: `❌ 抱歉，连接大脑失败：${e.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 一键清空记忆，防止幻觉
  const handleClear = () => {
    if (window.confirm("确定要开启新对话吗？这会清空之前的聊天上下文，防止 AI 产生幻觉。")) {
      setMessages([{ role: 'assistant', content: '记忆已清空。我已经重新加载了您的最新账本底表，我们重新开始吧！' }]);
    }
  };

  // 优雅渲染 Markdown
  const renderMarkdown = (text) => {
    return text.split('\n').map((line, idx) => {
      if (!line.trim()) return <div key={idx} className="h-1"></div>;
      if (line.startsWith('### ')) {
        return <h4 key={idx} className="font-bold text-indigo-700 dark:text-indigo-300 mt-2 mb-1 text-[13px]">{line.replace('### ', '')}</h4>;
      }
      let formattedLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return <div key={idx} className="mb-0.5 text-slate-700 dark:text-slate-300 leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: formattedLine }} />;
    });
  };

  return (
    <>
      {/* 右下角悬浮入口按钮 (保持不变) */}
      <button 
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-6 right-6 p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full shadow-2xl transition-all duration-300 hover:scale-110 z-40 ${isOpen ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}`}
      >
        <MessageSquare size={28} />
        <span className="absolute -top-1 -right-1 flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-4 w-4 bg-red-500"></span>
        </span>
      </button>

      {/* 【全新升级】沉浸式居中遮罩与超大聊天面板 */}
      <div 
        className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-sm transition-all duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsOpen(false)} // 点击遮罩层关闭
      >
        <div 
          // 宽度提升至 max-w-3xl (约768px)，高度提升至 85vh，圆角变大
          className={`w-full max-w-3xl h-[90vh] sm:h-[85vh] bg-white dark:bg-slate-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden transform transition-all duration-300 border border-slate-100 dark:border-slate-700 ${isOpen ? 'scale-100 translate-y-0' : 'scale-95 translate-y-8'}`}
          onClick={e => e.stopPropagation()} // 阻止点击事件冒泡到遮罩层
        >
          
          {/* 头部 */}
          <div className="bg-gradient-to-r from-indigo-600 to-blue-600 p-4 sm:p-5 flex justify-between items-center text-white shrink-0 shadow-md relative z-10">
            <div className="flex items-center">
              <Sparkles size={22} className="mr-2" />
              <span className="font-bold text-lg">私人投资副驾驶</span>
            </div>
            <div className="flex items-center space-x-2">
              <button onClick={handleClear} title="开启新对话 (防幻觉)" className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"><Trash2 size={18} /></button>
              <button onClick={() => setIsOpen(false)} className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"><X size={18} /></button>
            </div>
          </div>

          {/* 消息列表区 */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-50 dark:bg-slate-900 custom-scrollbar relative">
            {messages.map((msg, idx) => (
              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex max-w-[90%] sm:max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-blue-100 text-blue-600 ml-3' : 'bg-indigo-100 text-indigo-600 mr-3'}`}>
                    {msg.role === 'user' ? <User size={18} /> : <Bot size={20} />}
                  </div>
                  <div className={`px-5 py-3.5 text-sm sm:text-base shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm' : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-tl-sm'}`}>
                    {msg.role === 'user' ? msg.content : renderMarkdown(msg.content)}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex flex-row max-w-[80%]">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-indigo-100 text-indigo-600 mr-3">
                    <RefreshCw size={18} className="animate-spin" />
                  </div>
                  <div className="px-5 py-4 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-tl-sm flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce"></span>
                    <span className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                    <span className="w-2.5 h-2.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 输入区 */}
          <div className="p-3 sm:p-4 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700 shrink-0">
            <div className="flex items-end bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-1.5 focus-within:ring-2 focus-within:ring-indigo-500 transition-shadow">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                }}
                placeholder="询问关于您的持仓建议..."
                className="flex-1 max-h-40 min-h-[50px] bg-transparent border-none focus:ring-0 resize-none p-3 text-sm sm:text-base dark:text-white outline-none"
                rows={1}
              />
              <button 
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="m-1.5 p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 shadow-sm"
              >
                <Send size={20} className={input.trim() && !isLoading ? 'translate-x-0.5 -translate-y-0.5 transition-transform' : ''} />
              </button>
            </div>
            <div className="text-center mt-2.5 text-xs text-slate-400">
              Shift + Enter 换行，Enter 发送。您的账本数据已脱敏注入。
            </div>
          </div>

        </div>
      </div>
    </>
  );
};