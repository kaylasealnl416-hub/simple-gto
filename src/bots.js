import { ARCHETYPE_BEHAVIOR, BIG_BLIND, HERO_SEAT_INDEX } from "./config.js";
import { normalizeHeroProfile, profileRate } from "./heroProfile.js";
import { analyzePostflopSituation } from "./postflopAnalysis.js";
import { evaluateSeven, handCategory, holeCardStrength } from "./poker.js";

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

function positionPressure(position) {
  return {
    BTN: -8,
    CO: -5,
    HJ: -2,
    MP: 0,
    "UTG+1": 4,
    UTG: 7,
    SB: -1,
    BB: 2
  }[position] ?? 0;
}

function isBlind(position) {
  return position === "SB" || position === "BB";
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

function chooseBetFraction(behavior, boardLength, pressureMode = false) {
  if (pressureMode) {
    return rand(0.58, 0.9);
  }
  if (boardLength === 3) {
    return rand(0.33, 0.72);
  }
  if (boardLength === 4) {
    return rand(0.46, 0.82);
  }
  return rand(0.55, 1.05);
}

function decidePreflop(state, seat) {
  const behavior = buildEffectiveBehavior(state, seat);
  const strength = holeCardStrength(seat.cards[0], seat.cards[1]);
  const toCall = Math.max(0, state.currentBet - seat.betStreet);
  const unopened = state.raiseCount === 0;
  const positionShift = positionPressure(seat.position);
  const players = playerCount(state);
  const raiseThreshold = unopened ? 62 + behavior.openShift + positionShift : 80 + behavior.openShift + positionShift;
  const callThreshold = unopened ? 90 : 62 + behavior.callShift + Math.max(0, positionShift - 2);
  const reraiseThreshold = 92 + behavior.openShift;
  const lateStealSpot = unopened && ["BTN", "CO", "SB"].includes(seat.position) && players <= 5;
  const blindDefend = isBlind(seat.position) && toCall > 0;
  const raiseAvailable = canSeatRaise(state, seat);

  if (unopened) {
    if (strength >= raiseThreshold) {
      return {
        type: "raise",
        amount: preflopRaiseAmount(state, seat, behavior)
      };
    }
    if (lateStealSpot && Math.random() < behavior.steal && strength >= raiseThreshold - 8) {
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

  if (raiseAvailable && (strength >= reraiseThreshold || (strength >= raiseThreshold - 3 && Math.random() < behavior.threeBet))) {
    return {
      type: "raise",
      amount: clamp(
        preflopRaiseAmount(state, seat, behavior, seat.position === "BB" ? 0.92 : 1),
        state.currentBet + BIG_BLIND * 2,
        seat.stack + seat.betStreet
      )
    };
  }

  if (strength >= callThreshold) {
    if (raiseAvailable && Math.random() < behavior.aggression * 0.18 && strength >= raiseThreshold - 4 && Math.random() < behavior.threeBet) {
      return {
        type: "raise",
        amount: clamp(
          preflopRaiseAmount(state, seat, behavior, 0.92),
          state.currentBet + BIG_BLIND * 2,
          seat.stack + seat.betStreet
        )
      };
    }
    if (Math.random() < behavior.coldCall || blindDefend) {
      return { type: "call", amount: toCall };
    }
  }

  if (blindDefend && toCall <= BIG_BLIND * 3.5 && strength >= callThreshold - 10 && Math.random() < behavior.defendBlind) {
    return { type: "call", amount: toCall };
  }

  if (seat.position === "BB" && toCall <= BIG_BLIND * 0.5 && strength >= callThreshold - 8) {
    return { type: "call", amount: toCall };
  }

  return { type: "fold" };
}

function decidePostflop(state, seat) {
  const behavior = buildEffectiveBehavior(state, seat);
  const postflop = analyzePostflopSituation(seat.cards, state.board);
  const madeScore = estimatePostflopScore(seat, state.board);
  const drawPressure = postflop.draws.equityBonus;
  const score = madeScore + drawPressure;
  const toCall = Math.max(0, state.currentBet - seat.betStreet);
  const unopened = state.currentBet === 0;
  const boardLength = state.board.length;
  const players = playerCount(state);
  const isPreflopAggressor = state.preflopAggressorId === seat.id;
  const pressureMode = behavior.aggression > 0.62 || behavior.bluff > 0.24 || postflop.semiBluffReady;
  const topPairish = estimatePairStrength(seat, state.board);
  const raiseAvailable = canSeatRaise(state, seat);
  const valueBetThreshold = 94 - behavior.thinValueShift;
  const callPenalty = potOddsPenalty(toCall, state.pot);
  const heroStillIn = state.seats[HERO_SEAT_INDEX]?.inHand && !state.seats[HERO_SEAT_INDEX]?.folded;
  const dryAggressorBoard = postflop.texture.cbetAdvantage === "preflop-aggressor";
  const wetWithoutEquity = postflop.texture.label === "wet" && !postflop.semiBluffReady && !topPairish;
  const cbetFrequency = clampProbability(
    behavior.cbet +
      (dryAggressorBoard ? 0.12 : 0) +
      (postflop.semiBluffReady ? 0.1 : 0) -
      (wetWithoutEquity ? 0.16 : 0)
  );
  const barrelThreshold =
    50 -
    behavior.foldPressureShift -
    (postflop.semiBluffReady ? 12 : 0) +
    (postflop.texture.label === "wet" && !postflop.semiBluffReady ? 8 : 0);

  if (unopened) {
    if (score >= valueBetThreshold) {
      return { type: "bet", amount: state.pot * chooseBetFraction(behavior, boardLength, pressureMode) };
    }
    if (isPreflopAggressor && boardLength === 3 && players <= 3 && Math.random() < cbetFrequency) {
      return { type: "bet", amount: state.pot * chooseBetFraction(behavior, boardLength, pressureMode && topPairish) };
    }
    if (isPreflopAggressor && boardLength > 3 && heroStillIn && Math.random() < behavior.barrel && score >= barrelThreshold) {
      return { type: "bet", amount: state.pot * chooseBetFraction(behavior, boardLength, pressureMode || drawPressure >= 10) };
    }
    if (score >= 72 && Math.random() < behavior.aggression) {
      return { type: "bet", amount: state.pot * chooseBetFraction(behavior, boardLength, pressureMode) };
    }
    if (score >= 48 && Math.random() < behavior.bluff) {
      return { type: "bet", amount: state.pot * chooseBetFraction(behavior, boardLength, false) };
    }
    return { type: "check" };
  }

  if (score >= 102 - behavior.thinValueShift) {
    if (raiseAvailable && Math.random() < behavior.aggression) {
      return {
        type: "raise",
        amount: clamp(
          state.currentBet * rand(2.35, pressureMode ? 3.6 : 3.1),
          state.currentBet + BIG_BLIND * 2,
          seat.stack + seat.betStreet
        )
      };
    }
    return { type: "call", amount: toCall };
  }

  if (
    score >= 76 + callPenalty ||
    (postflop.semiBluffReady && score >= 62 + callPenalty && Math.random() < behavior.showdownCurious + 0.16) ||
    (topPairish && score >= 58 + callPenalty && Math.random() < behavior.showdownCurious)
  ) {
    return { type: "call", amount: toCall };
  }

  if (score >= 58 + callPenalty && Math.random() < behavior.showdownCurious) {
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
