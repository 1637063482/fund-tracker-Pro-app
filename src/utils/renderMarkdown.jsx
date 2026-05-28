import React from 'react';
import DOMPurify from 'dompurify';

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['strong', 'em', 'b', 'i', 'u', 's', 'br', 'p', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'code', 'pre', 'blockquote', 'a', 'img'],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel', 'loading', 'width', 'height'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
};

const sanitizeHtml = (html) => DOMPurify.sanitize(html, SANITIZE_CONFIG);

export function renderMarkdown(text) {
  return text.split('\n').map((line, idx) => {
    if (!line.trim()) return <div key={idx} className="h-1"></div>;

    if (line.startsWith('### ')) {
      return <h4 key={idx} className="font-bold text-indigo-700 dark:text-indigo-300 mt-2 mb-1 text-[13px]">{line.replace('### ', '')}</h4>;
    }

    let formattedLine = line;

    formattedLine = formattedLine.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (_, alt, url) => {
        const safeUrl = url.trim();
        if (/^https?:\/\//i.test(safeUrl)) {
          return `<img src="${safeUrl}" alt="${alt}" class="max-w-full h-auto object-contain rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 my-3 bg-white" loading="lazy" />`;
        }
        return `[图片已屏蔽: 非安全URL]`;
      }
    );
    formattedLine = formattedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    const cleanHtml = sanitizeHtml(formattedLine);

    return <div key={idx} className="mb-0.5 text-slate-700 dark:text-slate-300 leading-relaxed break-words max-w-full overflow-x-auto custom-scrollbar" dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
  });
}
