// SEC men's basketball pages (hoopsindex, hoopsmakepicks): team names, ESPN
// feeds, and the Top 25 / SEC Standings / team schedule popups. Loads after
// common.js. Same as sec.js for football, with basketball feeds and weeks.

// A pick'em week runs Monday through Sunday, starting with the season's
// opening Monday. Week 19 is the SEC Tournament, ending the Sunday of the
// final (also Selection Sunday). Weeks 20-22 are the NCAA Tournament, every
// game, the way the football pages add the Playoff: the First and Second
// Rounds (with the Opening Round), the Sweet 16 and Elite 8, then the Final
// Four, whose week runs through the Monday title game.
// ESPN calls the 2026-27 season "2027". Requests ask for the regular season
// (seasontype=2) explicitly; otherwise, during ESPN's preseason, team
// schedules come back empty.
const HOOPS_SEASON = 2027;
const HOOPS_FIRST_MONDAY = new Date(2026, 10, 2); // Mon Nov 2, 2026
const TOTAL_WEEKS = 22;
const NCAA_FIRST_WEEK = 20;
const isNcaaWeek = w => w >= NCAA_FIRST_WEEK;
const WEEK_NAMES = { 19: "SEC Tournament", 20: "NCAA First & Second Rounds", 21: "NCAA Sweet 16 & Elite 8", 22: "NCAA Final Four" };
const WEEK_SHORT = { 19: "SECT", 20: "NCAA R1-2", 21: "S16-E8", 22: "Final Four" };
const WEEK_NUMS = Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1);
const PICKS_TABLE = "hoops_picks";

const ESPN_HOOPS = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";

// Monday 12:00 AM through the end of Sunday for a week, in local time.
function weekRange(week) {
  const start = new Date(HOOPS_FIRST_MONDAY);
  start.setDate(start.getDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + (week === TOTAL_WEEKS ? 7 : 6));  // the title game is a Monday
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

// Every game with an SEC team (group 23) that week, conference or not. In
// NCAA Tournament weeks, every Division I game (group 50), trimmed to the
// tournament below. From the SEC Tournament on, ESPN's postseason
// (seasontype 3) is asked too, in case it files those games there.
const seasonTypesFor = week => (week >= 19 ? [2, 3] : [2]);
const scoreboardUrls = (week, group) => {
  const { start, end } = weekRange(week);
  const g = group || (isNcaaWeek(week) ? 50 : 23);
  return seasonTypesFor(week).map(t => `${ESPN_HOOPS}/scoreboard?groups=${g}&seasontype=${t}&dates=${ymd(start)}-${ymd(end)}&limit=1000`);
};
const scoreboardUrl = week => scoreboardUrls(week)[0];

// The NCAA Tournament's own games, not the NIT or other postseason events.
// ESPN labels them "Men's Basketball Championship - Region - Round".
const eventHeadline = ev => {
  const comp = ev && ev.competitions && ev.competitions[0];
  return (comp && comp.notes && comp.notes[0] && comp.notes[0].headline) || "";
};
const isNcaaTournamentGame = ev => /men's basketball championship|ncaa (men's )?tournament/i.test(eventHeadline(ev));

// Fetches each URL and merges the games, one copy of each. Returns the
// first response's clock time, or null when nothing came back.
async function fetchMergedScoreboards(urls) {
  const byId = {};
  let currentTime = null, any = false;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      any = true;
      if (!currentTime) { const h = res.headers.get("date"); currentTime = h ? new Date(h) : new Date(); }
      (data.events || []).forEach(ev => { if (ev && ev.id) byId[ev.id] = ev; });
    } catch (err) {
      console.error("ESPN scoreboard failed:", url, err);
    }
  }
  return any ? { events: Object.values(byId), currentTime } : null;
}

// ESPN's scoreboard can refuse weeks it hasn't opened yet, even though each
// team's schedule already lists the games. So a week whose scoreboard fails
// or comes back empty is built from the 16 SEC teams' schedules instead
// (fetched once, same team ids as football). This replaces common.js's
// fetchEspnRaw on the hoops pages.
const SEC_TEAM_IDS = ["333", "8", "2", "57", "61", "96", "99", "145", "344", "142", "201", "2579", "2633", "251", "245", "238"];
let secSchedulesPromise = null;

function loadSecSchedules() {
  if (!secSchedulesPromise) {
    secSchedulesPromise = Promise.all(SEC_TEAM_IDS.map(id =>
      fetch(`${ESPN_HOOPS}/teams/${id}/schedule?season=${HOOPS_SEASON}&seasontype=2`)
        .then(res => res.ok ? res.json().then(data => ({ data, date: res.headers.get("date") })) : null)
        .catch(() => null)
    )).then(results => {
      const byId = {};
      let date = null;
      results.forEach(r => {
        if (!r) return;
        if (r.date && !date) date = r.date;
        (r.data.events || []).forEach(ev => { if (ev && ev.id) byId[ev.id] = ev; });
      });
      return { events: Object.values(byId), currentTime: date ? new Date(date) : new Date() };
    });
  }
  return secSchedulesPromise;
}

// Schedule events give scores as { value, displayValue }; the pages expect
// the scoreboard's plain "72".
function scheduleEventAsScoreboard(ev) {
  const comp = (ev.competitions || [])[0] || {};
  return {
    ...ev,
    competitions: [{
      ...comp,
      competitors: (comp.competitors || []).map(c => ({
        ...c,
        score: c.score && typeof c.score === "object" ? String(c.score.displayValue ?? c.score.value ?? "") : c.score
      }))
    }]
  };
}

// Tournament games whose other team isn't decided yet ("TBD", "Winner of
// ...") stay hidden until ESPN fills in both teams. Then they show up and
// can be picked.
const isRealTeam = c => {
  const t = c && c.team;
  if (!t || !t.id || Number(t.id) <= 0) return false;
  const name = `${t.displayName || ""} ${t.shortDisplayName || ""} ${t.name || ""}`;
  return !/\b(tbd|tba|to be determined|winner|loser)\b/i.test(name);
};
const bothTeamsSet = ev => {
  const comp = ev && ev.competitions && ev.competitions[0];
  return !!(comp && comp.competitors && comp.competitors.length === 2 && comp.competitors.every(isRealTeam));
};

async function fetchEspnRaw(week) {
  if (espnRawCache[week]) return espnRawCache[week];
  const got = await fetchMergedScoreboards(scoreboardUrls(week));
  if (got) {
    let events = got.events.filter(bothTeamsSet);
    if (isNcaaWeek(week)) events = events.filter(isNcaaTournamentGame);
    if (events.length) return (espnRawCache[week] = { data: { events }, currentTime: got.currentTime });
  }
  // The SEC teams' schedules only cover the regular season, so NCAA weeks
  // have nothing to fall back on.
  if (isNcaaWeek(week)) return { data: { events: [] }, currentTime: (got && got.currentTime) || new Date() };
  try {
    const { events, currentTime } = await loadSecSchedules();
    const { start, end } = weekRange(week);
    const inWeek = events
      .filter(ev => { const d = new Date(ev.date); return d >= start && d <= end; })
      .map(scheduleEventAsScoreboard)
      .filter(bothTeamsSet);
    return (espnRawCache[week] = { data: { events: inWeek }, currentTime });
  } catch (err) {
    console.error(`ESPN schedules failed for week ${week}:`, err);
    return { data: null, currentTime: new Date() };
  }
}

