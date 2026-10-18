// March Madness bracket: reads the men's NCAA tournament from ESPN, builds
// the 63-game bracket, scores entries and draws brackets. Loads after
// config.js and common.js.

const BRACKET_TABLE = "brackets";
const ROUND_POINTS = [0, 10, 20, 40, 80, 160, 320];
const ROUND_NAMES = ["First Four", "Round of 64", "Round of 32", "Sweet 16", "Elite 8", "Final Four", "Championship"];
const ROUND_SHORT = ["FF", "R64", "R32", "S16", "E8", "F4", "Title"];

// Seed matchups in bracket order, top to bottom, within every region.
const SEED_ORDER = [[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]];
const seedSlot = seed => SEED_ORDER.findIndex(pair => pair.includes(seed));

// Pick keys: "East-1-0" is the East's first Round of 64 game, "East-4-0" its
// Elite 8 game, "FF-0" and "FF-1" the semifinals, "CH" the title game.
const slotKey = (region, round, index) => `${region}-${round}-${index}`;
const TOTAL_PICKS = 63;

// ---- Reading the tournament from ESPN ----

function headlineParts(text) {
  const parts = (text || "").split(" - ").map(s => s.trim());
  const last = (parts[parts.length - 1] || "").toLowerCase();
  let round = null;
  if (/first four|opening round/.test(last)) round = 0;
  else if (/1st round|first round|round of 64/.test(last)) round = 1;
  else if (/2nd round|second round|round of 32/.test(last)) round = 2;
  else if (/sweet/.test(last)) round = 3;
  else if (/elite/.test(last)) round = 4;
  else if (/final four|semifinal/.test(last)) round = 5;
  else if (/championship/.test(last)) round = 6;
  const regionPart = parts.find(p => /region/i.test(p));
  return { round, region: regionPart ? regionPart.replace(/\s*region\s*/i, "").trim() : null };
}

// ESPN's lighter "header" feed lists each day's games with seeds. One request
// per day across the tournament window; a day that fails is skipped.
async function fetchTournamentGames(season) {
  const days = [];
  for (let d = new Date(Date.UTC(season, 2, 12)); d <= new Date(Date.UTC(season, 3, 10)); d = new Date(d.getTime() + 86400000)) {
    days.push(d.toISOString().slice(0, 10).replace(/-/g, ""));
  }
  const results = await Promise.all(days.map(async day => {
    try {
      const res = await fetch(`https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=basketball&league=mens-college-basketball&groups=100&limit=100&dates=${day}`);
      if (!res.ok) return [];
      const data = await res.json();
      return ((data.sports || [])[0]?.leagues || [])[0]?.events || [];
    } catch (e) {
      return [];
    }
  }));
  const seen = new Set();
  return results.flat().filter(ev => ev && !seen.has(ev.id) && seen.add(ev.id));
}

function readGame(ev) {
  const noteText = typeof ev.note === "string" ? ev.note
    : (ev.note && (ev.note.headline || ev.note.text)) || ((ev.notes || [])[0] || {}).headline || "";
  const { round, region } = headlineParts(noteText);
  const state = (ev.fullStatus && ev.fullStatus.type && ev.fullStatus.type.state) || (typeof ev.status === "string" ? ev.status : "") || "pre";
  const teams = (ev.competitors || []).map(c => ({
    id: String(c.id),
    name: c.location || c.displayName || c.name || c.abbreviation || "TBD",
    abbr: c.abbreviation || "",
    logo: c.logo || "",
    seed: parseInt((c.tournamentMatchup && c.tournamentMatchup.seed) || (c.curatedRank && c.curatedRank.current) || c.rank, 10) || null,
    score: c.score !== undefined && c.score !== "" ? parseInt(c.score, 10) : null,
    winner: c.winner === true,
    tbd: !c.id || /tbd/i.test(c.displayName || c.location || "")
  }));
  return { id: String(ev.id), date: new Date(ev.date), round, region, state, teams, done: teams.some(t => t.winner) };
}

