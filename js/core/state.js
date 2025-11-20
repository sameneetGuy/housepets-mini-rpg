// js/core/state.js

export const GAME = {
  // All fighters loaded from fighters.json
  fighters: {},

  // Stable order of fighter ids (useful for tables / loops)
  fighterOrder: [],

  // Teams participating in the league (12 teams, 3 fighters each)
  teams: [],

  // League (round robin)
  league: {
    schedule: [],   // array of league days, each with matches
    day: 0,         // current day index
    finished: false // has the league ended this season?
  },

  // Playoffs (knockout for league title)
  playoffs: {
    matches: [],        // current round matches
    round: 0,           // round index (0 = QF, etc.)
    finished: false,    // has the cup ended this season?
    winnerTeamIndex: null // index of cup winner team in GAME.teams
  },

  // Cup (seeded knockout)
  cup: {
    matches: [],        // current round matches
    round: 0,           // round index (0 = QF, etc.)
    finished: false,    // has the cup ended this season?
    winnerTeamIndex: null // index of cup winner team in GAME.teams
  },

  // Super Cup (single match between League and Cup winners)
  supercup: null,   // will hold { aIdx, bIdx, played }

  // Season tracking
  seasonNumber: 1,
  seasonComplete: false,

  // Seasonal meta trend (e.g., AoE-friendly, defensive)
  metaTrend: null,
  metaHistory: [],

  // Global day count (for calendar)
  dayNumber: 1,

  // Calendar entries: each day we push { day, phase, shortLabel, log, matches }
  calendar: [],

  // Latest log text (for convenience)
  log: ""
};
