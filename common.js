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
    askForFavorite(account);
    if (typeof onAccountReady === "function") onAccountReady(account);
  });
}

// ---- Your Team ----
// For a signed-in player with a favorite in this page's sport: record,
// last game, next game (or the live score), and their team's games on the
// page get a gold edge. Pages call renderMyTeam() after drawing their games.
const MY_TEAM_FEEDS = {
  cfb: id => `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/${id}/schedule?season=2026`,
  nfl: id => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/schedule?season=2026`,
  hoops: id => `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams/${id}/schedule?season=2027&seasontype=2`
};
const myTeamCache = {};

// Their team's games get a stripe on the left in the team's two colors,
// set here as --fav-1 and --fav-2 (gold until the colors load). A second
// color that's missing, near white or near black repeats the first.
async function setFavColors(sport, id, t) {
  let main = t.color, alt = t.alternateColor;
  if (!main || !alt) {
    try {
      const list = await loadTeamColors(sport === "nfl" ? "nfl" : "ncaa");
      const c = list && list[id];
      if (c) { main = main || c[0]; alt = alt || c[1]; }
    } catch (e) {}
  }
  if (!/^[0-9a-f]{6}$/i.test(main || "")) return;
  const light = hex => {
    const n = parseInt(hex, 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  };
  const usable = /^[0-9a-f]{6}$/i.test(alt || "") && alt.toLowerCase() !== main.toLowerCase() &&
    light(alt) < 0.9 && light(alt) > 0.08;
  const root = document.documentElement.style;
  root.setProperty("--fav-1", `#${main}`);
  root.setProperty("--fav-2", `#${usable ? alt : main}`);
}

async function renderMyTeam() {
  const section = document.getElementById("myTeamSection");
  const box = document.getElementById("myTeamBox");
  const sport = pageSport();
  const team = signedInAccount && signedInAccount.favorites && signedInAccount.favorites[sport];
  document.querySelectorAll(".fav-game").forEach(el => el.classList.remove("fav-game"));
  if (!team || !team.id) {
    if (section) section.style.display = "none";
    return;
  }
  const mine = normalizeTeam(team.name);
  document.querySelectorAll("[data-teams]").forEach(el => {
    if (el.dataset.teams.split("|").includes(mine)) el.classList.add("fav-game");
  });
  if (!section || !box) return;
  section.style.display = "";

  const key = `${sport}:${team.id}`;
  if (!myTeamCache[key]) {
    try {
      const res = await fetch(MY_TEAM_FEEDS[sport](team.id));
      if (!res.ok) throw new Error("bad response");
      myTeamCache[key] = await res.json();
    } catch (e) {
      box.innerHTML = `<div class="team-sched-note">Couldn't load ${escapeHtml(team.name)}'s games right now.</div>`;
      return;
    }
  }
  const data = myTeamCache[key];
  setFavColors(sport, team.id, data.team || {});
  const score = v => v === null || v === undefined ? "" : typeof v === "object" ? String(v.displayValue ?? v.value ?? "") : String(v);
  const logoOf = t => (t.logos && t.logos[0] && t.logos[0].href) || t.logo || "";

  // Each game from this team's side.
  const games = (data.events || []).map(ev => {
    const comp = (ev.competitions || [])[0] || {};
    const sides = comp.competitors || [];
    const me = sides.find(c => String((c.team && c.team.id) || c.id) === String(team.id));
    const opp = sides.find(c => c !== me);
    if (!me || !opp) return null;
    const oppTeam = opp.team || {};
    const status = (comp.status && comp.status.type) || {};
    const rank = c => { const r = c.curatedRank && c.curatedRank.current; return r && r <= 25 ? `#${r} ` : ""; };
    const media = ((comp.broadcasts || [])[0] || {}).media;
    return {
      date: new Date(ev.date),
      timeSet: comp.timeValid !== false,
      prefix: comp.neutralSite ? "vs" : me.homeAway === "away" ? "@" : "vs",
      opp: `${rank(opp)}${oppTeam.shortDisplayName || oppTeam.displayName || "TBD"}`,
      oppLogo: logoOf(oppTeam),
      myRank: rank(me),
      done: status.completed === true,
      live: status.state === "in",
      detail: status.shortDetail || status.detail || "",
      won: me.winner === true,
      lost: opp.winner === true,
      myScore: score(me.score),
      oppScore: score(opp.score),
      tv: media ? media.shortName || "" : "",
      id: String(ev.id)
    };
  }).filter(Boolean).sort((a, b) => a.date - b.date);

  const last = [...games].reverse().find(g => g.done);
  const live = games.find(g => g.live);
  const next = games.find(g => !g.done && !g.live);
  const oppHtml = g => `${g.oppLogo ? `<img src="${escapeHtml(g.oppLogo)}" alt="" onerror="this.style.display='none'">` : ""}<span>${g.prefix} ${escapeHtml(g.opp)}</span>`;

  // The line, if the game is in a week the page has loaded.
  const lineFor = g => {
    const hit = Object.values(weekSchedules).flat().find(x => x && String(x.eventId || x.matchupKey) === g.id);
    return hit && hit.rawOdds ? hit.rawOdds : "";
  };

  const rows = [];
  if (live) {
    rows.push(`<div class="my-team-row live"><span class="my-team-tag">Live</span>
      <span class="my-team-opp">${oppHtml(live)}</span>
      <span class="my-team-result">${live.myScore}-${live.oppScore} · ${escapeHtml(live.detail)}</span></div>`);
  }
  if (last) {
    const result = last.won ? "W" : last.lost ? "L" : "T";
    rows.push(`<div class="my-team-row"><span class="my-team-tag">Last</span>
      <span class="my-team-opp">${oppHtml(last)}</span>
      <span class="my-team-result ${last.won ? "win" : last.lost ? "loss" : ""}">${result} ${last.myScore}-${last.oppScore}</span></div>`);
  }
  if (next) {
    const day = next.date.toLocaleDateString([], { weekday: "short", month: "numeric", day: "numeric" });
    const time = next.timeSet && !(next.date.getHours() === 0 && next.date.getMinutes() === 0)
      ? next.date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "Time TBD";
    const extra = [time, next.tv, lineFor(next)].filter(Boolean).join(" · ");
    rows.push(`<div class="my-team-row"><span class="my-team-tag">Next</span>
      <span class="my-team-opp">${oppHtml(next)}</span>
      <span class="my-team-result">${day}</span></div>
      <div class="my-team-extra">${escapeHtml(extra)}</div>`);
  } else if (!live) {
    rows.push(`<div class="my-team-extra">No more games on the schedule.</div>`);
  }

  const t = data.team || {};
  const meta = [t.recordSummary, t.standingSummary].filter(Boolean).join(" · ");
  const rankNow = (live || next || last || {}).myRank || "";
  const scheduleButton = typeof openTeamSchedule === "function"
    ? `<button type="button" class="btn-ctrl my-team-btn" onclick="openTeamSchedule('${team.id}', '${escapeHtml(team.name).replace(/'/g, "&#39;")}', '${escapeHtml(team.logo || "")}')">Full Schedule</button>` : "";
  // SEC football: the Team Schedule graphic in place of Last, Next and
  // the Full Schedule button (a live score still shows above it).
  const graphic = sport === "cfb" && typeof drawTeamScheduleGraphic === "function";
  if (graphic) {
    rows.length = 0;
    if (live) rows.push(`<div class="my-team-row live"><span class="my-team-tag">Live</span>
      <span class="my-team-opp">${oppHtml(live)}</span>
      <span class="my-team-result">${live.myScore}-${live.oppScore} · ${escapeHtml(live.detail)}</span></div>`);
    rows.push(`<canvas class="my-team-graphic" width="1920" height="1080"></canvas>`);
  }
  box.innerHTML = `
    <div class="my-team-head">
      ${team.logo ? `<img class="my-team-logo" src="${escapeHtml(team.logo)}" alt="">` : ""}
      <div>
        <div class="my-team-name">${escapeHtml(rankNow)}${escapeHtml(team.name)}</div>
        <div class="my-team-meta">${escapeHtml(meta)}</div>
      </div>
    </div>
    ${rows.join("")}
    ${graphic ? "" : scheduleButton}`;
  if (graphic) {
    const canvas = box.querySelector(".my-team-graphic");
    const drawn = await drawTeamScheduleGraphic(canvas, team.id, data).catch(() => false);
    // Not one of the 16 SEC teams: back to the plain rows.
    if (!drawn) {
      canvas.remove();
      box.insertAdjacentHTML("beforeend", scheduleButton);
    }
  }
  // Season stat ranks and player leaders, where the page has them.
  if (typeof fillMyTeamStats === "function") fillMyTeamStats(box, data.team || {});
}

