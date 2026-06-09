// Markdown 渲染组件：将 AI 输出的 Markdown 文本解析为 React 组件，支持表格、代码块、折叠面板与 XSS 防护
import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import DOMPurify from 'dompurify';

// ========================
// 安全配置
// ========================
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['strong', 'em', 'b', 'i', 'u', 's', 'br', 'p', 'span', 'div',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'code', 'pre', 'blockquote', 'a', 'img', 'hr', 'sub', 'sup'],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel', 'loading', 'width', 'height', 'colspan', 'rowspan', 'data-zoomable', 'style'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
};
const sanitizeHtml = (html) => DOMPurify.sanitize(html, SANITIZE_CONFIG);

// ========================
// Inline 格式化
// ========================
const applyInline = (text) => {
  let html = text;
  // 图片
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const safeUrl = url.trim();
    if (/^https?:\/\//i.test(safeUrl)) {
      return '<img src="' + safeUrl + '" alt="' + alt + '" class="max-w-full h-auto object-contain rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 my-3 bg-white cursor-pointer hover:shadow-md transition-shadow" loading="lazy" data-zoomable="true" />';
    }
    return '[图片已屏蔽]';
  });
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code class="bg-slate-100 dark:bg-slate-800 text-rose-600 dark:text-rose-400 px-1.5 py-0.5 rounded text-[12px] font-mono">$1</code>');
  // 粗体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold text-slate-900 dark:text-white">$1</strong>');
  // 斜体
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 数字着色：带%号的涨跌幅自动着色（+X%红，-X%绿）。排除范围格式（73-77%、~1-2%）
  // 范围格式添加 nowrap 防止断行
  html = html.replace(/([\d.]+)[-~]([\d.]+%)/g, '<span class="whitespace-nowrap">$1-$2</span>');
  html = html.replace(/(?<![\d])(\+[\d.]+%)/g, '<span class="text-red-500 font-semibold">$1</span>');
  html = html.replace(/(?<![\d~])(-[\d.]+%)/g, '<span class="text-green-500 font-semibold">$1</span>');
  // 裸正负数（前有空格的独立数字，如 "涨了 +3.2 元"），仅在中文语境着色
  html = html.replace(/([\s(（])(\+[\d.]+)([\s,，。)）]|$)/g, '$1<span class="text-red-500 font-semibold">$2</span>$3');
  html = html.replace(/([\s(（])(-[\d.]+)([\s,，。)）]|$)/g, '$1<span class="text-green-500 font-semibold">$2</span>$3');

  return html;
};

