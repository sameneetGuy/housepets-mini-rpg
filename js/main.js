// js/main.js
import { loadFighters } from "./core/loader.js";
import { initMiniRPGUI } from "./ui/mini_rpg_ui.js";

async function bootstrap() {
  const panel = document.getElementById("mini-rpg-panel");
  try {
    await loadFighters();
    initMiniRPGUI(panel);
  } catch (err) {
    if (panel) {
      const status = panel.querySelector(".mini-rpg-status");
      if (status) {
        status.textContent = `Failed to load fighters: ${err.message}`;
      }
    }
    console.error(err);
  }
}

bootstrap();
