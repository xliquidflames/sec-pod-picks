// index.html's own code, moved out of the page. Loaded at the end of the
// page by siteScript() in load.js, after the shared files.

// Betting lines use abbreviations ("ALA -7.5"), so this page also knows those.
addSecAliases({
  alabama: ["ALA"],
  auburn: ["AUB"],
  florida: ["FLA"],
  georgia: ["UGA"],
  kentucky: ["UK", "KY"],
  olemiss: ["MISS"],
  mississippistate: ["MSST"],
  missouri: ["MIZ"],
  oklahoma: ["OU"],
  southcarolina: ["SC"],
  tennessee: ["TENN"],
  texas: ["TEX"],
  texasam: ["TA&M", "TAM"],
  vanderbilt: ["VAN"]
});

// A season card and a grid column for each host in config.js, then the
// players' consensus.
document.getElementById("mainWeekSelect").innerHTML =
  WEEK_NUMS.map(w => `<option value="${w}">${weekName(w)}</option>`).join("");

(function buildHostColumns() {
  const card = (label, id, key) => `
    <div class="host-season-card">
      <div class="host-season-name">${label}</div>
      <div class="host-season-record" id="${id}">0-0</div>
      <button type="button" class="details-link" onclick="openEntrantStats(${key})">Stats</button>
    </div>`;
  document.getElementById("hostSeasonStrip").innerHTML =
    SITE.hosts.map((h, i) => card(h, `seasonHost${i}`, i)).join("") + card(SITE.players.many, "seasonPlayers", -1);

  document.getElementById("weekRecords").innerHTML =
    SITE.hosts.map((h, i) => `<span class="week-record" id="thHost${i}">${h}</span>`).join("") +
    `<span class="week-record" id="thPlayers">${SITE.players.many}</span>`;
})();

// Team schedules highlight the week being shown and place games by date.
scheduleOptions.currentWeek = () => activeWeek;
scheduleOptions.weekWindows = getWeekWindows;
scheduleOptions.estimateByes = false;

// "Details" opens the game details at the bottom of the game's card.
function detailsLink(g) {
  if (!g.eventId) return "";
  return `<button type="button" class="details-link" onclick="toggleInlineDetails(this, '${g.eventId}')">Details &#9662;</button>`;
}