// The week a date falls in, or null outside the season.
function weekOfDate(d) {
  for (const w of WEEK_NUMS) {
    const { start, end } = weekRange(w);
    if (d >= start && d <= end) return w;
  }
  return null;
}

// Lock of the Week counts every week.
const isLockWeek = () => true;

// Every spelling ESPN might use for each SEC team. Matching is exact, so
// "Texas State" or "Florida State" never count as SEC. Pages can add more
// spellings with addSecAliases().
const secNameCanonical = {};
const secNormalizedNames = new Set();

function addSecAliases(aliases) {
  Object.entries(aliases).forEach(([canonicalKey, variants]) => {
    variants.forEach(variant => {
      secNameCanonical[crudeName(variant)] = canonicalKey;
      secNormalizedNames.add(normalizeTeam(variant));
    });
  });
}

function cleanTeamName(name) {
  if (!name) return "";
  const lower = name.toLowerCase().trim();
  if (lower.includes("pine bluff") || lower === "uapb" || lower.includes("peanut")) {
    return "Arkansas Peanut Butter (Pine Bluff)";
  }
  return name;
}

function normalizeTeam(str) {
  if (!str) return "";
  const cleaned = crudeName(cleanTeamName(str));
  if (cleaned.includes("peanut") || cleaned.includes("pinebluff") || cleaned.includes("uapb")) return "uapb";
  if (cleaned === "razorbacks" || cleaned === "ark") return "arkansas";
  return secNameCanonical[cleaned] || cleaned;
}

addSecAliases({
  alabama: ["Alabama"],
  arkansas: ["Arkansas"],
  auburn: ["Auburn"],
  florida: ["Florida"],
  georgia: ["Georgia"],
  kentucky: ["Kentucky"],
  lsu: ["LSU"],
  olemiss: ["Ole Miss"],
  mississippistate: ["Mississippi State", "Mississippi St", "Miss State", "Miss St"],
  missouri: ["Missouri", "Mizzou"],
  oklahoma: ["Oklahoma"],
  southcarolina: ["South Carolina"],
  tennessee: ["Tennessee"],
  texas: ["Texas"],
  texasam: ["Texas A&M", "Texas AM"],
  vanderbilt: ["Vanderbilt", "Vandy"]
});
addSecAliases({
  alabama: ["Bama"],
  georgia: ["UGA"],
  texasam: ["A&M"],
  kentucky: ["UK"],
  oklahoma: ["OU"],
  tennessee: ["Tenn"]
});

function isSecTeam(teamName) {
  return !!teamName && secNormalizedNames.has(normalizeTeam(teamName));
}

function buildMatchupKey(teamA, teamB) {
  return `${normalizeTeam(teamA)}_vs_${normalizeTeam(teamB)}`;
}

// Display only; picks and grading always use the full name.
function shortenPickDisplay(pick) {
  const canonical = normalizeTeam(pick);
  if (canonical === "southcarolina") return "S Carolina";
  if (canonical === "mississippistate") return "Miss State";
  if (canonical === "texasam") return "TAMU";
  return pick;
}

function teamLogoFrom(t) {
  if (!t) return "";
  return t.logo || (t.logos && t.logos[0] && t.logos[0].href) || "";
}

// ---- Top 25, SEC Standings and team schedule popups ----
// Read straight from ESPN; on bad or missing data the popup says so.

const infoCache = {};
const teamScheduleCache = {};

// Page setting for the team schedule popup: currentWeek() is the week to
// highlight.
const scheduleOptions = { currentWeek: () => null };

function closeInfoModal() {
  const overlay = document.getElementById("infoOverlay");
  if (overlay) overlay.style.display = "none";
}

function closeTeamSchedule() {
  const overlay = document.getElementById("teamSchedOverlay");
  if (overlay) overlay.style.display = "none";
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeInfoModal();
    closeTeamSchedule();
  }
});

// Any logo or name with a data-team-id opens that team's schedule.
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-team-id]");
  if (!el || !el.dataset.teamId) return;
  openTeamSchedule(el.dataset.teamId, el.dataset.teamName, el.dataset.teamLogo);
});

function showInfoModal(title) {
  document.getElementById("infoTitle").textContent = title;
  document.querySelector("#infoOverlay .team-sched-modal").style.maxWidth = "";
  document.getElementById("infoBody").innerHTML = `<div class="team-sched-note">Loading...</div>`;
  document.getElementById("infoOverlay").style.display = "flex";
}

async function fetchFirstOk(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) {}
  }
  throw new Error("no data");
}

function infoTeamHtml(name, logo) {
  return `<span class="info-team">${logo ? `<img src="${logo}" alt="" onerror="this.style.display='none'">` : ""}<span>${name}</span></span>`;
}

// AP and Coaches polls from ESPN's rankings feed. A poll that's missing
// shows "Unavailable" in its column.
function openRankings() {
  showInfoModal("Top 25");
  document.querySelector("#infoOverlay .team-sched-modal").style.maxWidth = "560px";
  renderRankings(document.getElementById("infoBody"));
}

