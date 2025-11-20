// js/battle/battle_3v3.js
//
import { GAME } from "../core/state.js";

// Advanced 3v3 battle engine using the upgraded fighters.json schema.
//
// Features:
// - 3v3 format
// - Position-based targeting (front/mid/back)
// - AoE support (single, enemy-team, team, all, random-2-enemies)
// - Buff / debuff stacking hard-capped at ±3 per stat
// - Cooldowns per ability (ability.cooldown)
// - Concentration limit: each target can have only one concentration buff
//   (ability.concentration === true)
// - Smarter AI using aiWeight + context
// - Handles special flags: oneTimeDodge, counterNextMiss, redirectChance,
//   extraEffect, extraDamageIfTargetDebuffed
// - Minimal logging for performance
//

// ---------- Utility ----------

function rollInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollD20() {
  return rollInt(1, 20);
}

/**
 * Evaluate a saving throw for the given target/ability.
 * Returns an object describing whether the effect applies and how strongly.
 */
function evaluateSavingThrow(target, ability) {
  if (ability.saveStat && ability.saveDifficulty != null) {
    const stat = ability.saveStat;
    const dc = ability.saveDifficulty;
    const statValue = getModifiedStat(target, stat);
    const roll = rollD20() + statValue;
    const success = roll >= dc;

    if (success) {
      return {
        applies: false,
        scale: 0,
        success: true,
        outcome: "negate",
        dc,
        roll
      };
    }

    return {
      applies: true,
      scale: 1,
      success: false,
      outcome: "fail",
      dc,
      roll
    };
  }

  const save = ability.save;
  if (!save) {
    return { applies: true, scale: 1, success: false };
  }

  const stat = save.stat;
  const dc = save.dc || 10;
  const onSave = save.onSave || "negate";

  const statValue = getModifiedStat(target, stat);
  const roll = rollD20() + statValue;
  const success = roll >= dc;

  if (!success) {
    return { applies: true, scale: 1, success: false };
  }

  if (onSave === "negate") {
    return { applies: false, scale: 0, success: true, outcome: "negate" };
  }

  if (onSave === "reduced" || onSave === "half") {
    return { applies: true, scale: 0.5, success: true, outcome: onSave };
  }

  return { applies: true, scale: 1, success: true, outcome: onSave };
}

function scaleEffectForSave(stats, duration, scale) {
  if (scale == null || scale === 1) {
    return { scaledStats: { ...stats }, scaledDuration: duration };
  }

  const scaledStats = {};
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === "number") {
      const raw = value * scale;
      if (raw === 0) {
        scaledStats[key] = 0;
      } else if (raw > 0) {
        scaledStats[key] = Math.max(0, Math.floor(raw));
      } else {
        scaledStats[key] = Math.min(0, Math.ceil(raw));
      }
    } else {
      scaledStats[key] = value;
    }
  }

  const scaledDuration = Math.max(1, Math.floor(duration * scale));
  return { scaledStats, scaledDuration };
}

function rollDiceExpression(expr) {
  if (typeof expr !== "string" || !expr.trim()) return 0;
  const t = expr.trim();

  if (/^[+-]?\d+$/.test(t)) return parseInt(t, 10);

  const m = t.match(/^(\d+)d(\d+)([+\-]\d+)?$/i);
  if (!m) {
    const n = parseInt(t, 10);
    return isNaN(n) ? 0 : n;
  }

  const count = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const mod = m[3] ? parseInt(m[3], 10) : 0;

  let total = 0;
  for (let i = 0; i < count; i++) total += rollInt(1, sides);
  return total + mod;
}

