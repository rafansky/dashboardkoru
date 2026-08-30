export const SCHEMA_VERSION = 4;
export const PITCH_WIDTH = 105;
export const PITCH_HEIGHT = 68;

export function createTacticalId(provider = globalThis.crypto) {
  if (typeof provider?.randomUUID === "function") return provider.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof provider?.getRandomValues === "function") provider.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createAnalysisSession(name = "Preparacion") {
  return {
    id: createTacticalId(),
    name,
    type: "pre-match",
    createdAt: new Date().toISOString(),
    matchId: null,
    entries: [],
  };
}

export function captureSceneEntityStates(entities) {
  return entities.map((entity) => ({
    entityId: entity.id,
    position: { ...entity.position },
    rotation: entity.rotation || 0,
    scale: entity.scale || 1,
    opacity: entity.opacity ?? 1,
  }));
}

export function createSceneFromEntities(name, entities, source = {}) {
  return {
    id: createTacticalId(),
    name,
    duration: source.duration || 3,
    transition: source.transition || "ease-in-out",
    notes: source.notes || "",
    entityStates: captureSceneEntityStates(entities),
    annotations: structuredClone(source.annotations || []),
    movementPaths: structuredClone(source.movementPaths || []),
  };
}

export function applySceneToEntities(entities, scene) {
  const states = new Map((scene?.entityStates || []).map((state) => [state.entityId, state]));
  return entities.map((entity) => {
    const state = states.get(entity.id);
    return state ? {
      ...entity,
      position: { ...state.position },
      rotation: state.rotation,
      scale: state.scale,
      opacity: state.opacity,
    } : entity;
  });
}

export function createDefaultDocument() {
  const analysisSession = createAnalysisSession();
  return {
    schemaVersion: SCHEMA_VERSION,
    pitch: {
      width: PITCH_WIDTH,
      height: PITCH_HEIGHT,
      view: "full",
      orientation: "top-to-bottom",
      surface: "stripes",
      overlays: ["thirds", "five-lanes"],
    },
    teams: [
      { id: "home", name: "KORU eClub", primaryColor: "#f7f8fb", secondaryColor: "#f95516" },
      { id: "away", name: "Rival", primaryColor: "#12d6df", secondaryColor: "#101217" },
    ],
    entities: [],
    drawings: [],
    zones: [],
    groups: [],
    scenes: [{ id: createTacticalId(), name: "Escena base", duration: 3, transition: "ease-in-out", notes: "", entityStates: [], annotations: [], movementPaths: [] }],
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
    analysis: {
      activeSessionId: analysisSession.id,
      sessions: [analysisSession],
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
  const document = migrateDocument(board?.document || {});
  return {
    ...base,
    ...board,
    document: {
      ...base.document,
      ...document,
      pitch: { ...base.document.pitch, ...(document.pitch || {}) },
      settings: { ...base.document.settings, ...(document.settings || {}) },
      teams: normalizeTeams(document.teams || base.document.teams),
      scenes: normalizeScenes(document.scenes, document.entities || []),
      analysis: normalizeAnalysis(document.analysis),
    },
  };
}

function normalizeTeams(teams) {
  const result = structuredClone(teams || []);
  const home = result.find((team) => team.id === "home");
  if (home) Object.assign(home, { name: "KORU eClub", primaryColor: "#f7f8fb", secondaryColor: "#f95516" });
  else result.unshift({ id: "home", name: "KORU eClub", primaryColor: "#f7f8fb", secondaryColor: "#f95516" });
  if (!result.some((team) => team.id === "away")) result.push({ id: "away", name: "Rival", primaryColor: "#12d6df", secondaryColor: "#101217" });
  return result;
}

export function migrateDocument(source) {
  const document = structuredClone(source || {});
  const version = Number(document.schemaVersion || 1);
  if (version > SCHEMA_VERSION) throw new Error("Esta pizarra pertenece a una version mas reciente");
  if (version === 1) {
    document.analysis = { activeSessionId: null, sessions: [] };
    document.schemaVersion = 2;
  }
  if (version <= 2) {
    document.scenes = (document.scenes || []).map((scene) => ({ ...scene, annotations: scene.annotations || [] }));
    document.schemaVersion = 3;
  }
  if (version <= 3) {
    document.scenes = (document.scenes || []).map((scene) => ({ ...scene, movementPaths: scene.movementPaths || [] }));
    document.schemaVersion = 4;
  }
  return document;
}

function normalizeScenes(scenes, entities = []) {
  const normalized = structuredClone(scenes || []).map((scene) => ({ ...scene, entityStates: scene.entityStates || [], annotations: scene.annotations || [], movementPaths: scene.movementPaths || [] }));
  return normalized.length ? normalized : [createSceneFromEntities("Escena base", entities)];
}

function normalizeAnalysis(source) {
  const analysis = source || { activeSessionId: null, sessions: [] };
  if (!analysis.sessions?.length) {
    const session = createAnalysisSession();
    return { activeSessionId: session.id, sessions: [session] };
  }
  const activeExists = analysis.sessions.some((session) => session.id === analysis.activeSessionId);
  return {
    activeSessionId: activeExists ? analysis.activeSessionId : analysis.sessions[0].id,
    sessions: analysis.sessions,
  };
}

export function createPlayerEntity(player, teamId, position, number) {
  const name = String(player.username || player.name || `${teamId === "home" ? "Jugador" : "Rival"} ${number}`);
  return {
    id: createTacticalId(),
    type: "player",
    teamId,
    name,
    number: Math.max(0, Math.min(99, Number(number) || 0)),
    positionLabel: player.positionLabel || null,
    position: { x: position.x, y: position.y, z: 0 },
    rotation: teamId === "home" ? 90 : 270,
    scale: 1,
    opacity: 1,
    locked: false,
    visible: true,
    metadata: {
      rosterKey: player.rosterKey || name.toLowerCase(),
      avatarUrl: player.avatarUrl || null,
      source: player.source || (teamId === "home" ? "dashboard" : "manual-opponent"),
    },
  };
}

export function createAnalysisEntry(kind, text, options = {}) {
  return {
    id: createTacticalId(),
    kind,
    text: text.trim(),
    author: options.author || "KORU",
    createdAt: new Date().toISOString(),
    matchMinute: options.matchMinute ?? null,
    sceneId: options.sceneId || null,
    entityIds: options.entityIds || [],
  };
}

export function createNewAnalysisSession(index, matchId = null) {
  const session = createAnalysisSession(`Sesion ${index}`);
  session.matchId = matchId;
  return session;
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
