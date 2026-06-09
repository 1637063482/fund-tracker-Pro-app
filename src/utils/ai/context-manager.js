// AI 上下文管理器 — 结构化注入
// 备忘 coreLogic 按结构化格式解析 → 只注入提取出的关键字段
// 支持三种 target：GLOBAL_CONSTITUTION(全文) / GLOBAL_MARKET(压缩摘要) / 个基(字段提取)

export class ContextManager {
  constructor({ memos, todos, portfolioStats, settings, marketStr, cache, radarEnabled, isLight = false }) {
    this.memos = memos || [];
    this.todos = todos || [];
    this.portfolioStats = portfolioStats;
    this.settings = settings;
    this.marketStr = marketStr || '';
    this.cache = cache;
    this.radarEnabled = radarEnabled;
    this.isLight = isLight;
    this.idleFunds = Number(settings.idleFunds) || 0;
  }

  build() {
    if (this.isLight) {
      return { marketStr: '', memosText: '', todosContext: '暂无任何计划。', activeFundsDetail: '', alertsText: '' };
    }
    return {
      marketStr: this.marketStr,
      memosText: this._buildMemos(),
      todosContext: this._buildTodos(),
      activeFundsDetail: this._buildPortfolio(),
      alertsText: this._buildAlerts()
    };
  }

  // ── 通用字段提取：从 coreLogic 中按 "字段名：值" 格式提取 ──
  _extractField(text, fieldName) {
    const re = new RegExp(`${fieldName}[：:]\\s*(.+?)(?:\\n|$)`, 'm');
    const m = text.match(re);
    return m ? m[1].trim() : '';
  }

  // ── GLOBAL_MARKET 压缩：提取关键信号行 ──
  _compressMarket(coreLogic) {
    if (!coreLogic) return '';
    const lines = [];
    const date = this._extractField(coreLogic, '日期');
    const aShare = this._extractField(coreLogic, 'A股');
    const shape = this._extractField(coreLogic, '形态');
    const bond = this._extractField(coreLogic, '债市');
    const cross = this._extractField(coreLogic, '跨资产');
    const score = this._extractField(coreLogic, '得分');
    const order = this._extractField(coreLogic, '指令');

    if (date) lines.push(`日期:${date}`);
    if (aShare) lines.push(`A股:${aShare}`);
    if (shape) lines.push(`形态:${shape}`);
    if (bond) lines.push(`债市:${bond}`);
    if (cross) lines.push(`跨资产:${cross}`);
    if (score) lines.push(`得分:${score}`);
    if (order) lines.push(`指令:${order}`);

    // 如果没匹配到结构化字段 → 截断全文
    if (lines.length === 0) {
      return coreLogic.substring(0, 300).replace(/\n+/g, ' | ');
    }
    return lines.join('\n  ');
  }

  // ── 个基字段提取 ──
  _parseFundMemo(coreLogic) {
    if (!coreLogic) return '';
    const parts = [];

    const decide = this._extractField(coreLogic, '定调');
    const nav = this._extractField(coreLogic, '净值锚');
    const style = this._extractField(coreLogic, '风格');
    const grid = this._extractField(coreLogic, '网格') || this._extractField(coreLogic, '击球区'); // 两种写法等价
    const takeProfit = this._extractField(coreLogic, '止盈');
    const stopLoss = this._extractField(coreLogic, '止损');
    const position = this._extractField(coreLogic, '仓位');
    const corr = this._extractField(coreLogic, '相关性');
    const conditions = this._extractField(coreLogic, '建仓条件');
    const redLine = this._extractField(coreLogic, '红线');

    if (decide) parts.push(`定调:${decide}`);
    if (nav) parts.push(`锚:${nav}`);
    if (style) parts.push(`风格:${style}`);
    if (grid) parts.push(`网格:${grid}`);
    if (takeProfit) parts.push(`止盈:${takeProfit}`);
    if (stopLoss) parts.push(`止损:${stopLoss}`);
    if (position) parts.push(`仓位:${position}`);
    if (corr) parts.push(`相关:${corr}`);
    if (conditions) parts.push(`建仓:${conditions}`);
    if (redLine) parts.push(`红线:${redLine}`);

    // 没匹配到结构化字段 → 截断
    if (parts.length === 0) {
      return coreLogic.substring(0, 150).replace(/\n+/g, ' ');
    }
    return parts.join(' | ');
  }

