import { tacticsApi } from "./api.js";
import {
  boardPayload,
  applySceneToEntities,
  captureSceneEntityStates,
  createAnalysisEntry,
  createNewAnalysisSession,
  createNewBoard,
  createPlayerEntity,
  createSceneFromEntities,
  createTacticalId,
  normalizeBoard,
} from "./model.js?v=20260827d";
import { Pitch2DInteractions } from "./interactions2d.js";
import { Pitch2DRenderer } from "./pitch2d.js?v=20260827e";
import { createEditorStore } from "./store.js";

const DRAFT_KEY = "koru:tactics:recovery-draft:v2";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const KIND_LABELS = { observation: "Observacion", decision: "Decision", adjustment: "Ajuste", task: "Tarea", outcome: "Resultado" };
const AUTO_POSITIONS = {
  home: [[8, 34], [24, 12], [22, 31], [22, 48], [34, 58], [43, 20], [44, 43], [60, 10], [61, 34], [60, 57], [79, 34]],
  away: [[97, 34], [81, 12], [83, 31], [83, 48], [71, 58], [62, 20], [61, 43], [45, 10], [44, 34], [45, 57], [26, 34]],
};

const recoveryDraft = loadRecoveryDraft();
const store = createEditorStore(recoveryDraft || createNewBoard(), Boolean(recoveryDraft));
const renderer = new Pitch2DRenderer($("#pitch-shell"));
let boards = [];
let dashboardRoster = [];
let customRoster = [];
let matches = [];
let saveTimer = null;
let savePromise = null;
let lastDocumentRevision = -1;
let lastSelectionKey = "";
let lastSceneUiKey = "";
let previewUrl = null;
let playbackFrame = null;
let playbackToken = 0;

new Pitch2DInteractions({
  viewport: $("#pitch-viewport"),
  renderer,
  marquee: $("#selection-marquee"),
  getState: store.getState,
  onSelection: (selection) => store.setSelection(selection),
  onMove: commitEntityMove,
  onDropPlayer: (reference, position) => addRosterPlayer(reference.playerKey, position),
  onViewportChange: (patch) => store.setUI(patch),
  onDraw: addTacticalAnnotation,
  onText: addTextAnnotation,
  onAnnotationMove: moveTacticalAnnotation,
});

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindControls();
  if (window.matchMedia("(max-width: 760px)").matches) store.setUI({ leftCollapsed: true, rightCollapsed: true });
  store.subscribe(render);
  render(store.getState());
  refreshIcons();

  try {
    const [boardList, dashboard, playerList] = await Promise.all([
      tacticsApi.listBoards(),
      tacticsApi.getDashboard(),
      tacticsApi.listPlayers(),
    ]);
    boards = boardList;
    customRoster = playerList;
    dashboardRoster = dashboard.analytics?.playerElo || dashboard.leaderboards?.scorers || [];
    matches = uniqueMatches([...(dashboard.upcoming || []), ...(dashboard.recent || [])]);
    renderMatchOptions();
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
  $("#board-match").addEventListener("change", bindBoardToMatch);

  $$('[data-overlay]').forEach((input) => input.addEventListener("change", () => {
    change(["board", "document", "pitch", "overlays"], $$('[data-overlay]:checked').map((item) => item.value), "Cambiar overlays");
  }));

  $("#save-button").addEventListener("click", () => saveBoard(true).catch(() => null));
  $("#undo-button").addEventListener("click", () => store.undo());
  $("#redo-button").addEventListener("click", () => store.redo());
  $("#new-board-button").addEventListener("click", createBoard);
  $("#roster-search").addEventListener("input", renderRoster);
  $("#delete-selection").addEventListener("click", deleteSelection);
  $("#team-switch").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-team]");
    if (!button) return;
    store.setUI({ activeTeam: button.dataset.team });
    renderRoster();
  });

  $$('[data-tool]').forEach((button) => button.addEventListener("click", () => store.setUI({ activeTool: button.dataset.tool })));
  $$('[data-add-entity]').forEach((button) => button.addEventListener("click", () => addEntity(button.dataset.addEntity)));
  $$('[data-collapse]').forEach((button) => button.addEventListener("click", () => togglePanel(button.dataset.collapse)));
  $$('[data-toggle-panel]').forEach((button) => button.addEventListener("click", () => togglePanel(button.dataset.togglePanel, true)));

  $("#fit-pitch").addEventListener("click", () => store.setUI({ zoom: 1, pan: { x: 0, y: 0 } }));
  $("#fullscreen-button").addEventListener("click", toggleFullscreen);

  $("#new-scene-button").addEventListener("click", createScene);
  $("#previous-scene-button").addEventListener("click", () => activateScene(store.getState().playback.sceneIndex - 1));
  $("#next-scene-button").addEventListener("click", () => activateScene(store.getState().playback.sceneIndex + 1));
  $("#play-button").addEventListener("click", playNextScene);
  $("#scene-strip").addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-scene-index]");
    if (deleteButton) {
      event.stopPropagation();
      deleteScene(Number(deleteButton.dataset.deleteSceneIndex));
      return;
    }
    const button = event.target.closest("[data-scene-index]");
    if (button) activateScene(Number(button.dataset.sceneIndex));
  });
  $("#scene-name").addEventListener("change", updateSceneDetails);
  $("#scene-duration").addEventListener("change", updateSceneDetails);
  $("#scene-transition").addEventListener("change", updateSceneDetails);
  $("#scene-notes").addEventListener("change", updateSceneDetails);
  $("#capture-scene-button").addEventListener("click", captureActiveScene);
  $("#duplicate-scene-button").addEventListener("click", duplicateActiveScene);
  $("#delete-scene-button").addEventListener("click", deleteActiveScene);
  $("#scene-back-button").addEventListener("click", () => moveActiveScene(-1));
  $("#scene-forward-button").addEventListener("click", () => moveActiveScene(1));
  $("#annotation-list").addEventListener("change", updateAnnotationColor);
  $("#annotation-list").addEventListener("click", handleAnnotationAction);

  $("#new-session-button").addEventListener("click", createSession);
  $("#analysis-session").addEventListener("change", (event) => change(["board", "document", "analysis", "activeSessionId"], event.target.value, "Cambiar sesion"));
  $("#analysis-session-name").addEventListener("change", updateSessionDetails);
  $("#analysis-session-type").addEventListener("change", updateSessionDetails);
  $("#analysis-form").addEventListener("submit", addAnalysisEntry);
  $("#analysis-list").addEventListener("click", removeAnalysisEntry);

  $("#create-player-button").addEventListener("click", openPlayerDialog);
  $("#close-player-dialog").addEventListener("click", closePlayerDialog);
  $("#cancel-player-button").addEventListener("click", closePlayerDialog);
  $("#player-avatar").addEventListener("change", previewAvatar);
  $("#player-form").addEventListener("submit", saveCustomPlayer);

  document.addEventListener("keydown", handleShortcut);
  window.addEventListener("beforeunload", persistRecoveryDraft);
}

