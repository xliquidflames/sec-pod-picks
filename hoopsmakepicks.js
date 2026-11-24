// hoopsmakepicks.html's own code, moved out of the page. Loaded at the end of the
// page by siteScript() in load.js, after the shared files.

const targetWeek = parseInt(new URLSearchParams(window.location.search).get("week"), 10) || 1;

let currentSchedule = [];
let userSelections = {};
let currentLockMatchupKey = null;
let lockFrozenKey = null;   // a saved Lock whose game has started
let knownNames = [];

// Team schedules highlight the week being picked.
scheduleOptions.currentWeek = () => targetWeek;

// Logo with the AP rank on its corner.
function buildLogoHtml(url, rank) {
  if (!url) return "";
  return `<span class="btn-pick-logo-wrap"><img src="${url}" alt="" class="btn-pick-logo" onerror="this.style.display='none';">${rank ? `<span class="matchup-rank">#${rank}</span>` : ""}</span>`;
}

// "4-1 (3-1)": overall, then conference. Display only.
function buildRecordText(competitor) {
  const records = (competitor && competitor.records) || [];
  const overall = records.find(r => r.type === "total" || (r.name || "").toLowerCase() === "overall");
  const conf = records.find(r => r.type === "vsconf" || /conf/i.test(r.name || "") || /conf/i.test(r.abbreviation || ""));
  if (!overall || !overall.summary) return "";
  return conf && conf.summary ? `${overall.summary} (${conf.summary})` : overall.summary;
}

async function fetchEspnSchedule(week) {
  try {
    const { data } = await fetchEspnRaw(week);
    if (!data || !data.events || data.events.length === 0) return [];
    rememberEvents(data.events);

    const games = data.events.map(ev => {
      const comp = ev.competitions[0];
      const home = comp.competitors.find(c => c.homeAway === "home");
      const away = comp.competitors.find(c => c.homeAway === "away");
      const homeName = cleanTeamName(home.team.shortDisplayName || home.team.name);
      const awayName = cleanTeamName(away.team.shortDisplayName || away.team.name);

      // teamA is always the SEC team (home if both are). Matchup keys and
      // saved picks use this order; the screen shows real Away @ Home.
      const [a, b] = isSecTeam(homeName) ? [home, away] : [away, home];
      const nameOf = c => c === home ? homeName : awayName;
      const rankOf = c => { const r = c && c.curatedRank && parseInt(c.curatedRank.current, 10); return (r >= 1 && r <= 25) ? r : null; };
      const idOf = c => (c && c.team && c.team.id) ? String(c.team.id) : null;

      const odds = comp.odds && comp.odds[0]?.details ? comp.odds[0].details : "Line: TBD";
      const venue = venueText(comp);

      let time = "TBD", dayText = "";
      let kickoff = new Date(8640000000000000);
      if (comp.date) {
        const d = new Date(comp.date);
        if (!isNaN(d.getTime())) kickoff = d;
        time = d.toLocaleDateString([], { month: "numeric", day: "numeric" }) + " " +
               d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
        dayText = d.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });
      }

      // A game locks once it has started, not just when it's over.
      const type = comp.status && comp.status.type;
      // Also once it's 3 minutes past the scheduled kickoff, even if ESPN
      // hasn't marked it started yet; later picks wouldn't count.
      const isFinal = !!((type && type.completed) || (type && type.state === "in") || (type && type.state === "post")) ||
        pastPickCutoff(kickoff);

      const teamA = nameOf(a), teamB = nameOf(b);
      return {
        matchupKey: (ev.id !== undefined && ev.id !== null) ? String(ev.id) : buildMatchupKey(teamA, teamB),
        teamA,
        teamB,
        teamARecord: buildRecordText(a),
        teamBRecord: buildRecordText(b),
        teamALogo: teamLogoFrom(a.team),
        teamBLogo: teamLogoFrom(b.team),
        teamARank: rankOf(a),
        teamBRank: rankOf(b),
        teamAId: idOf(a),
        teamBId: idOf(b),
        // ESPN labels tournament games ("Players Era 8 - Semifinal").
        tourney: (comp.notes && comp.notes[0] && comp.notes[0].headline) ? String(comp.notes[0].headline) : "",
        homeName,
        awayName: nameOf(away),
        eventId: (ev.id !== undefined && ev.id !== null) ? String(ev.id) : null,
        kickoff,
        dayText,
        detail: [time, odds, tvNetwork(comp), venue].filter(Boolean).join(" | "),
        playedDetail: `Tip-off: ${time} | ${venue}`,
        isFinal
      };
    });

    games.sort((x, y) => x.kickoff - y.kickoff);
    games.forEach((g, idx) => { g.id = idx + 1; });
    return games;
  } catch (e) {
    console.error("ESPN auto-fetch error:", e);
    return [];
  }
}

