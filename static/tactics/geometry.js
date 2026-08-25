const VIEW_RECTS = {
  full: { x: 0, y: 0, width: 105, height: 68 },
  half: { x: 52.5, y: 0, width: 52.5, height: 68 },
  "attacking-third": { x: 70, y: 0, width: 35, height: 68 },
  "defensive-third": { x: 0, y: 0, width: 35, height: 68 },
  "penalty-area": { x: 86.5, y: 10, width: 18.5, height: 48 },
  corner: { x: 94.5, y: 0, width: 10.5, height: 10.5 },
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampToPitch(point, pitch = { width: 105, height: 68 }) {
  return {
    x: clamp(point.x, 0, pitch.width),
    y: clamp(point.y, 0, pitch.height),
    z: Math.max(0, point.z || 0),
  };
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0));
}

export function interpolate(a, b, progress) {
  const t = clamp(progress, 0, 1);
  return a + (b - a) * t;
}

export function orientPoint(point, pitch) {
  switch (pitch.orientation) {
    case "right-to-left": return { x: pitch.width - point.x, y: point.y };
    case "top-to-bottom": return { x: pitch.height - point.y, y: point.x };
    case "bottom-to-top": return { x: point.y, y: pitch.width - point.x };
    default: return { x: point.x, y: point.y };
  }
}

export function unorientPoint(point, pitch) {
  switch (pitch.orientation) {
    case "right-to-left": return { x: pitch.width - point.x, y: point.y };
    case "top-to-bottom": return { x: point.y, y: pitch.height - point.x };
    case "bottom-to-top": return { x: pitch.width - point.y, y: point.x };
    default: return { x: point.x, y: point.y };
  }
}

export function isPerspectiveOrientation(pitch) {
  return pitch.orientation === "top-to-bottom" || pitch.orientation === "bottom-to-top";
}

export function projectPerspectivePoint(point, pitch) {
  const oriented = orientPoint(point, pitch);
  if (!isPerspectiveOrientation(pitch)) return oriented;
  const depth = clamp(oriented.y / pitch.width, 0, 1);
  const scale = 0.56 + depth * 0.44;
  return {
    x: pitch.height / 2 + (oriented.x - pitch.height / 2) * scale,
    y: oriented.y,
  };
}

export function unprojectPerspectivePoint(point, pitch) {
  if (!isPerspectiveOrientation(pitch)) return unorientPoint(point, pitch);
  const depth = clamp(point.y / pitch.width, 0, 1);
  const scale = 0.56 + depth * 0.44;
  const oriented = {
    x: pitch.height / 2 + (point.x - pitch.height / 2) / scale,
    y: point.y,
  };
  return unorientPoint(oriented, pitch);
}

export function pitchViewport(pitch) {
  const ratioX = pitch.width / 105;
  const ratioY = pitch.height / 68;
  const source = VIEW_RECTS[pitch.view] || VIEW_RECTS.full;
  const rect = {
    x: source.x * ratioX,
    y: source.y * ratioY,
    width: source.width * ratioX,
    height: source.height * ratioY,
  };
  const corners = [
    orientPoint({ x: rect.x, y: rect.y }, pitch),
    orientPoint({ x: rect.x + rect.width, y: rect.y }, pitch),
    orientPoint({ x: rect.x, y: rect.y + rect.height }, pitch),
    orientPoint({ x: rect.x + rect.width, y: rect.y + rect.height }, pitch),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

export function pitchToScreen(point, bounds, pitch) {
  const oriented = orientPoint(clampToPitch(point, pitch), pitch);
  const viewport = pitchViewport(pitch);
  return {
    x: ((oriented.x - viewport.x) / viewport.width) * bounds.width + bounds.left,
    y: ((oriented.y - viewport.y) / viewport.height) * bounds.height + bounds.top,
  };
}

export function screenToPitch(point, bounds, pitch) {
  const viewport = pitchViewport(pitch);
  const oriented = {
    x: viewport.x + ((point.x - bounds.left) / bounds.width) * viewport.width,
    y: viewport.y + ((point.y - bounds.top) / bounds.height) * viewport.height,
  };
  return clampToPitch(unorientPoint(oriented, pitch), pitch);
}

export function pitchTo3D(point, pitch = { width: 105, height: 68 }) {
  return { x: point.x - pitch.width / 2, y: point.z || 0, z: point.y - pitch.height / 2 };
}

export function threeDToPitch(point, pitch = { width: 105, height: 68 }) {
  return clampToPitch({ x: point.x + pitch.width / 2, y: point.z + pitch.height / 2, z: point.y }, pitch);
}
