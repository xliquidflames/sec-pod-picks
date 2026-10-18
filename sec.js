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