// Supabase Edge Function "teamstats": every FBS team's national rank in a few
// season stats, for the "Stat Rankings" box in game details. Two calls to
// CollegeFootballData.com: every team's season totals, and every game's final
// score (the totals don't include points). This ranks them and saves the
// result in series_cache for 12 hours.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const KEEP = 12 * 60 * 60 * 1000;
const CFBD_WAIT = 8000;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Each ranked stat: how to work it out from a team's totals, and whether a
// bigger number is better. Per-game stats divide by games played. A stat
// CFBD doesn't send is left out.
type Totals = Record<string, number>;
const perGame = (key: string) => (t: Totals) => t[key] !== undefined && t.games ? t[key] / t.games : undefined;
const rate = (made: string, tries: string) => (t: Totals) => t[made] !== undefined && t[tries] ? t[made] / t[tries] : undefined;

const STATS: { key: string; value: (t: Totals) => number | undefined; higherIsBetter: boolean }[] = [
  // Points come from the game list, divided by the games counted there.
  { key: "scoringOffense", value: t => t.scoredGames ? t.pointsScored / t.scoredGames : undefined, higherIsBetter: true },
  { key: "scoringDefense", value: t => t.scoredGames ? t.pointsAllowed / t.scoredGames : undefined, higherIsBetter: false },
  { key: "passingOffense", value: perGame("netPassingYards"), higherIsBetter: true },
  { key: "passingDefense", value: perGame("netPassingYardsOpponent"), higherIsBetter: false },
  { key: "rushingOffense", value: perGame("rushingYards"), higherIsBetter: true },
  { key: "rushingDefense", value: perGame("rushingYardsOpponent"), higherIsBetter: false },
  { key: "thirdDownOffense", value: rate("thirdDownConversions", "thirdDowns"), higherIsBetter: true },
  { key: "thirdDownDefense", value: rate("thirdDownConversionsOpponent", "thirdDownsOpponent"), higherIsBetter: false }
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let year = 2026;
  try { year = Number((await req.json()).year) || 2026; } catch (_) {}
  if (year < 2000 || year > 2100) return reply({ error: "bad year" }, 400);

  const key = `teamstats2:${year}`;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cached } = await db.from("series_cache").select("data, fetched_at").eq("matchup", key).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < KEEP) return reply(cached.data);

  let rows: { team: string; statName: string; statValue: number | string }[] | null = null;
  try {
    const res = await fetch(`https://api.collegefootballdata.com/stats/season?year=${year}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("CFBD_API_KEY")}` },
      signal: AbortSignal.timeout(CFBD_WAIT)
    });
    if (res.ok) rows = await res.json();
    else console.error("CFBD returned", res.status);
  } catch (err) {
    console.error("CFBD error", err);
  }
  if (!rows) {
    if (cached) return reply(cached.data);
    return reply({ error: "Couldn't get season stats from CFBD" }, 502);
  }

  // Every finished game this season, for points scored and allowed.
  type Game = Record<string, unknown>;
  let games: Game[] = [];
  try {
    const res = await fetch(`https://api.collegefootballdata.com/games?year=${year}`, {
      headers: { Authorization: `Bearer ${Deno.env.get("CFBD_API_KEY")}` },
      signal: AbortSignal.timeout(CFBD_WAIT)
    });
    if (res.ok) games = await res.json();
    else console.error("CFBD games returned", res.status);
  } catch (err) {
    console.error("CFBD games error", err);
  }

  // Each team's totals by stat name.
  const totals: Record<string, Totals> = {};
  const statNames = new Set<string>();
  rows.forEach(r => {
    const v = Number(r.statValue);
    if (!r.team || isNaN(v)) return;
    (totals[r.team] ||= {})[r.statName] = v;
    statNames.add(r.statName);
  });

  // Newer CFBD names fields homeTeam/homePoints; older ones home_team/home_points.
  games.forEach(g => {
    const home = (g.homeTeam ?? g.home_team) as string, away = (g.awayTeam ?? g.away_team) as string;
    const hp = Number(g.homePoints ?? g.home_points), ap = Number(g.awayPoints ?? g.away_points);
    if (!home || !away || g.homePoints === null || g.awayPoints === null || isNaN(hp) || isNaN(ap)) return;
    if ((g.completed ?? true) === false) return;
    [[home, hp, ap], [away, ap, hp]].forEach(([team, pf, pa]) => {
      const t = totals[team as string];
      if (!t) return; // only teams that have season stats get ranked
      t.pointsScored = (t.pointsScored || 0) + (pf as number);
      t.pointsAllowed = (t.pointsAllowed || 0) + (pa as number);
      t.scoredGames = (t.scoredGames || 0) + 1;
    });
  });

  // Rank every team that has the stat; ties share the better rank.
  const ranks: Record<string, Record<string, number>> = {};
  const counts: Record<string, number> = {};
  STATS.forEach(stat => {
    const list = Object.entries(totals)
      .map(([team, t]) => ({ team, v: stat.value(t) }))
      .filter((x): x is { team: string; v: number } => typeof x.v === "number" && isFinite(x.v));
    if (!list.length) return;
    list.sort((a, b) => stat.higherIsBetter ? b.v - a.v : a.v - b.v);
    let rank = 0;
    list.forEach((x, i) => {
      if (i === 0 || x.v !== list[i - 1].v) rank = i + 1;
      (ranks[x.team] ||= {})[stat.key] = rank;
    });
    counts[stat.key] = list.length;
  });

  const data = { year, ranks, counts, statNames: [...statNames].sort() };
  await db.from("series_cache").upsert({ matchup: key, data, fetched_at: new Date().toISOString() });
  return reply(data);
});
