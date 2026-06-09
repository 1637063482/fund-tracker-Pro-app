// 图表色卡主题（14 色 + hex 支持）
// 从 tool-handlers.js 抽取，独立模块供图表绘制使用

const colorMap = {
  'red':     { solid: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
  'green':   { solid: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  'blue':    { solid: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
  'orange':  { solid: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  'purple':  { solid: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
  'yellow':  { solid: '#eab308', bg: 'rgba(234, 179, 8, 0.15)' },
  'gray':    { solid: '#6b7280', bg: 'rgba(107, 114, 128, 0.15)' },
  'cyan':    { solid: '#06b6d4', bg: 'rgba(6, 182, 212, 0.15)' },
  'pink':    { solid: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)' },
  'teal':    { solid: '#14b8a6', bg: 'rgba(16, 185, 166, 0.15)' },
  'indigo':  { solid: '#6366f1', bg: 'rgba(99, 102, 241, 0.15)' },
  'amber':   { solid: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  'lime':    { solid: '#84cc16', bg: 'rgba(132, 204, 22, 0.15)' },
  'rose':    { solid: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)' },
  'slate':   { solid: '#64748b', bg: 'rgba(100, 116, 139, 0.15)' },
};

export const themeColors = [
  colorMap['blue'], colorMap['green'], colorMap['red'], colorMap['purple'],
  colorMap['orange'], colorMap['cyan'], colorMap['pink'], colorMap['teal'],
  colorMap['indigo']
];

export function getThemeColor(colorStr) {
  if (!colorStr) return null;
  const key = String(colorStr).toLowerCase().trim();
  if (colorMap[key]) return colorMap[key];
  if (/^#[0-9a-fA-F]{3,8}$/.test(key)) {
    const solid = key.length === 4
      ? `#${key[1]}${key[1]}${key[2]}${key[2]}${key[3]}${key[3]}`
      : key;
    return { solid, bg: `${solid}26` };
  }
  return null;
}

export default colorMap;
