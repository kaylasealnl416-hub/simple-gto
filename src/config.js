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
  { top: "62%", left: "74%" },
  { top: "75%", left: "53%" },
  { top: "74%", left: "29%" },
  { top: "61%", left: "4%" },
  { top: "31%", left: "7%" }
];

export const ACTION_TIMERS = {
  preflopUnopened: 10,
  preflopFacingRaise: 15,
  postflop: 15
};

export const INITIAL_TIME_BANK = 15;

export const ELITE_ARCHETYPES = [
  { key: "elite-tag", label: "顶级 TAG" },
  { key: "elite-balanced", label: "顶级平衡派" },
  { key: "elite-pressure", label: "顶级压迫派" }
];

export const DEVIATED_ARCHETYPES = [
  { key: "weak-tight", label: "紧弱" },
  { key: "lag", label: "松凶" },
  { key: "calling-station", label: "跟注站" },
  { key: "maniac", label: "疯鱼" }
];

export const ARCHETYPE_BEHAVIOR = {
  "elite-tag": { openShift: 2, callShift: -4, aggression: 0.58, bluff: 0.18, delay: [900, 1800] },
  "elite-balanced": { openShift: 0, callShift: 0, aggression: 0.52, bluff: 0.16, delay: [1000, 1900] },
  "elite-pressure": { openShift: -2, callShift: -2, aggression: 0.66, bluff: 0.22, delay: [850, 1700] },
  "weak-tight": { openShift: 8, callShift: 8, aggression: 0.24, bluff: 0.05, delay: [1100, 2100] },
  lag: { openShift: -8, callShift: -6, aggression: 0.72, bluff: 0.28, delay: [800, 1600] },
  "calling-station": { openShift: 6, callShift: -10, aggression: 0.2, bluff: 0.04, delay: [1000, 2000] },
  maniac: { openShift: -14, callShift: -12, aggression: 0.84, bluff: 0.36, delay: [650, 1500] }
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
