import {
  ACTION_TIMERS,
  BIG_BLIND,
  HERO_SEAT_INDEX,
  INITIAL_TIME_BANK,
  POSITION_LABELS,
  SEAT_LAYOUT,
  SESSION_MS,
  SMALL_BLIND,
  STARTING_STACK,
  TABLE_LABEL
} from "./config.js";
import { chooseBotAction, getBotDelayMs } from "./bots.js";
import { buildRangeMatrix, getRecommendationForHand } from "./ranges.js";
import { pickArchetypes } from "./tablePool.js";
import { passiveSeatStatus, shouldPromptTopUp } from "./tableRules.js";
import {
  buildSidePots,
  cardLabel,
  classifyHoleCards,
  createDeck,
  evaluateSeven,
  formatAmount,
  handCategory,
  isRedSuit,
  normalizeRaiseTarget,
  rakeablePotAmount,
  uncalledAmountForWinner
} from "./poker.js";

const STORAGE_KEY = "simple-gto-v1-session";
const RAKE_PERCENT = 0.05;
const RAKE_CAP = BIG_BLIND * 3;
const app = document.getElementById("app");
const BOT_NAME_POOL = [
  "NorthRake",
  "ColdRiver",
  "StoneReg",
  "BlueBlind",
  "TurnPress",
  "QuietCutoff",
  "LateRaise",
  "RiverSense",
  "TableLine",
  "EdgeStack",
  "CalmValue",
  "PivotPot"
];

const state = {
  session: null,
  rangeOpen: false,
  optionsOpen: false,
  reviewOpen: false,
  pauseNotice: null,
  topUpPrompt: null,
  selectedRangeHand: null,
  confirmingAllIn: false,
  timerIntervalId: null,
  countdownIntervalId: null,
  botActionTimer: null,
  streetRunoutTimer: null
};

function saveSession() {
  if (!state.session) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.session));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function createSeat(id, seatIndex) {
  return {
    id,
    seatIndex,
    name: seatIndex === HERO_SEAT_INDEX ? "你" : BOT_NAME_POOL[id % BOT_NAME_POOL.length],
    stack: STARTING_STACK,
    betStreet: 0,
    committed: 0,
    inHand: true,
    folded: false,
    allIn: false,
    acted: false,
    cards: [],
    position: "",
    archetype: null,
    status: "",
    selectedRaiseAmount: null,
    timeBankSeconds: INITIAL_TIME_BANK,
    totalInvested: STARTING_STACK,
    stats: {
      hands: 0,
      vpipHands: 0,
      pfrHands: 0,
      vpip: 0,
      pfr: 0
    },
    handFlags: {
      vpipMarked: false,
      pfrMarked: false
    },
    resultLabel: "持平",
    autoActions: {
      fold: false,
      check: false,
      checkFold: false,
      callAny: false
    }
  };
}

function clearAutoActions(seat) {
  seat.autoActions = {
    fold: false,
    check: false,
    checkFold: false,
    callAny: false
  };
}

function createSession() {
  const seats = Array.from({ length: 8 }, (_, index) => createSeat(index, index));
  const archetypes = pickArchetypes();
  seats.forEach((seat) => {
    if (seat.seatIndex !== HERO_SEAT_INDEX) {
      seat.archetype = archetypes.pop();
    }
  });

  const now = Date.now();
  return {
    startedAt: now,
    endsAt: now + SESSION_MS,
    handNumber: 0,
    dealerIndex: 7,
    seats,
    phase: "idle",
    street: "preflop",
    board: [],
    pot: 0,
    deck: [],
    currentBet: 0,
    minRaiseTo: BIG_BLIND * 2,
    raiseCount: 0,
    preflopAggressorId: null,
    streetAggressorId: null,
    actorIndex: null,
    handHistory: [],
    pendingMistake: null,
    lastMistake: null,
    lastRake: 0,
    pendingHeroTopUp: false,
    revealedSeatIds: [],
    sessionEndingAfterHand: false,
    timer: {
      secondsLeft: 0,
      expiresAt: 0,
      baseDeadline: 0
    },
    sessionSummary: null
  };
}

function beginNewSession() {
  clearTimers();
  state.session = createSession();
  state.rangeOpen = false;
  state.optionsOpen = false;
  state.reviewOpen = false;
  state.pauseNotice = null;
  state.confirmingAllIn = false;
  state.topUpPrompt = null;
  state.selectedRangeHand = null;
  startNextHand();
  startSessionTimer();
  render();
}

function restoreSession(existing) {
  clearTimers();
  state.session = existing;
  state.session.seats.forEach((seat) => {
    if (!Number.isFinite(seat.totalInvested)) {
      seat.totalInvested = STARTING_STACK;
    }
  });
  if (!Array.isArray(state.session.revealedSeatIds)) {
    state.session.revealedSeatIds = [];
  }
  if (!state.session.lastMistake) {
    state.session.lastMistake = state.session.pendingMistake ?? null;
  }
  state.session.sessionEndingAfterHand = Boolean(state.session.sessionEndingAfterHand);
  state.session.pendingHeroTopUp = Boolean(state.session.pendingHeroTopUp);
  updateSeatResultLabels();
  state.rangeOpen = false;
  state.optionsOpen = false;
  state.reviewOpen = Boolean(existing.sessionSummary);
  state.confirmingAllIn = false;
  state.topUpPrompt = null;
  startSessionTimer();
  if (!state.reviewOpen && state.session.phase !== "playing") {
    resumeBetweenHands();
    return;
  }
  if (!state.reviewOpen && shouldResumeRunout()) {
    runBoardToShowdown();
    render();
    return;
  }
  const actor = state.session.actorIndex != null ? state.session.seats[state.session.actorIndex] : null;
  if (!state.reviewOpen && actor?.inHand && !actor.folded && !actor.allIn) {
    setActor(actor);
  }
  render();
  queueBotIfNeeded();
}

function endSession() {
  if (!state.session) return;
  clearTimers();
  const hero = getHeroSeat();
  const summary = {
    durationMs: Date.now() - state.session.startedAt,
    handCount: state.session.handNumber,
    heroResult: seatNetResult(hero),
    heroFinalStack: hero.stack,
    bots: state.session.seats
      .filter((seat) => seat.seatIndex !== HERO_SEAT_INDEX)
      .map((seat) => ({
        id: seat.id,
        name: seat.name,
        label: seat.archetype.label,
        vpip: seat.stats.vpip,
        pfr: seat.stats.pfr,
        result: seatNetResult(seat)
      }))
      .sort((left, right) => right.result - left.result),
    mistake: state.session.lastMistake ?? state.session.pendingMistake,
    recentHands: [...state.session.handHistory].slice(0, 6)
  };
  state.session.sessionSummary = summary;
  state.session.phase = "review";
  state.session.actorIndex = null;
  state.rangeOpen = false;
  state.optionsOpen = false;
  state.pauseNotice = null;
  state.confirmingAllIn = false;
  state.topUpPrompt = null;
  state.reviewOpen = true;
  saveSession();
  render();
}

function requestEndSession() {
  if (!state.session) return;
  if (state.session.phase === "playing") {
    state.session.sessionEndingAfterHand = true;
    state.optionsOpen = false;
    saveSession();
    render();
    return;
  }
  endSession();
}

function clearTimers() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
  if (state.countdownIntervalId) {
    clearInterval(state.countdownIntervalId);
    state.countdownIntervalId = null;
  }
  if (state.botActionTimer) {
    clearTimeout(state.botActionTimer);
    state.botActionTimer = null;
  }
  if (state.streetRunoutTimer) {
    clearTimeout(state.streetRunoutTimer);
    state.streetRunoutTimer = null;
  }
}

function startSessionTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
  }
  state.timerIntervalId = setInterval(() => {
    if (!state.session) return;
    if (Date.now() >= state.session.endsAt) {
      state.session.sessionEndingAfterHand = true;
      renderTopOnly();
      if (state.session.phase !== "playing") {
        endSession();
      }
      return;
    }
    renderTopOnly();
  }, 1000);
}

