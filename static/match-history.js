const $ = (selector) => document.querySelector(selector);
let dossiers = [];
let selectedId = "";
const planDrafts = new Map();

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
      <div class="detail-actions"><button class="compact-button" data-print-report type="button"><i data-lucide="printer"></i><span>Imprimir</span></button><label class="compact-button file-button"><i data-lucide="paperclip"></i><span>Adjuntar</span><input data-attachment-upload type="file" /></label><strong class="score">${score}</strong></div>
    </header>
    <div class="tag-row">${tags || `<span class="muted">Sin etiquetas</span>`}</div>
    <section class="detail-grid">
      <article class="detail-block"><div class="block-heading"><i data-lucide="file-text"></i><strong>Resumen</strong></div><p>${formatText(item.summary, "Sin resumen todavia.")}</p></article>
      <article class="detail-block"><div class="block-heading"><i data-lucide="list-checks"></i><strong>Conclusiones</strong></div><p>${formatText(item.takeaways, "Sin conclusiones todavia.")}</p></article>
      <article class="detail-block"><div class="block-heading"><i data-lucide="users"></i><strong>Convocatoria</strong></div><p>${(item.lineup || []).length ? item.lineup.map(escapeHtml).join(" · ") : "Sin convocatoria registrada."}</p></article>
      <article class="detail-block stats-block"><div><span>Pizarras</span><b>${item.boardCount}</b></div><div><span>Sesiones</span><b>${item.sessionCount}</b></div><div><span>Anotaciones</span><b>${item.entryCount}</b></div></article>
    </section>
    ${renderMatchPlan(item)}
    <section class="linked-section"><div class="section-heading"><div><span>Pizarras vinculadas</span><strong>${item.boardCount}</strong></div></div><div class="linked-list">${item.boards.length ? item.boards.map((board) => `<a class="linked-board" href="/tactics?board=${encodeURIComponent(board.id)}"><i data-lucide="clipboard-pen-line"></i><span><strong>${escapeHtml(board.name)}</strong><small>${escapeHtml(board.category)} · ${board.sceneCount} escenas</small></span><i data-lucide="arrow-up-right"></i></a>`).join("") : `<div class="empty-list">Aun no hay pizarras vinculadas.</div>`}</div></section>
    <section class="linked-section"><div class="section-heading"><div><span>Sesiones de analisis</span><strong>${item.sessionCount}</strong></div></div><div class="linked-list">${item.sessions.length ? item.sessions.map((session) => `<a class="linked-board" href="/tactics?board=${encodeURIComponent(session.boardId)}"><i data-lucide="notebook-pen"></i><span><strong>${escapeHtml(session.name)}</strong><small>${escapeHtml(session.boardName)} · ${statusLabel(session.type)} · ${session.entryCount} notas</small></span><i data-lucide="arrow-up-right"></i></a>`).join("") : `<div class="empty-list">Aun no hay sesiones vinculadas.</div>`}</div></section>
    <section class="linked-section attachments-section"><div class="section-heading"><div><span>Adjuntos</span><strong>${item.attachmentCount || 0}</strong></div></div><div class="attachment-list">${(item.attachments || []).length ? item.attachments.map((attachment) => renderAttachment(attachment)).join("") : `<div class="empty-list">Sin adjuntos. Sube capturas, clips o documentos del partido.</div>`}</div></section>`;
  $("[data-print-report]").addEventListener("click", printReport);
  $("[data-attachment-upload]").addEventListener("change", (event) => uploadAttachment(item.matchId, event.target.files?.[0]));
  target.querySelectorAll("[data-remove-attachment]").forEach((button) => button.addEventListener("click", () => removeAttachment(item.matchId, Number(button.dataset.removeAttachment))));
  target.querySelectorAll("[data-plan-field]").forEach((input) => input.addEventListener("input", () => updatePlanField(item.matchId, input.dataset.planField, input.value)));
  target.querySelectorAll("[data-plan-check]").forEach((input) => input.addEventListener("change", () => updatePlanCheck(item.matchId, input.dataset.planCheck, input.checked)));
  target.querySelectorAll("[data-remove-plan-item]").forEach((button) => button.addEventListener("click", () => removePlanItem(item.matchId, button.dataset.removePlanItem)));
  $("[data-add-plan-item]").addEventListener("click", () => addPlanItem(item.matchId));
  $("[data-template-plan]").addEventListener("click", () => applyPlanTemplate(item.matchId));
  $("[data-save-plan]").addEventListener("click", () => saveMatchPlan(item.matchId));
}

function emptyPlan(matchId) {
  return { matchId, opponentProfile: "", threats: "", setPieces: "", matchGoals: "", checklist: [] };
}

function planFor(item) {
  if (!planDrafts.has(item.matchId)) planDrafts.set(item.matchId, JSON.parse(JSON.stringify(item.matchPlan || emptyPlan(item.matchId))));
  return planDrafts.get(item.matchId);
}

function renderMatchPlan(item) {
  const plan = planFor(item);
  const rows = plan.checklist.map((check) => `<label class="plan-check"><input type="checkbox" data-plan-check="${escapeHtml(check.id)}" ${check.checked ? "checked" : ""} /><span>${escapeHtml(check.label)}</span><button type="button" data-remove-plan-item="${escapeHtml(check.id)}" title="Quitar punto" aria-label="Quitar ${escapeHtml(check.label)}"><i data-lucide="x"></i></button></label>`).join("");
  return `<section class="linked-section match-plan-section"><div class="section-heading"><div><span>Plan de partido</span><strong>${plan.checklist.filter((item) => item.checked).length}/${plan.checklist.length}</strong></div><div class="plan-actions"><button class="compact-button" type="button" data-template-plan><i data-lucide="list-plus"></i><span>Usar plantilla</span></button><button class="compact-button plan-save" type="button" data-save-plan><i data-lucide="save"></i><span>Guardar plan</span></button></div></div><div class="plan-grid"><label>Perfil del rival<textarea data-plan-field="opponentProfile" rows="3" maxlength="2000" placeholder="Estructura, ritmo, tendencias...">${escapeHtml(plan.opponentProfile)}</textarea></label><label>Amenazas<textarea data-plan-field="threats" rows="3" maxlength="2000" placeholder="Jugadores, movimientos o zonas a vigilar...">${escapeHtml(plan.threats)}</textarea></label><label>Balon parado<textarea data-plan-field="setPieces" rows="3" maxlength="2000" placeholder="Corners, faltas, saques...">${escapeHtml(plan.setPieces)}</textarea></label><label>Objetivos<textarea data-plan-field="matchGoals" rows="3" maxlength="2000" placeholder="Que queremos ejecutar hoy...">${escapeHtml(plan.matchGoals)}</textarea></label></div><div class="plan-checklist">${rows || `<div class="empty-list">Usa la plantilla o anade el primer punto del plan.</div>`}</div><div class="plan-add"><input data-plan-new-item maxlength="160" placeholder="Nuevo punto del checklist" /><button class="compact-button" type="button" data-add-plan-item aria-label="Anadir punto"><i data-lucide="plus"></i></button></div></section>`;
}

function updatePlanField(matchId, field, value) { planDrafts.get(matchId)[field] = value; }
function updatePlanCheck(matchId, id, checked) { const item = planDrafts.get(matchId).checklist.find((entry) => entry.id === id); if (item) item.checked = checked; }
function removePlanItem(matchId, id) { const plan = planDrafts.get(matchId); plan.checklist = plan.checklist.filter((item) => item.id !== id); render(); }
function addPlanItem(matchId) { const input = $("[data-plan-new-item]"); const label = input.value.trim(); if (!label) return input.focus(); planDrafts.get(matchId).checklist.push({ id: createId(), label, checked: false }); render(); }
function applyPlanTemplate(matchId) {
  const plan = planDrafts.get(matchId);
  plan.checklist = ["Confirmar once y roles", "Acordar gatillos de presion", "Defender balon parado", "Primera alternativa de ajuste", "Recordar objetivo de salida"].map((label) => ({ id: createId(), label, checked: false }));
  render();
}

async function saveMatchPlan(matchId) {
  try {
    const saved = await request(`/api/match-reports/${encodeURIComponent(matchId)}/plan`, jsonOptions("PUT", planDrafts.get(matchId)));
    planDrafts.set(matchId, saved);
    toast("Plan de partido guardado");
    await loadHistory();
  } catch (error) { toast(error.message || "No se pudo guardar el plan"); }
}

function renderAttachment(attachment) {
  const image = String(attachment.content_type || "").startsWith("image/");
  return `<article class="attachment-row">${image ? `<a class="attachment-preview" href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(attachment.url)}" alt="" /></a>` : `<a class="attachment-icon" href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer"><i data-lucide="file"></i></a>`}<a class="attachment-copy" href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(attachment.original_name)}</strong><small>${formatFileSize(attachment.size)} · ${formatDate(attachment.attached_at)}</small></a><button class="attachment-remove" data-remove-attachment="${attachment.id}" type="button" title="Quitar del expediente" aria-label="Quitar ${escapeHtml(attachment.original_name)}"><i data-lucide="x"></i></button></article>`;
}

async function uploadAttachment(matchId, file) {
  if (!file) return;
  try {
    const body = new FormData();
    body.append("file", file);
    const upload = await request("/api/files", { method: "POST", body });
    await request(`/api/match-reports/${encodeURIComponent(matchId)}/files`, jsonOptions("POST", { fileId: upload.id }));
    toast("Adjunto agregado al expediente");
    await loadHistory();
  } catch (error) {
    toast(error.message || "No se pudo subir el adjunto");
  }
}

async function removeAttachment(matchId, fileId) {
  try {
    await request(`/api/match-reports/${encodeURIComponent(matchId)}/files/${fileId}`, { method: "DELETE" });
    toast("Adjunto quitado del expediente");
    await loadHistory();
  } catch (error) {
    toast(error.message || "No se pudo quitar el adjunto");
  }
}

function printReport() {
  document.body.classList.add("printing-dossier");
  window.print();
  window.setTimeout(() => document.body.classList.remove("printing-dossier"), 500);
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Sesion caducada");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || "No se pudo completar la operacion");
  }
  return response.status === 204 ? null : response.json();
}

function jsonOptions(method, body) { return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }

function unique(items) { return [...new Set(items)]; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(new Date(value)) : "Sin fecha"; }
function formatDateTime(value) { return value ? new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Sin fecha"; }
function formatText(value, fallback) { return escapeHtml(value || fallback).replaceAll("\n", "<br>"); }
function formatFileSize(size) { return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`; }
function createId() { return globalThis.crypto?.randomUUID?.() || `plan-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function statusLabel(status) { return { "pre-match": "Prepartido", live: "En directo", "post-match": "Postpartido" }[status] || "Sesion"; }
function toast(message) { const element = $("#toast"); element.textContent = message; element.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove("show"), 2600); }
function refreshIcons() { if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } }); }
