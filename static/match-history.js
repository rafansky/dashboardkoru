const $ = (selector) => document.querySelector(selector);
let dossiers = [];
let selectedId = "";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  ["#history-search", "#competition-filter", "#status-filter", "#tag-filter"].forEach((selector) => $(selector).addEventListener("input", render));
  $("#refresh-history").addEventListener("click", () => loadHistory().catch((error) => toast(error.message || "No se pudo actualizar")));
  await loadHistory();
}

async function loadHistory() {
  $("#refresh-history").disabled = true;
  try {
    const response = await fetch("/api/match-history");
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!response.ok) throw new Error("No se pudo cargar el historial");
    dossiers = await response.json();
    populateFilters();
    if (!dossiers.some((item) => item.matchId === selectedId)) selectedId = dossiers[0]?.matchId || "";
    render();
  } finally {
    $("#refresh-history").disabled = false;
  }
}

function populateFilters() {
  populateSelect("#competition-filter", unique(dossiers.map((item) => item.competition).filter(Boolean)), "Todas");
  populateSelect("#tag-filter", unique(dossiers.flatMap((item) => item.tags || []).filter(Boolean)), "Todas");
}

function populateSelect(selector, values, allLabel) {
  const select = $(selector);
  const current = select.value;
  select.innerHTML = `<option value="">${allLabel}</option>${values.sort((a, b) => a.localeCompare(b, "es")).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
  select.value = values.includes(current) ? current : "";
}

function filteredDossiers() {
  const term = $("#history-search").value.trim().toLocaleLowerCase("es");
  const competition = $("#competition-filter").value;
  const status = $("#status-filter").value;
  const tag = $("#tag-filter").value;
  return dossiers.filter((item) => {
    const searchable = [item.opponent, item.competition, item.summary, item.takeaways, ...(item.tags || []), ...(item.boards || []).map((board) => board.name)].join(" ").toLocaleLowerCase("es");
    return (!term || searchable.includes(term))
      && (!competition || item.competition === competition)
      && (!status || item.status === status)
      && (!tag || (item.tags || []).includes(tag));
  });
}

function render() {
  const filtered = filteredDossiers();
  if (!filtered.some((item) => item.matchId === selectedId)) selectedId = filtered[0]?.matchId || "";
  $("#history-count").textContent = `${dossiers.length} ${dossiers.length === 1 ? "expediente" : "expedientes"}`;
  $("#filtered-count").textContent = String(filtered.length);
  $("#dossier-list").innerHTML = filtered.length ? filtered.map(renderDossierRow).join("") : `<div class="empty-list">No hay expedientes con estos filtros.</div>`;
  document.querySelectorAll("[data-match-id]").forEach((button) => button.addEventListener("click", () => { selectedId = button.dataset.matchId; render(); }));
  renderDetail(filtered.find((item) => item.matchId === selectedId));
  refreshIcons();
}

function renderDossierRow(item) {
  const score = item.scoreFor === null || item.scoreAgainst === null ? "-" : `${item.scoreFor} - ${item.scoreAgainst}`;
  return `<button class="dossier-row${item.matchId === selectedId ? " active" : ""}" data-match-id="${escapeHtml(item.matchId)}" type="button">
    <span class="dossier-date">${formatDate(item.matchDate || item.lastActivity)}</span>
    <span class="status-dot ${escapeHtml(item.status)}"></span>
    <span class="dossier-row-copy"><strong>${escapeHtml(item.opponent || "Partido sin rival")}</strong><small>${escapeHtml(item.competition || "Sin competicion")} · ${item.boardCount} pizarras · ${item.entryCount} notas</small></span>
    <b>${score}</b>
  </button>`;
}

function renderDetail(item) {
  const target = $("#dossier-detail");
  if (!item) {
    target.innerHTML = `<div class="detail-empty"><i data-lucide="notebook-tabs"></i><strong>Selecciona un expediente</strong></div>`;
    return;
  }
  const score = item.scoreFor === null || item.scoreAgainst === null ? "Sin marcador" : `${item.scoreFor} - ${item.scoreAgainst}`;
  const tags = (item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  target.innerHTML = `<header class="detail-header">
      <div><span>${escapeHtml(item.competition || "Partido")}</span><h1>${escapeHtml(item.opponent || "Rival pendiente")}</h1><small>${formatDateTime(item.matchDate || item.lastActivity)} · ${statusLabel(item.status)}</small></div>
      <strong class="score">${score}</strong>
    </header>
    <div class="tag-row">${tags || `<span class="muted">Sin etiquetas</span>`}</div>
    <section class="detail-grid">
      <article class="detail-block"><div class="block-heading"><i data-lucide="file-text"></i><strong>Resumen</strong></div><p>${formatText(item.summary, "Sin resumen todavia.")}</p></article>
      <article class="detail-block"><div class="block-heading"><i data-lucide="list-checks"></i><strong>Conclusiones</strong></div><p>${formatText(item.takeaways, "Sin conclusiones todavia.")}</p></article>
      <article class="detail-block"><div class="block-heading"><i data-lucide="users"></i><strong>Convocatoria</strong></div><p>${(item.lineup || []).length ? item.lineup.map(escapeHtml).join(" · ") : "Sin convocatoria registrada."}</p></article>
      <article class="detail-block stats-block"><div><span>Pizarras</span><b>${item.boardCount}</b></div><div><span>Sesiones</span><b>${item.sessionCount}</b></div><div><span>Anotaciones</span><b>${item.entryCount}</b></div></article>
    </section>
    <section class="linked-section"><div class="section-heading"><div><span>Pizarras vinculadas</span><strong>${item.boardCount}</strong></div></div><div class="linked-list">${item.boards.length ? item.boards.map((board) => `<a class="linked-board" href="/tactics?board=${encodeURIComponent(board.id)}"><i data-lucide="clipboard-pen-line"></i><span><strong>${escapeHtml(board.name)}</strong><small>${escapeHtml(board.category)} · ${board.sceneCount} escenas</small></span><i data-lucide="arrow-up-right"></i></a>`).join("") : `<div class="empty-list">Aun no hay pizarras vinculadas.</div>`}</div></section>
    <section class="linked-section"><div class="section-heading"><div><span>Sesiones de analisis</span><strong>${item.sessionCount}</strong></div></div><div class="linked-list">${item.sessions.length ? item.sessions.map((session) => `<a class="linked-board" href="/tactics?board=${encodeURIComponent(session.boardId)}"><i data-lucide="notebook-pen"></i><span><strong>${escapeHtml(session.name)}</strong><small>${escapeHtml(session.boardName)} · ${statusLabel(session.type)} · ${session.entryCount} notas</small></span><i data-lucide="arrow-up-right"></i></a>`).join("") : `<div class="empty-list">Aun no hay sesiones vinculadas.</div>`}</div></section>`;
}

function unique(items) { return [...new Set(items)]; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(new Date(value)) : "Sin fecha"; }
function formatDateTime(value) { return value ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Sin fecha"; }
function formatText(value, fallback) { return escapeHtml(value || fallback).replaceAll("\n", "<br>"); }
function statusLabel(status) { return { "pre-match": "Prepartido", live: "En directo", "post-match": "Postpartido" }[status] || "Sesion"; }
function toast(message) { const element = $("#toast"); element.textContent = message; element.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove("show"), 2600); }
function refreshIcons() { if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } }); }
