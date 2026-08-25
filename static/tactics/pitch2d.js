import { clampToPitch, orientPoint, pitchViewport, unorientPoint } from "./geometry.js";

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

function addPitchMarkings(group, width, height) {
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

function addOverlays(group, pitch) {
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
  const point = orientPoint(entity.position, pitch);
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

export class Pitch2DRenderer {
  constructor(container) {
    this.container = container;
    this.document = null;
    this.svg = null;
    this.entityLayer = null;
  }

  render(document) {
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
    const pitchWorld = svgElement("g", { class: "pitch-world", transform: orientationTransform(pitch) });
    addPitchMarkings(pitchWorld, pitch.width, pitch.height);
    addOverlays(pitchWorld, pitch);
    const entityLayer = svgElement("g", { class: "entity-layer" });
    addEntities(entityLayer, document);
    svg.append(pitchWorld, entityLayer);
    this.container.replaceChildren(svg);
    this.container.style.setProperty("--pitch-ratio", `${viewport.width} / ${viewport.height}`);
    this.container.dataset.orientation = pitch.orientation;
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
    return clampToPitch(unorientPoint(svgPoint, this.document.pitch), this.document.pitch);
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