function randomChoice(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function isAlive(f) {
  return f.hp > 0;
}

// ---------- Buff / Debuff & Stats ----------

const BUFF_CAP = 3; // hard cap on total modifier to any stat

function getModifiedStat(fighter, statName) {
  const base = fighter[statName] || 0;

  // Sum all active effects that modify this stat
  let bonus = 0;
  if (fighter.effects) {
    for (const eff of fighter.effects) {
      if (eff.stats && typeof eff.stats[statName] === "number") {
        bonus += eff.stats[statName];
      }
    }
  }

  // Hard cap buffs/debuffs to ±BUFF_CAP relative to base
  if (bonus > BUFF_CAP) bonus = BUFF_CAP;
  if (bonus < -BUFF_CAP) bonus = -BUFF_CAP;

  return base + bonus;
}

function tickEffects(fighters) {
  for (const f of fighters) {
    if (!f.effects || f.effects.length === 0) continue;
    const remain = [];
    for (const eff of f.effects) {
      eff.remainingRounds -= 1;
      if (eff.remainingRounds > 0) remain.push(eff);
    }
    f.effects = remain;
  }
}

function tickConditions(fighters) {
  for (const f of fighters) {
    if (!f.conditions || f.conditions.length === 0) continue;
    const remain = [];
    for (const cond of f.conditions) {
      cond.remainingRounds -= 1;
      if (cond.remainingRounds > 0) remain.push(cond);
    }
    f.conditions = remain;
  }
}

function tickReactions(fighters) {
  for (const f of fighters) {
    if (!f.reactions || f.reactions.length === 0) continue;
    const remain = [];
    for (const r of f.reactions) {
      if (r.remainingRounds != null) {
        r.remainingRounds -= 1;
      }
      if (r.remainingRounds == null || r.remainingRounds > 0) {
        remain.push(r);
      }
    }
    f.reactions = remain;
  }
}

// ---------- Cooldowns ----------

function tickCooldowns(fighters) {
  for (const f of fighters) {
    if (!f.cooldowns) continue;
    for (const id of Object.keys(f.cooldowns)) {
      f.cooldowns[id] = Math.max(0, f.cooldowns[id] - 1);
    }
  }
}

// ---------- Effects & Special Flags ----------

function hasEffectObject(ability) {
  return ability && typeof ability.effect === "object" && ability.effect !== null;
}

// concentration: ability.concentration === true
// rule: each TARGET can only have ONE concentration buff at a time.
// New concentration effect replaces previous concentration effect on that target.
function applyBuffOrDebuff(source, targets, ability, options = {}) {
  if (!hasEffectObject(ability)) return;

  const stats = ability.effect;
  const dur = ability.duration > 0 ? ability.duration : 1;
  const isConcentration = !!ability.concentration;
  const appliedTargets = [];
  const saveResultsMap = options.saveResults instanceof Map ? options.saveResults : null;

  for (const t of targets) {
    // Saving throw hook: if this ability has a save, check per target
    let saveResult = null;
    const canSave = ability.save || (ability.saveStat && ability.saveDifficulty != null);
    if (saveResultsMap && saveResultsMap.has(t)) {
      saveResult = saveResultsMap.get(t);
    } else if (saveResultsMap && canSave) {
      saveResult = evaluateSavingThrow(t, ability);
      saveResultsMap.set(t, saveResult);
    } else if (canSave) {
      saveResult = evaluateSavingThrow(t, ability);
    }

    if (saveResult && !saveResult.applies) {
      continue; // target resisted the effect entirely
    }

    if (!t.effects) t.effects = [];

    if (isConcentration) {
      t.effects = t.effects.filter(e => !e.isConcentration);
    }

    let effectStats = { ...stats };
    let effectDuration = dur;
    if (saveResult && saveResult.scale != null && saveResult.scale !== 1) {
      const scaled = scaleEffectForSave(stats, dur, saveResult.scale);
      effectStats = scaled.scaledStats;
      effectDuration = scaled.scaledDuration;
    }

    const hasImpact = Object.values(effectStats).some(val => {
      if (typeof val === "number") return val !== 0;
      return val !== undefined && val !== null;
    });
    if (!hasImpact) {
      continue;
    }

    t.effects.push({
      stats: effectStats,
      remainingRounds: effectDuration,
      source: source.name,
      abilityName: ability.name,
      isConcentration
    });
    appliedTargets.push(t);
  }

  return appliedTargets;
}

function ensureReactionState(fighter) {
  if (!fighter.reactions) fighter.reactions = [];
}

function applyReactions(source, targets, ability) {
  if (!ability.reaction) return [];

  const duration = ability.reactionDuration || ability.duration || 2;
  const applied = [];
  for (const target of targets) {
    if (!target || !isAlive(target)) continue;
    ensureReactionState(target);
    target.reactions.push({
      ...ability.reaction,
      source: source.name,
      abilityName: ability.name,
      remainingRounds: duration
    });
    applied.push(target);
  }
  return applied;
}

function applyConditions(attacker, targets, ability, options = {}) {
  if (!ability.applyCondition) {
    return { applied: [], resisted: [] };
  }

  const duration = ability.conditionDuration > 0 ? ability.conditionDuration : 1;
  const applied = [];
  const resisted = [];
  const saveResultsMap = options.saveResults instanceof Map ? options.saveResults : null;
  const canSave = ability.save || (ability.saveStat && ability.saveDifficulty != null);

  for (const target of targets) {
    if (!isAlive(target)) continue;

    let saveResult = null;
    if (saveResultsMap && saveResultsMap.has(target)) {
      saveResult = saveResultsMap.get(target);
    } else if (saveResultsMap && canSave) {
      saveResult = evaluateSavingThrow(target, ability);
      saveResultsMap.set(target, saveResult);
    } else if (canSave) {
      saveResult = evaluateSavingThrow(target, ability);
    }

    if (saveResult && !saveResult.applies) {
      resisted.push(target);
      continue;
    }

    addConditionToFighter(target, ability.applyCondition, duration);
    applied.push(target);
  }

  return { applied, resisted };
}

const ADVANTAGE_EFFECT_DURATION = 2;

function grantAttackFlagEffect(target, flagName, sourceName, abilityName) {
  if (!target.effects) target.effects = [];
  target.effects.push({
    stats: { [flagName]: true },
    remainingRounds: ADVANTAGE_EFFECT_DURATION,
    source: sourceName,
    abilityName,
    isConcentration: false
  });
}

function applyAttackRollModifiers(source, targets, ability) {
  const result = { advantage: [], disadvantage: [] };
  if (!ability.grantsAdvantage && !ability.grantsDisadvantage) {
    return result;
  }

  for (const target of targets) {
    if (!target || !isAlive(target)) continue;

    if (ability.grantsAdvantage) {
      grantAttackFlagEffect(target, "attackAdvantage", source.name, ability.name);
      result.advantage.push(target);
    }

    if (ability.grantsDisadvantage) {
      grantAttackFlagEffect(target, "attackDisadvantage", source.name, ability.name);
      result.disadvantage.push(target);
    }
  }

  return result;
}

function logConditionApplications(logLines, conditionName, result) {
  if (!conditionName) return;
  const display = conditionName;
  for (const target of result.applied) {
    logLines.push(`${target.name} is ${display}!`);
  }
  for (const target of result.resisted) {
    logLines.push(`${target.name} resists being ${display}.`);
  }
}

function logAttackModifierResults(logLines, result) {
  for (const target of result.advantage) {
    logLines.push(`${target.name} gains advantage on their next attack.`);
  }
  for (const target of result.disadvantage) {
    logLines.push(`${target.name} suffers disadvantage on their next attack.`);
  }
}

function consumeSpecialFlag(f, flagName) {
  if (!f.effects || f.effects.length === 0) return false;
  let consumed = false;
  f.effects = f.effects.filter(e => {
    if (!e.stats || consumed) return true;
    if (e.stats[flagName]) {
      consumed = true;
      return false;
    }
    return true;
  });
  return consumed;
}

function shiftPosition(target, shift) {
  if (!target || !target.position) return null;
  const order = ["front", "mid", "back"];
  const idx = order.indexOf(target.position);
  if (idx === -1) return null;
  const next = Math.max(0, Math.min(order.length - 1, idx + shift));
  const old = target.position;
  target.position = order[next];
  if (old === target.position) return null;
  return { from: old, to: target.position };
}

function swapPositions(a, b) {
  if (!a || !b) return null;
  const oldA = a.position;
  const oldB = b.position;
  if (!oldA || !oldB || oldA === oldB) return null;
  a.position = oldB;
  b.position = oldA;
  return { aFrom: oldA, aTo: a.position, bFrom: oldB, bTo: b.position };
}

function hasCondition(f, condName) {
  if (f.conditions && f.conditions.length > 0) {
    if (f.conditions.some(c => c.name === condName && c.remainingRounds > 0)) {
      return true;
    }
  }

  if (!f.effects || f.effects.length === 0) return false;
  return f.effects.some(e => e.stats && e.stats[condName]);
}

function ensureConditionState(fighter) {
  if (!fighter.conditions) fighter.conditions = [];
}

function addConditionToFighter(fighter, condName, duration) {
  ensureConditionState(fighter);
  const extraDuration = Math.max(1, duration + 1);
  const existing = fighter.conditions.find(c => c.name === condName);
  if (existing) {
    existing.remainingRounds = Math.max(existing.remainingRounds, extraDuration);
  } else {
    fighter.conditions.push({ name: condName, remainingRounds: extraDuration });
  }
}

function spendConditionTurn(fighter, condName) {
  if (!fighter.conditions || fighter.conditions.length === 0) return false;
  let spent = false;
  fighter.conditions = fighter.conditions.filter(cond => {
    if (cond.name !== condName) return cond.remainingRounds > 0;
    if (cond.remainingRounds <= 0) return false;
    cond.remainingRounds -= 1;
    spent = true;
    return cond.remainingRounds > 0;
  });
  return spent;
}

// ---------- Ability Type Helpers ----------

function isDamagingAbility(a) {
  return Array.isArray(a.damageByRank);
}

function isHealingAbility(a) {
  return Array.isArray(a.healByRank);
}

// extraEffect patterns:
// 1) simple: { stat: +1, duration: 2 }
// 2) split:  { enemy: {...}, ally: {...} }
function applyExtraEffects(attacker, allies, enemies, target, ability) {
  const ex = ability.extraEffect;
  if (!ex) return;

  if (ex.enemy || ex.ally) {
    // split form
    if (ex.enemy) {
      const obj = { ...ex.enemy };
      const dur = obj.duration || 1;
      delete obj.duration;

      applyBuffOrDebuff(attacker, [target], {
        name: ability.name + " (extra enemy)",
        effect: obj,
        duration: dur,
        concentration: false
      });
    }

    if (ex.ally) {
      const obj = { ...ex.ally };
      const dur = obj.duration || 1;
      delete obj.duration;

      let allyTarget = null;
      if (ex.ally.id) {
        allyTarget = allies.find(a => a.id === ex.ally.id && isAlive(a));
      }
      if (!allyTarget) {
        const aliveAllies = allies.filter(a => isAlive(a) && a.id !== attacker.id);
        allyTarget = randomChoice(aliveAllies);
      }
      if (allyTarget) {
        applyBuffOrDebuff(attacker, [allyTarget], {
          name: ability.name + " (extra ally)",
          effect: obj,
          duration: dur,
          concentration: false
        });
      }
    }
    return;
  }

  // simple form
  const obj = { ...ex };
  const dur = obj.duration || 1;
  delete obj.duration;

  applyBuffOrDebuff(attacker, [target], {
    name: ability.name + " (extra)",
    effect: obj,
    duration: dur,
    concentration: false
  });
}

// ---------- Damage / Heal ----------

function attemptHit(attacker, defender, ability) {
  const statName = ability.hitStat || "attackBonus";
  const hitVal = getModifiedStat(attacker, statName);
  const defVal = getModifiedStat(defender, "defenseBonus");

  // --- Advantage / Disadvantage flags ---
  const hasAdvantage = consumeSpecialFlag(attacker, "attackAdvantage");
  const hasDisadvantage = consumeSpecialFlag(attacker, "attackDisadvantage");

  let roll;
  if (hasAdvantage && !hasDisadvantage) {
    const r1 = rollD20();
    const r2 = rollD20();
    roll = Math.max(r1, r2);
  } else if (hasDisadvantage && !hasAdvantage) {
    const r1 = rollD20();
    const r2 = rollD20();
    roll = Math.min(r1, r2);
  } else {
    roll = rollD20();
  }

  const total = roll + hitVal;
  const target = 10 + defVal;

  return { hit: total >= target, roll, total, target };
}

function triggerReactions(owner, trigger, context, metrics) {
  if (!owner.reactions || owner.reactions.length === 0) return [];
  const fired = [];
  owner.reactions = owner.reactions.filter(r => {
    if (r.trigger !== trigger) return true;

    let shouldFire = true;
    if (r.hpThreshold != null && context && context.target) {
      const ratio = context.target.hp / context.target.maxHP;
      if (ratio > r.hpThreshold) shouldFire = false;
    }

    if (shouldFire) {
      if (r.action === "counter" && context && context.attacker && isAlive(context.attacker)) {
        const dmg = rollDiceExpression(r.damage || "1d4+1");
        const oldHP = context.attacker.hp;
        context.attacker.hp = Math.max(0, context.attacker.hp - dmg);
        recordDamage(metrics, owner, dmg);
        context.log.push(
          `${owner.name} reacts (${r.abilityName}) and strikes ${context.attacker.name} for ${dmg} (${oldHP} → ${context.attacker.hp}).`
        );
        if (!isAlive(context.attacker)) {
          context.log.push(`${context.attacker.name} is knocked out!`);
        }
      } else if (r.action === "heal" && context) {
        const target = r.target === "ally" ? context.ally || owner : owner;
        if (target && isAlive(target)) {
          const healAmount = rollDiceExpression(r.heal || "1d4+2");
          const oldHP = target.hp;
          target.hp = Math.min(target.maxHP, target.hp + healAmount);
          context.log.push(
            `${owner.name} reacts (${r.abilityName}) and heals ${target.name} for ${target.hp - oldHP} (${oldHP} → ${target.hp}).`
          );
        }
      } else if (r.action === "buff") {
        const buffTarget = r.target === "ally" ? context.ally || owner : owner;
        if (buffTarget) {
          if (!buffTarget.effects) buffTarget.effects = [];
          buffTarget.effects.push({
            stats: { ...(r.effect || {}) },
            remainingRounds: r.duration || 2,
            source: owner.name,
            abilityName: r.abilityName || "Reaction",
            isConcentration: false
          });
          context.log.push(
            `${owner.name} reacts (${r.abilityName}) and grants a buff to ${buffTarget.name}.`
          );
        }
      }

      fired.push(r);
      if (r.remainingUses != null) {
        r.remainingUses -= 1;
        return r.remainingUses > 0;
      }
      return false;
    }

    return true;
  });

  return fired;
}

function getAbilityDamageType(ability) {
  if (ability.damageType) return ability.damageType;
  if (ability.type === "magic") return "magic";
  if (ability.type === "physical") return "physical";
  return "physical";
}

function adjustDamageForResistances(damage, defender, damageType) {
  if (!defender) return damage;

  const resists = defender.resistances || [];
  const vuln = defender.vulnerabilities || [];
  let result = damage;

  if (resists.includes(damageType)) {
    result = Math.round(result * 0.75);
  }

  if (vuln.includes(damageType)) {
    result = Math.round(result * 1.25);
  }

  return result;
}

function applyMetaTrendBias(score, ability) {
  const meta = GAME.metaTrend;
  if (!meta || !meta.bias) return score;

  const bias = meta.bias;
  let result = score;

  if (bias.aoe && ability.aoe && ability.aoe !== "single") result += bias.aoe;
  if (bias.support && (isHealingAbility(ability) || hasEffectObject(ability))) result += bias.support;
  if (bias.heal && isHealingAbility(ability)) result += bias.heal;
  if (bias.singleTarget && (!ability.aoe || ability.aoe === "single") && isDamagingAbility(ability)) {
    result += bias.singleTarget;
  }
  if (bias.magic && ability.type === "magic") result += bias.magic;
  if (bias.physical && ability.type === "physical") result += bias.physical;

  return result;
}

function scoreAbilityForLoadout(fighter, ability, opponents) {
  let score = ability.aiWeight != null ? ability.aiWeight : 1;

  if (isHealingAbility(ability)) score += 0.6;
  if (hasEffectObject(ability) || ability.applyCondition) score += 0.15;
  if (ability.aoe && ability.aoe !== "single") score += 0.2;

  const damageType = isDamagingAbility(ability) ? getAbilityDamageType(ability) : null;
  if (damageType) {
    const vulnCount = opponents.filter(o => (o.vulnerabilities || []).includes(damageType)).length;
    const resistCount = opponents.filter(o => (o.resistances || []).includes(damageType)).length;
    score += vulnCount * 0.25;
    score -= resistCount * 0.2;
  }

  score = applyMetaTrendBias(score, ability);

  const pinned = fighter.coreAbilities || [];
  const recommended = fighter.activeAbilities || [];
  if (pinned.includes(ability.id)) score += 0.4;
  else if (recommended.includes(ability.id)) score += 0.2;

  score *= 0.9 + Math.random() * 0.2;
  return Math.max(score, 0.05);
}

function getAbilityPool(fighter) {
  if (fighter.abilityPool && fighter.abilityPool.length > 0) return fighter.abilityPool;
  return fighter.abilities || [];
}

function chooseLoadout(fighter, opponents) {
  const pool = getAbilityPool(fighter);
  const loadoutSize = fighter.loadoutSize || 4;
  const abilityMap = new Map(pool.map(ab => [ab.id, ab]));
  const chosen = [];
  const chosenIds = new Set();

  for (const id of fighter.coreAbilities || []) {
    if (abilityMap.has(id)) {
      chosen.push(abilityMap.get(id));
      chosenIds.add(id);
    }
  }

  const scored = pool
    .filter(ab => !chosenIds.has(ab.id))
    .map(ab => ({ ab, score: scoreAbilityForLoadout(fighter, ab, opponents) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const item of scored) {
    if (chosen.length >= loadoutSize) break;
    chosen.push(item.ab);
    chosenIds.add(item.ab.id);
  }

  // If we still need filler (unlikely), just add the remaining highest AI weight moves.
  if (chosen.length < loadoutSize) {
    const leftovers = pool
      .filter(ab => !chosenIds.has(ab.id))
      .sort((a, b) => (b.aiWeight || 1) - (a.aiWeight || 1));
    for (const ab of leftovers) {
      if (chosen.length >= loadoutSize) break;
      chosen.push(ab);
    }
  }

  return chosen.slice(0, loadoutSize);
}

function prepareTeamLoadouts(team, opponents) {
  return team.map(f => ({
    ...f,
    abilities: chooseLoadout(f, opponents)
  }));
}

function recordDamage(stats, attacker, amount) {
  if (!stats || !attacker || !attacker.id || amount <= 0) return;
  stats.damageByFighter[attacker.id] = (stats.damageByFighter[attacker.id] || 0) + amount;
}

function applyPassiveDamageMitigation(damage, defender, damageType, logLines) {
  if (!defender || !defender.passives) return damage;

  let result = damage;
  const note = msg => {
    if (logLines) logLines.push(msg);
  };

  if (damageType === "physical" && defender.passives.physicalDamageMultiplier != null) {
    const before = result;
    result = Math.round(result * defender.passives.physicalDamageMultiplier);
    if (before !== result) {
      note(`${defender.name} shrugs off part of the blow (physical damage reduced).`);
    }
  }

  if (damageType === "magic" && defender.passives.magicDamageMultiplier != null) {
    const before = result;
    result = Math.round(result * defender.passives.magicDamageMultiplier);
    if (before !== result) {
      note(`${defender.name} bends mana around themselves (magic damage reduced).`);
    }
  }

  return result;
}

function computeDamage(attacker, defender, ability, logLines) {
  const arr = ability.damageByRank;
  const idx = Math.min((ability.rank || 1) - 1, arr.length - 1);
  let dmg = rollDiceExpression(arr[idx]);

  // ---- Luck-based critical hits ----
  const luck = getModifiedStat(attacker, "luck");

  // Base 5% crit +1% per Luck point
  let critChance = 0.05 + luck * 0.01;

  // Clamp between 0% and 25%
  critChance = Math.min(0.25, Math.max(0, critChance));

  let isCrit = false;
  if (Math.random() < critChance) {
    isCrit = true;
    dmg = Math.round(dmg * 1.5); // 50% more damage on crit
  }

  if (ability.extraDamageIfTargetDebuffed && defender.effects && defender.effects.length > 0) {
    dmg += ability.extraDamageIfTargetDebuffed;
  }

  const damageType = getAbilityDamageType(ability);
  dmg = adjustDamageForResistances(dmg, defender, damageType);
  dmg = applyPassiveDamageMitigation(dmg, defender, damageType, logLines);

  if (dmg < 1) dmg = 1;

  // Return both damage and crit info
  return { dmg, isCrit, damageType };
}

function computeHealAmount(ability) {
  const arr = ability.healByRank;
  const idx = Math.min((ability.rank || 1) - 1, arr.length - 1);
  let heal = rollDiceExpression(arr[idx]);
  if (heal < 1) heal = 1;
  return heal;
}

// ---------- Targeting & AoE ----------

function getAliveByPosition(fighters, pos) {
  return fighters.filter(f => isAlive(f) && f.position === pos);
}

function selectSingleEnemy(attacker, enemies, targeting) {
  const aliveEnemies = enemies.filter(isAlive);
  if (aliveEnemies.length === 0) return null;

  if (targeting === "front-preferred") {
    const fronts = getAliveByPosition(enemies, "front");
    if (fronts.length > 0) return randomChoice(fronts);
    const mids = getAliveByPosition(enemies, "mid");
    if (mids.length > 0) return randomChoice(mids);
    const backs = getAliveByPosition(enemies, "back");
    if (backs.length > 0) return randomChoice(backs);
    return randomChoice(aliveEnemies);
  }

  // default: any-enemy
  return randomChoice(aliveEnemies);
}

function selectSingleAlly(attacker, allies, ability, targeting) {
  const aliveAllies = allies.filter(isAlive);

  // healing: pick lowest HP%
  if (isHealingAbility(ability)) {
    let best = null;
    let bestRatio = 1.1;
    for (const a of aliveAllies) {
      const ratio = a.hp / a.maxHP;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = a;
      }
    }
    return best || attacker;
  }

  // buff-like: if we have heals/buffs, try prefer not-full HP
  if (hasEffectObject(ability)) {
    const notFull = aliveAllies.filter(a => a.hp < a.maxHP);
    if (notFull.length > 0) return randomChoice(notFull);
  }

  if (targeting === "self") return attacker;
  return randomChoice(aliveAllies);
}

function selectTargets(attacker, allies, enemies, ability) {
  const aoe = ability.aoe || "single";
  const targeting = ability.targeting || "any-enemy";

  // Self-target abilities
  if (targeting === "self") {
    if (aoe === "single") return { allies, enemies, targets: [attacker] };
    if (aoe === "team") return { allies, enemies, targets: allies.filter(isAlive) };
  }

  // Ally-targeting (buff/heal)
  if (targeting === "ally" || targeting === "team") {
    if (aoe === "team") {
      return { allies, enemies, targets: allies.filter(isAlive) };
    }
    const t = selectSingleAlly(attacker, allies, ability, targeting);
    return { allies, enemies, targets: t ? [t] : [] };
  }

  // Enemy-targeting
  const aliveEnemies = enemies.filter(isAlive);
  if (aliveEnemies.length === 0) return { allies, enemies, targets: [] };

  if (aoe === "enemy-team") {
    return { allies, enemies, targets: aliveEnemies };
  }

  if (aoe === "all") {
    return { allies, enemies, targets: [...allies.filter(isAlive), ...aliveEnemies] };
  }

  if (aoe === "random-2-enemies") {
    const copy = [...aliveEnemies];
    const chosen = [];
    while (copy.length > 0 && chosen.length < 2) {
      const idx = Math.floor(Math.random() * copy.length);
      chosen.push(copy.splice(idx, 1)[0]);
    }
    return { allies, enemies, targets: chosen };
  }

  // default: single enemy
  const enemy = selectSingleEnemy(attacker, enemies, targeting);
  return { allies, enemies, targets: enemy ? [enemy] : [] };
}

// ---------- Redirect (Body Block, Guard Duty, etc.) ----------

function maybeRedirectTarget(target, allies) {
  const candidates = allies.filter(a => isAlive(a) && a.effects && a.effects.length > 0);
  let best = null;
  let bestChance = 0;

  for (const a of candidates) {
    for (const eff of a.effects) {
      if (!eff.stats) continue;
      const ch = eff.stats.redirectChance;
      if (typeof ch === "number" && ch > bestChance) {
        bestChance = ch;
        best = a;
      }
    }
  }

  if (!best || bestChance <= 0) return target;

  if (Math.random() < bestChance) {
    return best;
  }
  return target;
}

// ---------- AI ----------

function targetingIsSelf(ability) {
  return ability.targeting === "self";
}

function scoreAbility(attacker, allies, enemies, ability, round) {
  const base = ability.aiWeight || 1.0;
  let score = base;

  const aoe = ability.aoe || "single";
  const isDamage = isDamagingAbility(ability);
  const isHeal = isHealingAbility(ability);
  const hasBuff = hasEffectObject(ability);

  const aliveAllies = allies.filter(isAlive);
  const aliveEnemies = enemies.filter(isAlive);

  const lowestAllyRatio = aliveAllies.reduce(
    (min, a) => Math.min(min, a.hp / a.maxHP),
    1.0
  );
  const lowestEnemyRatio = aliveEnemies.reduce(
    (min, e) => Math.min(min, e.hp / e.maxHP),
    1.0
  );

  // Healing
  if (isHeal) {
    if (lowestAllyRatio < 0.4) score *= 1.8;
    else if (lowestAllyRatio < 0.7) score *= 1.3;
    else score *= 0.4;
  }

  // Team buffs early
  if (!isDamage && hasBuff && aoe === "team") {
    if (round <= 3) score *= 1.5;
    else score *= 1.0;
  }

  // Self-buffs for frontliners
  if (!isDamage && targetingIsSelf(ability)) {
    if (attacker.roleClass === "frontliner" || attacker.roleClass === "bruiser") {
      score *= 1.2;
    }
  }

  // Heavy finishers when enemies are low
  if (isDamage && ability.category === "heavy") {
    if (lowestEnemyRatio < 0.4) score *= 1.6;
    else score *= 1.1;
  }

  // AoE is good with multiple enemies
  if (isDamage && (aoe === "enemy-team" || aoe === "random-2-enemies")) {
    if (aliveEnemies.length >= 2) score *= 1.4;
  }

  // If attacker is low HP and ability is pure damage, slightly deprioritize
  const myRatio = attacker.hp / attacker.maxHP;
  if (myRatio < 0.3 && isDamage && !isHeal && !hasBuff) {
    score *= 0.8;
  }

  // Cooldown heuristic: if ability has a long cooldown, the AI slightly
  // values it more when used (so it "feels" impactful in scoring)
  if (ability.cooldown && ability.cooldown >= 3) {
    score *= 1.1;
  }

  // Tiny randomness
  score *= 0.9 + Math.random() * 0.2;

  return score;
}

function hasChargesAvailable(fighter, ability) {
  if (!ability.charges || ability.charges <= 0) return true;
  if (!fighter.usedCharges) fighter.usedCharges = {};
  const used = fighter.usedCharges[ability.id] || 0;
  return used < ability.charges;
}

function spendAbilityCharge(fighter, ability) {
  if (!ability.charges || ability.charges <= 0) return;
  if (!fighter.usedCharges) fighter.usedCharges = {};
  fighter.usedCharges[ability.id] = (fighter.usedCharges[ability.id] || 0) + 1;
}

function chooseAbility(attacker, allies, enemies, round) {
  const usable = attacker.abilities || [];
  if (usable.length === 0) return null;

  const cdMap = attacker.cooldowns || {};
  const silenced = hasCondition(attacker, "silenced");

  let totalScore = 0;
  const scored = [];

  for (const ab of usable) {
    const cd = ab.cooldown || 0;
    if (cdMap[ab.id] && cdMap[ab.id] > 0) {
      continue; // still on cooldown
    }

    if (!hasChargesAvailable(attacker, ab)) {
      continue;
    }

    // Silenced: skip magic abilities entirely
    if (silenced && ab.type === "magic") {
      continue;
    }

    const isDamage = isDamagingAbility(ab);
    const isHeal = isHealingAbility(ab);
    const hasBuff = hasEffectObject(ab);

    if (!isDamage && !isHeal && !hasBuff) {
      if (!ab.aiWeight) ab.aiWeight = 0.7;
    }

    const s = scoreAbility(attacker, allies, enemies, ab, round);
    if (s <= 0) continue;
    scored.push({ ab, score: s });
    totalScore += s;
  }

  if (scored.length === 0) return null;

  let r = Math.random() * totalScore;
  for (const item of scored) {
    if (r < item.score) return item.ab;
    r -= item.score;
  }

  return scored[scored.length - 1].ab;
}

// ---------- Action Execution ----------

function performAction(attacker, allies, enemies, round, logLines, metrics) {
  if (!isAlive(attacker)) return;

  if (metrics) metrics.turns += 1;

  // Stunned: skip this action entirely
  if (hasCondition(attacker, "stunned")) {
    logLines.push(`${attacker.name} is stunned and can't act this round.`);
    spendConditionTurn(attacker, "stunned");
    return;
  }

  const silencedAtTurnStart = hasCondition(attacker, "silenced");

  const ability = chooseAbility(attacker, allies, enemies, round);
  if (!ability) {
    logLines.push(`${attacker.name} hesitates.`);
    if (silencedAtTurnStart) spendConditionTurn(attacker, "silenced");
    return;
  }

  const finalizeSilence = () => {
    if (silencedAtTurnStart) spendConditionTurn(attacker, "silenced");
  };

  // Start cooldown as soon as ability is chosen (like spending a spell slot)
  if (!attacker.cooldowns) attacker.cooldowns = {};
  if (ability.cooldown && ability.cooldown > 0) {
    attacker.cooldowns[ability.id] = ability.cooldown;
  }

  const { targets } = selectTargets(attacker, allies, enemies, ability);
  if (!targets || targets.length === 0) {
    logLines.push(`${attacker.name} uses ${ability.name}, but finds no valid target.`);
    finalizeSilence();
    return;
  }

  spendAbilityCharge(attacker, ability);

  const isDamage = isDamagingAbility(ability);
  const isHeal = isHealingAbility(ability);
  const hasBuff = hasEffectObject(ability);
  const usesSavingThrow = !!ability.save || (ability.saveStat && ability.saveDifficulty != null);
  const sharedSaveResults = usesSavingThrow ? new Map() : null;

  const applySecondaryEffects = targetList => {
    const saveResults = sharedSaveResults;
    let buffedTargets = [];
    if (hasBuff) {
      const res =
        applyBuffOrDebuff(attacker, targetList, ability, { saveResults }) || [];
      buffedTargets = res;
    }
    const reactionTargets = applyReactions(attacker, targetList, ability);
    const conditionResult = applyConditions(attacker, targetList, ability, {
      saveResults
    });
    logConditionApplications(logLines, ability.applyCondition, conditionResult);
    const advResult = applyAttackRollModifiers(attacker, targetList, ability);
    logAttackModifierResults(logLines, advResult);

    const impactedSet = new Set();
    for (const t of buffedTargets) impactedSet.add(t);
    for (const t of conditionResult.applied) impactedSet.add(t);
    for (const t of advResult.advantage) impactedSet.add(t);
    for (const t of advResult.disadvantage) impactedSet.add(t);
    for (const t of reactionTargets) impactedSet.add(t);

    return { impacted: Array.from(impactedSet) };
  };

  if (isDamage) {
    const allEnemySide = enemies;
    for (let target of targets) {
      if (!isAlive(target)) continue;

      // redirect (body block / guard duty)
      const enemyAllies = allEnemySide;
      target = maybeRedirectTarget(target, enemyAllies);

      if (consumeSpecialFlag(target, "oneTimeDodge")) {
        logLines.push(`${attacker.name} uses ${ability.name} on ${target.name}, but they dodge!`);
        continue;
      }

      const hit = attemptHit(attacker, target, ability);
      if (!hit.hit) {
        logLines.push(
          `${attacker.name} uses ${ability.name} on ${target.name}, but misses.`
        );

        triggerReactions(
          target,
          "onMissed",
          {
            attacker,
            target,
            log: logLines
          },
          metrics
        );

        if (
          consumeSpecialFlag(target, "counterNextMiss") &&
          isAlive(target) &&
          isAlive(attacker)
        ) {
          const counterDmg = rollDiceExpression("1d4+1");
          const oldHP = attacker.hp;
          attacker.hp = Math.max(0, attacker.hp - counterDmg);
          logLines.push(
            `${target.name} counters for ${counterDmg} damage (${oldHP} → ${attacker.hp}).`
          );
          if (!isAlive(attacker)) {
            logLines.push(`${attacker.name} is knocked out!`);
            break;
          }
        }
        continue;
      }

      let saveResult = null;
      if (ability.save) {
        if (sharedSaveResults && sharedSaveResults.has(target)) {
          saveResult = sharedSaveResults.get(target);
        } else {
          saveResult = evaluateSavingThrow(target, ability);
          if (sharedSaveResults) sharedSaveResults.set(target, saveResult);
        }
      }
      if (saveResult && !saveResult.applies) {
        logLines.push(
          `${attacker.name} uses ${ability.name} on ${target.name}, but they resist the effect.`
        );
        continue;
      }

      let { dmg, isCrit } = computeDamage(attacker, target, ability, logLines);
      if (saveResult && saveResult.scale != null && saveResult.scale !== 1) {
        dmg = Math.max(0, Math.floor(dmg * saveResult.scale));
      }

      if (dmg <= 0) {
        logLines.push(
          `${attacker.name} hits ${target.name} with ${ability.name}, but it deals no damage.`
        );
        continue;
      }

      const oldHP = target.hp;
      target.hp = Math.max(0, target.hp - dmg);
      recordDamage(metrics, attacker, dmg);

      const critText = isCrit ? " (CRIT!)" : "";
      const mitigationText = saveResult && saveResult.success && saveResult.scale < 1 ? " (reduced)" : "";
      logLines.push(
        `${attacker.name} hits ${target.name} with ${ability.name}${critText} for ${dmg}${mitigationText} (${oldHP} → ${target.hp}).`
      );

      if (target.passives && target.passives.attackBuffOnHit) {
        target.attackBonus = (target.attackBonus || 0) + target.passives.attackBuffOnHit;
        logLines.push(
          `${target.name}'s rage builds (+${target.passives.attackBuffOnHit} attack).`
        );
      }

      triggerReactions(
        target,
        "allyHit",
        {
          attacker,
          target,
          log: logLines
        },
        metrics
      );

      for (const ally of enemies) {
        if (ally === target || !isAlive(ally)) continue;
        triggerReactions(
          ally,
          "allyHit",
          {
            attacker,
            target,
            ally: target,
            log: logLines
          },
          metrics
        );
      }

      // If this damaging ability also has an effect (e.g. Hex), apply it (with save inside).
      if (sharedSaveResults && saveResult) {
        sharedSaveResults.set(target, saveResult);
      }
      applySecondaryEffects([target]);

      if (ability.positionShift) {
        const moved = shiftPosition(target, ability.positionShift);
        if (moved) {
          logLines.push(
            `${target.name} is ${ability.positionShift > 0 ? "pushed" : "pulled"} ${moved.from} → ${moved.to}.`
          );
        }
      }

      if (ability.extraEffect) applyExtraEffects(attacker, allies, enemies, target, ability);

      if (
        ability.swapPositions === "withTarget" &&
        targets.length > 0 &&
        targets[0]
      ) {
        const swapped = swapPositions(attacker, targets[0]);
        if (swapped) {
          logLines.push(
            `${attacker.name} swaps places with ${targets[0].name} (${swapped.aTo} ↔ ${swapped.bTo}).`
          );
        }
      }

      if (!isAlive(target)) {
        logLines.push(`${target.name} is knocked out!`);
      }

      if (target.hp > 0) {
        triggerReactions(
          attacker,
          "enemyLowHP",
          {
            target,
            attacker,
            log: logLines
          },
          metrics
        );
        for (const ally of allies) {
          if (!isAlive(ally)) continue;
          triggerReactions(
            ally,
            "enemyLowHP",
            {
              target,
              attacker,
              log: logLines
            },
            metrics
          );
        }
      }
    }
    finalizeSilence();
    return;
  }

  if (isHeal) {
    for (const t of targets) {
      if (!isAlive(t)) continue;

      const amount = computeHealAmount(ability);
      const oldHP = t.hp;
      t.hp = Math.min(t.maxHP, t.hp + amount);
      const healed = t.hp - oldHP;

      if (healed > 0) {
        logLines.push(
          `${attacker.name} uses ${ability.name} on ${t.name}, healing ${healed} (${oldHP} → ${t.hp}).`
        );
      }

      applySecondaryEffects([t]);

      if (ability.swapPositions === "withTarget") {
        const swapped = swapPositions(attacker, t);
        if (swapped) {
          logLines.push(
            `${attacker.name} swaps places with ${t.name} (${swapped.aTo} ↔ ${swapped.bTo}).`
          );
        }
      }
    }
    finalizeSilence();
    return;
  }

  // Pure buff / utility (includes debuffs like Dark Mist, Taunting Bark, etc.)
  const result = applySecondaryEffects(targets);
  if (result.impacted.length > 0) {
    const names = result.impacted.map(t => t.name).join(", ");
    logLines.push(`${attacker.name} uses ${ability.name} on ${names}.`);
    if (ability.swapPositions === "withTarget" && targets.length > 0) {
      const swapped = swapPositions(attacker, targets[0]);
      if (swapped) {
        logLines.push(
          `${attacker.name} swaps places with ${targets[0].name} (${swapped.aTo} ↔ ${swapped.bTo}).`
        );
      }
    }
  } else {
    logLines.push(`${attacker.name} uses ${ability.name}, but it has no effect.`);
  }
  finalizeSilence();
}

// ---------- Turn Order ----------

function buildTurnOrder(allFighters) {
  const arr = allFighters
    .filter(isAlive)
    .map(f => {
      const rawSpeed = getModifiedStat(f, "speed");
      const safeSpeed = Math.max(0, rawSpeed);
	  const jitter = Math.random() * 0.75; // instead of 0–1
      return {
        f,
        speedVal: Math.sqrt(safeSpeed) + jitter
      };
    });

  arr.sort((a, b) => b.speedVal - a.speedVal);
  return arr.map(x => x.f);
}


// ---------- Clone Fighter for Battle ----------

function cloneFighterForBattle(f) {
  const c = { ...f };
  c.hp = c.maxHP;
  c.effects = [];
  c.conditions = [];
  c.cooldowns = {}; // abilityId -> remaining cooldown
  c.usedCharges = {};
  c.reactions = [];
  return c;
}

function applyRoundRegeneration(fighters, logLines) {
  for (const f of fighters) {
    if (!isAlive(f)) continue;
    const healAmount = f.passives?.healPerRound;
    if (healAmount && healAmount > 0) {
      const old = f.hp;
      f.hp = Math.min(f.maxHP, f.hp + healAmount);
      if (f.hp > old) {
        logLines.push(`${f.name} calmly recovers ${f.hp - old} HP between clashes.`);
      }
    }
  }
}

// ---------- Main Simulation ----------

// Run a single battle on existing fighter objects (no cloning here).
// aF and bF are mutated in-place: hp, effects, cooldowns, flags, etc.
function runBattleOnExistingFighters(aF, bF, options = {}) {
  const log = [];
  const metrics = options.trackStats
    ? {
        rounds: 0,
        turns: 0,
        damageByFighter: {}
      }
    : null;

  log.push(
    `Battle Start: [A] ${aF.map(f => f.name).join(", ")} vs [B] ${bF
      .map(f => f.name)
      .join(", ")}`
  );

  let round = 1;
  const maxRounds = 60;

  while (round <= maxRounds) {
    const aliveA = aF.filter(isAlive);
    const aliveB = bF.filter(isAlive);

    if (aliveA.length === 0 || aliveB.length === 0) break;

    log.push(`-- Round ${round} --`);

    if (metrics) metrics.rounds = round;

    applyRoundRegeneration([...aF, ...bF], log);

    tickEffects([...aF, ...bF]);
    tickConditions([...aF, ...bF]);
    tickCooldowns([...aF, ...bF]);

    const turnOrder = buildTurnOrder([...aF, ...bF]);

    for (const fighter of turnOrder) {
      if (!isAlive(fighter)) continue;

      const allies = aF.includes(fighter) ? aF : bF;
      const enemies = allies === aF ? bF : aF;

      if (enemies.filter(isAlive).length === 0) break;

      performAction(fighter, allies, enemies, round, log, metrics);

      if (aF.filter(isAlive).length === 0 || bF.filter(isAlive).length === 0) break;
    }

    round++;
  }

  const aliveA2 = aF.filter(isAlive).length;
  const aliveB2 = bF.filter(isAlive).length;

  let winner = "A";
  if (aliveA2 && !aliveB2) {
    winner = "A";
  } else if (aliveB2 && !aliveA2) {
    winner = "B";
  } else {
    const hpA = aF.reduce((s, f) => s + Math.max(0, f.hp), 0);
    const hpB = bF.reduce((s, f) => s + Math.max(0, f.hp), 0);
    if (hpA > hpB) winner = "A";
    else if (hpB > hpA) winner = "B";
    else winner = Math.random() < 0.5 ? "A" : "B";
  }

  log.push(`Battle Result: Team ${winner} wins.`);

  return { winner, log: log.join("\n"), stats: metrics };
}

/**
 * Simulate a single 3v3 battle between two teams.
 *
 * @param {Array<Object>} teamA - Array of fighter base objects (e.g. from GAME.fighters).
 * @param {Array<Object>} teamB - Array of fighter base objects.
 * @param <Object> options - For now, options is unused
 * @returns {{ winner: "A" | "B" | "DRAW", log: string }}
 *
 * Notes:
 * - Fighters are cloned internally; originals are not mutated.
 * - AI may be biased by GAME.metaTrend (if set).
 */
export function simulateTeamBattle(teamA, teamB, options = {}) {
  const preparedA = prepareTeamLoadouts(teamA, teamB);
  const preparedB = prepareTeamLoadouts(teamB, teamA);
  const aF = preparedA.map(cloneFighterForBattle);
  const bF = preparedB.map(cloneFighterForBattle);
  return runBattleOnExistingFighters(aF, bF, options);
}

/**
 * Simulate a multi-game series between two teams.
 *
 * @param {Array<Object>} teamA
 * @param {Array<Object>} teamB
 * @param {number} games - Number of games (default 2).
 * @param <Object> options - For now, options is unused
 * @returns {{ winner: "A" | "B" | "DRAW", log: string }}
 *
 * Notes:
 * - HP is reset between games, but ongoing effects / cooldowns / flags persist.
 * - Use this when you want to allow draws (e.g. best-of-2).
 */
export function simulateTeamSeries(teamA, teamB, games = 2, options = {}) {
  const preparedA = prepareTeamLoadouts(teamA, teamB);
  const preparedB = prepareTeamLoadouts(teamB, teamA);
  const aF = preparedA.map(cloneFighterForBattle);
  const bF = preparedB.map(cloneFighterForBattle);

  let winsA = 0;
  let winsB = 0;
  const seriesLogs = [];

  for (let g = 1; g <= games; g++) {
    // Reset HP only; keep effects, cooldowns, and other state.
    for (const f of aF) {
      f.hp = f.maxHP;
      f.usedCharges = {};
    }
    for (const f of bF) {
      f.hp = f.maxHP;
      f.usedCharges = {};
    }

    const { winner, log } = runBattleOnExistingFighters(aF, bF, options);

    seriesLogs.push(`Game ${g}\n${log}`);

    if (winner === "A") winsA++;
    else if (winner === "B") winsB++;
  }

  let seriesWinner = "DRAW";
  if (winsA > winsB) seriesWinner = "A";
  else if (winsB > winsA) seriesWinner = "B";

  return {
    winner: seriesWinner, // "A", "B", or "DRAW" (for even number of games)
    log: seriesLogs.join("\n\n")
  };
}

const battleAPI = {
  simulateTeamBattle,
  simulateTeamSeries
};

export default battleAPI;

// Provide CommonJS compatibility so Node-based tooling (tests, scripts)
// can continue using require(...) without needing transpilation.
if (typeof module !== "undefined") {
  module.exports = battleAPI;
}

