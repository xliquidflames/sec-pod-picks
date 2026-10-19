// Everything that makes this site belong to one podcast. To set it up for
// another show, change the values below and replace logo.png. Nothing else
// in the code needs editing.

const SITE = {
  // The podcast's name, shown in page titles and the logo's alt text.
  name: "That SEC Podcast",

  // Logo image (also the browser tab icon) and the line under it.
  logo: "logo.png",
  headline: "2026 Pick'em Headquarters",

  // Footer links and contact line. contact can include simple HTML.
  website: { url: "https://www.thatsecpodcast.com", label: "thatsecpodcast.com" },
  discord: "https://discord.gg/XsPnGkxFSM",
  contact: "Issues, comments, or suggestions? Reach out to <strong>Liquid</strong> on Discord.",

  // The hosts, in the order they appear. Each host's picks are saved
  // under this exact name, so don't rename a host mid-season.
  hosts: ["Mike", "Shane", "Steven"],

  // What the show calls its listeners who play.
  players: { one: "Cousin", many: "Cousins" },

  // PIN the hosts type on the host page to save their picks.
  hostPin: "SEC2026",

  // The show's Supabase project (Project Settings > API).
  supabase: {
    url: "https://kxkctllysuxertyjjppd.supabase.co",
    key: "sb_publishable_DW2n3YQdAW6jEYNTP-Jm4Q_ejgFJ7nd"
  },

  // The show's YouTube channel ID (starts with "UC"). Game details link to
  // the episode chapter where the hosts discuss that game. "" turns it off.
  youtubeChannelId: "UC8aQL-yFS2ZoSkUBeMfYesA",

  // What each episode's link says, by a word in its YouTube title.
  podEpisodes: [
    { titleHas: "Preview", label: "Steven Lassan's Take & Pick" },
    { titleHas: "Prediction", label: "SEC Mike and Cousin Shane's Takes & Picks" }
  ],

  // GoatCounter visitor stats. Set to "" to turn off.
  analytics: "https://liquidflames.goatcounter.com/count",

  // March Madness bracket. On Selection Sunday, set bracketSeason to the new
  // year and bracketFinalFour to which regions meet in each semifinal, as
  // shown on the official bracket, e.g. [["East", "South"], ["West", "Midwest"]].
  // The bracket page won't open for picks until the semifinal pairs are set.
  bracketSeason: 2026,
  bracketFinalFour: null,

  // Optional color overrides, using the names at the top of styles.css.
  // Example: { "--accent-gold": "#fa4616", "--bg-main": "#0021a5" }
  colors: {}
};
