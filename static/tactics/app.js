import { tacticsApi } from "./api.js?v=20260830b";
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
} from "./model.js?v=20260830b";
import { Pitch2DInteractions } from "./interactions2d.js?v=20260831d";
import { Pitch2DRenderer } from "./pitch2d.js?v=20260831d";
import { Pitch3DRenderer } from "./pitch3d.js?v=20260831d";
import { createEditorStore } from "./store.js";

const DRAFT_KEY = "koru:tactics:recovery-draft:v2";
const LAST_BOARD_KEY = "koru:tactics:last-board:v1";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const KIND_LABELS = { observation: "Observacion", decision: "Decision", adjustment: "Ajuste", task: "Tarea", outcome: "Resultado" };
const LIVE_EVENT_LABELS = { goal: "Gol KORU", conceded: "Gol rival", substitution: "Cambio", card: "Tarjeta", adjustment: "Ajuste tactico", note: "Nota" };
const AUTO_POSITIONS = {
  home: [[8, 34], [24, 12], [22, 31], [22, 48], [34, 58], [43, 20], [44, 43], [60, 10], [61, 34], [60, 57], [79, 34]],
  away: [[97, 34], [81, 12], [83, 31], [83, 48], [71, 58], [62, 20], [61, 43], [45, 10], [44, 34], [45, 57], [26, 34]],
};
const FORMATION_PRESETS = {
  "4-2-3-1": [["POR", 8, 34], ["LD", 23, 10], ["DFC", 20, 26], ["DFC", 20, 42], ["LI", 23, 58], ["MCD", 38, 25], ["MCD", 38, 43], ["ED", 56, 10], ["MCO", 58, 34], ["EI", 56, 58], ["DC", 78, 34]],
  "4-3-3": [["POR", 8, 34], ["LD", 23, 10], ["DFC", 20, 26], ["DFC", 20, 42], ["LI", 23, 58], ["MC", 40, 18], ["MCD", 37, 34], ["MC", 40, 50], ["ED", 66, 10], ["DC", 72, 34], ["EI", 66, 58]],
  "4-4-2": [["POR", 8, 34], ["LD", 23, 10], ["DFC", 20, 26], ["DFC", 20, 42], ["LI", 23, 58], ["MD", 43, 10], ["MC", 42, 26], ["MC", 42, 42], ["MI", 43, 58], ["DC", 70, 23], ["DC", 70, 45]],
  "3-5-2": [["POR", 8, 34], ["DFC", 21, 18], ["DFC", 18, 34], ["DFC", 21, 50], ["CAD", 42, 8], ["MC", 40, 23], ["MCD", 38, 34], ["MC", 40, 45], ["CAI", 42, 60], ["DC", 70, 23], ["DC", 70, 45]],
  "5-2-1-2": [["POR", 8, 34], ["CAD", 24, 6], ["DFC", 19, 21], ["DFC", 17, 34], ["DFC", 19, 47], ["CAI", 24, 62], ["MC", 40, 25], ["MC", 40, 43], ["MCO", 56, 34], ["DC", 72, 23], ["DC", 72, 45]],
};
const DEFAULT_PRESENTATION_LAYERS = { home: true, away: true, ball: true, names: true, annotations: true, markings: true };

const recoveryDraft = loadRecoveryDraft();
const store = createEditorStore(recoveryDraft || createNewBoard(), Boolean(recoveryDraft));
const renderer = new Pitch2DRenderer($("#pitch-2d-layer"));
const renderer3d = new Pitch3DRenderer($("#pitch-3d-layer"), { onSelection: (selection) => store.setSelection(selection), onMove: commitEntityMove, onMovePreview: queueLivePreview, onAnnotationMove: moveTacticalAnnotation });
let boards = [];
let dashboardRoster = [];
let customRoster = [];
let lineupTemplates = [];
let playTemplates = [];
let matches = [];
let saveTimer = null;
let savePromise = null;
let lastDocumentRevision = -1;
let lastSelectionRenderKey = "";
let lastSceneUiKey = "";
let previewUrl = null;
let playbackFrame = null;
let playbackToken = 0;
let matchReport = null;
let loadedReportMatchId = "";
let matchEvents = [];
let matchCallups = [];
let pathDraft = null;
let liveSocket = null;
let liveSocketBoardId = "";
let liveReconnectTimer = null;
let livePreviewTimer = null;
let pendingLivePositions = null;
let sequenceRecording = false;

new Pitch2DInteractions({
  viewport: $("#pitch-viewport"),
  renderer,
  marquee: $("#selection-marquee"),
  getState: store.getState,
  onSelection: (selection) => store.setSelection(selection),
  onMove: commitEntityMove,
  onMovePreview: queueLivePreview,
  onDropPlayer: (reference, position) => addRosterPlayer(reference.playerKey, position),
  onViewportChange: (patch) => store.setUI(patch),
  onDraw: addTacticalAnnotation,
  onDrawPreview: previewTacticalAnnotation,
  onText: addTextAnnotation,
  onAnnotationMove: moveTacticalAnnotation,
  onAnnotationResize: resizeTacticalAnnotation,
  onPathPoint: addPathPoint,
  onPathPreview: previewPathPoint,
  onCancel: restoreRenderer,
});

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindControls();
  if (window.matchMedia("(max-width: 760px)").matches) store.setUI({ leftCollapsed: true, rightCollapsed: true });
  store.subscribe((state) => {
    render(state);
    queueLivePreview();
  });
  render(store.getState());
  refreshIcons();

  try {
    const [boardResult, dashboardResult, playerResult, templateResult, playResult] = await Promise.allSettled([
      tacticsApi.listBoards(),
      tacticsApi.getDashboard(),
      tacticsApi.listPlayers(),
      tacticsApi.listLineupTemplates(),
      tacticsApi.listPlayTemplates(),
    ]);
    boards = settledValue(boardResult, []);
    customRoster = settledValue(playerResult, []);
    lineupTemplates = settledValue(templateResult, []);
    playTemplates = settledValue(playResult, []);
    const dashboard = settledValue(dashboardResult, {});
    dashboardRoster = dashboard.analytics?.playerElo || dashboard.leaderboards?.scorers || [];
    matches = uniqueMatches([...(dashboard.upcoming || []), ...(dashboard.recent || [])]);
    renderMatchOptions();
    renderLibrary();
    renderLineupTemplates();
    renderPlayTemplateLibrary();
    renderRoster();
    await loadMatchReport(store.getState().board.matchId);

    const requestedId = new URLSearchParams(window.location.search).get("board");
    const rememberedId = localStorage.getItem(LAST_BOARD_KEY);
    const fallbackId = boards.find((board) => board.id === rememberedId)?.id || boards[0]?.id;
    if (requestedId) await openBoard(requestedId);
    else if (!recoveryDraft && fallbackId) await openBoard(fallbackId);
    hydrateRosterAvatars();
  } catch (error) {
    toast(error.message || "No se pudo cargar la pizarra");
  }
}

