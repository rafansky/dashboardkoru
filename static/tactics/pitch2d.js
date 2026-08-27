import { clampToPitch, isPerspectiveOrientation, pitchViewport, projectPerspectivePoint, unprojectPerspectivePoint } from "./geometry.js?v=20260827b";

const NS = "http://www.w3.org/2000/svg";

function orientationTransform(pitch) {
  if (pitch.orientation === "right-to-left") return `translate(${pitch.width} 0) scale(-1 1)`;
  if (pitch.orientation === "top-to-bottom") return `matrix(0 1 -1 0 ${pitch.height} 0)`;
  if (pitch.orientation === "bottom-to-top") return `matrix(0 -1 1 0 0 ${pitch.width})`;
  return "";
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
}

function safeAvatarUrl(value) {
  const url = String(value || "");
  return url.startsWith("/uploads/") || url.startsWith("https://") ? url : null;
}

function addFlatPitchMarkings(group, width, height) {
  const line = { fill: "none", stroke: "currentColor", "stroke-width": 0.32, "vector-effect": "non-scaling-stroke" };
  group.append(
    svgElement("rect", { ...line, x: 0.25, y: 0.25, width: width - 0.5, height: height - 0.5 }),
    svgElement("line", { ...line, x1: width / 2, y1: 0, x2: width / 2, y2: height }),
    svgElement("circle", { ...line, cx: width / 2, cy: height / 2, r: 9.15 }),
    svgElement("circle", { cx: width / 2, cy: height / 2, r: 0.45, fill: "currentColor" }),
    svgElement("rect", { ...line, x: 0, y: 13.84, width: 16.5, height: 40.32 }),
    svgElement("rect", { ...line, x: width - 16.5, y: 13.84, width: 16.5, height: 40.32 }),
    svgElement("rect", { ...line, x: 0, y: 24.84, width: 5.5, height: 18.32 }),
    svgElement("rect", { ...line, x: width - 5.5, y: 24.84, width: 5.5, height: 18.32 }),
    svgElement("circle", { cx: 11, cy: height / 2, r: 0.4, fill: "currentColor" }),
    svgElement("circle", { cx: width - 11, cy: height / 2, r: 0.4, fill: "currentColor" }),
    svgElement("path", { ...line, d: "M 16.5 26.65 A 9.15 9.15 0 0 1 16.5 41.35" }),
    svgElement("path", { ...line, d: `M ${width - 16.5} 26.65 A 9.15 9.15 0 0 0 ${width - 16.5} 41.35` }),
    svgElement("path", { ...line, d: "M 0 1 A 1 1 0 0 0 1 0" }),
    svgElement("path", { ...line, d: `M ${width - 1} 0 A 1 1 0 0 0 ${width} 1` }),
    svgElement("path", { ...line, d: `M 0 ${height - 1} A 1 1 0 0 1 1 ${height}` }),
    svgElement("path", { ...line, d: `M ${width - 1} ${height} A 1 1 0 0 1 ${width} ${height - 1}` }),
    svgElement("rect", { ...line, x: -2.2, y: 30.68, width: 2.2, height: 7.32 }),
    svgElement("rect", { ...line, x: width, y: 30.68, width: 2.2, height: 7.32 }),
  );
}

function pointString(points) {
  return points.map((point) => `${point.x} ${point.y}`).join(" ");
}

function addPerspectiveSurface(group, pitch) {
  const surface = { fill: "#1d6b43", stroke: "none" };
  const bands = 10;
  for (let index = 0; index < bands; index += 1) {
    const y1 = (pitch.width * index) / bands;
    const y2 = (pitch.width * (index + 1)) / bands;
    const scale = (depth) => 0.78 + (depth / pitch.width) * 0.32;
    const p = (x, y) => ({ x: pitch.height / 2 + (x - pitch.height / 2) * scale(y), y: y * 0.72 });
    group.append(svgElement("polygon", {
      class: "perspective-band",
      ...surface,
      fill: index % 2 ? "#23764a" : "#1c6841",
      points: pointString([p(0, y1), p(pitch.height, y1), p(pitch.height, y2), p(0, y2)]),
    }));
  }
}

