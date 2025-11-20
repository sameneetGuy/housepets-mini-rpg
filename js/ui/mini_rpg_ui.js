// js/ui/mini_rpg_ui.js
import { GAME } from "../core/state.js";
import { MiniRPG, MINI_RPG_STAGES, describeStage } from "../modes/mini_rpg.js";
const CURRENT_RANKS = {}; // { [fighterId]: { [abilityId]: rankInt } }

const CURRENT_LOADOUTS = {}; // { [fighterId]: string[] }

function isPlayableFighter(fid) {
  const fighter = GAME.fighters[fid];
  if (!fighter) return false;
  if (fid.includes("_boss")) return false;
  if ((fighter.role || "").toLowerCase() === "boss") return false;
  return true;
}

function ensureLoadoutForFighter(fighter) {
  const loadoutSize = fighter.loadoutSize || 4;
  const coreSet = new Set(fighter.coreAbilities || []);

  let selected = CURRENT_LOADOUTS[fighter.id];
  if (!selected || !selected.length) {
    // Default: use activeAbilities or current abilities ids
    const baseActive =
      (fighter.activeAbilities && fighter.activeAbilities.length
        ? fighter.activeAbilities
        : (fighter.abilities || []).map(ab => ab.id));

    selected = baseActive.slice(0, loadoutSize);
  }

  // Make sure all core abilities are present
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

  // Trim to loadoutSize, but never drop core abilities
  while (unique.length > loadoutSize) {
    const removableIndex = unique.findIndex(id => !coreSet.has(id));
    if (removableIndex === -1) break;
    unique.splice(removableIndex, 1);
  }

  CURRENT_LOADOUTS[fighter.id] = unique;
  return { loadoutSize, coreSet, selectedIds: unique };
}

function getAbilityBaseRank(fighterId, abilityId) {
  const fighter = GAME.fighters[fighterId];
  if (!fighter || !Array.isArray(fighter.abilities)) return 1;
  const ab = fighter.abilities.find(a => a.id === abilityId);
  return (ab && ab.rank) || 1;
}

function renderRankUpPanel(container, state) {
  const pointsDiv = container.querySelector("#rankup-points-display");
  const rowsDiv = container.querySelector("#rankup-rows");
  const applyButton = container.querySelector("#apply-rankups-button");
  if (!pointsDiv || !rowsDiv || !applyButton) return;

  const points = state.rankUpPoints || 0;
  pointsDiv.textContent = `Rank-up points: ${points}`;

  rowsDiv.innerHTML = "";

  const party = state.partyIds || [];
  if (!party.length) {
    rowsDiv.textContent = "Select a party to rank up abilities.";
    applyButton.disabled = true;
    return;
  }

  applyButton.disabled = false;

  // make sure CURRENT_RANKS has entries for current party
  for (const fid of party) {
    if (!CURRENT_RANKS[fid]) CURRENT_RANKS[fid] = {};
  }

  for (const fid of party) {
    const fighter = GAME.fighters[fid];
    if (!fighter) continue;

    const row = document.createElement("div");
    row.className = "rankup-row";

    const title = document.createElement("div");
    title.innerHTML = `<strong>${fighter.name}</strong>`;
    row.appendChild(title);

    const pool = fighter.abilityPool || fighter.abilities || [];
    const fighterRanks = CURRENT_RANKS[fid];

    pool.forEach(ab => {
      const baseRank = getAbilityBaseRank(fid, ab.id);
      const currentRank = fighterRanks[ab.id] || baseRank;

      const item = document.createElement("div");
      item.className = "rankup-ability";

      const nameSpan = document.createElement("span");
      nameSpan.className = "rankup-ability-name";
      nameSpan.textContent = ab.name;

      const rankSpan = document.createElement("span");
      rankSpan.className = "rankup-rank-label";
      rankSpan.textContent = `Rank: ${currentRank}`;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rankup-button";
      btn.textContent = "+";

      const canIncrease =
        points > 0 && currentRank < 3; // hard cap rank 3 to match your data

      btn.disabled = !canIncrease;

      btn.addEventListener("click", () => {
        const s = MiniRPG.getState();
        if ((s.rankUpPoints || 0) <= 0) return;

        const fRanks = CURRENT_RANKS[fid] || {};
        const nextRank = (fRanks[ab.id] || baseRank) + 1;
        if (nextRank > 3) return;

        fRanks[ab.id] = nextRank;
        CURRENT_RANKS[fid] = fRanks;

        // consume 1 point in engine
        MiniRPG.awardRankUpPoints(-1);
        const updatedState = MiniRPG.getState();

        // re-render with new numbers
        renderRankUpPanel(container, updatedState);
        renderStatus(container, updatedState);
      });

      item.appendChild(nameSpan);
      item.appendChild(rankSpan);
      item.appendChild(btn);
      row.appendChild(item);
    });

    rowsDiv.appendChild(row);
  }

  applyButton.onclick = () => {
    MiniRPG.setAbilityRanks(CURRENT_RANKS);
    const updatedState = MiniRPG.getState();
    renderRankUpPanel(container, updatedState);
    renderStatus(container, updatedState);
  };
}