function settledValue(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function bindControls() {
  $("#board-name").addEventListener("input", (event) => change(["board", "name"], event.target.value, "Renombrar pizarra"));
  $("#board-description").addEventListener("input", (event) => change(["board", "description"], event.target.value, "Editar descripcion"));
  $("#board-category").addEventListener("change", (event) => change(["board", "category"], event.target.value, "Cambiar categoria"));
  $("#pitch-view").addEventListener("change", (event) => change(["board", "document", "pitch", "view"], event.target.value, "Cambiar vista"));
  $("#pitch-orientation").addEventListener("change", (event) => change(["board", "document", "pitch", "orientation"], event.target.value, "Cambiar orientacion"));
  $("#pitch-surface").addEventListener("change", (event) => change(["board", "document", "pitch", "surface"], event.target.value, "Cambiar cesped"));
  $("#board-match").addEventListener("change", bindBoardToMatch);
  $("#save-report-button").addEventListener("click", () => saveMatchReport().catch((error) => toast(error.message || "No se pudo guardar el informe")));
  $("#save-callup-button").addEventListener("click", () => saveMatchCallup().catch((error) => toast(error.message || "No se pudo guardar la disponibilidad")));
  $("#callup-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-callup]");
    if (button) deleteMatchCallup(button.dataset.deleteCallup).catch((error) => toast(error.message || "No se pudo quitar el jugador"));
  });
  $("#live-event-actions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-live-event]");
    if (button) addLiveEvent(button.dataset.liveEvent).catch((error) => toast(error.message || "No se pudo registrar el evento"));
  });
  $("#live-events-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-live-event]");
    if (button) deleteLiveEvent(Number(button.dataset.deleteLiveEvent)).catch((error) => toast(error.message || "No se pudo borrar el evento"));
  });

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

  $$('[data-tool]').forEach((button) => button.addEventListener("click", () => button.dataset.tool === "path" ? enablePathTool() : store.setUI({ activeTool: button.dataset.tool })));
  $("#view-mode-switch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-mode]");
    if (button) setViewMode(button.dataset.viewMode);
  });
  $$('[data-add-entity]').forEach((button) => button.addEventListener("click", () => addEntity(button.dataset.addEntity)));
  $$('[data-collapse]').forEach((button) => button.addEventListener("click", () => togglePanel(button.dataset.collapse)));
  $$('[data-toggle-panel]').forEach((button) => button.addEventListener("click", () => togglePanel(button.dataset.togglePanel, true)));

  $("#fit-pitch").addEventListener("click", () => {
    if (store.getState().ui.viewMode === "3d") renderer3d.resetCamera();
    else store.setUI({ zoom: 1, pan: { x: 0, y: 0 } });
  });
  $("#fullscreen-button").addEventListener("click", toggleFullscreen);
  $("#presentation-button").addEventListener("click", togglePresentationMode);
  $("#lineup-graphic-button").addEventListener("click", openLineupGraphicDialog);
  $("#sequence-export-button").addEventListener("click", () => exportTacticalSequence().catch((error) => toast(error.message || "No se pudo grabar la secuencia")));
  $("#share-viewer-button").addEventListener("click", shareViewerLink);
  $("#close-lineup-graphic-dialog").addEventListener("click", () => $("#lineup-graphic-dialog").close());
  $("#preview-lineup-graphic-button").addEventListener("click", previewLineupGraphic);
  $("#download-lineup-graphic-button").addEventListener("click", () => downloadLineupGraphic().catch((error) => toast(error.message || "No se pudo crear la grafica")));
  $("#open-presentation-button").addEventListener("click", () => setPresentationMode(true));
  $("#exit-presentation-button").addEventListener("click", () => setPresentationMode(false));
  $("#reset-layer-button").addEventListener("click", resetPresentationLayers);
  $("#reset-presentation-layers").addEventListener("click", resetPresentationLayers);
  $$('[data-presentation-layer]').forEach((control) => control.addEventListener("click", () => togglePresentationLayer(control.dataset.presentationLayer)));

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
  $("#export-scene-button").addEventListener("click", () => exportScenePng().catch((error) => toast(error.message || "No se pudo exportar la escena")));
  $("#duplicate-scene-button").addEventListener("click", duplicateActiveScene);
  $("#delete-scene-button").addEventListener("click", deleteActiveScene);
  $("#scene-back-button").addEventListener("click", () => moveActiveScene(-1));
  $("#scene-forward-button").addEventListener("click", () => moveActiveScene(1));
  $("#annotation-list").addEventListener("change", updateAnnotationColor);
  $("#annotation-list").addEventListener("click", handleAnnotationAction);
  $("#path-list").addEventListener("click", handlePathAction);
  $("#path-list").addEventListener("change", updatePathColor);
  $("#finish-path-button").addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); finishPathDraft(); });
  $("#cancel-path-button").addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); cancelPathDraft(); });

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
  $("#save-lineup-template-button").addEventListener("click", openLineupTemplateDialog);
  $("#lineup-template-select").addEventListener("change", renderLineupTemplates);
  $("#load-lineup-template-button").addEventListener("click", loadSelectedLineupTemplate);
  $("#delete-lineup-template-button").addEventListener("click", deleteSelectedLineupTemplate);
  $("#lineup-template-form").addEventListener("submit", saveLineupTemplate);
  $("#apply-formation-button").addEventListener("click", applySelectedFormation);
  $("#save-play-template-button").addEventListener("click", openPlayTemplateDialog);
  $("#play-template-filter").addEventListener("change", renderPlayTemplateLibrary);
  $("#play-template-list").addEventListener("click", handlePlayTemplateAction);
  $("#play-template-form").addEventListener("submit", savePlayTemplate);

  document.addEventListener("keydown", handleShortcut);
  window.addEventListener("beforeunload", persistRecoveryDraft);
  window.addEventListener("beforeunload", closeLiveSocket);
}

async function shareViewerLink() {
  const state = store.getState();
  if (!state.board.id) {
    try { await saveBoard(false); } catch { return; }
  }
  const boardId = store.getState().board.id;
  if (!boardId) return;
  try {
    const result = await tacticsApi.createShareLink(boardId);
    const url = new URL(result.url, window.location.origin).href;
    await navigator.clipboard?.writeText(url);
    toast("Enlace de espectador copiado");
    window.prompt("Enlace de solo lectura", url);
  } catch (error) {
    toast(error.message || "No se pudo crear el enlace");
  }
}

function closeLiveSocket() {
  window.clearTimeout(liveReconnectTimer);
  window.clearTimeout(livePreviewTimer);
  liveReconnectTimer = null;
  livePreviewTimer = null;
  const socket = liveSocket;
  liveSocket = null;
  liveSocketBoardId = "";
  socket?.close();
}

