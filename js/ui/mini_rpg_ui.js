// js/ui/mini_rpg_ui.js
import { GAME } from "../core/state.js";
import { MiniRPG, MINI_RPG_STAGES, describeStage } from "../modes/mini_rpg.js";

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
  for (const slot of slotIds) {
    const select = container.querySelector(`#${slot}`);
    select.innerHTML = "<option value=\"\">-- choose fighter --</option>";
    for (const fid of GAME.fighterOrder) {
      select.insertAdjacentHTML("beforeend", buildOption(fid));
    }
  }
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
    MiniRPG.startRun(party, { auto, battleOptions: { trackStats: true, log: true } });
    renderStatus(container, MiniRPG.getState());
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
  });

  restartButton?.addEventListener("click", () => {
    const state = MiniRPG.getState();
    const party = state.partyIds.length === 3 ? state.partyIds : ensurePartySelected();
    if (!party) return;
    MiniRPG.startRun(party, { auto: false, battleOptions: { trackStats: true, log: true } });
    renderStatus(container, MiniRPG.getState());
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
  renderStatus(container, MiniRPG.getState());
}
