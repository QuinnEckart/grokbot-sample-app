/** NCAA-style 64-team bracket core logic (no DOM). */

export const REGIONS = ["East", "West", "South", "Midwest"];

/** Standard first-round seed pairings within a region. */
export const R64_SEED_MATCHUPS = [
  [1, 16],
  [8, 9],
  [5, 12],
  [4, 13],
  [6, 11],
  [3, 14],
  [7, 10],
  [2, 15],
];

export const ROUND_ORDER = [
  "r64",
  "r32",
  "s16",
  "e8",
  "f4",
  "champ",
];

export const ROUND_LABELS = {
  r64: "Round of 64",
  r32: "Round of 32",
  s16: "Sweet 16",
  e8: "Elite 8",
  f4: "Final Four",
  champ: "Championship",
};

/**
 * @typedef {{ id: string, region: string, seed: number, name: string }} Team
 */

/**
 * Build default example field (clearly not a live NCAA draw).
 * @returns {Team[]}
 */
export function createExampleField() {
  const nicknames = [
    "Tigers",
    "Bulldogs",
    "Wildcats",
    "Bears",
    "Eagles",
    "Hawks",
    "Wolves",
    "Lions",
    "Panthers",
    "Cougars",
    "Rams",
    "Knights",
    "Spartans",
    "Titans",
    "Warriors",
    "Raiders",
  ];
  const teams = [];
  let n = 0;
  for (const region of REGIONS) {
    for (let seed = 1; seed <= 16; seed++) {
      const city = `${region} State`;
      const name =
        seed === 1
          ? `${city} ${nicknames[n % nicknames.length]}`
          : `${city} #${seed}`;
      teams.push({
        id: `${region.toLowerCase()}-${seed}`,
        region,
        seed,
        name,
      });
      n++;
    }
  }
  return teams;
}

/**
 * @param {Team[]} teams
 * @param {string} region
 * @param {number} seed
 */
export function teamByRegionSeed(teams, region, seed) {
  return teams.find((t) => t.region === region && t.seed === seed);
}

/**
 * All game slot ids in bracket order.
 */
export function allGameIds() {
  const ids = [];
  for (const region of REGIONS) {
    for (let i = 0; i < 8; i++) ids.push(`${region}:r64:${i}`);
    for (let i = 0; i < 4; i++) ids.push(`${region}:r32:${i}`);
    for (let i = 0; i < 2; i++) ids.push(`${region}:s16:${i}`);
    ids.push(`${region}:e8:0`);
  }
  ids.push("f4:0", "f4:1", "champ:0");
  return ids;
}

/**
 * Parse game id into parts.
 * @param {string} gameId
 */
export function parseGameId(gameId) {
  const parts = gameId.split(":");
  if (parts[0] === "f4" || parts[0] === "champ") {
    return { scope: parts[0], round: parts[0] === "champ" ? "champ" : "f4", index: Number(parts[1]) };
  }
  return {
    scope: "region",
    region: parts[0],
    round: parts[1],
    index: Number(parts[2]),
  };
}

/**
 * Games that feed into this slot (parent picks).
 * @param {string} gameId
 * @returns {string[]}
 */
export function feederGameIds(gameId) {
  const p = parseGameId(gameId);
  if (p.round === "champ") return ["f4:0", "f4:1"];
  if (p.round === "f4") {
    const regions = [
      ["East", "West"],
      ["South", "Midwest"],
    ];
    const pair = regions[p.index];
    return pair.map((r) => `${r}:e8:0`);
  }
  if (p.round === "e8") return [`${p.region}:s16:0`, `${p.region}:s16:1`];
  if (p.round === "s16") {
    const base = p.index * 2;
    return [`${p.region}:r32:${base}`, `${p.region}:r32:${base + 1}`];
  }
  if (p.round === "r32") {
    const base = p.index * 2;
    return [`${p.region}:r64:${base}`, `${p.region}:r64:${base + 1}`];
  }
  return [];
}

/**
 * R64 contestants from initial field.
 * @param {Team[]} teams
 * @param {string} gameId
 * @returns {[Team|null, Team|null]}
 */
