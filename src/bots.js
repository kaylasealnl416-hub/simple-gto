import { ARCHETYPE_BEHAVIOR, BIG_BLIND } from "./config.js";
import { evaluateSeven, handCategory, holeCardStrength } from "./poker.js";

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function getBehavior(seat) {
  return ARCHETYPE_BEHAVIOR[seat.archetype.key];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  const unopened = state.currentBet === 0;
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
  const behavior = getBehavior(seat);
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
  const behavior = getBehavior(seat);
  const score = estimatePostflopScore(seat, state.board);
  const toCall = Math.max(0, state.currentBet - seat.betStreet);
  const unopened = state.currentBet === 0;
  const boardLength = state.board.length;
  const players = playerCount(state);
  const isPreflopAggressor = state.preflopAggressorId === seat.id;
  const pressureMode = behavior.aggression > 0.62 || behavior.bluff > 0.24;
  const topPairish = estimatePairStrength(seat, state.board);
  const raiseAvailable = canSeatRaise(state, seat);

  if (unopened) {
    if (score >= 94) {
      return { type: "bet", amount: state.pot * chooseBetFraction(behavior, boardLength, pressureMode) };
    }
    if (isPreflopAggressor && boardLength === 3 && players <= 3 && Math.random() < behavior.cbet) {
      return { type: "bet", amount: state.pot * chooseBetFraction(behavior, boardLength, pressureMode && topPairish) };
    }
    if (score >= 72 && Math.random() < behavior.aggression) {
      return { type: "bet", amount: state.pot * chooseBetFraction(behavior, boardLength, pressureMode) };
    }
    if (score >= 48 && Math.random() < behavior.bluff) {
      return { type: "bet", amount: state.pot * chooseBetFraction(behavior, boardLength, false) };
    }
    return { type: "check" };
  }

  if (score >= 102) {
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

  if (score >= 76 || (topPairish && score >= 58 && Math.random() < behavior.showdownCurious)) {
    return { type: "call", amount: toCall };
  }

  if (score >= 58 && Math.random() < behavior.showdownCurious) {
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