async function initForm() {
  document.getElementById("pageHeading").textContent = `WEEK ${targetWeek} PICKS`;
  document.getElementById("pageSubHeading").textContent = `Make your selections for Week ${targetWeek}`;

  // Picks go in under the signed-in account's name.
  const account = await requireAccount();
  if (!account) return;
  showAccountName(account);

  [currentSchedule] = await Promise.all([fetchEspnSchedule(targetWeek), loadMyReminders()]);
  renderForm();
  // Already entered: show those picks so they can be changed.
  const saved = await loadMyEntry(targetWeek, currentSchedule, account.name);
  if (saved) {
    lockFrozenKey = saved.lockStarted ? saved.lockKey : null;
    applySavedPicks(saved, currentSchedule, chooseTeam, toggleUserLock);
  }
  startLockCountdown();
}

// Ignores case, spaces and a leading "@" (same rule as the admin duplicate check).
function normalizeNameForMatch(name) {
  return (name || "").trim().toLowerCase().replace(/^@/, "").replace(/\s+/g, "");
}

function findPossibleNameMatch(typedName) {
  const normalizedTyped = normalizeNameForMatch(typedName);
  return knownNames.find(n => n !== typedName && normalizeNameForMatch(n) === normalizedTyped) || null;
}

// "Is this you?" prompt. Resolves with the name to submit under.
function confirmNameMatch(typedName, matchedName) {
  return new Promise(resolve => {
    const modal = document.getElementById("nameMatchModal");
    const yesBtn = document.getElementById("nameMatchModalYes");
    const noBtn = document.getElementById("nameMatchModalNo");

    document.getElementById("nameMatchModalText").innerHTML = `You typed <strong>"${typedName}"</strong>, but that looks like it might be the same person as <strong>"${matchedName}"</strong>, who's already submitted picks before. Is that you?`;
    modal.style.display = "flex";

    function cleanup(result) {
      modal.style.display = "none";
      yesBtn.removeEventListener("click", onYes);
      noBtn.removeEventListener("click", onNo);
      resolve(result);
    }
    function onYes() { cleanup(matchedName); }
    function onNo() { cleanup(typedName); }

    yesBtn.addEventListener("click", onYes);
    noBtn.addEventListener("click", onNo);
  });
}

