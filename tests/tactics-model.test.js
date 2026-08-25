import test from "node:test";
import assert from "node:assert/strict";

import { applySceneToEntities, captureSceneEntityStates, createDefaultDocument, createPlayerEntity, createSceneFromEntities, createTacticalId, migrateDocument, normalizeBoard } from "../static/tactics/model.js";

test("IDs work when randomUUID is unavailable on public HTTP", () => {
  const id = createTacticalId({ getRandomValues: (bytes) => bytes.fill(7) });
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("phase one documents migrate to analysis schema", () => {
  const migrated = migrateDocument({ schemaVersion: 1, pitch: { width: 105, height: 68 } });
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.analysis, { activeSessionId: null, sessions: [] });
  const board = normalizeBoard({ document: migrated });
  assert.equal(board.document.analysis.sessions.length, 1);
});

test("KORU tactical colors remain white and orange", () => {
  const document = createDefaultDocument();
  assert.deepEqual(document.teams[0], {
    id: "home",
    name: "KORU eClub",
    primaryColor: "#f7f8fb",
    secondaryColor: "#f95516",
  });
});

test("custom player metadata is carried into the pitch entity", () => {
  const entity = createPlayerEntity(
    { name: "Ricky", number: 10, positionLabel: "MCO", avatarUrl: "/uploads/ricky.webp", rosterKey: "custom:1", source: "custom" },
    "home",
    { x: 52, y: 34, z: 0 },
    10,
  );
  assert.equal(entity.metadata.avatarUrl, "/uploads/ricky.webp");
  assert.equal(entity.metadata.rosterKey, "custom:1");
  assert.equal(entity.number, 10);
});

test("a ball entity uses the same validated tactical shape", () => {
  const ball = {
    id: createTacticalId({ getRandomValues: (bytes) => bytes.fill(3) }),
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
  assert.equal(ball.type, "ball");
  assert.deepEqual(ball.position, { x: 52.5, y: 34, z: 0 });
});

test("a scene captures and restores a complete entity state", () => {
  const entities = [{ id: "player-1", position: { x: 12, y: 18, z: 0 }, rotation: 90, scale: 1, opacity: 1 }];
  const scene = createSceneFromEntities("Salida", entities, { duration: 4, transition: "linear", notes: "Abrir amplitud" });
  assert.deepEqual(scene.entityStates, captureSceneEntityStates(entities));
  const moved = [{ ...entities[0], position: { x: 60, y: 34, z: 0 } }];
  assert.deepEqual(applySceneToEntities(moved, scene)[0].position, { x: 12, y: 18, z: 0 });
});
