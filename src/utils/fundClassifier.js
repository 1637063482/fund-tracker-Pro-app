// 基金分类统一模块 — 全项目唯一的基金名称分类逻辑
// classifyFundType / classifyAssetClass / classifyFundTypeShort 三者共享同一套判断规则

const RULES = [
  // [匹配条件函数, 详细类型, 大类, 短标签]
  [n => n.includes('货币') || n.includes('现金'), '中短债/货币', '货币', '货'],
  [n => n.includes('短债') || n.includes('理财'),   '中短债/货币', '货币', '短债'],
  [n => n.includes('可转债'),                       '可转债',      '含权', '转债'],
  [n => n.includes('定期开放'),                      '长债/纯债',   '固收', '纯债'],
  [n => n.includes('债'),                           '长债/纯债',   '固收', '纯债'],
  [n => n.includes('红利') || n.includes('低波'),    '红利策略',    '权益', '红利'],
  [n => n.includes('指数') || n.includes('联接') || n.includes('ETF'), '被动宽基/行业', '权益', '指数'],
  [n => n.includes('混合') || n.includes('固收+') || n.includes('平衡'), '固收+/混合', '权益', '混+'],
];

const DETAILED_DEFAULT = '权益/混合';
const CLASS_DEFAULT = '权益';
const SHORT_DEFAULT = '权益';

// 详细类型（8 种）
export const classifyFundType = (name) => {
  if (!name) return DETAILED_DEFAULT;
  for (const [fn, type] of RULES) {
    if (fn(name)) return type;
  }
  return DETAILED_DEFAULT;
};

// 大类（货币/含权/固收/权益/混合）
export const classifyAssetClass = (name) => {
  if (!name) return CLASS_DEFAULT;
  for (const [fn, , cls] of RULES) {
    if (fn(name)) return cls;
  }
  return CLASS_DEFAULT;
};

// 短标签（2 字，表格列用）
export const classifyFundTypeShort = (name) => {
  if (!name) return SHORT_DEFAULT;
  for (const [fn, , , tag] of RULES) {
    if (fn(name)) return tag;
  }
  return SHORT_DEFAULT;
};
