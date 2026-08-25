import { tacticsApi } from "./api.js";
import { boardPayload, createNewBoard, normalizeBoard } from "./model.js";
import { Pitch2DRenderer } from "./pitch2d.js";
import { createEditorStore } from "./store.js";

const DRAFT_KEY = "koru:tactics:recovery-draft:v1";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const recoveryDraft = loadRecoveryDraft();
const store = createEditorStore(recoveryDraft || createNewBoard(), Boolean(recoveryDraft));
const renderer = new Pitch2DRenderer($("#pitch-shell"));
let boards = [];
let roster = [];
let saveTimer = null;
let savePromise = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindControls();
  if (window.matchMedia("(max-width: 760px)").matches) {
    store.setUI({ leftCollapsed: true, rightCollapsed: true });
  }
  store.subscribe(render);
  render(store.getState());
  refreshIcons();

  try {
    const [boardList, dashboard] = await Promise.all([tacticsApi.listBoards(), tacticsApi.getDashboard()]);
    boards = boardList;
    roster = dashboard.analytics?.playerElo || dashboard.leaderboards?.scorers || [];
    renderLibrary();
    renderRoster();

    const requestedId = new URLSearchParams(window.location.search).get("board");
    if (requestedId) await openBoard(requestedId);
  } catch (error) {
    toast(error.message || "No se pudo cargar la pizarra");
  }
}

function bindControls() {
  $("#board-name").addEventListener("input", (event) => change(["board", "name"], event.target.value, "Renombrar pizarra"));
  $("#board-description").addEventListener("input", (event) => change(["board", "description"], event.target.value, "Editar descripcion"));
  $("#board-category").addEventListener("change", (event) => change(["board", "category"], event.target.value, "Cambiar categoria"));
  $("#pitch-view").addEventListener("change", (event) => change(["board", "document", "pitch", "view"], event.target.value, "Cambiar vista"));
  $("#pitch-orientation").addEventListener("change", (event) => change(["board", "document", "pitch", "orientation"], event.target.value, "Cambiar orientacion"));
  $("#pitch-surface").addEventListener("change", (event) => change(["board", "document", "pitch", "surface"], event.target.value, "Cambiar cesped"));

  $$('[data-overlay]').forEach((input) => {
    input.addEventListener("change", () => {
      const overlays = $$('[data-overlay]:checked').map((item) => item.value);
      change(["board", "document", "pitch", "overlays"], overlays, "Cambiar overlays");
    });
  });

  $("#save-button").addEventListener("click", () => saveBoard(true).catch(() => null));
  $("#undo-button").addEventListener("click", () => store.undo());
  $("#redo-button").addEventListener("click", () => store.redo());
  $("#new-board-button").addEventListener("click", createBoard);
  $("#roster-search").addEventListener("input", renderRoster);
  $("#team-switch").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-team]");
    if (!button) return;
    store.setUI({ activeTeam: button.dataset.team });
    renderRoster();
  });

  $$('[data-collapse]').forEach((button) => {
    button.addEventListener("click", () => {
      const side = button.dataset.collapse;
      const state = store.getState();
      store.setUI({ [`${side}Collapsed`]: !state.ui[`${side}Collapsed`] });
    });
  });
  $$('[data-toggle-panel]').forEach((button) => {
    button.addEventListener("click", () => {
      const side = button.dataset.togglePanel;
      const state = store.getState();
      const patch = { [`${side}Collapsed`]: !state.ui[`${side}Collapsed`] };
      if (window.matchMedia("(max-width: 760px)").matches) {
        patch[`${side === "left" ? "right" : "left"}Collapsed`] = true;
      }
      store.setUI(patch);
    });
  });

  $("#fit-pitch").addEventListener("click", () => {
    $("#pitch-shell").animate([{ transform: "scale(.985)" }, { transform: "scale(1)" }], { duration: 180 });
  });
  $("#fullscreen-button").addEventListener("click", toggleFullscreen);

  document.addEventListener("keydown", handleShortcut);
  window.addEventListener("beforeunload", persistRecoveryDraft);
}

function change(path, value, label) {
  store.update(path, value, label);
  persistRecoveryDraft();
  scheduleAutosave();
}

function render(state) {
  const { board, ui } = state;
  renderer.render(board.document);
  document.body.classList.toggle("left-collapsed", ui.leftCollapsed);
  document.body.classList.toggle("right-collapsed", ui.rightCollapsed);

  syncValue("#board-name", board.name);
  syncValue("#board-description", board.description);
  syncValue("#board-category", board.category);
  syncValue("#pitch-view", board.document.pitch.view);
  syncValue("#pitch-orientation", board.document.pitch.orientation);
  syncValue("#pitch-surface", board.document.pitch.surface);
  $$('[data-overlay]').forEach((input) => { input.checked = board.document.pitch.overlays.includes(input.value); });

  $("#undo-button").disabled = !store.canUndo();
  $("#redo-button").disabled = !store.canRedo();
  $("#save-state").textContent = state.saving ? "Guardando..." : state.error ? "Error al guardar" : state.dirty ? "Cambios pendientes" : board.id ? "Guardado" : "Sin guardar";
  $("#save-state").className = `save-state${state.error ? " error" : state.saving ? " saving" : ""}`;
  $("#pitch-readout").textContent = `${board.document.pitch.width} × ${board.document.pitch.height} m`;
  persistRecoveryDraft();
}

