// js/modes/mini_rpg.js
import { GAME } from "../core/state.js";
import battleAPI from "../battle/battle_3v3.js";

const { simulateTeamBattle } = battleAPI;

export const MINI_RPG_STAGES = [
  { id: "stage1", type: "team", enemyTeamId: "K9PD", label: "K9PD Patrol" },
  { id: "stage2", type: "team", enemyTeamId: "BabylonKnights", label: "Babylon Knights" },
  { id: "stage3", type: "team", enemyTeamId: "ForestFerals_ELITE", label: "Forest Ferals (Elite)" },
  {
    id: "stage4",
    type: "team",
    enemyTeamId: "ArcaneGuardians_MR",
    label: "Arcane Guardians",
    enemyModifiers: { attackBonus: 1, defenseBonus: 1 }
  },
  { id: "stage5", type: "boss", bossId: "spirit_dragon_boss", label: "Spirit Dragon (Boss)" },
  {
    id: "stage6",
    type: "team",
    enemyTeamId: "ShadowStalkers_MR",
    label: "Shadow Stalkers",
    enemyModifiers: { attackBonus: 2 }
  },
  { id: "stage7", type: "boss", bossId: "great_kitsune_boss", label: "Great Kitsune (Boss)" },
  { id: "stage8", type: "boss", bossId: "bahamut_boss", label: "Bahamut, Warden of Skies" }
];

const DEFAULT_STATE = {
  status: "not started",
  currentStageIndex: 0,
  partyIds: [],
  partyHP: {},
  modifiers: { attackBonus: 0, defenseBonus: 0 },
  stageResults: [],
  runStats: { totalRounds: 0, totalTurns: 0, damageByParty: {} },
  // NEW: selected ability ids per fighter
  partyLoadouts: {}, // { [fighterId]: string[] }
  // NEW: rank up system
  rankUpPoints: 0,            // how many points the player can spend
  abilityRanks: {}            // { [fighterId]: { [abilityId]: rankInt } }
};

function freshState() {
  return {
    ...DEFAULT_STATE,
    partyHP: {},
    stageResults: [],
    runStats: { totalRounds: 0, totalTurns: 0, damageByParty: {} },
    partyLoadouts: {}
  };
}


const ENEMY_TEAMS = {
  K9PD: ["fido", "grape", "sasha"],
  BabylonKnights: ["bailey", "keene", "sabrina"],
  ForestFerals_ELITE: ["gale", "miles", "itsuki"],
  ArcaneGuardians_MR: ["tarot", "sabrina", "breel"],
  ShadowStalkers_MR: ["rufus", "joey", "marvin"]
};

function cloneAbility(ab) {
  return { ...ab };
}

function cloneFighter(base, overrides = {}) {
  const abilities = Array.isArray(base.abilities) ? base.abilities.map(cloneAbility) : [];
  return { ...base, abilities, ...overrides };
}

function ensureFighter(id) {
  const base = GAME.fighters?.[id];
  if (base) {
    return cloneFighter(base);
  }

  return {
    id,
    name: id,
    maxHP: 30,
    attackBonus: 2,
    defenseBonus: 1,
    speed: 3,
    accuracy: 1,
    evasion: 0,
    luck: 0,
    position: "front",
    abilities: [
      {
        id: `${id}_strike`,
        name: "Wild Strike",
        type: "physical",
        targeting: "any-enemy",
        damageByRank: ["1d8+2"],
        rank: 1
      }
    ]
  };
}

function applyLoadoutToFighter(fighter, state) {
  const loadouts = state.partyLoadouts || {};
  const selectedIds = loadouts[fighter.id];
  if (!selectedIds || !Array.isArray(selectedIds) || !selectedIds.length) {
    // no custom loadout – use fighter as-is
    return fighter;
  }

  if (!Array.isArray(fighter.abilities) || !fighter.abilities.length) {
    return fighter;
  }

  const allowed = new Set(selectedIds);
  const filtered = fighter.abilities.filter(ab => allowed.has(ab.id));

  // Safety: if filter results in empty list, keep original abilities
  if (!filtered.length) return fighter;

  return { ...fighter, abilities: filtered };
}

function applyAbilityRanksToFighter(fighter, state) {
  const rankMap = state.abilityRanks || {};
  const fighterRanks = rankMap[fighter.id] || {};

  if (!Array.isArray(fighter.abilities)) return fighter;

  const newAbilities = fighter.abilities.map(ab => {
    const desiredRank = fighterRanks[ab.id];
    if (!desiredRank || desiredRank <= 1) {
      return { ...ab, rank: ab.rank || 1 };
    }
    // cap rank at 3 for safety (fits your damageByRank arrays)
    const capped = Math.max(1, Math.min(3, desiredRank));
    return { ...ab, rank: capped };
  });

  return { ...fighter, abilities: newAbilities };
}

function applyBonuses(fighter, modifiers) {
  const withBonuses = { ...fighter };
  if (modifiers.attackBonus) {
    withBonuses.attackBonus = (withBonuses.attackBonus || 0) + modifiers.attackBonus;
  }
  if (modifiers.defenseBonus) {
    withBonuses.defenseBonus = (withBonuses.defenseBonus || 0) + modifiers.defenseBonus;
  }
  return withBonuses;
}

function assignPosition(fighter, index) {
  const positions = ["front", "mid", "back"];
  return { ...fighter, position: fighter.position || positions[index] || "front" };
}

