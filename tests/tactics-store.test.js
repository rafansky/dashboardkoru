import test from "node:test";
import assert from "node:assert/strict";

import { createEditorStore } from "../static/tactics/store.js";

test("property commands support undo and redo without document snapshots", () => {
  const store = createEditorStore({ name: "Original", document: { pitch: { view: "full" } } });
  store.update(["board", "name"], "Plan A", "Rename");
  assert.equal(store.getState().board.name, "Plan A");
  assert.equal(store.canUndo(), true);

  store.undo();
  assert.equal(store.getState().board.name, "Original");
  assert.equal(store.canRedo(), true);

  store.redo();
  assert.equal(store.getState().board.name, "Plan A");
});

test("recovered editor state starts dirty", () => {
  const store = createEditorStore({ name: "Recovered" }, true);
  assert.equal(store.getState().dirty, true);
});