function renderSlotAbilityUI(container, slotIndex) {
  const select = container.querySelector(`#slot${slotIndex}`);
  const box = container.querySelector(`#slot${slotIndex}-abilities`);
  if (!box) return;

  box.innerHTML = "";

  const fighterId = select?.value;
  if (!fighterId) {
    box.textContent = "Pick a fighter to customize abilities.";
    return;
  }

  const fighter = GAME.fighters[fighterId];
  if (!fighter) {
    box.textContent = "Unknown fighter.";
    return;
  }

  const pool = fighter.abilityPool || fighter.abilities || [];
  if (!pool.length) {
    box.textContent = "No abilities to customize.";
    return;
  }

  const { loadoutSize, coreSet, selectedIds } = ensureLoadoutForFighter(fighter);

  const info = document.createElement("p");
  info.className = "mini-rpg-abilities-info";
  info.textContent = `Loadout: ${selectedIds.length}/${loadoutSize} (core abilities are locked)`;
  box.appendChild(info);

  const list = document.createElement("div");
  list.className = "mini-rpg-abilities-list";

  for (const ab of pool) {
    const wrapper = document.createElement("label");
    wrapper.className = "mini-rpg-ability-option";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = ab.id;

    const isCore = coreSet.has(ab.id);
    const checked = selectedIds.includes(ab.id);

    cb.checked = checked;
    cb.disabled = isCore;

    cb.addEventListener("change", () => {
      const current = CURRENT_LOADOUTS[fighterId] || [];
      if (cb.checked) {
        if (current.includes(ab.id)) return;
        if (current.length >= loadoutSize) {
          // hard cap
          cb.checked = false;
          return;
        }
        CURRENT_LOADOUTS[fighterId] = [...current, ab.id];
      } else {
        if (isCore) {
          // cannot uncheck core
          cb.checked = true;
          return;
        }
        CURRENT_LOADOUTS[fighterId] = current.filter(id => id !== ab.id);
      }
      info.textContent = `Loadout: ${CURRENT_LOADOUTS[fighterId].length}/${loadoutSize} (core abilities are locked)`;
    });

    const span = document.createElement("span");
    span.innerHTML = `<strong>${ab.name}</strong> — ${ab.description || ""}`;

    wrapper.appendChild(cb);
    wrapper.appendChild(span);
    list.appendChild(wrapper);
  }

  box.appendChild(list);
}

function buildPartyLoadouts(party) {
  const map = {};
  for (const id of party) {
    const fighter = GAME.fighters[id];
    if (!fighter) continue;

    let selected = CURRENT_LOADOUTS[id];
    if (!selected || !selected.length) {
      const baseActive =
        (fighter.activeAbilities && fighter.activeAbilities.length
          ? fighter.activeAbilities
          : (fighter.abilities || []).map(ab => ab.id));
      const size = fighter.loadoutSize || 4;
      selected = baseActive.slice(0, size);
    }
    map[id] = selected;
  }
  return map;
}

function buildOption(fid) {
  const fighter = GAME.fighters[fid];
  const label = fighter ? `${fighter.name} (${fid})` : fid;
  return `<option value="${fid}">${label}</option>`;
}

