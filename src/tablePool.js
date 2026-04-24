import { DEVIATED_ARCHETYPES, ELITE_ARCHETYPES } from "./config.js";

export function pickArchetypes(random = Math.random) {
  const elites = [...ELITE_ARCHETYPES]
    .sort(() => random() - 0.5)
    .slice(0, 3)
    .map((archetype) => ({ ...archetype, pool: "elite" }));

  const deviated = [];
  const counts = new Map();
  while (deviated.length < 4) {
    const picked = DEVIATED_ARCHETYPES[Math.floor(random() * DEVIATED_ARCHETYPES.length)];
    const count = counts.get(picked.key) ?? 0;
    if (count >= 2) continue;
    counts.set(picked.key, count + 1);
    deviated.push({ ...picked, pool: "deviated" });
  }

  return [...elites, ...deviated].sort(() => random() - 0.5);
}
