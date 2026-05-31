// Markdown → 飞书交互卡片兼容格式转换器
// 飞书 msg_type: "interactive" 的 markdown 标签仅支持有限子集：
//   #~### 标题、**粗体**、*斜体*、~~删除线~~、`行内代码`
//   -/+ 无序列表、1. 有序列表、> 引用块、--- 分割线
//   [链接](url)、![图片](url)、<font color='...'>文字</font>
// 不支持：```代码块```、HTML 表格、管道表格、<br/>、<div>/<span>

const stripHtml = (html) => html.replace(/<[^>]*>/g, '');

const parseHtmlTable = (html) => {
  const rows = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells = [];
    const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
      cells.push(stripHtml(cellMatch[1]).trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
};

// HTML <table> → 飞书可读的键值对列表
const convertHtmlTables = (text) => {
  return text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match) => {
    const rows = parseHtmlTable(match);
    if (rows.length === 0) return '';
    const headers = rows[0];
    const body = rows.slice(1);
    if (body.length === 0 && headers.length > 0) {
      return headers.join(' | ') + '\n\n';
    }
    const lines = [];
    for (const row of body) {
      const parts = [];
      for (let i = 0; i < Math.max(headers.length, row.length); i++) {
        const h = headers[i] || '';
        const v = row[i] || '';
        if (h) parts.push(`**${h}**：${v}`);
        else parts.push(v);
      }
      lines.push('· ' + parts.join('，'));
    }
    return lines.join('\n') + '\n\n';
  });
};

// Markdown 管道表格 → 飞书可读的键值对列表
const convertPipeTables = (text) => {
  const lines = text.split('\n');
  const result = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (/^\|.+\|$/.test(line)) {
      const tableLines = [];
      let j = i;
      while (j < lines.length && /^\|.+\|$/.test(lines[j].trim())) {
        tableLines.push(lines[j].trim());
        j++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (r) => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const headers = parseRow(tableLines[0]);
        const isSep = (r) => /^[\s\-:]+$/.test(r);
        let dataStart = 1;
        if (tableLines.length > 1 && parseRow(tableLines[1]).every(c => isSep(c))) {
          dataStart = 2;
        }
        const converted = [];
        for (let k = dataStart; k < tableLines.length; k++) {
          const vals = parseRow(tableLines[k]);
          const parts = [];
          for (let ci = 0; ci < Math.max(headers.length, vals.length); ci++) {
            const h = headers[ci] || '';
            const v = vals[ci] || '';
            if (h) parts.push(`**${h}**：${v}`);
            else parts.push(v);
          }
          converted.push('· ' + parts.join('，'));
        }
        result.push(converted.join('\n'));
        i = j;
        continue;
      }
    }
    result.push(lines[i]);
    i++;
  }
  return result.join('\n');
};

// ```代码块``` → 缩进引用文本
const convertCodeBlocks = (text) => {
  return text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) => {
    const trimmed = code.trim();
    const indented = trimmed.split('\n').map(l => '    ' + l).join('\n');
    return '📎 参考数据：\n' + indented + '\n\n';
  });
};

// 剥离飞书不支持的 HTML 标签，保留 <font> 和内容
const stripUnsupportedHtml = (text) => {
  // <br/> → \n
  let r = text.replace(/<br\s*\/?>/gi, '\n');
  // <strong>/<b> → **
  r = r.replace(/<\/?(?:strong|b)>/gi, '**');
  // <em>/<i> → *
  r = r.replace(/<\/?(?:em|i)>/gi, '*');
  // 移除不支持的标签（保留 <font> 及其内容）
  r = r.replace(/<(?!\/?font\b)[^>]*>/gi, '');
  return r;
};

// 清理多余空行
const normalizeWhitespace = (text) => {
  return text.replace(/\n{4,}/g, '\n\n\n').replace(/[ \t]+$/gm, '').trim();
};

export function toFeishuMarkdown(text) {
  if (!text || typeof text !== 'string') return '';
  let result = text;
  result = convertHtmlTables(result);
  result = convertPipeTables(result);
  result = convertCodeBlocks(result);
  result = stripUnsupportedHtml(result);
  result = normalizeWhitespace(result);
  return result;
}
