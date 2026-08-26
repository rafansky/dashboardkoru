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

test("multiple targeted changes are committed and reverted together", () => {
  const store = createEditorStore({ document: { entities: [{ position: { x: 1, y: 2 } }, { position: { x: 3, y: 4 } }] } });
  store.updateMany([
    { path: ["board", "document", "entities", 0, "position"], value: { x: 10, y: 20 } },
    { path: ["board", "document", "entities", 1, "position"], value: { x: 30, y: 40 } },
  ], "Move players");
  assert.deepEqual(store.getState().board.document.entities.map((item) => item.position.x), [10, 30]);
  store.undo();
  assert.deepEqual(store.getState().board.document.entities.map((item) => item.position.x), [1, 3]);
});

test("opening a scene updates the working positions without dirtying the board", () => {
  const store = createEditorStore({ document: { entities: [{ id: "a", position: { x: 1, y: 2 } }] } });
  store.applyScene(2, [{ id: "a", position: { x: 50, y: 30 } }]);
  assert.equal(store.getState().playback.sceneIndex, 2);
  assert.deepEqual(store.getState().board.document.entities[0].position, { x: 50, y: 30 });
  assert.equal(store.getState().dirty, false);
});

test("applying a scene can keep playback active while chaining", () => {
  const store = createEditorStore({ document: { entities: [{ id: "a", position: { x: 1, y: 2 } }] } });
  store.applyScene(1, [{ id: "a", position: { x: 50, y: 30 } }], { playing: true, time: 0 });
  assert.equal(store.getState().playback.sceneIndex, 1);
  assert.equal(store.getState().playback.playing, true);
  store.applyScene(2, [{ id: "a", position: { x: 70, y: 40 } }]);
  assert.equal(store.getState().playback.playing, false);
});