function buildPlayerTeam(state) {
  const { partyIds, modifiers } = state;
  return partyIds.map((id, idx) => {
    const base = ensureFighter(id);
    const withPosition = assignPosition(base, idx);
    const withLoadout = applyLoadoutToFighter(withPosition, state);
    const withBonuses = applyBonuses(withLoadout, modifiers);
    const withRanks = applyAbilityRanksToFighter(withBonuses, state);
    return { ...withRanks, hp: withRanks.maxHP };
  });
}


function buildEnemyTeam(stage) {
  if (stage.type === "boss") {
    const boss = ensureFighter(stage.bossId);
    const bossWithPosition = assignPosition(boss, 0);
    return [{ ...bossWithPosition, hp: bossWithPosition.maxHP }];
  }

  const ids = ENEMY_TEAMS[stage.enemyTeamId] || [];
  const mapped = ids.map((id, idx) => assignPosition(ensureFighter(id), idx));

  while (mapped.length < 3) {
    const fillerId = `${stage.enemyTeamId || "enemy"}_filler_${mapped.length + 1}`;
    mapped.push(assignPosition(ensureFighter(fillerId), mapped.length));
  }

  const enemyModifiers = stage.enemyModifiers || { attackBonus: 0, defenseBonus: 0 };
  return mapped.map(f => ({ ...applyBonuses(f, enemyModifiers), hp: f.maxHP }));
}

function describeEnemy(stage) {
  if (stage.type === "boss") {
    return GAME.fighters?.[stage.bossId]?.name || stage.bossId;
  }
  return stage.enemyTeamId;
}

export function describeStage(stage, index) {
  const prefix = `Stage ${index + 1} / ${MINI_RPG_STAGES.length}`;
  const label = stage.label || describeEnemy(stage);
  return `${prefix} – ${label}`;
}

let state = freshState();

function resetRun() {
  state = freshState();
}

function storePartyHP(partyIds) {
  state.partyHP = {};
  for (const id of partyIds) {
    const base = ensureFighter(id);
    state.partyHP[id] = base.maxHP;
  }
}

function stepStage(options = {}) {
  if (state.status !== "in progress") {
    return { finished: true, state };
  }

  const stage = MINI_RPG_STAGES[state.currentStageIndex];
  if (!stage) {
    state.status = "completed";
    return { finished: true, state };
  }

  const playerTeam = buildPlayerTeam(state);
  const enemyTeam = buildEnemyTeam(stage);
  const battleOptions = { log: true, trackStats: true, ...(options.battleOptions || {}) };
  const result = simulateTeamBattle(playerTeam, enemyTeam, battleOptions);
  const victory = result.winner === "A";

  if (victory) {
    state.currentStageIndex += 1;
    storePartyHP(state.partyIds);
	
	// Don't award points after the final stage
	if (state.currentStageIndex < MINI_RPG_STAGES.length) {
	  state.rankUpPoints = (state.rankUpPoints || 0) + 1; // 1 point per win
	}
	
    if (state.currentStageIndex >= MINI_RPG_STAGES.length) {
      state.status = "completed";
    }
  } else {
    state.status = "failed";
  }

  const stats = result.stats || {};
  if (stats.rounds) state.runStats.totalRounds += stats.rounds;
  if (stats.turns) state.runStats.totalTurns += stats.turns;
  if (stats.damageByFighter) {
    for (const [fid, dmg] of Object.entries(stats.damageByFighter)) {
      if (state.partyIds.includes(fid)) {
        state.runStats.damageByParty[fid] = (state.runStats.damageByParty[fid] || 0) + dmg;
      }
    }
  }

  state.stageResults.push({
    stageId: stage.id,
    enemy: describeEnemy(stage),
    outcome: victory ? "cleared" : "failed",
    rounds: stats.rounds || 0,
    turns: stats.turns || 0,
    damageByFighter: stats.damageByFighter || {},
    log: result.log
  });

  return { stage, result, victory, state };
}

function autoRun(options = {}) {
  const snapshots = [];
  while (state.status === "in progress") {
    const res = stepStage(options);
    snapshots.push(res);
    if (res.state.status !== "in progress") break;
  }
  return snapshots;
}

function setPartyLoadouts(loadouts) {
  state.partyLoadouts = loadouts || {};
}

function setAbilityRanks(abilityRanks) {
  state.abilityRanks = abilityRanks || {};
}

function awardRankUpPoints(amount) {
  const delta = Number.isFinite(amount) ? amount : 0;
  const next = (state.rankUpPoints || 0) + delta;
  state.rankUpPoints = Math.max(0, next);
}

export const MiniRPG = {
  getState() {
    return {
      ...state,
      stageResults: [...state.stageResults],
      runStats: {
        ...state.runStats,
        damageByParty: { ...(state.runStats?.damageByParty || {}) }
      }
    };
  },
  
  // allow UI to push ranks
  setAbilityRanks(abilityRanks) {
    setAbilityRanks(abilityRanks);
    return this.getState();
  },

  // optionally award rank points from UI/dev console
  awardRankUpPoints(amount) {
    awardRankUpPoints(amount);
    return this.getState();
  },
  
  setPartyLoadouts(loadouts) {
    setPartyLoadouts(loadouts);
    return this.getState();
  },
  startRun(partyIds, options = {}) {
    resetRun();
    state.partyIds = [...partyIds];
    storePartyHP(state.partyIds);
    state.status = "in progress";
    state.currentStageIndex = 0;

    if (options.auto !== false) {
      autoRun(options);
    }

    return this.getState();
  },
  autoRun(options = {}) {
    return autoRun(options);
  },
  runNextStage(options = {}) {
    return stepStage(options);
  },
  reset() {
    resetRun();
    return this.getState();
  }
};