function addPerspectivePitchMarkings(group, pitch) {
  const { width, height } = pitch;
  const line = { fill: "none", stroke: "currentColor", "stroke-width": 0.32, "vector-effect": "non-scaling-stroke" };
  const project = (point) => projectPerspectivePoint(point, pitch);
  const appendLine = (points, attributes = line) => group.append(svgElement("polyline", { ...attributes, points: pointString(points.map(project)) }));
  const appendPolygon = (points, attributes = line) => group.append(svgElement("polygon", { ...attributes, points: pointString(points.map(project)) }));
  const appendCircle = (cx, cy, radius, attributes = line, start = 0, end = Math.PI * 2) => {
    const points = [];
    const steps = Math.max(16, Math.ceil(Math.abs(end - start) * 12));
    for (let index = 0; index <= steps; index += 1) {
      const angle = start + ((end - start) * index) / steps;
      points.push(project({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius }));
    }
    group.append(svgElement("polyline", { ...attributes, points: pointString(points) }));
  };

  appendPolygon([{ x: 0.25, y: 0.25 }, { x: width - 0.25, y: 0.25 }, { x: width - 0.25, y: height - 0.25 }, { x: 0.25, y: height - 0.25 }]);
  appendLine([{ x: width / 2, y: 0 }, { x: width / 2, y: height }]);
  appendCircle(width / 2, height / 2, 9.15);
  const spot = (x, y, radius = 0.45) => group.append(svgElement("circle", { cx: project({ x, y }).x, cy: project({ x, y }).y, r: radius, fill: "currentColor" }));
  spot(width / 2, height / 2);
  appendPolygon([{ x: 0, y: 13.84 }, { x: 16.5, y: 13.84 }, { x: 16.5, y: 54.16 }, { x: 0, y: 54.16 }]);
  appendPolygon([{ x: width - 16.5, y: 13.84 }, { x: width, y: 13.84 }, { x: width, y: 54.16 }, { x: width - 16.5, y: 54.16 }]);
  appendPolygon([{ x: 0, y: 24.84 }, { x: 5.5, y: 24.84 }, { x: 5.5, y: 43.16 }, { x: 0, y: 43.16 }]);
  appendPolygon([{ x: width - 5.5, y: 24.84 }, { x: width, y: 24.84 }, { x: width, y: 43.16 }, { x: width - 5.5, y: 43.16 }]);
  spot(11, height / 2, 0.4);
  spot(width - 11, height / 2, 0.4);
  appendCircle(16.5, height / 2, 9.15, line, -Math.PI / 2, Math.PI / 2);
  appendCircle(width - 16.5, height / 2, 9.15, line, Math.PI / 2, Math.PI * 1.5);
  spot(11, height / 2, 0.4);
  spot(width - 11, height / 2, 0.4);
  appendLine([{ x: -2.2, y: 30.68 }, { x: 0, y: 30.68 }, { x: 0, y: 38 }, { x: -2.2, y: 38 }]);
  appendLine([{ x: width, y: 30.68 }, { x: width + 2.2, y: 30.68 }, { x: width + 2.2, y: 38 }, { x: width, y: 38 }]);
}

function addOverlays(group, pitch) {
  if (isPerspectiveOrientation(pitch)) {
    const project = (point) => projectPerspectivePoint(point, pitch);
    const append = (points, attributes) => group.append(svgElement("polyline", { ...attributes, points: pointString(points.map(project)) }));
    if (pitch.overlays.includes("thirds")) {
      [pitch.width / 3, (pitch.width * 2) / 3].forEach((x) => append([{ x, y: 0 }, { x, y: pitch.height }], { class: "analysis-line" }));
    }
    if (pitch.overlays.includes("five-lanes")) {
      [1, 2, 3, 4].forEach((lane) => {
        const y = (pitch.height * lane) / 5;
        append([{ x: 0, y }, { x: pitch.width, y }], { class: "analysis-line lanes" });
      });
    }
    if (pitch.overlays.includes("grid")) {
      for (let x = 10; x < pitch.width; x += 10) append([{ x, y: 0 }, { x, y: pitch.height }], { class: "grid-line" });
      for (let y = 10; y < pitch.height; y += 10) append([{ x: 0, y }, { x: pitch.width, y }], { class: "grid-line" });
    }
    return;
  }
  if (pitch.overlays.includes("thirds")) {
    [pitch.width / 3, (pitch.width * 2) / 3].forEach((x) => {
      group.append(svgElement("line", { class: "analysis-line", x1: x, y1: 0, x2: x, y2: pitch.height }));
    });
  }
  if (pitch.overlays.includes("five-lanes")) {
    [1, 2, 3, 4].forEach((lane) => {
      const y = (pitch.height * lane) / 5;
      group.append(svgElement("line", { class: "analysis-line lanes", x1: 0, y1: y, x2: pitch.width, y2: y }));
    });
  }
  if (pitch.overlays.includes("grid")) {
    for (let x = 10; x < pitch.width; x += 10) {
      group.append(svgElement("line", { class: "grid-line", x1: x, y1: 0, x2: x, y2: pitch.height }));
    }
    for (let y = 10; y < pitch.height; y += 10) {
      group.append(svgElement("line", { class: "grid-line", x1: 0, y1: y, x2: pitch.width, y2: y }));
    }
  }
}