function togglePanel(side, closeOtherOnMobile = false) {
  const state = store.getState();
  const patch = { [`${side}Collapsed`]: !state.ui[`${side}Collapsed`] };
  if (closeOtherOnMobile && window.matchMedia("(max-width: 760px)").matches) patch[`${side === "left" ? "right" : "left"}Collapsed`] = true;
  store.setUI(patch);
}

function change(path, value, label) {
  store.update(path, value, label);
  afterDocumentChange();
}

function afterDocumentChange() {
  persistRecoveryDraft();
  scheduleAutosave();
}

function render(state) {
  const { board, ui } = state;
  const renderKey = `${state.documentRevision}:${currentSceneIndex(state)}`;
  if (renderKey !== lastDocumentRevision) {
    renderer.render(board.document, currentScene(state)?.annotations || []);
    lastDocumentRevision = renderKey;
    renderRoster();
    renderAnalysis();
  }
  renderSceneUi(state);
  renderAnnotationList(state);
  renderer.setSelection(state.selection);
  const selectionKey = state.selection.join("|");
  if (selectionKey !== lastSelectionKey || state.documentRevision === lastDocumentRevision) {
    renderSelection();
    lastSelectionKey = selectionKey;
  }

  document.body.classList.toggle("left-collapsed", ui.leftCollapsed);
  document.body.classList.toggle("right-collapsed", ui.rightCollapsed);
  $("#pitch-viewport").dataset.tool = ui.activeTool;
  $("#pitch-shell").style.transform = `translate(${ui.pan.x}px, ${ui.pan.y}px) scale(${ui.zoom})`;
  $$('[data-tool]').forEach((button) => button.classList.toggle("active", button.dataset.tool === ui.activeTool));

  syncValue("#board-name", board.name);
  syncValue("#board-description", board.description);
  syncValue("#board-category", board.category);
  syncValue("#board-match", board.matchId || "");
  syncValue("#pitch-view", board.document.pitch.view);
  syncValue("#pitch-orientation", board.document.pitch.orientation);
  syncValue("#pitch-surface", board.document.pitch.surface);
  $$('[data-overlay]').forEach((input) => { input.checked = board.document.pitch.overlays.includes(input.value); });

  $("#undo-button").disabled = !store.canUndo();
  $("#redo-button").disabled = !store.canRedo();
  $("#save-state").textContent = state.saving ? "Guardando..." : state.error ? "Error al guardar" : state.dirty ? "Cambios pendientes" : board.id ? "Guardado" : "Sin guardar";
  $("#save-state").className = `save-state${state.error ? " error" : state.saving ? " saving" : ""}`;
  $("#pitch-readout").textContent = `${board.document.pitch.width} x ${board.document.pitch.height} m`;
  $("#zoom-readout").textContent = `Zoom ${Math.round(ui.zoom * 100)}%`;
  $("#timeline-time").textContent = formatTimelineTime(state.playback.time);
  persistRecoveryDraft();
}