export function r64Contestants(teams, gameId) {
  const p = parseGameId(gameId);
  if (p.round !== "r64") return [null, null];
  const [s1, s2] = R64_SEED_MATCHUPS[p.index];
  return [
    teamByRegionSeed(teams, p.region, s1) ?? null,
    teamByRegionSeed(teams, p.region, s2) ?? null,
  ];
}

/**
 * @param {Team[]} teams
 * @param {Record<string, string>} picks teamId by gameId
 * @param {string} gameId
 * @returns {[Team|null, Team|null]}
 */
export function contestants(teams, picks, gameId) {
  const p = parseGameId(gameId);
  if (p.round === "r64") return r64Contestants(teams, gameId);

  const feeders = feederGameIds(gameId);
  const a = picks[feeders[0]]
    ? teams.find((t) => t.id === picks[feeders[0]]) ?? null
    : null;
  const b = picks[feeders[1]]
    ? teams.find((t) => t.id === picks[feeders[1]]) ?? null
    : null;
  return [a, b];
}

/**
 * Clear picks in slots that depend on the winner leaving `gameId`.
 * @param {Record<string, string>} picks
 * @param {string} gameId
 * @returns {Record<string, string>}
 */
export function clearDownstreamPicks(picks, gameId) {
  const next = { ...picks };
  function collectDown(id) {
    for (const gid of allGameIds()) {
      if (feederGameIds(gid).includes(id)) {
        delete next[gid];
        collectDown(gid);
      }
    }
  }
  collectDown(gameId);
  return next;
}

/**
 * @param {Record<string, string>} picks
 */
export function championTeamId(picks) {
  return picks["champ:0"] ?? null;
}

/**
 * Chalk: pick lower seed number (better seed) in each available matchup.
 * @param {Team[]} teams
 * @returns {Record<string, string>}
 */
export function autoFillChalk(teams) {
  const picks = {};
  for (const gid of allGameIds()) {
    const [a, b] = contestants(teams, picks, gid);
    if (!a || !b) continue;
    picks[gid] = a.seed <= b.seed ? a.id : b.id;
  }
  return picks;
}

/**
 * Random bracket with upset weighting (higher seed more likely to win).
 * @param {Team[]} teams
 * @param {() => number} rng
 */
export function autoFillRandom(teams, rng = Math.random) {
  const picks = {};
  for (const gid of allGameIds()) {
    const [a, b] = contestants(teams, picks, gid);
    if (!a || !b) continue;
    const diff = Math.abs(a.seed - b.seed);
    const fav = a.seed < b.seed ? a : b;
    const dog = a.seed < b.seed ? b : a;
    const upsetChance = Math.min(0.55, 0.12 + diff * 0.04);
    picks[gid] = rng() < upsetChance ? dog.id : fav.id;
  }
  return picks;
}

/**
 * Summarize picks for chat context.
 * @param {Team[]} teams
 * @param {Record<string, string>} picks
 */
export function summarizeBracketForChat(teams, picks) {
  const lines = [];
  const champId = championTeamId(picks);
  if (champId) {
    const c = teams.find((t) => t.id === champId);
    lines.push(`Champion pick: ${c?.name ?? champId} (${c?.region ?? "?"}, #${c?.seed ?? "?"})`);
  } else {
    lines.push("Champion: not yet selected.");
  }
  lines.push(`Picks made: ${Object.keys(picks).length} / ${allGameIds().length}`);
  for (const round of ROUND_ORDER) {
    const gids = allGameIds().filter((id) => parseGameId(id).round === round);
    const done = gids.filter((id) => picks[id]).length;
    lines.push(`${ROUND_LABELS[round]}: ${done}/${gids.length}`);
  }
  const upsets = [];
  for (const gid of allGameIds()) {
    const winnerId = picks[gid];
    if (!winnerId) continue;
    const [a, b] = contestants(teams, picks, gid);
    const w = teams.find((t) => t.id === winnerId);
    if (!w || !a || !b) continue;
    const opp = a.id === winnerId ? b : a;
    if (w.seed > opp.seed) {
      upsets.push(`${w.name} (#${w.seed}) over ${opp.name} (#${opp.seed}) in ${gid}`);
    }
  }
  if (upsets.length) {
    lines.push("Upset picks: " + upsets.slice(0, 12).join("; "));
    if (upsets.length > 12) lines.push(`…and ${upsets.length - 12} more upsets.`);
  }
  return lines.join("\n");
}
