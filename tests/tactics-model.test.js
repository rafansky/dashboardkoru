import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultDocument, createPlayerEntity, createTacticalId, migrateDocument, normalizeBoard } from "../static/tactics/model.js";

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
