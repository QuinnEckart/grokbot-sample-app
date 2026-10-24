import assert from "node:assert/strict";
import {
  allGameIds,
  autoFillChalk,
  autoFillRandom,
  clearDownstreamPicks,
  contestants,
  createExampleField,
  championTeamId,
  feederGameIds,
} from "../lib/bracket.js";

const teams = createExampleField();

assert.equal(teams.length, 64);
assert.equal(allGameIds().length, 63);

const [a, b] = contestants(teams, {}, "East:r64:0");
assert.equal(a?.seed, 1);
assert.equal(b?.seed, 16);

let picks = {};
picks["East:r64:0"] = a.id;
picks = clearDownstreamPicks(picks, "East:r64:0");
assert.equal(picks["East:r64:0"], a.id);

picks["East:r32:0"] = teams.find((t) => t.region === "East" && t.seed === 8).id;
picks = clearDownstreamPicks(picks, "East:r64:0");
assert.equal(picks["East:r32:0"], undefined);

const chalk = autoFillChalk(teams);
assert.equal(Object.keys(chalk).length, 63);
for (const gid of allGameIds()) {
  const [x, y] = contestants(teams, chalk, gid);
  const w = chalk[gid];
  const winner = teams.find((t) => t.id === w);
  assert.ok(winner);
  assert.ok(winner.id === x.id || winner.id === y.id);
  assert.ok(winner.seed <= Math.max(x.seed, y.seed));
}
assert.ok(championTeamId(chalk));

let seed = 0;
const random = autoFillRandom(teams, () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
});
assert.equal(Object.keys(random).length, 63);

assert.deepEqual(feederGameIds("East:r32:0"), ["East:r64:0", "East:r64:1"]);

console.log("bracket.test.js: all assertions passed");