async function renderRankings(body) {
  const cached = (key, urls) => async () => infoCache[key] || (infoCache[key] = await fetchFirstOk(urls));
  const [pollRes] = await Promise.allSettled([
    cached("rankings", [`${ESPN_HOOPS}/rankings`])()
  ]);

  const teamName = t => t.location || t.nickname || t.shortDisplayName || t.name || t.displayName || "";
  const fromPoll = (match) => {
    if (pollRes.status !== "fulfilled") return null;
    const polls = (pollRes.value.rankings || []).filter(r => r.ranks && r.ranks.length);
    const poll = polls.find(p => match(p, `${p.name || ""} ${p.shortName || ""}`));
    if (!poll) return null;
    return poll.ranks
      .slice()
      .sort((a, b) => a.current - b.current)
      .slice(0, 25)
      .map(r => ({ name: teamName(r.team || {}), logo: teamLogoFrom(r.team) }));
  };

  // Skip any lower-division coaches polls.
  const lowerDivision = /fcs|division|div\.|\bd-?i{2,3}\b|naia/i;
  const apList = fromPoll((p, l) => p.type === "ap" || /\bAP\b/.test(l));
  const coachesList = fromPoll((p, l) => /coaches/i.test(l) && !lowerDivision.test(l));

  if (!apList && !coachesList) {
    body.innerHTML = `<div class="team-sched-note">Couldn't load the rankings right now.</div>`;
    return;
  }

  const cell = (list, i) => {
    if (!list) return i === 0 ? `<td class="top25-cell top25-missing">Unavailable</td>` : `<td class="top25-cell"></td>`;
    const t = list[i];
    if (!t) return `<td class="top25-cell"></td>`;
    return `<td class="top25-cell">
      <span class="top25-team ${isSecTeam(t.name) ? "sec" : ""}">
        ${t.logo ? `<img src="${t.logo}" alt="" onerror="this.style.display='none'">` : ""}
        <span>${shortenPickDisplay(t.name)}</span>
      </span>
    </td>`;
  };

  let rowsHtml = "";
  for (let i = 0; i < 25; i++) {
    rowsHtml += `<tr>
      <td class="top25-rank">${i + 1}</td>
      ${cell(apList, i)}${cell(coachesList, i)}
    </tr>`;
  }

  body.innerHTML = `
    <table class="top25-table">
      <thead>
        <tr><th class="top25-rank"></th><th>AP</th><th>Coaches Poll</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
}

// Finds every team entry however ESPN nests conferences or divisions.
function collectStandingsEntries(node, out) {
  if (!node || typeof node !== "object") return;
  if (node.standings && Array.isArray(node.standings.entries)) {
    node.standings.entries.forEach(e => out.push(e));
  }
  Object.values(node).forEach(v => {
    if (Array.isArray(v)) v.forEach(x => collectStandingsEntries(x, out));
    else if (v && typeof v === "object") collectStandingsEntries(v, out);
  });
}

function statDisplay(stats, matcher) {
  const st = (stats || []).find(matcher);
  if (!st) return "";
  return st.displayValue || st.summary || (st.value !== undefined ? String(st.value) : "");
}

function parseWL(str) {
  const m = /^(\d+)-(\d+)/.exec(str || "");
  return m ? { w: parseInt(m[1], 10), l: parseInt(m[2], 10) } : { w: 0, l: 0 };
}

function openStandings() {
  showInfoModal("SEC Standings");
  renderStandings(document.getElementById("infoBody"));
}

// SEC teams in standings order: conference win %, then conference wins,
// then overall wins. place is the team's spot in that list.
async function loadSecStandings() {
  if (!infoCache.standings) {
    infoCache.standings = await fetchFirstOk([
      `https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings?group=23&season=${HOOPS_SEASON}`,
      `https://site.web.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings?group=23&season=${HOOPS_SEASON}`
    ]);
  }
  const entries = [];
  collectStandingsEntries(infoCache.standings, entries);
  if (entries.length === 0) throw new Error("empty");

  const rows = entries.map(e => {
    const t = e.team || {};
    const overall = statDisplay(e.stats, s => /^overall$/i.test(s.name || s.type || ""));
    const conf = statDisplay(e.stats, s =>
      /^(vs\.?\s?conf(erence)?|conference)$/i.test(s.name || "") ||
      (/conf/i.test(s.name || s.type || "") && !/behind|pct|percent|point|win|rank/i.test(s.name || s.type || "")));
    return {
      id: t.id !== undefined ? String(t.id) : "",
      name: t.shortDisplayName || t.displayName || t.name || "",
      logo: teamLogoFrom(t),
      overall,
      conf,
      c: parseWL(conf),
      o: parseWL(overall)
    };
  });

  // Conference win %, then conference wins, then overall wins.
  const pct = r => r.c.w + r.c.l ? r.c.w / (r.c.w + r.c.l) : 0;
  rows.sort((a, b) => (pct(b) - pct(a)) || (b.c.w - a.c.w) || (b.o.w - a.o.w));
  rows.forEach((r, i) => { r.place = i + 1; });
  return rows;
}

async function renderStandings(body) {
  try {
    const rows = await loadSecStandings();

    body.innerHTML = `
      <div class="info-row standings-row head"><span></span><span>Team</span><span class="info-meta">Conf</span><span class="info-meta">Overall</span></div>
      ${rows.map(r => `
        <div class="info-row standings-row">
          <span class="info-rank">${r.place}</span>
          ${infoTeamHtml(r.name, r.logo)}
          <span class="info-meta" style="color: var(--text-main);">${r.conf || "-"}</span>
          <span class="info-meta">${r.overall || "-"}</span>
        </div>`).join("")}
    `;
  } catch (err) {
    console.error("Standings error:", err);
    body.innerHTML = `<div class="team-sched-note">Couldn't load the standings right now.</div>`;
  }
}

function schedScore(s) {
  if (s === null || s === undefined) return "";
  if (typeof s === "object") return String(s.displayValue !== undefined ? s.displayValue : (s.value !== undefined ? s.value : ""));
  return String(s);
}

// A team's full season from ESPN, scrolled to the current week.
function openTeamSchedule(teamId, teamName, teamLogo) {
  const body = document.getElementById("teamSchedBody");
  const title = document.getElementById("teamSchedTitle");
  const logo = document.getElementById("teamSchedLogo");

  title.textContent = teamName || "Team Schedule";
  if (teamLogo) {
    logo.src = teamLogo;
    logo.style.display = "block";
    logo.onerror = () => { logo.style.display = "none"; };
  } else {
    logo.style.display = "none";
  }
  document.getElementById("teamSchedOverlay").style.display = "flex";
  renderTeamSchedule(body, teamId, (record, standing) => {
    title.innerHTML = `${teamName}<small>${record}${standing ? " | " + standing : ""}</small>`;
  }, true);
}