function toggleInlineDetails(btn, eventId) {
  const card = btn.closest(".game-card");
  const open = card.querySelector(".inline-details-row");
  if (open) {
    open.remove();
    card.classList.remove("details-open");
    btn.innerHTML = "Details &#9662;";
    return;
  }
  const row = document.createElement("div");
  row.className = "inline-details-row";
  row.innerHTML = `<div class="inline-details"></div>
    <button type="button" class="details-link inline-details-close">Hide Details &#9652;</button>`;
  row.querySelector(".inline-details-close").onclick = () => {
    toggleInlineDetails(btn, eventId);
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  card.appendChild(row);
  card.classList.add("details-open");
  btn.innerHTML = "Hide &#9652;";
  renderGameDetails(row.querySelector(".inline-details"), eventId);
}

function toggleAllInlineDetails(open) {
  document.querySelectorAll("#hostGridBody .details-link:not(.inline-details-close)").forEach(btn => {
    if (btn.closest(".game-card").classList.contains("details-open") !== open) btn.click();
  });
  if (!open) {
    const grid = document.getElementById("hostGridWrapper");
    if (grid.getBoundingClientRect().top < 0) grid.scrollIntoView({ block: "start" });
  }
}

const scheduleAttrs = (id, name, logo) => `data-team-id="${id}" data-team-name="${name}" data-team-logo="${logo}"`;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hasRealKickoff = g => g.kickoff && g.kickoff.getFullYear() < 9999;
const localDateKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

async function fetchEspnSchedule(week) {
  try {
    const { data } = await fetchEspnRaw(week);
    if (!data || !data.events || data.events.length === 0) return [];

    const games = data.events.map(ev => {
      const comp = ev.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === "home");
      const away = comp.competitors.find(c => c.homeAway === "away");
      const homeName = cleanTeamName(home.team.shortDisplayName || home.team.name);
      const awayName = cleanTeamName(away.team.shortDisplayName || away.team.name);
      const homeLogo = teamLogoFrom(home.team);
      const awayLogo = teamLogoFrom(away.team);
      const awayIsSec = isSecTeam(awayName);
      const homeIsSec = isSecTeam(homeName);

      // teamA is always the SEC team (home if both are). Matchup keys,
      // grading and host predicted scores use this order; the screen
      // always shows the real "Away @ Home".
      const teamAIsHome = isSecTeam(homeName);
      const teamA = teamAIsHome ? homeName : awayName;
      const teamB = teamAIsHome ? awayName : homeName;

      const isFinal = comp.status && comp.status.type && comp.status.type.completed;
      const isLive = (comp.status && comp.status.type && comp.status.type.state) === "in";

      // Real final score in teamA/teamB order, for the "Perfect" badge.
      let finalScoreA = null, finalScoreB = null;
      if (isFinal) {
        finalScoreA = parseInt((teamAIsHome ? home : away).score, 10);
        finalScoreB = parseInt((teamAIsHome ? away : home).score, 10);
      }

      let winner = null;
      if (isFinal) {
        const winnerComp = comp.competitors.find(c => c.winner === true);
        if (winnerComp) winner = cleanTeamName(winnerComp.team.shortDisplayName || winnerComp.team.name);
      }

      // Live or final score in away/home order, for the Per Team view.
      let awayScore = null, homeScore = null;
      if (isFinal || isLive) {
        const aScore = parseInt(away.score, 10);
        const hScore = parseInt(home.score, 10);
        if (!isNaN(aScore)) awayScore = aScore;
        if (!isNaN(hScore)) homeScore = hScore;
      }

      // AP rank (ESPN sends 99 when unranked) sits on the logo's corner,
      // after the logo's text fallback so the fallback still works.
      const rankSpan = r => (r >= 1 && r <= 25) ? `<span class="matchup-rank">#${r}</span>` : "";
      const logoCell = (c, name, logo, isSec) =>
        `<span class="matchup-logo-wrap">${teamLogoHtml(name, logo, isSec)}${rankSpan(c.curatedRank && c.curatedRank.current)}</span>`;
      const matchupLabel = `<span class="matchup-logo-row">${logoCell(away, awayName, awayLogo, awayIsSec)}<span class="matchup-at-symbol">@</span>${logoCell(home, homeName, homeLogo, homeIsSec)}</span>`;
      const rankOf = c => { const r = c.curatedRank && c.curatedRank.current; return r >= 1 && r <= 25 ? r : null; };

      // One short line under the logos: kickoff time before the game,
      // otherwise each team's score under its logo with the status between.
      let detail = "TBD", statusText = "TBD";
      if (isFinal || isLive) {
        const st = comp.status || {};
        const status = isFinal
          ? ((st.period || 0) > 4 ? "F/OT" : "Final")
          : (/half/i.test((st.type && st.type.detail) || "") ? "Half" : ((st.period || 0) > 4 ? "OT" : `Q${st.period || 1}`));
        const scoreSpan = c => `<span class="matchup-score ${c.winner === true ? "won" : ""}">${c.score !== undefined ? c.score : ""}</span>`;
        detail = `<span class="matchup-score-row">${scoreSpan(away)}<span class="matchup-status">${status}</span>${scoreSpan(home)}</span>`;
        statusText = status;
      } else if (comp.date) {
        // The date is on the day divider row, so just the time and TV:
        // "12PM on ABC", "3:30PM on SECN".
        const kick = new Date(comp.date);
        const time = `${kick.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          .replace(":00", "").replace(/\s+/g, "")} ${tzAbbr(kick)}`.trim();
        const tv = shortNetwork(comp);
        detail = tv ? `${time} on ${tv}` : time;
        statusText = detail;
      }

      let kickoff = new Date(8640000000000000);
      if (comp.date) {
        const kd = new Date(comp.date);
        if (!isNaN(kd.getTime())) kickoff = kd;
      }

      const rawOdds = comp.odds && comp.odds[0]?.details ? comp.odds[0].details : "";

      // Where and the line, for the top right of the game's card (the
      // same facts Details shows, from the scoreboard).
      const venue = comp.venue || {};
      const city = venue.address ? [venue.address.city, venue.address.state].filter(Boolean).join(", ") : "";
      const whereText = [venue.fullName, city].filter(Boolean).join(" · ");
      let weatherText = "";
      if (venue.indoor === true) weatherText = `<span class="weather-chip">${DOME_ICON} Indoors</span>`;
      else {
        const w = ev.weather || comp.weather;
        const desc = w && (w.displayValue || w.conditionDescription || conditionText(w.conditionId));
        const temp = w && (w.temperature ?? w.highTemperature);
        if (w && (temp !== undefined || desc)) {
          const icon = weatherIcon(desc, new Date(comp.date || ev.date));
          weatherText = `<span class="weather-chip">${icon ? `<span class="weather-icon">${icon}</span>` : ""}${temp !== undefined ? `${temp}°` : ""}${desc ? ` ${desc}` : ""}</span>`;
        }
      }
      const odds = comp.odds && comp.odds[0];
      const lineText = odds ? [odds.details, odds.overUnder ? `O/U ${odds.overUnder}` : ""].filter(Boolean).join(" · ") : "";
      return {
        matchupKey: (ev.id !== undefined && ev.id !== null) ? String(ev.id) : buildMatchupKey(teamA, teamB),
        teamA,
        teamB,
        matchupLabel,
        rawOdds,
        detail,
        eventId: (ev.id !== undefined && ev.id !== null) ? String(ev.id) : null,
        winner,
        isLive,
        isFinal,
        kickoff,
        finalScoreA,
        finalScoreB,
        awayName,
        homeName,
        awayLogo,
        homeLogo,
        awayIsSec,
        homeIsSec,
        awayScore,
        homeScore,
        awayRank: rankOf(away),
        homeRank: rankOf(home),
        awayWon: isFinal && away.winner === true,
        homeWon: isFinal && home.winner === true,
        statusText,
        whereText,
        weatherText,
        lineText
      };
    });

    return storeWeek(week, games);
  } catch (e) {
    console.error("ESPN schedule error:", e);
    return [];
  }
}