function updateDerivedPot() {
  state.session.pot = state.session.seats.reduce((sum, seat) => sum + seat.committed, 0);
}

function assignPositions() {
  const { seats, dealerIndex } = state.session;
  seats.forEach((seat) => {
    const relative = (seat.seatIndex - dealerIndex + seats.length) % seats.length;
    seat.position = POSITION_LABELS[relative];
    seat.status = "";
  });
}

function getSeatByPosition(position) {
  return state.session.seats.find((seat) => seat.position === position);
}

function getHeroSeat() {
  return state.session.seats[HERO_SEAT_INDEX];
}

function seatNetResult(seat) {
  return seat.stack - seat.totalInvested;
}

function updateSeatResultLabels() {
  state.session.seats.forEach((seat) => {
    const delta = seatNetResult(seat);
    seat.resultLabel = `${delta >= 0 ? "赢" : "输"} ${formatAmount(Math.abs(delta))}`;
  });
}

function topUpSeatToMax(seat) {
  const amount = Math.max(0, STARTING_STACK - seat.stack);
  if (!amount) return 0;
  seat.stack += amount;
  seat.totalInvested += amount;
  return amount;
}

function autoTopUpBots() {
  state.session.seats.forEach((seat) => {
    if (seat.seatIndex === HERO_SEAT_INDEX) return;
    const topped = topUpSeatToMax(seat);
    if (topped > 0) {
      seat.status = "已补满";
    }
  });
  updateSeatResultLabels();
}

function applyPendingHeroTopUp() {
  if (!state.session.pendingHeroTopUp) return;
  const hero = getHeroSeat();
  state.session.pendingHeroTopUp = false;
  if (!hero || hero.stack <= 0 || hero.stack >= STARTING_STACK) return;
  const topped = topUpSeatToMax(hero);
  if (topped > 0) {
    hero.status = "已补满";
  }
  updateSeatResultLabels();
}

function drawCard() {
  return state.session.deck.pop();
}

function resetForHand() {
  state.session.board = [];
  state.session.street = "preflop";
  state.session.currentBet = 0;
  state.session.minRaiseTo = BIG_BLIND * 2;
  state.session.raiseCount = 0;
  state.session.preflopAggressorId = null;
  state.session.streetAggressorId = null;
  state.session.revealedSeatIds = [];
  state.session.handNumber += 1;
  state.session.dealerIndex = (state.session.dealerIndex + 1) % 8;
  assignPositions();
  state.session.deck = createDeck();
  state.session.pendingMistake = null;
  state.pauseNotice = null;
  state.topUpPrompt = null;
  state.session.lastRake = 0;
  state.session.phase = "playing";
  state.session.seats.forEach((seat) => {
    seat.betStreet = 0;
    seat.committed = 0;
    seat.folded = false;
    seat.allIn = false;
    seat.acted = false;
    seat.inHand = seat.stack > 0;
    seat.cards = seat.inHand ? [drawCard(), drawCard()] : [];
    seat.status = seat.inHand ? "等待行动" : "离桌";
    seat.selectedRaiseAmount = null;
    clearAutoActions(seat);
    if (seat.inHand) {
      seat.stats.hands += 1;
    }
    seat.handFlags.vpipMarked = false;
    seat.handFlags.pfrMarked = false;
  });

  postBlind("SB", SMALL_BLIND);
  postBlind("BB", BIG_BLIND);
  updateDerivedPot();
}

function markBetweenHands() {
  if (state.countdownIntervalId) {
    clearInterval(state.countdownIntervalId);
    state.countdownIntervalId = null;
  }
  if (state.botActionTimer) {
    clearTimeout(state.botActionTimer);
    state.botActionTimer = null;
  }
  state.session.phase = "betweenHands";
  state.session.actorIndex = null;
  state.rangeOpen = false;
  state.optionsOpen = false;
  state.confirmingAllIn = false;
  state.session.timer.secondsLeft = 0;
  state.session.timer.expiresAt = 0;
  state.session.timer.baseDeadline = 0;
}

function postBlind(position, amount) {
  const seat = getSeatByPosition(position);
  if (!seat || !seat.inHand) return;
  const blind = Math.min(amount, seat.stack);
  seat.stack -= blind;
  seat.betStreet += blind;
  seat.committed += blind;
  seat.status = position === "SB" ? "小盲" : "大盲";
  if (seat.stack === 0) {
    seat.allIn = true;
  }
  state.session.currentBet = Math.max(state.session.currentBet, blind);
  state.session.minRaiseTo = state.session.currentBet + BIG_BLIND;
}

function firstToActPreflop() {
  const bbSeat = getSeatByPosition("BB");
  return nextActiveSeat((bbSeat.seatIndex + 1) % 8);
}

function streetFirstActor() {
  const button = getSeatByPosition("BTN");
  return nextActiveSeat((button.seatIndex + 1) % 8);
}

function nextActiveSeat(startIndex) {
  for (let offset = 0; offset < 8; offset += 1) {
    const seat = state.session.seats[(startIndex + offset) % 8];
    if (seat.inHand && !seat.folded && !seat.allIn) {
      return seat;
    }
  }
  return null;
}

function activeContenders() {
  return state.session.seats.filter((seat) => seat.inHand && !seat.folded);
}

function remainingDeciders() {
  return state.session.seats.filter((seat) => seat.inHand && !seat.folded && !seat.allIn);
}

function shouldResumeRunout() {
  return (
    state.session?.phase === "playing" &&
    activeContenders().length > 1 &&
    remainingDeciders().length === 0 &&
    state.session.street !== "showdown"
  );
}

function everyoneMatched() {
  const liveSeats = remainingDeciders();
  if (liveSeats.length === 0) return true;
  return liveSeats.every((seat) => seat.acted && seat.betStreet === state.session.currentBet);
}

function canUseTimeBank(actor) {
  return actor.timeBankSeconds > 0;
}

function setActor(seat) {
  state.session.actorIndex = seat ? seat.seatIndex : null;
  state.session.seats.forEach((entry) => {
    if (entry.inHand && !entry.folded && !entry.allIn) {
      if (entry.seatIndex !== state.session.actorIndex) {
        entry.status = passiveSeatStatus(entry, state.session.currentBet);
      }
    }
  });
  if (!seat) return;
  seat.status = "待行动";
  startActionTimer();
  if (seat.seatIndex === HERO_SEAT_INDEX) {
    tryHeroAutoAction();
  }
}

function startActionTimer() {
  if (state.countdownIntervalId) {
    clearInterval(state.countdownIntervalId);
  }
  const actor = state.session.seats[state.session.actorIndex];
  const facingRaise = state.session.currentBet > actor.betStreet;
  const baseSeconds =
    state.session.street === "preflop"
      ? facingRaise
        ? ACTION_TIMERS.preflopFacingRaise
        : ACTION_TIMERS.preflopUnopened
      : ACTION_TIMERS.postflop;
  state.session.timer.secondsLeft = baseSeconds;
  state.session.timer.baseDeadline = Date.now() + baseSeconds * 1000;
  state.session.timer.expiresAt =
    state.session.timer.baseDeadline + (canUseTimeBank(actor) ? actor.timeBankSeconds * 1000 : 0);
  state.countdownIntervalId = setInterval(() => {
    if (!state.session || state.session.actorIndex == null) return;
    const now = Date.now();
    const msLeft = state.session.timer.expiresAt - now;
    if (msLeft <= 0) {
      clearInterval(state.countdownIntervalId);
      state.countdownIntervalId = null;
      handleTimeout();
      return;
    }
    state.session.timer.secondsLeft = Math.ceil(msLeft / 1000);
    renderTopOnly();
  }, 250);
}