function entityTransform(entity, pitch) {
  const point = projectPerspectivePoint(entity.position, pitch);
  return `translate(${point.x} ${point.y})`;
}

function addEntities(group, document) {
  const teams = Object.fromEntries(document.teams.map((team) => [team.id, team]));
  document.entities.filter((entity) => entity.visible).forEach((entity) => {
    const item = svgElement("g", {
      class: `pitch-entity entity-${entity.type}${entity.locked ? " locked" : ""}`,
      "data-entity-id": entity.id,
      tabindex: entity.locked ? -1 : 0,
      role: "button",
      "aria-label": entity.name || entity.type,
    });
    item.setAttribute("transform", entityTransform(entity, document.pitch));
    if (entity.type === "player") {
      const team = teams[entity.teamId] || teams.home;
      const avatarUrl = safeAvatarUrl(entity.metadata?.avatarUrl);
      item.append(
        svgElement("circle", { class: "selection-ring", r: 3.05 }),
        svgElement("path", { class: "orientation-indicator", d: "M 0 -3.25 L -0.75 -2.25 L 0.75 -2.25 Z", transform: `rotate(${entity.rotation || 0})` }),
        svgElement("circle", { class: "player-disc", r: 2.35, fill: team?.primaryColor || "#f95516", stroke: team?.secondaryColor || "#fff", "stroke-width": 0.38 }),
      );
      if (avatarUrl) item.append(svgElement("image", { class: "player-avatar", href: avatarUrl, x: -2.08, y: -2.08, width: 4.16, height: 4.16, preserveAspectRatio: "xMidYMid slice" }));
      if (avatarUrl) item.append(svgElement("circle", { class: "player-number-badge", cx: 1.7, cy: 1.65, r: 0.9 }));
      const number = svgElement("text", { class: `player-number${avatarUrl ? " has-avatar" : ""}`, x: avatarUrl ? 1.7 : 0, y: avatarUrl ? 2.03 : 0.68, "text-anchor": "middle" });
      number.textContent = String(entity.number ?? "");
      item.append(number);
      if (document.settings.showNames) {
        const name = svgElement("text", { class: "player-label", x: 0, y: 4.5, "text-anchor": "middle" });
        name.textContent = document.settings.anonymizePlayers ? `Jugador ${entity.number ?? ""}` : entity.name;
        item.append(name);
      }
    } else if (entity.type === "ball") {
      item.append(svgElement("circle", { class: "selection-ring", r: 1.55 }));
      item.append(svgElement("circle", { r: 0.85, fill: "#f7f8fb", stroke: "#111", "stroke-width": 0.2 }));
    }
    group.append(item);
  });
}

