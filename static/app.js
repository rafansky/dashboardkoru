const state = {
  dashboard: null,
  selectedCompetition: null,
  selectedLeader: "scorers",
  selectedRanking: "overall",
  notes: [],
  files: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const leaderLabels = {
  scorers: { label: "Goles", metric: "goles" },
  assists: { label: "Asistencias", metric: "asistencias" },
  ratings: { label: "Rating", metric: "rating" },
};

const rankingLabels = {
  overall: "General",
  goals: "Goles",
  assists: "Asist.",
  rating: "Rating",
};

document.addEventListener("DOMContentLoaded", () => {
  bindNavigation();
  bindForms();
  bindSessionControls();
  loadAll();
});

async function loadAll(force = false) {
  setLoading(true);
  try {
    const dashboardUrl = force ? "/api/dashboard?force=true" : "/api/dashboard";
    const [dashboard, notes, files] = await Promise.all([
      fetchJson(dashboardUrl),
      fetchJson("/api/notes"),
      fetchJson("/api/files"),
    ]);
    state.dashboard = dashboard;
    state.notes = notes;
    state.files = files;
    if (!state.selectedCompetition && dashboard.competitions?.length) {
      state.selectedCompetition = dashboard.competitions[0].key;
    }
    render();
    toast(force ? "Datos actualizados" : "Dashboard sincronizado");
  } catch (error) {
    console.error(error);
    if (error?.status === 401) {
      window.location.href = "/login";
      return;
    }
    toast("No se pudo cargar el dashboard");
  } finally {
    setLoading(false);
  }
}

function bindNavigation() {
  $$(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      $$(".nav-link").forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });
  $("#refresh-button").addEventListener("click", () => loadAll(true));
}

function bindSessionControls() {
  const logoutButton = $("#logout-button");
  if (!logoutButton) return;
  logoutButton.addEventListener("click", async () => {
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  });
}