// ========================
// 标题
// ========================
const headingClass = {
  h1: 'text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-5 mb-3 pb-2 border-b-2 border-indigo-200 dark:border-indigo-800',
  h2: 'text-lg font-bold text-slate-800 dark:text-slate-100 mt-4 mb-2 border-l-4 border-indigo-500 dark:border-indigo-400 pl-3',
  h3: 'text-base font-bold text-indigo-700 dark:text-indigo-300 mt-3 mb-2 px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg inline-block',
  h4: 'text-sm font-semibold text-slate-700 dark:text-slate-200 mt-2 mb-1',
  h5: 'text-[13px] font-semibold text-slate-600 dark:text-slate-300 mt-1.5 mb-1',
  h6: 'text-[12px] font-semibold text-slate-500 dark:text-slate-400 mt-1 mb-0.5',
};
const matchHeading = (line) => {
  const m = line.match(/^(#{1,6})\s+(.+)/);
  if (!m) return null;
  return { level: m[1].length, text: m[2] };
};

// ========================
// 表格解析 — 支持 | 分隔和 Tab 分隔两种格式
// ========================
const isTableRow = (line) => /^\|.+\|$/.test(line.trim()) || /\t.*\t/.test(line.trim());
const isTableSep = (line) => /^\|[\s\-:|]+\|$/.test(line.trim()) || /^([\t ]*-{2,}[\t ]*)+$/.test(line.trim());

// Tab 分隔表格 → 统一转为 | 分隔
const normalizeTable = (lines) => {
  if (lines.length === 0) return lines;
  // 检测：第一行不含 | 但含 \t → Tab 分隔格式
  if (!lines[0].includes('|') && lines[0].includes('\t')) {
    return lines.map(l => {
      // 把连续短横线也转为 | 格式
      if (/^([\t ]*-{2,}[\t ]*)+$/.test(l.trim())) {
        return '|' + l.trim().replace(/[\t ]*-{2,}[\t ]*/g, '---|').replace(/\|$/, '');
      }
      return '| ' + l.trim().replace(/\t/g, ' | ') + ' |';
    });
  }
  return lines;
};

const parseTable = (lines, startIdx) => {
  const rawRows = [];
  let i = startIdx;
  while (i < lines.length && isTableRow(lines[i])) {
    rawRows.push(lines[i].trim());
    i++;
  }
  if (rawRows.length < 2) return null;

  // 检测是否包含分隔行（在归一化之前，用原始行判断）
  let dataStart = 1;
  if (rawRows.length > 1 && isTableSep(rawRows[1])) dataStart = 2;

  // Tab → Pipe 归一化（仅对数据行，分隔行丢弃）
  const rows = normalizeTable(rawRows);

  const parseCols = (row) => row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

  const headers = parseCols(rows[0]);

  const bodyRows = [];
  for (let j = dataStart; j < rows.length; j++) {
    bodyRows.push(parseCols(rows[j]));
  }

  return { headers, rows: bodyRows, consumedLines: i - startIdx };
};

const renderTable = (table) => {
  const headerHtml = '<tr class="bg-indigo-50 dark:bg-indigo-900/30 border-b-2 border-indigo-200 dark:border-indigo-800">' +
    table.headers.map(h => '<th class="px-3 py-2 text-left text-[12px] sm:text-sm font-bold text-indigo-700 dark:text-indigo-300 whitespace-nowrap">' + applyInline(h) + '</th>').join('') +
    '</tr>';

  const bodyHtml = table.rows.map((row, ri) =>
    '<tr class="border-b border-slate-100 dark:border-slate-800 ' + (ri % 2 === 0 ? 'bg-white dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-800/50') + ' hover:bg-indigo-50/30 dark:hover:bg-indigo-900/20 transition-colors">' +
    row.map(cell => '<td class="px-3 py-2 text-[12px] sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">' + applyInline(cell) + '</td>').join('') +
    '</tr>'
  ).join('');

  return sanitizeHtml(
    '<div class="overflow-x-auto custom-scrollbar my-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">' +
    '<table class="w-full text-sm">' +
    '<thead>' + headerHtml + '</thead>' +
    '<tbody>' + bodyHtml + '</tbody>' +
    '</table></div>'
  );
};

// ========================
// 块级解析
// ========================
const parseBlocks = (text) => {
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 代码块
    if (line.trim().startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'code', content: codeLines.join('\n') });
      continue;
    }

    // 水平线
    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // 标题
    const h = matchHeading(line);
    if (h) {
      blocks.push({ type: 'heading', level: h.level, content: h.text });
      i++;
      continue;
    }

    // 表格
    if (isTableRow(line)) {
      const table = parseTable(lines, i);
      if (table) {
        blocks.push({ type: 'table', table });
        i += table.consumedLines;
        continue;
      }
    }

    // 无序列表
    if (/^[\-\*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\-\*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\-\*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // 引用块
    if (line.startsWith('> ')) {
      const quoteLines = [];
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].replace(/^>\s*/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join('<br/>') });
      continue;
    }

    // 普通段落
    const paraLines = [];
    while (i < lines.length && lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('> ') &&
      !/^[\-\*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^(---|\*\*\*|___)\s*$/.test(lines[i].trim()) &&
      !/^\|.+\|$/.test(lines[i].trim()) &&
      !matchHeading(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', content: paraLines.join('<br/>') });
    }
  }

  return blocks;
};

// ========================
// 章节卡片分组
// ========================
const groupIntoCards = (blocks) => {
  const groups = [];
  let current = null;

  for (const block of blocks) {
    if (block.type === 'heading' && block.level === 3) {
      if (current && current.blocks.length > 0) groups.push(current);
      current = { heading: block.content, blocks: [] };
    } else if (current) {
      current.blocks.push(block);
    } else {
      // 在第一个 ### 之前的内容不包卡
      if (!current) {
        if (!groups.length) groups.push({ heading: null, blocks: [] });
        groups[0].blocks.push(block);
      }
    }
  }
  if (current && current.blocks.length > 0) groups.push(current);

  return groups;
};

// ========================
// Print/PDF 渲染 — 输出纯 HTML 字符串，所有样式内联，不依赖 Tailwind CSS
// ========================

const applyInlineForPrint = (text) => {
  let html = text;
  // 图片
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const safeUrl = url.trim();
    if (/^https?:\/\//i.test(safeUrl)) {
      return `<img src="${safeUrl}" alt="${alt}" style="max-width:100%;height:auto;object-fit:contain;border-radius:12px;border:1px solid #e2e8f0;margin:12px 0;background:#fff;display:block;" />`;
    }
    return '[图片已屏蔽]';
  });
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;color:#e11d48;padding:1px 4px;border-radius:3px;font-size:10px;font-family:Menlo,Monaco,Consolas,monospace;">$1</code>');
  // 粗体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:700;color:#0f172a;">$1</strong>');
  // 斜体
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // 涨跌幅着色（排除范围格式 73-77%、~1-2%）
  html = html.replace(/(?<![\d])(\+[\d.]+%)/g, '<span style="color:#ef4444;font-weight:600;">$1</span>');
  html = html.replace(/(?<![\d~])(-[\d.]+%)/g, '<span style="color:#22c55e;font-weight:600;">$1</span>');
  html = html.replace(/([\s(（])(\+[\d.]+)([\s,，。)）]|$)/g, '$1<span style="color:#ef4444;font-weight:600;">$2</span>$3');
  html = html.replace(/([\s(（])(-[\d.]+)([\s,，。)）]|$)/g, '$1<span style="color:#22c55e;font-weight:600;">$2</span>$3');
  return html;
};

