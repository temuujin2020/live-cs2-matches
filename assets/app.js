(function () {
  const ROOT = document.getElementById("matchesRoot");
  if (!ROOT) return;

  const LIST = document.getElementById("list");
  const LAST = document.getElementById("lastUpdated");
  const REFRESH_SELECT = document.getElementById("refreshSelect");
  const TEAM_BADGE = document.getElementById("teamBadge");

  // Read config
  const API_DEFAULT = ROOT.dataset.api; // community JSON endpoint
  const urlParams = new URLSearchParams(location.search);
  const API = urlParams.get("api") || API_DEFAULT;          // override: ?api=...
  const TEAM_PIN = (urlParams.get("team") || "").trim();    // optional: ?team=TheMongolZ
  let refreshMs = Number(urlParams.get("refresh") || ROOT.dataset.refresh || 8000);

  // UI state bindings
  REFRESH_SELECT.value = String(refreshMs);
  REFRESH_SELECT.addEventListener("change", () => {
    refreshMs = Number(REFRESH_SELECT.value);
    schedule();
  });

  if (TEAM_PIN) {
    TEAM_BADGE.hidden = false;
    TEAM_BADGE.textContent = `Pinned: ${TEAM_PIN}`;
  }

  function setLastUpdated() {
    LAST.textContent = "Last updated: " + new Date().toLocaleTimeString();
  }

  function teamNameOf(m, idx) {
    // different community payloads use slightly different shapes
    const t = idx === 1 ? (m.team1 || m.teams?.[0] || {}) : (m.team2 || m.teams?.[1] || {});
    return (t?.name || (typeof t === "string" ? t : "") || "").toString();
  }

  function normalizeMatch(m) {
    const t1 = teamNameOf(m, 1);
    const t2 = teamNameOf(m, 2);

    const status = (m.status || m.live || "").toString().toLowerCase();
    const isLive = (status === "live" || status === "running" || m.live === true);

    const score1 = (m.score1 ?? m.result?.[0] ?? m.liveResult?.team1 ?? "");
    const score2 = (m.score2 ?? m.result?.[1] ?? m.liveResult?.team2 ?? "");

    return {
      id: m.id || m.matchId || `${t1}-vs-${t2}-${m.time || ""}`,
      event: (m.event?.name || m.event || "").toString(),
      format: (m.format || "").toString(),
      map: (m.map || m.mapName || "").toString(),
      time: m.time ? new Date(m.time) : null,
      live: isLive,
      t1, t2,
      s1: (score1 !== undefined && score1 !== null) ? score1 : "",
      s2: (score2 !== undefined && score2 !== null) ? score2 : ""
    };
  }

  function render(matches) {
    LIST.innerHTML = "";
    if (!matches.length) {
      LIST.innerHTML = '<div class="empty">No live matches right now.</div>';
      return;
    }
    for (const m of matches) {
      const a = document.createElement("a");
      a.className = "card" + (m.live ? " live" : "");
      a.href = `https://www.hltv.org/matches/${encodeURIComponent(m.id || "")}`;
      a.target = "_blank";
      a.rel = "noopener";

      const left = document.createElement("div");
      const right = document.createElement("div");

      left.innerHTML = `
        <div class="row event">${m.event || "—"} ${m.format ? "• " + m.format : ""}</div>
        <div class="row">
          <div class="team">${m.t1 || "TBD"}</div>
          <div class="score">${m.s1 !== "" ? m.s1 : ""}</div>
        </div>
        <div class="row">
          <div class="team">${m.t2 || "TBD"}</div>
          <div class="score">${m.s2 !== "" ? m.s2 : ""}</div>
        </div>
        <div class="row map">${m.map ? ("Map: " + m.map) : ""}</div>
      `;

      right.innerHTML = `<div class="status">${m.live ? "LIVE" : (m.time ? new Date(m.time).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "")}</div>`;

      a.appendChild(left);
      a.appendChild(right);
      LIST.appendChild(a);
    }
  }

async function load() {
  try {
    const res = await fetch(API, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const arr = Array.isArray(raw) ? raw : [];
    const now = Date.now();

    // Normalize everything
    const norm = arr.map(normalizeMatch);

    // Buckets
    const live = norm.filter(x => x.live);

    // “Upcoming” within 24h (some feeds provide time as ms/ISO; our normalize sets Date or null)
    const upcoming = norm
      .filter(x => !x.live && x.time && (x.time.getTime() - now) > 0 && (x.time.getTime() - now) <= 24*60*60*1000)
    // sort soonest first
      .sort((a,b) => a.time - b.time);

    // “Finished” within last 6h (best-effort: items without live flag and with past time)
    const recent = norm
      .filter(x => !x.live && x.time && (now - x.time.getTime()) > 0 && (now - x.time.getTime()) <= 6*60*60*1000)
      .sort((a,b) => b.time - a.time);

    let toShow = live;
    let headerNote = "LIVE";
    if (toShow.length === 0 && upcoming.length) {
      toShow = upcoming;
      headerNote = "UPCOMING (next 24h)";
    } else if (toShow.length === 0 && recent.length) {
      toShow = recent;
      headerNote = "RECENT (last 6h)";
    }

    render(toShow);
    // Optional: display which bucket is showing (quick badge)
    const last = document.getElementById("lastUpdated");
    if (last) last.textContent = `Showing: ${headerNote} • Last updated: ` + new Date().toLocaleTimeString();
  } catch (e) {
    console.error(e);
    LIST.innerHTML = '<div class="empty">Couldn’t load matches right now.</div>';
  }
}

  let timer = null;
  function schedule() {
    if (timer) clearInterval(timer);
    load();
    timer = setInterval(load, refreshMs);
  }

  schedule();
})();