function syncValue(selector, value) {
  const element = $(selector);
  if (element && document.activeElement !== element && element.value !== String(value ?? "")) element.value = value ?? "";
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
  savePromise = (state.board.id ? tacticsApi.updateBoard(state.board.id, payload) : tacticsApi.createBoard(payload))
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
    try { await saveBoard(false); } catch { return; }
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
    try { await saveBoard(false); } catch { return; }
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
  $("#board-list").innerHTML = boards.length ? boards.slice(0, 8).map((board) => `
    <button type="button" class="board-row ${board.id === activeId ? "active" : ""}" data-board-id="${board.id}">
      <span class="board-thumb"><i data-lucide="rectangle-horizontal"></i></span>
      <span><strong>${escapeHtml(board.name)}</strong><small>${escapeHtml(board.category)} · ${formatDate(board.updated_at)}</small></span>
    </button>`).join("") : `<div class="compact-empty">Todavia no hay pizarras guardadas.</div>`;
  $$('[data-board-id]').forEach((button) => button.addEventListener("click", () => openBoard(button.dataset.boardId).catch((error) => toast(error.message))));
  refreshIcons();
}

function rosterPlayers(team) {
  const dashboard = team === "home" ? dashboardRoster.map((player, index) => ({
    ...player,
    name: player.username || player.name,
    username: player.username || player.name,
    number: player.number ?? index + 1,
    positionLabel: player.position || "KORU",
    rosterKey: `dashboard:${player.username || player.name || index}`,
    source: "dashboard",
  })) : [];
  const custom = customRoster.filter((player) => player.team === team).map((player) => ({
    ...player,
    username: player.name,
    positionLabel: player.position,
    rosterKey: `custom:${player.id}`,
    source: "custom",
  }));
  return [...custom, ...dashboard];
}

function renderRoster() {
  const list = $("#roster-list");
  if (!list) return;
  const { ui, board } = store.getState();
  $$("#team-switch button").forEach((button) => button.classList.toggle("active", button.dataset.team === ui.activeTeam));
  const term = $("#roster-search").value.trim().toLowerCase();
  const placed = new Set(board.document.entities.map((entity) => entity.metadata?.rosterKey).filter(Boolean));
  const players = rosterPlayers(ui.activeTeam).filter((player) => !term || String(player.username || "").toLowerCase().includes(term));
  list.innerHTML = players.length ? players.slice(0, 30).map((player) => {
    const key = escapeHtml(player.rosterKey);
    const isPlaced = placed.has(player.rosterKey);
    return `<div class="roster-item">
      <button type="button" draggable="true" class="roster-row${isPlaced ? " placed" : ""}" data-player-key="${key}">
        ${player.avatarUrl ? `<img src="${escapeHtml(player.avatarUrl)}" alt="" />` : `<span class="avatar-fallback">${initials(player.username)}</span>`}
        <span><strong>${escapeHtml(player.username)}</strong><small>${escapeHtml(player.positionLabel || (ui.activeTeam === "home" ? "Jugador KORU" : "Rival"))}</small></span>
        <b>${String(player.number ?? 0).padStart(2, "0")}</b>
      </button>
      ${player.source === "custom" ? `<button type="button" class="delete-roster-player" data-delete-player="${player.id}" title="Eliminar jugador" aria-label="Eliminar jugador"><i data-lucide="trash-2"></i></button>` : ""}
    </div>`;
  }).join("") : `<div class="compact-empty">Crea el primer jugador de ${ui.activeTeam === "home" ? "KORU" : "este rival"}.</div>`;

  $$('[data-player-key]').forEach((button) => {
    button.addEventListener("click", () => addRosterPlayer(button.dataset.playerKey));
    button.addEventListener("dragstart", (event) => event.dataTransfer.setData("application/x-koru-player", JSON.stringify({ playerKey: button.dataset.playerKey })));
  });
  $$('[data-delete-player]').forEach((button) => button.addEventListener("click", () => deleteCustomPlayer(button.dataset.deletePlayer)));
  refreshIcons();
}

function findRosterPlayer(playerKey) {
  return [...rosterPlayers("home"), ...rosterPlayers("away")].find((player) => player.rosterKey === playerKey);
}

function addRosterPlayer(playerKey, position = null) {
  const player = findRosterPlayer(playerKey);
  if (!player) return;
  const state = store.getState();
  if (state.board.document.entities.some((entity) => entity.metadata?.rosterKey === playerKey)) {
    toast(`${player.username} ya esta en el campo`);
    return;
  }
  const team = player.team || state.ui.activeTeam;
  const count = state.board.document.entities.filter((entity) => entity.type === "player" && entity.teamId === team).length;
  const [x, y] = AUTO_POSITIONS[team][Math.min(count, AUTO_POSITIONS[team].length - 1)];
  const entity = createPlayerEntity(player, team, position || { x, y, z: 0 }, player.number ?? count + 1);
  const entities = [...state.board.document.entities, entity];
  store.update(["board", "document", "entities"], entities, "Añadir jugador");
  store.setSelection([entity.id]);
  afterDocumentChange();
  if (window.matchMedia("(max-width: 760px)").matches) store.setUI({ leftCollapsed: true });
}

function addEntity(type) {
  if (type !== "ball") return;
  const state = store.getState();
  const existing = state.board.document.entities.find((entity) => entity.type === "ball");
  if (existing) {
    store.setSelection([existing.id]);
    toast("El balon ya esta en el campo");
    return;
  }
  const ball = {
    id: createTacticalId(),
    type: "ball",
    teamId: null,
    name: "Balon",
    number: null,
    positionLabel: null,
    position: { x: 52.5, y: 34, z: 0 },
    rotation: 0,
    scale: 1,
    opacity: 1,
    locked: false,
    visible: true,
    metadata: { source: "tactical-tool" },
  };
  store.update(["board", "document", "entities"], [...state.board.document.entities, ball], "Añadir balon");
  store.setSelection([ball.id]);
  afterDocumentChange();
}

