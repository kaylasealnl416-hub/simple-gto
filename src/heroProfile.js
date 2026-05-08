export const HERO_PROFILE_STORAGE_KEY = "simple-gto-v2-hero-profile";

const EMPTY_COUNTERS = {
  hands: 0,
  vpipHands: 0,
  pfrHands: 0,
  threeBetHands: 0,
  stealFaced: 0,
  foldToStealHands: 0,
  threeBetFaced: 0,
  foldToThreeBetHands: 0,
  cbetFaced: 0,
  foldToCbetHands: 0,
  callCbetHands: 0,
  turnBetFaced: 0,
  foldTurnBetHands: 0,
  riverBetFaced: 0,
  riverCallHands: 0,
  showdownHands: 0
};

export function createHeroProfile() {
  return {
    version: 1,
    ...EMPTY_COUNTERS,
    updatedAt: null
  };
}

export function normalizeHeroProfile(profile) {
  const normalized = createHeroProfile();
  if (!profile || typeof profile !== "object") {
    return normalized;
  }
  Object.keys(EMPTY_COUNTERS).forEach((key) => {
    normalized[key] = Number.isFinite(profile[key]) ? Math.max(0, Math.round(profile[key])) : 0;
  });
  normalized.updatedAt = profile.updatedAt ?? null;
  return normalized;
}

function touch(profile) {
  profile.updatedAt = new Date().toISOString();
  return profile;
}

export function markHeroHand(profile) {
  const next = normalizeHeroProfile(profile);
  next.hands += 1;
  return touch(next);
}

export function markHeroShowdown(profile) {
  const next = normalizeHeroProfile(profile);
  next.showdownHands += 1;
  return touch(next);
}

export function recordHeroAction(profile, context, actionType) {
  const next = normalizeHeroProfile(profile);
  const voluntary = ["call", "raise", "bet"].includes(actionType);
  const aggressive = ["raise", "bet"].includes(actionType);

  if (context.countVpip && voluntary) {
    next.vpipHands += 1;
  }
  if (context.countPfr && aggressive) {
    next.pfrHands += 1;
  }
  if (context.countThreeBet && aggressive) {
    next.threeBetHands += 1;
  }
  if (context.countStealFaced) {
    next.stealFaced += 1;
    if (actionType === "fold") {
      next.foldToStealHands += 1;
    }
  }
  if (context.countThreeBetFaced) {
    next.threeBetFaced += 1;
    if (actionType === "fold") {
      next.foldToThreeBetHands += 1;
    }
  }
  if (context.countCbetFaced) {
    next.cbetFaced += 1;
    if (actionType === "fold") {
      next.foldToCbetHands += 1;
    }
    if (actionType === "call") {
      next.callCbetHands += 1;
    }
  }
  if (context.countTurnBetFaced) {
    next.turnBetFaced += 1;
    if (actionType === "fold") {
      next.foldTurnBetHands += 1;
    }
  }
  if (context.countRiverBetFaced) {
    next.riverBetFaced += 1;
    if (actionType === "call") {
      next.riverCallHands += 1;
    }
  }

  return touch(next);
}

export function profileRate(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function metric(label, numerator, denominator, highHint, lowHint) {
  const value = profileRate(numerator, denominator);
  let detail = "样本还少，先观察。";
  if (denominator >= 4) {
    detail = value >= highHint.value ? highHint.text : value <= lowHint.value ? lowHint.text : "当前接近正常训练区间。";
  }
  return {
    label,
    value,
    sample: `${numerator}/${denominator}`,
    detail
  };
}

function buildInsights(profile, scopeLabel) {
  const vpip = profileRate(profile.vpipHands, profile.hands);
  const pfr = profileRate(profile.pfrHands, profile.hands);
  const foldToSteal = profileRate(profile.foldToStealHands, profile.stealFaced);
  const foldToCbet = profileRate(profile.foldToCbetHands, profile.cbetFaced);
  const foldTurn = profileRate(profile.foldTurnBetHands, profile.turnBetFaced);
  const riverCall = profileRate(profile.riverCallHands, profile.riverBetFaced);
  const insights = [];

  if (profile.hands >= 8 && vpip >= 42) {
    insights.push(`${scopeLabel} VPIP ${vpip}%。入池偏宽，regular 会更多做价值下注。`);
  } else if (profile.hands >= 8 && vpip <= 18) {
    insights.push(`${scopeLabel} VPIP ${vpip}%。入池偏紧，regular 会更频繁偷盲。`);
  }
  if (profile.hands >= 8 && vpip - pfr >= 18) {
    insights.push(`${scopeLabel} VPIP/PFR 差距 ${vpip - pfr} 点。主动性不足，容易被攻击型 regular 隔离。`);
  }
  if (profile.stealFaced >= 4 && foldToSteal >= 62) {
    insights.push(`${scopeLabel} fold to steal ${foldToSteal}%。盲位放弃偏多，regular 会扩大偷盲。`);
  }
  if (profile.cbetFaced >= 4 && foldToCbet >= 60) {
    insights.push(`${scopeLabel} fold to c-bet ${foldToCbet}%。翻牌弃牌偏多，regular 会提高小注 c-bet。`);
  }
  if (profile.turnBetFaced >= 4 && foldTurn >= 58) {
    insights.push(`${scopeLabel} turn fold ${foldTurn}%。转牌容易被二 barrel 继续施压。`);
  }
  if (profile.riverBetFaced >= 4 && riverCall >= 50) {
    insights.push(`${scopeLabel} river call ${riverCall}%。河牌跟注偏宽，regular 会减少纯诈唬、增加薄价值。`);
  }

  return insights.length ? insights.slice(0, 3) : [`${scopeLabel}样本还不够稳定，先继续累计。`];
}

export function buildHeroProfileReport(sessionProfile, longTermProfile) {
  const session = normalizeHeroProfile(sessionProfile);
  const longTerm = normalizeHeroProfile(longTermProfile);
  const stableProfile = longTerm.hands >= 10 ? longTerm : session;
  const scope = longTerm.hands >= 10 ? "长期数据" : "本场数据";

  return {
    scope,
    sessionHands: session.hands,
    longTermHands: longTerm.hands,
    metrics: [
      metric("VPIP", stableProfile.vpipHands, stableProfile.hands, { value: 42, text: "入池偏宽。" }, { value: 18, text: "入池偏紧。" }),
      metric("PFR", stableProfile.pfrHands, stableProfile.hands, { value: 30, text: "翻前主动性偏高。" }, { value: 12, text: "翻前主动性偏低。" }),
      metric("3Bet", stableProfile.threeBetHands, stableProfile.hands, { value: 12, text: "3Bet 频率偏高。" }, { value: 3, text: "3Bet 频率偏低。" }),
      metric("Fold to steal", stableProfile.foldToStealHands, stableProfile.stealFaced, { value: 62, text: "盲位放弃偏多。" }, { value: 32, text: "盲位防守偏宽。" }),
      metric("Fold to c-bet", stableProfile.foldToCbetHands, stableProfile.cbetFaced, { value: 60, text: "翻牌抗压偏弱。" }, { value: 28, text: "翻牌继续偏宽。" }),
      metric("River call", stableProfile.riverCallHands, stableProfile.riverBetFaced, { value: 50, text: "河牌跟注偏宽。" }, { value: 18, text: "河牌放弃偏多。" })
    ],
    insights: buildInsights(stableProfile, scope),
    exploitSummary: buildInsights(stableProfile, scope).map((item) => item.replace("。", "，这是 regular 会优先利用的方向。"))
  };
}