function renderStatus(container, state) {
  const cleared = state.stageResults.filter(r => r.outcome === "cleared").length;
  const currentStage = MINI_RPG_STAGES[state.currentStageIndex];

  container.querySelector(".mini-rpg-status").textContent = `Status: ${state.status}`;
  container.querySelector(
    ".mini-rpg-progress"
  ).textContent = `Stages cleared: ${cleared} / ${MINI_RPG_STAGES.length}`;
  container.querySelector(".mini-rpg-stage").textContent =
    currentStage && state.status === "in progress"
      ? describeStage(currentStage, state.currentStageIndex)
      : "Current stage: --";

  const hpList = container.querySelector(".mini-rpg-hp");
  hpList.innerHTML = "";
  for (const id of state.partyIds) {
    const hp = state.partyHP[id] ?? "?";
    const fighter = GAME.fighters[id];
    const name = fighter ? fighter.name : id;
    const li = document.createElement("li");
    li.textContent = `${name}: ${hp} HP`;
    hpList.appendChild(li);
  }

  const resultsContainer = container.querySelector(".mini-rpg-results");
  resultsContainer.innerHTML = "";
  state.stageResults.forEach((res, idx) => {
    const entry = document.createElement("div");
    entry.className = "mini-rpg-result";
    const stageIndex = MINI_RPG_STAGES.findIndex(s => s.id === res.stageId);
    const stageLabel = stageIndex >= 0 ? describeStage(MINI_RPG_STAGES[stageIndex], stageIndex) : res.stageId;
    const turnText = res.rounds || res.turns ? ` — ${res.rounds || 0} rounds / ${res.turns || 0} turns` : "";
    entry.innerHTML = `<strong>${idx + 1}. ${stageLabel}</strong> — ${res.outcome}${turnText}`;

    if (res.damageByFighter) {
      const damageLine = document.createElement("div");
      const parts = state.partyIds
        .map(pid => {
          const fighter = GAME.fighters[pid];
          const name = fighter ? fighter.name : pid;
          const dmg = res.damageByFighter[pid] || 0;
          return `${name}: ${dmg} dmg`;
        })
        .filter(Boolean)
        .join(" • ");
      damageLine.textContent = parts;
      damageLine.className = "mini-rpg-result-damage";
      entry.appendChild(damageLine);
    }

    const logDetails = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Battle log";
    logDetails.appendChild(summary);
    const pre = document.createElement("pre");
    pre.textContent = res.log || "(no log)";
    logDetails.appendChild(pre);
    entry.appendChild(logDetails);

    resultsContainer.appendChild(entry);
  });

  renderStageProgress(container, state);
  renderRunSummary(container, state);
}

function renderStageProgress(container, state) {
  const wrapper = container.querySelector(".mini-rpg-stage-progress");
  if (!wrapper) return;
  wrapper.innerHTML = "";

  MINI_RPG_STAGES.forEach((stage, idx) => {
    const chip = document.createElement("div");
    chip.className = "stage-chip";
    if (stage.type === "boss") chip.classList.add("boss");

    const result = state.stageResults.find(r => r.stageId === stage.id);
    if (result?.outcome === "cleared") chip.classList.add("cleared");
    else if (result?.outcome === "failed") chip.classList.add("failed");
    else if (idx === state.currentStageIndex && state.status === "in progress") chip.classList.add("active");

    chip.textContent = describeStage(stage, idx);
    wrapper.appendChild(chip);
  });
}

function renderRunSummary(container, state) {
  const summaryBox = container.querySelector(".mini-rpg-summary");
  if (!summaryBox) return;
  summaryBox.innerHTML = "";

  if (state.status === "not started") {
    summaryBox.textContent = "Start a run to see your results.";
    return;
  }

  if (state.status === "in progress") {
    summaryBox.textContent = "Run in progress…";
    return;
  }

  const cleared = state.stageResults.filter(r => r.outcome === "cleared").length;
  const finalStage = MINI_RPG_STAGES[MINI_RPG_STAGES.length - 1];
  const finalBossBeaten = state.stageResults.some(
    r => r.stageId === finalStage.id && r.outcome === "cleared"
  );
  const totals = state.runStats || { totalTurns: 0, totalRounds: 0, damageByParty: {} };

  const headline = document.createElement("p");
  headline.textContent = `Stages cleared: ${cleared} / ${MINI_RPG_STAGES.length}`;
  summaryBox.appendChild(headline);

  const bossLine = document.createElement("p");
  bossLine.textContent = `Final boss defeated: ${finalBossBeaten ? "Yes" : "No"}`;
  summaryBox.appendChild(bossLine);

  const turnLine = document.createElement("p");
  turnLine.textContent = `Total rounds: ${totals.totalRounds || 0} | Total turns taken: ${totals.totalTurns || 0}`;
  summaryBox.appendChild(turnLine);

  const dmgHeader = document.createElement("p");
  dmgHeader.textContent = "Damage dealt by your party:";
  summaryBox.appendChild(dmgHeader);

  const dmgList = document.createElement("ul");
  for (const pid of state.partyIds) {
    const li = document.createElement("li");
    const fighter = GAME.fighters[pid];
    const name = fighter ? fighter.name : pid;
    const dmg = totals.damageByParty?.[pid] || 0;
    li.textContent = `${name}: ${dmg}`;
    dmgList.appendChild(li);
  }
  summaryBox.appendChild(dmgList);
}