function ensureLiveSocket() {
  const boardId = store.getState().board.id;
  if (!boardId) return null;
  if (liveSocketBoardId === boardId && liveSocket && [WebSocket.CONNECTING, WebSocket.OPEN].includes(liveSocket.readyState)) return liveSocket;
  if (liveSocket) liveSocket.close();
  window.clearTimeout(liveReconnectTimer);
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws/tactical-control/${encodeURIComponent(boardId)}`);
  liveSocket = socket;
  liveSocketBoardId = boardId;
  socket.addEventListener("open", () => queueLivePreview(null, true));
  socket.addEventListener("close", (event) => {
    if (liveSocket !== socket) return;
    liveSocket = null;
    if (event.code !== 1008 && store.getState().board.id === boardId) liveReconnectTimer = window.setTimeout(ensureLiveSocket, 1500);
  });
  socket.addEventListener("error", () => socket.close());
  return socket;
}

function liveBoardPayload(positions = null) {
  const state = store.getState();
  const document = structuredClone(state.board.document);
  if (positions) {
    document.entities = document.entities.map((entity) => positions[entity.id] ? { ...entity, position: positions[entity.id] } : entity);
  }
  document.metadata = { ...(document.metadata || {}), activeSceneIndex: currentSceneIndex(state) };
  const board = boardPayload({ ...state.board, document });
  delete board.version;
  return {
    type: "presentation",
    board,
    presentation: {
      viewMode: state.ui.viewMode,
      sceneIndex: currentSceneIndex(state),
      layers: state.ui.layers,
      playing: state.playback.playing,
    },
  };
}

function queueLivePreview(positions = null, immediate = false) {
  if (positions) pendingLivePositions = { ...(pendingLivePositions || {}), ...positions };
  if (!store.getState().board.id) return;
  const socket = ensureLiveSocket();
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  window.clearTimeout(livePreviewTimer);
  const flush = () => {
    livePreviewTimer = null;
    if (socket !== liveSocket || socket.readyState !== WebSocket.OPEN) return;
    const payload = liveBoardPayload(pendingLivePositions);
    pendingLivePositions = null;
    socket.send(JSON.stringify(payload));
  };
  if (immediate) flush();
  else livePreviewTimer = window.setTimeout(flush, 80);
}

function togglePanel(side, closeOtherOnMobile = false) {
  const state = store.getState();
  const patch = { [`${side}Collapsed`]: !state.ui[`${side}Collapsed`] };
  if (closeOtherOnMobile && window.matchMedia("(max-width: 760px)").matches) patch[`${side === "left" ? "right" : "left"}Collapsed`] = true;
  store.setUI(patch);
}

function setPresentationMode(enabled) {
  if (enabled) {
    playbackToken += 1;
    store.setSelection([]);
    store.setUI({ presentationMode: true, leftCollapsed: true, rightCollapsed: true, activeTool: "hand", zoom: 1, pan: { x: 0, y: 0 } });
  } else store.setUI({ presentationMode: false, activeTool: "select" });
}

function togglePresentationMode() {
  setPresentationMode(!store.getState().ui.presentationMode);
}

function togglePresentationLayer(layer) {
  const layers = store.getState().ui.layers;
  if (!Object.hasOwn(DEFAULT_PRESENTATION_LAYERS, layer)) return;
  store.setUI({ layers: { ...layers, [layer]: layers[layer] === false } });
}

function resetPresentationLayers() {
  store.setUI({ layers: { ...DEFAULT_PRESENTATION_LAYERS } });
  toast("Capas restablecidas");
}

function setViewMode(viewMode) {
  if (!new Set(["2d", "3d"]).has(viewMode) || store.getState().ui.viewMode === viewMode) return;
  if (pathDraft) cancelPathDraft();
  store.setUI({ viewMode, activeTool: "select", zoom: 1, pan: { x: 0, y: 0 } });
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
    renderer.render(board.document, currentScene(state)?.annotations || [], currentScene(state)?.movementPaths || []);
    renderer3d.render(board.document, currentScene(state)?.annotations || [], currentScene(state)?.movementPaths || []);
    lastDocumentRevision = renderKey;
    renderRoster();
    renderAnalysis();
  }
  renderSceneUi(state);
  renderAnnotationList(state);
  renderPathList(state);
  renderer.setSelection(state.selection);
  renderer3d.setSelection(state.selection);
  const selectionRenderKey = `${state.documentRevision}:${state.selection.join("|")}`;
  if (selectionRenderKey !== lastSelectionRenderKey) {
    renderSelection();
    lastSelectionRenderKey = selectionRenderKey;
  }

  document.body.classList.toggle("left-collapsed", ui.leftCollapsed);
  document.body.classList.toggle("right-collapsed", ui.rightCollapsed);
  document.body.classList.toggle("presentation-mode", ui.presentationMode);
  document.body.classList.toggle("view-3d", ui.viewMode === "3d");
  $("#pitch-2d-layer").hidden = ui.viewMode === "3d";
  $("#pitch-3d-layer").hidden = ui.viewMode !== "3d";
  renderer3d.setActive(ui.viewMode === "3d");
  $("#pitch-viewport").dataset.tool = ui.activeTool;
  $("#pitch-shell").style.transform = ui.viewMode === "3d" ? "none" : `translate(${ui.pan.x}px, ${ui.pan.y}px) scale(${ui.zoom})`;
  renderer.setLayers(ui.layers);
  renderer3d.setLayers(ui.layers);
  $$('[data-view-mode]').forEach((button) => {
    const active = button.dataset.viewMode === ui.viewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-tool]').forEach((button) => button.classList.toggle("active", button.dataset.tool === ui.activeTool));
  $$('[data-presentation-layer]').forEach((control) => {
    const visible = ui.layers[control.dataset.presentationLayer] !== false;
    if (control.matches("input")) control.checked = visible;
    else {
      control.classList.toggle("active", visible);
      control.setAttribute("aria-pressed", String(visible));
    }
  });
  $("#presentation-button").classList.toggle("active", ui.presentationMode);
  $("#presentation-button").setAttribute("aria-label", ui.presentationMode ? "Salir de modo presentacion" : "Abrir modo presentacion");
  $("#path-draft-controls").hidden = !pathDraft;
  if (pathDraft) $("#path-draft-label").textContent = `${pathDraft.name}: ${pathDraft.points.length - 1} punto${pathDraft.points.length === 2 ? "" : "s"}`;

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
  $("#zoom-readout").textContent = ui.viewMode === "3d" ? "Camara 3D" : `Zoom ${Math.round(ui.zoom * 100)}%`;
  $("#timeline-time").textContent = formatTimelineTime(state.playback.time);
  renderMatchReport();
  persistRecoveryDraft();
}

function restoreRenderer() {
  const state = store.getState();
  const scene = currentScene(state);
  renderer.render(state.board.document, scene?.annotations || [], scene?.movementPaths || []);
  renderer3d.render(state.board.document, scene?.annotations || [], scene?.movementPaths || []);
  renderer.setSelection(state.selection);
  renderer3d.setSelection(state.selection);
  renderer.setLayers(state.ui.layers);
  renderer3d.setLayers(state.ui.layers);
  queueLivePreview();
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
      localStorage.setItem(LAST_BOARD_KEY, saved.id);
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
  hydrateRosterAvatars();
  await loadMatchReport(board.matchId);
  localStorage.removeItem(DRAFT_KEY);
  history.replaceState(null, "", `/tactics?board=${encodeURIComponent(id)}`);
  localStorage.setItem(LAST_BOARD_KEY, id);
  renderLibrary();
  toast(`Abierta: ${board.name}`);
}

function hydrateRosterAvatars() {
  const state = store.getState();
  const roster = [...rosterPlayers("home"), ...rosterPlayers("away")];
  const byKey = new Map(roster.map((player) => [player.rosterKey, player]));
  const byName = new Map(roster.map((player) => [String(player.username || "").toLowerCase(), player]));
  const changes = state.board.document.entities.flatMap((entity, index) => {
    if (entity.type !== "player" || entity.metadata?.avatarUrl) return [];
    const player = byKey.get(entity.metadata?.rosterKey) || byName.get(String(entity.name || "").toLowerCase());
    if (!player?.avatarUrl) return [];
    return [{
      path: ["board", "document", "entities", index, "metadata"],
      value: { ...entity.metadata, avatarUrl: player.avatarUrl },
    }];
  });
  if (!changes.length) return;
  store.updateMany(changes, "Sincronizar fotos de jugadores");
  afterDocumentChange();
}

async function createBoard() {
  if (store.getState().dirty) {
    try { await saveBoard(false); } catch { return; }
  }
  store.replaceBoard(createNewBoard());
  await loadMatchReport(null);
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

function renderPlayTemplateLibrary() {
  const filter = $("#play-template-filter").value;
  const templates = playTemplates.filter((template) => !filter || template.category === filter);
  $("#play-template-list").innerHTML = templates.length ? templates.map((template) => `
    <article class="play-template-row">
      <div><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.category)}${template.description ? ` · ${escapeHtml(template.description)}` : ""}</small></div>
      <button type="button" data-use-play-template="${template.id}" title="Crear pizarra desde plantilla" aria-label="Usar ${escapeHtml(template.name)}"><i data-lucide="copy-plus"></i></button>
      <button type="button" data-delete-play-template="${template.id}" title="Eliminar de biblioteca" aria-label="Eliminar ${escapeHtml(template.name)}"><i data-lucide="trash-2"></i></button>
    </article>`).join("") : `<div class="compact-empty">No hay jugadas en esta categoría.</div>`;
  refreshIcons();
}

function openPlayTemplateDialog() {
  const board = store.getState().board;
  $("#play-template-form").reset();
  $("#play-template-name").value = board.name === "Nueva pizarra" ? "" : board.name;
  $("#play-template-category").value = board.category || "Ataque";
  $("#play-template-description").value = board.description || "";
  $("#play-template-scenes").value = String(board.document.scenes.length);
  $("#play-template-dialog").showModal();
  $("#play-template-name").focus();
  refreshIcons();
}

function playTemplateDocument() {
  const board = store.getState().board;
  const cleanAnalysis = createNewBoard().document.analysis;
  return {
    ...structuredClone(board.document),
    analysis: cleanAnalysis,
    metadata: {},
  };
}

async function savePlayTemplate(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    $("#play-template-dialog").close();
    return;
  }
  const payload = {
    name: $("#play-template-name").value.trim(),
    category: $("#play-template-category").value,
    description: $("#play-template-description").value.trim(),
    document: playTemplateDocument(),
  };
  if (!payload.name) return;
  const button = $("#confirm-play-template-button");
  button.disabled = true;
  try {
    const template = await tacticsApi.createPlayTemplate(payload);
    playTemplates.unshift({ ...template, document: undefined });
    $("#play-template-dialog").close();
    renderPlayTemplateLibrary();
    toast(`${template.name} guardada en biblioteca`);
  } catch (error) {
    toast(error.message || "No se pudo guardar la jugada");
  } finally {
    button.disabled = false;
  }
}

async function handlePlayTemplateAction(event) {
  const useButton = event.target.closest("[data-use-play-template]");
  if (useButton) {
    await createBoardFromPlayTemplate(useButton.dataset.usePlayTemplate);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-play-template]");
  if (!deleteButton) return;
  const template = playTemplates.find((item) => item.id === deleteButton.dataset.deletePlayTemplate);
  if (!template || !window.confirm(`Eliminar la jugada "${template.name}" de la biblioteca?`)) return;
  try {
    await tacticsApi.deletePlayTemplate(template.id);
    playTemplates = playTemplates.filter((item) => item.id !== template.id);
    renderPlayTemplateLibrary();
    toast("Jugada eliminada de la biblioteca");
  } catch (error) {
    toast(error.message || "No se pudo eliminar la jugada");
  }
}

async function createBoardFromPlayTemplate(templateId) {
  if (store.getState().dirty) {
    try { await saveBoard(false); } catch { return; }
  }
  try {
    const template = await tacticsApi.getPlayTemplate(templateId);
    const base = createNewBoard();
    const board = normalizeBoard({
      ...base,
      name: `${template.name} - copia`,
      description: template.description || "",
      category: template.category,
      document: {
        ...structuredClone(template.document),
        analysis: base.document.analysis,
        metadata: { sourceTemplateId: template.id },
      },
    });
    const saved = await tacticsApi.createBoard(boardPayload(board));
    store.replaceBoard(normalizeBoard(saved));
    await loadMatchReport(null);
    await refreshLibrary();
    history.replaceState(null, "", `/tactics?board=${encodeURIComponent(saved.id)}`);
    localStorage.removeItem(DRAFT_KEY);
    toast(`Nueva pizarra creada desde ${template.name}`);
  } catch (error) {
    toast(error.message || "No se pudo usar la jugada");
  }
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

function renderLineupTemplates() {
  const select = $("#lineup-template-select");
  const selectedId = select.value;
  select.innerHTML = `<option value="">Sin plantilla</option>${lineupTemplates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}${template.formation ? ` · ${escapeHtml(template.formation)}` : ""}</option>`).join("")}`;
  select.value = lineupTemplates.some((template) => template.id === selectedId) ? selectedId : "";
  const hasSelection = Boolean(select.value);
  $("#load-lineup-template-button").disabled = !hasSelection;
  $("#delete-lineup-template-button").disabled = !hasSelection;
  refreshIcons();
}

