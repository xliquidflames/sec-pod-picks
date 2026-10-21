// Supabase Edge Function "episodes": the show's latest YouTube videos with
// their chapter timestamps. Uses the YouTube Data API (free key in the secret
// YOUTUBE_API_KEY; each refresh costs at most 4 of the 10,000 free daily units),
// falling back to the channel's public feed. Cached 3 hours in series_cache.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const CACHE_MS = 3 * 60 * 60 * 1000;

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const decode = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// "6:30 -- Mizzou at Ole Miss" or "1:02:00 - upsets coming?"
function chaptersFrom(description: string) {
  const chapters: { seconds: number; label: string }[] = [];
  description.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*[-–—:|]*\s*(.+?)\s*$/);
    if (m) chapters.push({ seconds: (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]), label: m[4] });
  });
  return chapters;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let channel = "";
  try { channel = String((await req.json()).channel || "").trim(); } catch (_) {}
  if (!/^UC[\w-]{22}$/.test(channel)) return reply({ error: "a YouTube channel ID is required" }, 400);

  const key = `youtube3:${channel}`;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cached } = await db.from("series_cache").select("data, fetched_at").eq("matchup", key).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_MS) return reply(cached.data);

  let episodes: { id: string; title: string; published: string; chapters: { seconds: number; label: string }[] }[] | null = null;

  // YouTube Data API: the channel's uploads playlist is its ID with UC -> UU.
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (apiKey) {
    // Shorts crowd the list, so read up to 4 pages of 50 (1 unit each),
    // stopping once uploads are more than 5 weeks old.
    const cutoff = Date.now() - 35 * 86400000;
    let page = "";
    const found: NonNullable<typeof episodes> = [];
    let ok = true;
    for (let i = 0; i < 4; i++) {
      const api = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=UU${channel.slice(2)}&key=${apiKey}${page ? `&pageToken=${page}` : ""}`;
      const res = await fetch(api);
      if (!res.ok) {
        console.error("YouTube API error", res.status, await res.text());
        ok = i > 0;
        break;
      }
      const json = await res.json();
      (json.items || []).forEach((item: any) => {
        const sn = item.snippet || {};
        found.push({
          id: (sn.resourceId && sn.resourceId.videoId) || "",
          title: sn.title || "",
          published: sn.publishedAt || "",
          chapters: chaptersFrom(sn.description || "")
        });
      });
      const last = found[found.length - 1];
      page = json.nextPageToken || "";
      if (!page || (last && new Date(last.published).getTime() < cutoff)) break;
    }
    // Keep videos with chapters (linked from a game's details) and any
    // "Week #..." episode, even before its chapters are added (Info Hub).
    if (ok) episodes = found.filter(e => e.id && (e.chapters.length || /\bweek\s*\d+/i.test(e.title)));
  }

  // Public feed, if there's no key or the API failed.
  if (!episodes) {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`);
    if (res.ok) {
      const xml = await res.text();
      episodes = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
        const entry = m[1];
        const get = (re: RegExp) => (entry.match(re) || [])[1] || "";
        return {
          id: get(/<yt:videoId>([^<]+)<\/yt:videoId>/),
          title: decode(get(/<title>([^<]*)<\/title>/)),
          published: get(/<published>([^<]+)<\/published>/),
          chapters: chaptersFrom(decode(get(/<media:description>([\s\S]*?)<\/media:description>/)))
        };
      }).filter(e => e.id);
    }
  }

  if (!episodes) {
    if (cached) return reply(cached.data);
    return reply({ error: "Couldn't read the channel from YouTube" }, 502);
  }

  const data = { episodes };
  await db.from("series_cache").upsert({ matchup: key, data, fetched_at: new Date().toISOString() });
  return reply(data);
});