function bindForms() {
  $("#note-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!String(form.get("body") || "").trim()) return toast("Escribe una nota");
    await fetch("/api/notes", { method: "POST", body: form });
    event.currentTarget.reset();
    event.currentTarget.elements.author.value = "KORU";
    state.notes = await fetchJson("/api/notes");
    renderNotes();
    toast("Nota añadida");
  });

  const fileInput = $("#upload-form input[type='file']");
  fileInput.addEventListener("change", () => {
    $("#file-label").textContent = fileInput.files?.[0]?.name || "Seleccionar archivo";
  });

  $("#upload-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!fileInput.files?.length) return toast("Selecciona un archivo");
    await fetch("/api/files", { method: "POST", body: form });
    event.currentTarget.reset();
    $("#file-label").textContent = "Seleccionar archivo";
    state.files = await fetchJson("/api/files");
    renderFiles();
    toast("Archivo subido");
  });
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`${response.status} ${url}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function render() {
  const data = state.dashboard;
  if (!data) return;

  renderBrand(data.team);
  renderSources(data.sources);
  renderSummary(data.summary);
  renderCompetitionTabs(data.competitions);
  renderCompetitionCards(data.competitions);
  renderSelectedCompetition();
  renderLeaders();
  renderRankings(data.analytics);
  renderNotes();
  renderFiles();

  $("#updated-at").textContent = `Actualizado ${formatDateTime(data.updatedAt)}`;
  refreshIcons();
}

function renderBrand(team) {
  const logo = team.logoUrl || "/assets/koru-mark.svg";
  $("#nav-logo").src = logo;
  $("#hero-logo").src = logo;
  $("#team-name").textContent = team.name || "KORU eClub";
  $("#hero-backdrop").style.setProperty(
    "--hero-image",
    "radial-gradient(circle at 20% 20%, rgba(249, 85, 22, 0.14), transparent 28%), linear-gradient(135deg, rgba(15, 17, 24, 0.96), rgba(8, 9, 13, 0.98))"
  );

  const socials = [
    ["x", "X", team.socials?.x, "twitter"],
    ["vpg", "VPG", team.socials?.vpg, "shield"],
    ["plg", "PLG", team.socials?.plg, "network"],
    ["youtube", "YouTube", valueToUrl(team.socials?.youtube, "https://www.youtube.com/"), "youtube"],
    ["instagram", "Instagram", valueToUrl(team.socials?.instagram, "https://www.instagram.com/"), "instagram"],
  ].filter((item) => item[2]);

  $("#social-links").innerHTML = socials
    .map(
      ([, label, url, icon]) => `
        <a href="${url}" target="_blank" rel="noreferrer">
          <i data-lucide="${icon}"></i>
          <span>${label}</span>
        </a>
      `
    )
    .join("");
}

function valueToUrl(value, base) {
  if (!value) return null;
  if (String(value).startsWith("http")) return value;
  return `${base}${String(value).replace("@", "")}`;
}

function renderSources(sources = []) {
  $("#source-stack").innerHTML = sources
    .map(
      (source) => `
        <a href="${source.url}" target="_blank" rel="noreferrer">
          <i data-lucide="external-link"></i>
          <span>${source.label}</span>
        </a>
      `
    )
    .join("");
}

function renderSummary(summary) {
  const items = [
    ["PJ", summary.played],
    ["Puntos", summary.points],
    ["Victorias", summary.wins],
    ["Goles", `${summary.goalsFor}:${summary.goalsAgainst}`],
    ["DG", signed(summary.goalDiff)],
    ["Win rate", `${summary.winRate}%`],
  ];
  $("#summary-metrics").innerHTML = items
    .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderCompetitionTabs(competitions) {
  $("#competition-tabs").innerHTML = competitions
    .map(
      (competition) => `
        <button type="button" class="${competition.key === state.selectedCompetition ? "active" : ""}" data-competition="${competition.key}">
          ${competition.platform}
        </button>
      `
    )
    .join("");

  $$("#competition-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCompetition = button.dataset.competition;
      renderCompetitionTabs(state.dashboard.competitions);
      renderCompetitionCards(state.dashboard.competitions);
      renderSelectedCompetition();
      refreshIcons();
    });
  });
}

function renderCompetitionCards(competitions) {
  $("#ligas").innerHTML = competitions
    .map((competition) => {
      const row = competition.koru;
      const form = competition.form?.length
        ? competition.form.map((result) => `<span class="form-dot result-${result}">${result}</span>`).join("")
        : `<span class="empty-inline">Sin forma</span>`;
      const selectedClass = competition.key === state.selectedCompetition ? "is-selected" : "";
      return `
        <article class="competition-card ${selectedClass}" style="--accent: ${competition.accent}">
          <header>
            <div>
              <span class="section-kicker">${competition.platform}</span>
              <h3>${competition.name}</h3>
            </div>
            <span class="badge">#${row?.rank || "-"}</span>
          </header>
          <div class="competition-row">
            <div class="mini-stat"><strong>${row?.points ?? "-"}</strong><span>Pts</span></div>
            <div class="mini-stat"><strong>${row?.played ?? "-"}</strong><span>PJ</span></div>
            <div class="mini-stat"><strong>${row ? `${row.goalsFor}:${row.goalsAgainst}` : "-"}</strong><span>Goles</span></div>
            <div class="mini-stat"><strong>${row ? signed(row.goalDiff) : "-"}</strong><span>DG</span></div>
          </div>
          <div class="form-dots">${form}</div>
        </article>
      `;
    })
    .join("");
}

function renderSelectedCompetition() {
  const competition = currentCompetition();
  if (!competition) return;
  $("#standings-title").textContent = competition.name;
  $("#competition-link").href = competition.url;
  renderStandings(competition);
  renderMatchLists(competition);
  renderNextMatch(state.dashboard.nextMatch);
}

function renderStandings(competition) {
  $("#standings-body").innerHTML = competition.standings
    .map(
      (row) => `
        <tr class="${row.isKoru ? "koru-row" : ""}">
          <td>${row.rank}</td>
          <td>
            <div class="team-cell">
              ${image(row.logoUrl, row.team)}
              <strong>${row.team || "-"}</strong>
            </div>
          </td>
          <td>${row.played}</td>
          <td>${row.wins}</td>
          <td>${row.draws}</td>
          <td>${row.losses}</td>
          <td>${signed(row.goalDiff)}</td>
          <td><strong>${row.points}</strong></td>
        </tr>
      `
    )
    .join("");
}

function renderNextMatch(match) {
  const target = $("#next-match");
  if (!match) {
    target.innerHTML = `<div class="empty-state">No hay partido programado.</div>`;
    return;
  }
  target.innerHTML = `
    <div class="match-spotlight">
      <div class="match-teams">
        <div class="match-team">
          ${image(match.homeLogoUrl, match.home, "match-logo")}
          <span>${match.home || "-"}</span>
        </div>
        <div class="versus">VS</div>
        <div class="match-team">
          ${image(match.awayLogoUrl, match.away, "match-logo")}
          <span>${match.away || "-"}</span>
        </div>
      </div>
      <div class="match-meta">
        <span>${match.platform} · J${match.matchDay || "-"}</span>
        <strong>${formatDateTime(match.datetime)}</strong>
      </div>
    </div>
  `;
}

function renderMatchLists(competition) {
  $("#upcoming-list").innerHTML = matchList(competition.upcoming, false);
  $("#recent-list").innerHTML = matchList(competition.recent, true);
}

function matchList(matches, completed) {
  if (!matches?.length) return `<div class="empty-state">Sin registros.</div>`;
  return matches
    .map((match) => {
      const score = completed
        ? `<span class="score">${match.scoreFor ?? "-"} - ${match.scoreAgainst ?? "-"}</span>`
        : `<span class="score">${formatTime(match.datetime)}</span>`;
      const result = completed && match.result ? `<span class="result-pill result-${match.result}">${match.result}</span>` : "";
      return `
        <a class="match-item" href="${match.url}" target="_blank" rel="noreferrer">
          ${image(match.opponentLogoUrl, match.opponent, "match-logo")}
          <div class="match-item-main">
            <strong>${match.isHome ? "vs" : "@"} ${match.opponent || "-"}</strong>
            <span>${match.platform} · J${match.matchDay || "-"} · ${formatDate(match.datetime)}</span>
          </div>
          <div>${score}${result}</div>
        </a>
      `;
    })
    .join("");
}

function renderLeaders() {
  $("#leader-tabs").innerHTML = Object.entries(leaderLabels)
    .map(
      ([key, item]) => `
        <button type="button" class="${state.selectedLeader === key ? "active" : ""}" data-leader="${key}">
          ${item.label}
        </button>
      `
    )
    .join("");

  $$("#leader-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedLeader = button.dataset.leader;
      renderLeaders();
      refreshIcons();
    });
  });

  const players = state.dashboard?.leaderboards?.[state.selectedLeader] || [];
  const metric = leaderLabels[state.selectedLeader].metric;
  $("#leaderboard-list").innerHTML = players.length
    ? players
        .map(
          (player) => `
            <article class="leader-item">
              <span class="leader-rank">${player.rank}</span>
              ${image(player.avatarUrl, player.username, "leader-avatar")}
              <div class="leader-name">
                <strong>${player.username}</strong>
                <span>${player.matchesPlayed} partidos · ${metric}</span>
              </div>
              <strong class="leader-value">${formatMetric(player.value)}</strong>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">Sin datos de jugadores.</div>`;
}