// Fills body with a team's schedule. onRecord(record, standing) gets the
// team's record line; autoScroll centers the current week in body.
// opts.compact draws the short side-by-side version used in game details,
// with opts.eventId's row highlighted instead of the current week.
async function renderTeamSchedule(body, teamId, onRecord, autoScroll, opts = {}) {
  body.innerHTML = `<div class="team-sched-note">Loading schedule...</div>`;
  try {
    if (!teamScheduleCache[teamId]) {
      const res = await fetch(`${ESPN_HOOPS}/teams/${teamId}/schedule?season=${HOOPS_SEASON}&seasontype=2`);
      if (!res.ok) throw new Error("bad response");
      teamScheduleCache[teamId] = await res.json();
    }
    const data = teamScheduleCache[teamId];
    const events = (data.events || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    if (data.team && data.team.recordSummary && onRecord) {
      onRecord(data.team.recordSummary, data.team.standingSummary || "");
    }

    if (events.length === 0) {
      body.innerHTML = `<div class="team-sched-note">No schedule available.</div>`;
      return;
    }

    const items = events.map(ev => {
      const comp = (ev.competitions || [])[0] || {};
      const competitors = comp.competitors || [];
      const me = competitors.find(c => String((c.team && c.team.id) || c.id) === String(teamId));
      const opp = competitors.find(c => c !== me);
      const oppTeam = (opp && opp.team) || {};
      const oppName = oppTeam.shortDisplayName || oppTeam.displayName || oppTeam.name || "TBD";
      const oppLogo = teamLogoFrom(oppTeam);
      const prefix = comp.neutralSite ? "vs" : (me && me.homeAway === "away" ? "@" : "vs");

      const d = new Date(ev.date);
      const validDate = !isNaN(d.getTime());
      const dateText = validDate ? d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }) : "TBD";
      // Basketball has no ESPN weeks; each game goes in its Monday-Sunday week.
      const week = validDate ? weekOfDate(d) : null;

      const statusType = (comp.status && comp.status.type) || {};
      let resultHtml;
      if (statusType.completed === true && me && opp) {
        const won = me.winner === true;
        const lost = opp.winner === true;
        resultHtml = `<span class="team-sched-result ${won ? "win" : (lost ? "loss" : "")}">${won ? "W" : (lost ? "L" : "T")} ${schedScore(me.score)}-${schedScore(opp.score)}</span>`;
      } else if (statusType.state === "in") {
        resultHtml = `<span class="team-sched-result" style="color: var(--accent-gold);">Live</span>`;
      } else {
        resultHtml = `<span class="team-sched-result">${validDate ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span>`;
      }

      const oppShort = oppTeam.abbreviation || shortenPickDisplay(oppName);
      let miniResult;
      if (statusType.completed === true && me && opp) {
        const won = me.winner === true, lost = opp.winner === true;
        miniResult = `<b class="${won ? "win" : (lost ? "loss" : "")}">${won ? "W" : (lost ? "L" : "T")} ${schedScore(me.score)}-${schedScore(opp.score)}</b>`;
      } else if (statusType.state === "in") {
        miniResult = `<b style="color: var(--accent-gold);">Live</b>`;
      } else {
        // "12PM" or "3:30PM", to leave room for the opponent. ESPN marks
        // unset kickoffs with timeValid false (they'd read 12AM).
        const timeSet = validDate && comp.timeValid !== false && !(d.getHours() === 0 && d.getMinutes() === 0);
        miniResult = timeSet ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(/\s/g, "") : "TBD";
      }

      return {
        week,
        eventId: String(ev.id),
        sortTime: validDate ? d.getTime() : Infinity,
        mini: `<span class="d">${validDate ? `${d.getMonth() + 1}/${d.getDate()}` : ""}</span><span class="o">${prefix} ${oppShort}</span><span class="r">${miniResult}</span>`,
        html: `
          <span class="team-sched-date">${dateText}</span>
          <span class="team-sched-opp">
            ${oppLogo ? `<img src="${oppLogo}" alt="" onerror="this.style.display='none'">` : ""}
            <span>${prefix} ${oppName}</span>
          </span>
          ${resultHtml}`
      };
    });

    items.sort((a, b) => a.sortTime - b.sortTime);

    if (opts.compact) {
      body.innerHTML = items.map(it => `<div class="mini-sched-row${it.bye ? " bye" : ""}${opts.eventId && it.eventId === String(opts.eventId) ? " now" : ""}">${it.mini}</div>`).join("");
      return;
    }

    const currentWeek = scheduleOptions.currentWeek();
    body.innerHTML = items.map(it => `
      <div class="team-sched-row ${it.week !== null && it.week === currentWeek ? "current-week" : ""}">${it.html}</div>
    `).join("");

    const currentRow = autoScroll && body.querySelector(".current-week");
    if (currentRow) {
      body.scrollTop = Math.max(0, currentRow.offsetTop - body.clientHeight / 2 + currentRow.offsetHeight / 2);
    }
  } catch (err) {
    console.error("Team schedule error:", err);
    body.innerHTML = `<div class="team-sched-note">Couldn't load this schedule right now.</div>`;
  }
}

// ---- Game extras: TV network and the game details popup ----

// "CBS" or "ESPN/ESPN2" from a scoreboard competition, or "".
function tvNetwork(comp) {
  const names = [];
  (comp.broadcasts || []).forEach(b => (b.names || []).forEach(n => names.push(n)));
  if (names.length === 0) {
    (comp.geoBroadcasts || []).forEach(b => {
      const n = b.media && (b.media.shortName || b.media.name);
      if (n) names.push(n);
    });
  }
  return [...new Set(names)].slice(0, 2).join("/");
}

// The first network only, shortened to fit the grid: "SECN", "ESPN2".
function shortNetwork(comp) {
  const first = (tvNetwork(comp) || "").split("/")[0].trim();
  return first.replace(/^SEC Network\+$/i, "SECN+").replace(/^SEC Network$/i, "SECN");
}

const gameSummaryCache = {};

// Scoreboard events by id, so the details popup can show the line, TV and
// weather. Pages that fetch the scoreboard themselves call rememberEvents.
const scoreboardEvents = {};

function rememberEvents(events) {
  (events || []).forEach(ev => { if (ev && ev.id !== undefined) scoreboardEvents[String(ev.id)] = ev; });
}

function findScoreboardEvent(eventId) {
  if (scoreboardEvents[eventId]) return scoreboardEvents[eventId];
  for (const entry of Object.values(espnRawCache)) {
    const ev = ((entry && entry.data && entry.data.events) || []).find(e => String(e.id) === String(eventId));
    if (ev) return ev;
  }
  return null;
}

function detailsTeamCell(team) {
  const logo = teamLogoFrom(team);
  return `<span class="info-team">${logo ? `<img src="${logo}" alt="" onerror="this.style.display='none'">` : ""}<span>${shortenPickDisplay(team.shortDisplayName || team.displayName || team.abbreviation || "")}</span></span>`;
}

// Everything about one game: where, when and the line up top, then tabs for
// the game itself, both teams' schedules, the Top 25 and the SEC standings.
// openGameDetails shows it in the popup; renderGameDetails fills any element.
function openGameDetails(eventId, title) {
  showInfoModal(title || "Game Details");
  document.querySelector("#infoOverlay .team-sched-modal").style.maxWidth = "560px";
  renderGameDetails(document.getElementById("infoBody"), eventId);
}