// The cousins' most-picked team for a game, as a share of everyone who
// submitted this week. On a tie, the first team counted wins.
function computeMajorityPick(cousinRows, game) {
  // Counted by team, so "Texas A&M" and "TAMU" are one pick. Older
  // entries can be saved as text, so they're parsed first.
  const tally = {};
  cousinRows.forEach(c => {
    const pick = getMatchedUserPick(parseUserPicks(c.picks), game);
    if (!pick) return;
    const t = tally[normalizeTeam(pick)] || (tally[normalizeTeam(pick)] = { team: pick, count: 0 });
    t.count++;
  });

  const entries = Object.values(tally);
  if (entries.length === 0 || cousinRows.length === 0) return null;

  entries.sort((a, b) => b.count - a.count);
  const top = entries[0];
  return { team: top.team, percentage: Math.round((top.count / cousinRows.length) * 100) };
}

// This week's record for the Cousins column: each decided game's
// majority pick, graded like a host's pick.
function gradeCousinsConsensus(cousinRows, games) {
  let correct = 0, incorrect = 0;
  games.forEach(game => {
    const winner = winnerOf(activeWeek, game);
    if (!winner) return;
    const majority = computeMajorityPick(cousinRows, game);
    if (!majority) return;
    const mNorm = normalizeTeam(majority.team);
    if (mNorm && mNorm === normalizeTeam(winner)) correct++;
    else incorrect++;
  });
  return { correct, incorrect };
}

// Right pick, exact score, and locked: the "Perfect" badge.
function isTriplePerfect(scoreObj, pickClass, isLocked, game) {
  if (pickClass !== "pick-correct" || !isLocked) return false;
  if (!scoreObj || scoreObj.teamA === undefined || scoreObj.teamB === undefined) return false;
  if (game.finalScoreA === null || game.finalScoreA === undefined) return false;
  if (game.finalScoreB === null || game.finalScoreB === undefined) return false;
  const predA = parseInt(scoreObj.teamA, 10);
  const predB = parseInt(scoreObj.teamB, 10);
  if (isNaN(predA) || isNaN(predB)) return false;
  return predA === game.finalScoreA && predB === game.finalScoreB;
}

// A host's pick cell. Perfect cells wrap their content so it sits above the glow.
function buildPickCellInner(pickText, scoreText, isLocked, isTriple) {
  const inner = `
    ${pickText}
    ${scoreText ? `<span class="host-predicted-score">${scoreText}</span>` : ""}
    ${isLocked ? '<span class="lock-badge lock-badge-compact">LOCK</span>' : ""}
    ${isTriple ? '<span class="triple-perfect-badge">&#10024; Perfect &#10024;</span>' : ""}
  `;
  return isTriple ? `<span class="triple-perfect-content">${inner}</span>` : inner;
}

// Season records for the hosts, the Cousins consensus and the podium.
function computeSeasonTotals() {
  const hostTotals = Object.fromEntries(SITE.hosts.map(h => [hostKey(h), [0, 0]]));
  const cousinTotals = {};
  let anyDecidedGames = false;

  // How many cousins picked each team, per game, for the season-long
  // Cousins consensus record.
  const pickCounts = {};
  allWeekRows.forEach(row => {
    if (row.is_host) return;
    const w = row.week_number;
    if (!pickCounts[w]) pickCounts[w] = {};
    const picks = parseUserPicks(row.picks);
    (weekSchedules[w] || []).forEach(game => {
      const p = getMatchedUserPick(picks, game);
      if (!p) return;
      const counts = pickCounts[w][game.matchupKey] || (pickCounts[w][game.matchupKey] = {});
      const pNorm = normalizeTeam(p);
      counts[pNorm] = (counts[pNorm] || 0) + 1;
    });
  });

  allWeekRows.forEach(row => {
    const score = gradePicks(row.picks, row.week_number);
    if (score.correct > 0 || score.incorrect > 0) anyDecidedGames = true;

    if (row.is_host) {
      const name = (row.user_name || "").toLowerCase();
      if (Object.hasOwn(hostTotals, name)) {
        const host = hostTotals[name];
        host[0] += score.correct;
        host[1] += score.incorrect;
      }
    } else {
      if (!cousinTotals[row.user_name]) cousinTotals[row.user_name] = { user_name: row.user_name, correct: 0, incorrect: 0 };
      cousinTotals[row.user_name].correct += score.correct;
      cousinTotals[row.user_name].incorrect += score.incorrect;
    }
  });

  SITE.hosts.forEach((h, i) => setText(`seasonHost${i}`, hostTotals[hostKey(h)].join("-")));

  let cousinsSeasonW = 0, cousinsSeasonL = 0;
  Object.keys(pickCounts).forEach(w => {
    const winners = gameWinners[w] || {};
    Object.entries(pickCounts[w]).forEach(([matchupKey, counts]) => {
      const winner = winners[matchupKey];
      const entries = Object.entries(counts);
      if (!winner || entries.length === 0) return;
      entries.sort((a, b) => b[1] - a[1]);
      if (entries[0][0] === normalizeTeam(winner)) cousinsSeasonW++;
      else cousinsSeasonL++;
    });
  });
  setText("seasonPlayers", `${cousinsSeasonW}-${cousinsSeasonL}`);
  // Once any record has three digits ("103-28"), all four get a size that fits on one line.
  const records = [...document.querySelectorAll(".host-season-record")];
  const long = records.some(el => el.textContent.length > 5);
  records.forEach(el => el.classList.toggle("long", long));

  renderPodium(Object.values(cousinTotals), anyDecidedGames, { namesOpen: true, noun: SITE.players.many });
}

