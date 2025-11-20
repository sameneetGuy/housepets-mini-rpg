// js/core/loader.js

import { GAME } from "./state.js";

const SUPPORTED_SAVE_OUTCOMES = new Set(["negate", "reduced", "half"]);

/**
 * Load fighters from fighters.json and normalize their data a bit.
 * Returns a Promise that resolves when loading is complete.
 */
export async function loadFighters() {
  let response;
  const fightersUrl = new URL("../../fighters.json", import.meta.url);
  try {
    response = await fetch(fightersUrl);
  } catch (err) {
    throw new Error(`Unable to reach fighters.json (${fightersUrl}): ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to load fighters.json from ${fightersUrl}: ${response.status}`);
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    throw new Error(`Invalid fighters.json: ${err.message}`);
  }

  // Store raw fighters
  GAME.fighters = json;

  // Stable order of fighters (by id)
  GAME.fighterOrder = Object.keys(json);

  // Normalize fighter fields
  for (const fid of GAME.fighterOrder) {
    const f = GAME.fighters[fid];

    // Ensure title stats exist (for multi-season tracking)
    f.leagueTitles = f.leagueTitles || 0;
    f.cupTitles = f.cupTitles || 0;
    f.superCupTitles = f.superCupTitles || 0;

    // Ensure maxHP exists (should already be in fighters.json)
    if (typeof f.maxHP !== "number") {
      f.maxHP = 30;
    }

    // Normalize abilities a bit (rank + placeholders)
    if (Array.isArray(f.abilities)) {
      for (const ability of f.abilities) {
        // Default rank = 1 if not specified
        if (ability.rank == null) {
          ability.rank = 1;
        }

        if (ability.save && ability.save.onSave) {
          const onSave = ability.save.onSave;
          if (!SUPPORTED_SAVE_OUTCOMES.has(onSave)) {
            console.warn(
              `Ability ${ability.id || ability.name || "<unknown>"} of fighter ${fid} declares unsupported onSave="${onSave}".`
            );
          }
        }

        // In the future, you might add:
        // - currentXP
        // - maxRank
        // For now we only guarantee rank exists.
      }
    } else {
      // Safety: ensure abilities is always an array
      f.abilities = [];
    }
  }
}
