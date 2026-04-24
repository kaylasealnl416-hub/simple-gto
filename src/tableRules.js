import { BIG_BLIND, STARTING_STACK } from "./config.js";

export const TOP_UP_PROMPT_THRESHOLD = BIG_BLIND * 100;

export function passiveSeatStatus(seat, currentBet) {
  if (seat.betStreet < currentBet) {
    return "待跟注";
  }
  if (!seat.acted) {
    return "等待";
  }
  if (currentBet === 0) {
    return "已过牌";
  }
  if (seat.status === "跟注") {
    return "已跟注";
  }
  if (["下注", "加注", "全下"].includes(seat.status)) {
    return seat.status;
  }
  return "已行动";
}

export function shouldPromptTopUp(stack) {
  return stack <= 0 || stack <= Math.min(TOP_UP_PROMPT_THRESHOLD, STARTING_STACK - BIG_BLIND);
}