function consumeTimeBank(actor) {
  const overBaseMs = Date.now() - state.session.timer.baseDeadline;
  if (overBaseMs <= 0) return;
  const consumedSeconds = Math.min(actor.timeBankSeconds, Math.ceil(overBaseMs / 1000));
  actor.timeBankSeconds = Math.max(0, actor.timeBankSeconds - consumedSeconds);
}

function handleTimeout() {
  const actor = state.session.seats[state.session.actorIndex];
  if (!actor) return;
  consumeTimeBank(actor);
  const toCall = Math.max(0, state.session.currentBet - actor.betStreet);
  commitAction(actor, toCall > 0 ? "fold" : "check");
}

function tryHeroAutoAction() {
  const hero = getHeroSeat();
  if (state.session.actorIndex !== HERO_SEAT_INDEX || state.pauseNotice || state.reviewOpen) {
    return;
  }
  const toCall = Math.max(0, state.session.currentBet - hero.betStreet);
  if (hero.autoActions.checkFold) {
    clearAutoActions(hero);
    commitAction(hero, toCall > 0 ? "fold" : "check");
    return;
  }
  if (hero.autoActions.check && toCall === 0) {
    clearAutoActions(hero);
    commitAction(hero, "check");
    return;
  }
  if (hero.autoActions.callAny) {
    clearAutoActions(hero);
    commitAction(hero, toCall > 0 ? "call" : "check");
    return;
  }
  if (hero.autoActions.fold && toCall > 0) {
    clearAutoActions(hero);
    commitAction(hero, "fold");
  }
}

function updateSeatStats() {
  state.session.seats.forEach((seat) => {
    if (!seat.stats.hands) {
      seat.stats.vpip = 0;
      seat.stats.pfr = 0;
      return;
    }
    seat.stats.vpip = Math.round((seat.stats.vpipHands / seat.stats.hands) * 100);
    seat.stats.pfr = Math.round((seat.stats.pfrHands / seat.stats.hands) * 100);
  });
}

function captureHeroMistake(seat, actionType) {
  const recommendation = getRecommendationForHand(state.session, seat);
  const expected = recommendation.entry;
  if (!expected) return;

  if (state.session.street === "preflop") {
    const map = {
      bet: "raise",
      raise: "raise",
      call: "call",
      check: "fold",
      fold: "fold"
    };
    const actual = map[actionType] ?? "fold";
    if (expected.action === actual || (expected.action === "mix" && ["raise", "call"].includes(actual))) {
      return;
    }
    state.session.pendingMistake = {
      street: "翻前",
      summary:
        actual === "call"
          ? "翻前跟注范围过宽"
          : actual === "fold"
            ? "翻前放弃了应继续的强牌"
            : "翻前加注范围偏离当前建议",
      hand: classifyHoleCards(seat.cards[0], seat.cards[1]),
      recommendation: expected.label
    };
    state.session.lastMistake = state.session.pendingMistake;
    return;
  }

  const toCall = Math.max(0, state.session.currentBet - seat.betStreet);
  const handClass = handCategory([...seat.cards, ...state.session.board]);
  if (["高牌", "一对"].includes(handClass) && actionType === "call" && toCall > state.session.pot * 0.45) {
    state.session.pendingMistake = {
      street: streetLabel(state.session.street),
      summary: `${streetLabel(state.session.street)}跟注偏松`,
      hand: classifyHoleCards(seat.cards[0], seat.cards[1]),
      recommendation: "当前只有翻前范围表可直接回看；翻后先关注本场总结。"
    };
    state.session.lastMistake = state.session.pendingMistake;
  }
}

function recordHandHistory(entry) {
  state.session.handHistory.unshift(entry);
  state.session.handHistory = state.session.handHistory.slice(0, 18);
}

function distributeRake(totalPot) {
  if (state.session.board.length === 0) {
    state.session.lastRake = 0;
    return 0;
  }
  const rake = Math.min(Math.round(totalPot * RAKE_PERCENT), RAKE_CAP);
  state.session.lastRake = rake;
  return rake;
}

function showdownOrder(seats) {
  return [...seats].sort((left, right) => {
    const leftOrder = (left.seatIndex - state.session.dealerIndex - 1 + 8) % 8;
    const rightOrder = (right.seatIndex - state.session.dealerIndex - 1 + 8) % 8;
    return leftOrder - rightOrder;
  });
}

function commitAction(seat, type, amount = 0) {
  if (!seat) return;
  state.confirmingAllIn = false;
  if (state.botActionTimer) {
    clearTimeout(state.botActionTimer);
    state.botActionTimer = null;
  }
  if (state.countdownIntervalId) {
    clearInterval(state.countdownIntervalId);
    state.countdownIntervalId = null;
  }

  const previousBet = state.session.currentBet;
  const toCall = Math.max(0, previousBet - seat.betStreet);
  const isPreflop = state.session.street === "preflop";

  consumeTimeBank(seat);

  if (seat.seatIndex === HERO_SEAT_INDEX) {
    captureHeroMistake(seat, type);
    clearAutoActions(seat);
  }

  if (type === "fold") {
    seat.folded = true;
    seat.status = "弃牌";
  } else if (type === "check") {
    seat.status = "过牌";
  } else if (type === "call") {
    const callAmount = Math.min(toCall, seat.stack);
    seat.stack -= callAmount;
    seat.betStreet += callAmount;
    seat.committed += callAmount;
    seat.status = callAmount >= toCall ? "跟注" : "全下";
    if (seat.stack === 0) {
      seat.allIn = true;
    }
  } else if (type === "bet" || type === "raise") {
    const lastFullRaiseSize = Math.max(BIG_BLIND, state.session.minRaiseTo - previousBet);
    const requestedTarget = Math.round(amount);
    const target = normalizeRaiseTarget({
      previousBet,
      minRaiseTo: state.session.minRaiseTo,
      stack: seat.stack,
      betStreet: seat.betStreet,
      requestedTarget
    });
    const commit = Math.min(target - seat.betStreet, seat.stack);
    seat.stack -= commit;
    seat.betStreet += commit;
    seat.committed += commit;
    const raiseSize = seat.betStreet - previousBet;
    const isFullRaise =
      previousBet === 0 ? seat.betStreet >= state.session.minRaiseTo : raiseSize >= lastFullRaiseSize;
    state.session.currentBet = seat.betStreet;
    state.session.minRaiseTo = state.session.currentBet + (isFullRaise ? Math.max(BIG_BLIND, raiseSize) : lastFullRaiseSize);
    state.session.raiseCount += 1;
    state.session.streetAggressorId = seat.id;
    if (isPreflop) {
      state.session.preflopAggressorId = seat.id;
    }
    seat.status = type === "bet" ? "下注" : "加注";
    if (seat.stack === 0) {
      seat.allIn = true;
      seat.status = "全下";
    }
    if (previousBet === 0 || isFullRaise) {
      state.session.seats.forEach((entry) => {
        if (entry.seatIndex !== seat.seatIndex && entry.inHand && !entry.folded && !entry.allIn) {
          entry.acted = false;
        }
      });
    }
  }

  if (isPreflop && ["call", "raise", "bet"].includes(type) && !seat.handFlags.vpipMarked) {
    seat.stats.vpipHands += 1;
    seat.handFlags.vpipMarked = true;
  }
  if (isPreflop && ["raise", "bet"].includes(type) && !seat.handFlags.pfrMarked) {
    seat.stats.pfrHands += 1;
    seat.handFlags.pfrMarked = true;
  }

  updateSeatStats();
  seat.acted = true;
  updateDerivedPot();
  resolveActionFlow(seat);
  saveSession();
  render();
}

function resolveActionFlow(seat) {
  const contenders = activeContenders();
  if (contenders.length === 1) {
    awardWithoutShowdown(contenders[0]);
    return;
  }

  if (remainingDeciders().length === 0) {
    runBoardToShowdown();
    return;
  }

  if (everyoneMatched()) {
    advanceStreet();
    return;
  }

  const next = nextActiveSeat((seat.seatIndex + 1) % 8);
  setActor(next);
  queueBotIfNeeded();
}

