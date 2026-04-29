import { describe, expect, test } from "bun:test";
import {
  ACTION_TIMERS,
  BIG_BLIND,
  DEVIATED_ARCHETYPES,
  ELITE_ARCHETYPES,
  POSITION_LABELS,
  SEAT_LAYOUT,
  STARTING_STACK
} from "../src/config.js";
import { chooseBotAction } from "../src/bots.js";
import {
  buildSidePots,
  classifyHoleCards,
  createDeck,
  evaluateSeven,
  formatAmount,
  normalizeRaiseTarget,
  rakeablePotAmount,
  uncalledAmountForWinner
} from "../src/poker.js";
import { buildRangeMatrix, getRecommendationForHand } from "../src/ranges.js";
import { pickArchetypes } from "../src/tablePool.js";
import { passiveSeatStatus, shouldPromptTopUp } from "../src/tableRules.js";

function card(rank, suit) {
  return { rank, suit };
}

function seat(overrides) {
  return {
    id: overrides.id,
    seatIndex: overrides.seatIndex ?? 0,
    position: overrides.position ?? "BB",
    stack: overrides.stack ?? STARTING_STACK,
    betStreet: overrides.betStreet ?? 0,
    committed: overrides.committed ?? 0,
    folded: overrides.folded ?? false,
    inHand: overrides.inHand ?? true,
    acted: overrides.acted ?? false,
    cards: overrides.cards ?? [card("7", "h"), card("2", "d")],
    archetype: overrides.archetype ?? { key: "weak-tight" },
    status: overrides.status ?? ""
  };
}

describe("poker primitives", () => {
  test("deck has 52 unique cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((entry) => `${entry.rank}${entry.suit}`)).size).toBe(52);
  });

  test("hand evaluator ranks straight flush above four of a kind", () => {
    const straightFlush = evaluateSeven([
      card("A", "s"),
      card("K", "s"),
      card("Q", "s"),
      card("J", "s"),
      card("T", "s"),
      card("2", "h"),
      card("3", "d")
    ]).score;
    const quads = evaluateSeven([
      card("9", "s"),
      card("9", "h"),
      card("9", "d"),
      card("9", "c"),
      card("A", "s"),
      card("2", "h"),
      card("3", "d")
    ]).score;
    expect(straightFlush[0]).toBeGreaterThan(quads[0]);
  });

  test("amount display keeps cash and BB together", () => {
    expect(formatAmount(30)).toBe("30 / 1.5BB");
    expect(formatAmount(BIG_BLIND * 3)).toBe("60 / 3BB");
  });

  test("raise target enforces full min raise unless player is all-in short", () => {
    expect(normalizeRaiseTarget({
      previousBet: 120,
      minRaiseTo: 220,
      stack: 4000,
      betStreet: 0,
      requestedTarget: 160
    })).toBe(220);

    expect(normalizeRaiseTarget({
      previousBet: 120,
      minRaiseTo: 220,
      stack: 180,
      betStreet: 0,
      requestedTarget: 160
    })).toBe(180);
  });
});

describe("cash game pot rules", () => {
  test("side pots keep uncalled single-player layer out of rake base", () => {
    const seats = [
      seat({ id: "short", committed: 50, cards: [card("A", "s"), card("A", "h")] }),
      seat({ id: "caller", committed: 100, cards: [card("K", "s"), card("K", "h")] }),
      seat({ id: "cover", committed: 240, cards: [card("Q", "s"), card("Q", "h")] })
    ];
    const pots = buildSidePots(seats);
    expect(pots.map((pot) => pot.amount)).toEqual([150, 100, 140]);
    expect(pots.map((pot) => pot.eligible)).toEqual([
      ["short", "caller", "cover"],
      ["caller", "cover"],
      ["cover"]
    ]);
    expect(rakeablePotAmount(pots)).toBe(250);
  });

  test("winner unmatched bet is treated as uncalled amount", () => {
    const seats = [
      seat({ id: "winner", committed: 260 }),
      seat({ id: "caller", committed: 120, folded: true }),
      seat({ id: "short", committed: 80, folded: true })
    ];
    expect(uncalledAmountForWinner(seats, "winner")).toBe(140);
  });
});