// The whole bracket: teams, the 63 pick slots, results so far and when
// picking locks (first Round of 64 tip).
async function loadTournament(season) {
  const games = (await fetchTournamentGames(season)).map(readGame).filter(g => g.round !== null);
  const T = {
    season, games, teams: {}, regions: [], slots: {}, results: {}, slotGames: {},
    playIns: {}, eliminated: new Set(), lockTime: null, finalTotal: null, ready: false
  };
  if (!games.some(g => g.round === 1)) return T;

  // Teams and their regions come from the First Four and Round of 64.
  games.filter(g => g.round <= 1 && g.region).forEach(g => g.teams.forEach(t => {
    if (t.tbd) return;
    T.teams[t.id] = { id: t.id, name: t.name, abbr: t.abbr, logo: t.logo, seed: t.seed, region: g.region };
  }));
  games.filter(g => g.round >= 2).forEach(g => g.teams.forEach(t => {
    if (!t.tbd && !T.teams[t.id]) T.teams[t.id] = { id: t.id, name: t.name, abbr: t.abbr, logo: t.logo, seed: t.seed, region: g.region };
  }));
  games.forEach(g => g.teams.forEach(t => { if (g.done && !t.winner && !t.tbd) T.eliminated.add(t.id); }));

  // Regions, ordered so the two that meet in each semifinal sit together.
  const regionNames = [...new Set(games.filter(g => g.round >= 1 && g.round <= 4 && g.region).map(g => g.region))];
  const regionOf = id => T.teams[id] && T.teams[id].region;
  let pairs = null;
  const semis = games.filter(g => g.round === 5 && g.teams.every(t => !t.tbd && regionOf(t.id)));
  const configured = Array.isArray(SITE.bracketFinalFour) && SITE.bracketFinalFour.length === 2 &&
    SITE.bracketFinalFour.flat().every(r => regionNames.includes(r));
  // The setting wins so semifinal picks keep their meaning all tournament.
  if (configured) pairs = SITE.bracketFinalFour;
  else if (semis.length === 2) pairs = semis.map(g => g.teams.map(t => regionOf(t.id)).sort()).sort();
  else pairs = [regionNames.slice(0, 2), regionNames.slice(2, 4)];
  T.pairsKnown = semis.length === 2 || configured;
  T.regions = pairs.flat();
  T.pairs = pairs;

  // First Four: two teams share one Round of 64 spot until it's played.
  games.filter(g => g.round === 0 && g.region).forEach(g => {
    const seed = g.teams[0].seed;
    const key = `${g.region}-${seed}`;
    const winner = g.teams.find(t => t.winner);
    T.playIns[key] = { id: `pi:${key}`, region: g.region, seed, teams: g.teams.map(t => t.id), winner: winner ? winner.id : null, date: g.date };
  });

  // The Round of 64 field, slot by slot.
  T.regions.forEach(region => {
    SEED_ORDER.forEach((pair, i) => {
      const entrants = pair.map(seed => {
        const pi = T.playIns[`${region}-${seed}`];
        if (pi) return pi.winner || pi.id;
        const team = Object.values(T.teams).find(t => t.region === region && t.seed === seed && !Object.values(T.playIns).some(p => p.teams.includes(t.id)));
        return team ? team.id : null;
      });
      T.slots[slotKey(region, 1, i)] = { key: slotKey(region, 1, i), round: 1, region, index: i, entrants };
    });
    for (let round = 2; round <= 4; round++) {
      const count = 8 >> (round - 1);
      for (let i = 0; i < count; i++) {
        T.slots[slotKey(region, round, i)] = {
          key: slotKey(region, round, i), round, region, index: i,
          feeders: [slotKey(region, round - 1, i * 2), slotKey(region, round - 1, i * 2 + 1)]
        };
      }
    }
  });
  T.pairs.forEach((pair, i) => {
    T.slots[`FF-${i}`] = { key: `FF-${i}`, round: 5, index: i, feeders: pair.map(r => slotKey(r, 4, 0)) };
  });
  T.slots.CH = { key: "CH", round: 6, index: 0, feeders: ["FF-0", "FF-1"] };

  // Each real game, matched to its slot by region, round and seed.
  games.filter(g => g.round >= 1).forEach(g => {
    const known = g.teams.find(t => !t.tbd && T.teams[t.id]);
    if (!known) return;
    const team = T.teams[known.id];
    let key;
    if (g.round <= 4) {
      const pos = seedSlot(team.seed);
      if (pos < 0) return;
      key = slotKey(g.region || team.region, g.round, pos >> (g.round - 1));
    } else if (g.round === 5) {
      const i = T.pairs.findIndex(p => p.includes(team.region));
      if (i < 0) return;
      key = `FF-${i}`;
    } else {
      key = "CH";
    }
    T.slotGames[key] = g;
    const winner = g.teams.find(t => t.winner);
    if (winner) T.results[key] = winner.id;
    if (g.round === 6 && g.done) T.finalTotal = g.teams.reduce((sum, t) => sum + (t.score || 0), 0);
  });

  const firstRound = games.filter(g => g.round === 1).map(g => g.date.getTime()).filter(n => !isNaN(n));
  T.lockTime = firstRound.length ? new Date(Math.min(...firstRound)) : null;
  T.ready = true;
  return T;
}

// A play-in spot counts as whoever wins it.
function resolveEntrant(T, id) {
  if (id && id.startsWith("pi:")) {
    const pi = T.playIns[id.slice(3)];
    return pi && pi.winner ? pi.winner : id;
  }
  return id;
}

function entrantInfo(T, id) {
  if (!id) return null;
  if (id.startsWith("pi:")) {
    const pi = T.playIns[id.slice(3)];
    if (!pi) return null;
    if (pi.winner) return T.teams[pi.winner];
    const [a, b] = pi.teams.map(t => T.teams[t]);
    return { id, seed: pi.seed, name: `${a ? a.abbr || a.name : "TBD"} / ${b ? b.abbr || b.name : "TBD"}`, logo: "", playIn: true };
  }
  return T.teams[id] || null;
}

