function getAtPath(target, path) {
  return path.reduce((value, key) => value?.[key], target);
}

function setAtPath(target, path, value) {
  const parent = path.slice(0, -1).reduce((item, key) => item[key], target);
  parent[path.at(-1)] = value;
}

export function createEditorStore(initialBoard, initialDirty = false) {
  let state = {
    board: structuredClone(initialBoard),
    selection: [],
    ui: {
      leftCollapsed: false,
      rightCollapsed: false,
      activeTeam: "home",
      activeTool: "select",
      zoom: 1,
      pan: { x: 0, y: 0 },
    },
    playback: { playing: false, time: 0, sceneIndex: 0 },
    dirty: initialDirty,
    saving: false,
    error: null,
    documentRevision: 0,
  };
  const listeners = new Set();
  const undoStack = [];
  const redoStack = [];

  const notify = () => listeners.forEach((listener) => listener(state));

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replaceBoard(board) {
      state = {
        ...state,
        board: structuredClone(board),
        selection: [],
        dirty: false,
        error: null,
        documentRevision: state.documentRevision + 1,
        ui: { ...state.ui, zoom: 1, pan: { x: 0, y: 0 } },
      };
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
    },
    update(path, value, label = "Cambio") {
      const oldValue = structuredClone(getAtPath(state, path));
      const newValue = structuredClone(value);
      const command = {
        label,
        apply() { setAtPath(state, path, structuredClone(newValue)); },
        revert() { setAtPath(state, path, structuredClone(oldValue)); },
      };
      command.apply();
      undoStack.push(command);
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
      state = { ...state, dirty: true, error: null, documentRevision: state.documentRevision + 1 };
      notify();
    },
    updateMany(changes, label = "Cambio multiple") {
      const prepared = changes.map(({ path, value }) => ({
        path,
        oldValue: structuredClone(getAtPath(state, path)),
        newValue: structuredClone(value),
      }));
      const command = {
        label,
        apply() { prepared.forEach((change) => setAtPath(state, change.path, structuredClone(change.newValue))); },
        revert() { prepared.forEach((change) => setAtPath(state, change.path, structuredClone(change.oldValue))); },
      };
      command.apply();
      undoStack.push(command);
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
      state = { ...state, dirty: true, error: null, documentRevision: state.documentRevision + 1 };
      notify();
    },
    setSelection(selection) {
      state = { ...state, selection: [...new Set(selection)] };
      notify();
    },
    setUI(patch) {
      state = { ...state, ui: { ...state.ui, ...patch } };
      notify();
    },
    setPlayback(patch) {
      state = { ...state, playback: { ...state.playback, ...patch } };
      notify();
    },
    applyScene(sceneIndex, entities) {
      state = {
        ...state,
        board: {
          ...state.board,
          document: { ...state.board.document, entities: structuredClone(entities) },
        },
        playback: { ...state.playback, playing: false, time: 0, sceneIndex },
        selection: [],
        documentRevision: state.documentRevision + 1,
      };
      notify();
    },
    setSaving(saving, error = null) {
      state = { ...state, saving, error };
      notify();
    },
    applySaveResult(board, clean = true) {
      const nextBoard = clean
        ? structuredClone(board)
        : { ...state.board, id: board.id, version: board.version, created_at: board.created_at, updated_at: board.updated_at };
      state = {
        ...state,
        board: nextBoard,
        dirty: !clean,
        saving: false,
        error: null,
        documentRevision: clean ? state.documentRevision + 1 : state.documentRevision,
      };
      notify();
    },
    undo() {
      const command = undoStack.pop();
      if (!command) return;
      command.revert();
      redoStack.push(command);
      state = { ...state, dirty: true, documentRevision: state.documentRevision + 1 };
      notify();
    },
    redo() {
      const command = redoStack.pop();
      if (!command) return;
      command.apply();
      undoStack.push(command);
      state = { ...state, dirty: true, documentRevision: state.documentRevision + 1 };
      notify();
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
  };
}
