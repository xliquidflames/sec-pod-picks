// hoopsindex.html's own code, moved out of the page. Loaded at the end of the
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

// One dropdown option per week, with its Monday-Sunday dates.
(function buildWeekOptions() {
  const md = d => d.toLocaleDateString([], { month: "numeric", day: "numeric" });
  document.getElementById("mainWeekSelect").innerHTML = WEEK_NUMS.map(w => {
    const { start, end } = weekRange(w);
    return `<option value="${w}">${weekName(w)} · ${md(start)}–${md(end)}</option>`;
  }).join("");
})();

// Team schedules highlight the week being shown.
scheduleOptions.currentWeek = () => activeWeek;

// A team logo, with the name as a fallback if the image fails to load.
// attrs (data-team-*) make it open that team's schedule when tapped.
function teamLogoHtml(name, logo, isSec, attrs = "") {
  const fallbackClass = `matchup-team-fallback ${isSec ? "matchup-sec-team" : "matchup-other-team"}`;
  return logo
    ? `<img src="${logo}" alt="${name}" title="${name}" class="matchup-team-logo" ${attrs} onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';"><span class="${fallbackClass}" ${attrs} style="display:none;">${name}</span>`
    : `<span class="${fallbackClass}" ${attrs}>${name}</span>`;
}

// "Details" link that opens the game details popup.
function detailsLink(g) {
  if (!g.eventId) return "";
  const title = `${shortenPickDisplay(g.awayName)} @ ${shortenPickDisplay(g.homeName)}`.replace(/'/g, "\\'");
  return `<button type="button" class="details-link" onclick="openGameDetails('${g.eventId}', '${title}')">Details</button>`;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hasRealKickoff = g => g.kickoff && g.kickoff.getFullYear() < 9999;
const localDateKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// "TUESDAY 11/3" when game idx is the first of its calendar day, else null.
function dayDividerLabel(games, idx) {
  const g = games[idx];
  if (!hasRealKickoff(g)) return null;
  const prev = games[idx - 1];
  if (prev && hasRealKickoff(prev) && localDateKey(prev.kickoff) === localDateKey(g.kickoff)) return null;
  return `${DAY_NAMES[g.kickoff.getDay()]} ${g.kickoff.toLocaleDateString([], { month: "numeric", day: "numeric" })}`;
}

function toggleHostGrid() {
  const wrapper = document.getElementById("hostGridWrapper");
  const arrow = document.getElementById("hostGridArrow");
  if (!wrapper) return;
  const isCollapsed = wrapper.classList.toggle("collapsed");
  if (arrow) arrow.innerHTML = isCollapsed ? "&#9656;" : "&#9662;";
}

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

      // One short line under the logos: kickoff time before the game,
      // otherwise each team's score under its logo with the status between.
      // Only real halftime. ESPN's detail also says "2nd Half" during
      // the second half and "End of 2nd Half" before the final.
      const halftime = st => (st.type && st.type.name) === "STATUS_HALFTIME" ||
        /^halftime$/i.test(((st.type && (st.type.shortDetail || st.type.detail)) || "").trim());
      let detail = "TBD";
      if (isFinal || isLive) {
        const st = comp.status || {};
        const status = isFinal
          ? ((st.period || 0) > 2 ? "F/OT" : "Final")
          : halftime(st) ? "Half" : ((st.period || 0) > 2 ? "OT" : `${st.period || 1}H`);
        const scoreSpan = c => `<span class="matchup-score ${c.winner === true ? "won" : ""}">${c.score !== undefined ? c.score : ""}</span>`;
        detail = `<span class="matchup-score-row">${scoreSpan(away)}<span class="matchup-status">${status}</span>${scoreSpan(home)}</span>`;
      } else if (comp.date) {
        // The date is on the day divider row, so just the time and TV:
        // "7PM on SECN", "8:30PM on ESPN2".
        const kick = new Date(comp.date);
        const time = `${kick.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
          .replace(":00", "").replace(/\s+/g, "")} ${tzAbbr(kick)}`.trim();
        const tv = shortNetwork(comp);
        detail = tv ? `${time} on ${tv}` : time;
      }

      let kickoff = new Date(8640000000000000);
      if (comp.date) {
        const kd = new Date(comp.date);
        if (!isNaN(kd.getTime())) kickoff = kd;
      }

      const rawOdds = comp.odds && comp.odds[0]?.details ? comp.odds[0].details : "";
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
        homeScore
      };
    });

    return storeWeek(week, games);
  } catch (e) {
    console.error("ESPN schedule error:", e);
    return [];
  }
}