// ---- Favorite team prompt ----
// On a leaderboard page, a signed-in player with no favorite for that
// page's sport gets a pop-up to pick one. "Not now" waits a week.
const FAV_PROMPT_SPORTS = {
  cfb: { label: "college football", secFirst: true, urls: [
    "https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80",
    "https://site.web.api.espn.com/apis/v2/sports/football/college-football/standings?group=80"] },
  nfl: { label: "NFL", secFirst: false, urls: [
    "https://site.api.espn.com/apis/v2/sports/football/nfl/standings",
    "https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings"] },
  hoops: { label: "college basketball", secFirst: true, urls: [
    "https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings",
    "https://site.web.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings"] }
};
const FAV_PROMPT_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
let favPromptGroups = [];

function askForFavorite(account) {
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  // Leaderboards and picks pages (most people go straight to picks).
  if (!/^(index|nflindex|hoopsindex|makepicks|nflmakepicks|hoopsmakepicks)\.html$/.test(page)) return;
  const sport = pageSport();
  if (!account || !account.name || (account.favorites && account.favorites[sport])) return;
  try {
    const snoozed = Number(localStorage.getItem(`favPromptSnooze_${sport}`) || 0);
    if (Date.now() - snoozed < FAV_PROMPT_WAIT_MS) return;
  } catch (e) {}
  openFavoritePrompt(sport);
}

