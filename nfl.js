// NFL pages (nflindex, nflmakepicks): team names and ESPN feed. Loads after common.js.

const TOTAL_WEEKS = 18;
const WEEK_NUMS = Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1);
const PICKS_TABLE = "nfl_picks";

const scoreboardUrl = week => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&dates=2026&week=${week}&limit=100`;

// Lock of the Week counts every week.
const isLockWeek = () => true;

// Every spelling ESPN might use for each team: mascot, city + mascot, the
// "NY"/"LA" forms, and the odds abbreviation ("DAL -3.5").
const nflTeamAliases = {
  cardinals: ["Cardinals", "Arizona Cardinals", "Arizona", "ARI"],
  falcons: ["Falcons", "Atlanta Falcons", "Atlanta", "ATL"],
  ravens: ["Ravens", "Baltimore Ravens", "Baltimore", "BAL"],
  bills: ["Bills", "Buffalo Bills", "Buffalo", "BUF"],
  panthers: ["Panthers", "Carolina Panthers", "Carolina", "CAR"],
  bears: ["Bears", "Chicago Bears", "Chicago", "CHI"],
  bengals: ["Bengals", "Cincinnati Bengals", "Cincinnati", "CIN"],
  browns: ["Browns", "Cleveland Browns", "Cleveland", "CLE"],
  cowboys: ["Cowboys", "Dallas Cowboys", "Dallas", "DAL"],
  broncos: ["Broncos", "Denver Broncos", "Denver", "DEN"],
  lions: ["Lions", "Detroit Lions", "Detroit", "DET"],
  packers: ["Packers", "Green Bay Packers", "Green Bay", "GB"],
  texans: ["Texans", "Houston Texans", "Houston", "HOU"],
  colts: ["Colts", "Indianapolis Colts", "Indianapolis", "IND"],
  jaguars: ["Jaguars", "Jacksonville Jaguars", "Jacksonville", "Jags", "JAX"],
  chiefs: ["Chiefs", "Kansas City Chiefs", "Kansas City", "KC"],
  raiders: ["Raiders", "Las Vegas Raiders", "Las Vegas", "LV"],
  chargers: ["Chargers", "Los Angeles Chargers", "LA Chargers", "LAC"],
  rams: ["Rams", "Los Angeles Rams", "LA Rams", "LAR"],
  dolphins: ["Dolphins", "Miami Dolphins", "Miami", "MIA"],
  vikings: ["Vikings", "Minnesota Vikings", "Minnesota", "MIN"],
  patriots: ["Patriots", "New England Patriots", "New England", "Pats", "NE"],
  saints: ["Saints", "New Orleans Saints", "New Orleans", "NO"],
  giants: ["Giants", "New York Giants", "NY Giants", "NYG"],
  jets: ["Jets", "New York Jets", "NY Jets", "NYJ"],
  eagles: ["Eagles", "Philadelphia Eagles", "Philadelphia", "PHI"],
  steelers: ["Steelers", "Pittsburgh Steelers", "Pittsburgh", "PIT"],
  niners: ["49ers", "San Francisco 49ers", "San Francisco", "SF"],
  seahawks: ["Seahawks", "Seattle Seahawks", "Seattle", "SEA"],
  buccaneers: ["Buccaneers", "Tampa Bay Buccaneers", "Tampa Bay", "Bucs", "TB"],
  titans: ["Titans", "Tennessee Titans", "Tennessee", "TEN"],
  commanders: ["Commanders", "Washington Commanders", "Washington", "WSH", "WAS"]
};

const nflNameCanonical = {};
Object.entries(nflTeamAliases).forEach(([canonicalKey, variants]) => {
  variants.forEach(variant => { nflNameCanonical[crudeName(variant)] = canonicalKey; });
});

function normalizeTeam(str) {
  if (!str) return "";
  const cleaned = crudeName(str);
  return nflNameCanonical[cleaned] || cleaned;
}

function buildMatchupKey(teamA, teamB) {
  return `${normalizeTeam(teamA)}_vs_${normalizeTeam(teamB)}`;
}

// A team's logo from the scoreboard, as a small image (or nothing).
function nflLogoHtml(team, cls = "nfl-logo") {
  const url = team && (team.logo || (team.logos && team.logos[0] && team.logos[0].href));
  return url ? `<img src="${url}" alt="" class="${cls}" onerror="this.style.display='none'">` : "";
}