// The two teams that could be in a slot, given a set of picks (or results).
function slotEntrants(T, key, picks) {
  const slot = T.slots[key];
  if (!slot) return [null, null];
  if (slot.round === 1) return slot.entrants;
  return slot.feeders.map(f => picks[f] || null);
}

function isLocked(T, now = new Date()) {
  return !!(T.lockTime && now >= T.lockTime);
}

// Points, the most still possible, and correct picks per round.
function scoreBracket(T, picks) {
  const perRound = [0, 0, 0, 0, 0, 0, 0];
  let points = 0, max = 0;
  Object.values(T.slots).forEach(slot => {
    const pick = resolveEntrant(T, picks[slot.key]);
    if (!pick) return;
    const actual = T.results[slot.key];
    const value = ROUND_POINTS[slot.round];
    if (actual) {
      if (actual === pick) { points += value; max += value; perRound[slot.round]++; }
    } else if (!T.eliminated.has(pick)) {
      max += value;
    }
  });
  return { points, max, perRound };
}

// "correct", "wrong" (picked team lost here or earlier) or "" while pending.
function pickStatus(T, key, pickId) {
  const pick = resolveEntrant(T, pickId);
  const actual = T.results[key];
  if (actual) return actual === pick ? "correct" : "wrong";
  return pick && T.eliminated.has(pick) ? "wrong" : "";
}

function tournamentStage(T) {
  if (!T.ready) return "Brackets open after Selection Sunday.";
  if (T.results.CH) {
    const champ = T.teams[T.results.CH];
    return `Final: ${champ ? champ.name : ""} won the title.`;
  }
  const live = T.games.find(g => g.state === "in");
  const next = T.games.filter(g => !g.done).sort((a, b) => a.date - b.date)[0];
  const current = live || next;
  if (current) return `${ROUND_NAMES[current.round]}${live ? " in progress" : " up next"}`;
  const lastRound = Math.max(...T.games.filter(g => g.done).map(g => g.round));
  return lastRound < 6 ? `${ROUND_NAMES[lastRound + 1]} up next` : "";
}

// ---- Drawing ----

function teamChip(T, id, { status = "", seedFirst = true } = {}) {
  const t = entrantInfo(T, id);
  if (!t) return `<span class="bk-team empty">TBD</span>`;
  return `<span class="bk-team ${status}">
    ${t.logo ? `<img src="${t.logo}" alt="" onerror="this.style.display='none'">` : `<span class="bk-logo-blank"></span>`}
    ${seedFirst && t.seed ? `<span class="bk-seed">${t.seed}</span>` : ""}
    <span class="bk-name">${t.name}</span>
  </span>`;
}

// Region tabs (plus Final Four) above one round-by-round column per tab.
// renderTab(container, tabName) draws a tab's contents.
function bracketTabsHtml(T, idPrefix) {
  const tabs = [...T.regions, "Final Four"];
  return `<div class="details-tabs bk-tabs" id="${idPrefix}Tabs">
    ${tabs.map(t => `<button type="button" class="details-tab" data-tab="${t}">${t === "Final Four" ? "Final 4" : t}</button>`).join("")}
  </div>
  <div id="${idPrefix}Body"></div>`;
}

function wireBracketTabs(idPrefix, renderTab, startTab) {
  const tabsEl = document.getElementById(`${idPrefix}Tabs`);
  const select = name => {
    tabsEl.querySelectorAll(".details-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
    renderTab(document.getElementById(`${idPrefix}Body`), name);
  };
  tabsEl.addEventListener("click", e => {
    const b = e.target.closest(".details-tab");
    if (b) select(b.dataset.tab);
  });
  select(startTab || tabsEl.querySelector(".details-tab").dataset.tab);
  return select;
}

// Slot keys shown on a tab, grouped by round.
function tabRounds(T, tab) {
  if (tab === "Final Four") return [[5, ["FF-0", "FF-1"]], [6, ["CH"]]];
  return [1, 2, 3, 4].map(round => [round, Array.from({ length: 8 >> (round - 1) }, (_, i) => slotKey(tab, round, i))]);
}

// Read-only view of one entry: each pick, marked right or wrong. With
// plain set (the real results), nothing is marked.
function renderEntryTab(T, picks, container, tab, plain = false) {
  container.innerHTML = tabRounds(T, tab).map(([round, keys]) => `
    <div class="bk-round">
      <div class="bk-round-title">${ROUND_NAMES[round]} <span>${ROUND_POINTS[round]} pts each</span></div>
      <div class="bk-pick-list">
        ${keys.map(key => {
          const status = plain ? "" : pickStatus(T, key, picks[key]);
          const actual = T.results[key];
          const missed = status === "wrong" && actual ? `<span class="bk-actual">${teamChip(T, actual)}</span>` : "";
          return `<div class="bk-pick-row">${teamChip(T, picks[key], { status })}${missed}</div>`;
        }).join("")}
      </div>
    </div>`).join("");
}