function awardWithoutShowdown(winner) {
  state.session.revealedSeatIds = [];
  const total = state.session.seats.reduce((sum, seat) => sum + seat.committed, 0);
  const rakeableTotal = total - uncalledAmountForWinner(state.session.seats, winner.id);
  const rake = distributeRake(rakeableTotal);
  winner.stack += total - rake;
  recordHandHistory({
    handNumber: state.session.handNumber,
    street: streetLabel(state.session.street),
    pot: total,
    rake,
    result: `${winner.name} 直接赢下 ${formatAmount(total - rake)}`,
    board: [...state.session.board],
    heroCards: [...getHeroSeat().cards]
  });
  finishHand();
}

function dealNextStreetCard() {
  if (state.session.street === "preflop") {
    state.session.street = "flop";
    drawCard();
    state.session.board.push(drawCard(), drawCard(), drawCard());
    return;
  }
  if (state.session.street === "flop") {
    state.session.street = "turn";
    drawCard();
    state.session.board.push(drawCard());
    return;
  }
  if (state.session.street === "turn") {
    state.session.street = "river";
    drawCard();
    state.session.board.push(drawCard());
    return;
  }
  state.session.street = "showdown";
}

function resetStreetBets() {
  state.session.seats.forEach((seat) => {
    seat.betStreet = 0;
    seat.acted = seat.folded || seat.allIn;
    if (seat.inHand && !seat.folded && !seat.allIn) {
      seat.status = "等待";
    }
  });
  state.session.currentBet = 0;
  state.session.minRaiseTo = BIG_BLIND;
  state.session.raiseCount = 0;
  state.session.streetAggressorId = null;
}

function advanceStreet() {
  resetStreetBets();
  dealNextStreetCard();
  if (state.session.street !== "preflop") {
    state.rangeOpen = false;
  }
  if (state.session.street === "showdown") {
    showdown();
    return;
  }
  if (remainingDeciders().length === 0) {
    runBoardToShowdown();
    render();
    return;
  }
  const next = streetFirstActor();
  setActor(next);
  render();
  queueBotIfNeeded();
}

function runBoardToShowdown() {
  if (state.streetRunoutTimer) {
    clearTimeout(state.streetRunoutTimer);
  }
  if (state.countdownIntervalId) {
    clearInterval(state.countdownIntervalId);
    state.countdownIntervalId = null;
  }
  state.session.actorIndex = null;
  state.session.timer.secondsLeft = 0;
  state.session.timer.expiresAt = 0;
  state.session.timer.baseDeadline = 0;
  saveSession();
  const continueRunout = () => {
    if (!state.session) return;
    if (state.session.street === "river") {
      state.session.street = "showdown";
      showdown();
      return;
    }
    resetStreetBets();
    dealNextStreetCard();
    if (state.session.street !== "preflop") {
      state.rangeOpen = false;
    }
    render();
    state.streetRunoutTimer = setTimeout(continueRunout, 380);
  };
  state.streetRunoutTimer = setTimeout(continueRunout, 320);
}

