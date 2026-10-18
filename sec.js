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
async function openRankings() {
  showInfoModal("Top 25");
  const body = document.getElementById("infoBody");
  document.querySelector("#infoOverlay .team-sched-modal").style.maxWidth = "560px";

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

async function openStandings() {
  showInfoModal("SEC Standings");
  const body = document.getElementById("infoBody");
  try {
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

    body.innerHTML = `
      <div class="info-row standings-row head"><span></span><span>Team</span><span class="info-meta">Conf</span><span class="info-meta">Overall</span></div>
      ${rows.map((r, i) => `
        <div class="info-row standings-row">
          <span class="info-rank">${i + 1}</span>
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
async function openTeamSchedule(teamId, teamName, teamLogo) {
  const overlay = document.getElementById("teamSchedOverlay");
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
  body.innerHTML = `<div class="team-sched-note">Loading schedule...</div>`;
  overlay.style.display = "flex";

  try {
    if (!teamScheduleCache[teamId]) {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${teamId}/schedule?season=2026`);
      if (!res.ok) throw new Error("bad response");
      teamScheduleCache[teamId] = await res.json();
    }
    const data = teamScheduleCache[teamId];
    const events = (data.events || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    if (data.team && data.team.recordSummary) {
      title.innerHTML = `${teamName}<small>${data.team.recordSummary}${data.team.standingSummary ? " | " + data.team.standingSummary : ""}</small>`;
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

    const currentRow = body.querySelector(".current-week");
    if (currentRow) {
      body.scrollTop = Math.max(0, currentRow.offsetTop - body.clientHeight / 2 + currentRow.offsetHeight / 2);
    }
  } catch (err) {
    console.error("Team schedule error:", err);
    body.innerHTML = `<div class="team-sched-note">Couldn't load this schedule right now.</div>`;
  }
}