function currentSceneIndex(state = store.getState()) {
  const total = state.board.document.scenes.length;
  return Math.max(0, Math.min(state.playback.sceneIndex, Math.max(0, total - 1)));
}

function currentScene(state = store.getState()) {
  return state.board.document.scenes[currentSceneIndex(state)];
}

function renderSceneUi(state) {
  const scenes = state.board.document.scenes;
  const index = currentSceneIndex(state);
  const scene = scenes[index];
  const key = `${state.documentRevision}:${index}:${state.playback.playing}`;
  if (key === lastSceneUiKey) return;
  lastSceneUiKey = key;

  $("#scene-strip").innerHTML = scenes.map((item, itemIndex) => `
    <button type="button" class="scene-card${itemIndex === index ? " active" : ""}" data-scene-index="${itemIndex}">
      <span>${String(itemIndex + 1).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.notes || `${formatDuration(item.duration)} · ${transitionLabel(item.transition)}`)}</small></div>
      <span class="scene-card-delete${scenes.length <= 1 || state.playback.playing ? " disabled" : ""}" data-delete-scene-index="${itemIndex}" role="button" aria-label="Eliminar escena ${itemIndex + 1}" title="Eliminar escena"><i data-lucide="trash-2"></i></span>
    </button>`).join("");
  $("#scene-counter").textContent = `${index + 1} de ${scenes.length}`;
  $("#scene-total").textContent = String(scenes.length);
  $("#previous-scene-button").disabled = index === 0 || state.playback.playing;
  $("#next-scene-button").disabled = index === scenes.length - 1 || state.playback.playing;
  $("#new-scene-button").disabled = state.playback.playing;
  $("#play-button").disabled = scenes.length < 2;
  $("#play-button").innerHTML = `<i data-lucide="${state.playback.playing ? "square" : "play"}"></i>`;

  if (!scene) return;
  syncValue("#scene-name", scene.name);
  syncValue("#scene-duration", scene.duration);
  syncValue("#scene-transition", scene.transition);
  syncValue("#scene-notes", scene.notes);
  $("#capture-scene-button").disabled = state.playback.playing;
  $("#duplicate-scene-button").disabled = state.playback.playing;
  $("#delete-scene-button").disabled = scenes.length <= 1 || state.playback.playing;
  $("#scene-back-button").disabled = index === 0 || state.playback.playing;
  $("#scene-forward-button").disabled = index === scenes.length - 1 || state.playback.playing;
  refreshIcons();
}

function activateScene(index) {
  const state = store.getState();
  const scenes = state.board.document.scenes;
  if (index < 0 || index >= scenes.length) return;
  cancelPlayback();
  const entities = applySceneToEntities(state.board.document.entities, scenes[index]);
  store.applyScene(index, entities);
  toast(`Escena ${index + 1}: ${scenes[index].name}`);
}

function createScene() {
  const state = store.getState();
  const scenes = state.board.document.scenes;
  const scene = createSceneFromEntities(`Escena ${scenes.length + 1}`, state.board.document.entities);
  store.update(["board", "document", "scenes"], [...scenes, scene], "Crear escena");
  store.setPlayback({ sceneIndex: scenes.length, time: 0 });
  afterDocumentChange();
  toast("Nueva escena capturada desde el campo actual");
}

function captureActiveScene() {
  const state = store.getState();
  const index = currentSceneIndex(state);
  store.update(["board", "document", "scenes", index, "entityStates"], captureSceneEntityStates(state.board.document.entities), "Capturar escena");
  afterDocumentChange();
  toast("Posiciones guardadas en esta escena");
}

function addTacticalAnnotation(type, start, end) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1) return;
  const state = store.getState();
  const index = currentSceneIndex(state);
  const annotation = {
    id: createTacticalId(),
    type,
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    color: type === "arrow" ? "#f95516" : "#12d6df",
  };
  const annotations = [...(state.board.document.scenes[index].annotations || []), annotation];
  store.update(["board", "document", "scenes", index, "annotations"], annotations, type === "arrow" ? "Dibujar flecha" : "Dibujar zona");
  afterDocumentChange();
  toast(type === "arrow" ? "Flecha anadida a esta escena" : "Zona anadida a esta escena");
}

function addTextAnnotation(position) {
  const text = window.prompt("Texto tactico");
  if (!text?.trim()) return;
  const state = store.getState();
  const index = currentSceneIndex(state);
  const annotation = { id: createTacticalId(), type: "text", position: { x: position.x, y: position.y }, text: text.trim(), color: "#f7f8fb" };
  const annotations = [...(state.board.document.scenes[index].annotations || []), annotation];
  store.update(["board", "document", "scenes", index, "annotations"], annotations, "Anadir texto tactico");
  afterDocumentChange();
}

