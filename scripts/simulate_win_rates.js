import fs from "fs/promises";
import { loadFighters } from "../js/core/loader.js";
import { MiniRPG } from "../js/modes/mini_rpg.js";
import { GAME } from "../js/core/state.js";

// Node's built-in fetch can't read file:// URLs, so add a lightweight shim
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (typeof url === "string" && url.startsWith("file:")) {
    const data = await fs.readFile(new URL(url), "utf8");
    return new Response(data, { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, options);
};

function ensureLoadoutForFighter(fighter) {
  const loadoutSize = fighter.loadoutSize || 4;
  const coreSet = new Set(fighter.coreAbilities || []);

  let selected = fighter.activeAbilities && fighter.activeAbilities.length
    ? [...fighter.activeAbilities]
    : (fighter.abilities || []).map(ab => ab.id);

  // make sure core abilities are always present
  for (const core of coreSet) {
    if (!selected.includes(core)) selected.unshift(core);
  }

  // Deduplicate while preserving order
  const unique = [];
  const seen = new Set();
  for (const id of selected) {
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }

  // Trim to loadoutSize, never dropping core abilities
  while (unique.length > loadoutSize) {
    const removableIndex = unique.findIndex(id => !coreSet.has(id));
    if (removableIndex === -1) break;
    unique.splice(removableIndex, 1);
  }

  return { loadoutSize, selectedIds: unique };
}

function buildPartyLoadouts(party) {
  const map = {};
  for (const id of party) {
    const fighter = GAME.fighters[id];
    if (!fighter) continue;
    const { selectedIds } = ensureLoadoutForFighter(fighter);
    map[id] = selectedIds;
  }
  return map;
}

function* combinationsOfThree(items) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      for (let k = j + 1; k < items.length; k++) {
        yield [items[i], items[j], items[k]];
      }
    }
  }
}

function simulateParty(partyIds, runs) {
  const loadouts = buildPartyLoadouts(partyIds);
  let wins = 0;
  let clearedTotal = 0;

  for (let i = 0; i < runs; i++) {
    MiniRPG.reset();
    MiniRPG.setPartyLoadouts(loadouts);
    const result = MiniRPG.startRun(partyIds, {
      auto: true,
      battleOptions: { log: false, trackStats: false }
    });
    const cleared = result.stageResults.filter(r => r.outcome === "cleared").length;
    clearedTotal += cleared;
    if (result.status === "completed") wins += 1;
  }

  return {
    party: partyIds,
    runs,
    wins,
    winRate: wins / runs,
    avgCleared: clearedTotal / runs
  };
}

async function main() {
  const runsArg = parseInt(process.argv[2], 10);
  const runs = Number.isFinite(runsArg) && runsArg > 0 ? runsArg : 10;
  const limitArg = parseInt(process.argv[3], 10);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : null;

  await loadFighters();

  const fighterIds = GAME.fighterOrder.filter(id => !id.includes("_boss"));
  const results = [];
  let evaluated = 0;

  for (const combo of combinationsOfThree(fighterIds)) {
    const res = simulateParty(combo, runs);
    results.push(res);
    evaluated += 1;
    if (evaluated % 200 === 0) {
      console.error(`Evaluated ${evaluated} parties...`);
    }
    if (limit && evaluated >= limit) break;
  }

  results.sort((a, b) => b.winRate - a.winRate || b.avgCleared - a.avgCleared);

  console.log(JSON.stringify({ runs, evaluated, top: results.slice(0, 10) }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