function addAnnotations(group, annotations, pitch) {
  if (!annotations?.length) return;
  const perspective = isPerspectiveOrientation(pitch);
  const point = (value) => projectPerspectivePoint(value, pitch);
  const arrowId = "tactical-arrowhead";
  const defs = svgElement("defs");
  const marker = svgElement("marker", { id: arrowId, markerWidth: 4, markerHeight: 4, refX: 3.2, refY: 2, orient: "auto", markerUnits: "strokeWidth" });
  marker.append(svgElement("path", { d: "M 0 0 L 4 2 L 0 4 Z", fill: "#f95516" }));
  defs.append(marker);
  group.append(defs);

  annotations.forEach((annotation) => {
    const color = annotation.color || "#f95516";
    if (annotation.type === "arrow") {
      const start = point(annotation.start);
      const end = point(annotation.end);
      group.append(svgElement("line", { class: "tactical-annotation tactical-arrow", x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: color, "marker-end": `url(#${arrowId})` }));
    } else if (annotation.type === "zone") {
      const start = point(annotation.start);
      const end = point(annotation.end);
      const corners = perspective
        ? [annotation.start, { x: annotation.start.x, y: annotation.end.y }, annotation.end, { x: annotation.end.x, y: annotation.start.y }].map(point)
        : [{ x: start.x, y: start.y }, { x: start.x, y: end.y }, { x: end.x, y: end.y }, { x: end.x, y: start.y }];
      group.append(svgElement("polygon", { class: "tactical-annotation tactical-zone", points: pointString(corners), fill: color, stroke: color }));
    } else if (annotation.type === "text") {
      const position = point(annotation.position);
      const label = svgElement("text", { class: "tactical-annotation tactical-text", x: position.x, y: position.y, fill: color, "text-anchor": "middle" });
      label.textContent = annotation.text || "Nota";
      group.append(label);
    }
  });
}

export class Pitch2DRenderer {
  constructor(container) {
    this.container = container;
    this.document = null;
    this.svg = null;
    this.entityLayer = null;
  }

  render(document, annotations = []) {
    this.document = document;
    const pitch = document.pitch;
    const viewport = pitchViewport(pitch);
    const svg = svgElement("svg", {
      class: `tactical-pitch surface-${pitch.surface}`,
      viewBox: `${viewport.x - 1.8} ${viewport.y - 1.8} ${viewport.width + 3.6} ${viewport.height + 3.6}`,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": "Campo tactico 2D",
    });
    const perspective = isPerspectiveOrientation(pitch);
    const pitchWorld = svgElement("g", { class: "pitch-world", transform: perspective ? "" : orientationTransform(pitch) });
    if (perspective) {
      addPerspectiveSurface(pitchWorld, pitch);
      addPerspectivePitchMarkings(pitchWorld, pitch);
    } else addFlatPitchMarkings(pitchWorld, pitch.width, pitch.height);
    addOverlays(pitchWorld, pitch);
    addAnnotations(pitchWorld, annotations, pitch);
    const entityLayer = svgElement("g", { class: "entity-layer" });
    addEntities(entityLayer, document);
    svg.append(pitchWorld, entityLayer);
    this.container.replaceChildren(svg);
    this.container.style.setProperty("--pitch-ratio", `${viewport.width} / ${viewport.height}`);
    this.container.dataset.orientation = pitch.orientation;
    this.container.dataset.perspective = String(perspective);
    svg.dataset.perspective = String(perspective);
    this.svg = svg;
    this.entityLayer = entityLayer;
  }

  setSelection(ids) {
    if (!this.entityLayer) return;
    const selected = new Set(ids);
    this.entityLayer.querySelectorAll("[data-entity-id]").forEach((element) => {
      element.classList.toggle("selected", selected.has(element.dataset.entityId));
    });
  }

  previewEntityPositions(positions) {
    if (!this.document) return;
    Object.entries(positions).forEach(([id, position]) => {
      const element = this.entityLayer?.querySelector(`[data-entity-id="${CSS.escape(id)}"]`);
      const entity = this.document.entities.find((item) => item.id === id);
      if (!element || !entity) return;
      element.setAttribute("transform", entityTransform({ ...entity, position }, this.document.pitch));
    });
  }

  clientToPitch(clientX, clientY) {
    if (!this.svg || !this.document) return { x: 0, y: 0, z: 0 };
    const point = this.svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const matrix = this.svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0, z: 0 };
    const svgPoint = point.matrixTransform(matrix.inverse());
    return clampToPitch(unprojectPerspectivePoint(svgPoint, this.document.pitch), this.document.pitch);
  }

  entitiesInScreenRect(rect) {
    if (!this.entityLayer) return [];
    return Array.from(this.entityLayer.querySelectorAll("[data-entity-id]"))
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.right >= rect.left && bounds.left <= rect.right && bounds.bottom >= rect.top && bounds.top <= rect.bottom;
      })
      .map((element) => element.dataset.entityId);
  }
}
