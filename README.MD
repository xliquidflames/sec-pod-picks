# Podcast Pick'em Site

A free pick'em website for a college football podcast and its listeners:

- **SEC Football** (`index.html`, `makepicks.html`): weekly straight-up picks with a Lock of the Week, the hosts' picks beside the listeners' consensus, season standings, and a details popup for every game (score, stats, series history, stat rankings, both schedules and links to where the show discusses it).
- **NFL** (`nflindex.html`, `nflmakepicks.html`): the same weekly picks for the NFL, listeners only.
- **SEC Hoops** (`hoopsindex.html`, `hoopsmakepicks.html`): the same for SEC men's basketball, with Monday–Sunday weeks.
- **Host picks** (`hostpicks.html`): where the hosts enter their own picks and predicted scores, behind a PIN.
- **March Madness** (`hoopsMMBracket.html` for standings, `hoopsMMPicks.html` for filling out a bracket, both using `hoopsMMBracket.js`): a bracket challenge.
- **Admin** (`admin.html`): a PIN-protected page for checking entries.

It runs entirely on free services: GitHub Pages hosts the pages, Supabase stores the picks, and the game data comes from ESPN's public feeds. There's no server to run and nothing to install. All setup happens in a web browser, and you can do it from a phone.

---

## What you'll need

