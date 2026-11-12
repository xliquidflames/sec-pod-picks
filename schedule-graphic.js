// The Team Schedule graphic from graphics.html (1920x1080), drawn on any
// canvas. Used by the Your Team box on the SEC football page.
// drawTeamScheduleGraphic(canvas, teamId, scheduleJson) -> true if drawn.
(() => {
    const SEASON = 2026;
    const TEAMS = [
      { id: 333, abbr: "ALA", name: "Alabama", color: "#9E1B32", alt: "#FFFFFF" },
      { id: 8, abbr: "ARK", name: "Arkansas", color: "#9D2235", alt: "#FFFFFF" },
      { id: 2, abbr: "AUB", name: "Auburn", color: "#0C2340", alt: "#E87722" },
      { id: 57, abbr: "FLA", name: "Florida", color: "#0021A5", alt: "#FA4616" },
      { id: 61, abbr: "UGA", name: "Georgia", color: "#BA0C2F", alt: "#000000" },
      { id: 96, abbr: "UK", name: "Kentucky", color: "#0033A0", alt: "#FFFFFF" },
      { id: 99, abbr: "LSU", name: "LSU", color: "#461D7C", alt: "#FDD023" },
      { id: 145, abbr: "MISS", name: "Ole Miss", color: "#13294B", alt: "#CE1126" },
      { id: 344, abbr: "MSST", name: "Mississippi State", color: "#660000", alt: "#FFFFFF" },
      { id: 142, abbr: "MIZ", name: "Missouri", color: "#000000", alt: "#F1B82D" },
      { id: 201, abbr: "OU", name: "Oklahoma", color: "#841617", alt: "#FDF9D8" },
      { id: 2579, abbr: "SC", name: "South Carolina", color: "#73000A", alt: "#000000" },
      { id: 2633, abbr: "TENN", name: "Tennessee", color: "#FF8200", alt: "#FFFFFF" },
      { id: 251, abbr: "TEX", name: "Texas", color: "#BF5700", alt: "#FFFFFF" },
      { id: 245, abbr: "TAMU", name: "Texas A&M", color: "#500000", alt: "#FFFFFF" },
      { id: 238, abbr: "VAN", name: "Vanderbilt", color: "#000000", alt: "#866D4B" }
    ];
    const SEC_IDS = new Set(TEAMS.map(t => String(t.id)));
    const teamById = id => TEAMS.find(t => String(t.id) === String(id));
    // A color that shows up on black: very dark main colors use the team's
    // second color (Auburn orange, Missouri gold), or a brighter shade of the
    // main one when the second color is white or black (A&M maroon).
    const luminance = hex => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
    // Scales a color up until it's bright enough to read on black.
    const brighten = hex => {
      const f = Math.min(3, 45 / Math.max(1, luminance(hex)));
      return "#" + [16, 8, 0].map(sh => Math.min(255, Math.round(((parseInt(hex.slice(1), 16) >> sh) & 255) * f)).toString(16).padStart(2, "0")).join("");
    };
    function brightColor(t) {
      if (!t) return "#9E1B32";
      if (luminance(t.color) >= 40) return t.color;
      const alt = luminance(t.alt);
      return alt >= 40 && alt <= 220 ? t.alt : brighten(t.color);
    }

    const W = 1920, H = 1080;
    const GOLD = "#D9A520", WIN = "#22C55E", LOSS = "#FF2D2D";

    const imageCache = {};
    function loadImage(src) {
      if (!src) return Promise.resolve(null);
      return (imageCache[src] ||= new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      }));
    }
    const logoUrl = team => (team && ((team.logos && team.logos[0] && team.logos[0].href) || team.logo)) ||
      (team && team.id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${team.id}.png` : "");

    let fontsReady = null;
    const loadFonts = () => (fontsReady ||= Promise.all(
      ["100px Anton", "100px 'Archivo Black'"].map(f => document.fonts.load(f).catch(() => null))));

    // ---- Drawing helpers ----
    function outlined(ctx, text, x, y, { font, fill, stroke = "#111", width = 8, align = "center", baseline = "alphabetic", maxWidth } = {}) {
      ctx.font = font;
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      ctx.lineJoin = "round";
      if (width > 0) {
        ctx.lineWidth = width;
        ctx.strokeStyle = stroke;
        ctx.strokeText(text, x, y, maxWidth);
      }
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y, maxWidth);
    }
    const plain = (ctx, text, x, y, opts) => outlined(ctx, text, x, y, { ...opts, width: 0 });

    function drawContained(ctx, img, x, y, size) {
      if (!img) return;
      const scale = Math.min(size / img.width, size / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
    }
    const isLight = hex => {
      const n = parseInt(hex.slice(1), 16);
      return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170;
    };
    function blank(ctx, color = "#000") {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
    }

    function scheduleData(team, data) {
      if (!data || !data.events) return null;
      let w = 0, l = 0, cw = 0, cl = 0;
      const games = data.events.map(ev => {
        const comp = (ev.competitions || [])[0] || {};
        const us = (comp.competitors || []).find(c => String(c.team && c.team.id) === String(team.id));
        const them = (comp.competitors || []).find(c => c !== us);
        if (!us || !them) return null;
        const done = !!(comp.status && comp.status.type && comp.status.type.completed);
        const score = c => parseInt((c.score && (c.score.displayValue ?? c.score.value)) ?? c.score, 10);
        const ours = score(us), theirs = score(them);
        const won = done && (us.winner === true || ours > theirs);
        const sec = SEC_IDS.has(String(them.team.id));
        if (done) { if (won) { w++; if (sec) cw++; } else { l++; if (sec) cl++; } }
        return {
          date: new Date(comp.date || ev.date),
          home: us.homeAway === "home" && !comp.neutralSite,
          logo: logoUrl(them.team), done, won,
          score: done ? `${Math.max(ours, theirs)}-${Math.min(ours, theirs)}` : ""
        };
      }).filter(Boolean).sort((a, b) => a.date - b.date);
      return { games, record: `${w}-${l}`, secRecord: `${cw}-${cl}` };
    }

    async function drawSchedule(ctx, team, data) {
      await loadFonts();
      const sched = scheduleData(team, data);
      blank(ctx);
      if (!sched) {
        plain(ctx, `Couldn't load ${team.name}'s schedule.`, W / 2, H / 2, { font: "60px 'Archivo Black'", fill: "#FFFFFF" });
        return;
      }
      const [teamLogo, podLogo, ...oppLogos] = await Promise.all([
        loadImage(`https://a.espncdn.com/i/teamlogos/ncaa/500/${team.id}.png`), loadImage("logo.png"), ...sched.games.map(g => loadImage(g.logo))
      ]);

      const left = 310;
      outlined(ctx, "RECORD", left, 180, { font: "108px 'Archivo Black'", fill: brightColor(team), stroke: "#FFFFFF", width: 7, maxWidth: 560 });
      outlined(ctx, sched.record, left, 560, { font: "340px Anton", fill: "#FFFFFF", stroke: "#8A8A8A", width: 10, maxWidth: 580 });
      outlined(ctx, "SEC", left, 720, { font: "120px 'Archivo Black'", fill: "#0B4EA2", stroke: "#F4C430", width: 7 });
      outlined(ctx, sched.secRecord, left, 1020, { font: "280px Anton", fill: "#FFFFFF", stroke: "#8A8A8A", width: 10, maxWidth: 560 });

      const px = 640, pw = W - px - 30;
      ctx.fillStyle = "#2B2B2E";
      ctx.fillRect(px, 0, pw, H);
      drawContained(ctx, teamLogo, px + 30, 20, 250);
      const year = String(sched.games[0] ? sched.games[0].date.getFullYear() : SEASON);
      outlined(ctx, year, px + 640, 160, { font: "170px 'Archivo Black'", fill: "#FFFFFF", stroke: "#000", width: 6 });
      outlined(ctx, "SCHEDULE", px + 640, 240, { font: "78px 'Archivo Black'", fill: "#FFFFFF", stroke: "#000", width: 5 });

      const ly = 268, sq = 42;
      ctx.lineWidth = 4; ctx.strokeStyle = GOLD;
      ctx.fillStyle = team.color; ctx.fillRect(px + 360, ly, sq, sq); ctx.strokeRect(px + 360, ly, sq, sq);
      outlined(ctx, "HOME", px + 415, ly + sq - 4, { font: "48px 'Archivo Black'", fill: "#FFFFFF", stroke: "#000", width: 4, align: "left" });
      ctx.fillStyle = "#FFFFFF"; ctx.fillRect(px + 620, ly, sq, sq); ctx.strokeRect(px + 620, ly, sq, sq);
      outlined(ctx, "AWAY", px + 675, ly + sq - 4, { font: "48px 'Archivo Black'", fill: "#FFFFFF", stroke: "#000", width: 4, align: "left" });
      drawContained(ctx, podLogo, px + pw - 150, 200, 120);

      const gx = px + 25, gy = 330, gw = pw - 50, gh = H - gy - 20, gap = 14, cols = 4;
      const rows = Math.max(1, Math.ceil(sched.games.length / cols));
      const tw = (gw - gap * (cols - 1)) / cols, th = (gh - gap * (rows - 1)) / rows;
      sched.games.forEach((g, i) => {
        const x = gx + (i % cols) * (tw + gap), y = gy + Math.floor(i / cols) * (th + gap);
        ctx.fillStyle = g.home ? team.color : "#FFFFFF";
        ctx.fillRect(x, y, tw, th);
        ctx.lineWidth = 5; ctx.strokeStyle = GOLD;
        ctx.strokeRect(x, y, tw, th);
        const logoSize = Math.min(tw, th) * 0.78;
        drawContained(ctx, oppLogos[i], x + (tw - logoSize) / 2, y + (th - logoSize) / 2, logoSize);
        if (g.done) {
          const color = g.won ? WIN : LOSS;
          outlined(ctx, g.won ? "WIN" : "LOSS", x + tw / 2, y + th * 0.36, { font: `${Math.round(th * 0.4)}px Anton`, fill: color, stroke: "#0B0B0B", width: 8, maxWidth: tw - 16 });
          outlined(ctx, g.score, x + tw / 2, y + th - 14, { font: `${Math.round(th * 0.3)}px Anton`, fill: color, stroke: "#0B0B0B", width: 7, maxWidth: tw - 16 });
        } else {
          const label = `${g.date.toLocaleDateString("en-US", { month: "short", timeZone: "America/New_York" }).toUpperCase()}. ${g.date.toLocaleDateString("en-US", { day: "numeric", timeZone: "America/New_York" })}`;
          const fill = g.home ? (isLight(team.color) ? "#111" : "#FFFFFF") : (team.color === "#000000" ? "#111" : team.color);
          outlined(ctx, label, x + tw / 2, y + th - 14, { font: `${Math.round(th * 0.17)}px 'Archivo Black'`, fill, stroke: g.home ? "#000" : "#FFFFFF", width: 5, maxWidth: tw - 16 });
        }
      });
    }

    window.drawTeamScheduleGraphic = async (canvas, teamId, data) => {
      const team = teamById(teamId);
      if (!team || !data || !data.events) return false;
      canvas.width = W; canvas.height = H;
      await drawSchedule(canvas.getContext("2d"), team, data);
      return true;
    };
})();