describe("preflop strategy helpers", () => {
  test("range matrix is 13 by 13 and classifies hero hand", () => {
    const matrix = buildRangeMatrix("BTN", "unopened");
    expect(matrix).toHaveLength(13);
    expect(matrix[0]).toHaveLength(13);
    expect(matrix[0][0].score).toBeGreaterThanOrEqual(0);
    expect(matrix[0][0].score).toBeLessThanOrEqual(100);
    expect(classifyHoleCards(card("A", "h"), card("K", "h"))).toBe("AKs");
  });

  test("recommendation follows hero current position and spot", () => {
    const hero = seat({
      id: "hero",
      position: "CO",
      betStreet: BIG_BLIND,
      cards: [card("A", "h"), card("K", "h")]
    });
    const rec = getRecommendationForHand(
      {
        street: "preflop",
        currentBet: BIG_BLIND,
        raiseCount: 0
      },
      hero
    );
    expect(rec.position).toBe("CO");
    expect(rec.spot).toBe("unopened");
    expect(rec.hand).toBe("AKs");
  });
});

describe("bot legality", () => {
  test("big blind checks rather than folds when action is free", () => {
    const bb = seat({
      id: "bb",
      position: "BB",
      betStreet: BIG_BLIND,
      cards: [card("7", "h"), card("2", "d")]
    });
    const action = chooseBotAction(
      {
        street: "preflop",
        currentBet: BIG_BLIND,
        raiseCount: 0,
        seats: [bb, seat({ id: "limper", position: "BTN", committed: BIG_BLIND })]
      },
      bb
    );
    expect(action.type).toBe("check");
  });
});

describe("bot table pool", () => {
  test("single table has 3 elite bots and 4 deviated bots with max duplicate 2", () => {
    const archetypes = pickArchetypes();
    const eliteKeys = new Set(ELITE_ARCHETYPES.map((entry) => entry.key));
    const deviatedKeys = new Set(DEVIATED_ARCHETYPES.map((entry) => entry.key));
    const elites = archetypes.filter((entry) => eliteKeys.has(entry.key));
    const deviated = archetypes.filter((entry) => deviatedKeys.has(entry.key));
    const deviatedCounts = new Map();
    deviated.forEach((entry) => {
      deviatedCounts.set(entry.key, (deviatedCounts.get(entry.key) ?? 0) + 1);
    });

    expect(archetypes).toHaveLength(7);
    expect(elites).toHaveLength(3);
    expect(deviated).toHaveLength(4);
    expect(Math.max(...deviatedCounts.values())).toBeLessThanOrEqual(2);
  });
});

describe("table UX rules", () => {
  test("acted seats keep meaningful street status instead of reverting to waiting", () => {
    expect(passiveSeatStatus(seat({ acted: true, betStreet: 0 }), 0)).toBe("已过牌");
    expect(passiveSeatStatus(seat({ acted: true, betStreet: 60, status: "跟注" }), 60)).toBe("已跟注");
    expect(passiveSeatStatus(seat({ acted: true, betStreet: 120, status: "加注" }), 120)).toBe("加注");
    expect(passiveSeatStatus(seat({ acted: false, betStreet: 20 }), 60)).toBe("待跟注");
  });

  test("top-up prompt interrupts only when hero is bust", () => {
    expect(shouldPromptTopUp(STARTING_STACK - 49)).toBe(false);
    expect(shouldPromptTopUp(BIG_BLIND * 100)).toBe(false);
    expect(shouldPromptTopUp(0)).toBe(true);
  });
});

describe("table constants", () => {
  test("v1 stays locked to 8-max 200BB cash table", () => {
    expect(SEAT_LAYOUT).toHaveLength(8);
    expect(POSITION_LABELS).toHaveLength(8);
    expect(BIG_BLIND).toBe(20);
    expect(STARTING_STACK).toBe(4000);
  });

  test("action timers include the extra 30 seconds for UAT thinking time", () => {
    expect(ACTION_TIMERS.preflopUnopened).toBe(40);
    expect(ACTION_TIMERS.preflopFacingRaise).toBe(45);
    expect(ACTION_TIMERS.postflop).toBe(45);
  });
});
