import { classifyHoleCards, formatAmount, handCategory } from "./poker.js";

function heroHandLabel(entry) {
  if (!Array.isArray(entry.heroCards) || entry.heroCards.length < 2) {
    return "未知手牌";
  }
  return classifyHoleCards(entry.heroCards[0], entry.heroCards[1]);
}

function madeHandLabel(entry) {
  if (!Array.isArray(entry.heroCards) || !Array.isArray(entry.board) || entry.board.length < 3) {
    return "翻前决策";
  }
  return handCategory([...entry.heroCards, ...entry.board]);
}

function potLabel(entry) {
  return formatAmount(entry.pot ?? 0);
}

export function buildHandReview(entry) {
  const hand = heroHandLabel(entry);
  const madeHand = madeHandLabel(entry);

  if (entry.mistake) {
    return {
      tone: "leak",
      headline: `偏离建议：${entry.mistake.summary}`,
      detail: `${entry.mistake.street} · ${hand} · ${entry.mistake.recommendation}`,
      nextStep: "下次同类局面先按范围或底池压力收紧。"
    };
  }

  if (entry.heroWon) {
    if (!entry.wentShowdown) {
      return {
        tone: "good",
        headline: "非摊牌拿下底池",
        detail: `${hand} 在 ${entry.street} 赢下 ${potLabel(entry)}，对手提前弃牌。`,
        nextStep: "记录有效施压点，后续观察哪些牌手会过度弃牌。"
      };
    }
    return {
      tone: "good",
      headline: `摊牌赢池：${madeHand}`,
      detail: `${hand} 摊牌赢下 ${potLabel(entry)}。`,
      nextStep: "继续区分价值下注和免费摊牌，强牌优先拿价值。"
    };
  }

  if (entry.heroFolded) {
    return {
      tone: "neutral",
      headline: "本手主动退出",
      detail: `${hand} 在 ${entry.street} 放弃，底池 ${potLabel(entry)}。`,
      nextStep: "复查是否被小注赶走；弱范围弃牌本身不是错误。"
    };
  }

  if (entry.wentShowdown) {
    return {
      tone: "neutral",
      headline: `摊牌未赢：${madeHand}`,
      detail: `${hand} 摊牌未拿下 ${potLabel(entry)}。`,
      nextStep: "回看是否用边缘牌支付了过大的河牌下注。"
    };
  }

  return {
    tone: "neutral",
    headline: "本手结束",
    detail: `${hand} · ${entry.result}`,
    nextStep: "继续积累同类局面，优先观察位置、下注尺度和对手类型。"
  };
}
