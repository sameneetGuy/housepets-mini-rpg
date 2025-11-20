// js/ui/mini_rpg_ui.js
import { GAME } from "../core/state.js";
import { MiniRPG, MINI_RPG_STAGES } from "../modes/mini_rpg.js";

function buildOption(fid) {
  const fighter = GAME.fighters[fid];
  const label = fighter ? `${fighter.name} (${fid})` : fid;
  return `<option value="${fid}">${label}</option>`;
}

function renderStatus(container, state) {
  const cleared = state.stageResults.filter(r => r.outcome === "cleared").length;
  const currentStage = MINI_RPG_STAGES[state.currentStageIndex];

  container.querySelector(".mini-rpg-status").textContent = `Status: ${state.status}`;
  container.querySelector(".mini-rpg-progress").textContent = `Stages cleared: ${cleared} / ${MINI_RPG_STAGES.length}`;
  container.querySelector(".mini-rpg-stage").textContent =
    currentStage && state.status === "in progress"
      ? `Current stage: ${currentStage.id} (${currentStage.type === "boss" ? currentStage.bossId : currentStage.enemyTeamId})`
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
    entry.innerHTML = `<strong>${idx + 1}. ${res.stageId}</strong> vs ${res.enemy} — ${res.outcome}`;

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
  const button = container.querySelector(".mini-rpg-start");
  const statusBox = container.querySelector(".mini-rpg-status");

  button.addEventListener("click", () => {
    const party = getSelectedParty(container);
    if (party.length !== 3) {
      statusBox.textContent = "Status: pick exactly three fighters";
      return;
    }

    MiniRPG.startRun(party, { auto: true });
    renderStatus(container, MiniRPG.getState());
  });
}

export function initMiniRPGUI(container) {
  if (!container) return;
  buildSelectors(container);
  wireButtons(container);
  renderStatus(container, MiniRPG.getState());
}
