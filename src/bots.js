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

function decidePreflop(state, seat) {
  const behavior = getBehavior(seat);
  const strength = holeCardStrength(seat.cards[0], seat.cards[1]);
  const toCall = Math.max(0, state.currentBet - seat.betStreet);
  const unopened = state.raiseCount === 0;
  const raiseThreshold = unopened ? 62 + behavior.openShift : 80 + behavior.openShift;
  const callThreshold = unopened ? 90 : 62 + behavior.callShift;
  const reraiseThreshold = 92 + behavior.openShift;

  if (unopened) {
    if (strength >= raiseThreshold) {
      return {
        type: "raise",
        amount: state.currentBet === 0 ? BIG_BLIND * rand(2.4, 3.2) : state.currentBet * rand(2.8, 3.5)
      };
    }
    return { type: "fold" };
  }

  if (strength >= reraiseThreshold) {
    return {
      type: "raise",
      amount: clamp(state.currentBet * rand(2.8, 3.6), state.currentBet + BIG_BLIND * 2, seat.stack + seat.betStreet)
    };
  }

  if (strength >= callThreshold) {
    if (Math.random() < behavior.aggression * 0.18 && strength >= raiseThreshold - 4) {
      return {
        type: "raise",
        amount: clamp(state.currentBet * rand(2.6, 3.2), state.currentBet + BIG_BLIND * 2, seat.stack + seat.betStreet)
      };
    }
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

  if (unopened) {
    if (score >= 94) {
      return { type: "bet", amount: state.pot * rand(0.58, 0.78) };
    }
    if (score >= 72 && Math.random() < behavior.aggression) {
      return { type: "bet", amount: state.pot * rand(0.33, 0.58) };
    }
    if (score >= 48 && Math.random() < behavior.bluff) {
      return { type: "bet", amount: state.pot * rand(0.25, 0.4) };
    }
    return { type: "check" };
  }

  if (score >= 102) {
    if (Math.random() < behavior.aggression) {
      return {
        type: "raise",
        amount: clamp(state.currentBet * rand(2.4, 3.2), state.currentBet + BIG_BLIND * 2, seat.stack + seat.betStreet)
      };
    }
    return { type: "call", amount: toCall };
  }

  if (score >= 76) {
    return { type: "call", amount: toCall };
  }

  if (score >= 58 && Math.random() < behavior.bluff * 0.9) {
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
