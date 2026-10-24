// Shared by every page. Load order: supabase-js, config.js, common.js, then
// sec.js (SEC pages) or nfl.js (NFL pages), then the page's own script.

const supabaseClient = window.supabase.createClient(SITE.supabase.url, SITE.supabase.key);

// ---- Show settings from config.js ----

// Color overrides apply right away so the page never shows the defaults.
Object.entries(SITE.colors || {}).forEach(([name, value]) => document.documentElement.style.setProperty(name, value));

if (SITE.analytics) {
  const counter = document.createElement("script");
  counter.async = true;
  counter.src = "//gc.zgo.at/count.js";
  counter.dataset.goatcounter = SITE.analytics;
  document.head.appendChild(counter);
}

// ---- Site menu: SEC Football, NFL and SEC Hoops ----
// A bar pinned to the top of every page, with the current section lit up.
// Each section's picks pages count as that section.
// SEC Football is the main site, so it sits in the middle and a bit bigger.
const SITE_SECTIONS = [
  { label: "NFL", href: "nflindex.html", match: p => /^nfl/i.test(p) },
  { label: "SEC Football", href: "index.html", main: true, match: p => !/^(nfl|hoops)/i.test(p) },
  { label: "SEC Hoops", href: "hoopsindex.html", match: p => /^hoops/i.test(p) }
];

function addSiteMenu() {
  const container = document.querySelector(".container");
  if (!container || document.querySelector(".site-nav")) return;
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Sections");
  nav.innerHTML = SITE_SECTIONS.map(s =>
    `<a href="${s.href}" class="${s.main ? "main" : ""} ${s.match(page) ? "active" : ""}"${s.match(page) ? ' aria-current="page"' : ""}>${s.label}</a>`).join("");
  container.prepend(nav);
  addAccountBar(nav);
}

// Inside the pinned menu, under its buttons: who's signed in (with their
// team logo for this section and any weekly titles), or a Sign in link. The
// sign-in page has its own, so it's left off there.
let signedInAccount;  // undefined until checked, then the account or null

function addAccountBar(nav) {
  if (/^signin/i.test(location.pathname.split("/").pop() || "")) return;
  const bar = document.createElement("div");
  bar.className = "account-bar";
  bar.id = "accountBar";
  nav.appendChild(bar);
  currentAccount().then(account => {
    signedInAccount = account;
    renderAccountBar();
  });
}

