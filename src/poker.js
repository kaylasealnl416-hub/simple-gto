import { BIG_BLIND } from "./config.js";

const RANK_ORDER = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const RANK_VALUE = Object.fromEntries(RANK_ORDER.map((rank, index) => [rank, index + 2]));
const SUIT_SYMBOL = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣"
};

export function createDeck() {
  const deck = [];
  for (const rank of RANK_ORDER) {
    for (const suit of Object.keys(SUIT_SYMBOL)) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function cardLabel(card) {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}

export function isRedSuit(card) {
  return card.suit === "h" || card.suit === "d";
}

export function classifyHoleCards(cardA, cardB) {
  const first = RANK_VALUE[cardA.rank] >= RANK_VALUE[cardB.rank] ? cardA : cardB;
  const second = first === cardA ? cardB : cardA;
  if (cardA.rank === cardB.rank) {
    return `${cardA.rank}${cardB.rank}`;
  }
  const suited = cardA.suit === cardB.suit ? "s" : "o";
  return `${first.rank}${second.rank}${suited}`;
}

export function holeCardStrength(cardA, cardB) {
  const a = RANK_VALUE[cardA.rank];
  const b = RANK_VALUE[cardB.rank];
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  const paired = a === b;
  const suited = cardA.suit === cardB.suit;
  const gap = Math.abs(a - b);
  let score = high * 4 + low * 2;
  if (paired) {
    score += 34 + high * 3;
  }
  if (suited) {
    score += 8;
  }
  if (gap === 1) {
    score += 6;
  } else if (gap === 2) {
    score += 3;
  } else if (gap >= 4) {
    score -= 4;
  }
  if (high >= 12) {
    score += 4;
  }
  if (paired && high >= 10) {
    score += 8;
  }
  return score;
}

function sortRanksDesc(ranks) {
  return [...ranks].sort((a, b) => b - a);
}

function findStraight(sortedRanks) {
  const unique = [...new Set(sortedRanks)];
  if (unique[0] === 14) {
    unique.push(1);
  }
  let run = 1;
  let bestHigh = 0;
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i - 1] - 1 === unique[i]) {
      run += 1;
      if (run >= 5) {
        bestHigh = unique[i - 4] === 14 && unique[i] === 1 ? 5 : unique[i - 4];
      }
    } else {
      run = 1;
    }
  }
  return bestHigh;
}

function scoreFiveCards(cards) {
  const ranks = sortRanksDesc(cards.map((card) => RANK_VALUE[card.rank]));
  const suits = cards.map((card) => card.suit);
  const counts = new Map();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });
  const flush = suits.every((suit) => suit === suits[0]);
  const straightHigh = findStraight(ranks);

  if (flush && straightHigh) {
    return [8, straightHigh];
  }
  if (groups[0][1] === 4) {
    const kicker = groups.find(([, count]) => count === 1)[0];
    return [7, groups[0][0], kicker];
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return [6, groups[0][0], groups[1][0]];
  }
  if (flush) {
    return [5, ...ranks];
  }
  if (straightHigh) {
    return [4, straightHigh];
  }
  if (groups[0][1] === 3) {
    const kickers = groups.filter(([, count]) => count === 1).map(([rank]) => rank).sort((a, b) => b - a);
    return [3, groups[0][0], ...kickers];
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairRanks = groups.filter(([, count]) => count === 2).map(([rank]) => rank).sort((a, b) => b - a);
    const kicker = groups.find(([, count]) => count === 1)[0];
    return [2, ...pairRanks, kicker];
  }
  if (groups[0][1] === 2) {
    const kickers = groups.filter(([, count]) => count === 1).map(([rank]) => rank).sort((a, b) => b - a);
    return [1, groups[0][0], ...kickers];
  }
  return [0, ...ranks];
}

function compareScores(scoreA, scoreB) {
  const length = Math.max(scoreA.length, scoreB.length);
  for (let i = 0; i < length; i += 1) {
    const a = scoreA[i] ?? 0;
    const b = scoreB[i] ?? 0;
    if (a !== b) {
      return a > b ? 1 : -1;
    }
  }
  return 0;
}

function combinations(cards, size) {
  const result = [];
  const path = [];
  function walk(start) {
    if (path.length === size) {
      result.push([...path]);
      return;
    }
    for (let i = start; i < cards.length; i += 1) {
      path.push(cards[i]);
      walk(i + 1);
      path.pop();
    }
  }
  walk(0);
  return result;
}

export function evaluateSeven(cards) {
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const score = scoreFiveCards(combo);
    if (!best || compareScores(score, best.score) > 0) {
      best = { score, cards: combo };
    }
  }
  return best;
}

export function formatAmount(amount) {
  const bb = amount / BIG_BLIND;
  const bbText = Number.isInteger(bb) ? `${bb}` : bb.toFixed(1).replace(/\.0$/, "");
  return `${Math.round(amount)} / ${bbText}BB`;
}

export function buildSidePots(seats) {
  const commitments = [...new Set(seats.filter((seat) => seat.committed > 0).map((seat) => seat.committed))].sort((a, b) => a - b);
  let previous = 0;
  const pots = [];
  for (const level of commitments) {
    const contributors = seats.filter((seat) => seat.committed >= level);
    const amount = (level - previous) * contributors.length;
    if (amount > 0) {
      pots.push({
        amount,
        eligible: contributors.filter((seat) => !seat.folded).map((seat) => seat.id)
      });
    }
    previous = level;
  }
  return pots;
}

export function rakeablePotAmount(pots) {
  return pots
    .filter((pot) => pot.eligible.length > 1)
    .reduce((sum, pot) => sum + pot.amount, 0);
}

export function uncalledAmountForWinner(seats, winnerId) {
  const winner = seats.find((seat) => seat.id === winnerId);
  if (!winner) return 0;
  const otherMax = Math.max(
    0,
    ...seats.filter((seat) => seat.id !== winnerId).map((seat) => seat.committed)
  );
  return Math.max(0, winner.committed - otherMax);
}

export function handCategory(cards) {
  const result = evaluateSeven(cards);
  const category = result.score[0];
  const labels = [
    "高牌",
    "一对",
    "两对",
    "三条",
    "顺子",
    "同花",
    "葫芦",
    "四条",
    "同花顺"
  ];
  return labels[category];
}