// The favorite named in the betting line ("ALA -7.5") and its spread, or null.
function lineFavorite(game) {
  const rawOdds = game.rawOdds || "";
  if (!rawOdds || rawOdds.toLowerCase().includes("even") || rawOdds.toLowerCase().includes("pk")) return null;
  const match = rawOdds.match(/([A-Za-z&\s]+)\s+([+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const favNorm = normalizeTeam(match[1].trim());
  const spread = parseFloat(match[2]);
  for (const team of [game.teamA, game.teamB]) {
    const norm = normalizeTeam(team);
    if (norm === favNorm || favNorm.includes(norm) || norm.includes(favNorm)) return { team, spread };
  }
  return null;
}

// Season records for the podium.
function computeSeasonTotals() {
  const cousinTotals = {};
  let anyDecidedGames = false;

  allWeekRows.forEach(row => {
    if (row.is_host) return;
    const score = gradePicks(row.picks, row.week_number);
    if (score.correct > 0 || score.incorrect > 0) anyDecidedGames = true;
    if (!cousinTotals[row.user_name]) cousinTotals[row.user_name] = { user_name: row.user_name, correct: 0, incorrect: 0 };
    cousinTotals[row.user_name].correct += score.correct;
    cousinTotals[row.user_name].incorrect += score.incorrect;
  });

  renderPodium(Object.values(cousinTotals), anyDecidedGames, { namesOpen: true, noun: SITE.players.many });
}

async function switchWeek(weekNum) {
  activeWeek = weekNum;

  const dropdown = document.getElementById("mainWeekSelect");
  if (dropdown) dropdown.value = weekNum;

  document.getElementById("weekHostTitle").textContent = `${weekName(weekNum)} Info Hub`;
  document.getElementById("weekCousinsTitle").textContent = `The ${possessive(SITE.players.many)} ${weekName(weekNum)} Picks`;

  updateSubmitButton(weekNum, "hoopsmakepicks.html");
  pointToNextWeek(weekNum);

  await renderActiveWeek();
}

// ---- Next week's picks ----
// Hoops weeks run into each other (and tournament games get set a day
// ahead), so next week's picks open early: going ahead to next week with
// the arrows shows its picks button, and once every game this week has
// tipped, this week's button points to next week instead.
const NEXT_WEEK_PAGE = "hoopsmakepicks.html";
const hasGamesLeft = w => (weekSchedules[w] || []).some(g => hasRealKickoff(g) && g.kickoff > new Date());
const nextWeekOpen = w => w === CURRENT_OPEN_WEEK + 1 && hasGamesLeft(w);
{
  const basePicksOpen = picksOpen;
  picksOpen = w => basePicksOpen(w) || nextWeekOpen(w);
}

function pointToNextWeek(weekNum) {
  const next = CURRENT_OPEN_WEEK + 1;
  if (weekNum !== CURRENT_OPEN_WEEK || hasGamesLeft(weekNum) || !nextWeekOpen(next)) return;
  const ctaBtn = document.getElementById("ctaBtn");
  ctaBtn.style.display = "flex";
  ctaBtn.innerHTML = `<span>Make ${weekName(next)} Picks &rarr;</span>`;
  ctaBtn.href = `${NEXT_WEEK_PAGE}?week=${next}`;
  supabaseClient.auth.getSession().then(({ data }) => {
    if (data && data.session) return;
    ctaBtn.innerHTML = `<span>Sign In &amp; Make ${weekName(next)} Picks &rarr;</span>`;
    ctaBtn.href = signInUrl(`${NEXT_WEEK_PAGE}?week=${next}`);
  }).catch(() => {});
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
  const result = {};

  const season = {};
  allWeekRows.forEach(row => {
    if (row.is_host) return;
    const s = gradePicks(row.picks, row.week_number);
    if (!season[row.user_name]) season[row.user_name] = { name: row.user_name, correct: 0, incorrect: 0 };
    season[row.user_name].correct += s.correct;
    season[row.user_name].incorrect += s.incorrect;
  });

  const everyone = Object.values(season);
  if (!everyone.some(p => p.correct > 0 || p.incorrect > 0)) return result;

  const better = (a, b) => a.correct !== b.correct ? a.correct > b.correct : a.incorrect < b.incorrect;
  let top = everyone[0];
  everyone.forEach(p => { if (better(p, top)) top = p; });
  const leaders = everyone.filter(p => p.correct === top.correct && p.incorrect === top.incorrect);
  const leaderNames = new Set(leaders.map(l => l.name));

  // Best record outside the leader group, for "up by".
  let second = null;
  everyone.filter(p => !leaderNames.has(p.name)).forEach(p => { if (!second || better(p, second)) second = p; });

  const openGames = games.filter(g => !winnerOf(activeWeek, g));
  const weekPicksFor = (name) => {
    const row = allWeekRows.find(r => !r.is_host && r.week_number === activeWeek && r.user_name === name);
    return row ? parseUserPicks(row.picks) : null;
  };

  // Outcomes of winning every swing game, worst to best.
  const OUTCOME_RANK = { short: 0, evenWins: 1, tie: 2, pass: 3 };

  everyone.forEach(p => {
    if (leaderNames.has(p.name)) {
      if (leaders.length > 1) {
        result[p.name] = { isLeader: true, chip: "Tied 1st", line: `Tied for first with ${leaders.length - 1} other${leaders.length === 2 ? "" : "s"}.` };
      } else if (!second) {
        result[p.name] = { isLeader: true, chip: "1st", line: "In first." };
      } else {
        const lead = p.correct - second.correct;
        result[p.name] = { isLeader: true, chip: "1st", line: lead > 0 ? `In first, up by ${lead}.` : "In first on fewer losses." };
      }
      return;
    }

    // Measured against whichever leader is hardest to pass.
    const myPicks = weekPicksFor(p.name);
    let worst = null;

    leaders.forEach(L => {
      const theirPicks = weekPicksFor(L.name);
      const swingGames = [];
      let theyTakeLoss = 0;

      if (myPicks) {
        openGames.forEach(g => {
          const mine = getMatchedUserPick(myPicks, g);
          if (!mine) return;
          const theirs = theirPicks ? getMatchedUserPick(theirPicks, g) : null;
          if (theirs && normalizeTeam(theirs) === normalizeTeam(mine)) return;
          swingGames.push(g);
          if (theirs) theyTakeLoss++;
        });
      }

      const winsBack = L.correct - p.correct;
      const s = swingGames.length;
      const lossDiff = p.incorrect - (L.incorrect + theyTakeLoss);
      let outcome;
      if (s > winsBack) outcome = "pass";
      else if (s < winsBack) outcome = "short";
      else if (lossDiff < 0) outcome = "pass";
      else if (lossDiff === 0) outcome = "tie";
      else outcome = "evenWins";

      if (!worst || OUTCOME_RANK[outcome] < OUTCOME_RANK[worst.outcome] ||
          (outcome === worst.outcome && s < worst.swingGames.length)) {
        worst = { leader: L, swingGames, winsBack, outcome, leaderPicked: !!theirPicks };
      }
    });

    const { leader, swingGames, winsBack, outcome, leaderPicked } = worst;
    const who = leaders.length === 1 ? leader.name
      : leaders.length === 2 ? `${leaders[0].name} and ${leaders[1].name}`
      : "first";
    const s = swingGames.length;
    const gamesWord = n => `${n} swing game${n === 1 ? "" : "s"}`;
    const winAll = s === 1 ? "it" : s === 2 ? "both" : `all ${s}`;
    const head = winsBack > 0 ? `${winsBack} back of ${who}` : `Even on wins with ${who}`;

    let line;
    if (!myPicks || openGames.length === 0) {
      line = winsBack > 0 ? `${head}.` : `${head}, behind on losses.`;
    } else if (!leaderPicked && leaders.length === 1) {
      line = `${head}. ${leader.name} hasn't picked this week yet.`;
    } else if (s === 0) {
      line = `${head}. No swing games left this week. Your open picks all match.`;
    } else if (outcome === "pass") {
      line = `${head} · ${gamesWord(s)} left. Win ${winAll} and you take first.`;
    } else if (outcome === "tie") {
      line = `${head} · ${gamesWord(s)} left. Win ${winAll} and you tie for first.`;
    } else if (outcome === "evenWins") {
      line = `${head} · ${gamesWord(s)} left. Win ${winAll} and you pull even on wins, but ${leaders.length === 1 ? leader.name : "first"} still has fewer losses.`;
    } else {
      line = `${head} · only ${gamesWord(s)} left this week. Best case: ${winsBack - s} back.`;
    }

    result[p.name] = {
      isLeader: false,
      chip: winsBack > 0 ? `${winsBack} back` : "Even on wins",
      line,
      swingKeys: new Set(swingGames.map(g => g.matchupKey))
    };
  });

  return result;
}

// Once the account loads (common.js), show their team.
function onAccountReady() { renderMyTeam(); }

// Week Info Hub: this week's games, two to a row, under a divider for
// each new day.
function renderGamesGrid(games) {
  const grid = document.getElementById("hostGridWrapper");
  if (games.length === 0) {
    grid.innerHTML = `<div class="hoops-empty">No games scheduled for ${weekName(activeWeek)} yet.</div>`;
    return;
  }
  const liveMap = liveGames[activeWeek] || {};
  // Finished days fold up behind a +. Every game today is a full card, live
  // ones in the gold box. Later days are slim rows, open by default.
  const midnight = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayKey = midnight(new Date());
  const dayOf = g => hasRealKickoff(g) ? midnight(g.kickoff) : null;
  const days = [];
  games.forEach((g, idx) => {
    const key = dayOf(g);
    const last = days[days.length - 1];
    if (last && last.key === key) last.games.push(g);
    else days.push({ key, label: dayDividerLabel(games, idx), games: [g] });
  });

  const rowAttrs = g => {
    const open = g.eventId ? ` onclick="openGameDetails('${g.eventId}', '${`${shortenPickDisplay(g.awayName)} @ ${shortenPickDisplay(g.homeName)}`.replace(/'/g, "\\'")}')"` : "";
    return `data-teams="${[g.teamA, g.teamB].map(normalizeTeam).join("|")}"${open}`;
  };
  const side = (name, logo, score, other) => {
    const won = score !== null && other !== null && score > other ? "won" : "";
    return `<span class="done-side">
        ${logo ? `<img class="fav-logo" src="${logo}" alt="">` : ""}
        <span class="done-name">${escapeHtml(shortenPickDisplay(name))}</span>
        ${score !== null && score !== undefined ? `<span class="done-score ${won}">${score}</span>` : ""}
      </span>`;
  };
  // Finished: logo, team, score @ logo, team, score.
  const doneRow = g => `
    <div class="hoops-done-row" ${rowAttrs(g)}>
      ${side(g.awayName, g.awayLogo, g.awayScore, g.homeScore)}
      <span class="done-at">@</span>
      ${side(g.homeName, g.homeLogo, g.homeScore, g.awayScore)}
    </div>`;
  // Coming up: the same slim row, with the tip-off time under it.
  const timeOf = g => hasRealKickoff(g)
    ? g.kickoff.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(":00", "")
    : "TBD";
  const upcomingRow = g => `
    <div class="hoops-done-row is-upcoming-row" ${rowAttrs(g)}>
      ${side(g.awayName, g.awayLogo, null, null)}
      <span class="done-at">@</span>
      ${side(g.homeName, g.homeLogo, null, null)}
      <span class="upcoming-time">${timeOf(g)}</span>
    </div>`;
  const card = g => {
    const live = g.isLive || liveMap[g.matchupKey] || liveMap[g.id];
    return `
      <div class="hoops-game matchup-cell is-today ${live ? "live-game-row" : ""}" data-teams="${[g.teamA, g.teamB].map(normalizeTeam).join("|")}">
        ${g.matchupLabel}
        ${g.detail ? `<span class="matchup-subdetail">${g.detail}</span>` : ""}
        ${detailsLink(g)}
      </div>`;
  };

  grid.innerHTML = days.map(day => {
    const isToday = day.key === todayKey;
    const past = day.key !== null && day.key < todayKey;
    const future = day.key !== null && day.key > todayKey;
    const allDone = day.games.every(g => g.isFinal);

    if (isToday) {
      // Every game today gets the full card, finished ones included.
      return `<div class="hoops-day today">Today · ${day.label}</div>
        ${day.games.map(card).join("")}`;
    }
    if ((past && allDone) || future) {
      const id = String(day.key);
      if (!(id in openGameDays)) openGameDays[id] = future;
      const open = openGameDays[id];
      const count = `${day.games.length} game${day.games.length === 1 ? "" : "s"}`;
      return `<button type="button" class="hoops-day day-toggle" onclick="toggleGameDay('${id}')">
          <span>${day.label}</span><span class="day-count">${count}</span><span class="day-sign">${open ? "−" : "+"}</span>
        </button>
        <div class="day-games" data-day="${id}" ${open ? "" : "hidden"}>
          ${day.games.map(g => g.isFinal ? doneRow(g) : upcomingRow(g)).join("")}
        </div>`;
    }
    // A past day with a game still unfinished, or games with no date yet.
    return `<div class="hoops-day">${day.label || "Date TBD"}</div>
      ${day.games.map(g => g.isFinal ? doneRow(g) : card(g)).join("")}`;
  }).join("");
}

// Which collapsible days are open, kept while the page is open.
const openGameDays = {};
function toggleGameDay(id) {
  openGameDays[id] = !openGameDays[id];
  const box = document.querySelector(`.day-games[data-day="${id}"]`);
  if (box) box.hidden = !openGameDays[id];
  const btn = box && box.previousElementSibling;
  const sign = btn && btn.querySelector(".day-sign");
  if (sign) sign.textContent = openGameDays[id] ? "−" : "+";
}

// Each cousin's season so far: record by week, Lock of the Week record,
// and the teams they've done best and worst picking (3+ decided picks).
function computeSeasonBreakdowns() {
  const out = {};
  allWeekRows.forEach(row => {
    if (row.is_host) return;
    const b = out[row.user_name] || (out[row.user_name] = { weeks: [], lockC: 0, lockI: 0, teams: {} });
    const score = gradePicks(row.picks, row.week_number);
    if (score.correct + score.incorrect > 0) b.weeks.push({ week: row.week_number, c: score.correct, i: score.incorrect });
    b.lockC += score.lockCorrect;
    b.lockI += score.lockIncorrect;

    const picks = parseUserPicks(row.picks);
    (weekSchedules[row.week_number] || []).forEach(g => {
      const winner = winnerOf(row.week_number, g);
      const pick = getMatchedUserPick(picks, g);
      if (!winner || !pick) return;
      const key = normalizeTeam(pick);
      const t = b.teams[key] || (b.teams[key] = { name: pick, w: 0, l: 0 });
      if (key === normalizeTeam(winner)) t.w++;
      else t.l++;
    });
  });

  Object.values(out).forEach(b => {
    b.weeks.sort((x, y) => x.week - y.week);
    const pct = t => t.w / (t.w + t.l);
    const eligible = Object.values(b.teams).filter(t => t.w + t.l >= 3);
    b.best = eligible.slice().sort((x, y) => (pct(y) - pct(x)) || (y.w - x.w))[0] || null;
    const worst = eligible.slice().sort((x, y) => (pct(x) - pct(y)) || (y.l - x.l))[0] || null;
    b.worst = worst && worst !== b.best && worst.l > 0 ? worst : null;
  });
  return out;
}

function seasonBoxHtml(b, name) {
  if (!b || b.weeks.length === 0) return "";
  const facts = [];
  if (b.lockC + b.lockI > 0) facts.push(`Locks: ${b.lockC}-${b.lockI}`);
  if (b.best) facts.push(`Best pick: ${shortenPickDisplay(b.best.name)} ${b.best.w}-${b.best.l}`);
  if (b.worst) facts.push(`Toughest: ${shortenPickDisplay(b.worst.name)} ${b.worst.w}-${b.worst.l}`);
  return `
    <div class="season-box">
      <span class="path-line-label">Season So Far</span>
      <div class="season-weeks">${b.weeks.map(w => `<span class="season-week">W${w.week} ${w.c}-${w.i}</span>`).join("")}</div>
      ${championWeeksHtml(name)}
      ${facts.length ? `<div>${facts.join(" · ")}</div>` : ""}
    </div>`;
}

function renderCousinList(games, cousinRows, isLockActiveThisWeek) {
  // Correct picks, then Lock of the Week hits, then name.
  // Everyone on the same number of wins shares a rank, with no gaps.
  cousinRows.forEach(c => c.score = gradePicks(c.picks, activeWeek));
  cousinRows.sort((a, b) => {
    if (b.score.correct !== a.score.correct) return b.score.correct - a.score.correct;
    if (isLockActiveThisWeek && (b.score.lockCorrect !== a.score.lockCorrect)) return b.score.lockCorrect - a.score.lockCorrect;
    return a.user_name.localeCompare(b.user_name);
  });

  assignWeeklyRanks(cousinRows);

  const listContainer = document.getElementById("cousinsList");
  listContainer.innerHTML = cousinRows.length === 0
    ? `<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1.5rem 0;">No picks submitted for ${weekName(activeWeek)} yet.</div>`
    : "";

  const paths = computePathsToFirst(games);
  const seasons = computeSeasonBreakdowns();

  cousinRows.forEach(c => {
    const item = document.createElement("div");
    item.className = "cousin-item";
    item.dataset.name = c.user_name;
    const picks = parseUserPicks(c.picks);
    const hitLotw = isLockActiveThisWeek && (c.score.lockCorrect > 0);
    const path = paths[c.user_name];
    const swingKeys = (path && path.swingKeys) || new Set();

    item.innerHTML = `
      <div class="cousin-header" onclick="this.nextElementSibling.classList.toggle('open')">
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem;">
          ${c.rank === "-" ? "" : `<span class="rank-badge ${c.rankClass}">#${c.rank}</span>`}${podiumLogoHtml(c.user_name)}
          <span style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">${c.user_name}</span>
          ${hitLotw ? `<span class="lotw-hit-badge" style="font-size: 0.58rem; padding: 0.05rem 0.25rem;">LOTW <span class="lotw-check">✓</span></span>` : ''}
          <span style="font-size: 0.8rem; font-weight: 700; color: var(--accent-gold); margin-left: 0.4rem;">${c.score.correct}-${c.score.incorrect}</span>
        </div>
        <span style="color: var(--accent-gold); font-weight: bold;">+</span>
      </div>
      <div class="cousin-picks-body">
        ${cardBadgesHtml(c.user_name, path ? `<span class="path-chip ${path.isLeader ? 'leader' : ''}">${path.chip}</span>` : '')}
        ${path ? `<div class="path-line ${path.isLeader ? 'leader' : ''}"><span class="path-line-label">Path to First</span>${path.line}</div>` : ''}
        ${seasonBoxHtml(seasons[c.user_name], c.user_name)}
        ${games.map(g => {
          const uPick = getMatchedUserPick(picks, g) || "No Pick";
          const isCousinLock = isLockActiveThisWeek && isLockMatch(picks, g);
          return `
            <div class="pick-line ${isCousinLock ? 'host-lock-cell' : ''}">
              <span class="pick-line-matchup">${g.matchupLabel}</span>
              <span class="${getPickClass(uPick, g, activeWeek)}">
                ${swingKeys.has(g.matchupKey) ? '<span class="swing-badge">SWING</span>' : ''}
                ${isCousinLock ? '<span class="lock-badge">LOCK</span>' : ''}
                ${shortenPickDisplay(uPick)}
              </span>
            </div>
          `;
        }).join("")}
      </div>
    `;
    listContainer.appendChild(item);
  });
  pinMyCard();
}

// The stat cards above the cousins' picks.
function renderWeekStats(games, cousinRows, isLockActiveThisWeek) {
  if (cousinRows.length === 0 || games.length === 0) {
    setText("statChalkMeter", "--");
    setText("statChalkMeterDesc", "Picked the Favorite");
    setText("statTossUp", "--");
    setText("statTossUpDesc", "Closest Split");
    setText("statLock", "--");
    setText("statLockDesc", "100% Consensus");
    return;
  }

  const lockCounts = {};
  let totalLocksPlaced = 0, locksWon = 0, locksLost = 0, locksPending = 0;
  let chalkTotal = 0, chalkPicks = 0;

  cousinRows.forEach(c => {
    const picks = parseUserPicks(c.picks);
    games.forEach(g => {
      const pick = getMatchedUserPick(picks, g);
      if (!pick) return;

      // Chalk Meter: share of picks that went with the betting favorite.
      const fav = lineFavorite(g);
      if (fav) {
        chalkTotal++;
        if (normalizeTeam(pick) === normalizeTeam(fav.team)) chalkPicks++;
      }

      if (isLockActiveThisWeek && isLockMatch(picks, g)) {
        totalLocksPlaced++;
        lockCounts[pick] = (lockCounts[pick] || 0) + 1;
        const winner = winnerOf(activeWeek, g);
        if (!winner) locksPending++;
        else if (normalizeTeam(pick) === normalizeTeam(winner)) locksWon++;
        else locksLost++;
      }
    });
  });

  if (chalkTotal > 0) {
    const chalkPct = Math.round((chalkPicks / chalkTotal) * 100);
    setText("statChalkMeter", `${chalkPct}%`);
    setText("statChalkMeterDesc", `${100 - chalkPct}% Picked Upsets`);
  } else {
    setText("statChalkMeter", "--");
    setText("statChalkMeterDesc", "No Lines Available");
  }

  // Votes per team; the most-picked team is the Consensus card.
  let topConsensusTeam = "--", maxConsensusVotes = 0;
  const teamVotes = {};
  games.forEach(g => {
    [g.teamA, g.teamB].forEach(team => {
      const count = cousinRows.filter(c => {
        const userPick = getMatchedUserPick(parseUserPicks(c.picks), g);
        return userPick && normalizeTeam(userPick) === normalizeTeam(team);
      }).length;
      teamVotes[team] = count;
      if (count > maxConsensusVotes) {
        maxConsensusVotes = count;
        topConsensusTeam = team;
      }
    });
  });
  setText("statLock", topConsensusTeam);
  setText("statLockDesc", `${Math.min(Math.round((maxConsensusVotes / cousinRows.length) * 100) || 0, 100)}% Consensus`);

  // Toss-Up: the game the cousins are most evenly split on.
  let tossUpGame = null, tossUpDiff = Infinity, tossUpCountA = 0, tossUpCountB = 0;
  games.forEach(g => {
    const countA = teamVotes[g.teamA] || 0;
    const countB = teamVotes[g.teamB] || 0;
    if (countA + countB === 0) return;
    const diff = Math.abs(countA - countB);
    if (diff < tossUpDiff) {
      tossUpDiff = diff;
      tossUpGame = g;
      tossUpCountA = countA;
      tossUpCountB = countB;
    }
  });
  if (tossUpGame) {
    const pctA = Math.round((tossUpCountA / (tossUpCountA + tossUpCountB)) * 100);
    setText("statTossUp", `${pctA}-${100 - pctA}`);
    setText("statTossUpDesc", `${shortenPickDisplay(tossUpGame.teamA)} vs ${shortenPickDisplay(tossUpGame.teamB)}`);
  } else {
    setText("statTossUp", "--");
    setText("statTossUpDesc", "Closest Split");
  }

  const lockRow = document.getElementById("lockShowcaseRow");
  if (!isLockActiveThisWeek) {
    if (lockRow) lockRow.style.display = "none";
    return;
  }
  if (lockRow) lockRow.style.display = "grid";

  let topLockedTeam = "--", maxLocks = 0;
  Object.entries(lockCounts).forEach(([team, count]) => {
    if (count > maxLocks) {
      maxLocks = count;
      topLockedTeam = team;
    }
  });
  setText("statPeoplesLock", topLockedTeam);
  setText("statPeoplesLockDesc", totalLocksPlaced > 0 ? `${maxLocks} Locks (${Math.round((maxLocks / totalLocksPlaced) * 100)}%)` : "No Locks Placed");

  const decidedLocks = locksWon + locksLost;
  if (decidedLocks > 0) {
    setText("statLockAccuracy", `${Math.round((locksWon / decidedLocks) * 100)}%`);
    setText("statLockAccuracyDesc", `${locksWon}-${locksLost}, ${locksPending} pending`);
  } else {
    setText("statLockAccuracy", totalLocksPlaced > 0 ? `${totalLocksPlaced} Locked` : "--");
    setText("statLockAccuracyDesc", totalLocksPlaced > 0 ? "Awaiting Results" : "No Locks Placed");
  }

  // Boldest Lock: the SEC underdog locked with the most points against it.
  let boldestTeam = null, boldestSpread = 0;
  Object.keys(lockCounts).forEach(team => {
    if (!isSecTeam(team)) return;
    const game = games.find(g => normalizeTeam(g.teamA) === normalizeTeam(team) || normalizeTeam(g.teamB) === normalizeTeam(team));
    const fav = game && lineFavorite(game);
    if (!fav) return;
    // Positive means the team is getting that many points.
    const spread = normalizeTeam(team) === normalizeTeam(fav.team) ? fav.spread : Math.abs(fav.spread);
    if (spread > 0 && spread > boldestSpread) {
      boldestSpread = spread;
      boldestTeam = team;
    }
  });

  if (boldestTeam) {
    setText("statLockBattle", `${shortenPickDisplay(boldestTeam)} (+${boldestSpread})`);
    setText("statLockBattleDesc", `${lockCounts[boldestTeam]} lock${lockCounts[boldestTeam] === 1 ? '' : 's'}`);
  } else {
    setText("statLockBattle", "--");
    setText("statLockBattleDesc", totalLocksPlaced > 0 ? "No Underdog Locks" : "No Locks Placed");
  }
}

async function renderActiveWeek() {
  if (!weekSchedules[activeWeek] || weekSchedules[activeWeek].length === 0) {
    await fetchEspnSchedule(activeWeek);
  }

  const games = weekSchedules[activeWeek] || [];
  const rows = allWeekRows.filter(r => r.week_number === activeWeek);
  const cousinRows = rows.filter(r => r.is_host !== true);
  const isLockActiveThisWeek = isLockWeek(activeWeek);

  setText("entryPill", `${cousinRows.length} Entries`);
  renderGamesGrid(games);
  renderTournaments(activeWeek, "tourneySection", "tourneyList");
  renderMyTeam();
  renderCousinList(games, cousinRows, isLockActiveThisWeek);
  renderPerTeamView(games, cousinRows);
  renderWeekStats(games, cousinRows, isLockActiveThisWeek);
  computeSeasonTotals();
}

function toggleTierExpand(gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const isOpen = grid.classList.toggle("open");
  const arrow = grid.parentElement.querySelector(".tier-toggle-arrow");
  if (arrow) arrow.innerHTML = isOpen ? "&minus;" : "+";
}

// Ignores case, spaces and a leading "@", like the name check on makepicks.html.
function filterCousinCards() {
  const squash = s => s.trim().toLowerCase().replace(/^@/, "").replace(/\s+/g, "");
  const query = squash(document.getElementById("cousinSearchInput").value);
  document.querySelectorAll("#cousinsList .cousin-item").forEach(card => {
    const name = (card.dataset.name || "").toLowerCase().replace(/^@/, "").replace(/\s+/g, "");
    card.style.display = (!query || name.includes(query)) ? "" : "none";
  });
}

// ---- Per Team view: the same picks grouped by game and team ----
function buildPerTeamSideHtml(logoHtml, teamName, pickerCount, score, isFinal, isWinner) {
  let scoreHtml = "";
  if (score !== null && score !== undefined) {
    scoreHtml = isFinal
      ? `<span class="per-team-score ${isWinner ? 'per-team-result-win' : 'per-team-result-loss'}">${score} ${isWinner ? '&#10003;' : '&#10007;'}</span>`
      : `<span class="per-team-score">${score}</span>`;
  }

  return `
    <span class="per-team-header-side">
      <span class="per-team-header-namerow">
        ${logoHtml}
        <span class="per-team-header-name">${teamName}</span>
      </span>
      ${scoreHtml}
      <span class="per-team-header-count">Picked ${pickerCount} time${pickerCount === 1 ? '' : 's'}</span>
    </span>
  `;
}

// One element per name so the CSS columns can balance them.
function buildPerTeamNamesHtml(names) {
  if (names.length === 0) return '<span style="color: var(--text-muted);">Nobody</span>';
  return names.map(n => `<div class="per-team-name-item">${n}</div>`).join('');
}

function renderPerTeamView(games, cousinRows) {
  const container = document.getElementById("perTeamList");
  if (!container) return;

  if (games.length === 0) {
    container.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1.5rem 0;">No games scheduled for ${weekName(activeWeek)} yet.</div>`;
    return;
  }

  container.innerHTML = games.map(g => {
    const awayPickers = [];
    const homePickers = [];
    const awayNorm = normalizeTeam(g.awayName);
    const homeNorm = normalizeTeam(g.homeName);

    cousinRows.forEach(c => {
      const pick = getMatchedUserPick(parseUserPicks(c.picks), g);
      if (!pick) return;
      const pickNorm = normalizeTeam(pick);
      if (pickNorm === awayNorm) awayPickers.push(c.user_name);
      else if (pickNorm === homeNorm) homePickers.push(c.user_name);
    });

    awayPickers.sort((a, b) => a.localeCompare(b));
    homePickers.sort((a, b) => a.localeCompare(b));

    const hasScores = g.isFinal && g.awayScore !== null && g.homeScore !== null;
    const awaySideHtml = buildPerTeamSideHtml(teamLogoHtml(g.awayName, g.awayLogo, g.awayIsSec), shortenPickDisplay(g.awayName), awayPickers.length, g.awayScore, g.isFinal, hasScores && g.awayScore > g.homeScore);
    const homeSideHtml = buildPerTeamSideHtml(teamLogoHtml(g.homeName, g.homeLogo, g.homeIsSec), shortenPickDisplay(g.homeName), homePickers.length, g.homeScore, g.isFinal, hasScores && g.homeScore > g.awayScore);

    return `
      <div class="per-team-game">
        <div class="per-team-header" onclick="this.nextElementSibling.classList.toggle('open')">
          <div class="per-team-header-matchup">
            ${awaySideHtml}
            <span class="per-team-header-at">AT</span>
            ${homeSideHtml}
          </div>
          <span class="per-team-header-expand-icon">+</span>
        </div>
        <div class="per-team-body">
          <div class="per-team-columns">
            <div class="per-team-col">
              <div class="per-team-names">${buildPerTeamNamesHtml(awayPickers)}</div>
            </div>
            <div class="per-team-col">
              <div class="per-team-names">${buildPerTeamNamesHtml(homePickers)}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function toggleAllPerTeamCards(expand) {
  document.querySelectorAll(".per-team-body").forEach(b => b.classList.toggle("open", expand));
}

let picksViewMode = "cousin";
function togglePicksView() {
  picksViewMode = picksViewMode === "cousin" ? "team" : "cousin";
  const team = picksViewMode === "team";
  document.getElementById("cousinsList").style.display = team ? "none" : "block";
  document.getElementById("perTeamList").style.display = team ? "block" : "none";
  document.getElementById("cousinViewControls").style.display = team ? "none" : "flex";
  document.getElementById("teamViewControls").style.display = team ? "flex" : "none";
  const searchWrapper = document.getElementById("cousinSearchWrapper");
  if (searchWrapper) searchWrapper.style.display = team ? "none" : "block";
}

// A week runs Monday through Sunday, so the next week takes over at
// midnight Monday after the last game.
startLeaderboard(lastTip => nextDayStart(lastTip, 1));