const headingStyle = {
  h1: 'font-size:15px;font-weight:900;color:#0f172a;margin:16px 0 8px 0;padding-bottom:5px;border-bottom:2px solid #a5b4fc;',
  h2: 'font-size:13px;font-weight:700;color:#1e293b;margin:12px 0 5px 0;padding-left:8px;border-left:3px solid #6366f1;',
  h3: 'font-size:12px;font-weight:700;color:#4338ca;margin:8px 0 5px 0;padding:2px 6px;background:#eef2ff;border-radius:6px;display:inline-block;',
  h4: 'font-size:11px;font-weight:600;color:#334155;margin:5px 0 2px 0;',
  h5: 'font-size:10px;font-weight:600;color:#475569;margin:4px 0 2px 0;',
  h6: 'font-size:10px;font-weight:600;color:#64748b;margin:3px 0 1px 0;',
};

const renderTableForPrint = (table) => {
  const thead = '<thead><tr style="background:#eef2ff;border-bottom:2px solid #a5b4fc;">' +
    table.headers.map(h => '<th style="padding:5px 8px;text-align:left;font-size:10px;font-weight:700;color:#4338ca;white-space:nowrap;">' + applyInlineForPrint(h) + '</th>').join('') +
    '</tr></thead>';
  const tbody = '<tbody>' + table.rows.map((row, ri) =>
    '<tr style="border-bottom:1px solid #f1f5f9;' + (ri % 2 === 0 ? 'background:#fff;' : 'background:#f8fafc;') + '">' +
    row.map(cell => '<td style="padding:5px 8px;font-size:10px;color:#334155;line-height:1.45;">' + applyInlineForPrint(cell) + '</td>').join('') +
    '</tr>'
  ).join('') + '</tbody>';
  return sanitizeHtml(
    '<div style="overflow-x:auto;margin:8px 0;border-radius:8px;border:1px solid #e2e8f0;">' +
    '<table style="width:100%;border-collapse:collapse;font-size:10px;">' + thead + tbody + '</table></div>'
  );
};

