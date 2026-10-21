// Supabase Edge Function "series": the all-time head-to-head history of two
// teams from CollegeFootballData.com. The CFBD key stays here on the server
// (secret CFBD_API_KEY). CFBD's free plan has a monthly call limit, so each
// matchup is saved in the series_cache table and reused for 30 days: the
// history only changes when the teams play. When the site says the teams
// just finished a game (finished = its kickoff time) and the saved copy is
// older than that game, it's fetched once more to pick up the result. If
// CFBD is slow, down or out of calls, any saved copy is used, however old.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const HOUR = 60 * 60 * 1000;
const KEEP = 30 * 24 * HOUR;
const CFBD_WAIT = 5000;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let team1 = "", team2 = "", finished = 0;
  try {
    const body = await req.json();
    team1 = String(body.team1 || "").trim();
    team2 = String(body.team2 || "").trim();
    finished = Date.parse(String(body.finished || "")) || 0;
  } catch (_) {}
  if (!team1 || !team2 || team1.length > 60 || team2.length > 60) return reply({ error: "team1 and team2 are required" }, 400);

  const [a, b] = [team1, team2].sort();
  const matchup = `${a}|${b}`;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cached } = await db.from("series_cache").select("data, fetched_at").eq("matchup", matchup).maybeSingle();
  if (cached) {
    const savedAt = new Date(cached.fetched_at).getTime();
    // Saved before the game could have ended (kickoff + 4 hours), and it's
    // over now: fetch once more. After that the copy is newer than the game.
    const beforeResult = finished > 0 && savedAt < finished + 4 * HOUR && Date.now() > finished + 4 * HOUR;
    if (Date.now() - savedAt < KEEP && !beforeResult) return reply(cached.data);
  }

  const url = `https://api.collegefootballdata.com/teams/matchup?team1=${encodeURIComponent(a)}&team2=${encodeURIComponent(b)}`;
  let res: Response | null = null;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${Deno.env.get("CFBD_API_KEY")}` },
      signal: AbortSignal.timeout(CFBD_WAIT)
    });
  } catch (_) {
    res = null;
  }
  if (!res || !res.ok) {
    // CFBD is slow, down or out of calls: an older copy beats nothing.
    if (cached) return reply(cached.data);
    return reply({ error: res ? `CFBD returned ${res.status}` : "CFBD took too long" }, 502);
  }
  const data = await res.json();
  await db.from("series_cache").upsert({ matchup, data, fetched_at: new Date().toISOString() });
  return reply(data);
});
