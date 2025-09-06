(function () {
  const ROOT = document.getElementById("matchesRoot");
  if (!ROOT) return;

  const LIST_LIVE = document.getElementById("listLive");
  const LIST_UP   = document.getElementById("listUpcoming");
  const LAST      = document.getElementById("lastUpdated");
  const REFRESH_SELECT = document.getElementById("refreshSelect");
  const TEAM_BADGE = document.getElementById("teamBadge");
  const UP_HOURS_SPAN = document.getElementById("upHoursSpan");

  // --- Config from HTML/data-attrs + URL params ---
  const API_DEFAULT = ROOT.dataset.api;
  const urlParams = new URLSearchParams(location.search);
  const API = urlParams.get("api") || API_DEFAULT;
  let refreshMs = Number(urlParams.get("refresh") || ROOT.dataset.refresh || 8000);
  const TEAM_PIN = (urlParams.get("team") || "").trim();
  const LIMIT_LIVE = Number(urlParams.get("limitLive") || 0);          // e.g., ?limitLive=6
  const LIMIT_UP   = Number(urlParams.get("limitUpcoming") || 0);      // e.g., ?limitUpcoming=10
  const UPCOMING_HOURS = Number(urlParams.get("hoursUpcoming") || 24); // e.g., ?hoursUpcoming=12

  if (UP_HOURS_SPAN) UP_HOURS_SPAN.textContent = String(UPCOMING_HOURS);

  // --- UI bindings ---
  if (REFRESH_SELECT) {
    REFRESH_SELECT.value = String(refreshMs);
    REFRESH_SELECT.addEventListener("change", () => {
      refreshMs = Number(REFRESH_SELECT.value);
      schedule();
    });
  }
  if (TEAM_PIN) {
    TEAM_BADGE.hidden = false;
    TEAM_BADGE.textContent = `Pinned: ${TEAM_PIN}`;
  }

  function setLastUpdated(note) {
    const noteStr = note ? ` (${note})` : "";
    LAST.textContent = "Last updated: " + new Date().toLocaleTimeString() + noteStr;
  }

  // --- Helpers: parse team & event objects + initials ---
  function teamFromPayload(m, idx) {
    const raw = idx === 1 ? (m.team1 || m.teams?.[0] || {}) : (m.team2 || m.teams?.[1] || {});
    if (typeof raw === "string") return { name: raw, logo: null };
    return {
      name: (raw?.name || "").toString(),
      logo: raw?.logo || raw?.image || raw?.logoUrl || raw?.logoURL || null
    };
  }
  function eventFromPayload(m) {
    const ev = m.event || {};
    if (typeof ev === "string") return { name: ev, logo: null };
    return {
      name: (ev?.name || "").toString(),
      logo: ev?.logo || ev?.image || ev?.logoUrl || ev?.logoURL || null
    };
  }
  function initials(name) {
    return (name || "")
      .split(/\s+/).filter(Boolean).map(s => s[0]).join("").slice(0,3).toUpperCase() || "?";
  }

  // --- Normalize incoming item to a consistent shape ---
  function normalizeMatch(m) {
    const t1 = teamFromPayload(m, 1);
    const t2 = teamFromPayload(m, 2);
    const ev = eventFromPayload(m);

    const status = (m.status || m.live || "").toString().toLowerCase();
    const isLive = (status === "live" || status === "running" || m.live === true);

    const score1 = (m.score1 ?? m.result?.[0] ?? m.liveResult?.team1 ?? "");
    const score2 = (m.score2 ?? m.result?.[1] ?? m.liveResult?.team2 ?? "");

    const time = m.time ? new Date(m.time) : null;

    return {
      id: m.id || m.matchId || `${t1.name}-vs-${t2.name}-${m.time || ""}`,
      eventName: ev.name,
      eventLogo: ev.logo,
      format: (m.format || "").toString(),
      map: (m.map || m.mapName || "").toString(),
      time,
      live: isLive,
      t1Name: t1.name, t2Name: t2.name,
      t1Logo: t1.logo, t2Logo: t2.logo,
      s1: (score1 !== undefined && score1 !== null) ? score1 : "",
      s2: (score2 !== undefined && score2 !== null) ? score2 : ""
    };
  }

  // --- Render a list (LIVE or UPCOMING) with event + team logos ---
  function renderList(container, matches, emptyText) {
    container.innerHTML = "";
    if (!matches.length) {
      container.innerHTML = `<div class="empty">${emptyText}</div>`;
      return;
    }

    const crestHTML = (logo, name) => {
      if (logo) return `<div class="crest"><img src="${logo}" alt="${name} logo" loading="lazy" /></div>`;
      return `<div class="crest"><span>${initials(name)}</span></div>`;
    };
    const eventCrestHTML = (logo, name) => {
      if (logo) return `<div class="event-crest"><img src="${logo}" alt="${name} logo" loading="lazy" /></div>`;
      return `<div class="event-crest"></div>`;
    };

    for (const m of matches) {
      const a = document.createElement("a");
      a.className = "card" + (m.live ? " live" : "");
      a.href = `https://www.hltv.org/matches/${encodeURIComponent(m.id || "")}`;
      a.target = "_blank";
      a.rel = "noopener";

      const left = document.createElement("div");
      const right = document.createElement("div");

      left.innerHTML = `
        <div class="row eventline">
          ${eventCrestHTML(m.eventLogo, m.eventName)}
          <div class="event-name">${m.eventName || "—"}</div>
          ${m.format ? `<span class="event-dot">•</span><div>${m.format}</div>` : ""}
        </div>

        <div class="row teams">
          <div class="teamline">
            ${crestHTML(m.t1Logo, m.t1Name)}
            <div class="team">${m.t1Name || "TBD"}</div>
          </div>
          <div class="score">${m.s1 !== "" ? m.s1 : ""}</div>
        </div>

        <div class="row teams">
          <div class="teamline">
            ${crestHTML(m.t2Logo, m.t2Name)}
            <div class="team">${m.t2Name || "TBD"}</div>
          </div>
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

  // --- Pinned-team orange outline ---
  function applyPinnedHighlight(container, pinLower) {
    if (!pinLower) return;
    const cards = container.querySelectorAll(".card");
    cards.forEach(card => {
      const names = Array.from(card.querySelectorAll(".team"))
        .map(n => n.textContent.toLowerCase())
        .join(" ");
      if (names.includes(pinLower)) card.classList.add("pinned");
    });
  }

  // --- Fetch + bucket into LIVE / UPCOMING ---
  async function load() {
    try {
      const res = await fetch(API, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const arr = Array.isArray(raw) ? raw : [];

      const all = arr.map(normalizeMatch);
      const now = Date.now();
      const upWindow = UPCOMING_HOURS * 60 * 60 * 1000;

      // LIVE
      let live = all.filter(x => x.live);

      // UPCOMING (within next N hours)
      let upcoming = all
        .filter(x => !x.live && x.time && (x.time.getTime() - now) > 0 && (x.time.getTime() - now) <= upWindow)
        .sort((a, b) => a.time - b.time);

      // Sort LIVE: pinned → event → time
      const pinLower = (TEAM_PIN || "").toLowerCase();
      function hasPin(m) {
        return pinLower && (
          m.t1Name.toLowerCase().includes(pinLower) ||
          m.t2Name.toLowerCase().includes(pinLower)
        );
      }
      live.sort((a, b) => {
        const ap = hasPin(a) ? 1 : 0, bp = hasPin(b) ? 1 : 0;
        if (ap !== bp) return bp - ap;
        const ae = (a.eventName || "").toLowerCase(), be = (b.eventName || "").toLowerCase();
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
      LIST_UP.innerHTML   = '<div class="empty">Couldn’t load matches right now.</div>';
    }
  }

  // --- Polling scheduler ---
  let timer = null;
  function schedule() {
    if (timer) clearInterval(timer);
    load();
    timer = setInterval(load, refreshMs);
  }

  schedule();
})();
