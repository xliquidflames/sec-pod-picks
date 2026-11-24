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

  const headRow = document.querySelector(".host-grid-table thead tr");
  headRow.insertAdjacentHTML("beforeend",
    SITE.hosts.map((h, i) => `<th id="thHost${i}">${h}</th>`).join("") + `<th id="thPlayers">${SITE.players.many}</th>`);
  document.querySelector("#hostGridBody td").colSpan = SITE.hosts.length + 2;
})();

// Team schedules highlight the week being shown and place games by date.
scheduleOptions.currentWeek = () => activeWeek;
scheduleOptions.weekWindows = getWeekWindows;
scheduleOptions.estimateByes = false;

// "Details" opens the game details in a row right under the game.
function detailsLink(g) {
  if (!g.eventId) return "";
  return `<button type="button" class="details-link" onclick="toggleInlineDetails(this, '${g.eventId}')">Details &#9662;</button>`;
}

function toggleInlineDetails(btn, eventId) {
  const tr = btn.closest("tr");
  const open = tr.nextElementSibling;
  if (open && open.classList.contains("inline-details-row")) {
    open.remove();
    tr.classList.remove("details-open");
    btn.innerHTML = "Details &#9662;";
    return;
  }
  const row = document.createElement("tr");
  row.className = "inline-details-row";
  row.innerHTML = `<td colspan="${SITE.hosts.length + 2}"><div class="inline-details"></div>
    <button type="button" class="details-link inline-details-close">Hide Details &#9652;</button></td>`;
  row.querySelector(".inline-details-close").onclick = () => {
    toggleInlineDetails(btn, eventId);
    tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  tr.after(row);
  tr.classList.add("details-open");
  btn.innerHTML = "Hide &#9652;";
  renderGameDetails(row.querySelector(".inline-details"), eventId);
}

function toggleAllInlineDetails(open) {
  document.querySelectorAll("#hostGridBody .details-link:not(.inline-details-close)").forEach(btn => {
    if (btn.closest("tr").classList.contains("details-open") !== open) btn.click();
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

      // One short line under the logos: kickoff time before the game,
      // otherwise each team's score under its logo with the status between.
      let detail = "TBD";
      if (isFinal || isLive) {
        const st = comp.status || {};
        const status = isFinal
          ? ((st.period || 0) > 4 ? "F/OT" : "Final")
          : (/half/i.test((st.type && st.type.detail) || "") ? "Half" : ((st.period || 0) > 4 ? "OT" : `Q${st.period || 1}`));
        const scoreSpan = c => `<span class="matchup-score ${c.winner === true ? "won" : ""}">${c.score !== undefined ? c.score : ""}</span>`;
        detail = `<span class="matchup-score-row">${scoreSpan(away)}<span class="matchup-status">${status}</span>${scoreSpan(home)}</span>`;
      } else if (comp.date) {
        // The date is on the day divider row, so just the time and TV:
        // "12PM on ABC", "3:30PM on SECN".
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

// Wording for "you" on a listener's own card, or a name in a host's stats.
const YOU = { subj: "you", take: "take", tie: "tie", pull: "pull", poss: "Your" };
const voiceOf = name => ({ subj: name, take: "takes", tie: "ties", pull: "pulls", poss: "Their" });

// everyone: [{ name, correct, incorrect }] for the season. picksFor(name)
// gives that entrant's picks for the week being shown, or null.
function pathsAmong(everyone, picksFor, games, voice) {
  const result = {};
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
    const myPicks = picksFor(p.name);
    const v = voice(p.name);
    let worst = null;

    leaders.forEach(L => {
      const theirPicks = picksFor(L.name);
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
      line = `${head}. No swing games left this week. ${v.poss} open picks all match.`;
    } else if (outcome === "pass") {
      line = `${head} · ${gamesWord(s)} left. Win ${winAll} and ${v.subj} ${v.take} first.`;
    } else if (outcome === "tie") {
      line = `${head} · ${gamesWord(s)} left. Win ${winAll} and ${v.subj} ${v.tie} for first.`;
    } else if (outcome === "evenWins") {
      line = `${head} · ${gamesWord(s)} left. Win ${winAll} and ${v.subj} ${v.pull} even on wins, but ${leaders.length === 1 ? leader.name : "first"} still has fewer losses.`;
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
  header("thPlayers", SITE.players.many, consensus);

  const hostBody = document.getElementById("hostGridBody");
  hostBody.innerHTML = "";
  const liveMap = liveGames[activeWeek] || {};

  games.forEach((g, idx) => {
    const divider = dayDividerLabel(games, idx);
    if (divider) {
      const dividerTr = document.createElement("tr");
      dividerTr.innerHTML = `
        <td colspan="${SITE.hosts.length + 2}" style="text-align: center; padding: 0.4rem; font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent-gold);">
          ${divider}
        </td>
      `;
      hostBody.appendChild(dividerTr);
    }

    // Predicted scores are saved in teamA/teamB order but shown in the
    // matchup's own away-home order, like the live score.
    const teamAIsAway = normalizeTeam(g.teamA) === normalizeTeam(g.awayName);
    const hostCell = ({ picks, scores }) => {
      const pick = getMatchedUserPick(picks, g) || "-";
      const s = scores[g.matchupKey] || scores[g.id] || scores[String(g.id)];
      const scoreText = (!s || s.teamA === undefined || s.teamB === undefined || s.teamA === "") ? ""
        : teamAIsAway ? `${s.teamA}-${s.teamB}` : `${s.teamB}-${s.teamA}`;
      const isLock = isLockActiveThisWeek && isLockMatch(picks, g);
      const pickClass = getPickClass(pick, g, activeWeek);
      const isTriple = isTriplePerfect(s, pickClass, isLock, g);
      return `
      <td class="pick-cell ${pickClass} ${isLock ? 'host-lock-cell' : ''} ${isTriple ? 'triple-perfect-cell' : ''}">
        ${buildPickCellInner(shortenPickDisplay(pick), scoreText, isLock, isTriple)}
      </td>`;
    };

    const majorityPick = computeMajorityPick(cousinRows, g);
    const classCousins = majorityPick ? getPickClass(majorityPick.team, g, activeWeek) : "";

    const tr = document.createElement("tr");
    tr.dataset.teams = [g.teamA, g.teamB].map(normalizeTeam).join("|");
    if (liveMap[g.matchupKey] || liveMap[g.id]) tr.classList.add("live-game-row");
    tr.innerHTML = `
      <td class="matchup-cell">
        ${g.matchupLabel}
        ${g.detail ? `<span class="matchup-subdetail">${g.detail}</span>` : ''}
        ${detailsLink(g)}
      </td>
      ${hosts.map(hostCell).join("")}
      <td class="pick-cell ${classCousins}">
        ${majorityPick ? shortenPickDisplay(majorityPick.team) : '<span class="matchup-subdetail" style="margin-top:0;">No picks yet</span>'}
        ${majorityPick ? `<span class="host-predicted-score">${majorityPick.percentage}%</span>` : ''}
      </td>
    `;
    hostBody.appendChild(tr);
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

// Weekly records, Lock record, and best and toughest team to pick (3+
// decided picks) across one entrant's rows.
function breakdownOf(rows) {
  const b = { weeks: [], lockC: 0, lockI: 0, teams: {} };
  rows.forEach(row => {
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

  b.weeks.sort((x, y) => x.week - y.week);
  const pct = t => t.w / (t.w + t.l);
  const eligible = Object.values(b.teams).filter(t => t.w + t.l >= 3);
  b.best = eligible.slice().sort((x, y) => (pct(y) - pct(x)) || (y.w - x.w))[0] || null;
  const worst = eligible.slice().sort((x, y) => (pct(x) - pct(y)) || (y.l - x.l))[0] || null;
  b.worst = worst && worst !== b.best && worst.l > 0 ? worst : null;
  return b;
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