function renderAccountBar() {
  const bar = document.getElementById("accountBar");
  if (!bar || signedInAccount === undefined) return;
  const account = signedInAccount;
  if (account && account.name) {
    const logo = favoriteLogoHtml(account.favorites);
    bar.innerHTML = `<a href="account.html" class="account-name" title="Your account">${logo}<strong>${escapeHtml(account.name)}</strong></a>${championChipsHtml(account.name)} · <button type="button" class="account-link" onclick="signOut(thisPage())">Sign out</button>`;
  } else if (account) {
    bar.innerHTML = `<button type="button" class="account-link" onclick="location.href = signInUrl()">Choose your name</button>`;
  } else {
    bar.innerHTML = `<button type="button" class="account-link" onclick="location.href = signInUrl()">Sign in</button>`;
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addSiteMenu);
else addSiteMenu();

// ---- Accounts ----
// Signing in keeps you signed in on this device. Each account claims one
// name (on signin.html), and picks are saved under it.

// The page to come back to after signing in.
const thisPage = () => (location.pathname.split("/").pop() || "index.html") + location.search;
const signInUrl = next => `signin.html?next=${encodeURIComponent(next || thisPage())}`;

// { user, name, favorites } when signed in (name is null until one is
// claimed), or null.
async function currentAccount() {
  try {
    const { data } = await supabaseClient.auth.getSession();
    const user = data && data.session && data.session.user;
    if (!user) return null;
    const { data: profile } = await supabaseClient.from("profiles").select("display_name, favorites").eq("user_id", user.id).maybeSingle();
    return { user, name: profile ? profile.display_name : null, favorites: (profile && profile.favorites) || {} };
  } catch (err) {
    console.error("Account check failed:", err);
    return null;
  }
}

// For pages that need an account with a name: sends everyone else to sign in.
async function requireAccount() {
  const account = await currentAccount();
  if (!account || !account.name) {
    location.replace(signInUrl());
    return null;
  }
  try { localStorage.setItem("secPickEmUserName", account.name); } catch (e) {}
  return account;
}

async function signOut(next) {
  await supabaseClient.auth.signOut();
  location.href = next || "index.html";
}

// Who to message about account trouble.
const accountHelpHtml = () => SITE.discord
  ? `Can't sign in, or someone has your name? <a href="${SITE.discord}" target="_blank" rel="noopener">DM ${SITE.accountHelp || "us"} on Discord</a>.`
  : "";

// On a picks page: the name box shows the account's name and can't be changed.
function showAccountName(account) {
  const input = document.getElementById("userNameInput");
  if (input) {
    input.value = account.name;
    input.readOnly = true;
  }
  const reminder = document.querySelector(".name-reminder");
  if (reminder) {
    reminder.innerHTML = `Picking as <strong>${account.name}</strong> · <a href="#" onclick="signOut('${thisPage()}'); return false;">Sign out</a><br>${accountHelpHtml()}`;
  }
}

// ---- Player badges: favorite team logo and weekly titles ----

const escapeHtml = text => String(text ?? "").replace(/[&<>"']/g, ch =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// Which sport's favorite to show: the section this page belongs to.
const pageSport = () => {
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  return /^nfl/.test(page) ? "nfl" : /^hoops/.test(page) ? "hoops" : "cfb";
};

// Filled on leaderboard pages: favorites by name, and the weeks each name won.
let playerFavorites = {};   // lower-case name -> { cfb, nfl, hoops }
let weeklyChampions = {};   // lower-case name -> [week numbers]
let championsByWeek = {};   // week -> [names]

function favoriteLogoHtml(favorites) {
  const team = favorites && favorites[pageSport()];
  if (!team || !team.logo) return "";
  return `<img class="fav-logo" src="${escapeHtml(team.logo)}" alt="${escapeHtml(team.name)}" title="${escapeHtml(team.name)}" />`;
}

// One trophy and a count of weeks won; the weeks show on tap-and-hold
// and in the card's Season So Far box.
function championChipsHtml(name) {
  const weeks = weeklyChampions[(name || "").toLowerCase()] || [];
  if (!weeks.length) return "";
  return `<span class="champ-chip" title="Week ${weeks.join(", ")} champion">&#127942;&times;${weeks.length}</span>`;
}

// Every week won, spelled out, for the Season So Far box on a card.
function championWeeksHtml(name) {
  const weeks = weeklyChampions[(name || "").toLowerCase()] || [];
  return weeks.length ? `<div>&#127942; Champion weeks: ${weeks.map(w => `W${w}`).join(", ")}</div>` : "";
}

// Logo and titles after a player's name on a card or in the standings.
const playerBadgesHtml = name => favoriteLogoHtml(playerFavorites[(name || "").toLowerCase()]) + championChipsHtml(name);

async function loadPlayerFavorites() {
  try {
    const { data } = await supabaseClient.from("profiles").select("display_name, favorites");
    playerFavorites = {};
    (data || []).forEach(p => { playerFavorites[(p.display_name || "").toLowerCase()] = p.favorites || {}; });
  } catch (err) {
    console.error("Favorites load failed:", err);
  }
}

// A finished week's champions: every listener tied for the most correct
// picks that week, the same as #1 in that week's list.
function computeWeeklyChampions() {
  weeklyChampions = {};
  championsByWeek = {};
  const weeks = new Set(allWeekRows.map(r => r.week_number));
  weeks.forEach(w => {
    if (w >= CURRENT_OPEN_WEEK) return;
    const rows = allWeekRows.filter(r => !r.is_host && r.week_number === w)
      .map(r => ({ name: r.user_name, correct: gradePicks(r.picks, w).correct }));
    const best = Math.max(0, ...rows.map(r => r.correct));
    if (best === 0) return;
    championsByWeek[w] = rows.filter(r => r.correct === best).map(r => r.name).sort((a, b) => a.localeCompare(b));
    championsByWeek[w].forEach(n => (weeklyChampions[n.toLowerCase()] ||= []).push(w));
  });
  Object.values(weeklyChampions).forEach(list => list.sort((a, b) => a - b));
}

// Under the weekly picks heading: that week's champions once it's over,
// or last week's while this one is still being played.
function renderChampionLine(weekNum) {
  const pill = document.getElementById("entryPill");
  const bar = pill && pill.closest(".section-title-bar");
  if (!bar) return;
  let line = document.getElementById("weekChampionLine");
  if (!line) {
    line = document.createElement("div");
    line.id = "weekChampionLine";
    line.className = "champion-line";
    bar.after(line);
  }
  const week = championsByWeek[weekNum] ? weekNum : (weekNum === CURRENT_OPEN_WEEK && championsByWeek[weekNum - 1] ? weekNum - 1 : null);
  if (!week) {
    line.style.display = "none";
    return;
  }
  const names = championsByWeek[week];
  const shown = names.length > 6 ? `${names.slice(0, 6).map(escapeHtml).join(", ")} and ${names.length - 6} more` : names.map(escapeHtml).join(", ");
  line.innerHTML = `&#127942; <strong>Week ${week} ${names.length > 1 ? "Champions" : "Champion"}:</strong> ${shown}`;
  line.style.display = "";
}

const hostKey = name => name.toLowerCase();
const possessive = word => word.endsWith("s") ? `${word}'` : `${word}'s`;

// "Mike, Shane, or Steven"
function hostListText() {
  const h = SITE.hosts;
  return h.length < 3 ? h.join(" or ") : `${h.slice(0, -1).join(", ")}, or ${h[h.length - 1]}`;
}

// Fills {name}-style placeholders with the show's settings.
function siteText(template) {
  const values = {
    name: SITE.name,
    headline: SITE.headline,
    logo: SITE.logo,
    website: SITE.website.url,
    websiteLabel: SITE.website.label,
    discord: SITE.discord,
    contact: SITE.contact,
    one: SITE.players.one,
    many: SITE.players.many,
    oneLower: SITE.players.one.toLowerCase(),
    manyLower: SITE.players.many.toLowerCase(),
    lastHost: SITE.hosts[SITE.hosts.length - 1],
    hostList: hostListText()
  };
  return template.replace(/\{(\w+)\}/g, (m, key) => values[key] !== undefined ? values[key] : m);
}

// Page markup marks its show-specific bits:
//   data-site-text="..."   text, e.g. "{many}"
//   data-site-html="..."   HTML, e.g. "{contact}"
//   data-site-attr="href:{website}; alt:{name}"
function applySiteSettings(root = document) {
  root.querySelectorAll("[data-site-text]").forEach(el => { el.textContent = siteText(el.dataset.siteText); });
  root.querySelectorAll("[data-site-html]").forEach(el => { el.innerHTML = siteText(el.dataset.siteHtml); });
  root.querySelectorAll("[data-site-attr]").forEach(el => {
    el.dataset.siteAttr.split(";").forEach(pair => {
      const i = pair.indexOf(":");
      if (i > 0) el.setAttribute(pair.slice(0, i).trim(), siteText(pair.slice(i + 1).trim()));
    });
  });
}
document.addEventListener("DOMContentLoaded", () => applySiteSettings());

// Keys in a saved picks object that aren't picks.
const NON_PICK_KEYS = ["lock_game_id", "lock_matchup_key", "scores"];

const crudeName = s => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

// "City, ST" for a game's venue, or "".
function venueText(comp) {
  return (comp.venue && comp.venue.address)
    ? `${comp.venue.address.city || ""}${comp.venue.address.state ? ", " + comp.venue.address.state : ""}`
    : "";
}

function setStatus(color, text) {
  const statusAlert = document.getElementById("statusAlert");
  statusAlert.style.color = color;
  statusAlert.textContent = text;
}

// ---- Season data (leaderboard pages) ----

let activeWeek = 1;
let CURRENT_OPEN_WEEK = 2;
let allWeekRows = [];
const gameWinners = {};   // week -> { matchupKey or game id: winning team }
const weekSchedules = {}; // week -> games
const liveGames = {};     // week -> { matchupKey or game id: true }
const espnRawCache = {};  // week -> { data, currentTime }, fetched once per load

// A week's scoreboard plus ESPN's server time, which decides the current week.
async function fetchEspnRaw(week) {
  if (espnRawCache[week]) return espnRawCache[week];
  try {
    const res = await fetch(scoreboardUrl(week));
    const serverDateHeader = res.headers.get("date");
    const currentTime = serverDateHeader ? new Date(serverDateHeader) : new Date();
    const data = await res.json();
    return (espnRawCache[week] = { data, currentTime });
  } catch (err) {
    console.error(`ESPN fetch failed for week ${week}:`, err);
    return { data: null, currentTime: new Date() };
  }
}

// Midnight starting the first day after `date` that falls on `weekday`
// (0 = Sunday); with no weekday, simply the next day.
function nextDayStart(date, weekday) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  do {
    d.setDate(d.getDate() + 1);
  } while (weekday !== undefined && d.getDay() !== weekday);
  return d;
}

// The week in progress: from its first kickoff until transitionFor(last
// kickoff), after which the next week takes over.
async function determineActiveWeek(transitionFor) {
  let activeW = 1;
  await Promise.all(WEEK_NUMS.map(fetchEspnRaw));

  for (const w of WEEK_NUMS) {
    try {
      const { data, currentTime } = await fetchEspnRaw(w);
      if (!data || !data.events || data.events.length === 0) continue;

      const gameDates = data.events
        .map(ev => new Date(ev.competitions[0]?.date || ev.date))
        .filter(d => !isNaN(d.getTime()))
        .sort((a, b) => a - b);
      if (gameDates.length === 0) continue;

      if (currentTime >= gameDates[0]) {
        activeW = currentTime >= transitionFor(gameDates[gameDates.length - 1]) ? Math.min(w + 1, TOTAL_WEEKS) : w;
      }
    } catch (e) {
      console.error(`Error calculating active week for week ${w}:`, e);
    }
  }

  return activeW;
}

// Records each game's winner and live status, numbers the games 1..n in
// kickoff order, and stores the week.
function storeWeek(week, games) {
  if (!gameWinners[week]) gameWinners[week] = {};
  if (!liveGames[week]) liveGames[week] = {};
  games.sort((a, b) => a.kickoff - b.kickoff);
  games.forEach((g, idx) => {
    g.id = idx + 1;
    if (g.winner) {
      gameWinners[week][g.id] = g.winner;
      gameWinners[week][g.matchupKey] = g.winner;
    }
    if (g.isLive) {
      liveGames[week][g.matchupKey] = true;
      liveGames[week][g.id] = true;
    }
  });
  return (weekSchedules[week] = games);
}

const winnerOf = (week, game) => (gameWinners[week] || {})[game.matchupKey] || (gameWinners[week] || {})[game.id];

function parseUserPicks(rawPicks) {
  if (!rawPicks) return {};
  if (typeof rawPicks === "object") return rawPicks;
  try { return JSON.parse(rawPicks); } catch (e) { return {}; }
}

// Finds a person's pick for a game. Picks are keyed by ESPN event id;
// older entries may use a team-name key or game number instead.
function getMatchedUserPick(picks, game) {
  if (!picks || !game) return null;
  if (picks[game.matchupKey]) return picks[game.matchupKey];

  const legacyKey = buildMatchupKey(game.teamA, game.teamB);
  if (picks[legacyKey]) return picks[legacyKey];

  const aNorm = normalizeTeam(game.teamA);
  const bNorm = normalizeTeam(game.teamB);
  const isThisGame = val => {
    const n = normalizeTeam(val);
    return n === aNorm || n === bNorm;
  };

  const direct = picks[game.id] || picks[String(game.id)];
  if (direct && typeof direct === "string" && isThisGame(direct)) return direct;

  const matchKey = Object.keys(picks).find(k =>
    !NON_PICK_KEYS.includes(k) && picks[k] && typeof picks[k] === "string" && isThisGame(picks[k]));
  return matchKey ? picks[matchKey] : null;
}

// Lock keys may be an ESPN event id, an older team-name key, or a game number.
function isLockMatch(picks, game) {
  if (!picks || !game) return false;
  const lockKey = picks.lock_matchup_key || null;
  const lockId = picks.lock_game_id ? parseInt(picks.lock_game_id, 10) : null;
  if (lockKey && (lockKey === game.matchupKey || lockKey === buildMatchupKey(game.teamA, game.teamB))) return true;
  return !!(lockId && lockId === game.id);
}

// A game with no pick (it had started before they submitted) counts as
// pending, not a loss.
function gradePicks(rawPicks, week) {
  const picks = parseUserPicks(rawPicks);
  let correct = 0, incorrect = 0, pending = 0;
  let lockCorrect = 0, lockIncorrect = 0;

  (weekSchedules[week] || []).forEach(game => {
    const winner = winnerOf(week, game);
    const userPick = getMatchedUserPick(picks, game);
    if (!winner || !userPick) {
      pending++;
      return;
    }
    const isLockGame = isLockWeek(week) && isLockMatch(picks, game);
    const uNorm = normalizeTeam(userPick);
    if (uNorm && uNorm === normalizeTeam(winner)) {
      correct++;
      if (isLockGame) lockCorrect++;
    } else {
      incorrect++;
      if (isLockGame) lockIncorrect++;
    }
  });

  return { correct, incorrect, pending, lockCorrect, lockIncorrect };
}

function getPickClass(userPick, game, week) {
  const winner = winnerOf(week, game);
  if (!winner || !userPick || userPick === "-") return "pick-pending";
  return normalizeTeam(userPick) === normalizeTeam(winner) ? "pick-correct" : "pick-incorrect";
}

// A listener's pick on a game that kicked off more than 15 minutes before
// they submitted doesn't count. The page won't offer those games, but this
// catches entries sent around it. The database stamps each entry's time.
const LATE_PICK_GRACE_MS = 15 * 60 * 1000;

function dropLatePicks(row) {
  if (row.is_host || !row.created_at) return;
  const at = new Date(row.created_at).getTime();
  if (isNaN(at)) return;
  const picks = { ...parseUserPicks(row.picks) };
  let changed = false;
  (weekSchedules[row.week_number] || []).forEach(game => {
    const kick = game.kickoff instanceof Date ? game.kickoff.getTime() : NaN;
    if (isNaN(kick) || game.kickoff.getFullYear() >= 9999 || at - kick <= LATE_PICK_GRACE_MS) return;
    if (isLockMatch(picks, game)) { delete picks.lock_matchup_key; delete picks.lock_game_id; changed = true; }
    let pick;
    while ((pick = getMatchedUserPick(picks, game))) {
      const key = Object.keys(picks).find(k => !NON_PICK_KEYS.includes(k) && picks[k] === pick);
      if (!key) break;
      delete picks[key];
      changed = true;
    }
  });
  if (changed) row.picks = picks;
}

// Every row, keeping only each person's first entry for a week.
async function loadAllSeasonData() {
  try {
    const { data: rows, error } = await supabaseClient
      .from(PICKS_TABLE)
      .select("*")
      .order("created_at", { ascending: true })
      .limit(5000);
    if (error) throw error;

    const seen = new Set();
    allWeekRows = (rows || []).filter(r => {
      const key = `${r.user_name?.toLowerCase().trim()}_w${r.week_number}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const uniqueWeeks = Array.from(
      new Set(allWeekRows.map(r => r.week_number).concat([1, activeWeek]))
    ).filter(w => w >= 1 && w <= TOTAL_WEEKS);
    await Promise.all([...uniqueWeeks.map(fetchEspnSchedule), loadPlayerFavorites()]);
    allWeekRows.forEach(dropLatePicks);
    computeWeeklyChampions();
    renderAccountBar();

    computeSeasonTotals();
    await switchWeek(activeWeek);
  } catch (err) {
    console.error("Season load error:", err);
  }
}

// Scores load once per visit; refresh the page for new ones.
async function startLeaderboard(transitionFor) {
  activeWeek = await determineActiveWeek(transitionFor);
  CURRENT_OPEN_WEEK = activeWeek;
  await Promise.all(WEEK_NUMS.map(fetchEspnSchedule));
  await loadAllSeasonData();
}

function changeWeekOffset(delta) {
  switchWeek(Math.min(Math.max(activeWeek + delta, 1), TOTAL_WEEKS));
}

// Show the "Submit Week N Picks" button only for the current week. Picks
// stay open all week; games that have started lock on their own.
function updateSubmitButton(weekNum, page) {
  renderChampionLine(weekNum);
  const ctaBtn = document.getElementById("ctaBtn");
  if (weekNum === CURRENT_OPEN_WEEK) {
    ctaBtn.style.display = "flex";
    ctaBtn.innerHTML = `<span>Submit Week ${weekNum} Picks &rarr;</span>`;
    ctaBtn.href = `${page}?week=${weekNum}`;
    // Signed out: sign in first, then on to the picks.
    supabaseClient.auth.getSession().then(({ data }) => {
      if (data && data.session) return;
      ctaBtn.innerHTML = `<span>Sign In &amp; Submit Week ${weekNum} Picks &rarr;</span>`;
      ctaBtn.href = signInUrl(`${page}?week=${weekNum}`);
    }).catch(() => {});
  } else {
    ctaBtn.style.display = "none";
  }
}

// Season podium: most correct picks, then fewest losses. An identical record
// is a shared spot, shown as a tie. totals: [{ user_name, correct, incorrect }].
function renderPodium(totals, anyDecidedGames, { namesOpen, noun }) {
  const top5Container = document.getElementById("top5CousinsList");
  const decisionLog = document.getElementById("tiebreakerDecisionLog");

  if (!anyDecidedGames || totals.length === 0) {
    top5Container.innerHTML = `<div class="top3-pending">${anyDecidedGames ? "No Picks Submitted Yet" : "Pending Week 1 Results"}</div>`;
    if (decisionLog) decisionLog.style.display = "none";
    return;
  }

  const recordGroups = {};
  totals.forEach(c => {
    const key = `${c.correct}-${c.incorrect}`;
    if (!recordGroups[key]) recordGroups[key] = { correct: c.correct, incorrect: c.incorrect, members: [] };
    recordGroups[key].members.push(c);
  });

  const podiumTiers = Object.values(recordGroups)
    .sort((a, b) => (b.correct - a.correct) || (a.incorrect - b.incorrect))
    .slice(0, 3);

  const podiumRankClasses = ["rank-gold", "rank-silver", "rank-bronze"];
  const namesGrid = (members, gridId) => {
    const sorted = [...members].sort((a, b) => a.user_name.localeCompare(b.user_name));
    return `<div class="tier-names-grid${namesOpen ? " open" : ""}" id="${gridId}">${sorted.map(m => `<span>${m.user_name}${playerBadgesHtml(m.user_name)}</span>`).join("")}</div>`;
  };

  top5Container.innerHTML = podiumTiers.map((tier, idx) => {
    const isTie = tier.members.length > 1;
    const rep = tier.members[0];
    const label = isTie ? `${tier.members.length}-way tie` : rep.user_name;
    const gridId = `tierNames_${idx}`;
    return `
      <div class="top3-item" style="flex-direction: column; align-items: stretch;">
        <div class="tier-header ${isTie ? 'expandable' : ''}" ${isTie ? `onclick="toggleTierExpand('${gridId}')"` : ''}>
          <div style="display: flex; align-items: center;">
            <span class="rank-badge ${podiumRankClasses[idx]}" style="width: 22px; height: 22px; font-size: 0.7rem; margin-right: 0.4rem;">${idx + 1}</span>
            <strong>${label}</strong>${isTie ? "" : playerBadgesHtml(rep.user_name)}
          </div>
          <div style="display: flex; align-items: center;">
            <span style="font-weight: 800; color: var(--accent-gold);">${rep.correct}-${rep.incorrect}</span>
            ${isTie ? `<span class="tier-toggle-arrow">${namesOpen ? "&minus;" : "+"}</span>` : ''}
          </div>
        </div>
        ${isTie ? namesGrid(tier.members, gridId) : ''}
      </div>
    `;
  }).join("");

  if (decisionLog) {
    const placeLabels = ["1st Place", "2nd Place", "3rd Place"];
    const decisions = podiumTiers.map((tier, idx) => {
      const recordStr = `${tier.correct}-${tier.incorrect}`;
      const text = tier.members.length === 1
        ? `${tier.members[0].user_name} at ${recordStr} — nobody else shares that record.`
        : `${tier.members.length} ${noun} share the ${recordStr} record.`;
      return `<div class="tiebreaker-decision-item"><strong>${placeLabels[idx]}:</strong> ${text}</div>`;
    });

    decisionLog.innerHTML = `
      <div style="font-weight: 800; color: var(--text-main); margin-bottom: 0.2rem;">Current Podium:</div>
      ${decisions.join("")}
    `;
    decisionLog.style.display = "block";
  }
}

// Weekly ranks on already-sorted rows: everyone on the same number of wins
// shares a rank, with no gaps. "-" until a game is decided.
function assignWeeklyRanks(rows) {
  const uniqueWeeklyWins = Array.from(new Set(rows.map(c => c.score.correct))).sort((a, b) => b - a);
  const gamesHaveStarted = rows.some(c => c.score.correct > 0 || c.score.incorrect > 0);
  const rankClasses = ["", "rank-gold", "rank-silver", "rank-bronze"];
  rows.forEach(c => {
    c.rank = gamesHaveStarted ? uniqueWeeklyWins.indexOf(c.score.correct) + 1 : "-";
    c.rankClass = gamesHaveStarted ? (rankClasses[c.rank] || "") : "";
  });
}

function toggleTieBreakers() {
  const infoBox = document.getElementById("tiebreakersInfo");
  const arrow = document.getElementById("tiebreakerArrow");
  if (!infoBox) return;
  const isOpen = infoBox.classList.toggle("open");
  if (arrow) arrow.innerHTML = isOpen ? "&#9652;" : "&#9662;";
}

function toggleAllCards(expand) {
  document.querySelectorAll(".cousin-picks-body").forEach(b => b.classList.toggle("open", expand));
}

// ---- Pick submission pages ----

// Every distinct name used before, so returning players can pick their exact spelling.
async function loadKnownNames(query) {
  try {
    const { data, error } = await query;
    if (error || !data) return [];

    const seen = new Set();
    const names = [];
    data.forEach(row => {
      const trimmed = (row.user_name || "").trim();
      const key = trimmed.toLowerCase();
      if (trimmed && !seen.has(key)) {
        seen.add(key);
        names.push(trimmed);
      }
    });
    return names.sort((a, b) => a.localeCompare(b));
  } catch (err) {
    console.error("Could not load known names:", err);
    return [];
  }
}

// Name suggestions under the name box. matches(name, query) decides which show.
function setupNameAutocomplete(getNames, matches) {
  const input = document.getElementById("userNameInput");
  const box = document.getElementById("nameSuggestions");
  if (!input || !box) return;

  const closeBox = () => { box.classList.remove("open"); box.innerHTML = ""; };

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    const found = query ? getNames().filter(n => matches(n.toLowerCase(), query)).slice(0, 6) : [];
    if (found.length === 0) return closeBox();
    box.innerHTML = found.map(n => `<div class="name-suggestion-item">${n}</div>`).join("");
    box.classList.add("open");
  });

  box.addEventListener("click", (e) => {
    const item = e.target.closest(".name-suggestion-item");
    if (!item) return;
    input.value = item.textContent;
    closeBox();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".name-input-wrapper")) box.classList.remove("open");
  });
}

// Highlights the picked side of a game; isSideA(buttonA) says whether it's A.
function markPick(matchupKey, isSideA) {
  const btnA = document.getElementById(`btn_${matchupKey}_A`);
  const btnB = document.getElementById(`btn_${matchupKey}_B`);
  if (btnA && btnB) {
    const isA = isSideA(btnA);
    btnA.classList.toggle("selected", isA);
    btnB.classList.toggle("selected", !isA);
  }
}

// Shows which game (if any) is the Lock of the Week.
function refreshLockButtons(games, lockKey, offLabel) {
  games.forEach(g => {
    const card = document.getElementById(`card_${g.matchupKey}`);
    const lockBtn = document.getElementById(`lock_btn_${g.matchupKey}`);
    if (!card || !lockBtn) return;
    const on = lockKey === g.matchupKey;
    card.classList.toggle("is-locked", on);
    lockBtn.classList.toggle("active", on);
    lockBtn.textContent = on ? "★ Lock Selected" : offLabel;
  });
}

function resetSubmitButton() {
  const submitBtn = document.getElementById("submitBtn");
  submitBtn.disabled = false;
  submitBtn.textContent = "Submit Ballot";
}