function showdown() {
  const contenders = activeContenders();
  state.session.revealedSeatIds = contenders.map((seat) => seat.id);
  const pots = buildSidePots(state.session.seats);
  const evaluations = new Map();
  contenders.forEach((seat) => {
    evaluations.set(seat.id, evaluateSeven([...seat.cards, ...state.session.board]).score);
  });

  const totalPot = state.session.seats.reduce((sum, seat) => sum + seat.committed, 0);
  let remainingRake = distributeRake(rakeablePotAmount(pots));
  const winnersSummary = new Map();

  for (const pot of pots) {
    const eligible = contenders.filter((seat) => pot.eligible.includes(seat.id));
    if (!eligible.length) {
      continue;
    }
    eligible.sort((a, b) => {
      const scoreA = evaluations.get(a.id);
      const scoreB = evaluations.get(b.id);
      for (let i = 0; i < Math.max(scoreA.length, scoreB.length); i += 1) {
        const diff = (scoreB[i] ?? 0) - (scoreA[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });
    const bestScore = evaluations.get(eligible[0].id);
    const winners = eligible.filter(
      (seat) => JSON.stringify(evaluations.get(seat.id)) === JSON.stringify(bestScore)
    );
    const potRake = pot.eligible.length > 1 ? Math.min(remainingRake, pot.amount) : 0;
    const distributable = pot.amount - potRake;
    remainingRake -= potRake;
    const orderedWinners = showdownOrder(winners);
    const share = Math.floor(distributable / orderedWinners.length);
    let oddChips = distributable - share * orderedWinners.length;
    orderedWinners.forEach((seat) => {
      seat.stack += share;
      if (oddChips > 0) {
        seat.stack += 1;
        oddChips -= 1;
      }
      winnersSummary.set(seat.id, seat);
    });
  }

  const rake = state.session.lastRake;
  const winnerNames = [...winnersSummary.values()]
    .map((seat) => `${seat.name} ${handCategory([...seat.cards, ...state.session.board])}`)
    .join("，");

  recordHandHistory({
    handNumber: state.session.handNumber,
    street: "摊牌",
    pot: totalPot,
    rake,
    result: `摊牌结算 · ${winnerNames}`,
    board: [...state.session.board],
    heroCards: [...getHeroSeat().cards]
  });
  finishHand();
}

function finishHand() {
  autoTopUpBots();
  applyPendingHeroTopUp();
  markBetweenHands();
  updateSeatResultLabels();
  saveSession();
  if (Date.now() >= state.session.endsAt || state.session.sessionEndingAfterHand) {
    endSession();
    return;
  }
  if (state.session.pendingMistake) {
    state.pauseNotice = state.session.pendingMistake;
    render();
    return;
  }
  if (maybePromptTopUp()) {
    render();
    return;
  }
  const revealDelay = state.session.revealedSeatIds.length ? 1800 : 1100;
  state.streetRunoutTimer = setTimeout(() => {
    startNextHand();
    render();
  }, revealDelay);
}

function resumeBetweenHands() {
  if (Date.now() >= state.session.endsAt || state.session.sessionEndingAfterHand) {
    endSession();
    return;
  }
  if (state.session.pendingMistake) {
    state.pauseNotice = state.session.pendingMistake;
    render();
    return;
  }
  if (maybePromptTopUp()) {
    render();
    return;
  }
  startNextHand();
}

function maybePromptTopUp() {
  const hero = getHeroSeat();
  if (!shouldPromptTopUp(hero.stack)) {
    state.topUpPrompt = null;
    return false;
  }
  const topUpAmount = STARTING_STACK - hero.stack;
  state.topUpPrompt = {
    amount: topUpAmount
  };
  return true;
}

function applyTopUp() {
  const hero = getHeroSeat();
  if (!state.topUpPrompt) return;
  topUpSeatToMax(hero);
  state.topUpPrompt = null;
  updateSeatResultLabels();
  saveSession();
  startNextHand();
}

function requestHeroTopUp() {
  const hero = getHeroSeat();
  if (!hero || hero.stack <= 0 || hero.stack >= STARTING_STACK) return;
  if (state.session.phase === "playing") {
    state.session.pendingHeroTopUp = true;
    hero.status = "已预约补码";
  } else {
    topUpSeatToMax(hero);
    state.session.pendingHeroTopUp = false;
    hero.status = "已补满";
  }
  updateSeatResultLabels();
  saveSession();
  render();
}

function skipTopUp() {
  state.topUpPrompt = null;
  if (getHeroSeat().stack === 0) {
    endSession();
    return;
  }
  saveSession();
  startNextHand();
}

function startNextHand() {
  resetForHand();
  state.selectedRangeHand = null;
  const first = firstToActPreflop();
  setActor(first);
  saveSession();
  render();
  queueBotIfNeeded();
}

function queueBotIfNeeded() {
  if (!state.session || state.session.actorIndex == null) return;
  if (state.session.phase !== "playing") return;
  const actor = state.session.seats[state.session.actorIndex];
  if (!actor || actor.seatIndex === HERO_SEAT_INDEX || state.reviewOpen || state.pauseNotice) {
    return;
  }
  if (state.botActionTimer) {
    clearTimeout(state.botActionTimer);
  }
  state.botActionTimer = setTimeout(() => {
    const action = chooseBotAction(state.session, actor);
    if (action.type === "fold" || action.type === "check") {
      commitAction(actor, action.type);
      return;
    }
    if (action.type === "call") {
      commitAction(actor, "call", action.amount);
      return;
    }
    commitAction(actor, action.type === "bet" ? "bet" : "raise", action.amount);
  }, getBotDelayMs(actor));
}

function getQuickSizes(hero) {
  const toCall = Math.max(0, state.session.currentBet - hero.betStreet);
  const unopened = state.session.currentBet === 0;
  const preflopUnraised = state.session.street === "preflop" && state.session.raiseCount === 0;
  const maxTarget = hero.stack + hero.betStreet;

  if (state.session.street === "preflop") {
    if (preflopUnraised) {
      return [2.5, 3, 4, 6]
        .map((bb) => {
          const target = Math.min(Math.round(bb * BIG_BLIND), maxTarget);
          return {
            label: `${Math.round(target)} / ${(target / BIG_BLIND).toFixed(1).replace(/\.0$/, "")}BB`,
            amount: target
          };
        })
        .filter((size, index, list) => list.findIndex((entry) => Math.round(entry.amount) === Math.round(size.amount)) === index);
    }
    const base = Math.max(state.session.currentBet, toCall + BIG_BLIND);
    return [2.6, 3, 3.6, 4.5]
      .map((multiplier) => {
        const target = Math.min(Math.round(base * multiplier), maxTarget);
        return {
          label: `${target} / ${(target / BIG_BLIND).toFixed(1).replace(/\.0$/, "")}BB`,
          amount: target
        };
      })
      .filter((size, index, list) => list.findIndex((entry) => Math.round(entry.amount) === Math.round(size.amount)) === index);
  }

  const betBase = unopened ? state.session.pot : state.session.currentBet + state.session.pot * 0.5;
  return [0.33, 0.5, 0.75, 1]
    .map((pct) => {
      const target = Math.min(
        Math.max(
          state.session.currentBet + BIG_BLIND,
          Math.round((unopened ? state.session.pot : betBase) * pct + (unopened ? 0 : state.session.currentBet))
        ),
        maxTarget
      );
      return {
        label: `${target} / ${(target / BIG_BLIND).toFixed(1).replace(/\.0$/, "")}BB`,
        amount: target
      };
    })
    .filter((size, index, list) => list.findIndex((entry) => Math.round(entry.amount) === Math.round(size.amount)) === index);
}

function canSeatRaise(seat) {
  const toCall = Math.max(0, state.session.currentBet - seat.betStreet);
  if (seat.stack <= toCall) {
    return false;
  }
  if (state.session.currentBet === 0) {
    return true;
  }
  return !seat.acted;
}

function getRaiseBounds(hero) {
  const maxTarget = hero.stack + hero.betStreet;
  const tableMinimum = state.session.street === "preflop" ? BIG_BLIND * 2 : BIG_BLIND;
  const minTarget = Math.min(maxTarget, Math.max(state.session.minRaiseTo, tableMinimum));
  return {
    minTarget,
    maxTarget
  };
}

function normalizeRaiseAmount(hero, amount) {
  const { minTarget, maxTarget } = getRaiseBounds(hero);
  if (maxTarget <= 0) return 0;
  return Math.min(maxTarget, Math.max(minTarget, Math.round(amount)));
}

function setSelectedRaiseAmount(amount) {
  const hero = getHeroSeat();
  state.confirmingAllIn = false;
  hero.selectedRaiseAmount = normalizeRaiseAmount(hero, amount);
}

function adjustSelectedRaise(direction) {
  const step = state.session.street === "preflop" ? SMALL_BLIND : BIG_BLIND;
  setSelectedRaiseAmount(getSelectedRaiseAmount() + step * direction);
}

function heroAvailableActions() {
  const hero = getHeroSeat();
  const toCall = Math.max(0, state.session.currentBet - hero.betStreet);
  const callAmount = Math.min(toCall, hero.stack);
  const unopened = state.session.currentBet === 0;

  if (!hero || state.session.actorIndex !== HERO_SEAT_INDEX || state.reviewOpen || state.pauseNotice) {
    return {
      available: false,
      quickSizes: [],
      buttons: [],
      selectedAmount: 0,
      minTarget: 0,
      maxTarget: 0
    };
  }

  const quickSizes = getQuickSizes(hero);
  const fallback = quickSizes[1]?.amount ?? BIG_BLIND * 3;
  const selected = normalizeRaiseAmount(hero, hero.selectedRaiseAmount ?? fallback);
  hero.selectedRaiseAmount = selected;
  const { minTarget, maxTarget } = getRaiseBounds(hero);
  const isAllInTarget = Math.round(selected) >= Math.round(maxTarget);
  const raiseAvailable = canSeatRaise(hero);

  return {
    available: true,
    canRaise: raiseAvailable,
    quickSizes,
    selectedAmount: selected,
    minTarget,
    maxTarget,
    buttons: (toCall > 0
      ? [
          {
            type: "fold",
            label: "弃牌",
            detail: ""
          },
          {
            type: "call",
            label: callAmount < toCall ? "全下跟注" : "跟注",
            detail: formatAmount(callAmount)
          }
        ]
      : [
          {
            type: "check",
            label: "过牌",
            detail: "0 / 0BB"
          }
        ]
    ).concat(
      raiseAvailable
        ? [
            {
              type: isAllInTarget ? "all-in" : unopened ? "bet" : "raise",
              label: isAllInTarget ? (state.confirmingAllIn ? "确认全下" : "全下") : unopened ? "下注" : "加注",
              detail: formatAmount(selected)
            }
          ]
        : []
    )
  };
}

function getSelectedRaiseAmount() {
  const hero = getHeroSeat();
  const quickSizes = getQuickSizes(hero);
  return normalizeRaiseAmount(hero, hero.selectedRaiseAmount ?? quickSizes[1]?.amount ?? BIG_BLIND * 3);
}

function setAutoAction(actionKey) {
  const hero = getHeroSeat();
  const enabled = !hero.autoActions[actionKey];
  clearAutoActions(hero);
  hero.autoActions[actionKey] = enabled;
  saveSession();
  render();
}

function toggleRange(open) {
  const nextOpen = typeof open === "boolean" ? open : !state.rangeOpen;
  state.rangeOpen = nextOpen && canUsePreflopRange();
  if (state.rangeOpen) {
    state.optionsOpen = false;
  }
  render();
}

function canUsePreflopRange() {
  return Boolean(state.session && state.session.phase === "playing" && state.session.street === "preflop");
}

function toggleOptions(open) {
  state.optionsOpen = typeof open === "boolean" ? open : !state.optionsOpen;
  if (state.optionsOpen) {
    state.rangeOpen = false;
  }
  render();
}

function continueAfterPause() {
  state.pauseNotice = null;
  if (maybePromptTopUp()) {
    saveSession();
    render();
    return;
  }
  startNextHand();
  render();
}

function renderTopOnly() {
  const topTimer = document.querySelector("[data-role='session-clock']");
  const actionTimer = document.querySelector("[data-role='action-clock']");
  const timeBank = document.querySelector("[data-role='time-bank']");
  if (!topTimer || !actionTimer || !timeBank || !state.session || state.session.actorIndex == null) return;
  const sessionLeft = Math.max(0, state.session.endsAt - Date.now());
  topTimer.textContent = state.session.sessionEndingAfterHand ? "本手后结束" : formatSessionTime(sessionLeft);
  actionTimer.textContent = `${state.session.timer.secondsLeft}s`;
  timeBank.textContent = `${state.session.seats[state.session.actorIndex].timeBankSeconds}s`;
}

function formatSessionTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function compactCardText(cards) {
  if (!cards?.length) return "无";
  return cards.map((card) => cardLabel(card)).join(" ");
}

function renderPlayingCard(card, faceDown = false) {
  if (!card || faceDown) {
    return `<div class="playing-card back"></div>`;
  }
  const red = isRedSuit(card) ? "red" : "";
  return `
    <div class="playing-card ${red}">
      <span class="rank">${card.rank}</span>
      <span class="suit">${cardLabel(card).slice(1)}</span>
    </div>
  `;
}

function renderHome() {
  const hasSaved = Boolean(loadSession());
  return `
    <div class="app-shell">
      <div class="home-screen">
        <section class="hero-card">
          <h1>简单GTO</h1>
          <p>只做一件事：让你在手机上打开就能进入 8 人现金局，对着更像真人强手的桌风持续实战。</p>
        </section>
        <button class="home-cta" data-action="start-session">开始实战</button>
        <button class="secondary-action ${hasSaved ? "" : "hidden"}" data-action="continue-session">继续上次牌桌</button>
        <div class="home-note">V1 固定 8-max / 10-20 / 200BB，金额与 BB 双显示。</div>
      </div>
    </div>
  `;
}

function seatActionClass(seat) {
  if (["下注", "加注", "再加注", "全下"].includes(seat.status)) return "action-bet";
  if (["跟注", "已跟注"].includes(seat.status)) return "action-call";
  if (seat.status === "待跟注") return "action-pending";
  if (["弃牌"].includes(seat.status)) return "action-fold";
  if (["过牌", "已过牌"].includes(seat.status)) return "action-check";
  return "";
}

function seatStatusText(seat) {
  const status = seat.status || "等待";
  if (["下注", "加注", "全下"].includes(status) && seat.betStreet > 0) {
    const verb = status === "下注" ? "下注" : status === "全下" ? "全下" : "加注到";
    return `${verb} ${formatAmount(seat.betStreet)}`;
  }
  if (["跟注", "已跟注"].includes(status) && seat.betStreet > 0) {
    return `跟注 ${formatAmount(seat.betStreet)}`;
  }
  if (status === "待跟注" && state.session.currentBet > seat.betStreet) {
    return `需跟 ${formatAmount(state.session.currentBet - seat.betStreet)}`;
  }
  return status;
}

function seatActionSummary(seat) {
  return `${seat.name} ${positionLabel(seat.position)} ${seatStatusText(seat)}`;
}

function currentActionBanner() {
  if (state.session.raiseCount <= 0 && !state.session.streetAggressorId) return "";
  const aggressor =
    state.session.seats.find((seat) => seat.id === state.session.streetAggressorId) ||
    state.session.seats.find((seat) => seat.id === state.session.preflopAggressorId);
  return aggressor ? `最近动作：${seatActionSummary(aggressor)}` : "";
}

function renderSeat(seat) {
  const style = SEAT_LAYOUT[seat.seatIndex];
  const isHero = seat.seatIndex === HERO_SEAT_INDEX;
  const revealCards = state.session.revealedSeatIds?.includes(seat.id);
  const faceDown = !isHero && !revealCards;
  const actionClass = seatActionClass(seat);
  const statusText = seatStatusText(seat);
  const betTag =
    seat.betStreet > 0
      ? `<div class="bet-tag ${actionClass}" style="top: calc(${style.top} + 82px); left: calc(${style.left} + 10px);">${formatAmount(seat.betStreet)}</div>`
      : "";
  const dealer =
    seat.position === "BTN"
      ? `<div class="dealer-button" style="top: calc(${style.top} + 10px); left: calc(${style.left} - 16px);">D</div>`
      : "";
  return `
    ${dealer}
    ${betTag}
    <div class="seat ${isHero ? "hero" : ""} ${actionClass} ${seat.folded ? "folded" : ""} ${state.session.actorIndex === seat.seatIndex ? "to-act" : ""}"
      style="top:${style.top}; left:${style.left};">
      <div class="label">${isHero ? "固定座位" : seat.name}</div>
      <div class="position">${positionLabel(seat.position)}</div>
      <div class="stack">${formatAmount(seat.stack)}</div>
      <div class="status ${actionClass}">${statusText}</div>
    </div>
    ${!isHero ? `<div class="seat-cards" style="top: calc(${style.top} - 18px); left: calc(${style.left} + 10px);">${renderPlayingCard(seat.cards[0], faceDown)}${renderPlayingCard(seat.cards[1], faceDown)}</div>` : ""}
  `;
}

function renderRangeSheet(hero) {
  if (!canUsePreflopRange()) {
    return "";
  }
  const recommendation = getRecommendationForHand(state.session, hero);
  const matrix = buildRangeMatrix(recommendation.position, recommendation.spot);
  const selected = state.selectedRangeHand ?? classifyHoleCards(hero.cards[0], hero.cards[1]) ?? matrix[0][0].hand;
  const detail = matrix.flat().find((cell) => cell.hand === selected) ?? matrix[0][0];
  return `
    <div class="overlay range-overlay ${state.rangeOpen ? "open" : ""}" data-action="close-range"></div>
    <section class="sheet range-sheet ${state.rangeOpen ? "open" : ""}">
      <div class="sheet-panel">
        <div class="sheet-grabber"></div>
        <div class="sheet-header">
          <div>
            <h3>翻前范围表</h3>
            <div class="sheet-meta">${positionLabel(recommendation.position)} · ${recommendation.title}</div>
          </div>
          <button class="sheet-close" data-action="close-range">×</button>
        </div>
        <div class="range-grid">
          ${matrix
            .flat()
            .map(
              (cell) => `
                <button class="range-cell ${cell.colorClass} ${cell.hand === selected ? "active" : ""}" data-hand="${cell.hand}">
                  <span class="hand">${cell.hand}</span>
                  <span class="range-score">${cell.score}</span>
                  <span class="pct">${cell.pct}%</span>
                </button>
              `
            )
            .join("")}
        </div>
        <div class="range-detail">
          <strong>${detail.hand} · 评分 ${detail.score} · ${detail.pct}%</strong>
          <p>${detail.label}。当前面板只服务翻前实战，颜色规则固定：红=加注，蓝=跟注，灰=弃牌。</p>
        </div>
      </div>
    </section>
  `;
}

function renderOptionsSheet() {
  const hero = getHeroSeat();
  const heroNet = seatNetResult(hero);
  const topUpAmount = Math.max(0, STARTING_STACK - hero.stack);
  const canRequestTopUp = hero.stack > 0 && topUpAmount > 0 && !state.session.pendingHeroTopUp;
  const topUpLabel = hero.stack >= STARTING_STACK
    ? "已满 200BB"
    : state.session.pendingHeroTopUp
      ? "已预约下手补码"
      : state.session.phase === "playing"
        ? "下手补满到 200BB"
        : "补满到 200BB";
  return `
    <div class="overlay ${state.optionsOpen ? "open" : ""}" data-action="close-options"></div>
    <section class="sheet ${state.optionsOpen ? "open" : ""}">
      <div class="sheet-panel">
        <div class="sheet-grabber"></div>
        <div class="sheet-header">
          <div>
            <h3>选项</h3>
            <div class="sheet-meta">只保留最少工具，同时提供本场状态和手牌历史。</div>
          </div>
          <button class="sheet-close" data-action="close-options">×</button>
        </div>
        <div class="options-stack">
          <div class="mini-panel">
            <strong>本场状态</strong>
            <p>当前筹码：${formatAmount(hero.stack)} · 本场 ${heroNet >= 0 ? "赢" : "输"} ${formatAmount(Math.abs(heroNet))}</p>
            <p>已打手数：${state.session.handNumber} · 最近抽水：${formatAmount(state.session.lastRake)}</p>
          </div>
          <div class="mini-panel">
            <strong>补码</strong>
            <p>${topUpAmount > 0 ? `可补金额：${formatAmount(topUpAmount)}。${state.session.phase === "playing" ? "本手结束后生效。" : "当前可立即补满。"}` : "当前已经是 200BB。"} </p>
            <button class="modal-action" data-action="request-top-up" ${canRequestTopUp ? "" : "disabled"}>${topUpLabel}</button>
          </div>
          <div class="history-panel">
            <strong>手牌历史</strong>
            <ul class="history-list">
              ${state.session.handHistory
                .slice(0, 6)
                .map(
                  (hand) => `
                    <li class="history-item">
                      <span>#${hand.handNumber} · ${hand.street}<br><small>你：${compactCardText(hand.heroCards)} · 牌面：${compactCardText(hand.board)}</small></span>
                      <span>${hand.result}</span>
                    </li>
                  `
                )
                .join("") || "<li class='history-item muted'>本场还没有完成的手牌。</li>"}
            </ul>
          </div>
          <button class="modal-action" data-action="restart-session">重新开始</button>
          <button class="modal-action" data-action="show-help">规则说明</button>
          <button class="modal-action" data-action="back-home">返回首页</button>
          <button class="modal-action danger" data-action="end-session">结束本场</button>
        </div>
      </div>
    </section>
  `;
}

function renderPauseBanner() {
  if (!state.pauseNotice) return "";
  return `
    <section class="pause-banner">
      <div class="pause-stack">
        <div>
          <h4>${state.pauseNotice.street}</h4>
          <p>${state.pauseNotice.summary}</p>
          <p class="muted">当前记录：${state.pauseNotice.hand} · 建议：${state.pauseNotice.recommendation}</p>
        </div>
        <button class="home-cta" data-action="continue-after-pause">继续下一手</button>
      </div>
    </section>
  `;
}

function renderTopUpPrompt() {
  if (!state.topUpPrompt) return "";
  const busted = getHeroSeat().stack === 0;
  return `
    <section class="pause-banner">
      <div class="pause-stack">
        <div>
          <h4>补满筹码</h4>
          <p>${busted ? "你已经出局。按现金局通行规则，需要在下一手前补码后才能继续。" : "当前筹码明显低于买入上限。按现金局通行规则，你可以在下一手开始前补满。"}</p>
          <p class="muted">补码金额：${formatAmount(state.topUpPrompt.amount)}</p>
        </div>
        <div class="prompt-actions">
          <button class="secondary-action" data-action="skip-top-up">${busted ? "结束本场" : "继续不补"}</button>
          <button class="home-cta" data-action="apply-top-up">补满到 200BB</button>
        </div>
      </div>
    </section>
  `;
}

function renderReviewCard() {
  if (!state.reviewOpen || !state.session?.sessionSummary) return "";
  const summary = state.session.sessionSummary;
  return `
    <div class="overlay open"></div>
    <section class="pause-banner" style="inset: 20px 18px auto;">
      <div class="review-card">
        <h3>本场总结</h3>
        <div class="review-section">
          <p class="muted">先看这桌都是什么人。</p>
          <ul class="review-list">
            ${summary.bots
              .map(
                (bot) => `
                  <li class="review-item">
                    <strong>${bot.name}<span class="review-tag">${bot.label}</span></strong>
                    <p>VPIP ${bot.vpip}% · PFR ${bot.pfr}% · 本场 ${bot.result >= 0 ? "赢" : "输"} ${formatAmount(Math.abs(bot.result))}</p>
                  </li>
                `
              )
              .join("")}
          </ul>
        </div>
        <div class="review-section">
          <p>你的本场结果：${summary.heroResult >= 0 ? "赢" : "输"} ${formatAmount(Math.abs(summary.heroResult))}</p>
          <p>最终筹码：${formatAmount(summary.heroFinalStack)} · 用时 ${formatSessionTime(summary.durationMs)} · 共 ${summary.handCount} 手</p>
          <p>${summary.mistake ? `最大问题：${summary.mistake.street} · ${summary.mistake.summary}` : "本场没有记录到明显偏离。"} </p>
          ${summary.mistake ? `<p class="muted">问题手牌：${summary.mistake.hand} · 建议：${summary.mistake.recommendation}</p>` : ""}
        </div>
        <div class="review-section">
          <strong class="review-subtitle">最近完成的手牌</strong>
          <ul class="history-list">
            ${summary.recentHands
              .map(
                (hand) => `
                  <li class="history-item">
                    <span>#${hand.handNumber} · ${hand.street}<br><small>你：${compactCardText(hand.heroCards)} · 牌面：${compactCardText(hand.board)}</small></span>
                    <span>${hand.result}</span>
                  </li>
                `
              )
              .join("")}
          </ul>
        </div>
        <div class="review-section">
          <button class="home-cta" data-action="back-home">返回首页</button>
        </div>
      </div>
    </section>
  `;
}

function renderPreActionRow(hero) {
  const items = [
    { key: "fold", label: "弃牌" },
    { key: "check", label: "过牌" },
    { key: "checkFold", label: "过牌/弃牌" },
    { key: "callAny", label: "跟注任意" }
  ];
  return `
    <div class="preaction-row">
      ${items
        .map(
          (item) => `
            <button class="preaction-chip ${hero.autoActions[item.key] ? "active" : ""}" data-auto-action="${item.key}">
              ${item.label}
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderActionPanel(hero) {
  const actionConfig = heroAvailableActions();
  const actor = state.session.seats[state.session.actorIndex];

  if (!actionConfig.available) {
    return `
      <section class="action-panel">
        <div class="wait-panel">
          <div>
            <strong>${actor?.seatIndex === HERO_SEAT_INDEX ? "等待系统处理" : `${actor?.name ?? "对手"}正在行动`}</strong>
            <p>${actor?.seatIndex === HERO_SEAT_INDEX ? "当前动作已锁定，系统正在推进。" : "可以提前设置常用预选动作。"} </p>
          </div>
          ${renderPreActionRow(hero)}
        </div>
      </section>
    `;
  }

  return `
    <section class="action-panel">
      ${actionConfig.canRaise
        ? `
      <div class="bet-tuner">
        <div class="bet-summary">
          <span>目标下注</span>
          <strong>${formatAmount(actionConfig.selectedAmount)}</strong>
          <small>最小 ${formatAmount(actionConfig.minTarget)} · 封顶 ${formatAmount(actionConfig.maxTarget)}</small>
        </div>
        <div class="bet-controls">
          <button class="bet-step" data-raise-bound="min">最小</button>
          <button class="bet-step" data-adjust-raise="-1">-0.5BB</button>
          <button class="bet-step" data-adjust-raise="1">+0.5BB</button>
          <button class="bet-step accent" data-raise-bound="max">全下</button>
        </div>
      </div>
      <div class="quick-sizes">
        ${actionConfig.quickSizes
          .map(
            (size) => `
              <button class="quick-size ${Math.round(actionConfig.selectedAmount) === Math.round(size.amount) ? "active" : ""}" data-raise-amount="${size.amount}">
                ${size.label}
              </button>
            `
          )
          .join("")}
      </div>`
        : ""}
      <div class="action-row ${actionConfig.buttons.length === 2 ? "two-actions" : ""}">
        ${actionConfig.buttons
          .map(
            (button) => `
              <button class="action-chip ${button.type === "call" || button.type === "check" ? "primary" : ""} ${button.type === "raise" || button.type === "bet" || button.type === "all-in" ? "raise" : ""}" data-play-action="${button.type}">
                ${button.label}
                <small>${button.detail || "&nbsp;"}</small>
              </button>
            `
          )
          .join("")}
      </div>
      ${renderPreActionRow(hero)}
    </section>
  `;
}

function renderTable() {
  const hero = getHeroSeat();
  const actor = state.session.actorIndex != null ? state.session.seats[state.session.actorIndex] : null;
  const actionBanner = currentActionBanner();
  const sessionLeft = state.session.sessionEndingAfterHand
    ? "本手后结束"
    : formatSessionTime(state.session.endsAt - Date.now());
  return `
    <div class="app-shell">
      <div class="table-screen">
        <section class="topbar">
          <div class="topbar-row">
            <div>
              <div class="topbar-title">简单GTO</div>
              <div class="topbar-meta">${TABLE_LABEL}</div>
            </div>
            <div class="topbar-meta">
              <span>本场 <strong data-role="session-clock">${sessionLeft}</strong></span>
              <span>行动 <strong data-role="action-clock">${state.session.timer.secondsLeft}s</strong></span>
              <span>TB <strong data-role="time-bank">${actor?.timeBankSeconds ?? INITIAL_TIME_BANK}s</strong></span>
            </div>
          </div>
        </section>
        <section class="subbar">
          <div class="subbar-row">
            <span class="subbar-chip">手数 <strong>#${state.session.handNumber}</strong></span>
            <span class="subbar-chip">底池 <strong>${formatAmount(state.session.pot)}</strong></span>
            <span class="subbar-chip">当前街 <strong>${streetLabel(state.session.street)}</strong></span>
          </div>
        </section>
        <section class="table-stage">
          <div class="pot-box">
            <strong>底池 ${formatAmount(state.session.pot)}</strong>
            ${actionBanner ? `<small>${actionBanner}</small>` : ""}
          </div>
          <div class="board">${state.session.board.map((card) => renderPlayingCard(card)).join("")}</div>
          <div class="seat-grid">
            ${state.session.seats.map((seat) => renderSeat(seat)).join("")}
          </div>
          <button
            type="button"
            class="dealer-button strategy-trigger"
            data-action="open-range"
            ${canUsePreflopRange() ? "" : "disabled"}
            title="范围表仅翻前可用">
            🂠
          </button>
          <div class="hero-cards">
            ${hero.cards.map((card) => renderPlayingCard(card)).join("")}
          </div>
        </section>
        ${renderActionPanel(hero)}
        <section class="bottom-nav">
          <button class="pill-button ${state.rangeOpen ? "active" : ""}" data-action="open-range" ${canUsePreflopRange() ? "" : "disabled"}>策略</button>
          <button class="pill-button ${state.optionsOpen ? "active" : ""}" data-action="open-options">选项</button>
        </section>
      </div>
      ${renderRangeSheet(hero)}
      ${renderOptionsSheet()}
      ${renderPauseBanner()}
      ${renderTopUpPrompt()}
      ${renderReviewCard()}
    </div>
  `;
}

function streetLabel(street) {
  return {
    preflop: "翻前",
    flop: "翻牌",
    turn: "转牌",
    river: "河牌"
  }[street] ?? "摊牌";
}

function positionLabel(position) {
  return {
    BTN: "庄位",
    SB: "小盲",
    BB: "大盲",
    UTG: "枪口",
    "UTG+1": "枪口+1",
    MP: "中位",
    HJ: "关煞",
    CO: "截止位"
  }[position] ?? position;
}

function render() {
  app.innerHTML = state.session ? renderTable() : renderHome();
  bindEvents();
}

function bindEvents() {
  app.querySelectorAll("[data-action='start-session']").forEach((button) => {
    button.addEventListener("click", beginNewSession);
  });

  app.querySelectorAll("[data-action='continue-session']").forEach((button) => {
    button.addEventListener("click", () => {
      const existing = loadSession();
      if (existing) {
        restoreSession(existing);
      }
    });
  });

  app.querySelectorAll("[data-action='open-range']").forEach((button) => {
    button.addEventListener("click", () => toggleRange(true));
  });

  app.querySelectorAll("[data-action='close-range']").forEach((button) => {
    button.addEventListener("click", () => toggleRange(false));
  });

  app.querySelectorAll("[data-action='open-options']").forEach((button) => {
    button.addEventListener("click", () => toggleOptions(true));
  });

  app.querySelectorAll("[data-action='close-options']").forEach((button) => {
    button.addEventListener("click", () => toggleOptions(false));
  });

  app.querySelectorAll("[data-action='continue-after-pause']").forEach((button) => {
    button.addEventListener("click", continueAfterPause);
  });

  app.querySelectorAll("[data-action='apply-top-up']").forEach((button) => {
    button.addEventListener("click", applyTopUp);
  });

  app.querySelectorAll("[data-action='request-top-up']").forEach((button) => {
    button.addEventListener("click", requestHeroTopUp);
  });

  app.querySelectorAll("[data-action='skip-top-up']").forEach((button) => {
    button.addEventListener("click", skipTopUp);
  });

  app.querySelectorAll("[data-action='end-session']").forEach((button) => {
    button.addEventListener("click", requestEndSession);
  });

  app.querySelectorAll("[data-action='restart-session']").forEach((button) => {
    button.addEventListener("click", beginNewSession);
  });

  app.querySelectorAll("[data-action='show-help']").forEach((button) => {
    button.addEventListener("click", () => {
      window.alert("固定规则：8-max / 10-20 / 200BB。抽水 5% 封顶 3BB，翻前未见翻牌不抽水。补码参照现金局通用规则，只允许在手与手之间发生。范围表只提供翻前辅助。");
    });
  });

  app.querySelectorAll("[data-action='back-home']").forEach((button) => {
    button.addEventListener("click", () => {
      clearTimers();
      localStorage.removeItem(STORAGE_KEY);
      state.session = null;
      state.reviewOpen = false;
      render();
    });
  });

  app.querySelectorAll("[data-play-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const hero = getHeroSeat();
      if (state.session.actorIndex !== HERO_SEAT_INDEX) return;
      const action = button.dataset.playAction;
      if (action === "raise" || action === "bet" || action === "all-in") {
        if (action === "all-in" && !state.confirmingAllIn) {
          state.confirmingAllIn = true;
          render();
          return;
        }
        const resolvedAction =
          action === "all-in" ? (state.session.currentBet === 0 ? "bet" : "raise") : action;
        commitAction(hero, resolvedAction, getSelectedRaiseAmount());
      } else {
        commitAction(hero, action);
      }
    });
  });

  app.querySelectorAll("[data-raise-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      setSelectedRaiseAmount(Number(button.dataset.raiseAmount));
      render();
    });
  });

  app.querySelectorAll("[data-adjust-raise]").forEach((button) => {
    button.addEventListener("click", () => {
      adjustSelectedRaise(Number(button.dataset.adjustRaise));
      render();
    });
  });

  app.querySelectorAll("[data-raise-bound]").forEach((button) => {
    button.addEventListener("click", () => {
      const hero = getHeroSeat();
      const bounds = getRaiseBounds(hero);
      setSelectedRaiseAmount(button.dataset.raiseBound === "min" ? bounds.minTarget : bounds.maxTarget);
      render();
    });
  });

  app.querySelectorAll("[data-hand]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRangeHand = button.dataset.hand;
      render();
    });
  });

  app.querySelectorAll("[data-auto-action]").forEach((button) => {
    button.addEventListener("click", () => {
      setAutoAction(button.dataset.autoAction);
    });
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // V1 stays usable even when registration fails.
    });
  }
}

function boot() {
  const existing = loadSession();
  registerServiceWorker();
  render();
  if (window.location.hash.includes("autostart")) {
    beginNewSession();
    return;
  }
  if (existing) {
    app.querySelector("[data-action='continue-session']")?.classList.remove("hidden");
  }
}

boot();
