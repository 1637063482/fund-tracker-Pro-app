// 基金智能标签组件：根据基金类型和指标自动渲染颜色标签（如指数型、主动型、债券型等分类徽章）
import React from 'react';

export function SmartBadges({ fund, fundTab, fundProfiles }) {
  if (fundTab !== 'active' || fund.mode !== 'auto' || !fund.fundCode) return null;
  const profile = fundProfiles[fund.fundCode];
  if (!profile) return null;

  const isBond = fund.name.includes("债") || (profile.type_desc && profile.type_desc.includes("债"));
  const derived = profile.fund_derived || {};

  let rankPercentile = 0.5;
  if (derived.srank_l1y && derived.srank_l1y.includes('/')) {
    const parts = derived.srank_l1y.split('/');
    const pos = parseFloat(parts[0]);
    const total = parseFloat(parts[1]);
    if (!isNaN(pos) && !isNaN(total) && total > 0) {
      rankPercentile = pos / total;
    }
  }

  const returnRate = fund.totalInvested > 0 ? fund.profit / fund.totalInvested : 0;
  const grl1m = parseFloat(derived.nav_grl1m || 0);
  const badges = [];

  const isGarbage = rankPercentile > 0.7 && returnRate < 0;
  const isMediocre = rankPercentile > 0.7 && returnRate >= 0;
  const isTopTier = rankPercentile < 0.2;

  if (isGarbage) {
    badges.push(<span key="warn" className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-red-50 text-red-500 border border-red-200 dark:bg-red-900/30 dark:border-red-800 dark:text-red-400 leading-none shadow-sm whitespace-nowrap">⚠️ 弱势止损</span>);
  } else if (isMediocre) {
    badges.push(<span key="warn" className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-slate-100 text-slate-500 border border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 leading-none shadow-sm whitespace-nowrap">🥱 表现平庸</span>);
  } else {
    const profitThreshold = isBond ? 0.04 : 0.15;
    const dropThreshold = isBond ? -0.5 : (isTopTier ? -3.0 : -5.0);

    if (returnRate > profitThreshold) {
      const badgeText = isBond ? "🥚 宜收蛋" : "📈 止盈区";
      badges.push(<span key="sell" className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-600 border border-red-200 dark:bg-red-900/30 dark:border-red-800 dark:text-red-400 leading-none shadow-sm whitespace-nowrap">{badgeText}</span>);
    } else if (grl1m < dropThreshold) {
      const badgeText = isBond ? "💧 加仓点" : (isTopTier ? "🔥 优质错杀" : "🔥 黄金坑");
      badges.push(<span key="buy" className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-green-100 text-green-600 border border-green-200 dark:bg-green-900/30 dark:border-green-800 dark:text-green-400 leading-none shadow-sm whitespace-nowrap">{badgeText}</span>);
    }
  }
  return badges;
}