function moveTacticalAnnotation(id, start, end) {
  const delta = { x: end.x - start.x, y: end.y - start.y };
  if (Math.hypot(delta.x, delta.y) < 0.1) return;
  const state = store.getState();
  const index = currentSceneIndex(state);
  const pitch = state.board.document.pitch;
  const movePoint = (point) => ({ x: Math.max(0, Math.min(pitch.width, point.x + delta.x)), y: Math.max(0, Math.min(pitch.height, point.y + delta.y)) });
  const annotations = state.board.document.scenes[index].annotations.map((annotation) => {
    if (annotation.id !== id) return annotation;
    if (annotation.type === "text") return { ...annotation, position: movePoint(annotation.position) };
    return { ...annotation, start: movePoint(annotation.start), end: movePoint(annotation.end) };
  });
  store.update(["board", "document", "scenes", index, "annotations"], annotations, "Mover anotacion");
  afterDocumentChange();
}

function renderAnnotationList(state) {
  const annotations = currentScene(state)?.annotations || [];
  $("#annotation-count").textContent = String(annotations.length);
  $("#annotation-list").innerHTML = annotations.length ? annotations.map((annotation, index) => {
    const label = annotation.type === "arrow" ? `Flecha ${index + 1}` : annotation.type === "zone" ? `Zona ${index + 1}` : annotation.text || `Texto ${index + 1}`;
    const icon = annotation.type === "arrow" ? "move-up-right" : annotation.type === "zone" ? "square-dashed" : "type";
    return `<div class="annotation-row${state.selection.includes(annotation.id) ? " active" : ""}" data-annotation-row="${annotation.id}"><i data-lucide="${icon}"></i><strong>${escapeHtml(label)}</strong><input type="color" value="${escapeHtml(annotation.color || "#f95516")}" data-annotation-color="${annotation.id}" aria-label="Color de ${escapeHtml(label)}" /><button type="button" class="annotation-edit" data-edit-annotation="${annotation.id}" title="Editar texto" aria-label="Editar texto"${annotation.type === "text" ? "" : " hidden"}><i data-lucide="pencil"></i></button><button type="button" class="annotation-delete" data-delete-annotation="${annotation.id}" title="Eliminar anotacion" aria-label="Eliminar anotacion"><i data-lucide="trash-2"></i></button></div>`;
  }).join("") : `<div class="compact-empty">Usa las herramientas de la izquierda para anotar esta escena.</div>`;
  refreshIcons();
}

function updateAnnotationColor(event) {
  const input = event.target.closest("[data-annotation-color]");
  if (!input) return;
  const state = store.getState();
  const index = currentSceneIndex(state);
  const annotations = state.board.document.scenes[index].annotations.map((annotation) => annotation.id === input.dataset.annotationColor ? { ...annotation, color: input.value } : annotation);
  store.update(["board", "document", "scenes", index, "annotations"], annotations, "Cambiar color de anotacion");
  afterDocumentChange();
}

function handleAnnotationAction(event) {
  const deleteButton = event.target.closest("[data-delete-annotation]");
  const editButton = event.target.closest("[data-edit-annotation]");
  if (!deleteButton && !editButton) return;
  const id = (deleteButton || editButton).dataset.deleteAnnotation || (deleteButton || editButton).dataset.editAnnotation;
  const state = store.getState();
  const index = currentSceneIndex(state);
  const current = state.board.document.scenes[index].annotations || [];
  if (deleteButton) {
    store.update(["board", "document", "scenes", index, "annotations"], current.filter((annotation) => annotation.id !== id), "Eliminar anotacion");
    afterDocumentChange();
    return;
  }
  const annotation = current.find((item) => item.id === id);
  const text = window.prompt("Texto tactico", annotation?.text || "");
  if (!annotation || !text?.trim()) return;
  store.update(["board", "document", "scenes", index, "annotations"], current.map((item) => item.id === id ? { ...item, text: text.trim() } : item), "Editar texto tactico");
  afterDocumentChange();
}

function duplicateActiveScene() {
  const state = store.getState();
  const index = currentSceneIndex(state);
  const source = state.board.document.scenes[index];
  const scene = createSceneFromEntities(`${source.name} copia`, state.board.document.entities, source);
  const scenes = [...state.board.document.scenes];
  scenes.splice(index + 1, 0, scene);
  store.update(["board", "document", "scenes"], scenes, "Duplicar escena");
  store.setPlayback({ sceneIndex: index + 1, time: 0 });
  afterDocumentChange();
}

function deleteActiveScene() {
  const state = store.getState();
  const index = currentSceneIndex(state);
  deleteScene(index);
}

function deleteScene(index) {
  const state = store.getState();
  const scenes = state.board.document.scenes;
  if (state.playback.playing || scenes.length <= 1 || index < 0 || index >= scenes.length) return;
  const remaining = scenes.filter((_, itemIndex) => itemIndex !== index);
  const nextIndex = Math.min(index, remaining.length - 1);
  const nextEntities = applySceneToEntities(state.board.document.entities, remaining[nextIndex]);
  store.update(["board", "document", "scenes"], remaining, "Eliminar escena");
  store.applyScene(nextIndex, nextEntities);
  afterDocumentChange();
  toast(`Escena eliminada. Ahora estas en la escena ${nextIndex + 1}`);
}

function moveActiveScene(direction) {
  const state = store.getState();
  const index = currentSceneIndex(state);
  const target = index + direction;
  const scenes = state.board.document.scenes;
  if (target < 0 || target >= scenes.length) return;
  const reordered = [...scenes];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  store.update(["board", "document", "scenes"], reordered, "Reordenar escena");
  store.setPlayback({ sceneIndex: target });
  afterDocumentChange();
}