function renderForm() {
  const container = document.getElementById("gamesList");
  if (currentSchedule.length === 0) {
    container.innerHTML = `<div style="text-align:center; color: var(--danger); padding: 1.5rem 0;">No scheduled games found for Week ${targetWeek} yet.</div>`;
    return;
  }

  container.innerHTML = "";
  currentSchedule.forEach(g => {
    const card = document.createElement("div");
    card.id = `card_${g.matchupKey}`;
    // Real "Away @ Home" order on screen; ids and saved picks stay A/B.
    const aIsHome = normalizeTeam(g.teamA) === normalizeTeam(g.homeName);
    const awayHome = (htmlA, htmlB) => aIsHome ? [htmlB, htmlA] : [htmlA, htmlB];

    if (g.isFinal) {
      card.className = "game-card is-final-locked";
      const finalLogo = (name, logo, rank) => logo
        ? buildLogoHtml(logo, rank)
        : `<span class="final-team-fallback">${shortenPickDisplay(name)}</span>`;
      const [left, right] = awayHome(finalLogo(g.teamA, g.teamALogo, g.teamARank), finalLogo(g.teamB, g.teamBLogo, g.teamBRank));
      card.innerHTML = `
        <div class="game-header-row">
          <span class="game-title"><strong>Game ${g.id}</strong> · ${g.dayText}</span>
        </div>
        ${tourneyBanner(g)}
        <div class="final-logo-row">
          ${left}
          <span class="pick-grid-at">@</span>
          ${right}
        </div>
        <div class="game-final-message">This game is in progress or finished so picking it is locked.</div>
        ${g.playedDetail ? `<span class="game-detail">${g.playedDetail}</span>` : ""}
        ${reminderBoxes(g)}
        ${detailsLink(g)}
      `;
    } else {
      card.className = "game-card";
      const pickBtn = (side, team, logo, rank, record) =>
        `<button type="button" class="btn-pick" id="btn_${g.matchupKey}_${side}" data-team="${team}" onclick="chooseTeam('${g.matchupKey}', '${team}')">${buildLogoHtml(logo, rank)}<span class="btn-pick-name">${shortenPickDisplay(team)}</span>${record ? `<span class="btn-pick-record">${record}</span>` : ""}</button>`;
      const [left, right] = awayHome(
        pickBtn("A", g.teamA, g.teamALogo, g.teamARank, g.teamARecord),
        pickBtn("B", g.teamB, g.teamBLogo, g.teamBRank, g.teamBRecord)
      );
      card.innerHTML = `
        <div class="game-header-row">
          <span class="game-title"><strong>Game ${g.id}</strong> · ${g.dayText}</span>
          ${isLockWeek(targetWeek) ? `
            <button type="button" class="btn-lock-toggle" id="lock_btn_${g.matchupKey}" onclick="toggleUserLock('${g.matchupKey}')">Lock Of\nThe Week</button>
          ` : ""}
        </div>
        ${tourneyBanner(g)}
        <div class="pick-grid">
          ${left}
          <span class="pick-grid-at">@</span>
          ${right}
        </div>
        ${g.detail ? `<span class="game-detail">${g.detail}</span>` : ""}
        ${reminderBoxes(g)}
        ${detailsLink(g)}
      `;
    }
    container.appendChild(card);
  });
}

// ---- Tournament games ----
// A banner with ESPN's label, and for each SEC team a box to get an email
// when that team's next tournament game is set (the "hoops-new-games"
// function sends it). Not shown for a final or a placement game, since
// nothing comes after those.
let myReminders = new Set();   // team ids this player gets emails for
let myEmail = "";

function tourneyBanner(g) {
  if (!g.tourney) return "";
  // Tap for the whole event's games (hoops.js openTournament).
  const [name] = splitTourneyLabel(g.tourney);
  return `<button type="button" class="tourney-banner" data-tourney="${escapeHtml(name)}" onclick="openTournament(this.dataset.tourney, ${targetWeek})">
    🏆 ${escapeHtml(g.tourney.replace(/\s+-\s+/g, " · "))}<span class="tourney-banner-hint">See bracket ›</span></button>`;
}

const lastRound = g => /\b(championship|final|third place|3rd place|\d+(st|nd|rd|th) place|fifth place|seventh place)\b/i.test(g.tourney);

function reminderBoxes(g) {
  if (!g.tourney || lastRound(g)) return "";
  return [[g.teamA, g.teamAId], [g.teamB, g.teamBId]]
    .filter(([name, id]) => id && isSecTeam(name))
    .map(([name, id]) => `
      <label class="tourney-remind">
        <input type="checkbox" data-remind-id="${id}" data-remind-name="${escapeHtml(shortenPickDisplay(name))}"
          onchange="setReminder(this)" ${myReminders.has(id) ? "checked" : ""}>
        <span><strong>Email me when ${escapeHtml(shortenPickDisplay(name))}'s next tournament game is set</strong>,
          so I can come back and pick it.<small class="tourney-remind-note">${myEmail ? `Sent to ${escapeHtml(myEmail)}. ` : ""}One email per game. Unsubscribe anytime.</small></span>
      </label>`).join("");
}

async function loadMyReminders() {
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;
    myEmail = user.email || "";
    const { data } = await supabaseClient.from("game_reminders").select("team_id");
    myReminders = new Set((data || []).map(r => r.team_id));
  } catch (e) {
    console.error("Couldn't load reminders:", e);
  }
}

