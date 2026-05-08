export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
export const MAX_BUY_IN_BB = 200;
export const STARTING_STACK = BIG_BLIND * MAX_BUY_IN_BB;
export const SESSION_MINUTES = 60;
export const SESSION_MS = SESSION_MINUTES * 60 * 1000;
export const TABLE_LABEL = "8 人现金局 · 10/20 · 200BB";

export const STREETS = ["preflop", "flop", "turn", "river", "showdown"];

export const POSITION_LABELS = ["BTN", "SB", "BB", "UTG", "UTG+1", "MP", "HJ", "CO"];

export const HERO_SEAT_INDEX = 5;

export const SEAT_LAYOUT = [
  { top: "7%", left: "40%" },
  { top: "7%", left: "69%" },
  { top: "32%", left: "78%" },
  { top: "56%", left: "74%" },
  { top: "74%", left: "68%" },
  { top: "74%", left: "29%" },
  { top: "61%", left: "4%" },
  { top: "31%", left: "7%" }
];

export const ACTION_TIMERS = {
  preflopUnopened: 40,
  preflopFacingRaise: 45,
  postflop: 45
};

export const INITIAL_TIME_BANK = 15;

export const REGULAR_ARCHETYPES = [
  { key: "regular-tag", label: "强 Regular · TAG" },
  { key: "regular-balanced", label: "强 Regular · 平衡型" },
  { key: "regular-pressure", label: "强 Regular · 攻击型" }
];

export const ELITE_ARCHETYPES = REGULAR_ARCHETYPES;

export const DEVIATED_ARCHETYPES = [
  { key: "weak-tight", label: "紧弱" },
  { key: "lag", label: "松凶" },
  { key: "calling-station", label: "跟注站" },
  { key: "maniac", label: "疯鱼" },
  { key: "recreational", label: "普通娱乐玩家" }
];

export const ARCHETYPE_BEHAVIOR = {
  "regular-tag": {
    openShift: 2,
    callShift: -4,
    aggression: 0.58,
    bluff: 0.18,
    threeBet: 0.21,
    coldCall: 0.42,
    steal: 0.68,
    cbet: 0.63,
    barrel: 0.46,
    defendBlind: 0.52,
    showdownCurious: 0.24,
    sizing: [2.4, 3.2],
    delay: [900, 1800]
  },
  "regular-balanced": {
    openShift: 0,
    callShift: 0,
    aggression: 0.52,
    bluff: 0.16,
    threeBet: 0.18,
    coldCall: 0.5,
    steal: 0.61,
    cbet: 0.57,
    barrel: 0.39,
    defendBlind: 0.58,
    showdownCurious: 0.28,
    sizing: [2.5, 3.3],
    delay: [1000, 1900]
  },
  "regular-pressure": {
    openShift: -2,
    callShift: -2,
    aggression: 0.66,
    bluff: 0.22,
    threeBet: 0.27,
    coldCall: 0.36,
    steal: 0.76,
    cbet: 0.71,
    barrel: 0.54,
    defendBlind: 0.63,
    showdownCurious: 0.22,
    sizing: [2.7, 3.6],
    delay: [850, 1700]
  },
  "elite-tag": {
    openShift: 2,
    callShift: -4,
    aggression: 0.58,
    bluff: 0.18,
    threeBet: 0.21,
    coldCall: 0.42,
    steal: 0.68,
    cbet: 0.63,
    barrel: 0.46,
    defendBlind: 0.52,
    showdownCurious: 0.24,
    sizing: [2.4, 3.2],
    delay: [900, 1800]
  },
  "elite-balanced": {
    openShift: 0,
    callShift: 0,
    aggression: 0.52,
    bluff: 0.16,
    threeBet: 0.18,
    coldCall: 0.5,
    steal: 0.61,
    cbet: 0.57,
    barrel: 0.39,
    defendBlind: 0.58,
    showdownCurious: 0.28,
    sizing: [2.5, 3.3],
    delay: [1000, 1900]
  },
  "elite-pressure": {
    openShift: -2,
    callShift: -2,
    aggression: 0.66,
    bluff: 0.22,
    threeBet: 0.27,
    coldCall: 0.36,
    steal: 0.76,
    cbet: 0.71,
    barrel: 0.54,
    defendBlind: 0.63,
    showdownCurious: 0.22,
    sizing: [2.7, 3.6],
    delay: [850, 1700]
  },
  "weak-tight": {
    openShift: 8,
    callShift: 8,
    aggression: 0.24,
    bluff: 0.05,
    threeBet: 0.06,
    coldCall: 0.18,
    steal: 0.42,
    cbet: 0.34,
    barrel: 0.16,
    defendBlind: 0.26,
    showdownCurious: 0.14,
    sizing: [2.4, 2.9],
    delay: [1100, 2100]
  },
  lag: {
    openShift: -8,
    callShift: -6,
    aggression: 0.72,
    bluff: 0.28,
    threeBet: 0.23,
    coldCall: 0.47,
    steal: 0.82,
    cbet: 0.72,
    barrel: 0.51,
    defendBlind: 0.72,
    showdownCurious: 0.34,
    sizing: [2.6, 3.8],
    delay: [800, 1600]
  },
  "calling-station": {
    openShift: 6,
    callShift: -10,
    aggression: 0.2,
    bluff: 0.04,
    threeBet: 0.05,
    coldCall: 0.78,
    steal: 0.36,
    cbet: 0.28,
    barrel: 0.12,
    defendBlind: 0.83,
    showdownCurious: 0.72,
    sizing: [2.3, 2.9],
    delay: [1000, 2000]
  },
  maniac: {
    openShift: -14,
    callShift: -12,
    aggression: 0.84,
    bluff: 0.36,
    threeBet: 0.34,
    coldCall: 0.52,
    steal: 0.9,
    cbet: 0.82,
    barrel: 0.64,
    defendBlind: 0.8,
    showdownCurious: 0.48,
    sizing: [3, 4.2],
    delay: [650, 1500]
  },
  recreational: {
    openShift: -1,
    callShift: -4,
    aggression: 0.38,
    bluff: 0.12,
    threeBet: 0.1,
    coldCall: 0.58,
    steal: 0.5,
    cbet: 0.42,
    barrel: 0.24,
    defendBlind: 0.55,
    showdownCurious: 0.42,
    sizing: [2.3, 3.1],
    delay: [900, 1900]
  }
};

export const PRE_FLOP_LABELS = {
  unopened: "无人入池",
  facingRaise: "面对加注",
  facing3Bet: "面对 3Bet"
};

export const RANGE_COLORS = {
  raise: "raise",
  call: "call",
  fold: "fold",
  mix: "mix"
};
