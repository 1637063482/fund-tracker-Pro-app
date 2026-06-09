// AI 操作卡片处理器：按 toolType 分发处理用户确认的 AI 操作（数据入库、备忘录更新、交易记录写入等），将 handleConfirmAction 拆分为独立函数
import { doc, setDoc, getDocs, collection, query, where, updateDoc } from 'firebase/firestore';
import { db, appId } from '../../config/firebase';
import { chatWithPortfolioAI } from '../../utils/ai';

// ---- 工具函数：更新消息列表中指定 action 的状态 ----
function markActionStatus(messages, cardId, status) {
  return messages.map(m => {
    if (m.isAction && m.actions) {
      return { ...m, actions: m.actions.map(a => a.cardId === cardId ? { ...a, status } : a) };
    }
    return m;
  });
}

function appendAiReply(prevMessages, reply) {
  const finalMessages = [...prevMessages];
  if (typeof reply === 'object' && reply.type === 'ACTION_REQUIRED') {
    const actionsWithStatus = reply.payload.map((act, idx) => ({
      ...act, cardId: `act_${Date.now()}_${idx}`, status: 'pending'
    }));
    finalMessages.push({ role: 'assistant', content: reply.text, isAction: true, actions: actionsWithStatus });
  } else {
    finalMessages.push({ role: 'assistant', content: reply });
  }
  return finalMessages;
}

async function syncChatToCloud(user, messages, activeConvId) {
  if (!user || !db) return;
  const convId = activeConvId || 'default';
  // 写入 chat_convs/{convId}（新版多对话路径）
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const title = lastUserMsg ? lastUserMsg.content.substring(0, 30) : '新对话';
  await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'chat_convs', convId), {
    messages,
    title,
    createdAt: new Date().toISOString()
  }, { merge: true }).catch(err => console.warn('同步对话到云端失败:', err));
}

// ---- 1. 数据确认处理器 ----
export async function handleDataConfirmation({ action, formData, setMessages, settings, portfolioStats, useWebSearch, enableMacroRadar, messages, todos, memos, user, activeConvId }) {
  setMessages(prev => markActionStatus(prev, action.cardId, 'completed'));

  // 防御：extractedText 为空时不发 AI 请求
  if (!formData?.extractedText?.trim()) {
    setMessages(prev => {
      const finalMessages = [...prev, { role: 'assistant', content: '❌ 数据解析失败或内容为空，请重新上传文件。', timestamp: new Date().toISOString() }];
      syncChatToCloud(user, finalMessages, activeConvId);
      return finalMessages;
    });
    return;
  }

  const activeMarketData = enableMacroRadar ? "FETCH_NOW" : "【纯净模式】";
  const stitchedPrompt = `【系统强制注入：用户上传并已人工核对无误的 Ground Truth 真实底层数据】\n<verified_data>\n${formData.extractedText}\n</verified_data>\n\n【用户的原始指令】：${action.originalMessage || '请深度分析上述数据并给出具体建议。'}`;

  const chatHistory = messages.filter(m => !m.isAction && m.role !== 'system');
  const reply = await chatWithPortfolioAI(settings, portfolioStats, chatHistory, stitchedPrompt, activeMarketData, useWebSearch, todos, memos);

  setMessages(prev => {
    const finalMessages = appendAiReply(prev, reply);
    syncChatToCloud(user, finalMessages, activeConvId);
    return finalMessages;
  });
}