function updateSceneDetails() {
  const state = store.getState();
  const index = currentSceneIndex(state);
  const duration = Math.max(0.5, Math.min(120, Number($("#scene-duration").value) || 3));
  store.updateMany([
    { path: ["board", "document", "scenes", index, "name"], value: $("#scene-name").value.trim() || `Escena ${index + 1}` },
    { path: ["board", "document", "scenes", index, "duration"], value: duration },
    { path: ["board", "document", "scenes", index, "transition"], value: $("#scene-transition").value },
    { path: ["board", "document", "scenes", index, "notes"], value: $("#scene-notes").value.trim() },
  ], "Editar escena");
  afterDocumentChange();
}

function playNextScene() {
  const state = store.getState();
  if (state.playback.playing) {
    cancelPlayback();
    return;
  }
  const index = currentSceneIndex(state);
  if (index >= state.board.document.scenes.length - 1) {
    toast("Ya estas en la ultima escena");
    return;
  }
  playbackToken += 1;
  const token = playbackToken;
  store.setPlayback({ playing: true, time: 0 });
  playSceneTransition(index, token);
}

function playSceneTransition(fromIndex, token) {
  const state = store.getState();
  const scenes = state.board.document.scenes;
  const targetIndex = fromIndex + 1;
  if (token !== playbackToken || targetIndex >= scenes.length) return;
  const targetScene = scenes[targetIndex];
  const startEntities = structuredClone(state.board.document.entities);
  const targetEntities = applySceneToEntities(startEntities, targetScene);
  const speed = Math.max(0.1, state.board.document.timeline.speed || 1);
  const duration = Math.max(500, Number(targetScene.duration || 3) * 1000 / speed);
  const startedAt = performance.now();

  const tick = (now) => {
    if (token !== playbackToken) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = easing(progress, targetScene.transition);
    const positions = Object.fromEntries(targetEntities.map((target, entityIndex) => {
      const start = startEntities[entityIndex];
      return [target.id, {
        x: start.position.x + (target.position.x - start.position.x) * eased,
        y: start.position.y + (target.position.y - start.position.y) * eased,
        z: start.position.z + (target.position.z - start.position.z) * eased,
      }];
    }));
    renderer.previewEntityPositions(positions);
    store.setPlayback({ time: (now - startedAt) / 1000 });
    if (progress < 1) playbackFrame = requestAnimationFrame(tick);
    else {
      playbackFrame = null;
      const hasNext = targetIndex < scenes.length - 1;
      store.applyScene(targetIndex, targetEntities, { playing: hasNext, time: 0 });
      if (hasNext) playbackFrame = requestAnimationFrame(() => playSceneTransition(targetIndex, token));
    }
  };
  playbackFrame = requestAnimationFrame(tick);
}

function cancelPlayback() {
  playbackToken += 1;
  if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
  playbackFrame = null;
  const playback = store.getState().playback;
  if (playback.playing) {
    const entities = store.getState().board.document.entities;
    renderer.previewEntityPositions(Object.fromEntries(entities.map((entity) => [entity.id, entity.position])));
    store.setPlayback({ playing: false, time: 0 });
  }
}

function easing(progress, transition) {
  if (transition === "linear") return progress;
  if (transition === "ease-in") return progress * progress;
  if (transition === "ease-out") return 1 - (1 - progress) ** 2;
  return progress < 0.5 ? 2 * progress * progress : 1 - ((-2 * progress + 2) ** 2) / 2;
}

function formatDuration(value) {
  return `${Number(value || 0).toFixed(value % 1 ? 1 : 0)} s`;
}

function formatTimelineTime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  return `00:${seconds.toFixed(1).padStart(4, "0")}`;
}

function transitionLabel(value) {
  return { linear: "Lineal", "ease-in": "Entrada", "ease-out": "Salida", "ease-in-out": "Suave" }[value] || "Suave";
}

function commitEntityMove(starts, positions) {
  const entities = store.getState().board.document.entities;
  const changes = Object.entries(positions).flatMap(([id, position]) => {
    const index = entities.findIndex((entity) => entity.id === id);
    if (index < 0 || JSON.stringify(starts[id]) === JSON.stringify(position)) return [];
    return [{ path: ["board", "document", "entities", index, "position"], value: position }];
  });
  if (!changes.length) return;
  store.updateMany(changes, changes.length > 1 ? "Mover seleccion" : "Mover jugador");
  afterDocumentChange();
}

