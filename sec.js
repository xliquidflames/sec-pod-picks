// SEC pages (index, makepicks, hostpicks): team names, ESPN feeds, and the
// Top 25 / SEC Standings / team schedule popups. Loads after common.js.

const TOTAL_WEEKS = 14;
const WEEK_NUMS = Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1);
const PICKS_TABLE = "picks";

const scoreboardUrl = week => `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=8&seasontype=2&dates=2026&week=${week}&limit=100`;

// Lock of the Week started in Week 2.
const isLockWeek = week => week !== 1;

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
  vanderbilt: ["Vanderbilt"]
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

// Page settings for the team schedule popup:
//   currentWeek()  week to highlight
//   weekWindows()  each week's date range (see index.html), or []
//   estimateByes   date a bye a week after the previous game when there's no window
const scheduleOptions = { currentWeek: () => null, weekWindows: () => [], estimateByes: true };

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

// AP and Coaches come from the rankings feed; ESPN's FPI has its own
// endpoint. A source that fails shows "Unavailable" in its column.
function openRankings() {
  showInfoModal("Top 25");
  document.querySelector("#infoOverlay .team-sched-modal").style.maxWidth = "560px";
  renderRankings(document.getElementById("infoBody"));
}

async function renderRankings(body) {
  const cached = (key, urls) => async () => infoCache[key] || (infoCache[key] = await fetchFirstOk(urls));
  const [pollRes, fpiRes] = await Promise.allSettled([
    cached("rankings", ["https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings"])(),
    cached("fpi", [
      "https://site.web.api.espn.com/apis/fitt/v3/sports/football/college-football/powerindex?season=2026&limit=200",
      "https://site.web.api.espn.com/apis/fitt/v3/sports/football/college-football/powerindex?season=2026"
    ])()
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

  // Skip the FCS / Division II / III coaches polls.
  const lowerDivision = /fcs|division|div\.|\bd-?i{2,3}\b|naia/i;
  const apList = fromPoll((p, l) => p.type === "ap" || /\bAP\b/.test(l));
  const coachesList = fromPoll((p, l) => /coaches/i.test(l) && !lowerDivision.test(l));

  let fpiList = null;
  if (fpiRes.status === "fulfilled") {
    // In each team's "fpi" category, values[1] is the FPI rank.
    const ranked = (fpiRes.value.teams || []).map(entry => {
      const cat = (entry.categories || []).find(c => c.name === "fpi");
      const rank = cat && cat.values ? parseInt(cat.values[1], 10) : NaN;
      return { rank, name: teamName(entry.team || {}), logo: teamLogoFrom(entry.team) };
    }).filter(x => !isNaN(x.rank) && x.rank >= 1);
    ranked.sort((a, b) => a.rank - b.rank);
    if (ranked.length) fpiList = ranked.slice(0, 25);
  } else {
    console.error("FPI error:", fpiRes.reason);
  }

  if (!apList && !coachesList && !fpiList) {
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
      ${cell(apList, i)}${cell(coachesList, i)}${cell(fpiList, i)}
    </tr>`;
  }

  body.innerHTML = `
    <table class="top25-table">
      <thead>
        <tr><th class="top25-rank"></th><th>AP</th><th>Coaches Poll</th><th>ESPN</th></tr>
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
      "https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=8&season=2026",
      "https://site.web.api.espn.com/apis/v2/sports/football/college-football/standings?group=8&season=2026"
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

// A team's full season from ESPN, scrolled to the current week. Byes are any
// missing week between its first and last game.
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
async function renderTeamSchedule(body, teamId, onRecord, autoScroll) {
  body.innerHTML = `<div class="team-sched-note">Loading schedule...</div>`;
  try {
    if (!teamScheduleCache[teamId]) {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${teamId}/schedule?season=2026`);
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

    // Games without an ESPN week number are placed by date.
    const windows = scheduleOptions.weekWindows();
    const DAY = 24 * 60 * 60 * 1000;
    const weekOfDate = (d) => {
      const hit = windows.find(w => d >= new Date(w.min.getTime() - 2 * DAY) && d <= new Date(w.max.getTime() + 2 * DAY));
      return hit ? hit.week : null;
    };

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
      const week = (ev.week && ev.week.number) ? ev.week.number : (validDate ? weekOfDate(d) : null);

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

      return {
        week,
        sortTime: validDate ? d.getTime() : Infinity,
        html: `
          <span class="team-sched-date">${dateText}</span>
          <span class="team-sched-opp">
            ${oppLogo ? `<img src="${oppLogo}" alt="" onerror="this.style.display='none'">` : ""}
            <span>${prefix} ${oppName}</span>
          </span>
          ${resultHtml}`
      };
    });

    const playedWeeks = items.map(it => it.week).filter(w => w !== null && w >= 1 && w <= TOTAL_WEEKS);
    if (playedWeeks.length > 0) {
      const have = new Set(playedWeeks);
      for (let w = Math.min(...playedWeeks); w <= Math.max(...playedWeeks); w++) {
        if (have.has(w)) continue;
        const win = windows.find(x => x.week === w);
        let byeDate = win ? win.modal : null;
        if (!byeDate && scheduleOptions.estimateByes) {
          const prev = items.filter(it => it.week !== null && it.week < w && isFinite(it.sortTime))
            .sort((a, b) => b.sortTime - a.sortTime)[0];
          if (prev) byeDate = new Date(prev.sortTime + (w - prev.week) * 7 * DAY);
        }
        if (!byeDate) continue;
        items.push({
          week: w,
          sortTime: byeDate.getTime(),
          html: `
            <span class="team-sched-date">${byeDate.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" })}</span>
            <span class="team-sched-opp"><span style="font-style: italic;">Bye Week</span></span>
            <span class="team-sched-result"></span>`
        });
      }
    }

    items.sort((a, b) => a.sortTime - b.sortTime);

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

// ---- Game extras: TV network, weather, and the game details popup ----

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

// An emoji for a forecast's wording. Clear skies get a moon for night games.
function weatherIcon(desc, date) {
  const d = (desc || "").toLowerCase();
  if (/thunder|storm|lightning/.test(d)) return "⛈️";
  if (/snow|flurr|sleet|ice|wintry/.test(d)) return "🌨️";
  if (/rain|shower|drizzle/.test(d)) return "🌧️";
  if (/fog|haze|mist|smoke/.test(d)) return "🌫️";
  if (/wind|breez|gust/.test(d)) return "💨";
  const night = date instanceof Date && !isNaN(date.getTime()) && (date.getHours() >= 18 || date.getHours() < 6);
  if (/mostly sunny|mostly clear/.test(d)) return night ? "🌙" : "🌤️";
  if (/partly|intermittent|few clouds|scattered/.test(d)) return "⛅";
  if (/cloud|overcast|dreary/.test(d)) return "☁️";
  if (/moon/.test(d)) return "🌙";
  if (/^hot/.test(d)) return "🥵";
  if (/^cold/.test(d)) return "🥶";
  if (/sun|clear|fair/.test(d)) return night ? "🌙" : "☀️";
  return "";
}

// ESPN's forecasts come from AccuWeather, whose condition codes these are.
const WEATHER_CODES = {
  1: "Sunny", 2: "Mostly sunny", 3: "Partly sunny", 4: "Intermittent clouds", 5: "Hazy sunshine",
  6: "Mostly cloudy", 7: "Cloudy", 8: "Overcast", 11: "Fog", 12: "Showers",
  13: "Mostly cloudy with showers", 14: "Partly sunny with showers", 15: "Thunderstorms",
  16: "Mostly cloudy with thunderstorms", 17: "Partly sunny with thunderstorms", 18: "Rain",
  19: "Flurries", 20: "Mostly cloudy with flurries", 21: "Partly sunny with flurries", 22: "Snow",
  23: "Mostly cloudy with snow", 24: "Ice", 25: "Sleet", 26: "Freezing rain", 29: "Rain and snow",
  30: "Hot", 31: "Cold", 32: "Windy", 33: "Clear", 34: "Mostly clear", 35: "Partly cloudy",
  36: "Intermittent clouds", 37: "Hazy moonlight", 38: "Mostly cloudy", 39: "Partly cloudy with showers",
  40: "Mostly cloudy with showers", 41: "Partly cloudy with thunderstorms", 42: "Mostly cloudy with thunderstorms",
  43: "Mostly cloudy with flurries", 44: "Mostly cloudy with snow"
};

function conditionText(code) {
  return WEATHER_CODES[parseInt(code, 10)] || "";
}

// A simple dome for indoor stadiums.
const DOME_ICON = `<svg class="dome-icon" viewBox="0 0 24 16" aria-hidden="true"><path d="M2 14 A10 10 0 0 1 22 14 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 4 V14 M7 6.5 Q9 10 9 14 M17 6.5 Q15 10 15 14" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1 14.5 H23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

// A short forecast note for outdoor games, only when it's worth knowing:
// rain, storms, snow, wind, or temperatures at either extreme.
function weatherNote(ev, comp) {
  const w = ev.weather || comp.weather;
  if (!w || (comp.venue && comp.venue.indoor === true)) return "";
  const desc = (w.displayValue || w.conditionDescription || "").toLowerCase();
  const temp = parseInt(w.temperature !== undefined ? w.temperature : w.highTemperature, 10);
  let icon = "";
  if (/thunder|storm/.test(desc)) icon = "⛈";
  else if (/snow|flurr|sleet|ice/.test(desc)) icon = "❄";
  else if (/rain|shower|drizzle/.test(desc)) icon = "🌧";
  else if (/wind/.test(desc)) icon = "💨";
  else if (!isNaN(temp) && temp <= 40) icon = "🥶";
  else if (!isNaN(temp) && temp >= 90) icon = "🥵";
  if (!icon) return "";
  return isNaN(temp) ? icon : `${icon} ${temp}°`;
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
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${eventId}`);
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

  const tabs = [];
  if (s && state !== "pre") {
    const html = gameSections(s, away, home, state, comp).join("");
    if (html) tabs.push({ label: "Game", render: el => { el.innerHTML = html; } });
  }
  [away, home].forEach(c => {
    const t = c.team || {};
    if (!t.id) return;
    const logo = teamLogoFrom(t);
    tabs.push({
      label: `${logo ? `<img src="${logo}" alt="" onerror="this.style.display='none'">` : ""}${t.abbreviation || shortenPickDisplay(t.shortDisplayName || "")}`,
      render: el => {
        el.innerHTML = `<div class="details-note sched-record"></div><div class="sched-list"></div>`;
        renderTeamSchedule(el.querySelector(".sched-list"), t.id, async (record, standing) => {
          // SEC teams show their spot in the SEC tab's list so the two always
          // match; anyone else keeps ESPN's summary.
          let place = standing;
          try {
            const names = [t.location, t.shortDisplayName, t.displayName, t.name].filter(Boolean).map(normalizeTeam);
            const row = (await loadSecStandings()).find(r => (r.id && r.id === String(t.id)) || names.includes(normalizeTeam(r.name)));
            if (row) place = `${ordinal(row.place)} in SEC`;
          } catch (e) {}
          el.querySelector(".sched-record").textContent = `${shortenPickDisplay(t.location || t.shortDisplayName || t.displayName || "")}: ${record}${place ? " | " + place : ""}`;
        }, false);
      }
    });
  });
  if (s && state === "pre") {
    const html = pregameSections(s, away, home).join("");
    if (html) tabs.push({ label: "Preview", render: el => { el.innerHTML = html; } });
  }
  tabs.push({ label: "Top 25", render: renderRankings });
  tabs.push({ label: "SEC", render: renderStandings });
  body.detailsTabs = tabs;

  body.innerHTML = `
    ${gameInfoHtml(s, ev, sbComp, comp)}
    ${s ? "" : `<div class="team-sched-note">Couldn't load this game's details right now.</div>`}
    <div class="details-tabs" role="tablist">
      ${tabs.map((t, i) => `<button type="button" class="details-tab" role="tab" onclick="selectDetailsTab(this, ${i})">${t.label}</button>`).join("")}
    </div>
    ${tabs.map(() => `<div class="details-pane" style="display: none;"></div>`).join("")}`;
  selectDetailsTab(body.querySelector(".details-tab"), 0);
}

// Each tab fills its pane the first time it's opened.
function selectDetailsTab(tabButton, index) {
  const body = tabButton && tabButton.closest(".details-tabs").parentElement;
  if (!body) return;
  const buttons = body.querySelectorAll(".details-tab");
  const panes = body.querySelectorAll(".details-pane");
  buttons.forEach((b, i) => b.classList.toggle("active", i === index));
  panes.forEach((p, i) => { p.style.display = i === index ? "" : "none"; });
  const pane = panes[index];
  const tabs = body.detailsTabs || [];
  if (pane && !pane.dataset.loaded && tabs[index]) {
    pane.dataset.loaded = "1";
    pane.innerHTML = `<div class="team-sched-note">Loading...</div>`;
    tabs[index].render(pane);
  }
}

// Where, when, TV and the betting line, from the summary or the scoreboard.
function gameInfoHtml(s, ev, sbComp, comp) {
  const info = (s && s.gameInfo) || {};
  const rows = [];

  const venue = info.venue || sbComp.venue || {};
  const city = venue.address ? [venue.address.city, venue.address.state].filter(Boolean).join(", ") : "";
  const where = [venue.fullName, city].filter(Boolean).join(", ");
  const date = new Date(comp.date || ev.date || sbComp.date);

  // Indoor games get the dome icon and no forecast; outdoor games get an
  // icon for the conditions, then the temperature and the forecast text.
  const indoor = venue.indoor === true || (sbComp.venue && sbComp.venue.indoor === true);
  // The summary's forecast often has only a temperature and a condition
  // code, so the wording falls back to the scoreboard's, then to the code.
  const forecasts = [info.weather, ev.weather, sbComp.weather].filter(Boolean);
  const pickField = (...keys) => {
    for (const f of forecasts) for (const k of keys) if (f[k] !== undefined && f[k] !== null && f[k] !== "") return f[k];
    return undefined;
  };
  let weather = "";
  if (indoor) {
    weather = `<span class="weather-chip">${DOME_ICON} Indoors</span>`;
  } else if (forecasts.length) {
    const conditionId = pickField("conditionId");
    const desc = pickField("displayValue", "conditionDescription") || conditionText(conditionId);
    const temp = pickField("temperature", "highTemperature");
    const icon = weatherIcon(desc, date);
    if (temp !== undefined || desc) {
      weather = `<span class="weather-chip">${icon ? `<span class="weather-icon">${icon}</span>` : ""}${temp !== undefined ? `${temp}°` : ""}${desc ? ` ${desc}` : ""}</span>`;
    }
  }
  if (where || weather) rows.push(["Where", [where, weather].filter(Boolean).join(" · ")]);

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

function ordinal(n) {
  const v = n % 100;
  return n + (v >= 11 && v <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
}

function detailsSection(title, html) {
  return `<div class="details-section"><div class="details-heading">${title}</div>${html}</div>`;
}

function pregameSections(s, away, home) {
  const out = [];

  // Most recent meeting, if ESPN includes the series.
  const series = (s.seasonseries && s.seasonseries[0]) || null;
  const meeting = series && series.events && series.events[series.events.length - 1];
  if (meeting && meeting.competitors) {
    const parts = meeting.competitors.map(c => `${(c.team && (c.team.abbreviation || c.team.displayName)) || ""} ${c.score || ""}`);
    const when = meeting.date ? new Date(meeting.date).getFullYear() : "";
    out.push(detailsSection("Last Meeting", `<div class="details-note">${parts.join(" - ")}${when ? ` (${when})` : ""}</div>`));
  }

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

  // Score by quarter.
  const lines = [away, home].map(c => (c.linescores || []).map(l => l.displayValue !== undefined ? l.displayValue : l.value));
  const periods = Math.max(lines[0].length, lines[1].length);
  if (periods > 0) {
    const label = i => i < 4 ? `Q${i + 1}` : (periods > 5 ? `OT${i - 3}` : "OT");
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
    ["totalYards", "Total Yards"], ["netPassingYards", "Passing"], ["rushingYards", "Rushing"],
    ["firstDowns", "First Downs"], ["thirdDownEff", "3rd Down"], ["turnovers", "Turnovers"],
    ["totalPenaltiesYards", "Penalties"], ["possessionTime", "Possession"]
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