const renderBlockForPrint = (block, key) => {
  switch (block.type) {
    case 'heading': {
      const tag = 'h' + block.level;
      const style = headingStyle[tag] || 'font-size:11px;font-weight:600;margin:5px 0 2px 0;';
      return '<' + tag + ' style="' + style + '">' + applyInlineForPrint(block.content) + '</' + tag + '>';
    }
    case 'paragraph': {
      return '<p style="color:#334155;line-height:1.65;margin-bottom:6px;word-wrap:break-word;">' + applyInlineForPrint(block.content) + '</p>';
    }
    case 'table': {
      return renderTableForPrint(block.table);
    }
    case 'ul': {
      const items = block.items.map(item =>
        '<li style="color:#334155;line-height:1.65;margin-left:20px;margin-bottom:3px;list-style-type:disc;">' + applyInlineForPrint(item) + '</li>'
      ).join('');
      return '<ul style="margin:6px 0;padding-left:0;">' + items + '</ul>';
    }
    case 'ol': {
      const items = block.items.map((item, ii) =>
        '<li style="color:#334155;line-height:1.65;margin-left:20px;margin-bottom:3px;list-style-type:decimal;">' + applyInlineForPrint(item) + '</li>'
      ).join('');
      return '<ol style="margin:8px 0;padding-left:0;">' + items + '</ol>';
    }
    case 'code': {
      const escaped = block.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<pre style="background:#1e293b;color:#e2e8f0;border-radius:8px;padding:10px;margin:8px 0;overflow-x:auto;font-size:10px;line-height:1.5;font-family:Menlo,Monaco,Consolas,monospace;border:1px solid #334155;"><code>' + escaped + '</code></pre>';
    }
    case 'blockquote': {
      return '<blockquote style="border-left:3px solid #f59e0b;padding:8px 12px;margin:10px 0;color:#475569;font-style:italic;background:#fffbeb;border-radius:8px;overflow:hidden;line-height:1.5;font-size:11px;">' + applyInlineForPrint(block.content) + '</blockquote>';
    }
    case 'hr': {
      return '<hr style="margin:16px 0;border:none;border-top:1px solid #e2e8f0;" />';
    }
    default: {
      return '<p style="color:#334155;line-height:1.65;word-wrap:break-word;">' + applyInlineForPrint(String(block.content || block)) + '</p>';
    }
  }
};

/**
 * 将 Markdown 文本渲染为适合打印/PDF 的纯 HTML 字符串。
 * 所有样式内联，不依赖 Tailwind CSS，可直接嵌入任意 HTML 文档。
 * AI 深度思考过程会被自动剥离，仅保留最终回复内容。
 * @param {string} text - 原始 Markdown 文本
 * @returns {string} 完整的 HTML 片段字符串
 */
export function renderMarkdownForPrint(text) {
  if (!text || typeof text !== 'string') return '';

  // 剥离 AI 思考过程 HTML 块（分享 PDF 时不需要暴露内部推理过程）
  let mainText = text.replace(/^### (🧠 AI[\s\S]*?<\/div>\n\n)/, '');

  if (mainText.trim().length < 20) {
    return '<p style="color:#94a3b8;font-style:italic;font-size:10px;">' + mainText.trim() + '</p>';
  }

  const blocks = parseBlocks(mainText);
  const cards = groupIntoCards(blocks);

  let output = '';

  // 渲染卡片
  cards.forEach((card, ci) => {
    if (card.heading) {
      output += '<div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:16px 20px;margin-bottom:16px;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #f1f5f9;">' +
        '<div style="width:6px;height:20px;background:#6366f1;border-radius:999px;flex-shrink:0;"></div>' +
        '<h3 style="font-size:15px;font-weight:700;color:#1e293b;margin:0;">' + card.heading + '</h3>' +
        '</div>' +
        '<div>' + card.blocks.map((b, bi) => renderBlockForPrint(b, 'cb' + ci + '-' + bi)).join('') + '</div>' +
        '</div>';
    } else {
      card.blocks.forEach((b, bi) => {
        output += renderBlockForPrint(b, 'free' + bi);
      });
    }
  });

  return sanitizeHtml(output);
}

// ========================
// 主渲染函数 (React)
// ========================
// 可折叠的 AI 思考过程组件
const CollapsibleThink = ({ html }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="my-3 border border-amber-200/60 dark:border-amber-700/40 rounded-[0.875rem] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-amber-50/80 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors text-left"
      >
        {expanded ? <ChevronDown size={16} className="text-amber-500 shrink-0" /> : <ChevronRight size={16} className="text-amber-500 shrink-0" />}
        <Brain size={16} className="text-amber-500 shrink-0" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-300">AI 思考过程</span>
        <span className="text-[11px] text-amber-500 dark:text-amber-400 ml-auto">{expanded ? '点击收起' : '点击展开'}</span>
      </button>
      {expanded && (
        <div className="p-4 text-sm text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-800/50" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
      )}
    </div>
  );
};