async function renderGameDetails(body, eventId) {
  body.innerHTML = `<div class="team-sched-note">Loading...</div>`;

  let s = null;
  try {
    if (!gameSummaryCache[eventId]) {
      const res = await fetch(`${ESPN_HOOPS}/summary?event=${eventId}`);
      if (!res.ok) throw new Error("bad response");
      gameSummaryCache[eventId] = await res.json();
    }
    s = gameSummaryCache[eventId];
  } catch (err) {
    console.error("Game details error:", err);
  }

  const ev = findScoreboardEvent(eventId) || {};
  const sbComp = (ev.competitions && ev.competitions[0]) || {};
  const comp = (s && s.header && s.header.competitions && s.header.competitions[0]) || sbComp;
  const competitors = comp.competitors || [];
  const away = competitors.find(c => c.homeAway === "away") || competitors[0] || {};
  const home = competitors.find(c => c.homeAway === "home") || competitors[1] || {};
  const state = (comp.status && comp.status.type && comp.status.type.state) || "pre";

  // Everything shows at once: the game (or preview), then both schedules
  // side by side, each headed by its record, AP rank and SEC place.
  const sections = [];
  if (s && state !== "pre") sections.push(...gameSections(s, away, home, state, comp));
  if (s && state === "pre") sections.push(...pregameSections(s, away, home));

  const teams = [away, home].filter(c => c.team && c.team.id);
  const scheduleCol = c => {
    const t = c.team;
    // The summary lists the rank as "rank"; the scoreboard as curatedRank.
    const sbTeam = (sbComp.competitors || []).find(x => x.team && String(x.team.id) === String(t.id)) || {};
    const rank = Number((c.curatedRank && c.curatedRank.current) || c.rank || (sbTeam.curatedRank && sbTeam.curatedRank.current));
    const logo = teamLogoFrom(t);
    return `<div class="sched-col" data-team="${t.id}">
        <div class="sched-col-head">
          ${logo ? `<img src="${logo}" alt="" onerror="this.style.display='none'">` : ""}
          <div class="sched-col-lines">
            <span class="sched-rec"></span>
            <span>${rank >= 1 && rank <= 25 ? `#${rank} Nationally` : "Unranked Nationally"}</span>
            <span class="sched-place"></span>
          </div>
        </div>
        <div class="sched-mini-list"><div class="team-sched-note">Loading...</div></div>
      </div>`;
  };
  if (teams.length) sections.push(detailsSection("Schedules", `<div class="sched-pair">${teams.map(scheduleCol).join("")}</div>`));

  body.innerHTML = `
    ${gameInfoHtml(s, ev, sbComp, comp)}
    <div class="series-box">
      <div class="series-heading">Series History</div>
      <div class="series-lines"><div class="series-line">Loading...</div></div>
    </div>
    <div class="stat-ranks" style="display: none;"></div>
    ${s ? "" : `<div class="team-sched-note">Couldn't load this game's details right now.</div>`}
    ${sections.join("")}`;

  teams.forEach(c => {
    const t = c.team;
    const col = body.querySelector(`.sched-col[data-team="${t.id}"]`);
    if (!col) return;
    renderTeamSchedule(col.querySelector(".sched-mini-list"), t.id, async (record, standing) => {
      // SEC teams: overall (conference) record and their spot in the SEC
      // Standings list, so the two always match. Anyone else: ESPN's summary.
      let place = standing, conf = "";
      try {
        const names = [t.location, t.shortDisplayName, t.displayName, t.name].filter(Boolean).map(normalizeTeam);
        const row = (await loadSecStandings()).find(r => (r.id && r.id === String(t.id)) || names.includes(normalizeTeam(r.name)));
        if (row) { place = `#${row.place} SEC`; conf = row.conf; }
      } catch (e) {}
      col.querySelector(".sched-rec").textContent = `${record || ""}${conf && conf !== "-" ? ` (${conf})` : ""}`;
      col.querySelector(".sched-place").textContent = place || "";
    }, false, { compact: true, eventId });
  });
  fillHoopsSeries(body, away.team, home.team, state === "post" ? (comp.date || ev.date || "") : "");
  fillHoopsStatRanks(body, away.team, home.team);
}