async function switchWeek(weekNum) {
  activeWeek = weekNum;

  const dropdown = document.getElementById("mainWeekSelect");
  if (dropdown) dropdown.value = weekNum;

  document.getElementById("weekHostTitle").textContent = `${weekName(weekNum)} Info Hub`;
  document.getElementById("weekGamesTitle").textContent = `${weekName(weekNum)} Games`;
  document.getElementById("weekCousinsTitle").textContent = `The ${possessive(SITE.players.many)} ${weekName(weekNum)} Picks`;

  updateSubmitButton(weekNum, "makepicks.html");

  await renderActiveWeek();
}

// ---- Path to first ----
// A game where you and the leader picked the same team can't change the
// gap. Only games where your picks differ ("swing games") move it, by
// one each, so winning all of them is the best case.
//
// Season standing follows the podium: most correct, then fewest losses.
// Records are recomputed here because computeSeasonTotals() runs after
// this render.
function computePathsToFirst(games) {
  const season = {};
  allWeekRows.forEach(row => {
    if (row.is_host) return;
    const s = gradePicks(row.picks, row.week_number);
    if (!season[row.user_name]) season[row.user_name] = { name: row.user_name, correct: 0, incorrect: 0 };
    season[row.user_name].correct += s.correct;
    season[row.user_name].incorrect += s.incorrect;
  });
  const weekPicksFor = (name) => {
    const row = allWeekRows.find(r => !r.is_host && r.week_number === activeWeek && r.user_name === name);
    return row ? parseUserPicks(row.picks) : null;
  };
  return pathsAmong(Object.values(season), weekPicksFor, games, () => YOU);
}

// Wording for a name in a host's stats (YOU, for a listener's own card, is in common.js).
const voiceOf = name => ({ subj: name, take: "takes", tie: "ties", pull: "pulls", poss: "Their" });

