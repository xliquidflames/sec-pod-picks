// nflindex.html's own code, moved out of the page. Loaded at the end of the
// page by siteScript() in load.js, after the shared files.

async function fetchEspnSchedule(week) {
  try {
    const { data } = await fetchEspnRaw(week);
    if (!data || !data.events || data.events.length === 0) return [];

    const games = [];
    data.events.forEach(ev => {
      // One malformed game is skipped instead of breaking the whole week.
      try {
        const comp = ev.competitions[0];
        const home = comp.competitors.find(c => c.homeAway === "home");
        const away = comp.competitors.find(c => c.homeAway === "away");
        const homeName = home.team.shortDisplayName || home.team.name || "";
        const awayName = away.team.shortDisplayName || away.team.name || "";

        const isFinal = comp.status && comp.status.type && comp.status.type.completed;
        const isLive = (comp.status && comp.status.type && comp.status.type.state) === "in";

        let winner = null;
        if (isFinal) {
          const winnerComp = comp.competitors.find(c => c.winner === true);
          if (winnerComp) winner = winnerComp.team.shortDisplayName || winnerComp.team.name || "";
        }

        const rawOdds = comp.odds && comp.odds[0]?.details ? comp.odds[0].details : "";
        const venue = venueText(comp);
        const scoreLine = `${away.team.abbreviation || awayName} ${away.score} - ${home.team.abbreviation || homeName} ${home.score}`;

        let time = "TBD";
        if (isFinal) {
          time = `Final: ${scoreLine}`;
        } else if (isLive) {
          time = `${comp.status.type.detail || `Period ${comp.status.period}`}: ${scoreLine}`;
        } else if (comp.date) {
          time = new Date(comp.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
        }

        let kickoff = new Date(8640000000000000);
        if (comp.date) {
          const d = new Date(comp.date);
          if (!isNaN(d.getTime())) kickoff = d;
        }

        games.push({
          matchupKey: (ev.id !== undefined && ev.id !== null) ? String(ev.id) : buildMatchupKey(awayName, homeName),
          teamA: awayName,
          teamB: homeName,
          logoA: nflLogoHtml(away.team),
          logoB: nflLogoHtml(home.team),
          kickoff,
          rawOdds,
          detail: isFinal ? "" : isLive ? `${time} | ${venue}` : `${time} | ${rawOdds || "Line: TBD"} | ${venue}`,
          winner,
          isLive,
          isFinal,
          scoreA: away.score,
          scoreB: home.score
        });
      } catch (gameErr) {
        console.error(`Skipping one malformed game in week ${week}:`, gameErr, ev);
      }
    });

    return storeWeek(week, games);
  } catch (e) {
    console.error("ESPN schedule error:", e);
    return [];
  }
}

// The favorite named in the betting line ("DAL -3.5"), or null.
function getFavoredTeam(game) {
  const rawOdds = game.rawOdds || "";
  if (!rawOdds || /even|pk/i.test(rawOdds)) return null;
  const match = rawOdds.match(/([A-Za-z\s.]+)\s+([+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const favNorm = normalizeTeam(match[1].trim());
  const aNorm = normalizeTeam(game.teamA);
  const bNorm = normalizeTeam(game.teamB);
  if (favNorm === aNorm || aNorm.includes(favNorm) || favNorm.includes(aNorm)) return game.teamA;
  if (favNorm === bNorm || bNorm.includes(favNorm) || favNorm.includes(bNorm)) return game.teamB;
  return null;
}

function computeSeasonTotals() {
  const totals = {};
  let anyDecidedGames = false;

  allWeekRows.forEach(row => {
    const score = gradePicks(row.picks, row.week_number);
    if (score.correct > 0 || score.incorrect > 0) anyDecidedGames = true;
    if (!totals[row.user_name]) totals[row.user_name] = { user_name: row.user_name, correct: 0, incorrect: 0 };
    totals[row.user_name].correct += score.correct;
    totals[row.user_name].incorrect += score.incorrect;
  });

  renderPodium(Object.values(totals), anyDecidedGames, { namesOpen: false, noun: "players" });
}

async function switchWeek(weekNum) {
  activeWeek = weekNum;

  const dropdown = document.getElementById("mainWeekSelect");
  if (dropdown) dropdown.value = weekNum;

  document.getElementById("weekScheduleTitle").textContent = `Week ${weekNum} Schedule`;
  document.getElementById("weekPicksTitle").textContent = `Week ${weekNum} Picks`;

  updateSubmitButton(weekNum, "nflmakepicks.html");

  await renderActiveWeek();
}

const DAY_GROUP_COLORS = {
  0: "#4d93a3",
  1: "#b8748f",
  2: "#94a3b8",
  3: "#94a3b8",
  4: "#8c7cc4",
  5: "#5586b3",
  6: "#5c9973"
};
const DAY_NAMES = ["Sunday", "MNF", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const hasRealKickoff = g => g.kickoff && g.kickoff.getFullYear() < 9999;
const localDateKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// Divider info when game idx is the first of its calendar day, else null.
function dayDivider(games, idx) {
  const g = games[idx];
  if (!hasRealKickoff(g)) return null;
  const prev = games[idx - 1];
  if (prev && hasRealKickoff(prev) && localDateKey(prev.kickoff) === localDateKey(g.kickoff)) return null;
  const dayNum = g.kickoff.getDay();
  return {
    color: DAY_GROUP_COLORS[dayNum],
    label: DAY_NAMES[dayNum],
    dateStr: g.kickoff.toLocaleDateString([], { month: "numeric", day: "numeric" })
  };
}

// Once the account loads (common.js), show their team.
function onAccountReady() { renderMyTeam(); renderNflYourSeason(); }

// ---- Your Season (renderYourSeason, in common.js) ----
function computePathsToFirst(games) {
  const season = {};
  allWeekRows.forEach(row => {
    const s = gradePicks(row.picks, row.week_number);
    if (!season[row.user_name]) season[row.user_name] = { name: row.user_name, correct: 0, incorrect: 0 };
    season[row.user_name].correct += s.correct;
    season[row.user_name].incorrect += s.incorrect;
  });
  const weekPicksFor = (name) => {
    const rows = allWeekRows.filter(r => r.week_number === activeWeek && r.user_name === name);
    return rows.length ? parseUserPicks(rows[rows.length - 1].picks) : null;
  };
  return pathsAmong(Object.values(season), weekPicksFor, games, () => YOU);
}

function computeSeasonBreakdowns() {
  const byName = {};
  allWeekRows.forEach(row => { (byName[row.user_name] || (byName[row.user_name] = [])).push(row); });
  return Object.fromEntries(Object.entries(byName).map(([name, rows]) => [name, breakdownOf(rows)]));
}

function renderNflYourSeason() {
  if (!allWeekRows.length) return;
  renderYourSeason(computePathsToFirst(weekSchedules[activeWeek] || []), computeSeasonBreakdowns());
}

function renderSchedule(games) {
  const container = document.getElementById("scheduleList");
  if (!container) return;

  if (games.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:1.5rem 0;">No scheduled games found for this week yet.</div>`;
    return;
  }

  const liveMap = liveGames[activeWeek] || {};

  container.innerHTML = games.map((g, idx) => {
    const isLive = liveMap[g.matchupKey] || liveMap[g.id];
    const winner = winnerOf(activeWeek, g);
    const divider = dayDivider(games, idx);

    return `
      ${divider ? `<div class="day-divider" style="color: ${divider.color};">${divider.label} ${divider.dateStr}</div>` : ''}
      <div class="schedule-row ${isLive ? 'live-row' : ''}" data-teams="${[g.teamA, g.teamB].map(normalizeTeam).join("|")}">
        <div>
          ${g.isFinal ? `
            <div class="final-label">Final</div>
            <div class="final-matchup">
              <div class="final-side ${winner && normalizeTeam(winner) === normalizeTeam(g.teamA) ? "won" : ""}">
                <div class="schedule-matchup nfl-matchup">${g.logoA}${g.teamA}</div>
                <div class="final-score">${g.scoreA}</div>
              </div>
              <span class="nfl-vs">@</span>
              <div class="final-side ${winner && normalizeTeam(winner) === normalizeTeam(g.teamB) ? "won" : ""}">
                <div class="schedule-matchup nfl-matchup">${g.logoB}${g.teamB}</div>
                <div class="final-score">${g.scoreB}</div>
              </div>
            </div>`
          : `<div class="schedule-matchup nfl-matchup">${g.logoA}${g.teamA} <span class="nfl-vs">@</span> ${g.logoB}${g.teamB}</div>`}
          ${g.detail ? `<span class="schedule-detail">${g.detail}</span>` : ''}
        </div>
        ${winner && !g.isFinal ? `<div class="schedule-winner">${winner}</div>` : ''}
      </div>
    `;
  }).join("");
}

// The stat cards above the weekly picks list.
function renderWeekStats(rows, games) {
  if (rows.length === 0 || games.length === 0) {
    setText("statChalkSweep", "--");
    setText("statChalkSweepDesc", "Favorites Only");
    setText("statTopUpsetPre", "Popular Upset");
    setText("statTopUpset", "--");
    setText("statTopUpsetDesc", "No Upsets Picked");
    setText("statLock", "--");
    setText("statLockDesc", "100% Consensus");
    setText("statPeoplesLock", "--");
    setText("statPeoplesLockDesc", "No Locks Placed");
    setText("statLockAccuracy", "--");
    setText("statLockAccuracyDesc", "No Locks Placed");
    return;
  }

  let chalkCount = 0;
  const upsetTracker = {};
  const lockCounts = {};
  let totalLocksPlaced = 0, locksWon = 0, locksLost = 0, locksPending = 0;

  rows.forEach(c => {
    const picks = parseUserPicks(c.picks);
    let pickedUnderdog = false;
    let answeredCount = 0;

    games.forEach(g => {
      const pick = getMatchedUserPick(picks, g);
      if (!pick) return;
      answeredCount++;

      const favTeam = getFavoredTeam(g);
      if (favTeam) {
        const dogTeam = (normalizeTeam(favTeam) === normalizeTeam(g.teamA)) ? g.teamB : g.teamA;
        if (normalizeTeam(pick) === normalizeTeam(dogTeam)) {
          pickedUnderdog = true;
          if (!upsetTracker[dogTeam]) upsetTracker[dogTeam] = { count: 0, opponent: favTeam };
          upsetTracker[dogTeam].count += 1;
        }
      }

      if (isLockMatch(picks, g)) {
        totalLocksPlaced++;
        lockCounts[pick] = (lockCounts[pick] || 0) + 1;
        const winner = winnerOf(activeWeek, g);
        if (!winner) locksPending++;
        else if (normalizeTeam(pick) === normalizeTeam(winner)) locksWon++;
        else locksLost++;
      }
    });

    // "Chalk only" means every game picked and every pick a favorite.
    if (!pickedUnderdog && answeredCount === games.length) chalkCount++;
  });

  setText("statChalkSweep", `${chalkCount} / ${rows.length}`);
  setText("statChalkSweepDesc", `${Math.round((chalkCount / rows.length) * 100) || 0}% Picked All Favorites`);

  let topUpsetTeam = "--", maxUpsetVotes = 0, topUpsetOpponent = "";
  Object.entries(upsetTracker).forEach(([team, data]) => {
    if (data.count > maxUpsetVotes) {
      maxUpsetVotes = data.count;
      topUpsetTeam = team;
      topUpsetOpponent = data.opponent;
    }
  });
  if (maxUpsetVotes > 0) {
    setText("statTopUpsetPre", `${maxUpsetVotes} Picked`);
    setText("statTopUpset", topUpsetTeam);
    setText("statTopUpsetDesc", `to upset ${topUpsetOpponent}`);
  } else {
    setText("statTopUpsetPre", "Popular Upset");
    setText("statTopUpset", "--");
    setText("statTopUpsetDesc", "No Upsets Picked");
  }

  // Most-picked team of the week.
  let topConsensusTeam = "--", maxConsensusVotes = 0;
  games.forEach(g => {
    [g.teamA, g.teamB].forEach(team => {
      const count = rows.filter(c => {
        const userPick = getMatchedUserPick(parseUserPicks(c.picks), g);
        return userPick && normalizeTeam(userPick) === normalizeTeam(team);
      }).length;
      if (count > maxConsensusVotes) {
        maxConsensusVotes = count;
        topConsensusTeam = team;
      }
    });
  });
  setText("statLock", topConsensusTeam);
  setText("statLockDesc", `${Math.min(Math.round((maxConsensusVotes / rows.length) * 100) || 0, 100)}% Consensus`);

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
}

async function renderActiveWeek() {
  if (!weekSchedules[activeWeek] || weekSchedules[activeWeek].length === 0) {
    await fetchEspnSchedule(activeWeek);
  }

  const games = weekSchedules[activeWeek] || [];
  renderSchedule(games);
  renderMyTeam();

  const rows = allWeekRows.filter(r => r.week_number === activeWeek);
  setText("entryPill", `${rows.length} Entries`);
  renderWeekStats(rows, games);

  // Weekly list: correct picks, then Lock of the Week hits, then name.
  // Everyone on the same number of wins shares a rank, with no gaps.
  rows.forEach(c => c.score = gradePicks(c.picks, activeWeek));
  rows.sort((a, b) =>
    (b.score.correct - a.score.correct) ||
    (b.score.lockCorrect - a.score.lockCorrect) ||
    a.user_name.localeCompare(b.user_name));

  assignWeeklyRanks(rows);

  const listContainer = document.getElementById("cousinsList");
  listContainer.innerHTML = rows.length === 0
    ? `<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1.5rem 0;">No picks submitted for Week ${activeWeek} yet.</div>`
    : "";

  rows.forEach(c => {
    const item = document.createElement("div");
    item.className = "cousin-item";
    item.dataset.name = c.user_name;
    const picks = parseUserPicks(c.picks);
    const hitLotw = c.score.lockCorrect > 0;

    item.innerHTML = `
      <div class="cousin-header" onclick="this.nextElementSibling.classList.toggle('open')">
        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem;">
          ${c.rank === "-" ? "" : `<span class="rank-badge ${c.rankClass}">#${c.rank}</span>`}${podiumLogoHtml(c.user_name)}
          <span style="font-weight: 700; color: var(--text-main); font-size: 0.95rem;">${c.user_name}</span>
          ${hitLotw ? `<span class="lotw-hit-badge" style="font-size: 0.58rem; padding: 0.05rem 0.25rem;">LOTW <span class="lotw-check">✓</span></span>` : ''}
          ${lockTakeFlag(c.user_name)}
          <span style="font-size: 0.8rem; font-weight: 700; color: var(--accent-gold); margin-left: 0.4rem;">${c.score.correct}-${c.score.incorrect}</span>
        </div>
        <span style="color: var(--accent-gold); font-weight: bold;">+</span>
      </div>
      <div class="cousin-picks-body">
        ${cardBadgesHtml(c.user_name)}
        ${games.map(g => {
          const uPick = getMatchedUserPick(picks, g) || "No Pick";
          const isCousinLock = isLockMatch(picks, g);
          return `
            <div class="pick-line ${isCousinLock ? 'host-lock-cell' : ''}">
              <span class="nfl-matchup" style="color: var(--text-muted);">${g.logoA}${g.teamA} <span class="nfl-vs">@</span> ${g.logoB}${g.teamB}</span>
              <span class="${getPickClass(uPick, g, activeWeek)}">
                ${isCousinLock ? '<span class="lock-badge">LOCK</span>' : ''}
                ${uPick}
              </span>
            </div>
            ${isCousinLock ? lockTakeHtml(c.user_name, g, uPick) : ''}
          `;
        }).join("")}
      </div>
    `;
    listContainer.appendChild(item);
  });
  renderLockTakes(games, rows);
  renderNflYourSeason();
  pinMyCard();

  computeSeasonTotals();
}

function toggleTierExpand(gridId) {
  const grid = document.getElementById(gridId);
  if (grid) grid.classList.toggle("open");
}

// The current week runs until the Tuesday after its last game.
startLeaderboard(lastKickoff => nextDayStart(lastKickoff, 2));
