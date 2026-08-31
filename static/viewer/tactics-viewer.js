import { normalizeBoard } from "/static/tactics/model.js?v=20260830b";
import { Pitch2DRenderer } from "/static/tactics/pitch2d.js?v=20260831d";
import { Pitch3DRenderer } from "/static/tactics/pitch3d.js?v=20260831d";

const token = decodeURIComponent(window.location.pathname.split("/").pop() || "");
const layer2d = document.querySelector("#viewer-pitch-2d");
const layer3d = document.querySelector("#viewer-pitch-3d");
const pitch2d = new Pitch2DRenderer(layer2d);
const pitch3d = new Pitch3DRenderer(layer3d, { interactive: false });
const defaultLayers = { home: true, away: true, ball: true, names: true, annotations: true, markings: true };
let board = null;
let renderedSignature = "";
let currentIndex = 0;
let viewMode = "2d";
let followPresenter = true;
let layers = { ...defaultLayers };
let socket;
let reconnectTimer;
let lastMessageAt = 0;

pitch3d.setActive(false);

function sceneFor(activeBoard, index) {
  return activeBoard.document.scenes[index] || activeBoard.document.scenes[0];
}

function structuralSignature(activeBoard, index) {
  return JSON.stringify([
    activeBoard.name,
    activeBoard.document.pitch,
    activeBoard.document.teams,
    activeBoard.document.settings,
    activeBoard.document.entities.map(({ position: _position, ...entity }) => entity),
    activeBoard.document.scenes,
    index,
  ]);
}

function renderBoard(rawBoard, presentation = null) {
  board = normalizeBoard(rawBoard);
  const requestedIndex = presentation?.sceneIndex ?? board.document.metadata?.activeSceneIndex ?? 0;
  currentIndex = Math.min(Number(requestedIndex || 0), Math.max(0, board.document.scenes.length - 1));
  layers = { ...defaultLayers, ...(presentation?.layers || layers) };
  const nextSignature = structuralSignature(board, currentIndex);
  const positions = Object.fromEntries(board.document.entities.map((entity) => [entity.id, entity.position]));
  if (nextSignature !== renderedSignature) {
    renderedSignature = nextSignature;
    const activeScene = sceneFor(board, currentIndex);
    pitch2d.render(board.document, activeScene?.annotations || [], activeScene?.movementPaths || []);
    pitch3d.render(board.document, activeScene?.annotations || [], activeScene?.movementPaths || []);
  } else {
    pitch2d.previewEntityPositions(positions);
    pitch3d.previewEntityPositions(positions);
  }
  pitch2d.setLayers(layers);
  pitch3d.setLayers(layers);
  document.querySelector("#board-title").textContent = board.name;
  if (followPresenter && presentation?.viewMode) setViewMode(presentation.viewMode, false);
  document.querySelector("#viewer-status").textContent = `${presentation?.playing ? "Reproduciendo" : "En directo"} · Escena ${currentIndex + 1} de ${board.document.scenes.length}`;
}

function setViewMode(nextMode, manual = true) {
  if (!["2d", "3d"].includes(nextMode)) return;
  viewMode = nextMode;
  if (manual) setFollowPresenter(false);
  layer2d.hidden = viewMode !== "2d";
  layer3d.hidden = viewMode !== "3d";
  pitch3d.setActive(viewMode === "3d");
  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    const active = button.dataset.viewMode === viewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setFollowPresenter(enabled) {
  followPresenter = enabled;
  const button = document.querySelector("#follow-presenter");
  button.setAttribute("aria-pressed", String(enabled));
  button.textContent = enabled ? "Siguiendo" : "Vista libre";
}

async function refreshFallback() {
  try {
    const response = await fetch(`/api/public/tactics/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Enlace no disponible");
    renderBoard(await response.json());
  } catch (error) {
    if (!lastMessageAt) document.querySelector("#viewer-status").textContent = error.message || "Sin conexion";
  }
}

function setConnectionState(connected) {
  document.querySelector("#live-dot").classList.toggle("reconnecting", !connected);
}

function connect() {
  window.clearTimeout(reconnectTimer);
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws/tactical/${encodeURIComponent(token)}`);
  socket.addEventListener("open", () => {
    setConnectionState(true);
    document.querySelector("#viewer-status").textContent = "Conectado en directo";
  });
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (["board", "preview"].includes(message.type) && message.board) {
        lastMessageAt = Date.now();
        renderBoard(message.board, message.presentation);
      }
    } catch {
      document.querySelector("#viewer-status").textContent = "Actualizacion no valida";
    }
  });
  socket.addEventListener("close", () => {
    setConnectionState(false);
    document.querySelector("#viewer-status").textContent = "Reconectando...";
    reconnectTimer = window.setTimeout(connect, 1500);
  });
  socket.addEventListener("error", () => socket.close());
}

function slug(value) {
  return String(value || "pizarra").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "pizarra";
}

function downloadBlob(blob, extension) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slug(board?.name)}-escena-${currentIndex + 1}.${extension}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCurrentView() {
  if (!board) return;
  if (viewMode === "3d") {
    pitch3d.webgl.domElement.toBlob((blob) => blob && downloadBlob(blob, "png"), "image/png");
    return;
  }
  const svg = layer2d.querySelector("svg");
  if (!svg) return;
  downloadBlob(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }), "svg");
}

document.querySelectorAll("[data-view-mode]").forEach((button) => button.addEventListener("click", () => setViewMode(button.dataset.viewMode)));
document.querySelector("#follow-presenter").addEventListener("click", () => setFollowPresenter(!followPresenter));
document.querySelector("#fit-view").addEventListener("click", () => viewMode === "3d" && pitch3d.resetCamera());
document.querySelector("#download-view").addEventListener("click", downloadCurrentView);

refreshFallback();
connect();
window.setInterval(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN || Date.now() - lastMessageAt > 5000) refreshFallback();
}, 5000);