async function setReminder(box) {
  const id = box.dataset.remindId, name = box.dataset.remindName;
  const note = box.parentElement.querySelector(".tourney-remind-note");
  box.disabled = true;
  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error("Sign in first");
    const { error } = box.checked
      ? await supabaseClient.from("game_reminders").upsert({ user_id: user.id, team_id: id, team_name: name }, { onConflict: "user_id,team_id" })
      : await supabaseClient.from("game_reminders").delete().eq("user_id", user.id).eq("team_id", id);
    if (error) throw error;
    if (box.checked) myReminders.add(id); else myReminders.delete(id);
    // The same team can be in more than one card: keep them all in step.
    document.querySelectorAll(`.tourney-remind input[data-remind-id="${id}"]`).forEach(b => { b.checked = box.checked; });
    if (note) {
      note.textContent = box.checked ? `You're set. We'll email ${myEmail || "you"} when ${name}'s next game is set.` : `Reminders for ${name} are off.`;
      note.classList.toggle("ok", box.checked);
      note.classList.remove("err");
    }
  } catch (e) {
    box.checked = !box.checked;
    if (note) {
      note.textContent = `Couldn't save that: ${e.message}`;
      note.classList.remove("ok");
      note.classList.add("err");
    }
  } finally {
    box.disabled = false;
  }
}

function matchupTitle(g) {
  return `${shortenPickDisplay(g.awayName)} @ ${shortenPickDisplay(g.homeName)}`;
}

// "Details +" opens the game's details right inside its card, so picks
// stay tappable while reading. Filled in the first time it's opened.
function detailsLink(g) {
  if (!g.eventId) return "";
  return `<button type="button" class="details-link" data-event-id="${g.eventId}" onclick="toggleCardDetails(this)">Details +</button><div class="card-details" style="display: none;"></div>`;
}

function toggleCardDetails(btn) {
  setCardDetails(btn, btn.nextElementSibling.style.display === "none");
}

function setCardDetails(btn, open) {
  const panel = btn.nextElementSibling;
  panel.style.display = open ? "" : "none";
  btn.textContent = open ? "Details −" : "Details +";
  if (open && !panel.dataset.loaded) {
    panel.dataset.loaded = "1";
    renderGameDetails(panel, btn.dataset.eventId);
  }
}

// Expand All / Collapse All above the games.
function setAllCardDetails(open) {
  document.querySelectorAll("#gamesList .details-link").forEach(btn => setCardDetails(btn, open));
}

// Bar at the top counting down to the next game that will lock. Updates
// every 30 seconds; once that game kicks off it asks for a refresh, since
// the page only knows which games are open as of when it loaded.
function startLockCountdown() {
  const bar = document.getElementById("lockCountdown");
  const next = currentSchedule
    .filter(g => !g.isFinal && g.kickoff.getFullYear() < 9999)
    .sort((a, b) => a.kickoff - b.kickoff)[0];
  if (!bar || !next) return;

  const update = () => {
    const ms = next.kickoff - Date.now();
    if (ms <= 0) {
      bar.innerHTML = `<strong>${matchupTitle(next)}</strong> has tipped off. Refresh the page before submitting.`;
      bar.classList.add("urgent");
      clearInterval(timer);
      return;
    }
    const mins = Math.floor(ms / 60000);
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    const left = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
    bar.innerHTML = `Next game locks in <strong>${left}</strong> · ${matchupTitle(next)}`;
    bar.classList.toggle("urgent", ms < 60 * 60 * 1000);
  };
  bar.style.display = "block";
  const timer = setInterval(update, 30000);
  update();
}

function chooseTeam(matchupKey, team) {
  userSelections[matchupKey] = team;
  markPick(matchupKey, btnA => btnA.dataset.team === team);
}

function toggleUserLock(matchupKey) {
  if (lockFrozenKey) return;
  if (!isLockWeek(targetWeek)) return;
  currentLockMatchupKey = (currentLockMatchupKey === matchupKey) ? null : matchupKey;
  refreshLockButtons(currentSchedule, currentLockMatchupKey, "Lock Of\nThe Week");
}

