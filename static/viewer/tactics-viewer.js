import { normalizeBoard } from "/static/tactics/model.js?v=20260830b";
import { Pitch2DRenderer } from "/static/tactics/pitch2d.js?v=20260830f";

const token = decodeURIComponent(window.location.pathname.split("/").pop() || "");
const pitch = new Pitch2DRenderer(document.querySelector("#viewer-pitch"));
let signature = "";
let currentIndex = 0;

async function refresh() {
  try {
    const response = await fetch(`/api/public/tactics/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Enlace no disponible");
    const board = normalizeBoard(await response.json());
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
  } catch (error) {
    document.querySelector("#viewer-status").textContent = error.message || "Sin conexion";
  }
}

refresh();
window.setInterval(refresh, 1000);