function buildSelectors(container) {
  const slotIds = ["slot1", "slot2", "slot3"];
  const playable = GAME.fighterOrder.filter(isPlayableFighter);
  for (const slot of slotIds) {
    const select = container.querySelector(`#${slot}`);
    select.innerHTML = '<option value="">-- choose fighter --</option>';
    for (const fid of playable) {
      select.insertAdjacentHTML("beforeend", buildOption(fid));
    }
  }

  // NEW: update ability UI when a slot changes
  container.querySelector("#slot1")?.addEventListener("change", () =>
    renderSlotAbilityUI(container, 1)
  );
  container.querySelector("#slot2")?.addEventListener("change", () =>
    renderSlotAbilityUI(container, 2)
  );
  container.querySelector("#slot3")?.addEventListener("change", () =>
    renderSlotAbilityUI(container, 3)
  );
}


function getSelectedParty(container) {
  const ids = [
    container.querySelector("#slot1").value,
    container.querySelector("#slot2").value,
    container.querySelector("#slot3").value
  ];
  return ids.filter(Boolean);
}

function wireButtons(container) {
  const startButton = container.querySelector(".mini-rpg-start");
  const autoButton = container.querySelector(".mini-rpg-auto");
  const nextButton = container.querySelector(".mini-rpg-next");
  const restartButton = container.querySelector(".mini-rpg-restart");
  const changePartyButton = container.querySelector(".mini-rpg-change-party");
  const statusBox = container.querySelector(".mini-rpg-status");

  const ensurePartySelected = () => {
    const party = getSelectedParty(container);
    if (party.length !== 3) {
      statusBox.textContent = "Status: pick exactly three fighters";
      return null;
    }
    return party;
  };

  const startRun = auto => {
    const party = ensurePartySelected();
    if (!party) return;
    const loadouts = buildPartyLoadouts(party);
    MiniRPG.setPartyLoadouts(loadouts);
    MiniRPG.startRun(party, { auto, battleOptions: { trackStats: true, log: true } });
    const updatedState = MiniRPG.getState();
    renderStatus(container, updatedState);
    renderRankUpPanel(container, updatedState);
  };


  startButton?.addEventListener("click", () => startRun(false));
  autoButton?.addEventListener("click", () => startRun(true));

  nextButton?.addEventListener("click", () => {
    const state = MiniRPG.getState();
    if (state.status !== "in progress") {
      statusBox.textContent = "Status: start a run before advancing.";
      return;
    }
    const result = MiniRPG.runNextStage({ battleOptions: { trackStats: true, log: true } });
    renderStatus(container, result.state);
	renderRankUpPanel(container, result.state);
  });

  restartButton?.addEventListener("click", () => {
    const state = MiniRPG.getState();
    const party = state.partyIds.length === 3 ? state.partyIds : ensurePartySelected();
    if (!party) return;
    const loadouts = buildPartyLoadouts(party);
    MiniRPG.setPartyLoadouts(loadouts);
    MiniRPG.startRun(party, { auto: false, battleOptions: { trackStats: true, log: true } });
    const updatedState = MiniRPG.getState();
    renderStatus(container, updatedState);
    renderRankUpPanel(container, updatedState);
  });


  changePartyButton?.addEventListener("click", () => {
    MiniRPG.reset();
    statusBox.textContent = "Status: not started";
    renderStatus(container, MiniRPG.getState());
  });
}

export function initMiniRPGUI(container) {
  if (!container) return;
  buildSelectors(container);
  wireButtons(container);

  const state = MiniRPG.getState();
  renderStatus(container, state);
  renderRankUpPanel(container, state);
}
