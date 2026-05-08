const RANK_ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const RANK_VALUE = Object.fromEntries(RANK_ORDER.map((rank, index) => [rank, index + 2]));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rankValue(card) {
  return RANK_VALUE[card.rank];
}

function uniqueRanks(cards) {
  return [...new Set(cards.map(rankValue))].sort((a, b) => a - b);
}

function wheelRanks(ranks) {
  return ranks.includes(14) ? [1, ...ranks] : ranks;
}

function hasStraight(ranks) {
  const values = wheelRanks([...new Set(ranks)].sort((a, b) => a - b));
  let run = 1;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === values[i - 1] + 1) {
      run += 1;
      if (run >= 5) return true;
    } else if (values[i] !== values[i - 1]) {
      run = 1;
    }
  }
  return false;
}

function straightOutRanks(ranks) {
  if (hasStraight(ranks)) return [];
  const current = new Set(ranks);
  const outs = [];
  for (let candidate = 2; candidate <= 14; candidate += 1) {
    if (current.has(candidate)) continue;
    if (hasStraight([...ranks, candidate])) {
      outs.push(candidate);
    }
  }
  return outs;
}

function suitCounts(cards) {
  const counts = new Map();
  cards.forEach((card) => counts.set(card.suit, (counts.get(card.suit) ?? 0) + 1));
  return counts;
}

function countPairs(board) {
  const counts = new Map();
  board.forEach((card) => counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1));
  return [...counts.values()];
}

function boardConnectedness(boardRanks) {
  const ranks = wheelRanks(boardRanks);
  let score = 0;
  for (let start = 0; start < ranks.length; start += 1) {
    for (let end = start + 1; end < ranks.length; end += 1) {
      const span = ranks[end] - ranks[start];
      const count = end - start + 1;
      if (count >= 3 && span <= 4) score = Math.max(score, 30);
      else if (count >= 3 && span <= 6) score = Math.max(score, 18);
      else if (count >= 2 && span <= 3) score = Math.max(score, 10);
    }
  }
  return score;
}

export function analyzeBoardTexture(board) {
  if (board.length < 3) {
    return {
      label: "preflop",
      wetness: 0,
      paired: false,
      trips: false,
      monotone: false,
      twoTone: false,
      rainbow: true,
      connected: false,
      highCard: 0,
      broadwayCount: 0,
      cbetAdvantage: "neutral"
    };
  }

  const boardRanks = uniqueRanks(board);
  const highCard = Math.max(...boardRanks);
  const broadwayCount = boardRanks.filter((rank) => rank >= 10).length;
  const pairedCounts = countPairs(board);
  const paired = pairedCounts.some((count) => count === 2);
  const trips = pairedCounts.some((count) => count >= 3);
  const suits = [...suitCounts(board).values()].sort((a, b) => b - a);
  const monotone = suits[0] >= 3;
  const twoTone = suits[0] === 2;
  const rainbow = suits[0] === 1;
  const connectedness = boardConnectedness(boardRanks);

  const wetness = clamp(
    connectedness + (monotone ? 34 : 0) + (twoTone ? 16 : 0) + (broadwayCount >= 2 ? 8 : 0) - (paired ? 8 : 0),
    0,
    100
  );
  const label = wetness >= 50 ? "wet" : wetness >= 32 ? "dynamic" : "dry";
  const cbetAdvantage =
    label === "dry" && (highCard >= 13 || paired)
      ? "preflop-aggressor"
      : label === "wet"
        ? "caller"
        : "neutral";

  return {
    label,
    wetness,
    paired,
    trips,
    monotone,
    twoTone,
    rainbow,
    connected: connectedness >= 18,
    highCard,
    broadwayCount,
    cbetAdvantage
  };
}

export function analyzeDraws(holeCards, board) {
  if (board.length < 3) {
    return {
      madeFlush: false,
      flushDraw: false,
      backdoorFlushDraw: false,
      madeStraight: false,
      openEndedStraightDraw: false,
      gutshotStraightDraw: false,
      straightDraw: false,
      comboDraw: false,
      overcards: 0,
      equityBonus: 0
    };
  }

  const cards = [...holeCards, ...board];
  const suits = suitCounts(cards);
  const madeFlush = [...suits.values()].some((count) => count >= 5);
  const flushDraw = !madeFlush && [...suits.entries()].some(([suit, count]) => count >= 4 && holeCards.some((card) => card.suit === suit));
  const backdoorFlushDraw =
    board.length === 3 &&
    !madeFlush &&
    !flushDraw &&
    [...suits.entries()].some(([suit, count]) => count === 3 && holeCards.some((card) => card.suit === suit));

  const ranks = uniqueRanks(cards);
  const madeStraight = hasStraight(ranks);
  const outs = straightOutRanks(ranks);
  const openEndedStraightDraw = !madeStraight && outs.length >= 2;
  const gutshotStraightDraw = !madeStraight && outs.length === 1;
  const straightDraw = openEndedStraightDraw || gutshotStraightDraw;
  const boardHigh = Math.max(...uniqueRanks(board));
  const overcards = holeCards.filter((card) => rankValue(card) > boardHigh).length;
  const comboDraw = (flushDraw && straightDraw) || (flushDraw && overcards >= 1) || (straightDraw && overcards >= 2);

  const equityBonus =
    (madeFlush ? 30 : 0) +
    (madeStraight ? 28 : 0) +
    (comboDraw ? 24 : 0) +
    (!comboDraw && flushDraw ? 14 : 0) +
    (!comboDraw && openEndedStraightDraw ? 13 : 0) +
    (!comboDraw && gutshotStraightDraw ? 7 : 0) +
    (backdoorFlushDraw ? 3 : 0) +
    overcards * 3;

  return {
    madeFlush,
    flushDraw,
    backdoorFlushDraw,
    madeStraight,
    openEndedStraightDraw,
    gutshotStraightDraw,
    straightDraw,
    comboDraw,
    overcards,
    equityBonus
  };
}

export function analyzePostflopSituation(holeCards, board) {
  const texture = analyzeBoardTexture(board);
  const draws = analyzeDraws(holeCards, board);
  return {
    texture,
    draws,
    semiBluffReady: draws.comboDraw || draws.flushDraw || draws.openEndedStraightDraw,
    pressureScore: clamp(draws.equityBonus + Math.round(texture.wetness / 4), 0, 70)
  };
}
