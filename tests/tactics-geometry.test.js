import test from "node:test";
import assert from "node:assert/strict";

import {
  clampToPitch,
  distance,
  pitchTo3D,
  pitchToScreen,
  screenToPitch,
  threeDToPitch,
} from "../static/tactics/geometry.js";

const pitch = { width: 105, height: 68, view: "full", orientation: "left-to-right" };
const bounds = { left: 10, top: 20, width: 1050, height: 680 };

test("pitch and screen coordinates round-trip", () => {
  const source = { x: 42, y: 31, z: 0 };
  const screen = pitchToScreen(source, bounds, pitch);
  const result = screenToPitch(screen, bounds, pitch);
  assert.ok(Math.abs(result.x - source.x) < 1e-9);
  assert.ok(Math.abs(result.y - source.y) < 1e-9);
});

test("all orientations round-trip", () => {
  for (const orientation of ["left-to-right", "right-to-left", "top-to-bottom", "bottom-to-top"]) {
    const configured = { ...pitch, orientation };
    const source = { x: 81.2, y: 12.4, z: 0 };
    const result = screenToPitch(pitchToScreen(source, bounds, configured), bounds, configured);
    assert.ok(Math.abs(result.x - source.x) < 1e-9, orientation);
    assert.ok(Math.abs(result.y - source.y) < 1e-9, orientation);
  }
});

test("pitch and 3D coordinates share the same world position", () => {
  const source = { x: 15, y: 62, z: 2.4 };
  assert.deepEqual(threeDToPitch(pitchTo3D(source, pitch), pitch), source);
});

test("clamp and distance use pitch metres", () => {
  assert.deepEqual(clampToPitch({ x: -3, y: 80, z: -2 }, pitch), { x: 0, y: 68, z: 0 });
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});
