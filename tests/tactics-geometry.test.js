import test from "node:test";
import assert from "node:assert/strict";

import {
  clampToPitch,
  distance,
  pitchTo3D,
  projectPerspectivePoint,
  pitchToScreen,
  screenToPitch,
  threeDToPitch,
  unprojectPerspectivePoint,
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

test("perspective vertical views round-trip and narrow at the far end", () => {
  for (const orientation of ["top-to-bottom", "bottom-to-top"]) {
    const configured = { ...pitch, orientation };
    const firstLeft = projectPerspectivePoint({ x: 0, y: 0 }, configured);
    const firstRight = projectPerspectivePoint({ x: 0, y: 68 }, configured);
    const secondLeft = projectPerspectivePoint({ x: 105, y: 0 }, configured);
    const secondRight = projectPerspectivePoint({ x: 105, y: 68 }, configured);
    const restored = unprojectPerspectivePoint(firstLeft, configured);
    const firstWidth = Math.abs(firstRight.x - firstLeft.x);
    const secondWidth = Math.abs(secondRight.x - secondLeft.x);
    assert.notEqual(firstWidth, secondWidth);
    assert.ok(Math.abs(restored.x - 0) < 1e-9 && Math.abs(restored.y - 0) < 1e-9, orientation);
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
