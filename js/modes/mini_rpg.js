// js/modes/mini_rpg.js
import { GAME } from "../core/state.js";
import battleAPI from "../battle/battle_3v3.js";

const { simulateTeamBattle } = battleAPI;

export const MINI_RPG_STAGES = [
  { id: "stage1", type: "team", enemyTeamId: "K9PD" },
  { id: "stage2", type: "team", enemyTeamId: "BabylonKnights" },
  { id: "stage3", type: "team", enemyTeamId: "ForestFerals_ELITE" },
  { id: "stage4", type: "boss", bossId: "jata_boss" },
  { id: "stage5", type: "team", enemyTeamId: "AncientGuardians" },
  { id: "stage6", type: "boss", bossId: "spirit_dragon" },
  { id: "stage7", type: "boss", bossId: "great_kitsune" }
];

const DEFAULT_STATE = {
  status: "not started",
  currentStageIndex: 0,
  partyIds: [],
  partyHP: {},
  modifiers: { attackBonus: 0, defenseBonus: 0 },
  stageResults: []
};

const ENEMY_TEAMS = {
  K9PD: ["thunder_pup", "brass_bunny", "shadow_fox"],
  BabylonKnights: ["crystal_wolf", "ember_hawk", "arcane_otter"],
  ForestFerals_ELITE: ["grove_guardian", "shadow_fox", "crystal_wolf"],
  AncientGuardians: ["tidecaller", "grove_guardian", "ember_hawk"]
};

const BOSSES = {
  jata_boss: {
    id: "jata_boss",
    name: "Jata, Thunderheart",
    maxHP: 90,
    attackBonus: 5,
    defenseBonus: 3,
    speed: 5,
    accuracy: 3,
    evasion: 2,
    luck: 2,
    position: "front",
    abilities: [
      {
        id: "storm_breaker",
        name: "Storm Breaker",
        type: "physical",
        targeting: "front-preferred",
        damageByRank: ["2d10+6"],
        rank: 1,
        cooldown: 2
      }
    ]
  },
  spirit_dragon: {
    id: "spirit_dragon",
    name: "Spirit Dragon",
    maxHP: 105,
    attackBonus: 4,
    defenseBonus: 4,
    speed: 6,
    accuracy: 4,
    evasion: 2,
    luck: 3,
    position: "mid",
    abilities: [
      {
        id: "astral_breath",
        name: "Astral Breath",
        type: "magic",
        targeting: "any-enemy",
        damageByRank: ["2d12+4"],
        rank: 1,
        cooldown: 2
      }
    ]
  },
  great_kitsune: {
    id: "great_kitsune",
    name: "Great Kitsune",
    maxHP: 95,
    attackBonus: 4,
    defenseBonus: 3,
    speed: 7,
    accuracy: 4,
    evasion: 3,
    luck: 4,
    position: "back",
    abilities: [
      {
        id: "foxfire_barrage",
        name: "Foxfire Barrage",
        type: "magic",
        targeting: "any-enemy",
        damageByRank: ["2d8+6"],
        rank: 1,
        cooldown: 1
      }
    ]
  }
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
    const withBonuses = applyBonuses(withPosition, modifiers);
    return { ...withBonuses, hp: withBonuses.maxHP };
  });
}

function buildEnemyTeam(stage) {
  if (stage.type === "boss") {
    const boss = BOSSES[stage.bossId];
    if (boss) {
      const b = cloneFighter(boss, { position: boss.position || "front" });
      return [{ ...b, hp: b.maxHP }];
    }
  }

  const ids = ENEMY_TEAMS[stage.enemyTeamId] || [];
  const mapped = ids.map((id, idx) => assignPosition(ensureFighter(id), idx));

  while (mapped.length < 3) {
    const fillerId = `${stage.enemyTeamId || "enemy"}_filler_${mapped.length + 1}`;
    mapped.push(assignPosition(ensureFighter(fillerId), mapped.length));
  }

  return mapped.map(f => ({ ...applyBonuses(f, { attackBonus: 0, defenseBonus: 0 }), hp: f.maxHP }));
}

function describeEnemy(stage) {
  if (stage.type === "boss") {
    return BOSSES[stage.bossId]?.name || stage.bossId;
  }
  return stage.enemyTeamId;
}

let state = { ...DEFAULT_STATE };

function resetRun() {
  state = { ...DEFAULT_STATE, partyHP: {}, stageResults: [] };
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
  const result = simulateTeamBattle(playerTeam, enemyTeam, options.battleOptions || { log: true });
  const victory = result.winner === "A";

  if (victory) {
    state.currentStageIndex += 1;
    storePartyHP(state.partyIds);
    if (state.currentStageIndex >= MINI_RPG_STAGES.length) {
      state.status = "completed";
    }
  } else {
    state.status = "failed";
  }

  state.stageResults.push({
    stageId: stage.id,
    enemy: describeEnemy(stage),
    outcome: victory ? "cleared" : "failed",
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

export const MiniRPG = {
  getState() {
    return { ...state, stageResults: [...state.stageResults] };
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
  runNextStage(options = {}) {
    return stepStage(options);
  }
};