function homePlayersOnPitch() {
  return store.getState().board.document.entities.filter((entity) => entity.type === "player" && entity.teamId === "home");
}

function openLineupTemplateDialog() {
  const players = homePlayersOnPitch();
  if (!players.length) {
    toast("Coloca al menos un jugador KORU antes de guardar una alineacion");
    return;
  }
  $("#lineup-template-form").reset();
  $("#lineup-template-count").textContent = `${players.length} jugadores KORU se guardaran con su posicion actual.`;
  $("#lineup-template-dialog").showModal();
  $("#lineup-template-name").focus();
  refreshIcons();
}

async function saveLineupTemplate(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    $("#lineup-template-dialog").close();
    return;
  }
  const players = homePlayersOnPitch();
  if (!players.length) return;
  const payload = {
    name: $("#lineup-template-name").value.trim(),
    formation: $("#lineup-template-formation").value.trim(),
    players: players.map((player) => ({
      rosterKey: player.metadata?.rosterKey || `snapshot:${player.name}:${player.number || 0}`,
      name: player.name,
      number: player.number || 0,
      positionLabel: player.positionLabel || null,
      avatarUrl: player.metadata?.avatarUrl || null,
      position: { x: player.position.x, y: player.position.y, z: 0 },
    })),
  };
  if (!payload.name) return;
  const button = $("#confirm-lineup-template-button");
  button.disabled = true;
  try {
    const template = await tacticsApi.createLineupTemplate(payload);
    lineupTemplates.unshift(template);
    $("#lineup-template-dialog").close();
    renderLineupTemplates();
    $("#lineup-template-select").value = template.id;
    renderLineupTemplates();
    toast(`Alineacion ${template.name} guardada`);
  } catch (error) {
    toast(error.message || "No se pudo guardar la alineacion");
  } finally {
    button.disabled = false;
  }
}

function loadSelectedLineupTemplate() {
  const template = lineupTemplates.find((item) => item.id === $("#lineup-template-select").value);
  if (!template) return;
  const state = store.getState();
  const existingHomePlayers = state.board.document.entities.filter((entity) => entity.type === "player" && entity.teamId === "home");
  const existingHomeIds = new Set(existingHomePlayers.map((entity) => entity.id));
  const remainingEntities = state.board.document.entities.filter((entity) => !existingHomeIds.has(entity.id));
  const positions = formationPositionsForLineup(template.players, existingHomePlayers);
  const players = template.players.map((player, index) => createPlayerEntity({
    username: player.name,
    name: player.name,
    number: player.number,
    positionLabel: player.positionLabel,
    rosterKey: player.rosterKey,
    avatarUrl: player.avatarUrl,
    source: "lineup-template",
  }, "home", positions[index], player.number));
  const scenes = state.board.document.scenes.map((scene) => ({
    ...scene,
    entityStates: [...scene.entityStates.filter((item) => !existingHomeIds.has(item.entityId)), ...captureSceneEntityStates(players)],
  }));
  store.updateMany([
    { path: ["board", "document", "entities"], value: [...remainingEntities, ...players] },
    { path: ["board", "document", "scenes"], value: scenes },
  ], `Cargar alineacion ${template.name}`);
  store.setSelection(players.map((player) => player.id));
  afterDocumentChange();
  syncLineupWithTemplate(template, players);
  toast(`${template.name}${template.formation ? ` (${template.formation})` : ""} cargada`);
}

function formationPositionsForLineup(templatePlayers, currentHomePlayers) {
  const slots = currentHomePlayers.filter((player) => player.metadata?.formationSlot);
  if (slots.length !== templatePlayers.length) return templatePlayers.map((player) => player.position);
  const available = [...slots];
  return templatePlayers.map((player) => {
    const matchingIndex = available.findIndex((slot) => slot.positionLabel === player.positionLabel);
    const slot = available.splice(matchingIndex >= 0 ? matchingIndex : 0, 1)[0];
    return slot ? { ...slot.position } : player.position;
  });
}

function syncLineupWithTemplate(template, players) {
  const matchId = store.getState().board.matchId;
  if (!matchId) return;
  const lineup = players.map((player) => player.name);
  matchReport = { ...(matchReport?.matchId === matchId ? matchReport : emptyMatchReport(matchId)), lineup };
  syncValue("#report-lineup", lineup.join("\n"));
  renderMatchReport();
  toast(`${template.name}: convocatoria del informe preparada; guarda el informe para confirmarla`);
}

async function deleteSelectedLineupTemplate() {
  const select = $("#lineup-template-select");
  const template = lineupTemplates.find((item) => item.id === select.value);
  if (!template) return;
  if (!window.confirm(`Eliminar la alineacion "${template.name}"?`)) return;
  try {
    await tacticsApi.deleteLineupTemplate(template.id);
    lineupTemplates = lineupTemplates.filter((item) => item.id !== template.id);
    renderLineupTemplates();
    toast("Alineacion eliminada");
  } catch (error) {
    toast(error.message || "No se pudo eliminar la alineacion");
  }
}