function deleteSelection() {
  const state = store.getState();
  const selected = new Set(state.selection);
  if (!selected.size) return;
  const document = state.board.document;
  const sceneIndex = currentSceneIndex(state);
  const selectedAnnotations = new Set((document.scenes[sceneIndex].annotations || []).filter((annotation) => selected.has(annotation.id)).map((annotation) => annotation.id));
  if (selectedAnnotations.size) {
    store.update(["board", "document", "scenes", sceneIndex, "annotations"], document.scenes[sceneIndex].annotations.filter((annotation) => !selectedAnnotations.has(annotation.id)), "Eliminar anotacion");
    store.setSelection([]);
    afterDocumentChange();
    return;
  }
  const sessions = document.analysis.sessions.map((session) => ({
    ...session,
    entries: session.entries.map((entry) => ({ ...entry, entityIds: entry.entityIds.filter((id) => !selected.has(id)) })),
  }));
  store.updateMany([
    { path: ["board", "document", "entities"], value: document.entities.filter((entity) => !selected.has(entity.id)) },
    { path: ["board", "document", "groups"], value: document.groups.map((group) => ({ ...group, entityIds: group.entityIds.filter((id) => !selected.has(id)) })) },
    { path: ["board", "document", "scenes"], value: document.scenes.map((scene) => ({ ...scene, entityStates: scene.entityStates.filter((item) => !selected.has(item.entityId)) })) },
    { path: ["board", "document", "analysis", "sessions"], value: sessions },
  ], "Eliminar seleccion");
  store.setSelection([]);
  afterDocumentChange();
}

function renderSelection() {
  const state = store.getState();
  const entities = state.selection.map((id) => state.board.document.entities.find((entity) => entity.id === id)).filter(Boolean);
  const annotation = (currentScene(state)?.annotations || []).find((item) => state.selection.includes(item.id));
  $("#selection-section").hidden = !entities.length && !annotation;
  if (annotation) {
    $("#selection-summary").textContent = "Anotacion";
    $("#selection-detail").innerHTML = `<strong>${annotation.type === "arrow" ? "Flecha" : annotation.type === "zone" ? "Zona" : escapeHtml(annotation.text || "Texto")}</strong><small>Arrastra sobre el campo para moverla.</small>`;
    return;
  }
  if (!entities.length) return;
  $("#selection-summary").textContent = `${entities.length} ${entities.length === 1 ? "objeto" : "objetos"}`;
  $("#selection-detail").innerHTML = entities.length === 1
    ? `<strong>${escapeHtml(entities[0].name || entities[0].type)}</strong><small>${entities[0].positionLabel || entities[0].type} · X ${entities[0].position.x.toFixed(1)} · Y ${entities[0].position.y.toFixed(1)}</small>`
    : `<strong>Seleccion multiple</strong><small>${entities.map((entity) => escapeHtml(entity.name || entity.type)).join(", ")}</small>`;
}

function uniqueMatches(items) {
  return [...new Map(items.filter((match) => match?.id).map((match) => [match.id, match])).values()];
}

function renderMatchOptions() {
  const current = store.getState().board.matchId || "";
  $("#board-match").innerHTML = `<option value="">Sin vincular</option>${matches.map((match) => `<option value="${escapeHtml(match.id)}">${escapeHtml(match.platform)} · ${escapeHtml(match.opponent || `${match.home} - ${match.away}`)} · ${formatDate(match.datetime)}</option>`).join("")}`;
  $("#board-match").value = current;
}

function bindBoardToMatch(event) {
  const matchId = event.target.value || null;
  const document = store.getState().board.document;
  const sessionIndex = document.analysis.sessions.findIndex((session) => session.id === document.analysis.activeSessionId);
  const changes = [{ path: ["board", "matchId"], value: matchId }];
  if (sessionIndex >= 0) changes.push({ path: ["board", "document", "analysis", "sessions", sessionIndex, "matchId"], value: matchId });
  store.updateMany(changes, "Vincular partido");
  afterDocumentChange();
}

function activeSession() {
  const analysis = store.getState().board.document.analysis;
  return analysis.sessions.find((session) => session.id === analysis.activeSessionId) || analysis.sessions[0];
}

