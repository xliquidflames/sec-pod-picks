// account.html's own code, moved out of the page. Loaded at the end of the
// page by siteScript() in load.js, after the shared files.

// Each sport's teams come from ESPN's standings, grouped by conference.
// College football and hoops show the SEC first, the rest under
// "Other conferences".
const SPORTS = [
  { key: "cfb", label: "College Football", secFirst: true, urls: [
    "https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80",
    "https://site.web.api.espn.com/apis/v2/sports/football/college-football/standings?group=80"] },
  { key: "nfl", label: "NFL", secFirst: false, urls: [
    "https://site.api.espn.com/apis/v2/sports/football/nfl/standings",
    "https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings"] },
  { key: "hoops", label: "College Basketball", secFirst: true, urls: [
    "https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings",
    "https://site.web.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings"] }
];

let favorites = {};
const teamLists = {};

async function fetchJson(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (e) {}
  }
  return null;
}

// Every team under a standings node, divisions and all.
function teamsUnder(node, out = []) {
  ((node.standings && node.standings.entries) || []).forEach(e => e.team && out.push(e.team));
  (node.children || []).forEach(c => teamsUnder(c, out));
  return out;
}

// Saved names keep to plain characters; the database checks the same.
const plainName = n => (n || "").replace(/[^\p{L}\p{N} .'&()-]/gu, "").trim().slice(0, 40);

function toTeam(t, sport) {
  const logo = (t.logos && t.logos[0] && t.logos[0].href) ||
    (sport === "nfl" ? "" : `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.id}.png`);
  return { id: String(t.id), name: plainName(t.shortDisplayName || t.location || t.displayName), logo };
}

// [{ name, isSec, teams }] for a sport, SEC first when it has one.
async function loadTeams(sport) {
  if (teamLists[sport.key]) return teamLists[sport.key];
  const data = await fetchJson(sport.urls);
  if (!data) return null;
  const tops = data.children && data.children.length ? data.children : [data];
  const groups = tops.map(c => ({
    name: c.name || c.abbreviation || "Teams",
    isSec: sport.secFirst && (c.abbreviation === "SEC" || /southeastern/i.test(c.name || "")),
    teams: teamsUnder(c).map(t => toTeam(t, sport.key)).filter(t => t.id && /^https:\/\/a\.espncdn\.com\//.test(t.logo))
      .sort((a, b) => a.name.localeCompare(b.name))
  })).filter(g => g.teams.length);
  groups.sort((a, b) => (b.isSec - a.isSec) || a.name.localeCompare(b.name));
  return (teamLists[sport.key] = groups);
}

function currentHtml(sport) {
  const team = favorites[sport.key];
  return team
    ? `<img class="fav-current-logo" src="${escapeHtml(team.logo)}" alt="" /><strong>${escapeHtml(team.name)}</strong>`
    : `<span class="fav-none">No team picked</span>`;
}

function renderSections() {
  document.getElementById("favoriteSections").innerHTML = SPORTS.map(sport => `
    <div class="fav-section" id="fav_${sport.key}">
      <div class="fav-sport">${sport.label}</div>
      <div class="fav-row">
        <div class="fav-current">${currentHtml(sport)}</div>
        <div class="fav-actions">
          <button type="button" class="btn-ctrl" onclick="togglePicker('${sport.key}')">Change</button>
          ${favorites[sport.key] ? `<button type="button" class="btn-ctrl" onclick="saveFavorite('${sport.key}', null)">Clear</button>` : ""}
        </div>
      </div>
      <div class="fav-picker" id="picker_${sport.key}"></div>
    </div>`).join("");
}

const teamButton = (sportKey, t) =>
  `<button type="button" class="fav-team" onclick="pickTeam('${sportKey}', '${t.id}')"><img src="${escapeHtml(t.logo)}" alt="" loading="lazy" /><span>${escapeHtml(t.name)}</span></button>`;

async function togglePicker(sportKey) {
  const picker = document.getElementById(`picker_${sportKey}`);
  if (picker.innerHTML) { picker.innerHTML = ""; return; }
  const sport = SPORTS.find(s => s.key === sportKey);
  picker.innerHTML = `<div class="signin-note">Loading teams...</div>`;
  const groups = await loadTeams(sport);
  if (!groups || !groups.length) {
    picker.innerHTML = `<div class="signin-note">Couldn't load the teams from ESPN. Try again in a minute.</div>`;
    return;
  }
  const sec = groups.filter(g => g.isSec);
  const rest = groups.filter(g => !g.isSec);
  const groupHtml = g => `<div class="fav-conf">${escapeHtml(g.name)}</div><div class="fav-grid">${g.teams.map(t => teamButton(sportKey, t)).join("")}</div>`;
  picker.innerHTML = sec.length
    ? `${sec.map(groupHtml).join("")}
       <button type="button" class="details-link fav-more" onclick="this.nextElementSibling.classList.toggle('open'); this.innerHTML = this.nextElementSibling.classList.contains('open') ? 'Other conferences &#9652;' : 'Other conferences &#9662;';">Other conferences &#9662;</button>
       <div class="fav-others">${rest.map(groupHtml).join("")}</div>`
    : groups.map(groupHtml).join("");
}

function pickTeam(sportKey, id) {
  const team = (teamLists[sportKey] || []).flatMap(g => g.teams).find(t => t.id === id);
  if (team) saveFavorite(sportKey, team);
}

async function saveFavorite(sportKey, team) {
  setStatus("var(--text-muted)", "Saving...");
  const { data, error } = await supabaseClient.rpc("set_favorite", { p_sport: sportKey, p_team: team });
  if (error) return setStatus("var(--danger)", error.message);
  favorites = data || {};
  signedInAccount = signedInAccount && { ...signedInAccount, favorites };
  renderSections();
  renderAccountBar();
  const label = SPORTS.find(s => s.key === sportKey).label;
  setStatus("var(--success)", team ? `${team.name} saved for ${label}.` : `${label} team cleared.`);
}

// ---- Email reminders ----
// One row in email_prefs: the main switch and a box per sport. Sent by the
// "daily-reminders" function (supabase/daily-reminders-function.ts).
const EMAIL_SPORTS = [["cfb", "SEC Football"], ["nfl", "NFL"], ["hoops", "SEC Hoops"]];
let emailPrefs = { enabled: false, cfb: true, nfl: false, hoops: true };
let emailUserId = null, emailAddress = "";

async function loadEmailPrefs() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  emailUserId = user.id;
  emailAddress = user.email || "";
  const { data, error } = await supabaseClient.from("email_prefs").select("enabled, cfb, nfl, hoops").maybeSingle();
  if (error) console.error("Couldn't load email settings:", error);
  if (data) emailPrefs = data;
  renderEmailPrefs();
}

function renderEmailPrefs() {
  const on = emailPrefs.enabled;
  document.getElementById("emailPrefs").innerHTML = `
    <label class="email-opt main">
      <input type="checkbox" ${on ? "checked" : ""} onchange="saveEmailPrefs('enabled', this.checked)">
      <span><strong>Email me pick'em reminders</strong>${emailAddress ? `<small>Sent to ${escapeHtml(emailAddress)}. Every email has an unsubscribe link.</small>` : ""}</span>
    </label>
    <div class="email-sports${on ? "" : " off"}">
      ${EMAIL_SPORTS.map(([key, label]) => `
        <label class="email-opt">
          <input type="checkbox" ${emailPrefs[key] ? "checked" : ""} ${on ? "" : "disabled"} onchange="saveEmailPrefs('${key}', this.checked)">
          <span>${label}</span>
        </label>`).join("")}
    </div>`;
}

async function saveEmailPrefs(key, value) {
  const status = document.getElementById("emailStatus");
  const next = { ...emailPrefs, [key]: value };
  status.style.color = "var(--text-muted)";
  status.textContent = "Saving...";
  const { error } = await supabaseClient.from("email_prefs")
    .upsert({ user_id: emailUserId, enabled: next.enabled, cfb: next.cfb, nfl: next.nfl, hoops: next.hoops }, { onConflict: "user_id" });
  if (error) {
    status.style.color = "var(--danger)";
    status.textContent = `Couldn't save that: ${error.message}`;
    renderEmailPrefs();
    return;
  }
  emailPrefs = next;
  renderEmailPrefs();
  const picked = EMAIL_SPORTS.filter(([k]) => next[k]).map(([, label]) => label);
  status.style.color = "var(--success)";
  status.textContent = !next.enabled ? "Email reminders are off."
    : picked.length ? `Saved. Reminders for ${picked.join(", ")}.` : "Saved. Tick a sport to get reminders.";
}

// ---- Your Lock Takes ----
// Every take this player wrote, newest first (lock_notes, lock-notes.sql).
// Edit until the lock kicks off (lock_kickoff); delete any time. Takes
// written before the kickoff time was saved can only be deleted here.
const TAKE_SPORTS = { cfb: "SEC Football", nfl: "NFL", hoops: "SEC Hoops" };
const TAKE_WEEK_NAMES = {
  cfb: { 14: "SEC Championship", 15: "Bowls & CFP Round 1", 16: "CFP Quarterfinals", 17: "CFP Semifinals", 18: "CFP National Championship" },
  nfl: {},
  hoops: { 19: "SEC Tournament", 20: "NCAA First & Second Rounds", 21: "NCAA Sweet 16 & Elite 8", 22: "NCAA Final Four" }
};
let myTakes = [];

async function loadMyTakes() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  const { data, error } = await supabaseClient.from("lock_notes")
    .select("sport, week_number, note, lock_pick, lock_kickoff, updated_at")
    .eq("user_id", user.id).order("updated_at", { ascending: false });
  if (error) { console.error("Couldn't load your takes:", error); return; }
  myTakes = data || [];
  renderMyTakes();
}

const takeEditable = t => t.lock_kickoff && Date.now() < new Date(t.lock_kickoff).getTime();

function renderMyTakes() {
  const card = document.getElementById("myTakesCard");
  card.style.display = myTakes.length ? "" : "none";
  document.getElementById("myTakes").innerHTML = myTakes.map((t, i) => `
    <div class="my-take" id="myTake${i}">
      <div class="my-take-head">${TAKE_SPORTS[t.sport] || t.sport} · ${(TAKE_WEEK_NAMES[t.sport] || {})[t.week_number] || `Week ${t.week_number}`}</div>
      ${t.lock_pick ? `<div class="lock-takes-who"><span class="lock-badge">LOCKED</span> ${escapeHtml(t.lock_pick)}</div>` : ""}
      <div class="my-take-note">${escapeHtml(t.note)}</div>
      <div class="lock-take-own">
        ${takeEditable(t) ? `<button type="button" onclick="editMyTake(${i})">Edit</button>` : ""}
        <button type="button" onclick="deleteMyTake(this, ${i})">Delete</button>
      </div>
    </div>`).join("");
}

function editMyTake(i) {
  const t = myTakes[i];
  const box = document.getElementById(`myTake${i}`);
  box.querySelector(".my-take-note").outerHTML = `
    <div class="lock-take editing">
      <textarea maxlength="${LOCK_NOTE_MAX}" rows="3"
        oninput="this.parentElement.querySelector('.lock-note-count').textContent = this.value.length + '/${LOCK_NOTE_MAX}'">${escapeHtml(t.note)}</textarea>
      <div class="lock-note-row">
        <span class="lock-note-count">${t.note.length}/${LOCK_NOTE_MAX}</span>
        <button type="button" class="lock-note-btn" onclick="renderMyTakes()">Cancel</button>
        <button type="button" class="lock-note-btn save" onclick="saveMyTake(this, ${i})">Save</button>
      </div>
      <div class="lock-note-status"></div>
    </div>`;
  box.querySelector(".lock-take-own").style.display = "none";
  box.querySelector("textarea").focus();
}

async function saveMyTake(btn, i) {
  const t = myTakes[i];
  const box = document.getElementById(`myTake${i}`);
  const note = box.querySelector("textarea").value.trim();
  const status = box.querySelector(".lock-note-status");
  if (!note) return deleteMyTake(btn, i, true);
  btn.disabled = true;
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { error } = await supabaseClient.from("lock_notes").update({ note })
    .eq("sport", t.sport).eq("week_number", t.week_number).eq("user_id", user.id);
  if (error) {
    btn.disabled = false;
    status.style.color = "var(--danger)";
    status.textContent = `Couldn't save: ${error.message}`;
    return;
  }
  t.note = note;
  renderMyTakes();
}

// Tap once to arm, again to delete. now: skip the second tap.
async function deleteMyTake(btn, i, now) {
  if (!now && btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = "Tap again to delete";
    return;
  }
  btn.disabled = true;
  const t = myTakes[i];
  const { data: { user } } = await supabaseClient.auth.getUser();
  const { error } = await supabaseClient.from("lock_notes").delete()
    .eq("sport", t.sport).eq("week_number", t.week_number).eq("user_id", user.id);
  if (error) {
    btn.disabled = false;
    btn.dataset.armed = "";
    btn.textContent = "Couldn't delete. Try again";
    return;
  }
  myTakes.splice(i, 1);
  renderMyTakes();
}

// Right after claiming a name: an optional stop on the way to the picks.
const params = new URLSearchParams(location.search);
const welcomeNext = params.has("welcome") && /^[\w-]+\.html(\?[\w=&%-]*)?$/.test(params.get("next") || "") ? params.get("next") : null;

(async () => {
  if (welcomeNext) {
    document.querySelector("h1").textContent = "PICK YOUR TEAMS";
    const btn = document.getElementById("welcomeContinue");
    btn.href = welcomeNext;
    btn.style.display = "block";
  }
  document.getElementById("signinHelp").innerHTML = accountHelpHtml();
  const account = await requireAccount();
  if (!account) return;
  favorites = account.favorites || {};
  document.getElementById("accountSub").innerHTML = `Signed in as <strong>${escapeHtml(account.name)}</strong>`;
  renderSections();
  loadEmailPrefs();
  loadMyTakes();
})();