async function submitBallot() {
  const submitBtn = document.getElementById("submitBtn");
  const username = document.getElementById("userNameInput").value.trim();
  const fail = text => {
    setStatus("var(--danger)", text);
    resetSubmitButton();
  };

  if (!username) return setStatus("var(--danger)", "Please enter your handle or name.");

  // Games already started can't be picked, so they aren't required.
  const pickableGames = currentSchedule.filter(g => !g.isFinal && !pastPickCutoff(g.kickoff));
  if (pickableGames.length === 0) {
    return setStatus("var(--danger)", "Every game this week has already started or been played — there's nothing left to submit picks for.");
  }

  const pickedGameCount = Object.keys(userSelections).filter(k => k !== "lock_matchup_key").length;
  if (pickedGameCount < pickableGames.length) {
    return setStatus("var(--danger)", `Please make selections for all ${pickableGames.length} remaining games.`);
  }

  if (isLockWeek(targetWeek) && !currentLockMatchupKey && !lockFrozenKey) {
    return setStatus("var(--danger)", "Please select your Lock of the Week pick before submitting.");
  }

  // Catch "SECFan" vs "@secfan" before it splits one person in two.
  let finalUsername = username;
  const possibleMatch = findPossibleNameMatch(username);
  if (possibleMatch) finalUsername = await confirmNameMatch(username, possibleMatch);

  if (isLockWeek(targetWeek)) userSelections.lock_matchup_key = lockFrozenKey || currentLockMatchupKey;
  else delete userSelections.lock_matchup_key;

  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting picks...";
  setStatus("var(--text-muted)", "Submitting your picks...");

  try {
    const { error } = await supabaseClient
      .from(PICKS_TABLE)
      .insert({
        user_name: finalUsername,
        week_number: targetWeek,
        is_host: false,
        picks: userSelections,
        created_at: new Date().toISOString()
      });

    if (error) {
      if (error.code === "23505" || error.message?.includes("unique")) {
        return fail(`Changing picks isn't turned on yet. Message ${SITE.accountHelp || "us"} about it.`);
      }
      throw error;
    }

    try {
      localStorage.setItem("secPickEmUserName", finalUsername);
    } catch (storageErr) {}

    setStatus("var(--success)", `Week ${targetWeek} picks saved! Returning to Leaderboard...`);
    setTimeout(() => { window.location.href = "hoopsindex.html"; }, 1800);
  } catch (err) {
    fail(`Error: ${err.message}`);
  }
}

// Every team playing this week, SEC first. Tapping a pick-button logo
// picks the team, so schedules are reached from here instead.
function openSchedulePicker() {
  showInfoModal("Team Schedules");
  const body = document.getElementById("infoBody");
  const seen = new Set();
  const teams = [];
  currentSchedule.forEach(g => {
    [[g.teamA, g.teamALogo, g.teamAId], [g.teamB, g.teamBLogo, g.teamBId]].forEach(([name, logo, id]) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      teams.push({ name, logo, id, sec: isSecTeam(name) });
    });
  });
  if (teams.length === 0) {
    body.innerHTML = `<div class="team-sched-note">No games loaded for this week yet.</div>`;
    return;
  }
  const tile = t => `
    <button type="button" class="sched-pick-team ${t.sec ? "sec" : ""}"
      onclick="closeInfoModal(); openTeamSchedule('${t.id}', this.dataset.name, this.dataset.logo)"
      data-name="${t.name.replace(/"/g, "&quot;")}" data-logo="${t.logo || ""}">
      ${t.logo ? `<img src="${t.logo}" alt="" onerror="this.style.display='none'">` : ""}
      <span>${shortenPickDisplay(t.name)}</span>
    </button>`;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const sec = teams.filter(t => t.sec).sort(byName);
  const other = teams.filter(t => !t.sec).sort(byName);
  body.innerHTML = `
    <div class="sched-section-label">SEC</div>
    <div class="sched-pick-grid">${sec.map(tile).join("")}</div>
    ${other.length ? `<div class="sched-section-label">Opponents</div>
    <div class="sched-pick-grid">${other.map(tile).join("")}</div>` : ""}`;
}

initForm();