// Week Info Hub grid: one row per game with Mike, Shane, Steven and the
// Cousins' majority pick, under a divider for each new day.
function renderHostGrid(games, hostRows, cousinRows, isLockActiveThisWeek) {
  const hostPicksFor = name => {
    const row = hostRows.find(h => h.user_name?.toLowerCase() === name);
    return row ? parseUserPicks(row.picks) : {};
  };
  const hosts = SITE.hosts.map(name => {
    const picks = hostPicksFor(hostKey(name));
    return { picks, scores: picks.scores || {}, record: gradePicks(picks, activeWeek) };
  });
  const consensus = gradeCousinsConsensus(cousinRows, games);

  const header = (id, label, rec) => {
    document.getElementById(id).innerHTML = `${label} <span class="host-header-score">${rec.correct}-${rec.incorrect}</span>`;
  };
  SITE.hosts.forEach((name, i) => header(`thHost${i}`, name, hosts[i].record));
  // Seasons before the site: the column is that week's guest.
  const guests = GUEST_SEASON ? [...new Set(cousinRows.map(r => r.user_name))] : [];
  header("thPlayers", guests.length === 1 ? escapeHtml(guests[0]) : SITE.players.many, consensus);

  const hostBody = document.getElementById("hostGridBody");
  hostBody.innerHTML = games.length ? "" : `<p class="game-cards-note">No games this week.</p>`;
  const liveMap = liveGames[activeWeek] || {};

  games.forEach((g, idx) => {
    const divider = dayDividerLabel(games, idx);
    if (divider) hostBody.insertAdjacentHTML("beforeend", `<div class="game-day">${divider}</div>`);

    // Predicted scores are saved in teamA/teamB order but shown in the
    // matchup's own away-home order, like the live score.
    const teamAIsAway = normalizeTeam(g.teamA) === normalizeTeam(g.awayName);
    const hostPick = ({ picks, scores }, i) => {
      const pick = getMatchedUserPick(picks, g) || "-";
      const s = scores[g.matchupKey] || scores[g.id] || scores[String(g.id)];
      const scoreText = (!s || s.teamA === undefined || s.teamB === undefined || s.teamA === "") ? ""
        : teamAIsAway ? `${s.teamA}-${s.teamB}` : `${s.teamB}-${s.teamA}`;
      const isLock = isLockActiveThisWeek && isLockMatch(picks, g);
      const pickClass = getPickClass(pick, g, activeWeek);
      const isTriple = isTriplePerfect(s, pickClass, isLock, g);
      return `
      <div class="gc-pick ${isTriple ? "triple-perfect-cell" : ""}">
        <span class="triple-perfect-content">
          <span class="gc-host">${SITE.hosts[i]}${isLock ? ' <span class="lock-badge gc-lock">LOCK</span>' : ""}</span>
          <span class="gc-team ${pickClass}">${shortenPickDisplay(pick)}</span>
          ${scoreText ? `<span class="gc-score">${scoreText}</span>` : ""}
          ${isTriple ? '<span class="triple-perfect-badge">&#10024; Perfect &#10024;</span>' : ""}
        </span>
      </div>`;
    };

    // One team's line: logo (with its rank), name, and the score once it starts.
    const teamLine = (name, logo, isSec, rank, score, won) => `
      <div class="gc-team-row ${g.isFinal && !won ? "lost" : ""}">
        <span class="matchup-logo-wrap">${teamLogoHtml(name, logo, isSec)}</span>
        <span class="gc-name">${shortenPickDisplay(name)}${rank ? ` <span class="gc-rank">#${rank}</span>` : ""}</span>
        ${score !== null && score !== undefined ? `<span class="gc-points ${won ? "won" : ""}">${score}</span>` : ""}
      </div>`;

    // The Cousins: the share on the team most of them picked, as a bar.
    const majorityPick = computeMajorityPick(cousinRows, g);
    const classCousins = majorityPick ? getPickClass(majorityPick.team, g, activeWeek) : "pick-pending";
    const cousinsLabel = guests.length === 1 ? escapeHtml(guests[0]) : SITE.players.many;
    const cousins = !majorityPick
      ? `<span class="gc-cousins-none">No picks yet</span>`
      : GUEST_SEASON
        ? `<span class="gc-cousins-text ${classCousins}">${shortenPickDisplay(majorityPick.team)}</span>`
        : `<span class="gc-bar"><span class="gc-bar-fill ${classCousins}" style="width: ${majorityPick.percentage}%"></span></span>
           <span class="gc-cousins-text ${classCousins}">${majorityPick.percentage}% ${shortenPickDisplay(majorityPick.team)}</span>`;

    const card = document.createElement("article");
    card.className = "game-card";
    card.dataset.teams = [g.teamA, g.teamB].map(normalizeTeam).join("|");
    if (liveMap[g.matchupKey] || liveMap[g.id]) card.classList.add("live-game-row");
    card.innerHTML = `
      <div class="gc-head">
        <div class="gc-teams">
          ${teamLine(g.awayName, g.awayLogo, g.awayIsSec, g.awayRank, g.awayScore, g.awayWon)}
          ${teamLine(g.homeName, g.homeLogo, g.homeIsSec, g.homeRank, g.homeScore, g.homeWon)}
        </div>
        <div class="gc-info">
          <span class="gc-status">${g.statusText || ""}</span>
          ${g.lineText && !g.isFinal ? `<span class="gc-line">${g.lineText}</span>` : ""}
        </div>
        ${g.whereText || (g.weatherText && !g.isFinal) ? `<div class="gc-where">${[g.whereText, g.isFinal ? "" : g.weatherText].filter(Boolean).join(" · ")}</div>` : ""}
      </div>
      <div class="gc-picks" style="grid-template-columns: repeat(${SITE.hosts.length}, minmax(0, 1fr));">${hosts.map(hostPick).join("")}</div>
      <div class="gc-cousins"><span class="gc-cousins-label">${cousinsLabel}</span>${cousins}</div>
      ${g.eventId ? `<div class="gc-foot">${detailsLink(g)}</div>` : ""}
    `;
    hostBody.appendChild(card);
  });

  // SEC teams with no game this week, so their schedules are still reachable.
  const byeTeams = getSecByeTeams(games);
  const byeBox = document.getElementById("byeBox");
  if (byeBox) {
    if (games.length > 0 && byeTeams.length > 0) {
      byeBox.innerHTML = `
        <span class="bye-label">On A Bye:<small>Tap for schedule</small></span>
        <span class="bye-logos">${byeTeams.map(t => teamLogoHtml(t.name, t.logo, true, scheduleAttrs(t.id, t.name, t.logo))).join("")}</span>
      `;
      byeBox.style.display = "flex";
    } else {
      byeBox.innerHTML = "";
      byeBox.style.display = "none";
    }
  }

  preloadDetails(games.map(g => g.eventId));
}

// Each cousin's season so far: record by week, Lock of the Week record,
// and the teams they've done best and worst picking (3+ decided picks).
function computeSeasonBreakdowns() {
  const byName = {};
  allWeekRows.forEach(row => {
    if (!row.is_host) (byName[row.user_name] || (byName[row.user_name] = [])).push(row);
  });
  return Object.fromEntries(Object.entries(byName).map(([name, rows]) => [name, breakdownOf(rows)]));
}

// ---- Host and Cousins stats popups ----
// A host's rows, or for the Cousins (index -1) their majority pick on
// each game, as one row a week.
function entrantRows(index) {
  if (index < 0) {
    const weeks = [...new Set(allWeekRows.filter(r => !r.is_host).map(r => r.week_number))];
    return weeks.map(w => {
      const rows = allWeekRows.filter(r => !r.is_host && r.week_number === w);
      const picks = {};
      (weekSchedules[w] || []).forEach(g => {
        const m = computeMajorityPick(rows, g);
        if (m) picks[g.matchupKey] = m.team;
      });
      return { user_name: SITE.players.many, week_number: w, picks };
    });
  }
  const key = hostKey(SITE.hosts[index]);
  return allWeekRows.filter(r => r.is_host && (r.user_name || "").toLowerCase() === key);
}

function openEntrantStats(index) {
  const names = SITE.hosts.concat(SITE.players.many);
  const indexes = SITE.hosts.map((_, i) => i).concat(-1);
  const rowsOf = indexes.map(entrantRows);
  const name = index < 0 ? SITE.players.many : SITE.hosts[index];
  const rows = rowsOf[indexes.indexOf(index)];

  showInfoModal(index < 0 ? `The ${possessive(SITE.players.many)} Season` : `${possessive(name)} Season`);
  const body = document.getElementById("infoBody");

  // Path to first among the hosts and the Cousins.
  const everyone = names.map((n, k) => {
    const rec = { name: n, correct: 0, incorrect: 0 };
    rowsOf[k].forEach(r => { const g = gradePicks(r.picks, r.week_number); rec.correct += g.correct; rec.incorrect += g.incorrect; });
    return rec;
  });
  const picksFor = n => {
    const row = rowsOf[names.indexOf(n)].find(r => r.week_number === activeWeek);
    return row ? parseUserPicks(row.picks) : null;
  };
  const path = pathsAmong(everyone, picksFor, weekSchedules[activeWeek] || [],
    n => n === SITE.players.many ? { subj: `the ${SITE.players.many}`, take: "take", tie: "tie", pull: "pull", poss: "Their" } : voiceOf(n))[name];
  const me = everyone[names.indexOf(name)];

  const b = breakdownOf(rows);
  const facts = [];
  if (b.lockC + b.lockI > 0) facts.push(`Locks: ${b.lockC}-${b.lockI}`);
  if (b.best) facts.push(`Best pick: ${shortenPickDisplay(b.best.name)} ${b.best.w}-${b.best.l}`);
  if (b.worst) facts.push(`Toughest: ${shortenPickDisplay(b.worst.name)} ${b.worst.w}-${b.worst.l}`);

  // Hosts: exact score predictions, and their record when they went
  // against the Cousins' majority.
  if (index >= 0) {
    const cousins = rowsOf[rowsOf.length - 1];
    let exact = 0, againstW = 0, againstL = 0;
    rows.forEach(r => {
      const picks = parseUserPicks(r.picks);
      const scores = picks.scores || {};
      const crowd = cousins.find(c => c.week_number === r.week_number);
      (weekSchedules[r.week_number] || []).forEach(g => {
        const winner = winnerOf(r.week_number, g);
        const pick = getMatchedUserPick(picks, g);
        if (!winner || !pick) return;
        const sc = scores[g.matchupKey] || scores[g.id] || scores[String(g.id)];
        if (sc && g.finalScoreA != null && g.finalScoreB != null &&
            parseInt(sc.teamA, 10) === g.finalScoreA && parseInt(sc.teamB, 10) === g.finalScoreB) exact++;
        const crowdPick = crowd ? getMatchedUserPick(crowd.picks, g) : null;
        if (crowdPick && normalizeTeam(crowdPick) !== normalizeTeam(pick)) {
          if (normalizeTeam(pick) === normalizeTeam(winner)) againstW++;
          else againstL++;
        }
      });
    });
    facts.push(`Exact scores: ${exact}`);
    if (againstW + againstL > 0) facts.push(`Against the ${SITE.players.many}: ${againstW}-${againstL}`);
  }

  body.innerHTML = `
    <div class="entrant-record">${me.correct}-${me.incorrect}</div>
    ${path ? `<div class="path-line ${path.isLeader ? "leader" : ""}"><span class="path-line-label">Path to First · ${weekName(activeWeek)}</span>${path.line}</div>` : ""}
    ${b.weeks.length ? `
    <div class="season-box">
      <span class="path-line-label">Season So Far</span>
      <div class="season-weeks">${b.weeks.map(w => `<span class="season-week">${weekShort(w.week)} ${w.c}-${w.i}</span>`).join("")}</div>
      ${facts.map(f => `<div>${f}</div>`).join("")}
    </div>` : `<div class="team-sched-note">No decided games yet.</div>`}
  `;
}

// Fan stat cards, from each player's favorite college team (set on the
// Account page), for the whole season: the Fanbase Showdown.
const FAN_CARDS = [
  ["Homer", "Homer Rate"], ["HomerRecord", "Homer Record"], ["Traitors", "Traitors"],
  ["Best", "Sharpest Fans"], ["Worst", "Coldest Fans"], ["Biggest", "Biggest Fan Base"]
];

// rows: cousin entries to count, from one week or every week.
function renderFanStats(boxId, rows, season) {
  const box = document.getElementById(boxId);
  if (!box) return;
  const card = ([key, label]) => `<div class="pulse-card">
      <div class="pulse-label">${label}</div>
      <div class="pulse-stat" data-fan="${key}">--</div>
      <div class="pulse-desc" data-fan-desc="${key}"></div>
    </div>`;
  if (!box.children.length) {
    box.innerHTML = `<div class="pulse-grid">${FAN_CARDS.slice(0, 3).map(card).join("")}</div>
      <div class="pulse-grid">${FAN_CARDS.slice(3).map(card).join("")}</div>`;
  }
  const show = (key, stat, desc) => {
    box.querySelector(`[data-fan="${key}"]`).innerHTML = stat;
    box.querySelector(`[data-fan-desc="${key}"]`).textContent = desc;
  };
  const teamHtml = team => `${team.logo ? `<img class="pulse-logo" src="${escapeHtml(team.logo)}" alt="">` : ""}${escapeHtml(shortenPickDisplay(team.name))}`;
  const record = (w, l) => `${w}-${l}`;
  const noFavorites = "No favorite teams set";

  // Every entry from a player who has a favorite team.
  const fans = rows.map(r => ({ row: r, team: (playerFavorites[(r.user_name || "").toLowerCase()] || {}).cfb }))
    .filter(f => f.team && f.team.name);

  // Homers and traitors: picks on games their own team played.
  let backed = 0, against = 0, homerW = 0, homerL = 0, traitorW = 0, traitorL = 0;
  fans.forEach(f => {
    const mine = normalizeTeam(f.team.name);
    const week = f.row.week_number;
    const game = (weekSchedules[week] || []).find(g => normalizeTeam(g.teamA) === mine || normalizeTeam(g.teamB) === mine);
    const pick = game && getMatchedUserPick(parseUserPicks(f.row.picks), game);
    if (!pick) return;
    const winner = winnerOf(week, game);
    const right = winner ? normalizeTeam(pick) === normalizeTeam(winner) : null;
    if (normalizeTeam(pick) === mine) {
      backed++;
      if (right === true) homerW++; else if (right === false) homerL++;
    } else {
      against++;
      if (right === true) traitorW++; else if (right === false) traitorL++;
    }
  });

  const playing = backed + against;
  if (playing) {
    show("Homer", `${Math.round(backed / playing * 100)}%`,
      season ? `${backed} of ${playing} picks backed their team` : `${backed} of ${playing} picked their team`);
    show("HomerRecord", homerW + homerL ? record(homerW, homerL) : "--",
      homerW + homerL ? "Backing their own team" : "Awaiting results");
    show("Traitors", String(against), against === 0 ? "Everyone stayed loyal"
      : `${season ? "Picks against their own team" : "Picked against their team"}${traitorW + traitorL ? ` · ${record(traitorW, traitorL)}` : ""}`);
  } else {
    show("Homer", "--", fans.length ? "No fans' teams played" : noFavorites);
    show("HomerRecord", "--", "Backing their own team");
    show("Traitors", "--", "Picked against their team");
  }

  // Fan bases: everyone with the same favorite team, all their picks
  // added up. Best and worst need at least 2 fans.
  const bases = {};
  fans.forEach(f => {
    const key = normalizeTeam(f.team.name);
    const base = bases[key] || (bases[key] = { team: f.team, names: new Set(), w: 0, l: 0 });
    base.names.add((f.row.user_name || "").toLowerCase());
    const score = gradePicks(f.row.picks, f.row.week_number);
    base.w += score.correct;
    base.l += score.incorrect;
  });
  const list = Object.values(bases).map(b => ({ ...b, fans: b.names.size }));
  const fansWord = n => `${n} fan${n === 1 ? "" : "s"}`;

  const ranked = list.filter(b => b.fans >= 2 && b.w + b.l > 0)
    .map(b => ({ ...b, pct: b.w / (b.w + b.l) }))
    .sort((x, y) => (y.pct - x.pct) || (y.w - x.w) || (y.fans - x.fans));
  const baseLine = b => `${record(b.w, b.l)} · ${fansWord(b.fans)}`;
  if (ranked.length) show("Best", teamHtml(ranked[0].team), baseLine(ranked[0]));
  else show("Best", "--", list.length ? "Awaiting results" : noFavorites);
  if (ranked.length > 1) show("Worst", teamHtml(ranked[ranked.length - 1].team), baseLine(ranked[ranked.length - 1]));
  else show("Worst", "--", list.length ? "Awaiting results" : noFavorites);

  const biggest = [...list].sort((x, y) => (y.fans - x.fans) || x.team.name.localeCompare(y.team.name))[0];
  if (biggest) show("Biggest", teamHtml(biggest.team), season ? fansWord(biggest.fans) : `${fansWord(biggest.fans)} played`);
  else show("Biggest", "--", noFavorites);
}

// This week's three cards above the cousins' picks. All work as soon as
// picks come in, before any game is played.
function renderWeekCards(games, cousinRows) {
  const box = document.getElementById("weekFanStats");
  if (!box) return;
  const card = (label, stat, desc) => `<div class="pulse-card">
      <div class="pulse-label">${label}</div>
      <div class="pulse-stat">${stat}</div>
      <div class="pulse-desc">${escapeHtml(desc)}</div>
    </div>`;

  // Homer Rate: fans whose team played who picked their own team.
  let backed = 0, playing = 0;
  cousinRows.forEach(r => {
    const team = (playerFavorites[(r.user_name || "").toLowerCase()] || {}).cfb;
    if (!team || !team.name) return;
    const mine = normalizeTeam(team.name);
    const game = games.find(g => normalizeTeam(g.teamA) === mine || normalizeTeam(g.teamB) === mine);
    const pick = game && getMatchedUserPick(parseUserPicks(r.picks), game);
    if (!pick) return;
    playing++;
    if (normalizeTeam(pick) === mine) backed++;
  });
  const homer = playing
    ? card("Homer Rate", `${Math.round(backed / playing * 100)}%`, `${backed} of ${playing} picked their team`)
    : card("Homer Rate", "--", "Picked their own team");

  // Toss-Up: the game the cousins are most evenly split on.
  // Chalk Meter: share of picks that went with the betting favorite.
  let tossUp = null, chalkTotal = 0, chalkPicks = 0;
  games.forEach(g => {
    let a = 0, b = 0;
    const fav = lineFavorite(g);
    cousinRows.forEach(r => {
      const pick = getMatchedUserPick(parseUserPicks(r.picks), g);
      if (!pick) return;
      const n = normalizeTeam(pick);
      if (n === normalizeTeam(g.teamA)) a++;
      else if (n === normalizeTeam(g.teamB)) b++;
      if (fav) {
        chalkTotal++;
        if (n === normalizeTeam(fav.team)) chalkPicks++;
      }
    });
    if (a + b && (!tossUp || Math.abs(a - b) / (a + b) < tossUp.gap)) tossUp = { g, a, b, gap: Math.abs(a - b) / (a + b) };
  });
  const toss = tossUp
    ? card("Toss-Up Game", `${Math.round(tossUp.a / (tossUp.a + tossUp.b) * 100)}-${Math.round(tossUp.b / (tossUp.a + tossUp.b) * 100)}`,
        `${shortenPickDisplay(tossUp.g.teamA)} vs ${shortenPickDisplay(tossUp.g.teamB)}`)
    : card("Toss-Up Game", "--", "Closest split");
  const chalkPct = chalkTotal ? Math.round(chalkPicks / chalkTotal * 100) : null;
  const chalk = chalkPct !== null
    ? card("Chalk Meter", `${chalkPct}%`, `Picked the favorite · ${100 - chalkPct}% upsets`)
    : card("Chalk Meter", "--", "No lines yet");

  box.innerHTML = `<div class="pulse-grid">${homer}${toss}${chalk}</div>`;
}

// Once the account loads (common.js), show their team.
function onAccountReady() { renderMyTeam(); }

// The season's year: games from August on belong to that year's season.
function seasonYear() {
  const d = new Date();
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
}

async function renderActiveWeek() {
  if (!weekSchedules[activeWeek] || weekSchedules[activeWeek].length === 0) {
    await fetchEspnSchedule(activeWeek);
  }

  const games = weekSchedules[activeWeek] || [];
  const rows = allWeekRows.filter(r => r.week_number === activeWeek);
  const hostRows = rows.filter(r => r.is_host === true);
  const cousinRows = rows.filter(r => r.is_host === false);
  const isLockActiveThisWeek = isLockWeek(activeWeek);

  setText("entryPill", `${cousinRows.length} Entries`);
  renderHostGrid(games, hostRows, cousinRows, isLockActiveThisWeek);
  renderCousinList(games, cousinRows, isLockActiveThisWeek);
  renderPerTeamView(games, cousinRows);
  renderWeekCards(games, cousinRows);
  renderFanStats("seasonFanStats", allWeekRows.filter(r => !r.is_host), true);
  setText("fanShowdownTitle", `${seasonYear()} Fanbase Showdown`);
  // Guests from before the site had no favorite teams to compare, and one
  // guest a week leaves nothing for the players' picks card to show.
  if (GUEST_SEASON) {
    document.getElementById("fanShowdownTitle").closest(".card").style.display = "none";
    document.getElementById("weekCousinsTitle").closest(".card").style.display = "none";
  }
  renderMyTeam();
  computeSeasonTotals();
}

function toggleTierExpand(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const isOpen = grid.classList.toggle("open");
  const arrow = grid.parentElement.querySelector(".tier-toggle-arrow");
  if (arrow) arrow.innerHTML = isOpen ? "&minus;" : "+";
}

let picksViewMode = "cousin";
// Every SEC team seen on any week's scoreboard that isn't playing this week.
function getSecByeTeams(games) {
  const directory = {};
  Object.values(espnRawCache).forEach(entry => {
    const events = (entry && entry.data && entry.data.events) || [];
    events.forEach(ev => {
      const comp = (ev.competitions || [])[0];
      if (!comp) return;
      (comp.competitors || []).forEach(c => {
        const t = c.team || {};
        const name = cleanTeamName(t.shortDisplayName || t.name);
        if (!name || !isSecTeam(name)) return;
        const key = normalizeTeam(name);
        if (!directory[key]) directory[key] = { id: t.id || "", name, logo: teamLogoFrom(t) };
      });
    });
  });

  const playing = new Set();
  games.forEach(g => {
    playing.add(normalizeTeam(g.teamA));
    playing.add(normalizeTeam(g.teamB));
  });

  return Object.keys(directory)
    .filter(key => !playing.has(key))
    .map(key => directory[key])
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Each week's date range and most common game day, from the scoreboards
// already loaded. Places games without a week number, and byes.
function getWeekWindows() {
  const out = [];
  for (const w of WEEK_NUMS) {
    const entry = espnRawCache[w];
    const events = (entry && entry.data && entry.data.events) || [];
    const times = events.map(ev => new Date((ev.competitions && ev.competitions[0] && ev.competitions[0].date) || ev.date))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a - b);
    if (times.length === 0) continue;

    const counts = {};
    times.forEach(d => {
      const key = d.toDateString();
      counts[key] = (counts[key] || 0) + 1;
    });
    const modalKey = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    out.push({ week: w, min: times[0], max: times[times.length - 1], modal: new Date(modalKey) });
  }
  return out;
}

// The current week runs until midnight after its last kickoff (no
// game-length buffer, which could push a late Saturday kickoff past midnight).
startLeaderboard(lastKickoff => nextDayStart(lastKickoff));

// The playoff bracket starts open in the Info Hub.
showRankTab("cfp");