export function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return null;

  // 保留 AI 思考过程 HTML
  const thinkMatch = text.match(/^### (🧠 AI[\s\S]*?<\/div>\n\n)/);
  let thinkBlock = '';
  let mainText = text;
  if (thinkMatch) {
    thinkBlock = thinkMatch[1];
    mainText = text.slice(thinkMatch[0].length);
  }

  // AI 状态文字（"正在深度思考..."等）不需要渲染
  if (mainText.trim().length < 20 && !thinkBlock) {
    return <p className="text-slate-400 dark:text-slate-500 italic text-sm">{mainText.trim()}</p>;
  }

  const blocks = parseBlocks(mainText);
  const cards = groupIntoCards(blocks);

  const renderBlock = (block, key) => {
    switch (block.type) {
      case 'heading': {
        const tag = 'h' + block.level;
        const cls = headingClass[tag] || 'text-sm font-bold mt-2 mb-1';
        const html = sanitizeHtml('<' + tag + ' class="' + cls + '">' + applyInline(block.content) + '</' + tag + '>');
        return <div key={key} dangerouslySetInnerHTML={{ __html: html }} />;
      }
      case 'paragraph': {
        const html = sanitizeHtml('<p class="text-slate-700 dark:text-slate-300 leading-7 mb-2 break-words">' + applyInline(block.content) + '</p>');
        return <div key={key} dangerouslySetInnerHTML={{ __html: html }} />;
      }
      case 'table': {
        const html = renderTable(block.table);
        return <div key={key} dangerouslySetInnerHTML={{ __html: html }} />;
      }
      case 'ul': {
        const itemsHtml = block.items.map(item =>
          '<li class="text-slate-700 dark:text-slate-300 leading-7 ml-5 mb-1 list-disc marker:text-indigo-400">' + applyInline(item) + '</li>'
        ).join('');
        return <div key={key} dangerouslySetInnerHTML={{ __html: sanitizeHtml('<ul class="my-2">' + itemsHtml + '</ul>') }} />;
      }
      case 'ol': {
        const itemsHtml = block.items.map((item, ii) =>
          '<li class="text-slate-700 dark:text-slate-300 leading-7 ml-5 mb-1 list-decimal marker:text-indigo-400 marker:font-bold">' + applyInline(item) + '</li>'
        ).join('');
        return <div key={key} dangerouslySetInnerHTML={{ __html: sanitizeHtml('<ol class="my-2">' + itemsHtml + '</ol>') }} />;
      }
      case 'code': {
        const escaped = block.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return <div key={key} dangerouslySetInnerHTML={{ __html: sanitizeHtml(
          '<pre class="bg-slate-900 dark:bg-slate-950 text-slate-100 rounded-xl p-4 my-3 overflow-x-auto custom-scrollbar text-[12px] leading-relaxed font-mono border border-slate-700"><code>' + escaped + '</code></pre>'
        ) }} />;
      }
      case 'blockquote': {
  return <div key={key} dangerouslySetInnerHTML={{ __html: sanitizeHtml(
    '<blockquote class="border-l-4 border-amber-400 dark:border-amber-500 pl-4 py-3 my-4 text-slate-600 dark:text-slate-400 italic bg-amber-50 dark:bg-amber-900/20 rounded-xl overflow-hidden leading-relaxed">' + 
    applyInline(block.content) + 
    '</blockquote>'
  ) }} />;
}
      case 'hr': {
        return <hr key={key} className="my-4 border-slate-200 dark:border-slate-700" />;
      }
      default: {
        const html = sanitizeHtml('<p class="text-slate-700 dark:text-slate-300 leading-7 break-words">' + applyInline(String(block.content || block)) + '</p>');
        return <div key={key} dangerouslySetInnerHTML={{ __html: html }} />;
      }
    }
  };

  const elements = [];

  // 思考过程块 — 可折叠
  if (thinkBlock) {
    elements.push(
      <CollapsibleThink key="think" html={thinkBlock} />
    );
  }

  // 渲染每个卡片组
  cards.forEach((card, ci) => {
    if (card.heading) {
      // 带 ### 标题的卡片
      elements.push(
        <div key={'card' + ci} className="bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 sm:px-5 sm:pt-4 mb-4 shadow-sm hover:shadow-md transition-shadow duration-300">
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100 dark:border-slate-700">
            <div className="w-1.5 h-5 bg-indigo-500 rounded-full"></div>
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">{card.heading}</h3>
          </div>
          <div className="space-y-1">
            {card.blocks.map((b, bi) => renderBlock(b, 'cb' + ci + '-' + bi))}
          </div>
        </div>
      );
    } else {
      // 无标题的散落内容（在第一个 ### 之前）
      card.blocks.forEach((b, bi) => {
        elements.push(renderBlock(b, 'free' + bi));
      });
    }
  });

  return <div className="markdown-body max-w-full overflow-x-auto custom-scrollbar">{elements}</div>;
}