async function openFavoritePrompt(sport) {
  const info = FAV_PROMPT_SPORTS[sport];
  const overlay = document.createElement("div");
  overlay.id = "favPromptOverlay";
  overlay.className = "team-sched-overlay";
  overlay.style.display = "flex";
  overlay.innerHTML = `
    <div class="team-sched-modal fav-prompt-modal" role="dialog" aria-modal="true" aria-labelledby="favPromptTitle">
      <div class="team-sched-header">
        <div class="team-sched-title" id="favPromptTitle">Who is your favorite ${info.label} team?</div>
        <button type="button" class="team-sched-close" onclick="snoozeFavoritePrompt('${sport}')" aria-label="Close">&times;</button>
      </div>
      <div class="fav-prompt-body">
        <p class="fav-prompt-text">Your team's logo shows next to your name, and you'll count toward your fan base in the Fanbase Showdown.</p>
        <div id="favPromptTeams"><div class="signin-note">Loading teams...</div></div>
        <div class="fav-prompt-status" id="favPromptStatus"></div>
        <div class="fav-prompt-actions">
          <button type="button" class="btn-ctrl" onclick="snoozeFavoritePrompt('${sport}')">Not now</button>
          <a class="details-link" href="account.html">All my teams &rarr;</a>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let data = null;
  for (const url of info.urls) {
    try {
      const res = await fetch(url);
      if (res.ok) { data = await res.json(); break; }
    } catch (e) {}
  }
  const box = document.getElementById("favPromptTeams");
  if (!data) {
    box.innerHTML = `<div class="signin-note">Couldn't load the teams right now. You can pick one any time on your <a href="account.html">account page</a>.</div>`;
    return;
  }
  const under = (node, out = []) => {
    ((node.standings && node.standings.entries) || []).forEach(e => e.team && out.push(e.team));
    (node.children || []).forEach(c => under(c, out));
    return out;
  };
  const plain = n => (n || "").replace(/[^\p{L}\p{N} .'&()-]/gu, "").trim().slice(0, 40);
  const toTeam = t => ({
    id: String(t.id),
    name: plain(t.shortDisplayName || t.location || t.displayName),
    logo: (t.logos && t.logos[0] && t.logos[0].href) || (sport === "nfl" ? "" : `https://a.espncdn.com/i/teamlogos/ncaa/500/${t.id}.png`)
  });
  const tops = data.children && data.children.length ? data.children : [data];
  favPromptGroups = tops.map(c => ({
    name: c.name || c.abbreviation || "Teams",
    isSec: info.secFirst && (c.abbreviation === "SEC" || /southeastern/i.test(c.name || "")),
    teams: under(c).map(toTeam).filter(t => t.id && /^https:\/\/a\.espncdn\.com\//.test(t.logo)).sort((a, b) => a.name.localeCompare(b.name))
  })).filter(g => g.teams.length).sort((a, b) => (b.isSec - a.isSec) || a.name.localeCompare(b.name));

  const button = t => `<button type="button" class="fav-team" onclick="saveFavoriteFromPrompt('${sport}', '${t.id}')"><img src="${escapeHtml(t.logo)}" alt="" loading="lazy" /><span>${escapeHtml(t.name)}</span></button>`;
  const group = g => `<div class="fav-conf">${escapeHtml(g.name)}</div><div class="fav-grid">${g.teams.map(button).join("")}</div>`;
  const sec = favPromptGroups.filter(g => g.isSec);
  const rest = favPromptGroups.filter(g => !g.isSec);
  box.innerHTML = sec.length
    ? `${sec.map(group).join("")}
       <button type="button" class="details-link fav-more" onclick="this.nextElementSibling.classList.toggle('open'); this.innerHTML = this.nextElementSibling.classList.contains('open') ? 'Other conferences &#9652;' : 'Other conferences &#9662;';">Other conferences &#9662;</button>
       <div class="fav-others">${rest.map(group).join("")}</div>`
    : favPromptGroups.map(group).join("");
}

function closeFavoritePrompt() {
  const overlay = document.getElementById("favPromptOverlay");
  if (overlay) overlay.remove();
}

function snoozeFavoritePrompt(sport) {
  try { localStorage.setItem(`favPromptSnooze_${sport}`, String(Date.now())); } catch (e) {}
  closeFavoritePrompt();
}

async function saveFavoriteFromPrompt(sport, id) {
  const team = favPromptGroups.flatMap(g => g.teams).find(t => t.id === id);
  if (!team) return;
  const status = document.getElementById("favPromptStatus");
  status.style.color = "var(--text-muted)";
  status.textContent = "Saving...";
  const { data, error } = await supabaseClient.rpc("set_favorite", { p_sport: sport, p_team: team });
  if (error) {
    status.style.color = "var(--danger)";
    status.textContent = error.message;
    return;
  }
  signedInAccount = { ...signedInAccount, favorites: data || {} };
  renderAccountBar();
  if (typeof onAccountReady === "function") onAccountReady(signedInAccount);
  const me = (signedInAccount.name || "").toLowerCase();
  playerFavorites[me] = { ...(playerFavorites[me] || {}), [sport]: team };
  status.style.color = "var(--success)";
  status.textContent = `${team.name} saved!`;
  setTimeout(closeFavoritePrompt, 900);
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
    if (!profile) {
      // Hosts and admins get their name set up for them (host-admin.sql);
      // everyone else gets null and chooses one on the sign-in page.
      const { data: adminName } = await supabaseClient.rpc("claim_admin_name");
      if (adminName) return { user, name: adminName, favorites: {} };
    }
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

// ---- Contact: email, X, Discord and a message form ----
// Any element with data-contact-box gets one; its value is the heading.
function contactBoxHtml(heading) {
  const who = SITE.accountHelp || "us";
  return `<div class="contact-heading">${escapeHtml(heading || `Questions, issues, comments? Contact ${who}:`)}</div>
    <button type="button" class="btn-provider contact-open" onclick="openContactForm()">Send ${escapeHtml(who)} a message</button>`;
}

// Every way to reach accountHelp, as links in a sentence each.
function contactWaysHtml() {
  const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;
  const ways = [
    SITE.contactX && `DM me on X/Twitter: ${link(`https://x.com/${SITE.contactX}`, `@${SITE.contactX}`)}`,
    SITE.discord && `DM me on Discord: ${link(SITE.discord, SITE.contactDiscord || SITE.accountHelp || "our server")}`,
    SITE.contactEmail && `Email me: <a href="mailto:${SITE.contactEmail}">${escapeHtml(SITE.contactEmail)}</a>`,
    SITE.contactForm && "Or fill out the form below. Make sure your email is right so I can reply to you."
  ].filter(Boolean);
  return `<div class="contact-ways"><p>You can reach me any of these ways:</p><ul>${ways.map(w => `<li>${w}</li>`).join("")}</ul></div>`;
}

// The message form, in a pop-up made the first time it's opened.
function openContactForm() {
  let overlay = document.getElementById("contactOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "contactOverlay";
    overlay.className = "team-sched-overlay";
    overlay.onclick = e => { if (e.target === overlay) closeContactForm(); };
    overlay.innerHTML = `
      <div class="team-sched-modal contact-modal" role="dialog" aria-modal="true" aria-labelledby="contactTitle">
        <div class="team-sched-header">
          <div class="team-sched-title" id="contactTitle">Message ${escapeHtml(SITE.accountHelp || "us")}</div>
          <button type="button" class="team-sched-close" onclick="closeContactForm()" aria-label="Close">&times;</button>
        </div>
        <div class="contact-body">
        ${contactWaysHtml()}
        ${SITE.contactForm ? `<form class="contact-form" onsubmit="sendContactMessage(this); return false;">
          <label class="contact-label" for="contactReply">Your email<small>So I can reply to you</small></label>
          <input class="form-field" id="contactReply" name="reply" type="email" maxlength="120" autocomplete="email" required />
          <label class="contact-label" for="contactName">Your picks name<small>What name do you go by on this site?</small></label>
          <input class="form-field" id="contactName" name="name" maxlength="60" autocomplete="off" />
          <label class="contact-label" for="contactMessage">What's goin' on, cuz?</label>
          <textarea class="form-field" id="contactMessage" name="message" maxlength="2000" rows="7" required></textarea>
          <input class="contact-trap" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />
          <button type="submit" class="btn-submit">Send Message</button>
          <div class="contact-status"></div>
        </form>` : ""}
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeContactForm(); });
  }
  const nameField = document.getElementById("contactName");
  if (nameField && !nameField.value && signedInAccount && signedInAccount.name) nameField.value = signedInAccount.name;
  const status = overlay.querySelector(".contact-status");
  if (status) status.innerHTML = "";
  overlay.style.display = "flex";
}

function closeContactForm() {
  const overlay = document.getElementById("contactOverlay");
  if (overlay) overlay.style.display = "none";
}

async function sendContactMessage(form) {
  const status = form.querySelector(".contact-status");
  const button = form.querySelector("button[type=submit]");
  const field = n => form.elements[n].value.trim();
  if (!field("message")) return;
  const say = (color, html) => { status.style.color = color; status.innerHTML = html; };
  button.disabled = true;
  say("var(--text-muted)", "Sending...");
  try {
    // Gives up after 20 seconds instead of saying "Sending..." forever.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("No answer after 20 seconds")), 20000));
    const { error } = await Promise.race([timeout, supabaseClient.functions.invoke("contact", {
      body: { name: field("name"), reply: field("reply"), message: field("message"), website: field("website"),
              account: (signedInAccount && signedInAccount.name) || "", page: thisPage() }
    })]);
    if (error) throw error;
    form.elements.message.value = "";
    say("var(--success)", "Sent. Thanks! You'll hear back by email.");
  } catch (err) {
    console.error("Contact form failed:", err);
    say("var(--danger)", `Couldn't send that.${SITE.contactEmail ? ` Email <a href="mailto:${SITE.contactEmail}">${escapeHtml(SITE.contactEmail)}</a> instead.` : ""}`);
  }
  button.disabled = false;
}

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
let championRecords = {};   // week -> "9-1", the winning record

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
  return `<span class="champ-chip" title="${weeks.map(weekName).join(", ")} champion">&#127942;&times;${weeks.length}</span>`;
}

// Every week won, spelled out, for the Season So Far box on a card.
function championWeeksHtml(name) {
  const weeks = weeklyChampions[(name || "").toLowerCase()] || [];
  return weeks.length ? `<div>&#127942; Champion weeks: ${weeks.map(weekShort).join(", ")}</div>` : "";
}

// The standings show just the logo; titles stay on the cards.
const podiumLogoHtml = name => favoriteLogoHtml(playerFavorites[(name || "").toLowerCase()]);

// Logo and titles after a player's name on a card.
// Site rule: a player's favorite-team logo always goes before their name.
const playerBadgesHtml = name => favoriteLogoHtml(playerFavorites[(name || "").toLowerCase()]) + championChipsHtml(name);

// Top of an opened card: weeks won and how far back, kept off the
// collapsed row so the list stays clean.
function cardBadgesHtml(name, extra = "") {
  const season = seasonRecords[(name || "").toLowerCase()];
  const seasonChip = season && season.c + season.i > 0 ? `<span class="path-chip season-chip">Season ${season.c}-${season.i}</span>` : "";
  const inner = seasonChip + championChipsHtml(name) + extra;
  return inner ? `<div class="card-badges">${inner}</div>` : "";
}

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
// picks that week, the same as #1 in that week's list. Weeks with fewer than
// four games (the SEC Championship, the later Playoff rounds) don't crown one.
const MIN_CHAMPION_GAMES = 4;
function computeWeeklyChampions() {
  weeklyChampions = {};
  championsByWeek = {};
  championRecords = {};
  const weeks = new Set(allWeekRows.map(r => r.week_number));
  weeks.forEach(w => {
    if (w >= CURRENT_OPEN_WEEK || (weekSchedules[w] || []).length < MIN_CHAMPION_GAMES) return;
    const rows = allWeekRows.filter(r => !r.is_host && r.week_number === w)
      .map(r => ({ name: r.user_name, ...gradePicks(r.picks, w) }));
    const best = Math.max(0, ...rows.map(r => r.correct));
    if (best === 0) return;
    const winners = rows.filter(r => r.correct === best);
    championsByWeek[w] = winners.map(r => r.name).sort((a, b) => a.localeCompare(b));
    championRecords[w] = `${best}-${Math.min(...winners.map(r => r.incorrect))}`;
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
    // Under the week's stat cards when the page has them; otherwise under
    // the section title.
    const cards = document.getElementById("weekFanStats");
    if (cards) cards.after(line); else bar.after(line);
  }
  const week = championsByWeek[weekNum] ? weekNum : (weekNum === CURRENT_OPEN_WEEK && championsByWeek[weekNum - 1] ? weekNum - 1 : null);
  if (!week) {
    line.style.display = "none";
    return;
  }
  const names = championsByWeek[week];
  line.innerHTML = `<div class="pulse-label">&#127942; ${weekName(week)} ${names.length > 1 ? "Champions" : "Champion"}</div>
    <div class="pulse-stat">${championRecords[week] || ""}</div>
    <div class="champion-line-names">${names.map(n => `<span>${podiumLogoHtml(n)}${escapeHtml(n)}</span>`).join("")}</div>`;
  line.style.display = "";
}

// The visitor's time zone, short: "EDT", "CST". Times on the site are
// already in the visitor's own zone; this labels them so they know.
function tzAbbr(date) {
  try {
    const part = new Intl.DateTimeFormat([], { timeZoneName: "short" }).formatToParts(date).find(p => p.type === "timeZoneName");
    return part ? part.value : "";
  } catch (e) { return ""; }
}

// "Week 7", or the SEC pages' names for later weeks ("SEC Championship").
const weekName = w => (typeof WEEK_NAMES !== "undefined" && WEEK_NAMES[w]) || `Week ${w}`;
const weekShort = w => (typeof WEEK_SHORT !== "undefined" && WEEK_SHORT[w]) || `W${w}`;

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
    accountHelp: SITE.accountHelp || "us",
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
  root.querySelectorAll("[data-contact-box]").forEach(el => { el.innerHTML = contactBoxHtml(siteText(el.dataset.contactBox)); });
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

// A listener's pick on a game that kicked off more than 3 minutes before
// they submitted doesn't count. The page won't offer those games, but this
// catches entries sent around it. The database stamps each entry's time.
const LATE_PICK_GRACE_MS = 3 * 60 * 1000;
// Entries sent before the change (Nov 14, 2026, 10 AM Eastern) keep the old
// 15 minutes, so past weeks' standings don't move.
const OLD_GRACE_UNTIL = Date.parse("2026-11-14T15:00:00Z");
const graceFor = at => at < OLD_GRACE_UNTIL ? 15 * 60 * 1000 : LATE_PICK_GRACE_MS;
// True once a game is past that cutoff (scheduled kickoff plus 3 minutes).
const pastPickCutoff = kickoff => kickoff instanceof Date && kickoff.getFullYear() < 9999 &&
  Date.now() - kickoff.getTime() > LATE_PICK_GRACE_MS;

function dropLatePicks(row) {
  if (row.is_host || !row.created_at) return;
  const at = new Date(row.created_at).getTime();
  if (isNaN(at)) return;
  const picks = { ...parseUserPicks(row.picks) };
  let changed = false;
  (weekSchedules[row.week_number] || []).forEach(game => {
    const kick = game.kickoff instanceof Date ? game.kickoff.getTime() : NaN;
    if (isNaN(kick) || game.kickoff.getFullYear() >= 9999 || at - kick <= graceFor(at)) return;
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

// ---- Changing picks ----
// Every submission is kept. For each game, the pick that counts is the
// latest one sent before kickoff (plus the 3-minute grace period), so a change can't
// reach a game that has started. Only entries from a signed-in account can
// change picks; older duplicate entries without one are ignored, as before.
const entryTime = r => new Date(r.created_at).getTime();
const kickedOffBefore = (at, game) => {
  const kick = game && game.kickoff instanceof Date ? game.kickoff.getTime() : NaN;
  return !isNaN(kick) && game.kickoff.getFullYear() < 9999 && at - kick > graceFor(at);
};

// rows: one person's entries for one week. Returns one row with the picks
// that count, dated by the first entry.
function mergeEntryRows(rows, games) {
  const sorted = [...rows].sort((a, b) => entryTime(a) - entryTime(b));
  const first = sorted[0];
  const entries = [first, ...sorted.slice(1).filter(r => r.user_id)];
  if (entries.length === 1 || !games || !games.length) return first;
  const parsed = entries.map(r => ({ at: entryTime(r), picks: parseUserPicks(r.picks) }));

  const picks = {};
  games.forEach(game => {
    for (let i = parsed.length - 1; i >= 0; i--) {
      if (kickedOffBefore(parsed[i].at, game)) continue;
      const pick = getMatchedUserPick(parsed[i].picks, game);
      if (pick) { picks[game.matchupKey] = pick; break; }
    }
  });

  // The Lock can move only while both the old and the new Lock games are
  // still to come.
  let lock = null;
  parsed.forEach(e => {
    const game = games.find(g => isLockMatch(e.picks, g));
    if (!game || kickedOffBefore(e.at, game)) return;
    if (lock && kickedOffBefore(e.at, lock)) return;
    lock = game;
  });
  if (lock) picks.lock_matchup_key = lock.matchupKey;

  return { ...sorted[sorted.length - 1], id: first.id, created_at: first.created_at, picks, changed: true };
}

// The signed-in player's picks that count for a week, for the picks page.
// { picks, lockKey, lockStarted } or null if they haven't entered.
async function loadMyEntry(week, games, name) {
  if (!name) return null;
  const { data, error } = await supabaseClient.from(PICKS_TABLE)
    .select("*").eq("week_number", week).ilike("user_name", name).order("created_at", { ascending: true });
  if (error || !data || !data.length) return null;
  const row = mergeEntryRows(data, games);
  dropLatePicks(row);
  const picks = parseUserPicks(row.picks);
  const lockGame = games.find(g => isLockMatch(picks, g));
  return { picks, lockKey: lockGame ? lockGame.matchupKey : null, lockStarted: !!(lockGame && lockGame.isFinal) };
}

// Marks a saved entry's picks on the picks page. choose(matchupKey, team)
// and toggleLock(matchupKey) are the page's own handlers.
function applySavedPicks(saved, games, choose, toggleLock) {
  games.filter(g => !g.isFinal).forEach(g => {
    const pick = getMatchedUserPick(saved.picks, g);
    const n = normalizeTeam(pick || "");
    const team = n && n === normalizeTeam(g.teamA) ? g.teamA : n && n === normalizeTeam(g.teamB) ? g.teamB : null;
    if (team) choose(g.matchupKey, team);
  });
  if (saved.lockKey && !saved.lockStarted) toggleLock(saved.lockKey);
  if (saved.lockStarted) document.querySelectorAll(".btn-lock-toggle").forEach(b => { b.style.display = "none"; });
  const btn = document.getElementById("submitBtn");
  if (btn) { btn.dataset.label = "Update Picks"; btn.textContent = "Update Picks"; }
  const lockNote = saved.lockStarted ? " Your Lock of the Week has kicked off, so it stays." : "";
  setStatus("var(--text-muted)", `These are your saved picks. Change any game that hasn't kicked off and tap Update Picks.${lockNote}`);
}

// All rows, a page at a time (the database sends at most 1,000 per request).
async function fetchAllPickRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseClient.from(PICKS_TABLE).select("*")
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

// Every row, one per person per week: their picks that count.
async function loadAllSeasonData() {
  try {
    const rows = await fetchAllPickRows();

    const groups = new Map();
    rows.forEach(r => {
      const key = `${r.user_name?.toLowerCase().trim()}_w${r.week_number}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    allWeekRows = [...groups.values()].map(g => g[0]);

    const uniqueWeeks = Array.from(
      new Set(allWeekRows.map(r => r.week_number).concat([1, activeWeek]))
    ).filter(w => w >= 1 && w <= TOTAL_WEEKS);
    await Promise.all([...uniqueWeeks.map(fetchEspnSchedule), loadPlayerFavorites()]);
    allWeekRows = [...groups.values()].map(g => g.length > 1 ? mergeEntryRows(g, weekSchedules[g[0].week_number] || []) : g[0]);
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
// Picks are open for the current week. In the postseason, a later round also
// opens as soon as its matchups are set, since bowls can still be going on.
function picksOpen(weekNum) {
  if (weekNum === CURRENT_OPEN_WEEK) return true;
  if (typeof REGULAR_WEEKS === "undefined" || weekNum <= REGULAR_WEEKS || weekNum < CURRENT_OPEN_WEEK) return false;
  const now = new Date();
  return (weekSchedules[weekNum] || []).some(g => g.kickoff > now && !/\btbd\b/i.test(`${g.teamA} ${g.teamB}`));
}

function updateSubmitButton(weekNum, page) {
  renderChampionLine(weekNum);
  const ctaBtn = document.getElementById("ctaBtn");
  if (picksOpen(weekNum)) {
    ctaBtn.style.display = "flex";
    ctaBtn.innerHTML = `<span>Submit ${weekName(weekNum)} Picks &rarr;</span>`;
    ctaBtn.href = `${page}?week=${weekNum}`;
    // Signed out: sign in first, then on to the picks. Already entered:
    // the button is for changing them.
    supabaseClient.auth.getSession().then(async ({ data }) => {
      if (data && data.session) {
        const account = await currentAccount();
        const me = account && account.name && account.name.toLowerCase();
        if (me && allWeekRows.some(r => !r.is_host && r.week_number === weekNum && (r.user_name || "").toLowerCase() === me)) {
          ctaBtn.innerHTML = `<span>Change ${weekName(weekNum)} Picks &rarr;</span>`;
        }
        return;
      }
      ctaBtn.innerHTML = `<span>Sign In &amp; Submit ${weekName(weekNum)} Picks &rarr;</span>`;
      ctaBtn.href = signInUrl(`${page}?week=${weekNum}`);
    }).catch(() => {});
  } else {
    ctaBtn.style.display = "none";
  }
}

// Moves the signed-in player's card to the top of the week's list, open,
// with a little space below it. Their rank badge still shows where they stand.
function pinMyCard() {
  let name = "";
  try { name = localStorage.getItem("secPickEmUserName") || ""; } catch (e) {}
  const list = document.getElementById("cousinsList");
  if (!name || !list) return;
  const squash = s => (s || "").trim().toLowerCase().replace(/^@/, "").replace(/\s+/g, "");
  const card = [...list.querySelectorAll(".cousin-item")].find(el => squash(el.dataset.name) === squash(name));
  if (!card || list.children.length < 2) return;
  card.classList.add("pinned-me");
  list.prepend(card);
  // Their own card starts open; everyone else's stays closed.
  const body = card.querySelector(".cousin-picks-body");
  if (body) body.classList.add("open");
}

// Season podium: most correct picks, then fewest losses. An identical record
// is a shared spot, shown as a tie. totals: [{ user_name, correct, incorrect }].
// Each player's season record, kept from the podium's totals for the
// opened cards. lower-case name -> { c, i }
let seasonRecords = {};

function renderPodium(totals, anyDecidedGames, { namesOpen, noun }) {
  seasonRecords = {};
  totals.forEach(t => { seasonRecords[(t.user_name || "").toLowerCase()] = { c: t.correct, i: t.incorrect }; });
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

  // One row per place: the badge, everyone at that record, then the record.
  top5Container.innerHTML = podiumTiers.map((tier, idx) => {
    const names = [...tier.members].sort((a, b) => a.user_name.localeCompare(b.user_name))
      .map(m => `<span class="podium-name">${podiumLogoHtml(m.user_name)}<strong>${m.user_name}</strong></span>`).join("");
    return `
      <div class="top3-item podium-row">
        <span class="rank-badge ${podiumRankClasses[idx]}" style="width: 22px; height: 22px; font-size: 0.7rem; margin-right: 0.4rem;">${idx + 1}</span>
        <div class="podium-names">${names}</div>
        <span class="podium-record">${tier.correct}-${tier.incorrect}</span>
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
  submitBtn.textContent = submitBtn.dataset.label || "Submit Ballot";
}

// ---- Logo tiles ----
// Every ESPN team logo on the page becomes a rounded square in the team's
// color with the white version of its logo, like the CFP rankings graphic.
// Team colors come from ESPN's team lists, saved on the device for a week.
const LOGO_RE = /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/(ncaa|nfl)\/500(?:-dark)?\/(?:scoreboard\/)?([a-z0-9]+)\.png/i;
const TEAM_LIST_URLS = {
  ncaa: [
    "https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?groups=80&limit=300",
    "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=400"
  ],
  nfl: ["https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams"]
};
const TEAM_COLOR_DAYS = 7;
// Square team-color tiles behind logos. Off: logos show with the glow.
const LOGO_TILES_ON = false;
// Every ESPN team logo is drawn this much bigger than its spot's size.
const LOGO_TILE_SCALE = 1.25;
const tileColors = { ncaa: null, nfl: null };
const tileColorLoads = {};

// league -> { idOrAbbr: [color, alternateColor] }
function loadTeamColors(league) {
  if (tileColors[league]) return Promise.resolve(tileColors[league]);
  if (tileColorLoads[league]) return tileColorLoads[league];
  tileColorLoads[league] = (async () => {
    try {
      const saved = JSON.parse(localStorage.getItem(`teamColors_${league}`) || "null");
      if (saved && Date.now() - saved.at < TEAM_COLOR_DAYS * 864e5) return (tileColors[league] = saved.colors);
    } catch (e) {}
    const colors = {};
    for (const url of TEAM_LIST_URLS[league]) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        const teams = (((data.sports || [])[0] || {}).leagues || [])[0];
        ((teams && teams.teams) || []).forEach(({ team }) => {
          if (!team || !team.color) return;
          const entry = [team.color, team.alternateColor || ""];
          if (team.id && !colors[team.id]) colors[team.id] = entry;
          if (team.abbreviation) colors[team.abbreviation.toLowerCase()] = colors[team.abbreviation.toLowerCase()] || entry;
        });
      } catch (e) {}
    }
    if (Object.keys(colors).length) {
      try { localStorage.setItem(`teamColors_${league}`, JSON.stringify({ at: Date.now(), colors })); } catch (e) {}
    }
    return (tileColors[league] = colors);
  })();
  return tileColorLoads[league];
}

// Team colors also come from any ESPN data the page loads (scoreboards,
// schedules), in case the team lists don't. league -> { id: [color, alt] }
const harvestedColors = { ncaa: {}, nfl: {} };
function harvestColors(obj, league, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 9) return 0;
  let added = 0;
  if (obj.id && /^[0-9a-f]{6}$/i.test(obj.color || "")) {
    const entry = [obj.color, obj.alternateColor || ""];
    if (!harvestedColors[league][obj.id]) { harvestedColors[league][obj.id] = entry; added++; }
    if (obj.abbreviation) harvestedColors[league][obj.abbreviation.toLowerCase()] = harvestedColors[league][obj.abbreviation.toLowerCase()] || entry;
  }
  for (const v of Array.isArray(obj) ? obj : Object.values(obj)) {
    if (v && typeof v === "object") added += harvestColors(v, league, depth + 1);
  }
  return added;
}
const pageFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await pageFetch(...args);
  try {
    const url = String((args[0] && args[0].url) || args[0] || "");
    if (/espn\.com\/apis\//.test(url) && res.ok) {
      res.clone().json().then(data => {
        if (harvestColors(data, /\/nfl\//.test(url) ? "nfl" : "ncaa")) {
          // Try again on logos that had no color yet.
          document.querySelectorAll('img[data-tile="none"]').forEach(img => { delete img.dataset.tile; tileLogo(img); });
        }
      }).catch(() => {});
    }
  } catch (e) {}
  return res;
};

// Dark-ish, saturated enough to sit behind a white logo.
const usableColor = hex => /^[0-9a-f]{6}$/i.test(hex || "") && hex.toLowerCase() !== "ffffff" && hex.toLowerCase() !== "000000" ? hex : "";

// Tiles off: just make the logo bigger and leave the glow.
function growLogo(img) {
  if (img.dataset.grown || !LOGO_RE.test(img.getAttribute("src") || "")) return;
  const grow = () => {
    const w = parseFloat(getComputedStyle(img).width) || img.getBoundingClientRect().width || 0;
    if (!w || img.dataset.grown) return;
    const size = `${Math.round(w * LOGO_TILE_SCALE)}px`;
    img.style.width = img.style.height = size;
    if (getComputedStyle(img.parentElement).display.includes("flex")) img.style.flexBasis = size;
    img.dataset.grown = "1";
  };
  grow();
  if (!img.dataset.grown) img.addEventListener("load", grow, { once: true });
}

async function tileLogo(img) {
  if (!LOGO_TILES_ON) return growLogo(img);
  if (img.dataset.tile) return;
  const match = (img.getAttribute("src") || "").match(LOGO_RE);
  if (!match) return;
  img.dataset.tile = "pending";
  const [, league, key] = match;
  const colors = await loadTeamColors(league.toLowerCase());
  const entry = colors[key.toLowerCase()] || harvestedColors[league.toLowerCase()][key.toLowerCase()];
  const color = entry && (usableColor(entry[0]) || usableColor(entry[1]) || entry[0]);
  if (!color) {
    img.dataset.tile = "none";
    return;
  }
  const original = img.getAttribute("src");
  // Tiles are 15% bigger than the logo was, with the logo inset 12%.
  const sizeIt = () => {
    let w = parseFloat(getComputedStyle(img).width) || img.getBoundingClientRect().width || 0;
    if (!w) return;
    if (!img.dataset.grown) {
      w = Math.round(w * LOGO_TILE_SCALE);
      img.style.width = img.style.height = `${w}px`;
      img.dataset.grown = "1";
    }
    img.style.padding = `${Math.max(1, Math.round(w * 0.12))}px`;
  };
  img.dataset.tile = "done";
  img.classList.add("logo-tile");
  img.style.backgroundColor = `#${color}`;
  img.onerror = () => {
    // No white version: the normal logo on a light tile instead.
    img.onerror = null;
    img.style.backgroundColor = "#f1f5f9";
    img.src = original;
  };
  img.src = `https://a.espncdn.com/i/teamlogos/${league.toLowerCase()}/500-dark/${key}.png`;
  sizeIt();
  if (!img.style.padding) img.addEventListener("load", sizeIt, { once: true });
}

function tileLogosIn(root) {
  if (!root || !root.querySelectorAll) return;
  if (root.tagName === "IMG") tileLogo(root);
  root.querySelectorAll("img").forEach(tileLogo);
}

// Add ?tiles=debug to a page's address to see what the tiles found.
function showTileDebug() {
  const imgs = [...document.querySelectorAll("img")];
  const espn = imgs.filter(i => /espncdn/.test(i.getAttribute("src") || "") || i.dataset.tile);
  const count = v => espn.filter(i => i.dataset.tile === v).length;
  const box = document.createElement("pre");
  box.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#000;color:#0f0;font-size:11px;padding:8px;white-space:pre-wrap;max-height:45vh;overflow:auto;border:1px solid #0f0";
  box.textContent = [
    `logos: ${espn.length}  tiled: ${count("done")}  no color: ${count("none")}  waiting: ${count("pending")}  untouched: ${espn.filter(i => !i.dataset.tile).length}`,
    `team list colors: ncaa ${Object.keys(tileColors.ncaa || {}).length}, nfl ${Object.keys(tileColors.nfl || {}).length}`,
    `page data colors: ncaa ${Object.keys(harvestedColors.ncaa).length}, nfl ${Object.keys(harvestedColors.nfl).length}`,
    "sample logo addresses:",
    ...espn.slice(0, 4).map(i => i.getAttribute("src"))
  ].join("\n");
  document.body.appendChild(box);
}

// Not on the graphics page: its canvases draw their own logos.
if (!/graphics\.html$/i.test(location.pathname)) {
  document.addEventListener("DOMContentLoaded", () => {
    tileLogosIn(document.body);
    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(tileLogosIn)))
      .observe(document.body, { childList: true, subtree: true });
    if (LOGO_TILES_ON && /[?&]tiles=debug/.test(location.search)) setTimeout(showTileDebug, 8000);
  });
}