function syncValue(selector, value) {
  const element = $(selector);
  if (document.activeElement !== element && element.value !== String(value ?? "")) element.value = value ?? "";
}

function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveBoard(false).catch(() => null), 1400);
}

async function saveBoard(showFeedback = false) {
  clearTimeout(saveTimer);
  if (savePromise) return savePromise;
  const state = store.getState();
  if (!state.dirty && state.board.id) {
    if (showFeedback) toast("La pizarra ya esta guardada");
    return state.board;
  }

  const payload = boardPayload(state.board);
  const sentSignature = JSON.stringify(payload);
  store.setSaving(true);
  savePromise = (state.board.id
    ? tacticsApi.updateBoard(state.board.id, payload)
    : tacticsApi.createBoard(payload))
    .then(async (saved) => {
      const currentSignature = JSON.stringify(boardPayload(store.getState().board));
      store.applySaveResult(normalizeBoard(saved), currentSignature === sentSignature);
      if (currentSignature === sentSignature) localStorage.removeItem(DRAFT_KEY);
      else persistRecoveryDraft();
      await refreshLibrary();
      history.replaceState(null, "", `/tactics?board=${encodeURIComponent(saved.id)}`);
      if (showFeedback) toast("Pizarra guardada");
      if (currentSignature !== sentSignature) scheduleAutosave();
      return saved;
    })
    .catch((error) => {
      store.setSaving(false, error.message);
      persistRecoveryDraft();
      toast(error.message || "No se pudo guardar");
      throw error;
    })
    .finally(() => { savePromise = null; });
  return savePromise;
}

async function openBoard(id) {
  if (store.getState().dirty) {
    try { await saveBoard(false); }
    catch { return; }
  }
  const board = normalizeBoard(await tacticsApi.getBoard(id));
  store.replaceBoard(board);
  localStorage.removeItem(DRAFT_KEY);
  history.replaceState(null, "", `/tactics?board=${encodeURIComponent(id)}`);
  renderLibrary();
  toast(`Abierta: ${board.name}`);
}

async function createBoard() {
  if (store.getState().dirty) {
    try { await saveBoard(false); }
    catch { return; }
  }
  store.replaceBoard(createNewBoard());
  localStorage.removeItem(DRAFT_KEY);
  history.replaceState(null, "", "/tactics");
  renderLibrary();
  $("#board-name").focus();
  $("#board-name").select();
}

async function refreshLibrary() {
  boards = await tacticsApi.listBoards();
  renderLibrary();
}

function renderLibrary() {
  const activeId = store.getState().board.id;
  $("#board-list").innerHTML = boards.length
    ? boards.slice(0, 8).map((board) => `
      <button type="button" class="board-row ${board.id === activeId ? "active" : ""}" data-board-id="${board.id}">
        <span class="board-thumb"><i data-lucide="rectangle-horizontal"></i></span>
        <span><strong>${escapeHtml(board.name)}</strong><small>${escapeHtml(board.category)} · ${formatDate(board.updated_at)}</small></span>
      </button>`).join("")
    : `<div class="compact-empty">Todavia no hay pizarras guardadas.</div>`;
  $$('[data-board-id]').forEach((button) => button.addEventListener("click", () => openBoard(button.dataset.boardId).catch((error) => toast(error.message))));
  refreshIcons();
}

function renderRoster() {
  const { ui } = store.getState();
  $$("#team-switch button").forEach((button) => button.classList.toggle("active", button.dataset.team === ui.activeTeam));
  const term = $("#roster-search").value.trim().toLowerCase();
  const players = ui.activeTeam === "home"
    ? roster.filter((player) => !term || String(player.username || "").toLowerCase().includes(term))
    : [];
  $("#roster-list").innerHTML = players.length
    ? players.slice(0, 18).map((player, index) => `
      <article class="roster-row">
        ${player.avatarUrl ? `<img src="${escapeHtml(player.avatarUrl)}" alt="" />` : `<span class="avatar-fallback">${initials(player.username)}</span>`}
        <span><strong>${escapeHtml(player.username)}</strong><small>Jugador KORU</small></span>
        <b>${String(index + 1).padStart(2, "0")}</b>
      </article>`).join("")
    : `<div class="compact-empty">${ui.activeTeam === "away" ? "El rival se configurara desde cada partido." : "No hay jugadores disponibles."}</div>`;
}

function handleShortcut(event) {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
  if (typing) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveBoard(true);
  } else if (command && event.key.toLowerCase() === "z" && event.shiftKey) {
    event.preventDefault();
    store.redo();
  } else if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    store.undo();
  } else if (command && event.key.toLowerCase() === "y") {
    event.preventDefault();
    store.redo();
  } else if (event.key.toLowerCase() === "f") {
    $("#fit-pitch").click();
  }
}

async function toggleFullscreen() {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await $("#tactics-app").requestFullscreen();
}

function persistRecoveryDraft() {
  const state = store.getState();
  if (state.dirty) localStorage.setItem(DRAFT_KEY, JSON.stringify(state.board));
}

function loadRecoveryDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? normalizeBoard(JSON.parse(raw)) : null;
  } catch {
    localStorage.removeItem(DRAFT_KEY);
    return null;
  }
}

function initials(name) {
  return String(name || "K").split(/[-_\s]+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatDate(value) {
  if (!value) return "Ahora";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}
