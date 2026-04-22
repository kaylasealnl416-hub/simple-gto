import { BIG_BLIND, PRE_FLOP_LABELS, RANGE_COLORS } from "./config.js";
import { classifyHoleCards, holeCardStrength } from "./poker.js";

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

const OPEN_THRESHOLDS = {
  UTG: 70,
  "UTG+1": 67,
  MP: 64,
  HJ: 61,
  CO: 57,
  BTN: 53,
  SB: 55,
  BB: 75
};

const CALL_THRESHOLDS = {
  UTG: 74,
  "UTG+1": 72,
  MP: 70,
  HJ: 66,
  CO: 63,
  BTN: 58,
  SB: 61,
  BB: 51
};

const THREE_BET_THRESHOLDS = {
  UTG: 84,
  "UTG+1": 83,
  MP: 81,
  HJ: 79,
  CO: 77,
  BTN: 74,
  SB: 76,
  BB: 73
};

const FOUR_BET_THRESHOLDS = {
  UTG: 91,
  "UTG+1": 90,
  MP: 89,
  HJ: 87,
  CO: 86,
  BTN: 84,
  SB: 85,
  BB: 83
};

function makeCard(rank, suit) {
  return { rank, suit };
}

function buildCell(rankA, rankB, rowIndex, colIndex) {
  const suited = rowIndex < colIndex;
  const offsuit = rowIndex > colIndex;
  const suitA = suited ? "s" : "h";
  const suitB = suited ? "s" : offsuit ? "d" : "d";
  const score = holeCardStrength(makeCard(rankA, suitA), makeCard(rankB, suitB));
  return {
    hand: classifyHoleCards(makeCard(rankA, suitA), makeCard(rankB, suitB)),
    score
  };
}

function resolveEntry(position, spot, score) {
  const openThreshold = OPEN_THRESHOLDS[position] ?? 66;
  const callThreshold = CALL_THRESHOLDS[position] ?? 66;
  const threeBetThreshold = THREE_BET_THRESHOLDS[position] ?? 78;
  const fourBetThreshold = FOUR_BET_THRESHOLDS[position] ?? 86;

  if (spot === "unopened") {
    if (score >= openThreshold + 15) {
      return { action: "raise", pct: 100, label: `加注到 ${Math.round(2.5 * BIG_BLIND)} / 2.5BB` };
    }
    if (score >= openThreshold + 9) {
      return { action: "raise", pct: 80, label: `主要加注` };
    }
    if (score >= openThreshold) {
      return { action: "mix", pct: 55, label: "边缘加注 / 混合弃牌" };
    }
    return { action: "fold", pct: 0, label: "弃牌" };
  }

  if (spot === "facingRaise") {
    if (score >= fourBetThreshold) {
      return { action: "raise", pct: 100, label: "强价值 3Bet / 4Bet" };
    }
    if (score >= threeBetThreshold) {
      return { action: "mix", pct: 65, label: "混合 3Bet / 跟注" };
    }
    if (score >= callThreshold) {
      return { action: "call", pct: 100, label: "主要跟注" };
    }
    return { action: "fold", pct: 0, label: "弃牌" };
  }

  if (score >= fourBetThreshold + 2) {
    return { action: "raise", pct: 100, label: "继续强价值再加注" };
  }
  if (score >= threeBetThreshold + 2) {
    return { action: "mix", pct: 35, label: "低频继续 / 其余弃牌" };
  }
  return { action: "fold", pct: 0, label: "弃牌" };
}

export function buildRangeMatrix(position, spot) {
  return RANKS.map((rankA, rowIndex) =>
    RANKS.map((rankB, colIndex) => {
      const cell = buildCell(rankA, rankB, rowIndex, colIndex);
      const entry = resolveEntry(position, spot, cell.score);
      return {
        hand: cell.hand,
        score: Math.max(0, Math.min(100, Math.round(cell.score))),
        action: entry.action,
        pct: entry.pct,
        label: entry.label,
        colorClass: RANGE_COLORS[entry.action]
      };
    })
  );
}

export function getHeroSpot(state, heroSeat) {
  const toCall = Math.max(0, state.currentBet - heroSeat.betStreet);
  if (state.street !== "preflop") {
    return {
      position: heroSeat.position,
      spot: "unopened",
      title: "当前只提供翻前范围表"
    };
  }
  if (state.raiseCount >= 2) {
    return {
      position: heroSeat.position,
      spot: "facing3Bet",
      title: PRE_FLOP_LABELS.facing3Bet
    };
  }
  if (state.raiseCount >= 1 && toCall > 0) {
    return {
      position: heroSeat.position,
      spot: "facingRaise",
      title: PRE_FLOP_LABELS.facingRaise
    };
  }
  return {
    position: heroSeat.position,
    spot: "unopened",
    title: PRE_FLOP_LABELS.unopened
  };
}

export function getRecommendationForHand(state, heroSeat) {
  const spot = getHeroSpot(state, heroSeat);
  const matrix = buildRangeMatrix(spot.position, spot.spot);
  const hand = classifyHoleCards(heroSeat.cards[0], heroSeat.cards[1]);
  const entry = matrix.flat().find((cell) => cell.hand === hand);
  return {
    ...spot,
    hand,
    entry
  };
}