function renderAnalysis() {
  const analysis = store.getState().board.document.analysis;
  const session = activeSession();
  $("#analysis-session").innerHTML = analysis.sessions.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${item.entries.length}</option>`).join("");
  if (!session) return;
  syncValue("#analysis-session", session.id);
  syncValue("#analysis-session-name", session.name);
  syncValue("#analysis-session-type", session.type);
  $("#analysis-list").innerHTML = session.entries.length ? [...session.entries].reverse().map((entry) => `
    <article class="analysis-entry" data-kind="${entry.kind}">
      <small>${KIND_LABELS[entry.kind] || entry.kind}${entry.matchMinute !== null && entry.matchMinute !== undefined ? ` · ${entry.matchMinute}'` : ""}${entry.entityIds?.length ? ` · ${entry.entityIds.length} PJ` : ""}</small>
      <p>${escapeHtml(entry.text)}</p>
      <button type="button" data-delete-entry="${entry.id}" title="Eliminar anotacion" aria-label="Eliminar anotacion"><i data-lucide="x"></i></button>
    </article>`).join("") : `<div class="compact-empty">Aun no hay anotaciones en esta sesion.</div>`;
  refreshIcons();
}

function createSession() {
  const state = store.getState();
  const analysis = state.board.document.analysis;
  const session = createNewAnalysisSession(analysis.sessions.length + 1, state.board.matchId);
  store.updateMany([
    { path: ["board", "document", "analysis", "sessions"], value: [...analysis.sessions, session] },
    { path: ["board", "document", "analysis", "activeSessionId"], value: session.id },
  ], "Crear sesion de analisis");
  afterDocumentChange();
}

function updateSessionDetails() {
  const state = store.getState();
  const analysis = state.board.document.analysis;
  const index = analysis.sessions.findIndex((session) => session.id === analysis.activeSessionId);
  if (index < 0) return;
  store.updateMany([
    { path: ["board", "document", "analysis", "sessions", index, "name"], value: $("#analysis-session-name").value.trim() || `Sesion ${index + 1}` },
    { path: ["board", "document", "analysis", "sessions", index, "type"], value: $("#analysis-session-type").value },
  ], "Editar sesion");
  afterDocumentChange();
}

function addAnalysisEntry(event) {
  event.preventDefault();
  const text = $("#analysis-text").value.trim();
  if (!text) return;
  const state = store.getState();
  const analysis = state.board.document.analysis;
  const index = analysis.sessions.findIndex((session) => session.id === analysis.activeSessionId);
  if (index < 0) return;
  const minuteValue = $("#analysis-minute").value;
  const entry = createAnalysisEntry($("#analysis-kind").value, text, {
    matchMinute: minuteValue === "" ? null : Number(minuteValue),
    entityIds: state.selection,
    sceneId: state.board.document.scenes[state.playback.sceneIndex]?.id || null,
  });
  const entries = [...analysis.sessions[index].entries, entry];
  store.update(["board", "document", "analysis", "sessions", index, "entries"], entries, "Añadir anotacion");
  $("#analysis-text").value = "";
  $("#analysis-minute").value = "";
  afterDocumentChange();
}

function removeAnalysisEntry(event) {
  const button = event.target.closest("[data-delete-entry]");
  if (!button) return;
  const state = store.getState();
  const analysis = state.board.document.analysis;
  const index = analysis.sessions.findIndex((session) => session.id === analysis.activeSessionId);
  if (index < 0) return;
  store.update(["board", "document", "analysis", "sessions", index, "entries"], analysis.sessions[index].entries.filter((entry) => entry.id !== button.dataset.deleteEntry), "Eliminar anotacion");
  afterDocumentChange();
}

function openPlayerDialog() {
  const team = store.getState().ui.activeTeam;
  $("#player-form").reset();
  $("#player-number").value = "10";
  $("#player-team").value = team;
  resetAvatarPreview();
  $("#player-dialog").showModal();
  $("#player-name").focus();
}

function closePlayerDialog() {
  $("#player-dialog").close();
  resetAvatarPreview();
}

function previewAvatar(event) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  const file = event.target.files?.[0];
  previewUrl = file ? URL.createObjectURL(file) : null;
  $("#player-avatar-preview").innerHTML = previewUrl ? `<img src="${previewUrl}" alt="Previsualizacion" />` : `<i data-lucide="camera"></i>`;
  refreshIcons();
}

function resetAvatarPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $("#player-avatar-preview").innerHTML = `<i data-lucide="camera"></i>`;
  refreshIcons();
}

async function saveCustomPlayer(event) {
  event.preventDefault();
  const button = $("#save-player-button");
  button.disabled = true;
  try {
    const file = $("#player-avatar").files?.[0];
    if (file && file.size > 8 * 1024 * 1024) throw new Error("La imagen no puede superar 8 MB");
    const uploaded = file ? await tacticsApi.uploadFile(file) : null;
    const player = await tacticsApi.createPlayer({
      name: $("#player-name").value.trim(),
      number: Number($("#player-number").value),
      position: $("#player-position").value,
      team: $("#player-team").value,
      avatarUrl: uploaded?.url || null,
    });
    customRoster.push(player);
    store.setUI({ activeTeam: player.team });
    closePlayerDialog();
    renderRoster();
    toast(`${player.name} añadido a la plantilla`);
  } catch (error) {
    toast(error.message || "No se pudo crear el jugador");
  } finally {
    button.disabled = false;
  }
}

async function deleteCustomPlayer(id) {
  try {
    await tacticsApi.deletePlayer(id);
    customRoster = customRoster.filter((player) => player.id !== id);
    renderRoster();
    toast("Jugador eliminado de la plantilla");
  } catch (error) {
    toast(error.message || "No se pudo eliminar el jugador");
  }
}

function handleShortcut(event) {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
  if (typing) return;
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "s") { event.preventDefault(); saveBoard(true); }
  else if (command && event.key.toLowerCase() === "z" && event.shiftKey) { event.preventDefault(); store.redo(); }
  else if (command && event.key.toLowerCase() === "z") { event.preventDefault(); store.undo(); }
  else if (command && event.key.toLowerCase() === "y") { event.preventDefault(); store.redo(); }
  else if (command && event.key.toLowerCase() === "a") { event.preventDefault(); store.setSelection(store.getState().board.document.entities.map((entity) => entity.id)); }
  else if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); deleteSelection(); }
  else if (event.key === "Escape") store.setSelection([]);
  else if (event.key.toLowerCase() === "f") $("#fit-pitch").click();
  else if (event.key.toLowerCase() === "v") store.setUI({ activeTool: "select" });
  else if (event.key.toLowerCase() === "h") store.setUI({ activeTool: "hand" });
  else if (event.key === "[") activateScene(store.getState().playback.sceneIndex - 1);
  else if (event.key === "]") activateScene(store.getState().playback.sceneIndex + 1);
  else if (event.code === "Space") { event.preventDefault(); playNextScene(); }
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
    const raw = localStorage.getItem(DRAFT_KEY) || localStorage.getItem("koru:tactics:recovery-draft:v1");
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