function applySelectedFormation() {
  const formation = $("#formation-select").value;
  const slots = FORMATION_PRESETS[formation];
  if (!slots) return;
  const state = store.getState();
  const currentHomePlayers = state.board.document.entities.filter((entity) => entity.type === "player" && entity.teamId === "home");
  if (currentHomePlayers.length && !window.confirm(`Aplicar ${formation} sustituira los ${currentHomePlayers.length} jugadores KORU del campo por posiciones vacias.`)) return;

  const attackRight = state.board.document.settings.attackDirection !== "right-to-left";
  const placeholders = slots.map(([role, x, y], index) => ({
    id: createTacticalId(),
    type: "player",
    teamId: "home",
    name: role,
    number: null,
    positionLabel: role,
    position: { x: attackRight ? x : 105 - x, y, z: 0 },
    rotation: attackRight ? 90 : 270,
    scale: 1,
    opacity: 0.82,
    locked: false,
    visible: true,
    metadata: { formationSlot: true, formation, slotIndex: index },
  }));
  const oldIds = new Set(currentHomePlayers.map((player) => player.id));
  const entities = [...state.board.document.entities.filter((entity) => !oldIds.has(entity.id)), ...placeholders];
  const scenes = state.board.document.scenes.map((scene) => ({
    ...scene,
    entityStates: [...scene.entityStates.filter((item) => !oldIds.has(item.entityId)), ...captureSceneEntityStates(placeholders)],
  }));
  store.updateMany([
    { path: ["board", "document", "entities"], value: entities },
    { path: ["board", "document", "scenes"], value: scenes },
    { path: ["board", "document", "metadata"], value: { ...state.board.document.metadata, formation } },
  ], `Aplicar formacion ${formation}`);
  store.setSelection(placeholders.map((item) => item.id));
  afterDocumentChange();
  toast(`${formation} aplicada. Carga una alineacion para asignar jugadores.`);
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
  $("#export-scene-button").disabled = state.playback.playing;
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
  store.update(["board", "document", "metadata", "activeSceneIndex"], index, "Cambiar escena compartida");
  afterDocumentChange();
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

async function exportScenePng() {
  if (store.getState().ui.viewMode === "3d") {
    const png = await new Promise((resolve, reject) => renderer3d.webgl.domElement.toBlob((output) => output ? resolve(output) : reject(new Error("No se pudo crear el PNG 3D")), "image/png"));
    downloadBlob(png, `${exportFilename()}-3d.png`);
    toast("Escena 3D exportada como PNG");
    return;
  }
  const source = renderer.svg;
  if (!source) throw new Error("No hay campo para exportar");
  const selectedElements = [...source.querySelectorAll(".selected")];
  selectedElements.forEach((element) => element.classList.remove("selected"));
  const clone = source.cloneNode(true);
  inlineSvgStyles(source, clone);
  selectedElements.forEach((element) => element.classList.add("selected"));
  clone.querySelectorAll(".annotation-handle-layer").forEach((element) => element.remove());

  const viewBox = source.viewBox.baseVal;
  const width = 1920;
  const height = Math.max(720, Math.round(width * viewBox.height / viewBox.width));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const filename = exportFilename();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("No se pudo preparar la imagen"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#0b0d11";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const png = await new Promise((resolve, reject) => canvas.toBlob((output) => output ? resolve(output) : reject(new Error("No se pudo crear el PNG")), "image/png"));
    downloadBlob(png, `${filename}.png`);
    toast("Escena exportada como PNG");
  } catch (error) {
    downloadBlob(blob, `${filename}.svg`);
    toast("La escena se ha descargado como SVG");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function preferredRecordingType() {
  if (!window.MediaRecorder) return "";
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]
    .find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function animateRecordedTransition(startEntities, targetEntities, duration, transition) {
  const startedAt = performance.now();
  await new Promise((resolve) => {
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = easing(progress, transition);
      const positions = Object.fromEntries(targetEntities.map((target, index) => {
        const start = startEntities[index] || target;
        return [target.id, {
          x: start.position.x + (target.position.x - start.position.x) * eased,
          y: start.position.y + (target.position.y - start.position.y) * eased,
          z: start.position.z + (target.position.z - start.position.z) * eased,
        }];
      }));
      renderer3d.previewEntityPositions(positions);
      if (progress < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

function exportSequenceJson() {
  const state = store.getState();
  const payload = {
    exportedAt: new Date().toISOString(),
    format: "koru-tactical-sequence",
    version: 1,
    board: boardPayload(state.board),
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `${exportFilename()}-secuencia.json`);
  toast("El navegador no graba video; se ha exportado la secuencia JSON");
}

async function exportTacticalSequence() {
  if (sequenceRecording) return;
  const initialState = store.getState();
  const scenes = structuredClone(initialState.board.document.scenes || []);
  if (scenes.length < 2) {
    toast("Crea al menos dos escenas para grabar una secuencia");
    return;
  }
  const mimeType = preferredRecordingType();
  const canvas = renderer3d.webgl.domElement;
  if (!mimeType || typeof canvas.captureStream !== "function") {
    exportSequenceJson();
    return;
  }

  sequenceRecording = true;
  const button = $("#sequence-export-button");
  button.disabled = true;
  button.classList.add("recording");
  const previousUi = {
    viewMode: initialState.ui.viewMode,
    presentationMode: initialState.ui.presentationMode,
    leftCollapsed: initialState.ui.leftCollapsed,
    rightCollapsed: initialState.ui.rightCollapsed,
    activeTool: initialState.ui.activeTool,
  };
  const previousSelection = [...initialState.selection];
  let stream;
  try {
    store.setSelection([]);
    store.setUI({ viewMode: "3d", presentationMode: true, leftCollapsed: true, rightCollapsed: true, activeTool: "hand" });
    await nextAnimationFrame();
    await nextAnimationFrame();
    renderer3d.resetCamera();

    const chunks = [];
    stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener("stop", resolve, { once: true });
      recorder.addEventListener("error", () => reject(recorder.error || new Error("Fallo al grabar")), { once: true });
    });

    const documentData = structuredClone(initialState.board.document);
    let activeEntities = applySceneToEntities(documentData.entities, scenes[0]);
    documentData.entities = activeEntities;
    renderer3d.render(documentData, scenes[0].annotations || [], scenes[0].movementPaths || []);
    renderer3d.setLayers(initialState.ui.layers);
    recorder.start(250);
    toast("Grabando secuencia tactica...");
    await wait(650);

    for (let index = 1; index < scenes.length; index += 1) {
      const targetEntities = applySceneToEntities(activeEntities, scenes[index]);
      renderer3d.render({ ...documentData, entities: activeEntities }, scenes[index].annotations || [], scenes[index].movementPaths || []);
      renderer3d.setLayers(initialState.ui.layers);
      const speed = Math.max(0.25, Number(documentData.timeline?.speed || 1));
      const duration = Math.max(500, Number(scenes[index].duration || 3) * 1000 / speed);
      await animateRecordedTransition(activeEntities, targetEntities, duration, scenes[index].transition);
      activeEntities = targetEntities;
      await wait(350);
    }
    await wait(650);
    recorder.stop();
    await stopped;
    const extension = mimeType.includes("mp4") ? "mp4" : "webm";
    downloadBlob(new Blob(chunks, { type: mimeType }), `${exportFilename()}-secuencia.${extension}`);
    toast("Secuencia tactica exportada");
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    sequenceRecording = false;
    button.disabled = false;
    button.classList.remove("recording");
    store.setUI(previousUi);
    store.setSelection(previousSelection);
    restoreRenderer();
  }
}

function inlineSvgStyles(source, clone) {
  const properties = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "font-family", "font-size", "font-weight", "paint-order", "stroke-linejoin", "opacity", "visibility", "display"];
  const sourceNodes = [source, ...source.querySelectorAll("*")];
  const cloneNodes = [clone, ...clone.querySelectorAll("*")];
  sourceNodes.forEach((node, index) => {
    const target = cloneNodes[index];
    if (!target) return;
    const styles = getComputedStyle(node);
    const declaration = properties.map((property) => `${property}:${styles.getPropertyValue(property)}`).join(";");
    target.setAttribute("style", declaration);
  });
}

function exportFilename() {
  const board = store.getState().board;
  const scene = currentScene();
  const clean = (value) => String(value || "escena").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${clean(board.name)}-${clean(scene?.name) || "escena"}`;
}

function graphicLineupPlayers() {
  return store.getState().board.document.entities.filter((entity) => entity.type === "player" && entity.teamId === "home" && entity.visible);
}

function openLineupGraphicDialog() {
  const players = graphicLineupPlayers();
  if (!players.length) return toast("Coloca al menos un jugador KORU en el campo");
  const match = selectedMatch();
  $("#graphic-opponent").value = match?.opponent || matchReport?.opponent || "";
  $("#graphic-competition").value = match?.platform || matchReport?.competition || "";
  $("#graphic-formation").value = store.getState().board.document.metadata?.formation || "";
  $("#graphic-bench").value = "";
  $("#graphic-lineup-count").textContent = `${players.length} jugadores KORU del campo apareceran en la ficha.`;
  $("#lineup-graphic-dialog").showModal();
  $("#graphic-opponent").focus();
}

function lineupGraphicSvg() {
  const players = graphicLineupPlayers();
  const pitch = store.getState().board.document.pitch;
  const opponent = escapeHtml($("#graphic-opponent").value.trim() || "PROXIMO RIVAL");
  const competition = escapeHtml($("#graphic-competition").value.trim() || "KORU eCLUB");
  const formation = escapeHtml($("#graphic-formation").value.trim() || "ONCE TITULAR");
  const bench = $("#graphic-bench").value.split("\n").map((item) => item.trim()).filter(Boolean).slice(0, 9);
  const cards = players.map((player) => {
    const x = 400 + (player.position.x / pitch.width) * 1120;
    const y = 225 + (player.position.y / pitch.height) * 690;
    const name = escapeHtml(player.name || "KORU");
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle r="34" fill="#f7f8fb" stroke="#f95516" stroke-width="7"/><text y="8" text-anchor="middle" fill="#16181e" font-size="26" font-weight="900">${player.number ?? ""}</text><text y="60" text-anchor="middle" fill="#fff" font-size="20" font-weight="900" paint-order="stroke" stroke="#101217" stroke-width="6">${name}</text></g>`;
  }).join("");
  const benchText = bench.length ? bench.map((name, index) => `<text x="80" y="${870 + index * 28}" fill="#dce1e9" font-size="20">${index + 1}. ${escapeHtml(name)}</text>`).join("") : `<text x="80" y="870" fill="#77808d" font-size="20">Banquillo por confirmar</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#0b0d11"/><rect x="40" y="40" width="1840" height="1000" rx="18" fill="#12161c" stroke="#2b313b"/><text x="80" y="115" fill="#f95516" font-size="26" font-family="Arial" font-weight="900">KORU eCLUB</text><text x="80" y="175" fill="#fff" font-size="52" font-family="Arial" font-weight="900">ONCE TITULAR</text><text x="80" y="215" fill="#aab2bf" font-size="25" font-family="Arial">${competition} · vs ${opponent}</text><text x="1730" y="120" text-anchor="end" fill="#f95516" font-size="38" font-family="Arial" font-weight="900">${formation}</text><rect x="350" y="130" width="1230" height="850" rx="12" fill="#1d6b43"/><g opacity=".32" stroke="#d9f1df" fill="none" stroke-width="3"><rect x="380" y="160" width="1170" height="790"/><line x1="965" y1="160" x2="965" y2="950"/><circle cx="965" cy="555" r="105"/><rect x="380" y="405" width="170" height="300"/><rect x="1380" y="405" width="170" height="300"/></g><text x="80" y="820" fill="#f95516" font-size="20" font-family="Arial" font-weight="900">BANQUILLO</text>${benchText}${cards}<text x="1840" y="1000" text-anchor="end" fill="#77808d" font-size="18" font-family="Arial">KORU eCLUB · FC26 PRO CLUBS</text></svg>`;
}

function previewLineupGraphic() {
  const blob = new Blob([lineupGraphicSvg()], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function downloadLineupGraphic() {
  const svg = lineupGraphicSvg();
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement("canvas"); canvas.width = 1920; canvas.height = 1080;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const png = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("No se pudo crear PNG")), "image/png"));
    downloadBlob(png, `${exportFilename()}-alineacion.png`);
    $("#lineup-graphic-dialog").close();
    toast("Alineacion descargada como PNG");
  } catch {
    downloadBlob(blob, `${exportFilename()}-alineacion.svg`);
    toast("Alineacion descargada como SVG");
  } finally { URL.revokeObjectURL(url); }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

function previewTacticalAnnotation(type, start, end) {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 0.2) return;
  renderer.setAnnotationDraft({
    id: "draft-annotation",
    type,
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    color: type === "arrow" ? "#f95516" : "#f955164d",
  });
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

function enablePathTool() {
  const state = store.getState();
  const selected = state.selection.map((id) => state.board.document.entities.find((entity) => entity.id === id)).filter(Boolean);
  if (selected.length !== 1 || !["player", "ball"].includes(selected[0].type)) {
    toast("Selecciona un jugador o el balon antes de dibujar una trayectoria");
    return;
  }
  store.setUI({ activeTool: "path" });
  toast("Marca los puntos en el campo y confirma la trayectoria");
}

function addPathPoint(point) {
  const state = store.getState();
  if (!pathDraft) {
    const entity = state.selection.map((id) => state.board.document.entities.find((item) => item.id === id)).find(Boolean);
    if (!entity || !["player", "ball"].includes(entity.type)) return enablePathTool();
    pathDraft = {
      entityId: entity.id,
      name: entity.name || (entity.type === "ball" ? "Balon" : "Jugador"),
      color: entity.type === "ball" ? "#f7f8fb" : entity.teamId === "home" ? "#f95516" : "#12d6df",
      points: [{ ...entity.position }, { x: point.x, y: point.y, z: 0 }],
    };
  } else if (pathDraft.points.length < 24) pathDraft = { ...pathDraft, points: [...pathDraft.points, { x: point.x, y: point.y, z: 0 }] };
  renderer.setMovementPathDraft(pathDraft);
  render(store.getState());
}

function previewPathPoint(point) {
  if (!pathDraft) return;
  renderer.setMovementPathDraft({ ...pathDraft, points: [...pathDraft.points, { x: point.x, y: point.y, z: 0 }] });
}

function finishPathDraft() {
  if (!pathDraft || pathDraft.points.length < 2) return;
  const state = store.getState();
  const index = currentSceneIndex(state);
  const path = { id: createTacticalId(), entityId: pathDraft.entityId, points: pathDraft.points, color: pathDraft.color, label: "" };
  store.update(["board", "document", "scenes", index, "movementPaths"], [...(currentScene(state).movementPaths || []), path], "Crear trayectoria");
  pathDraft = null;
  store.setUI({ activeTool: "select" });
  afterDocumentChange();
  toast("Trayectoria guardada en esta escena");
}

function cancelPathDraft() {
  pathDraft = null;
  renderer.setMovementPathDraft(null);
  store.setUI({ activeTool: "select" });
}

function renderPathList(state) {
  const paths = currentScene(state)?.movementPaths || [];
  $("#path-count").textContent = String(paths.length);
  $("#path-list").innerHTML = paths.length ? paths.map((path, index) => {
    const entity = state.board.document.entities.find((item) => item.id === path.entityId);
    const label = path.label || entity?.name || `Trayectoria ${index + 1}`;
    return `<div class="path-row"><i data-lucide="route"></i><strong>${escapeHtml(label)}</strong><small>${path.points.length - 1} punto${path.points.length === 2 ? "" : "s"}</small><input type="color" value="${escapeHtml(path.color)}" data-path-color="${path.id}" aria-label="Color de ${escapeHtml(label)}" /><button type="button" data-delete-path="${path.id}" aria-label="Eliminar trayectoria" title="Eliminar trayectoria"><i data-lucide="trash-2"></i></button></div>`;
  }).join("") : `<div class="compact-empty">Selecciona un jugador, pulsa ruta y marca su recorrido.</div>`;
  refreshIcons();
}

function updatePathColor(event) {
  const input = event.target.closest("[data-path-color]");
  if (!input) return;
  const state = store.getState();
  const index = currentSceneIndex(state);
  const paths = currentScene(state).movementPaths.map((path) => path.id === input.dataset.pathColor ? { ...path, color: input.value } : path);
  store.update(["board", "document", "scenes", index, "movementPaths"], paths, "Cambiar color de trayectoria");
  afterDocumentChange();
}

function handlePathAction(event) {
  const button = event.target.closest("[data-delete-path]");
  if (!button) return;
  const state = store.getState();
  const index = currentSceneIndex(state);
  store.update(["board", "document", "scenes", index, "movementPaths"], currentScene(state).movementPaths.filter((path) => path.id !== button.dataset.deletePath), "Eliminar trayectoria");
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

function resizeTacticalAnnotation(id, handle, position) {
  const state = store.getState();
  const index = currentSceneIndex(state);
  const pitch = state.board.document.pitch;
  const point = { x: Math.max(0, Math.min(pitch.width, position.x)), y: Math.max(0, Math.min(pitch.height, position.y)) };
  const annotations = state.board.document.scenes[index].annotations.map((annotation) => {
    if (annotation.id !== id || annotation.type === "text") return annotation;
    return { ...annotation, [handle === "start" ? "start" : "end"]: point };
  });
  store.update(["board", "document", "scenes", index, "annotations"], annotations, "Ajustar anotacion");
  afterDocumentChange();
}

function renderAnnotationList(state) {
  const annotations = currentScene(state)?.annotations || [];
  $("#annotation-count").textContent = String(annotations.length);
  $("#annotation-list").innerHTML = annotations.length ? annotations.map((annotation, index) => {
    const label = annotation.type === "arrow" ? `Flecha ${index + 1}` : annotation.type === "zone" ? `Zona ${index + 1}` : annotation.text || `Texto ${index + 1}`;
    const icon = annotation.type === "arrow" ? "move-up-right" : annotation.type === "zone" ? "square-dashed" : "type";
    return `<div class="annotation-row${state.selection.includes(annotation.id) ? " active" : ""}" data-annotation-row="${annotation.id}"><i data-lucide="${icon}"></i><strong>${escapeHtml(label)}</strong><input type="color" value="${escapeHtml(annotation.color || "#f95516")}" data-annotation-color="${annotation.id}" aria-label="Color de ${escapeHtml(label)}" /><button type="button" class="annotation-duplicate" data-duplicate-annotation="${annotation.id}" title="Duplicar anotacion" aria-label="Duplicar anotacion"><i data-lucide="copy"></i></button><button type="button" class="annotation-edit" data-edit-annotation="${annotation.id}" title="Editar texto" aria-label="Editar texto"${annotation.type === "text" ? "" : " hidden"}><i data-lucide="pencil"></i></button><button type="button" class="annotation-delete" data-delete-annotation="${annotation.id}" title="Eliminar anotacion" aria-label="Eliminar anotacion"><i data-lucide="trash-2"></i></button></div>`;
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
  const duplicateButton = event.target.closest("[data-duplicate-annotation]");
  const row = event.target.closest("[data-annotation-row]");
  if (!deleteButton && !editButton && !duplicateButton) {
    if (row && !event.target.closest("input")) {
      const id = row.dataset.annotationRow;
      const selection = store.getState().selection;
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      store.setSelection(additive ? (selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id]) : [id]);
    }
    return;
  }
  const action = deleteButton || editButton || duplicateButton;
  const id = action.dataset.deleteAnnotation || action.dataset.editAnnotation || action.dataset.duplicateAnnotation;
  const state = store.getState();
  const index = currentSceneIndex(state);
  const current = state.board.document.scenes[index].annotations || [];
  if (duplicateButton) {
    const source = current.find((annotation) => annotation.id === id);
    if (!source) return;
    const move = (point) => ({ x: Math.min(state.board.document.pitch.width, point.x + 2), y: Math.min(state.board.document.pitch.height, point.y + 2) });
    const copy = source.type === "text"
      ? { ...source, id: createTacticalId(), position: move(source.position) }
      : { ...source, id: createTacticalId(), start: move(source.start), end: move(source.end) };
    store.update(["board", "document", "scenes", index, "annotations"], [...current, copy], "Duplicar anotacion");
    store.setSelection([copy.id]);
    afterDocumentChange();
    return;
  }
  if (deleteButton) {
    store.update(["board", "document", "scenes", index, "annotations"], current.filter((annotation) => annotation.id !== id), "Eliminar anotacion");
    if (state.selection.includes(id)) store.setSelection([]);
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
    renderer3d.previewEntityPositions(positions);
    queueLivePreview(positions);
    store.setPlayback({ time: (now - startedAt) / 1000 });
    if (progress < 1) playbackFrame = requestAnimationFrame(tick);
    else {
      playbackFrame = null;
      const hasNext = targetIndex < scenes.length - 1;
      store.applyScene(targetIndex, targetEntities, { playing: hasNext, time: 0 });
      store.update(["board", "document", "metadata", "activeSceneIndex"], targetIndex, "Actualizar escena compartida");
      afterDocumentChange();
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
    const positions = Object.fromEntries(entities.map((entity) => [entity.id, entity.position]));
    renderer.previewEntityPositions(positions);
    renderer3d.previewEntityPositions(positions);
    queueLivePreview(positions, true);
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
  const sessions = document.analysis.sessions.map((session) => ({
    ...session,
    entries: session.entries.map((entry) => ({ ...entry, entityIds: entry.entityIds.filter((id) => !selected.has(id)) })),
  }));
  store.updateMany([
    { path: ["board", "document", "entities"], value: document.entities.filter((entity) => !selected.has(entity.id)) },
    { path: ["board", "document", "groups"], value: document.groups.map((group) => ({ ...group, entityIds: group.entityIds.filter((id) => !selected.has(id)) })) },
    { path: ["board", "document", "scenes"], value: document.scenes.map((scene, index) => ({
      ...scene,
      entityStates: scene.entityStates.filter((item) => !selected.has(item.entityId)),
      annotations: index === sceneIndex ? (scene.annotations || []).filter((annotation) => !selectedAnnotations.has(annotation.id)) : scene.annotations,
    })) },
    { path: ["board", "document", "analysis", "sessions"], value: sessions },
  ], "Eliminar seleccion");
  store.setSelection([]);
  afterDocumentChange();
}

function renderSelection() {
  const state = store.getState();
  const entities = state.selection.map((id) => state.board.document.entities.find((entity) => entity.id === id)).filter(Boolean);
  const annotations = (currentScene(state)?.annotations || []).filter((item) => state.selection.includes(item.id));
  const annotation = annotations[0];
  const selectedCount = entities.length + annotations.length;
  $("#selection-section").hidden = !selectedCount;
  if (selectedCount > 1) {
    const labels = [...entities.map((entity) => entity.name || entity.type), ...annotations.map((item) => item.type === "arrow" ? "Flecha" : item.type === "zone" ? "Zona" : item.text || "Texto")];
    $("#selection-summary").textContent = `${selectedCount} objetos`;
    $("#selection-detail").innerHTML = `<strong>Seleccion multiple</strong><small>${labels.map(escapeHtml).join(", ")}</small>`;
    return;
  }
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
  loadMatchReport(matchId).catch((error) => toast(error.message || "No se pudo cargar el informe"));
}

function selectedMatch(matchId = store.getState().board.matchId) {
  return matches.find((match) => match.id === matchId) || null;
}

function emptyMatchReport(matchId) {
  const match = selectedMatch(matchId);
  return {
    matchId,
    opponent: match?.opponent || "",
    competition: match?.platform || "",
    matchDate: match?.datetime || null,
    status: match?.status === "complete" ? "post-match" : "pre-match",
    scoreFor: match?.scoreFor ?? null,
    scoreAgainst: match?.scoreAgainst ?? null,
    lineup: [],
    summary: "",
    takeaways: "",
    tags: [],
  };
}

async function loadMatchReport(matchId) {
  loadedReportMatchId = matchId || "";
  if (!matchId) {
    matchReport = null;
    matchEvents = [];
    matchCallups = [];
    renderMatchReport();
    return;
  }
  matchReport = emptyMatchReport(matchId);
  matchCallups = [];
  renderMatchReport();
  try {
    const report = await tacticsApi.getMatchReport(matchId);
    if (loadedReportMatchId === matchId) {
      matchReport = report;
      renderMatchReport();
    }
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  try {
    const events = await tacticsApi.listMatchEvents(matchId);
    if (loadedReportMatchId === matchId) {
      matchEvents = events;
      renderMatchReport();
    }
  } catch (error) {
    toast(error.message || "No se pudo cargar el registro en directo");
  }
  try {
    const callups = await tacticsApi.listMatchCallups(matchId);
    if (loadedReportMatchId === matchId) {
      matchCallups = callups;
      renderMatchReport();
    }
  } catch (error) {
    toast(error.message || "No se pudo cargar la convocatoria");
  }
}

function renderMatchReport() {
  const matchId = store.getState().board.matchId;
  const visible = Boolean(matchId);
  $("#match-report-empty").hidden = visible;
  $("#match-report-fields").hidden = !visible;
  $("#callup-empty").hidden = visible;
  $("#callup-fields").hidden = !visible;
  $("#live-events-fields").hidden = !visible;
  $("#live-events-count").textContent = String(matchEvents.length);
  if (!visible) {
    $("#match-report-meta").textContent = "Sin vincular";
    $("#callup-count").textContent = "0";
    return;
  }
  const report = matchReport?.matchId === matchId ? matchReport : emptyMatchReport(matchId);
  $("#match-report-meta").textContent = [report.competition, report.opponent].filter(Boolean).join(" · ") || "Partido vinculado";
  syncValue("#report-status", report.status || "pre-match");
  syncValue("#report-score-for", report.scoreFor ?? "");
  syncValue("#report-score-against", report.scoreAgainst ?? "");
  syncValue("#report-lineup", (report.lineup || []).join("\n"));
  syncValue("#report-summary", report.summary || "");
  syncValue("#report-takeaways", report.takeaways || "");
  syncValue("#report-tags", (report.tags || []).join(", "));
  $("#live-events-list").innerHTML = matchEvents.length ? matchEvents.slice(0, 8).map((item) => `<article class="live-event-row" data-type="${escapeHtml(item.type)}"><span>${item.minute === null || item.minute === undefined ? "--" : `${item.minute}'`}</span><strong>${LIVE_EVENT_LABELS[item.type] || item.type}</strong><small>${escapeHtml(item.note || "")}</small><button type="button" data-delete-live-event="${item.id}" title="Borrar evento" aria-label="Borrar evento"><i data-lucide="x"></i></button></article>`).join("") : `<div class="compact-empty">Sin eventos registrados.</div>`;
  renderMatchCallups();
  refreshIcons();
}

function renderMatchCallups() {
  const select = $("#callup-player");
  const selected = select.value;
  const players = [...new Map(rosterPlayers("home").map((player) => [player.rosterKey, player])).values()];
  select.innerHTML = players.length ? players.map((player) => `<option value="${escapeHtml(player.rosterKey)}">${escapeHtml(player.username)} · ${String(player.number ?? 0).padStart(2, "0")}</option>`).join("") : `<option value="">Sin jugadores KORU</option>`;
  select.value = players.some((player) => player.rosterKey === selected) ? selected : (players[0]?.rosterKey || "");
  $("#save-callup-button").disabled = !players.length;
  $("#callup-count").textContent = String(matchCallups.length);
  const labels = { available: "Disponible", doubtful: "Duda", unavailable: "No disponible", called: "Convocado" };
  $("#callup-list").innerHTML = matchCallups.length ? matchCallups.map((item) => `<article class="callup-row" data-status="${escapeHtml(item.status)}"><div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(labels[item.status] || item.status)}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</small></div><small>${String(item.number ?? 0).padStart(2, "0")}</small><button type="button" data-delete-callup="${escapeHtml(item.rosterKey)}" title="Quitar de convocatoria" aria-label="Quitar de convocatoria"><i data-lucide="x"></i></button></article>`).join("") : `<div class="compact-empty">Aun no hay respuestas.</div>`;
}

async function saveMatchCallup() {
  const matchId = store.getState().board.matchId;
  const player = findRosterPlayer($("#callup-player").value);
  if (!matchId || !player) return toast("Vincula un partido y elige un jugador");
  const callup = await tacticsApi.upsertMatchCallup(matchId, {
    rosterKey: player.rosterKey,
    name: player.username,
    number: Number(player.number || 0),
    status: $("#callup-status").value,
    note: $("#callup-note").value.trim(),
  });
  matchCallups = [callup, ...matchCallups.filter((item) => item.rosterKey !== callup.rosterKey)];
  $("#callup-note").value = "";
  renderMatchReport();
  toast(`${callup.name}: disponibilidad guardada`);
}

async function deleteMatchCallup(rosterKey) {
  const matchId = store.getState().board.matchId;
  if (!matchId) return;
  await tacticsApi.deleteMatchCallup(matchId, rosterKey);
  matchCallups = matchCallups.filter((item) => item.rosterKey !== rosterKey);
  renderMatchReport();
}

function optionalScore(selector) {
  const value = $(selector).value.trim();
  return value === "" ? null : Number(value);
}

async function saveMatchReport() {
  const matchId = store.getState().board.matchId;
  if (!matchId) {
    toast("Vincula primero un partido");
    return;
  }
  const base = matchReport?.matchId === matchId ? matchReport : emptyMatchReport(matchId);
  const payload = {
    matchId,
    opponent: base.opponent || "",
    competition: base.competition || "",
    matchDate: base.matchDate || null,
    status: $("#report-status").value,
    scoreFor: optionalScore("#report-score-for"),
    scoreAgainst: optionalScore("#report-score-against"),
    lineup: $("#report-lineup").value.split("\n").map((item) => item.trim()).filter(Boolean),
    summary: $("#report-summary").value.trim(),
    takeaways: $("#report-takeaways").value.trim(),
    tags: $("#report-tags").value.split(",").map((item) => item.trim()).filter(Boolean),
  };
  matchReport = await tacticsApi.upsertMatchReport(matchId, payload);
  renderMatchReport();
  toast("Informe de partido guardado");
}

async function addLiveEvent(type) {
  const matchId = store.getState().board.matchId;
  if (!matchId) return toast("Vincula primero un partido");
  const minuteValue = $("#live-minute").value.trim();
  const event = await tacticsApi.createMatchEvent(matchId, {
    type,
    minute: minuteValue === "" ? null : Number(minuteValue),
    note: $("#live-event-note").value.trim(),
  });
  matchEvents = [event, ...matchEvents];
  $("#live-event-note").value = "";
  renderMatchReport();
  toast(`${LIVE_EVENT_LABELS[type]} registrado`);
}

async function deleteLiveEvent(eventId) {
  const matchId = store.getState().board.matchId;
  if (!matchId) return;
  await tacticsApi.deleteMatchEvent(matchId, eventId);
  matchEvents = matchEvents.filter((item) => item.id !== eventId);
  renderMatchReport();
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
  else if (event.key === "Escape") {
    if (pathDraft) cancelPathDraft();
    else if (store.getState().ui.presentationMode) setPresentationMode(false);
    else store.setSelection([]);
  }
  else if (event.key === "Enter" && pathDraft) { event.preventDefault(); finishPathDraft(); }
  else if (event.key.toLowerCase() === "p") togglePresentationMode();
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
