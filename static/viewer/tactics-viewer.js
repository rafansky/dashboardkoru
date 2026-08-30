import { normalizeBoard } from "/static/tactics/model.js?v=20260830b";
import { Pitch2DRenderer } from "/static/tactics/pitch2d.js?v=20260830h";

const token = decodeURIComponent(window.location.pathname.split("/").pop() || "");
const pitch = new Pitch2DRenderer(document.querySelector("#viewer-pitch"));
let signature = "";
let currentIndex = 0;
let socket;
let reconnectTimer;
let lastMessageAt = 0;

function renderBoard(rawBoard) {
  const board = normalizeBoard(rawBoard);
  currentIndex = Math.min(Number(board.document.metadata?.activeSceneIndex || 0), Math.max(0, board.document.scenes.length - 1));
  const nextSignature = JSON.stringify([board.version, board.updated_at, board.document.entities, board.document.scenes]);
  if (nextSignature !== signature) {
    signature = nextSignature;
    const activeScene = board.document.scenes[currentIndex];
    pitch.render(board.document, activeScene?.annotations || [], activeScene?.movementPaths || []);
    pitch.setLayers({ home: true, away: true, ball: true, names: true, annotations: true, markings: true });
    document.querySelector("#board-title").textContent = board.name;
  }
  document.querySelector("#viewer-status").textContent = `En directo · Escena ${currentIndex + 1} de ${board.document.scenes.length}`;
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

function connect() {
  window.clearTimeout(reconnectTimer);
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${window.location.host}/ws/tactical/${encodeURIComponent(token)}`);
  socket.addEventListener("open", () => {
    document.querySelector("#viewer-status").textContent = "Conectado en directo";
  });
  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === "board" && message.board) {
        lastMessageAt = Date.now();
        renderBoard(message.board);
      }
    } catch {
      document.querySelector("#viewer-status").textContent = "Actualizacion no valida";
    }
  });
  socket.addEventListener("close", () => {
    document.querySelector("#viewer-status").textContent = "Reconectando...";
    reconnectTimer = window.setTimeout(connect, 1500);
  });
  socket.addEventListener("error", () => socket.close());
}

refreshFallback();
connect();
window.setInterval(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN || Date.now() - lastMessageAt > 5000) refreshFallback();
}, 5000);