  // ── 备忘录 — 三层注入 ──
  _buildMemos() {
    const constitution = this.memos.find(m => m.target === 'GLOBAL_CONSTITUTION');
    const market = this.memos.find(m => m.target === 'GLOBAL_MARKET');
    const fundMemos = this.memos.filter(m => m.target !== 'GLOBAL_CONSTITUTION' && m.target !== 'GLOBAL_MARKET');

    // 个基备忘截断 — 结构化后每条仅 ~150 chars，30 条 ≈ 4,500 chars
    // 远低于旧格式 10 条的 6,000 chars，可安全放开
    const MAX_FUND_MEMOS = 30;
    let displayedFundMemos = fundMemos;
    if (fundMemos.length > MAX_FUND_MEMOS) {
      displayedFundMemos = fundMemos
        .sort((a, b) => {
          const aImp = ['WATCH_GRID', 'BLACK_LIST'].includes(a.decisionType) ? 1 : 0;
          const bImp = ['WATCH_GRID', 'BLACK_LIST'].includes(b.decisionType) ? 1 : 0;
          if (aImp !== bImp) return bImp - aImp;
          return (new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
        })
        .slice(0, MAX_FUND_MEMOS);
    }

    let text = '\n⚠️ 备忘中净值/价格为写入快照，仅作锚点。凡涉净值 → 必须调用工具。\n';

    // GLOBAL_CONSTITUTION — 全文（通常 ≤150 字）
    if (constitution) {
      text += `\n▸ 👑 财富宪法: ${constitution.coreLogic}\n`;
    } else {
      text += '\n▸ 👑 财富宪法: 暂无，请询问用户。\n';
    }

    // GLOBAL_MARKET — 压缩摘要
    if (market) {
      const d = market.updatedAt ? new Date(market.updatedAt).toISOString().split('T')[0] : '';
      text += `\n▸ 🌍 宏观锚点 [${d}]:\n  ${this._compressMarket(market.coreLogic)}\n`;
    } else {
      text += '\n▸ 🌍 宏观锚点: 暂无。\n';
    }

    // 个基 — 结构化字段提取
    if (displayedFundMemos.length > 0) {
      const label = fundMemos.length > MAX_FUND_MEMOS
        ? `▸ 🏷️ 个基挂牌（${displayedFundMemos.length}/共${fundMemos.length}只）:`
        : `▸ 🏷️ 个基挂牌（${displayedFundMemos.length}只）:`;
      text += `\n${label}\n`;
      for (const m of displayedFundMemos) {
        const fields = this._parseFundMemo(m.coreLogic);
        text += `  - ${m.targetName}(${m.target}) | ${fields}\n`;
      }
      if (fundMemos.length > MAX_FUND_MEMOS) {
        text += `  ⚠️ 另有${fundMemos.length - MAX_FUND_MEMOS}只备忘未显示。涉及请调update_decision_memo查看。\n`;
      }
    } else {
      text += '\n  暂无个基记录。\n';
    }

    return text;
  }

  // ── 待办条件解析器：提取冻结状态+触发条件+关键备注 ──
  _parseCondition(condition) {
    if (!condition) return { frozen: false, trigger: '', freezeReason: '', note: '' };
    const text = condition.trim();

    // 检测冻结标记
    const isFrozen = text.includes('⛔') || /^\d{1,2}\/\d{1,2}\s*冻结/.test(text);
    if (isFrozen) {
      // 提取冻结原因
      let freezeReason = '';
      const reasonMatch = text.match(/冻结[：:]\s*(.+?)[。.]/);
      if (reasonMatch) {
        freezeReason = reasonMatch[1].replace(/待.*?后恢复/g, '').replace(/[。.]$/, '').trim().substring(0, 50);
      }
      // 提取原触发条件
      let trigger = '';
      const origMatch = text.match(/原条件[：:]\s*(.+?)[。.]?\s*$/);
      if (origMatch) trigger = origMatch[1].trim().substring(0, 60);
      // 压缩常见冗余
      freezeReason = freezeReason
        .replace(/权益24分\+F1=10\(战术警戒\)\+/g, '权益<35+')
        .replace(/标签禁止买入/g, '禁买')
        .replace(/回升至≥35分后恢复/g, '');
      return { frozen: true, trigger, freezeReason: freezeReason || '条件不满足', note: '' };
    }

    // 活跃待办 → 提取触发条件（首句）+ 关键备注
    const firstDot = text.indexOf('。');
    let trigger = firstDot > 0 ? text.substring(0, firstDot).trim() : text.substring(0, 80).trim();
    // 提取 T+N / 相关性等关键备注
    let note = '';
    const tnMatch = text.match(/T\+\d[^。]*?到账/);
    const corrMatch = text.match(/相关性[^。]+/);
    if (tnMatch) note = tnMatch[0];
    if (corrMatch) note += (note ? ' | ' : '') + corrMatch[0].substring(0, 40);

    return { frozen: false, trigger: trigger.substring(0, 80), freezeReason: '', note: note.substring(0, 60) };
  }

  // ── 待办 — 分三层：活跃 > 冻结 > 已完成，带汇总统计 ──
  _buildTodos() {
    if (this.todos.length === 0) return '暂无任何计划。';

    const aiPlans = this.todos.filter(t => t.type === 'ai_plan');
    const MAX_UNCOMPLETED = 50; // 未完成全量但设软上限，防止极端情况

    // 排序辅助
    const sortByPriority = (a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return (order[a.priority] || 1) - (order[b.priority] || 1);
    };

    // 已完成 → 按 completedAt 倒序（最近完成的在前），无 completedAt 的旧数据用 updatedAt
    const completed = aiPlans
      .filter(t => t.isCompleted)
      .sort((a, b) => {
        const aTime = a.completedAt || a.updatedAt || '';
        const bTime = b.completedAt || b.updatedAt || '';
        return bTime.localeCompare(aTime);
      });

    // 活跃/冻结 → 先优先级后 createdAt 倒序
    const pending = aiPlans
      .filter(t => !t.isCompleted)
      .sort((a, b) => {
        const p = sortByPriority(a, b);
        if (p !== 0) return p;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });

    const active = [];
    const frozen = [];
    for (const t of pending) {
      const parsed = this._parseCondition(t.condition || '');
      if (parsed.frozen) frozen.push({ ...t, _parsed: parsed });
      else active.push({ ...t, _parsed: parsed });
    }

    // 格式化单行
    const fmt = (t) => {
      const prio = t.priority === 'high' ? '🔴高' : t.priority === 'low' ? '🟢低' : '🟡中';
      const dir = t.actionType === 'buy' ? '买' : t.actionType === 'sell' ? '卖' : '观';
      const parsed = t._parsed || this._parseCondition(t.condition || '');
      let line = `[${t.id}]${prio} ${dir} ${t.fundName}(${t.fundCode}) | ${(t.amount || 0).toLocaleString()}元`;
      if (t.isCompleted) {
        const doneDate = t.completedAt ? ' ' + t.completedAt.split('T')[0] : '';
        line += ` | ✅${doneDate}`;
      } else if (parsed.frozen) {
        line += ` | ⛔${parsed.freezeReason}`;
        if (parsed.trigger) line += ` | 原:${parsed.trigger}`;
      } else {
        line += ` | ${parsed.trigger}`;
        if (parsed.note) line += ` | ${parsed.note}`;
      }
      return line;
    };

    const now = new Date();
    const RECENT_DAYS = 30;   // T+N 交收最长 T+7，30天安全覆盖所有在途
    const MAX_COMPLETED_SHOW = 20; // 结构化后单行 ~100 chars，20条 ≈ 2,000 chars

    let text = '';

    // 活跃待办
    if (active.length > 0) {
      const totalActive = active.reduce((s, t) => s + (t.amount || 0), 0);
      text += `▸ 🟢 可执行 (${active.length}条,共${totalActive.toLocaleString()}元):\n${active.map(fmt).join('\n')}\n`;
    }

    // 冻结待办
    if (frozen.length > 0) {
      const totalFrozen = frozen.reduce((s, t) => s + (t.amount || 0), 0);
      text += `▸ ⛔ 已冻结 (${frozen.length}条,共${totalFrozen.toLocaleString()}元,不计入空闲子弹):\n${frozen.map(fmt).join('\n')}`;
      // 统一冻结原因汇总
      const reasons = [...new Set(frozen.map(t => t._parsed?.freezeReason || '').filter(Boolean))];
      if (reasons.length === 1) text += `\n  👉 统一冻结原因: ${reasons[0]}`;
      text += '\n';
    }

    // 已完成/在途 — 只展示最近完成的（T+N 交收期内可能在途）
    if (completed.length > 0) {
      const recentCompleted = completed.filter(t => {
        const doneDate = t.completedAt || t.updatedAt;
        if (!doneDate) return true; // 旧数据没有时间戳，保留
        const daysAgo = (now - new Date(doneDate)) / 86400000;
        return daysAgo <= RECENT_DAYS;
      });
      const oldCount = completed.length - recentCompleted.length;
      const displayed = recentCompleted.slice(0, MAX_COMPLETED_SHOW);

      if (displayed.length > 0) {
        const label = oldCount > 0
          ? `▸ ✅ 最近完成 (${displayed.length}条,另有${oldCount}条超${RECENT_DAYS}天已归档):`
          : `▸ ✅ 最近完成 (${displayed.length}条,已下单禁重复):`;
        text += `${label}\n${displayed.map(fmt).join('\n')}\n`;
      }
    }

    // 手动待办（如果有）
    const manual = this.todos.filter(t => t.type !== 'ai_plan' && !t.isCompleted);
    if (manual.length > 0) {
      text += `▸ 📝 手动待办 (${manual.length}条):\n${manual.map(t => `  [${t.id}] ${t.text}`).join('\n')}\n`;
    }

    return text || '暂无任何计划。';
  }

  // ── 持仓明细 ──
  _buildPortfolio() {
    if (!this.cache?.portfolioTable) return '';
    return `名称(截8字)│代码  │    份额│   市值│  盈亏率│ XIRR│ 占比│类型      │标记\n${this.cache.portfolioTable}⚠️ 快照不可反推净值/日收益。份额为系统记录值，有微小舍入误差。`;
  }

  // ── 风控标记 ──
  _buildAlerts() {
    if (!this.cache) return '';
    const alerts = this.cache.alerts || [];
    return alerts.length > 0 ? `▸ 【风控标记】\n${alerts.join('\n')}\n` : '';
  }
}