// Where, when, TV and the betting line, from the summary or the scoreboard.
function gameInfoHtml(s, ev, sbComp, comp) {
  const info = (s && s.gameInfo) || {};
  const rows = [];

  const venue = info.venue || sbComp.venue || {};
  const city = venue.address ? [venue.address.city, venue.address.state].filter(Boolean).join(", ") : "";
  const where = [venue.fullName, city].filter(Boolean).join(", ");
  const date = new Date(comp.date || ev.date || sbComp.date);

  if (where) rows.push(["Where", where]);

  const when = [];
  if (!isNaN(date.getTime())) {
    when.push(date.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" }));
    when.push(date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  }
  const tv = tvNetwork(sbComp) || tvNetwork(comp);
  if (tv) when.push(tv);
  if (when.length) rows.push(["When", when.join(" · ")]);

  const pick = (s && s.pickcenter && s.pickcenter[0]) || (sbComp.odds && sbComp.odds[0]) || null;
  if (pick && (pick.details || pick.overUnder)) {
    rows.push(["Line", [pick.details, pick.overUnder ? `O/U ${pick.overUnder}` : ""].filter(Boolean).join(" · ")]);
  }

  if (!rows.length) return "";
  return `<div class="details-info">${rows.map(([k, v]) => `<div class="details-info-row"><span class="details-info-label">${k}</span><span>${v}</span></div>`).join("")}</div>`;
}

// ---- Series History and Stat Rankings, from CollegeBasketballData.com ----
// Two Supabase Edge Functions ask CBBD with the show's hidden key (the same
// one football uses) and save the answers: "hoops-series" for each matchup
// (30 days, refreshed once after the teams play) and "hoops-teamstats" for
// every team's national ranks (12 hours). CBBD's games start with the
// 2002-03 season, so the history is since then.

// The spellings to try for a team. ESPN's "location" is usually the school
// name CBBD uses ("Ole Miss", "Texas A&M"); the others are backups.
function hoopsTeamNames(t) {
  if (!t) return [];
  // "Florida Gators" minus "Gators".
  const school = t.displayName && t.name && t.displayName.endsWith(` ${t.name}`) ? t.displayName.slice(0, -t.name.length - 1) : "";
  return [...new Set([t.location, school, t.shortDisplayName].filter(Boolean))].slice(0, 4);
}

// Same as the functions' matching: "Mississippi State" and "Miss St." match.
const hoopsNorm = s => String(s || "").toLowerCase()
  .replace(/&/g, " and ").replace(/\(.*?\)/g, " ")
  .replace(/\bstate\b/g, "st").replace(/\bsaint\b/g, "st").replace(/\bmississippi\b/g, "miss")
  .replace(/[^a-z0-9]/g, "");

const hoopsSeriesCache = {};

// The SEC team goes first: it's the one CBBD is asked about, and its games
// are the ones searched for the other team.
function loadHoopsSeries(namesA, namesB, finished) {
  const secFirst = isSecTeam(namesB[0]) && !isSecTeam(namesA[0]);
  const team1 = secFirst ? namesB : namesA, team2 = secFirst ? namesA : namesB;
  const key = [team1[0], team2[0]].sort().join("|");
  if (!hoopsSeriesCache[key]) {
    hoopsSeriesCache[key] = supabaseClient.functions.invoke("hoops-series", { body: { team1, team2, finished: finished || "" } })
      .then(({ data, error }) => {
        if (error || !data || !Array.isArray(data.games)) throw error || new Error("no series data");
        return data;
      });
    hoopsSeriesCache[key].catch(() => { delete hoopsSeriesCache[key]; });
  }
  return hoopsSeriesCache[key];
}

// Team colors for the bar, from ESPN. A color too dark to see on the card
// uses the team's alternate color, and if the two teams still look alike
// the second team switches too. (Same as football's.)
const HOOPS_HEX = /^[0-9a-f]{6}$/i;
const hoopsRgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const hoopsColorGap = (c1, c2) => {
  const [x, y] = [hoopsRgb(c1), hoopsRgb(c2)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};
function hoopsBarColors(teamA, teamB) {
  const colors = t => [t && t.color, t && t.alternateColor].filter(c => c && HOOPS_HEX.test(c)).map(c => `#${c}`);
  const tooDark = c => hoopsColorGap(c, "#162032") < 75 || hoopsRgb(c).reduce((sum, v) => sum + v, 0) < 120;
  const pick = (options, avoid) => options.find(c => !tooDark(c) && !(avoid && hoopsColorGap(c, avoid) < 90));
  const a = pick(colors(teamA)) || "#60a5fa";
  const b = pick(colors(teamB), a) || (hoopsColorGap(a, "#fbbf24") < 90 ? "#f8fafc" : "#fbbf24");
  return [a, b];
}

// Win counts for the bar, the last meeting and the current streak.
function hoopsSeriesSummary(data, nameA, nameB) {
  const played = data.games.slice().sort((x, y) => new Date(x.date) - new Date(y.date));
  if (!played.length) return null;
  const winner = g => g.homeScore > g.awayScore ? g.homeTeam : g.awayTeam;
  const a = played.filter(g => winner(g) === nameA).length;
  const b = played.length - a;

  const latest = played[played.length - 1];
  const lastWinner = winner(latest);
  const hi = Math.max(latest.homeScore, latest.awayScore), lo = Math.min(latest.homeScore, latest.awayScore);
  const when = new Date(latest.date);
  const whenText = isNaN(when.getTime()) ? String(latest.season || "") : when.toLocaleDateString([], { month: "short", year: "numeric" });

  let n = 0;
  for (let i = played.length - 1; i >= 0 && winner(played[i]) === lastWinner; i--) n++;
  return {
    a, b,
    meetings: String(played.length),
    last: `${whenText} ${lastWinner} won ${hi}-${lo}`,
    streak: n > 1 ? `${lastWinner} has won ${n} straight` : `${lastWinner} won the last one`
  };
}

const HOOPS_SERIES_WAIT = 10000;

async function fillHoopsSeries(body, teamA, teamB, finished) {
  const box = body.querySelector(".series-box");
  if (!box) return;
  const namesA = hoopsTeamNames(teamA), namesB = hoopsTeamNames(teamB);
  if (!namesA.length || !namesB.length) { box.remove(); return; }
  const nameA = namesA[0], nameB = namesB[0];
  const lines = () => box.querySelector(".series-lines");
  const unavailable = () => { if (lines()) lines().innerHTML = `<div class="series-line">Series history unavailable right now.</div>`; };
  // After 10 seconds with no answer, say so instead of "Loading..." forever.
  const slow = setTimeout(() => { if (!box.querySelector(".series-bar")) unavailable(); }, HOOPS_SERIES_WAIT);
  try {
    const data = await loadHoopsSeries(namesA, namesB, finished);
    clearTimeout(slow);
    const sum = hoopsSeriesSummary(data, nameA, nameB);
    if (!sum) { lines().innerHTML = `<div class="series-line">No meetings since the 2002-03 season</div>`; return; }

    const [colorA, colorB] = hoopsBarColors(teamA, teamB);
    const total = sum.a + sum.b;
    const pct = n => `${(n / total * 100).toFixed(2)}%`;
    const logo = t => { const l = teamLogoFrom(t); return l ? `<img src="${l}" alt="" onerror="this.style.display='none'">` : ""; };
    const side = (t, wins, cls) => `<div class="series-side ${cls}">${logo(t)}<span class="series-wins">${wins}</span><span class="series-wins-label">${wins === 1 ? "Win" : "Wins"}</span></div>`;
    const line = (label, value) => `<div class="series-line"><span class="series-label">${label}:</span> ${value}</div>`;

    lines().innerHTML = `
      <div class="series-counts">
        ${side(teamA, sum.a, "left")}
        ${side(teamB, sum.b, "right")}
      </div>
      <div class="series-bar" role="img" aria-label="${nameA} ${sum.a}, ${nameB} ${sum.b}">
        <span style="width: ${pct(sum.a)}; background: ${colorA};"></span>
        <span style="width: ${pct(sum.b)}; background: ${colorB};"></span>
      </div>
      <div class="series-note">Games since the 2002-03 season.</div>
      ${line("Meetings", sum.meetings)}${line("Last", sum.last)}${line("Streak", sum.streak)}`;
  } catch (err) {
    clearTimeout(slow);
    console.error("Series error:", err);
    unavailable();
  }
}

// One row per stat, the same stat for both teams, the way football does it.
// Offense rows are light, defense rows dark.
const HOOPS_STAT_ROWS = [
  ["scoringOffense", "Scoring Offense", "off"], ["scoringDefense", "Scoring Defense", "def"],
  ["fgOffense", "FG % Offense", "off"], ["fgDefense", "FG % Defense", "def"],
  ["threeOffense", "3PT % Offense", "off"], ["threeDefense", "3PT % Defense", "def"],
  ["reboundOffense", "Rebound Offense", "off"], ["reboundDefense", "Rebound Defense", "def"],
  ["turnoverOffense", "Turnover Offense", "off"], ["turnoverDefense", "Turnover Defense", "def"]
];

// A small basketball, marking the better rank in each row. It borrows the
// football icon's size class.
const BASKETBALL_ICON = `<svg class="football-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.4" fill="#e8772e" stroke="#2a1608" stroke-width="1.2"/><path d="M1.6 12 H22.4 M12 1.6 V22.4 M5 4.6 Q9.6 12 5 19.4 M19 4.6 Q14.4 12 19 19.4" stroke="#2a1608" stroke-width="1.2" fill="none"/></svg>`;

let hoopsStatsPromise = null;

function loadHoopsStats() {
  if (!hoopsStatsPromise) {
    hoopsStatsPromise = supabaseClient.functions.invoke("hoops-teamstats", { body: { season: HOOPS_SEASON } })
      .then(({ data, error }) => {
        if (error || !data || !data.ranks) throw error || new Error("no team stats");
        // Look teams up by any spelling.
        data.byName = {};
        Object.keys(data.ranks).forEach(name => { data.byName[hoopsNorm(name)] = data.ranks[name]; });
        return data;
      });
    hoopsStatsPromise.catch(() => { hoopsStatsPromise = null; });
  }
  return hoopsStatsPromise;
}

// Stat ranks are one saved call for every team, so they load in the
// background. Series history waits for a tap, to save CBBD calls.
function preloadDetails() {
  setTimeout(() => { loadHoopsStats().catch(() => {}); }, 500);
}

async function fillHoopsStatRanks(body, teamA, teamB) {
  const box = body.querySelector(".stat-ranks");
  if (!box || !teamA || !teamB) return;
  try {
    const { byName, counts } = await loadHoopsStats();
    const ranksFor = t => { for (const n of hoopsTeamNames(t)) if (byName[hoopsNorm(n)]) return byName[hoopsNorm(n)]; return {}; };
    const a = ranksFor(teamA), b = ranksFor(teamB);
    // Top third green, middle third pale green, bottom third red.
    const tier = (rank, key) => {
      const share = rank / (counts[key] || 365);
      return share <= 1 / 3 ? "good" : share <= 2 / 3 ? "ok" : "bad";
    };
    const pill = (rank, key, end) => `<span class="stat-rank ${end} ${rank ? tier(rank, key) : "none"}">${rank ? `#${rank}` : "-"}</span>`;
    const logo = t => { const l = teamLogoFrom(t); return l ? `<img src="${l}" alt="" onerror="this.style.display='none'">` : ""; };
    const rows = HOOPS_STAT_ROWS
      .filter(([key]) => a[key] || b[key])
      .map(([key, label, side]) => {
        const ra = a[key], rb = b[key];
        const ballA = ra && (!rb || ra < rb), ballB = rb && (!ra || rb < ra);
        return `<div class="stat-rank-row ${side}">
          <span class="stat-ball">${ballA ? BASKETBALL_ICON : ""}</span>
          ${pill(ra, key, "left")}
          <span class="stat-rank-label">${label}</span>
          ${pill(rb, key, "right")}
          <span class="stat-ball">${ballB ? BASKETBALL_ICON : ""}</span>
        </div>`;
      }).join("");
    if (!rows) return;
    box.innerHTML = `
      <div class="stat-rank-row stat-rank-head">
        <span class="stat-side">${logo(teamA)}<span>Away</span></span>
        <span class="stat-rank-title">Stat Rankings</span>
        <span class="stat-side">${logo(teamB)}<span>Home</span></span>
      </div>
      ${rows}`;
    box.style.display = "";
  } catch (err) {
    console.error("Team stats error:", err);
  }
}

function ordinal(n) {
  const v = n % 100;
  return n + (v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
}

function detailsSection(title, html) {
  return `<div class="details-section"><div class="details-heading">${title}</div>${html}</div>`;
}

function pregameSections(s, away, home) {
  const out = [];

  // The last meeting is in the Series History box above.

  // Injury report: players listed as anything other than active.
  const injuries = s.injuries || [];
  if (injuries.length) {
    const rows = [away, home].map(c => {
      const entry = injuries.find(i => i.team && c.team && String(i.team.id) === String(c.team.id));
      const list = (entry && entry.injuries) || [];
      const names = list.slice(0, 8).map(p => {
        const a = p.athlete || {};
        const pos = a.position && a.position.abbreviation ? ` ${a.position.abbreviation}` : "";
        return `<div class="injury-line"><span>${a.displayName || a.shortName || "Unknown"}${pos}</span><span class="injury-status">${p.status || (p.type && p.type.description) || ""}</span></div>`;
      }).join("");
      return `<div class="details-team-block">${detailsTeamCell(c.team || {})}${names || `<div class="details-note">None reported</div>`}</div>`;
    }).join("");
    out.push(detailsSection("Injury Report", rows));
  }
  return out;
}

function gameSections(s, away, home, state, comp) {
  const out = [];

  // Score by half.
  const lines = [away, home].map(c => (c.linescores || []).map(l => l.displayValue !== undefined ? l.displayValue : l.value));
  const periods = Math.max(lines[0].length, lines[1].length);
  if (periods > 0) {
    const label = i => i < 2 ? `${i + 1}H` : (periods > 3 ? `OT${i - 1}` : "OT");
    const head = `<tr><th></th>${Array.from({ length: periods }, (_, i) => `<th>${label(i)}</th>`).join("")}<th>T</th></tr>`;
    const row = (c, l) => `<tr><td>${detailsTeamCell(c.team || {})}</td>${Array.from({ length: periods }, (_, i) => `<td>${l[i] !== undefined ? l[i] : ""}</td>`).join("")}<td class="details-total">${c.score !== undefined ? c.score : ""}</td></tr>`;
    const status = (comp && comp.status && comp.status.type && (comp.status.type.shortDetail || comp.status.type.detail)) || (state === "post" ? "Final" : "Live");
    out.push(detailsSection(status, `<table class="details-table">${head}${row(away, lines[0])}${row(home, lines[1])}</table>`));
  }

  // Key team stats, side by side.
  const teams = (s.boxscore && s.boxscore.teams) || [];
  const statsFor = c => {
    const t = teams.find(x => x.team && c.team && String(x.team.id) === String(c.team.id));
    const map = {};
    ((t && t.statistics) || []).forEach(st => { map[st.name] = st; });
    return map;
  };
  const a = statsFor(away), h = statsFor(home);
  const wanted = [
    ["fieldGoalsMade-fieldGoalsAttempted", "FG"], ["fieldGoalPct", "FG %"],
    ["threePointFieldGoalsMade-threePointFieldGoalsAttempted", "3PT"], ["threePointFieldGoalPct", "3PT %"],
    ["freeThrowsMade-freeThrowsAttempted", "FT"], ["totalRebounds", "Rebounds"],
    ["assists", "Assists"], ["turnovers", "Turnovers"], ["steals", "Steals"], ["blocks", "Blocks"]
  ];
  const statRows = wanted
    .filter(([key]) => a[key] || h[key])
    .map(([key, label]) => `<tr><td>${(a[key] && a[key].displayValue) || "-"}</td><th>${label}</th><td>${(h[key] && h[key].displayValue) || "-"}</td></tr>`)
    .join("");
  if (statRows) {
    const abbr = c => (c.team && (c.team.abbreviation || c.team.shortDisplayName)) || "";
    out.push(detailsSection("Team Stats", `<table class="details-table stats"><tr><th>${abbr(away)}</th><th></th><th>${abbr(home)}</th></tr>${statRows}</table>`));
  }

  // Win probability over the game, home team's chance as the line.
  const wp = (s.winprobability || []).map(p => p.homeWinPercentage).filter(v => typeof v === "number");
  if (wp.length > 1) {
    const W = 300, H = 80;
    const pts = wp.map((v, i) => `${(i / (wp.length - 1) * W).toFixed(1)},${((1 - v) * H).toFixed(1)}`).join(" ");
    const last = wp[wp.length - 1];
    const homeAbbr = (home.team && home.team.abbreviation) || "Home";
    const awayAbbr = (away.team && away.team.abbreviation) || "Away";
    const leader = last >= 0.5 ? `${homeAbbr} ${Math.round(last * 100)}%` : `${awayAbbr} ${Math.round((1 - last) * 100)}%`;
    out.push(detailsSection("Win Probability", `
      <div class="wp-wrap">
        <svg class="wp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Win probability">
          <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" class="wp-mid"/>
          <polyline points="${pts}" class="wp-line"/>
        </svg>
        <span class="wp-team top">${homeAbbr}</span>
        <span class="wp-team bottom">${awayAbbr}</span>
      </div>
      <div class="details-note">${state === "post" ? "At the end" : "Right now"}: ${leader}</div>`));
  }
  return out;
}

// ---- Tournaments ----
// Early-season events (Players Era, Maui, Battle 4 Atlantis...) shown as one
// card each: every game in the event by day, SEC teams in gold, games whose
// teams aren't decided yet shown as TBD. ESPN labels these games
// "Event Name - Round", which is how they're grouped. The whole event is
// pulled (not just SEC games) so the card shows the full field.
const tourneyCache = {};

// "Players Era 8 - Semifinal" -> ["Players Era 8", "Semifinal"]. ESPN's
// "Men's Basketball Championship" is shown as "NCAA Tournament".
function splitTourneyLabel(headline) {
  const parts = String(headline || "").split(/\s+-\s+/);
  const name = parts[0].trim();
  return [/men's basketball championship/i.test(name) ? "NCAA Tournament" : name, parts.slice(1).join(" - ").trim()];
}

async function loadTournaments(week) {
  if (tourneyCache[week]) return tourneyCache[week];
  return (tourneyCache[week] = (async () => {
    let events = [];
    // Division I (group 50): every game, so the whole field shows.
    const got = await fetchMergedScoreboards(scoreboardUrls(week, 50));
    if (got && got.events.length) events = got.events;
    else {
      // Fall back to the games already loaded for the week.
      try { events = ((await fetchEspnRaw(week)).data.events) || []; } catch (_) { events = []; }
    }
    if (isNcaaWeek(week)) events = events.filter(isNcaaTournamentGame);

    const byName = {};
    events.forEach(ev => {
      const comp = ev.competitions && ev.competitions[0];
      const note = comp && comp.notes && comp.notes[0] && comp.notes[0].headline;
      if (!note) return;
      const [name, round] = splitTourneyLabel(note);
      if (!name) return;
      const side = c => {
        const t = (c && c.team) || {};
        const nm = cleanTeamName(t.shortDisplayName || t.displayName || t.name || "TBD");
        const real = isRealTeam(c);
        return {
          name: real ? nm : "TBD",
          logo: real ? ((t.logos && t.logos[0] && t.logos[0].href) || t.logo || "") : "",
          score: c && c.score !== undefined && c.score !== "" ? String(c.score) : "",
          winner: !!(c && c.winner),
          sec: real && isSecTeam(nm)
        };
      };
      const cs = (comp.competitors || []);
      const away = side(cs.find(c => c.homeAway === "away") || cs[0]);
      const home = side(cs.find(c => c.homeAway === "home") || cs[1]);
      const st = (comp.status && comp.status.type) || {};
      const venue = comp.venue && comp.venue.address;
      (byName[name] ||= { name, games: [], place: "" }).games.push({
        id: String(ev.id), round, away, home,
        date: new Date(comp.date || ev.date),
        state: st.state || "pre",
        detail: st.shortDetail || ""
      });
      if (!byName[name].place && venue && venue.city) byName[name].place = [venue.city, venue.state].filter(Boolean).join(", ");
    });

    // Only events with an SEC team in them (the NCAA Tournament always
    // shows), soonest first.
    return Object.values(byName)
      .filter(t => t.name === "NCAA Tournament" || t.games.some(g => g.away.sec || g.home.sec))
      .map(t => ({ ...t, games: t.games.sort((a, b) => a.date - b.date) }))
      .sort((a, b) => a.games[0].date - b.games[0].date);
  })());
}

const tourneyDay = d => d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });
const tourneySecTeams = t => [...new Set(t.games.flatMap(g => [g.away, g.home]).filter(s => s.sec).map(s => s.name))];

function tourneyDates(t) {
  const first = t.games[0].date, last = t.games[t.games.length - 1].date;
  const md = d => d.toLocaleDateString([], { month: "short", day: "numeric" });
  return first.toDateString() === last.toDateString() ? md(first) : `${md(first)} – ${last.getDate()}`;
}

// The games of one event, grouped by day.
function tourneyBodyHtml(t) {
  const team = (s, other, done) => `
    <span class="tg-team ${s.sec ? "sec" : ""} ${s.name === "TBD" ? "tbd" : ""} ${done && s.winner ? "won" : ""}">
      ${s.logo ? `<img class="fav-logo" src="${s.logo}" alt="">` : ""}<span class="tg-name">${escapeHtml(shortenPickDisplay(s.name))}</span>
      ${s.score && done !== null ? `<span class="tg-score">${s.score}</span>` : ""}
    </span>`;
  const days = [];
  t.games.forEach(g => {
    const key = g.date.toDateString();
    const last = days[days.length - 1];
    if (last && last.key === key) last.games.push(g);
    else days.push({ key, label: tourneyDay(g.date), games: [g] });
  });
  return days.map(day => `
    <div class="tg-day">${day.label}</div>
    ${day.games.map(g => {
      const done = g.state === "post", live = g.state === "in";
      const status = done ? "Final" : live ? escapeHtml(g.detail) : g.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "");
      return `
        <div class="tg-game ${live ? "live" : ""} ${(g.away.sec || g.home.sec) ? "has-sec" : ""}">
          <div class="tg-round">${escapeHtml(g.round || "Game")}<span class="tg-status">${status}</span></div>
          <div class="tg-matchup">
            ${team(g.away, g.home, done || live ? done : null)}
            <span class="tg-vs">vs</span>
            ${team(g.home, g.away, done || live ? done : null)}
          </div>
        </div>`;
    }).join("")}`).join("");
}

// A collapsible card for the Info Hub.
function tourneyCardHtml(t, open) {
  const secs = tourneySecTeams(t);
  return `
    <details class="tourney-card" ${open ? "open" : ""}>
      <summary>
        <span class="tc-title">🏆 ${escapeHtml(t.name)}</span>
        <span class="tc-meta">${escapeHtml([t.place, tourneyDates(t)].filter(Boolean).join(" · "))}</span>
        <span class="tc-sec">${secs.map(n => escapeHtml(shortenPickDisplay(n))).join(", ")}</span>
      </summary>
      <div class="tc-body">${tourneyBodyHtml(t)}</div>
    </details>`;
}

// Fills a box with this week's tournament cards (hidden when there are none).
async function renderTournaments(week, section, list) {
  const sec = document.getElementById(section), box = document.getElementById(list);
  if (!sec || !box) return;
  const tourneys = await loadTournaments(week).catch(() => []);
  if (!tourneys.length) { sec.style.display = "none"; return; }
  box.innerHTML = tourneys.map(t => tourneyCardHtml(t, false)).join("");
  sec.style.display = "";
}

// The same card in a pop-up, from a tournament game's banner on the picks page.
async function openTournament(name, week) {
  let overlay = document.getElementById("tourneyOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "tourneyOverlay";
    overlay.className = "team-sched-overlay";
    overlay.onclick = e => { if (e.target === overlay) overlay.style.display = "none"; };
    document.body.appendChild(overlay);
  }
  const shell = (body, meta = "") => `
    <div class="team-sched-modal tourney-modal" role="dialog" aria-modal="true" aria-labelledby="tourneyTitle">
      <div class="team-sched-header">
        <div class="team-sched-title" id="tourneyTitle">🏆 ${escapeHtml(name)}${meta ? `<small>${escapeHtml(meta)}</small>` : ""}</div>
        <button type="button" class="team-sched-close" onclick="document.getElementById('tourneyOverlay').style.display='none'" aria-label="Close">&times;</button>
      </div>
      <div class="team-sched-body">${body}</div>
    </div>`;
  overlay.innerHTML = shell(`<div class="tg-empty">Loading the bracket...</div>`);
  overlay.style.display = "flex";
  const t = (await loadTournaments(week).catch(() => [])).find(x => x.name === name);
  overlay.innerHTML = t
    ? shell(tourneyBodyHtml(t), [t.place, tourneyDates(t)].filter(Boolean).join(" · "))
    : shell(`<div class="tg-empty">Couldn't load this tournament's games.</div>`);
}