| Account | What it's for | Required? |
|---|---|---|
| [GitHub](https://github.com) | Hosts the website for free (GitHub Pages) | Yes |
| [Supabase](https://supabase.com) | Database for everyone's picks, plus three small server functions | Yes |
| [CollegeFootballData.com](https://collegefootballdata.com) | Free API key for series history and stat rankings | Optional |
| [Google Cloud](https://console.cloud.google.com) | Free YouTube API key for "On the Pod" episode links | Optional |
| [GoatCounter](https://www.goatcounter.com) | Free visitor counts | Optional |

None of these needs a credit card. If Google Cloud offers a paid trial, skip it, because the YouTube API key works without one.

---

## 1. Copy the site

1. Sign in to GitHub and **fork** this repository, from the account that will own the new site. GitHub won't fork a repository into the account that already owns it. A fork stays linked to the original, so later fixes made there show up as a **Sync fork** button in yours. If you'd rather have an unlinked copy, the original's owner can turn on **Settings → Template repository**, and then anyone can make a copy with **Use this template**.
2. In your repository, go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute or two the site is live at `https://<your-username>.github.io/<repository-name>/`.

---

## 2. Set up the database (Supabase)

1. Create a free Supabase account and a **New project**. Pick any name and region, and save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste in all of [`supabase/setup.sql`](supabase/setup.sql), and tap **Run**. This creates every table the site uses, with the right permissions. Run it once only, because running it a second time errors on the parts that already exist.
3. Go to **Project Settings → API Keys** (or **Data API**) and copy two things:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **publishable key** (`sb_publishable_…`), sometimes labeled the *anon* key

   These two values go in `config.js` (step 4). The publishable key is meant to be public. Never put the **secret** or **service role** key in any site file.

---

## 3. Set up the server functions (optional extras)

Three small Supabase Edge Functions power the extras in the game details popup. The site works without them, and the boxes they fill just don't appear.

| Function | Powers | Needs the secret |
|---|---|---|
| `series` | Series History (all-time record between the two teams) | `CFBD_API_KEY` |
| `teamstats` | Stat Rankings (national rank in scoring, passing, rushing, 3rd down) | `CFBD_API_KEY` |
| `episodes` | "On the Pod" links to the show's YouTube episodes, at the right timestamp | `YOUTUBE_API_KEY` |

### Get the keys

- **CFBD:** create an account at collegefootballdata.com and request a free API key. The free plan allows 1,000 calls a month, and the functions save their results so the site uses only a few hundred.
- **YouTube:** in Google Cloud, create a project, enable **YouTube Data API v3**, then **Credentials → Create credentials → API key**. Edit the key, and under **API restrictions** select only YouTube Data API v3. Leave **Application restrictions** set to *None*, because the key is used from Supabase's servers, not a website.

### Add the keys to Supabase

**Edge Functions → Secrets → Add new secret**, using these exact names:

- `CFBD_API_KEY`
- `YOUTUBE_API_KEY`

Keys live only here, never in the site files.

### Create each function

For each of the three:

1. **Edge Functions → Deploy a new function → Via Editor.**
2. Set the **function name** to exactly `series`, `teamstats` or `episodes`.
3. Replace everything in `index.ts` with the matching file from the [`supabase`](supabase) folder: `series-function.ts`, `teamstats-function.ts` or `episodes-function.ts`. The function needs only that one file.
4. In the function's settings, turn **Verify JWT** *off*. The site calls the functions with the publishable key, not a signed-in user.
5. **Deploy**, then use the **Test** tab:
   - `series`: `{ "team1": "LSU", "team2": "Auburn" }` should return a list of games.
   - `teamstats`: `{ "year": 2026 }` should return `ranks`.
   - `episodes`: `{ "channel": "UC…your channel ID…" }` should return `episodes`.

---

## 4. Make it yours (`config.js`)

Nearly everything specific to a show lives in **`config.js`**. Open it on GitHub, tap the pencil to edit, and change:

| Setting | What it is |
|---|---|
| `name` | The podcast's name, used in page titles. |
| `logo` | The logo file. Replace `logo.png` (and `favicon.ico`) with your own, keeping the names, or point this at a new file. |
| `headline` | The line under the logo on the main page. |
| `website`, `discord`, `contact` | Footer links and the "reach out to…" line. `contact` can include simple HTML. |
| `hosts` | The hosts' names, in display order. Their picks are saved under these exact names, so don't rename anyone mid-season. |
| `players` | What the show calls its listeners, singular and plural, e.g. `{ one: "Cousin", many: "Cousins" }`. |
| `hostPin` | The PIN hosts type on the host page. |
| `supabase` | The Project URL and publishable key from step 2. |
| `youtubeChannelId` | The show's YouTube channel ID (starts with `UC`), or `""` to turn off episode links. |
| `podEpisodes` | Words that mark a preview or picks episode in its YouTube title. A game's details link to episodes whose title names that week ("Week 8") and one of these words, and that have a chapter naming the game. |
| `analytics` | Your GoatCounter URL, or `""` to turn it off. |
| `bracketSeason`, `bracketFinalFour` | March Madness settings. See the comment in the file. |
| `colors` | Optional color overrides, e.g. `{ "--accent-gold": "#fa4616" }`. The names are at the top of `styles.css`. |

Text on the pages that shows the show's name or players' nickname is filled in from these settings when the page loads. In the HTML it looks like `data-site-text="{name} Pick'em Headquarters"`. The plain text between the tags is just what shows for a split second before that happens.

### A few things outside config.js

- **`admin.html`** has its own copy of the Supabase URL and key, plus its PIN, near the bottom (`SUPABASE_URL`, `SUPABASE_KEY`, `ADMIN_PIN`). Change all three.
- **`links.html`** is a simple links page with the show's own links typed in. Edit it or delete it.
- **YouTube chapters:** "On the Pod" links only work if the show's episode descriptions list chapters, one per line, like `6:30 – Mizzou at Ole Miss`.

---

## 5. Optional changes

### Fewer sections

The menu at the top of every page lists **NFL**, **SEC Football** and **SEC Hoops**. To offer only some of them, edit `SITE_SECTIONS` near the top of `common.js` and delete the lines for the sections you don't want:

```js
const SITE_SECTIONS = [
  { label: "NFL", href: "nflindex.html", match: p => /^nfl/i.test(p) },
  { label: "SEC Football", href: "index.html", main: true, match: p => !/^(nfl|hoops)/i.test(p) },
  { label: "SEC Hoops", href: "hoopsindex.html", match: p => /^hoops/i.test(p) }
];
```

With only one section left, the menu still shows as a single button. To remove it entirely, delete the `addSiteMenu` lines below the list. You can also delete the unused pages, such as `nflindex.html`, `nflmakepicks.html` and `nfl.js` for NFL, or `hoopsindex.html`, `hoopsmakepicks.html` and `hoops.js` for basketball (plus `hoopsMMBracket.html`, `hoopsMMPicks.html` and `hoopsMMBracket.js` if you don't want the March Madness bracket either).

### No host picks

If the show's hosts don't make picks, set `hosts: []` in `config.js`. The host columns and season cards disappear, and the main page shows only the listeners' consensus beside each game. Then:

- In `index.html`, delete the small **Hosts** label above the season cards (search for `Hosts`), and the third paragraph in the **Logic** box, the one about the card "next to" the last host.
- Delete `hostpicks.html`, since nothing links to it.

---

## 6. Each new season

| File | What to change |
|---|---|
| `sec.js` | The season year in the ESPN addresses (`2026`) and `TOTAL_WEEKS`. Also the `year: 2026` passed to `teamstats`. |
| `index.html` | The week options in the week dropdown (one `<option>` per week). |
| `nfl.js` | The season year and `TOTAL_WEEKS`. |
| `hoops.js` | `HOOPS_SEASON` (ESPN names a season by the year it ends, so 2026–27 is `2027`), `HOOPS_FIRST_MONDAY` and `TOTAL_WEEKS`. |
| `config.js` | `headline`, `hostPin` and the bracket settings. |

Last season's picks stay in the database. Clear the picks tables in Supabase (Table Editor) if you want a fresh start.

---

## A different conference

The football and basketball pages are built around the SEC: ESPN's SEC group numbers (`groups=8` for football in `sec.js`, `groups=23` for basketball in `hoops.js`), the list of SEC teams and their nicknames near the top of `sec.js`, and the 16 SEC team IDs in `hoops.js`. A show about another conference needs those swapped for its own conference's numbers, teams and IDs, and the "SEC" wording changed in the pages.

---

## Updating the site later

- **Upload files with GitHub's "Add file → Upload files"** or edit them in place. Pasting a whole long file into the editor from a phone can silently cut it off. Compare the line count after saving.
- **Upload `.js` and `.css` files first, then the `.html` files.** Uploading the pages first can briefly leave visitors with a new page and an old script.
- **Bump the version tags** when a shared file changes. The HTML pages load files like `sec.js?v=23`, and raising the number makes phones fetch the new copy instead of a saved one.
- Each upload triggers a short GitHub Pages rebuild. Uploading several files in a row can cancel the earlier builds, which shows as a red ✗ on those commits. That's harmless as long as the last one succeeds.

---

## Good to know

- **The PINs aren't real security.** They're checked in the visitor's browser, and anyone who reads the page's code can find them. They keep honest people out of the host and admin pages, nothing more. Don't reuse a PIN you use anywhere else.
- **The database rules are deliberately simple.** Anyone can read picks and submit one entry per name per week. Only host rows can be changed after submitting.
- **Free-tier limits:** Supabase allows 500,000 function calls a month, YouTube 10,000 units a day, and CFBD 1,000 calls a month. Normal use stays far below all three, because the functions save their results.
- **ESPN's feeds are public and unofficial.** They need no key and have no stated limits, but ESPN can change them without notice. If games suddenly stop showing, that's the first thing to check.