// ---- 2. 备忘录写入处理器 ----
export async function handleMemoWrite({ action, user }) {
  const memoRef = doc(db, 'artifacts', appId, 'users', user.uid, 'ai_memos', action.target);
  await setDoc(memoRef, {
    target: action.target,
    targetName: action.targetName,
    decisionType: action.decisionType,
    coreLogic: action.coreLogic,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

// ---- 3. FOF 穿透字典写入处理器 ----
export async function handleFofDictWrite({ action, user, formData }) {
  const dictRef = doc(db, 'artifacts', appId, 'users', user.uid, 'fof_dict', action.fundCode);

  // 基础字段
  const payload = {
    fundCode: action.fundCode,
    fundName: action.fundName,
    sectors: action.sectors,
    updatedAt: new Date().toISOString()
  };

  // 五栏分配 — 仅当用户手动填入时才覆盖
  const allocFields = ['stockPct', 'bondPct', 'fundPct', 'cashPct', 'otherPct'];
  let userStockPct = null, userFundPct = null;
  for (const field of allocFields) {
    const rawVal = formData?.[field] ?? action[field];
    if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
      const num = parseFloat(rawVal);
      if (!isNaN(num) && num >= 0 && num <= 100) {
        payload[field] = num / 100;
        if (field === 'stockPct') userStockPct = num / 100;
        if (field === 'fundPct') userFundPct = num / 100;
      }
    }
  }

  // equityRatio：用户填了股票/基金 → 用真实数据；否则用 AI 估算
  if (userStockPct !== null || userFundPct !== null) {
    payload.equityRatio = (userStockPct || 0) + (userFundPct || 0);
  } else {
    payload.equityRatio = action.equityRatio; // AI 估算值作为 fallback
  }

  await setDoc(dictRef, payload, { merge: true });
}

// ---- 4. 待办事项 CRUD 处理器 ----
export async function handleTodoCRUD({ action, onAddTodo, onUpdateTodo, onDeleteTodo }) {
  let mType = 'add';
  const cleanId = action.id ? String(action.id).replace(/[^a-zA-Z0-9_-]/g, '') : null;

  if (action.manageType === 'delete' || action.actionType === 'delete') {
    mType = 'delete';
  } else if (action.manageType === 'update' || action.actionType === 'update') {
    mType = 'update';
  } else if (cleanId && !action.fundCode) {
    mType = 'update';
  }

  if (mType === 'add') {
    if (!action.fundCode || !action.fundName) {
      throw new Error("大模型生成了无效的新增卡片 (丢失核心参数)，已安全拦截，请驳回修改。");
    }
    await onAddTodo({
      type: 'ai_plan',
      fundCode: action.fundCode,
      fundName: action.fundName,
      actionType: action.tradeDirection || action.actionType || 'observe',
      amount: action.amount || 0,
      condition: action.condition || '',
      priority: action.priority || 'medium',
      isCompleted: false,
      createdAt: new Date().toISOString()
    });
  } else if (mType === 'update') {
    if (!cleanId) throw new Error("大模型未返回有效的待办ID，无法顺延/更新。");
    const updatePayload = { updatedAt: new Date().toISOString() };
    if (action.condition) updatePayload.condition = action.condition;
    if (action.amount !== undefined) updatePayload.amount = action.amount;
    if (action.priority) updatePayload.priority = action.priority;
    if (action.actionType) updatePayload.actionType = action.actionType;
    if (action.fundName) updatePayload.fundName = action.fundName;
    if (action.fundCode) updatePayload.fundCode = action.fundCode;
    await onUpdateTodo(cleanId, updatePayload);
  } else if (mType === 'delete') {
    if (!cleanId) throw new Error("大模型未返回有效的待办ID，无法删除。");
    await onDeleteTodo(cleanId);
  }
}

// ---- 5. 记账/调仓处理器 ----
export async function handleLedgerTransaction({ action, formData, user, settings }) {
  const parsedAmount = Number(action.amount);
  const fundsRef = collection(db, 'artifacts', appId, 'users', user.uid, 'funds');
  const q = query(fundsRef, where('fundCode', '==', action.fundCode));
  const querySnapshot = await getDocs(q);
  const todayStr = new Date().toISOString().split('T')[0];

  if (action.actionType === 'delete') {
    if (querySnapshot.empty) throw new Error("未找到该基金的持仓记录。");
    const fundDoc = querySnapshot.docs[0];
    const fundData = fundDoc.data();
    const transactions = fundData.transactions || [];
    const targetIndex = transactions.slice().reverse().findIndex(t => Number(t.amountRaw) === parsedAmount);
    if (targetIndex === -1) throw new Error(`未找到金额为 ${parsedAmount} 的记录。`);

    const realIndex = transactions.length - 1 - targetIndex;
    const targetTx = transactions[realIndex];
    transactions.splice(realIndex, 1);

    const fallbackNav = fundData.lastNav || 1;
    const sharesToRevert = Number((parsedAmount / fallbackNav).toFixed(2));
    let newShares = Number(fundData.shares || 0);
    if (targetTx.type === 'buy') newShares = Math.max(0, newShares - sharesToRevert);
    if (targetTx.type === 'sell') newShares += sharesToRevert;

    await updateDoc(fundDoc.ref, { transactions, shares: Number(newShares.toFixed(2)) });

    if (settings.idleFunds !== undefined) {
      let newIdle = Number(settings.idleFunds);
      if (targetTx.type === 'buy') newIdle += parsedAmount;
      if (targetTx.type === 'sell') newIdle = Math.max(0, newIdle - parsedAmount);
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'general'), { idleFunds: newIdle }, { merge: true });
    }
  } else {
    let currentNav = 1;
    try {
      const targetUrl = `https://danjuanfunds.com/djapi/fund/${action.fundCode}`;
      const fetchUrl = settings.proxyMode === 'custom' && settings.customProxyUrl
        ? (settings.customProxyUrl.includes('{{url}}') ? settings.customProxyUrl.replace('{{url}}', encodeURIComponent(targetUrl)) : settings.customProxyUrl + targetUrl)
        : `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
      const res = await fetch(fetchUrl);
      const data = await res.json();
      const actualData = settings.proxyMode === 'custom' ? data : JSON.parse(data.contents);
      const fetchedNav = parseFloat(actualData?.data?.fund_derived?.unit_nav);
      if (!isNaN(fetchedNav) && fetchedNav > 0) currentNav = fetchedNav;
    } catch (e) { console.warn("净值抓取失败"); }

    const txDate = formData.date || todayStr;
    const feeAmount = Number(formData.fee) || 0;
    let sharesDelta = 0;

    if (formData.shares && Number(formData.shares) > 0) {
      sharesDelta = Number(formData.shares);
    } else {
      let netAmount = parsedAmount;
      if (action.actionType === 'buy') netAmount -= feeAmount;
      if (action.actionType === 'sell') netAmount += feeAmount;
      sharesDelta = Number((netAmount / currentNav).toFixed(2));
    }

    const newTx = { id: Date.now().toString(), date: txDate, amountRaw: parsedAmount.toString(), type: action.actionType };

    if (!querySnapshot.empty) {
      const fundDoc = querySnapshot.docs[0];
      const fundData = fundDoc.data();
      const updatedTransactions = [...(fundData.transactions || []), newTx];
      let currentShares = Number(fundData.shares || 0);
      if (action.actionType === 'buy') currentShares += sharesDelta;
      else if (action.actionType === 'sell') currentShares = Math.max(0, currentShares - sharesDelta);

      await updateDoc(fundDoc.ref, { transactions: updatedTransactions, shares: Number(currentShares.toFixed(2)), lastNav: currentNav, lastNavDate: todayStr });
    } else {
      const newFundRef = doc(fundsRef, Date.now().toString());
      await setDoc(newFundRef, {
        name: action.fundName || action.fundCode, fundCode: action.fundCode, mode: 'auto',
        shares: action.actionType === 'buy' ? sharesDelta : 0, currentValueRaw: '0', currentValue: 0, isArchived: false,
        lastNav: currentNav, lastNavDate: txDate, transactions: [newTx], updatedAt: new Date().toISOString()
      });
    }

    if (settings.idleFunds !== undefined) {
      let newIdle = Number(settings.idleFunds);
      if (action.actionType === 'buy') newIdle = Math.max(0, newIdle - parsedAmount);
      else if (action.actionType === 'sell') newIdle += parsedAmount;
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'general'), { idleFunds: newIdle }, { merge: true });
    }
  }
}

// ---- 5. 打分快照自动存储（无需用户确认） ----
export async function handleScoreRecord({ action, user }) {
  if (!user || !db) return;
  // Firestore 文档 ID 不能含 /，将 "2026/06/05" 规范化为 "2026-06-05"
  const safeDate = (action.date || new Date().toISOString().split('T')[0]).replace(/\//g, '-');
  const snapRef = doc(db, 'artifacts', appId, 'users', user.uid, 'scoring_snapshots', safeDate);
  await setDoc(snapRef, {
    date: safeDate,
    createdAt: action.createdAt || new Date().toISOString(),
    equity: action.equity || null,
    bond: action.bond || null,
    verdict: action.verdict || null
  }, { merge: true });
}

// ---- 分发器：根据 action.toolType 路由 ----
export async function dispatchAction(action, formData, ctx) {
  const { setMessages, user } = ctx;

  if (action.toolType === 'data_confirmation') {
    await handleDataConfirmation({ action, formData, ...ctx });
    return; // 已自行管理 loading 和 messages
  }

  // memo / fof_dict / todo / ledger / score_record：写入后统一标记完成
  if (action.toolType === 'memo') {
    await handleMemoWrite({ action, user });
  } else if (action.toolType === 'score_record') {
    await handleScoreRecord({ action, user });
  } else if (action.toolType === 'fof_dict') {
    await handleFofDictWrite({ action, user, formData });
  } else if (action.toolType === 'todo') {
    await handleTodoCRUD({ action, onAddTodo: ctx.onAddTodo, onUpdateTodo: ctx.onUpdateTodo, onDeleteTodo: ctx.onDeleteTodo });
  } else {
    await handleLedgerTransaction({ action, formData, user, settings: ctx.settings });
  }

  // 统一标记 action 为 completed 并同步云端
  const activeConvId = ctx.activeConvId || 'default';
  setMessages(prev => {
    const newMsgs = markActionStatus(prev, action.cardId, 'completed');
    syncChatToCloud(user, newMsgs, activeConvId);
    return newMsgs;
  });
}
