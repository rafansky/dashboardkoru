export const SCHEMA_VERSION = 1;
export const PITCH_WIDTH = 105;
export const PITCH_HEIGHT = 68;

export function createDefaultDocument() {
  return {
    schemaVersion: SCHEMA_VERSION,
    pitch: {
      width: PITCH_WIDTH,
      height: PITCH_HEIGHT,
      view: "full",
      orientation: "left-to-right",
      surface: "stripes",
      overlays: ["thirds", "five-lanes"],
    },
    teams: [
      { id: "home", name: "KORU eClub", primaryColor: "#f95516", secondaryColor: "#f7f8fb" },
      { id: "away", name: "Rival", primaryColor: "#12d6df", secondaryColor: "#101217" },
    ],
    entities: [],
    drawings: [],
    zones: [],
    groups: [],
    scenes: [{ id: crypto.randomUUID(), name: "Escena base", duration: 3, transition: "ease-in-out", notes: "", entityStates: [] }],
    timeline: { mode: "scenes", loop: false, speed: 1 },
    camera: {
      preset: "tactical",
      position: { x: 52.5, y: 78, z: 52 },
      target: { x: 52.5, y: 34, z: 0 },
      zoom: 1,
      followEntityId: null,
    },
    settings: {
      playerStyle: "circle",
      snapToGrid: false,
      showNames: true,
      anonymizePlayers: false,
      attackDirection: "left-to-right",
    },
    metadata: {},
  };
}

export function createNewBoard() {
  return {
    id: null,
    name: "Nueva pizarra",
    description: "",
    category: "Ataque",
    matchId: null,
    teamId: "koru-eclub",
    seasonId: null,
    author: "KORU",
    favorite: false,
    version: 1,
    document: createDefaultDocument(),
  };
}

export function normalizeBoard(board) {
  const base = createNewBoard();
  return {
    ...base,
    ...board,
    document: {
      ...base.document,
      ...(board?.document || {}),
      pitch: { ...base.document.pitch, ...(board?.document?.pitch || {}) },
      settings: { ...base.document.settings, ...(board?.document?.settings || {}) },
    },
  };
}

export function boardPayload(board) {
  return {
    name: board.name.trim() || "Pizarra sin nombre",
    description: board.description || "",
    category: board.category || "Ataque",
    matchId: board.matchId || null,
    teamId: board.teamId || null,
    seasonId: board.seasonId || null,
    author: board.author || "KORU",
    favorite: Boolean(board.favorite),
    document: board.document,
    ...(board.id ? { version: board.version } : {}),
  };
}
