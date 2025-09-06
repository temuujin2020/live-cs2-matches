(function () {
  const ROOT = document.getElementById("matchesRoot");
  if (!ROOT) return;

  const LIST_LIVE = document.getElementById("listLive");
  const LIST_UP   = document.getElementById("listUpcoming");
  const LAST      = document.getElementById("lastUpdated");
  const REFRESH_SELECT = document.getElementById("refreshSelect");
  const TEAM_BADGE = document.getElementById("teamBadge");
  const UP_HOURS_SPAN = document.getElementById("upHoursSpan");

  // Config from HTML/data-attrs + URL params
  const API_DEFAULT = ROOT.dataset.api;
  const urlParams = new URLSearchParams(location.search);
  const API = urlParams.get("api") || API_DEFAULT;
  let refreshMs = Number(urlParams.get("refresh") || ROOT.dataset.refresh || 8000);
  const TEAM_PIN = (urlParams.get("team") || "").trim();
  const LIMIT_LIVE = Number(urlParams.get("limitLive") || 0);         // e.g., ?limitLive=6
  const LIMIT_UP = Number(urlParams.get("limitUpcoming") || 0);       // e.g., ?limitUpcoming=10
  const UPCOMING_HOURS = Number(urlParams.get("hoursUpcoming") || 24);// e.g., ?hoursUpcoming=12

  UP_HOURS_SPAN.textContent = String(UPCOMING_HOURS);

  // UI bindings
  REFRESH_SELECT.value = String(refreshMs);
  REFRESH_SELECT.addEventListener("change", () => {
    refreshMs = Number(REFRESH_SELECT.value);
    schedule();
  });
  if (TEAM_PIN) {
    TEAM_BADGE.hidden = false;
    TEAM_BADGE.textContent = `Pinned: ${TEAM_PIN}`;
  }

  function setLastUpdated(note) {
    const noteStr = note ? ` (${note})` : "";
    LAST.textContent = "Last updated: " + new Date().toLocaleTimeString() + noteStr;
  }

  // Helpers to read team names from heterogeneous community payloads
  function teamNameOf(m, idx) {
    const t = idx === 1 ? (m.team1 || m.teams?.[0] || {}) : (m.team2 || m.teams?.[1] || {});
    return (t?.name || (typeof t === "string" ? t : "") || "").toString();
  }

  function normalizeMatch(m) {
    const t1 = teamNameOf(m, 1);
    const t2 = teamNameOf(m, 2);

    // status/live flags
    const status = (m.status || m.live || "").toString().toLowerCase();
    const isLive = (status === "live" || status === "running" || m.live === true);

    // scores (best-effort)
    const score1 = (m.score1 ?? m.result?.[0] ?? m.liveResult?.team1 ?? "");
    const score2 = (m.score2 ?? m.result?.[1] ?? m.liveResult?.team2 ?? "");

    // time
    const time = m.time ? new Date(m.time) : null;

    return {
      id: m.id || m.matchId || `${t1}-vs-${t2}-${m.time || ""}`,
      event: (m.event?.name || m.event || "").toString(),
      format: (m.format || "").toString(),
      map: (m.map || m.mapName || "").toString(),
      time,
      live: isLive,
      t1, t2,
      s1: (score1 !== undefined && score1 !== null) ? score1 : "",
      s2: (score2 !== undefined && score2 !== null) ? score2 : ""
    };
  }

  function renderList(container, matches, badgeTextWhenEmpty) {
    container.innerHTML = "";
    if (!matches.length) {
      container.innerHTML = `<div class="empty">${badgeTextWhenEmpty}</div>`;
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

      const rightLabel = m.live
        ? "LIVE"
        : (m.time ? m.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
      right.innerHTML = `<div class="status">${rightLabel}</div>`;

      a.appendChild(left);
      a.appendChild(right);
      container.appendChild(a);
    }
  }

  function applyPinnedHighlight(container, pinLower) {
    if (!pinLower) return;
    const cards = container.querySelectorAll(".card");
    cards.forEach(card => {
      const names = Array.from(card.querySelectorAll(".team")).map(n => n.textContent.toLowerCase()).join(" ");
      if (names.includes(pinLower)) card.classList.add("pinned");
    });
  }

  async function load() {
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const arr = Array.isArray(raw) ? raw : [];

      const all = arr.map(normalizeMatch);
      const now = Date.now();
      const upWindow = UPCOMING_HOURS * 60 * 60 * 1000;

      // LIVE bucket
      let live = all.filter(x => x.live);

      // UPCOMING bucket (within next UPCOMING_HOURS)
      let upcoming = all
        .filter(x => !x.live && x.time && (x.time.getTime() - now) > 0 && (x.time.getTime() - now) <= upWindow)
        .sort((a, b) => a.time - b.time);

      // Sorting for LIVE:
      const pinLower = (TEAM_PIN || "").toLowerCase();
      function hasPin(m) {
        return pinLower && (m.t1.toLowerCase().includes(pinLower) || m.t2.toLowerCase().includes(pinLower));
      }
      live.sort((a, b) => {
        const ap = hasPin(a) ? 1 : 0, bp = hasPin(b) ? 1 : 0;
        if (ap !== bp) return bp - ap; // pinned first
        const ae = (a.event || "").toLowerCase(), be = (b.event || "").toLowerCase();
        if (ae !== be) return ae < be ? -1 : 1;
        const at = a.time ? a.time.getTime() : 0, bt = b.time ? b.time.getTime() : 0;
        return at - bt;
      });

      // Optional limits
      if (LIMIT_LIVE > 0) live = live.slice(0, LIMIT_LIVE);
      if (LIMIT_UP > 0) upcoming = upcoming.slice(0, LIMIT_UP);

      // Render
      renderList(LIST_LIVE, live, "No live matches right now.");
      renderList(LIST_UP, upcoming, "No upcoming matches in the selected window.");

      // Pin highlight
      applyPinnedHighlight(LIST_LIVE, pinLower);
      applyPinnedHighlight(LIST_UP, pinLower);

      setLastUpdated();
    } catch (e) {
      console.error(e);
      LIST_LIVE.innerHTML = '<div class="empty">Couldn’t load matches right now.</div>';
      LIST_UP.innerHTML = '<div class="empty">Couldn’t load matches right now.</div>';
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