function renderRankings(analytics) {
  const summary = analytics?.summary || {};
  const streak = summary.currentStreak || { type: "-", count: 0 };
  const topPlayer = summary.topPlayer;

  const summaryItems = [
    ["ELO Club", summary.overallTeamElo || 0],
    ["Racha", streak.count ? `${streak.count}${streak.type}` : "-"],
    ["Pts ult.5", summary.last5Points || 0],
    ["Top jugador", topPlayer ? `${topPlayer.username} (${topPlayer.elo})` : "-"],
  ];

  $("#rankings-summary").innerHTML = summaryItems
    .map(
      ([label, value]) => `
      <article class="rank-card">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `
    )
    .join("");

  renderTrends(analytics?.trends || {});

  const teamElo = analytics?.teamElo || [];
  $("#team-elo-list").innerHTML = teamElo.length
    ? teamElo
        .map(
          (item) => `
          <article class="team-elo-item">
            <div>
              <strong>${item.platform}</strong>
              <span>${item.name}</span>
              ${sparkline(item.history)}
            </div>
            <div class="team-elo-meta">
              <small>#${item.rank}</small>
              <strong>${item.elo}</strong>
              ${deltaBadge(item.eloDelta)}
            </div>
          </article>
        `
        )
        .join("")
    : `<div class="empty-state">Sin datos ELO de equipo.</div>`;

  $("#ranking-tabs").innerHTML = Object.entries(rankingLabels)
    .map(
      ([key, label]) => `
        <button type="button" class="${state.selectedRanking === key ? "active" : ""}" data-ranking="${key}">
          ${label}
        </button>
      `
    )
    .join("");

  $$("#ranking-tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRanking = button.dataset.ranking;
      renderRankings(state.dashboard.analytics);
      refreshIcons();
    });
  });

  const playerElo = analytics?.playerRankings?.[state.selectedRanking] || analytics?.playerElo || [];
  $("#player-elo-list").innerHTML = playerElo.length
    ? playerElo
        .slice(0, 12)
        .map(
          (player, index) => `
          <article class="player-elo-item">
            <span class="leader-rank">${index + 1}</span>
            ${image(player.avatarUrl, player.username, "leader-avatar")}
            <div class="leader-name">
              <strong>${player.username}</strong>
              <span>${player.matchesPlayed} PJ · G ${player.goals} · A ${player.assists} · R ${formatMetric(player.rating)}</span>
              ${sparkline(player.history)}
            </div>
            <div class="elo-value">
              <strong class="leader-value">${player.elo}</strong>
              ${deltaBadge(player.eloDelta)}
            </div>
          </article>
        `
        )
        .join("")
    : `<div class="empty-state">Sin datos ELO de jugadores.</div>`;
}

