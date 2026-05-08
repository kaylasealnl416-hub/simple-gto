import { DEVIATED_ARCHETYPES, REGULAR_ARCHETYPES } from "./config.js";

function takeRandom(pool, random) {
  const index = Math.floor(random() * pool.length);
  return pool.splice(index, 1)[0];
}

function randomRegularCount(random) {
  return 1 + Math.floor(random() * 3);
}

function shuffle(entries, random) {
  const pool = [...entries];
  const result = [];
  while (pool.length) {
    result.push(takeRandom(pool, random));
  }
  return result;
}

export function pickArchetypes(random = Math.random) {
  const regularCount = randomRegularCount(random);
  const regularPool = [...REGULAR_ARCHETYPES];
  const regulars = [];
  while (regulars.length < regularCount) {
    regulars.push({ ...takeRandom(regularPool, random), pool: "regular" });
  }

  const nonRegular = [];
  const counts = new Map();
  while (nonRegular.length < 7 - regularCount) {
    const picked = DEVIATED_ARCHETYPES[Math.floor(random() * DEVIATED_ARCHETYPES.length)];
    const count = counts.get(picked.key) ?? 0;
    if (count >= 2) continue;
    counts.set(picked.key, count + 1);
    nonRegular.push({ ...picked, pool: "deviated" });
  }

  const tableStrength = regularCount === 1 ? "soft" : regularCount === 2 ? "standard" : "tough";
  return shuffle([...regulars, ...nonRegular], random).map((archetype) => ({
    ...archetype,
    tableStrength
  }));
}
