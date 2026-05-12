import { ARCHETYPE_BEHAVIOR, BIG_BLIND, HERO_SEAT_INDEX } from "./config.js";
import { normalizeHeroProfile, profileRate } from "./heroProfile.js";
import { analyzePostflopSituation } from "./postflopAnalysis.js";
import { classifyHoleCards, evaluateSeven, handCategory, holeCardStrength } from "./poker.js";

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function getBehavior(seat) {
  return ARCHETYPE_BEHAVIOR[seat.archetype.key];
}

function isRegular(seat) {
  return seat.archetype?.pool === "regular" || seat.archetype?.key?.startsWith("regular-") || seat.archetype?.key?.startsWith("elite-");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampProbability(value) {
  return clamp(value, 0.02, 0.95);
}

const STREET_ORDER = ["preflop", "flop", "turn", "river"];

export function priorAggressiveStreets(state, seatId) {
  const currentIndex = STREET_ORDER.indexOf(state.street);
  if (currentIndex <= 0 || !Array.isArray(state.actionLog)) {
    return [];
  }
  const streets = new Set();
  state.actionLog.forEach((entry) => {
    const entryIndex = STREET_ORDER.indexOf(entry.street);
    if (
      entry.seatId === seatId &&
      entryIndex > 0 &&
      entryIndex < currentIndex &&
      ["bet", "raise"].includes(entry.type)
    ) {
      streets.add(entry.street);
    }
  });
  return STREET_ORDER.filter((street) => streets.has(street));
}

function regularAdjustmentScale(seat) {
  if (seat.archetype.key.includes("pressure")) return 1.25;
  if (seat.archetype.key.includes("balanced")) return 0.8;
  return 1;
}

export function buildEffectiveBehavior(state, seat) {
  const base = getBehavior(seat);
  const behavior = {
    ...base,
    sizing: [...base.sizing],
    delay: [...base.delay],
    thinValueShift: 0,
    foldPressureShift: 0
  };
  if (!isRegular(seat)) {
    return behavior;
  }

  const profile = normalizeHeroProfile(state.heroLongTermProfile?.hands >= 10 ? state.heroLongTermProfile : state.heroProfile);
  const scale = regularAdjustmentScale(seat);
  const vpip = profileRate(profile.vpipHands, profile.hands);
  const pfr = profileRate(profile.pfrHands, profile.hands);
  const foldToSteal = profileRate(profile.foldToStealHands, profile.stealFaced);
  const foldToThreeBet = profileRate(profile.foldToThreeBetHands, profile.threeBetFaced);
  const foldToCbet = profileRate(profile.foldToCbetHands, profile.cbetFaced);
  const foldTurn = profileRate(profile.foldTurnBetHands, profile.turnBetFaced);
  const riverCall = profileRate(profile.riverCallHands, profile.riverBetFaced);

  if (profile.stealFaced >= 4 && foldToSteal >= 62) {
    behavior.openShift -= Math.round(3 * scale);
    behavior.steal = clampProbability(behavior.steal + 0.12 * scale);
  }
  if (profile.threeBetFaced >= 4 && foldToThreeBet >= 55) {
    behavior.threeBet = clampProbability(behavior.threeBet + 0.1 * scale);
    behavior.openShift -= Math.round(2 * scale);
  }
  if (profile.cbetFaced >= 4 && foldToCbet >= 60) {
    behavior.cbet = clampProbability(behavior.cbet + 0.15 * scale);
    behavior.barrel = clampProbability(behavior.barrel + 0.08 * scale);
    behavior.foldPressureShift += Math.round(7 * scale);
  }
  if (profile.turnBetFaced >= 4 && foldTurn >= 58) {
    behavior.barrel = clampProbability(behavior.barrel + 0.12 * scale);
    behavior.foldPressureShift += Math.round(5 * scale);
  }
  if (profile.riverBetFaced >= 4 && riverCall >= 50) {
    behavior.bluff = clampProbability(behavior.bluff - 0.08 * scale);
    behavior.thinValueShift += Math.round(8 * scale);
  }
  if (profile.hands >= 8 && vpip >= 42) {
    behavior.bluff = clampProbability(behavior.bluff - 0.04 * scale);
    behavior.thinValueShift += Math.round(5 * scale);
  }
  if (profile.hands >= 8 && vpip - pfr >= 18) {
    behavior.threeBet = clampProbability(behavior.threeBet + 0.06 * scale);
  }

  return behavior;
}

function playerCount(state) {
  return state.seats.filter((seat) => seat.inHand && !seat.folded).length;
}

function canSeatRaise(state, seat) {
  const toCall = Math.max(0, state.currentBet - seat.betStreet);
  if (seat.stack <= toCall) {
    return false;
  }
  if (state.currentBet === 0) {
    return true;
  }
  return !seat.acted;
}

function isBlind(position) {
  return position === "SB" || position === "BB";
}

const PREFLOP_RANK_ORDER = "23456789TJQKA";

const PREFLOP_PROFILE = {
  "regular-tag": {
    openFloorShift: 2,
    callFloorShift: 2,
    threeBetFloorShift: 3,
    stealWindow: 6,
    bluffThreeBetWindow: 7,
    defendFloorShift: 0,
    pairBonus: 6,
    suitedAceBonus: 5,
    suitedConnectorBonus: 3,
    weakOffsuitPenalty: 5
  },
  "regular-balanced": {
    openFloorShift: 0,
    callFloorShift: 0,
    threeBetFloorShift: 0,
    stealWindow: 8,
    bluffThreeBetWindow: 8,
    defendFloorShift: -2,
    pairBonus: 7,
    suitedAceBonus: 6,
    suitedConnectorBonus: 4,
    weakOffsuitPenalty: 4
  },
  "regular-pressure": {
    openFloorShift: -4,
    callFloorShift: 1,
    threeBetFloorShift: -7,
    stealWindow: 12,
    bluffThreeBetWindow: 13,
    defendFloorShift: -4,
    pairBonus: 7,
    suitedAceBonus: 9,
    suitedConnectorBonus: 6,
    weakOffsuitPenalty: 3
  },
  "elite-tag": {
    openFloorShift: 2,
    callFloorShift: 2,
    threeBetFloorShift: 3,
    stealWindow: 6,
    bluffThreeBetWindow: 7,
    defendFloorShift: 0,
    pairBonus: 6,
    suitedAceBonus: 5,
    suitedConnectorBonus: 3,
    weakOffsuitPenalty: 5
  },
  "elite-balanced": {
    openFloorShift: 0,
    callFloorShift: 0,
    threeBetFloorShift: 0,
    stealWindow: 8,
    bluffThreeBetWindow: 8,
    defendFloorShift: -2,
    pairBonus: 7,
    suitedAceBonus: 6,
    suitedConnectorBonus: 4,
    weakOffsuitPenalty: 4
  },
  "elite-pressure": {
    openFloorShift: -4,
    callFloorShift: 1,
    threeBetFloorShift: -7,
    stealWindow: 12,
    bluffThreeBetWindow: 13,
    defendFloorShift: -4,
    pairBonus: 7,
    suitedAceBonus: 9,
    suitedConnectorBonus: 6,
    weakOffsuitPenalty: 3
  },
  "weak-tight": {
    openFloorShift: 12,
    callFloorShift: 11,
    threeBetFloorShift: 14,
    stealWindow: 0,
    bluffThreeBetWindow: 1,
    defendFloorShift: 9,
    pairBonus: 4,
    suitedAceBonus: 2,
    suitedConnectorBonus: 0,
    weakOffsuitPenalty: 8
  },
  lag: {
    openFloorShift: -7,
    callFloorShift: -4,
    threeBetFloorShift: -5,
    stealWindow: 14,
    bluffThreeBetWindow: 10,
    defendFloorShift: -5,
    pairBonus: 8,
    suitedAceBonus: 8,
    suitedConnectorBonus: 8,
    weakOffsuitPenalty: 2
  },
  "calling-station": {
    openFloorShift: 7,
    callFloorShift: -13,
    threeBetFloorShift: 13,
    stealWindow: 3,
    bluffThreeBetWindow: 0,
    defendFloorShift: -12,
    pairBonus: 8,
    suitedAceBonus: 5,
    suitedConnectorBonus: 5,
    weakOffsuitPenalty: 3
  },
  maniac: {
    openFloorShift: -14,
    callFloorShift: -8,
    threeBetFloorShift: -12,
    stealWindow: 18,
    bluffThreeBetWindow: 15,
    defendFloorShift: -8,
    pairBonus: 9,
    suitedAceBonus: 8,
    suitedConnectorBonus: 9,
    weakOffsuitPenalty: 0
  },
  recreational: {
    openFloorShift: 1,
    callFloorShift: -5,
    threeBetFloorShift: 7,
    stealWindow: 6,
    bluffThreeBetWindow: 3,
    defendFloorShift: -3,
    pairBonus: 7,
    suitedAceBonus: 5,
    suitedConnectorBonus: 5,
    weakOffsuitPenalty: 4
  }
};

const POSTFLOP_PROFILE = {
  "regular-tag": {
    valueBetShift: -2,
    raiseValueShift: 0,
    callThresholdShift: 4,
    drawCallShift: 2,
    topPairCallShift: 3,
    cbetShift: 0.05,
    barrelShift: 0.02,
    bluffShift: -0.03,
    semiBluffShift: 0.03,
    pressureBias: 0.02,
    barrelThresholdShift: 1,
    probeThresholdShift: 4,
    bluffThresholdShift: 8,
    semiBluffBetShift: 2,
    semiBluffRaiseShift: 4,
    raiseFrequency: 0.12,
    semiBluffRaiseFrequency: 0.08,
    sizing: {
      value: [0.48, 0.72],
      cbet: [0.32, 0.48],
      bluff: [0.38, 0.58],
      pressure: [0.58, 0.82],
      probe: [0.34, 0.5],
      raise: [2.45, 3.1]
    }
  },
  "regular-balanced": {
    valueBetShift: 0,
    raiseValueShift: 1,
    callThresholdShift: 0,
    drawCallShift: 0,
    topPairCallShift: 0,
    cbetShift: 0,
    barrelShift: 0,
    bluffShift: 0,
    semiBluffShift: 0.02,
    pressureBias: 0,
    barrelThresholdShift: 0,
    probeThresholdShift: 0,
    bluffThresholdShift: 4,
    semiBluffBetShift: 0,
    semiBluffRaiseShift: 2,
    raiseFrequency: 0.1,
    semiBluffRaiseFrequency: 0.07,
    sizing: {
      value: [0.5, 0.76],
      cbet: [0.33, 0.54],
      bluff: [0.4, 0.62],
      pressure: [0.58, 0.86],
      probe: [0.34, 0.52],
      raise: [2.4, 3.05]
    }
  },
  "regular-pressure": {
    valueBetShift: -5,
    raiseValueShift: -3,
    callThresholdShift: 1,
    drawCallShift: -3,
    topPairCallShift: 1,
    cbetShift: 0.1,
    barrelShift: 0.1,
    bluffShift: 0.04,
    semiBluffShift: 0.12,
    pressureBias: 0.1,
    barrelThresholdShift: -8,
    probeThresholdShift: -4,
    bluffThresholdShift: -2,
    semiBluffBetShift: -9,
    semiBluffRaiseShift: -6,
    raiseFrequency: 0.18,
    semiBluffRaiseFrequency: 0.18,
    sizing: {
      value: [0.56, 0.86],
      cbet: [0.36, 0.62],
      bluff: [0.48, 0.74],
      pressure: [0.68, 1],
      probe: [0.42, 0.62],
      raise: [2.65, 3.55]
    }
  },
  "elite-tag": {
    valueBetShift: -2,
    raiseValueShift: 0,
    callThresholdShift: 4,
    drawCallShift: 2,
    topPairCallShift: 3,
    cbetShift: 0.05,
    barrelShift: 0.02,
    bluffShift: -0.03,
    semiBluffShift: 0.03,
    pressureBias: 0.02,
    barrelThresholdShift: 1,
    probeThresholdShift: 4,
    bluffThresholdShift: 8,
    semiBluffBetShift: 2,
    semiBluffRaiseShift: 4,
    raiseFrequency: 0.12,
    semiBluffRaiseFrequency: 0.08,
    sizing: {
      value: [0.48, 0.72],
      cbet: [0.32, 0.48],
      bluff: [0.38, 0.58],
      pressure: [0.58, 0.82],
      probe: [0.34, 0.5],
      raise: [2.45, 3.1]
    }
  },
  "elite-balanced": {
    valueBetShift: 0,
    raiseValueShift: 1,
    callThresholdShift: 0,
    drawCallShift: 0,
    topPairCallShift: 0,
    cbetShift: 0,
    barrelShift: 0,
    bluffShift: 0,
    semiBluffShift: 0.02,
    pressureBias: 0,
    barrelThresholdShift: 0,
    probeThresholdShift: 0,
    bluffThresholdShift: 4,
    semiBluffBetShift: 0,
    semiBluffRaiseShift: 2,
    raiseFrequency: 0.1,
    semiBluffRaiseFrequency: 0.07,
    sizing: {
      value: [0.5, 0.76],
      cbet: [0.33, 0.54],
      bluff: [0.4, 0.62],
      pressure: [0.58, 0.86],
      probe: [0.34, 0.52],
      raise: [2.4, 3.05]
    }
  },
  "elite-pressure": {
    valueBetShift: -5,
    raiseValueShift: -3,
    callThresholdShift: 1,
    drawCallShift: -3,
    topPairCallShift: 1,
    cbetShift: 0.1,
    barrelShift: 0.1,
    bluffShift: 0.04,
    semiBluffShift: 0.12,
    pressureBias: 0.1,
    barrelThresholdShift: -8,
    probeThresholdShift: -4,
    bluffThresholdShift: -2,
    semiBluffBetShift: -9,
    semiBluffRaiseShift: -6,
    raiseFrequency: 0.18,
    semiBluffRaiseFrequency: 0.18,
    sizing: {
      value: [0.56, 0.86],
      cbet: [0.36, 0.62],
      bluff: [0.48, 0.74],
      pressure: [0.68, 1],
      probe: [0.42, 0.62],
      raise: [2.65, 3.55]
    }
  },
  "weak-tight": {
    valueBetShift: 12,
    raiseValueShift: 10,
    callThresholdShift: 14,
    drawCallShift: 10,
    topPairCallShift: 11,
    cbetShift: -0.16,
    barrelShift: -0.16,
    bluffShift: -0.12,
    semiBluffShift: -0.08,
    pressureBias: -0.18,
    barrelThresholdShift: 13,
    probeThresholdShift: 14,
    bluffThresholdShift: 22,
    semiBluffBetShift: 14,
    semiBluffRaiseShift: 16,
    raiseFrequency: 0.04,
    semiBluffRaiseFrequency: 0.01,
    sizing: {
      value: [0.42, 0.62],
      cbet: [0.28, 0.42],
      bluff: [0.28, 0.44],
      pressure: [0.42, 0.62],
      probe: [0.26, 0.38],
      raise: [2.1, 2.65]
    }
  },
  lag: {
    valueBetShift: -6,
    raiseValueShift: -4,
    callThresholdShift: -2,
    drawCallShift: -6,
    topPairCallShift: -2,
    cbetShift: 0.08,
    barrelShift: 0.09,
    bluffShift: 0.09,
    semiBluffShift: 0.1,
    pressureBias: 0.09,
    barrelThresholdShift: -8,
    probeThresholdShift: -9,
    bluffThresholdShift: -8,
    semiBluffBetShift: -10,
    semiBluffRaiseShift: -8,
    raiseFrequency: 0.16,
    semiBluffRaiseFrequency: 0.16,
    sizing: {
      value: [0.54, 0.86],
      cbet: [0.38, 0.66],
      bluff: [0.48, 0.8],
      pressure: [0.68, 1.05],
      probe: [0.4, 0.64],
      raise: [2.6, 3.55]
    }
  },
  "calling-station": {
    valueBetShift: 8,
    raiseValueShift: 12,
    callThresholdShift: -16,
    drawCallShift: -13,
    topPairCallShift: -18,
    cbetShift: -0.14,
    barrelShift: -0.14,
    bluffShift: -0.12,
    semiBluffShift: -0.04,
    pressureBias: -0.16,
    barrelThresholdShift: 10,
    probeThresholdShift: 11,
    bluffThresholdShift: 24,
    semiBluffBetShift: 9,
    semiBluffRaiseShift: 14,
    raiseFrequency: 0.03,
    semiBluffRaiseFrequency: 0.01,
    sizing: {
      value: [0.38, 0.6],
      cbet: [0.28, 0.44],
      bluff: [0.24, 0.38],
      pressure: [0.36, 0.58],
      probe: [0.28, 0.44],
      raise: [2, 2.55]
    }
  },
  maniac: {
    valueBetShift: -12,
    raiseValueShift: -11,
    callThresholdShift: -8,
    drawCallShift: -12,
    topPairCallShift: -8,
    cbetShift: 0.18,
    barrelShift: 0.18,
    bluffShift: 0.17,
    semiBluffShift: 0.16,
    pressureBias: 0.18,
    barrelThresholdShift: -16,
    probeThresholdShift: -18,
    bluffThresholdShift: -16,
    semiBluffBetShift: -16,
    semiBluffRaiseShift: -14,
    raiseFrequency: 0.24,
    semiBluffRaiseFrequency: 0.24,
    sizing: {
      value: [0.68, 1.16],
      cbet: [0.48, 0.88],
      bluff: [0.66, 1.18],
      pressure: [0.86, 1.38],
      probe: [0.52, 0.9],
      raise: [3, 4.5]
    }
  },
  recreational: {
    valueBetShift: 4,
    raiseValueShift: 6,
    callThresholdShift: -5,
    drawCallShift: -4,
    topPairCallShift: -5,
    cbetShift: -0.04,
    barrelShift: -0.06,
    bluffShift: -0.02,
    semiBluffShift: 0,
    pressureBias: -0.04,
    barrelThresholdShift: 5,
    probeThresholdShift: 1,
    bluffThresholdShift: 6,
    semiBluffBetShift: 2,
    semiBluffRaiseShift: 6,
    raiseFrequency: 0.07,
    semiBluffRaiseFrequency: 0.04,
    sizing: {
      value: [0.42, 0.72],
      cbet: [0.3, 0.56],
      bluff: [0.32, 0.6],
      pressure: [0.48, 0.82],
      probe: [0.3, 0.56],
      raise: [2.2, 3]
    }
  }
};

const POSITION_OPEN_FLOOR = {
  UTG: 86,
  "UTG+1": 82,
  MP: 78,
  HJ: 73,
  CO: 68,
  BTN: 62,
  SB: 66,
  BB: 84
};

const POSITION_CALL_FLOOR = {
  UTG: 88,
  "UTG+1": 85,
  MP: 81,
  HJ: 77,
  CO: 73,
  BTN: 68,
  SB: 70,
  BB: 62
};

const POSITION_THREE_BET_FLOOR = {
  UTG: 106,
  "UTG+1": 102,
  MP: 98,
  HJ: 94,
  CO: 90,
  BTN: 86,
  SB: 88,
  BB: 84
};

function rankValue(rank) {
  return PREFLOP_RANK_ORDER.indexOf(rank) + 2;
}

function getPreflopProfile(seat) {
  return PREFLOP_PROFILE[seat.archetype.key] ?? PREFLOP_PROFILE.recreational;
}

function getPostflopProfile(seat) {
  return POSTFLOP_PROFILE[seat.archetype.key] ?? POSTFLOP_PROFILE.recreational;
}

function describePreflopHand(cards, profile) {
  const hand = classifyHoleCards(cards[0], cards[1]);
  const high = Math.max(rankValue(cards[0].rank), rankValue(cards[1].rank));
  const low = Math.min(rankValue(cards[0].rank), rankValue(cards[1].rank));
  const gap = high - low;
  const paired = cards[0].rank === cards[1].rank;
  const suited = cards[0].suit === cards[1].suit;
  const aceHigh = high === 14;
  const broadway = high >= 10 && low >= 10;
  const suitedConnector = suited && gap >= 1 && gap <= 2 && low >= 5;
  const suitedAce = suited && aceHigh;
  const weakOffsuit = !suited && !paired && low <= 8 && gap >= 4;
  const blocker = aceHigh || high >= 13;

  let score = holeCardStrength(cards[0], cards[1]);
  if (paired) score += profile.pairBonus;
  if (suitedAce) score += profile.suitedAceBonus;
  if (suitedConnector) score += profile.suitedConnectorBonus;
  if (broadway) score += 4;
  if (weakOffsuit) score -= profile.weakOffsuitPenalty;
  if (aceHigh && low <= 5 && suited) score += 3;

  return {
    hand,
    score,
    paired,
    suited,
    blocker,
    suitedConnector,
    suitedAce
  };
}

export function buildBotPreflopPlan(state, seat) {
  const behavior = buildEffectiveBehavior(state, seat);
  const profile = getPreflopProfile(seat);
  const hand = describePreflopHand(seat.cards, profile);
  const position = seat.position;
  const openFloor = (POSITION_OPEN_FLOOR[position] ?? 74) + behavior.openShift + profile.openFloorShift;
  const callFloor = (POSITION_CALL_FLOOR[position] ?? 76) + behavior.callShift + profile.callFloorShift;
  const threeBetFloor =
    (POSITION_THREE_BET_FLOOR[position] ?? 92) +
    behavior.openShift +
    profile.threeBetFloorShift -
    Math.round(behavior.threeBet * 12);
  const defendFloor = (POSITION_CALL_FLOOR.BB ?? 62) + profile.defendFloorShift + behavior.callShift;

  return {
    behavior,
    profile,
    hand,
    openFloor,
    callFloor,
    threeBetFloor,
    defendFloor
  };
}

function preflopRaiseAmount(state, seat, behavior, multiplierBoost = 1) {
  const [minMult, maxMult] = behavior.sizing;
  const unopened = state.raiseCount === 0;
  if (unopened) {
    return BIG_BLIND * rand(minMult, maxMult) * multiplierBoost;
  }
  return state.currentBet * rand(minMult + 0.4, maxMult + 0.7) * multiplierBoost;
}

function estimatePostflopScore(seat, board) {
  const cards = [...seat.cards, ...board];
  if (cards.length < 5) {
    return 18;
  }
  const evaluated = evaluateSeven(cards);
  const category = evaluated.score[0];
  const high = evaluated.score[1] ?? 0;
  return category * 18 + high;
}

function potOddsPenalty(toCall, pot) {
  if (toCall <= 0) return 0;
  const ratio = toCall / Math.max(BIG_BLIND, pot + toCall);
  return Math.round(ratio * 30);
}

function estimatePairStrength(seat, board) {
  const ranks = board.map((card) => card.rank);
  const holeRanks = seat.cards.map((card) => card.rank);
  const topBoardRank = [...ranks]
    .map((rank) => "23456789TJQKA".indexOf(rank))
    .sort((a, b) => b - a)[0];
  const topHoleRank = holeRanks.map((rank) => "23456789TJQKA".indexOf(rank)).sort((a, b) => b - a)[0];
  return topHoleRank >= topBoardRank;
}

function streetAdjustedRange(range, boardLength, intent) {
  const riverBoost = boardLength >= 5 && ["value", "pressure", "bluff"].includes(intent) ? 0.08 : 0;
  const turnBoost = boardLength === 4 && ["pressure", "bluff"].includes(intent) ? 0.04 : 0;
  return [range[0] + turnBoost + riverBoost, range[1] + turnBoost + riverBoost];
}

function choosePostflopBetFraction(plan, intent) {
  const baseRange = plan.sizing[intent] ?? plan.sizing.value;
  const range = streetAdjustedRange(baseRange, plan.boardLength, intent);
  return rand(range[0], range[1]);
}

function choosePostflopRaiseMultiplier(plan) {
  const [min, max] = plan.sizing.raise;
  return rand(min, max);
}

export function buildBotPostflopPlan(state, seat) {
  const behavior = buildEffectiveBehavior(state, seat);
  const profile = getPostflopProfile(seat);
  const postflop = analyzePostflopSituation(seat.cards, state.board);
  const madeScore = estimatePostflopScore(seat, state.board);
  const drawPressure = postflop.draws.equityBonus;
  const score = madeScore + drawPressure;
  const toCall = Math.max(0, state.currentBet - seat.betStreet);
  const boardLength = state.board.length;
  const players = playerCount(state);
  const isPreflopAggressor = state.preflopAggressorId === seat.id;
  const priorAggression = priorAggressiveStreets(state, seat.id);
  const hasPriorPostflopAggression = priorAggression.length > 0;
  const hasDoubleBarrelLine = priorAggression.includes("flop") && priorAggression.includes("turn");
  const hasInitiative = isPreflopAggressor || hasPriorPostflopAggression;
  const linePressureBonus = isRegular(seat)
    ? hasDoubleBarrelLine
      ? 12
      : hasPriorPostflopAggression
        ? 7
        : 0
    : hasPriorPostflopAggression
      ? 3
      : 0;
  const topPairish = estimatePairStrength(seat, state.board);
  const dryAggressorBoard = postflop.texture.cbetAdvantage === "preflop-aggressor";
  const wetWithoutEquity = postflop.texture.label === "wet" && !postflop.semiBluffReady && !topPairish;
  const cbetFrequency = clampProbability(
    behavior.cbet +
      profile.cbetShift +
      (dryAggressorBoard ? 0.12 : 0) +
      (postflop.semiBluffReady ? 0.1 + profile.semiBluffShift : 0) -
      (wetWithoutEquity ? 0.16 : 0)
  );
  const barrelFrequency = clampProbability(behavior.barrel + profile.barrelShift + (postflop.semiBluffReady ? profile.semiBluffShift : 0));
  const bluffFrequency = clampProbability(behavior.bluff + profile.bluffShift + (postflop.semiBluffReady ? profile.semiBluffShift / 2 : 0));
  const semiBluffFrequency = clampProbability(behavior.bluff + behavior.aggression * 0.22 + profile.semiBluffShift);
  const pressureMode =
    behavior.aggression + profile.pressureBias > 0.62 ||
    bluffFrequency > 0.24 ||
    (postflop.semiBluffReady && profile.semiBluffShift >= 0.06);
  const callPenalty = potOddsPenalty(toCall, state.pot);
  const valueBetThreshold = 54 + profile.valueBetShift - behavior.thinValueShift - Math.round(linePressureBonus / 2);
  const raiseValueThreshold = 86 + profile.raiseValueShift - behavior.thinValueShift;
  const callThreshold = 48 + callPenalty + profile.callThresholdShift - Math.round(linePressureBonus / 2);
  const drawCallThreshold = 38 + callPenalty + profile.drawCallShift;
  const topPairCallThreshold = 34 + callPenalty + profile.topPairCallShift;
  const marginalCallThreshold = 34 + callPenalty + profile.callThresholdShift;
  const barrelThreshold =
    34 +
    profile.barrelThresholdShift -
    behavior.foldPressureShift -
    linePressureBonus -
    (postflop.semiBluffReady ? 12 : 0) +
    (postflop.texture.label === "wet" && !postflop.semiBluffReady ? 8 : 0);
  const probeThreshold = 42 + profile.probeThresholdShift;
  const bluffThreshold = 32 + profile.bluffThresholdShift;
  const semiBluffBetThreshold = 38 + profile.semiBluffBetShift - Math.round(linePressureBonus / 2);
  const semiBluffRaiseThreshold = 44 + callPenalty + profile.semiBluffRaiseShift;

  return {
    behavior,
    profile,
    postflop,
    madeScore,
    drawPressure,
    score,
    toCall,
    boardLength,
    players,
    isPreflopAggressor,
    priorAggression,
    hasPriorPostflopAggression,
    hasDoubleBarrelLine,
    hasInitiative,
    linePressureBonus,
    topPairish,
    dryAggressorBoard,
    wetWithoutEquity,
    cbetFrequency,
    barrelFrequency,
    bluffFrequency,
    semiBluffFrequency,
    pressureMode,
    callPenalty,
    valueBetThreshold,
    raiseValueThreshold,
    callThreshold,
    drawCallThreshold,
    topPairCallThreshold,
    marginalCallThreshold,
    barrelThreshold,
    probeThreshold,
    bluffThreshold,
    semiBluffBetThreshold,
    semiBluffRaiseThreshold,
    sizing: profile.sizing
  };
}

function decidePreflop(state, seat) {
  const plan = buildBotPreflopPlan(state, seat);
  const { behavior, profile, hand } = plan;
  const toCall = Math.max(0, state.currentBet - seat.betStreet);
  const unopened = state.raiseCount === 0;
  const players = playerCount(state);
  const lateStealSpot = unopened && ["BTN", "CO", "SB"].includes(seat.position) && players <= 5;
  const blindDefend = isBlind(seat.position) && toCall > 0;
  const raiseAvailable = canSeatRaise(state, seat);

  if (unopened) {
    if (hand.score >= plan.openFloor) {
      return {
        type: "raise",
        amount: preflopRaiseAmount(state, seat, behavior)
      };
    }
    if (lateStealSpot && Math.random() < behavior.steal && hand.score >= plan.openFloor - profile.stealWindow) {
      return {
        type: "raise",
        amount: preflopRaiseAmount(state, seat, behavior, 0.96)
      };
    }
    if (toCall === 0) {
      return { type: "check" };
    }
    return { type: "fold" };
  }

  if (
    raiseAvailable &&
    (hand.score >= plan.threeBetFloor ||
      (hand.blocker && hand.score >= plan.threeBetFloor - profile.bluffThreeBetWindow && Math.random() < behavior.threeBet))
  ) {
    return {
      type: "raise",
      amount: clamp(
        preflopRaiseAmount(state, seat, behavior, seat.position === "BB" ? 0.92 : 1),
        state.currentBet + BIG_BLIND * 2,
        seat.stack + seat.betStreet
      )
    };
  }

  if (hand.score >= plan.callFloor) {
    if (
      raiseAvailable &&
      Math.random() < behavior.aggression * 0.18 &&
      hand.score >= plan.threeBetFloor - profile.bluffThreeBetWindow &&
      Math.random() < behavior.threeBet
    ) {
      return {
        type: "raise",
        amount: clamp(
          preflopRaiseAmount(state, seat, behavior, 0.92),
          state.currentBet + BIG_BLIND * 2,
          seat.stack + seat.betStreet
        )
      };
    }
    if (hand.score >= plan.callFloor + 10 || Math.random() < behavior.coldCall || blindDefend) {
      return { type: "call", amount: toCall };
    }
  }

  if (blindDefend && toCall <= BIG_BLIND * 3.5 && hand.score >= plan.defendFloor && Math.random() < behavior.defendBlind) {
    return { type: "call", amount: toCall };
  }

  if (seat.position === "BB" && toCall <= BIG_BLIND * 0.5 && hand.score >= plan.defendFloor - 8) {
    return { type: "call", amount: toCall };
  }

  return { type: "fold" };
}

function decidePostflop(state, seat) {
  const plan = buildBotPostflopPlan(state, seat);
  const { behavior, postflop, score, toCall } = plan;
  const unopened = state.currentBet === 0;
  const raiseAvailable = canSeatRaise(state, seat);
  const heroStillIn = state.seats[HERO_SEAT_INDEX]?.inHand && !state.seats[HERO_SEAT_INDEX]?.folded;

  if (unopened) {
    if (score >= plan.valueBetThreshold) {
      return { type: "bet", amount: state.pot * choosePostflopBetFraction(plan, plan.pressureMode ? "pressure" : "value") };
    }
    if (plan.isPreflopAggressor && plan.boardLength === 3 && plan.players <= 3 && Math.random() < plan.cbetFrequency) {
      return { type: "bet", amount: state.pot * choosePostflopBetFraction(plan, postflop.semiBluffReady ? "pressure" : "cbet") };
    }
    if (plan.hasInitiative && plan.boardLength > 3 && heroStillIn && Math.random() < plan.barrelFrequency && score >= plan.barrelThreshold) {
      return { type: "bet", amount: state.pot * choosePostflopBetFraction(plan, plan.pressureMode || plan.drawPressure >= 10 ? "pressure" : "value") };
    }
    if (postflop.semiBluffReady && score >= plan.semiBluffBetThreshold && Math.random() < plan.semiBluffFrequency) {
      return { type: "bet", amount: state.pot * choosePostflopBetFraction(plan, "pressure") };
    }
    if (score >= plan.probeThreshold && Math.random() < behavior.aggression) {
      return { type: "bet", amount: state.pot * choosePostflopBetFraction(plan, plan.pressureMode ? "pressure" : "probe") };
    }
    if (score >= plan.bluffThreshold && Math.random() < plan.bluffFrequency) {
      return { type: "bet", amount: state.pot * choosePostflopBetFraction(plan, "bluff") };
    }
    return { type: "check" };
  }

  if (score >= plan.raiseValueThreshold) {
    if (raiseAvailable && Math.random() < Math.max(behavior.aggression, plan.profile.raiseFrequency)) {
      return {
        type: "raise",
        amount: clamp(
          state.currentBet * choosePostflopRaiseMultiplier(plan),
          state.currentBet + BIG_BLIND * 2,
          seat.stack + seat.betStreet
        )
      };
    }
    return { type: "call", amount: toCall };
  }

  if (
    raiseAvailable &&
    postflop.semiBluffReady &&
    score >= plan.semiBluffRaiseThreshold &&
    Math.random() < plan.profile.semiBluffRaiseFrequency
  ) {
    return {
      type: "raise",
      amount: clamp(
        state.currentBet * choosePostflopRaiseMultiplier(plan),
        state.currentBet + BIG_BLIND * 2,
        seat.stack + seat.betStreet
      )
    };
  }

  if (
    score >= plan.callThreshold ||
    (postflop.semiBluffReady && score >= plan.drawCallThreshold && Math.random() < behavior.showdownCurious + 0.16) ||
    (plan.topPairish && score >= plan.topPairCallThreshold && Math.random() < behavior.showdownCurious)
  ) {
    return { type: "call", amount: toCall };
  }

  if (score >= plan.marginalCallThreshold && Math.random() < behavior.showdownCurious) {
    return { type: "call", amount: toCall };
  }

  return { type: "fold" };
}

export function getBotDelayMs(seat) {
  const [min, max] = getBehavior(seat).delay;
  return Math.round(rand(min, max));
}

export function chooseBotAction(state, seat) {
  if (state.street === "preflop") {
    return decidePreflop(state, seat);
  }
  return decidePostflop(state, seat);
}

export function describeBotOutcome(seat) {
  return `${seat.archetype.label} · VPIP ${seat.stats.vpip}% · PFR ${seat.stats.pfr}% · ${seat.resultLabel}`;
}

export function describeHandStrength(seat, board) {
  if (board.length < 3) {
    return "翻前";
  }
  return handCategory([...seat.cards, ...board]);
}