function renderTrends(trends) {
  const bestRiser = trends.risers?.find((item) => Number(item.eloDelta || 0) > 0);
  const bestFaller = trends.fallers?.[0];
  const hotPlayer = trends.hotPlayer;
  const bestTeam = trends.bestTeam;

  const items = [
    ["Sube", bestRiser ? `${bestRiser.username} ${signed(bestRiser.eloDelta)}` : "Sin cambios"],
    ["Baja", bestFaller ? `${bestFaller.username} ${signed(bestFaller.eloDelta)}` : "Sin caidas"],
    ["Hot", hotPlayer ? `${hotPlayer.username} ${hotPlayer.elo}` : "-"],
    ["Liga fuerte", bestTeam ? `${bestTeam.platform} ${signed(bestTeam.eloDelta)}` : "-"],
  ];

  $("#trends-strip").innerHTML = items
    .map(
      ([label, value]) => `
      <article class="trend-chip">
        <span>${label}</span>
        <strong>${value}</strong>
      </article>
    `
    )
    .join("");
}

function renderNotes() {
  $("#notes-list").innerHTML = state.notes.length
    ? state.notes
        .map(
          (note) => `
            <article class="note-item">
              <p>${escapeHtml(note.body)}</p>
              <small>${escapeHtml(note.author)} · ${formatDateTime(note.created_at)}</small>
            </article>
          `
        )
        .join("")
    : `<div class="empty-state">Todavia no hay notas.</div>`;
}

function renderFiles() {
  $("#files-list").innerHTML = state.files.length
    ? state.files
        .map(
          (file) => `
            <a class="file-item" href="${file.url}" target="_blank" rel="noreferrer">
              <p>${escapeHtml(file.original_name)}</p>
              <small>${formatBytes(file.size)} · ${formatDateTime(file.created_at)}</small>
            </a>
          `
        )
        .join("")
    : `<div class="empty-state">Todavia no hay archivos.</div>`;
}

function currentCompetition() {
  return state.dashboard?.competitions?.find((item) => item.key === state.selectedCompetition);
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatMetric(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? number : number.toFixed(1);
}

function deltaBadge(value) {
  const delta = Number(value || 0);
  const className = delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : "delta-flat";
  const label = delta > 0 ? `+${delta}` : String(delta);
  return `<small class="delta-badge ${className}">${label}</small>`;
}

function sparkline(points = []) {
  if (!points.length) return `<div class="sparkline muted" aria-hidden="true"></div>`;
  const values = points.map((point) => Number(point.elo || 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  return `
    <div class="sparkline" aria-label="Evolucion ELO">
      ${values
        .map((value) => {
          const height = 4 + Math.round(((value - min) / range) * 14);
          return `<span style="height:${height}px"></span>`;
        })
        .join("")}
    </div>
  `;
}

function signed(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function image(src, alt, className = "") {
  if (!src) return `<span class="${className} placeholder-logo"></span>`;
  return `<img class="${className}" src="${src}" alt="${escapeHtml(alt || "")}" loading="lazy" />`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setLoading(isLoading) {
  document.body.classList.toggle("loading", isLoading);
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2400);
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}
