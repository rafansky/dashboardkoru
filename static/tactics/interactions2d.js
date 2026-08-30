import { clamp, clampToPitch } from "./geometry.js";

function pointerDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export class Pitch2DInteractions {
  constructor(options) {
    this.viewport = options.viewport;
    this.renderer = options.renderer;
    this.marquee = options.marquee;
    this.getState = options.getState;
    this.onSelection = options.onSelection;
    this.onMove = options.onMove;
    this.onDropPlayer = options.onDropPlayer;
    this.onViewportChange = options.onViewportChange;
    this.onDraw = options.onDraw;
    this.onText = options.onText;
    this.onAnnotationMove = options.onAnnotationMove;
    this.onAnnotationResize = options.onAnnotationResize;
    this.onPathPoint = options.onPathPoint;
    this.onPathPreview = options.onPathPreview;
    this.mode = null;
    this.pointers = new Map();
    this.bind();
  }

  bind() {
    this.viewport.addEventListener("pointerdown", (event) => this.pointerDown(event));
    this.viewport.addEventListener("pointermove", (event) => this.pointerMove(event));
    this.viewport.addEventListener("pointerup", (event) => this.pointerUp(event));
    this.viewport.addEventListener("pointercancel", (event) => this.pointerUp(event));
    this.viewport.addEventListener("wheel", (event) => this.wheel(event), { passive: false });
    this.viewport.addEventListener("dragover", (event) => event.preventDefault());
    this.viewport.addEventListener("drop", (event) => this.drop(event));
  }

  pointerDown(event) {
    if (!this.renderer.svg) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.viewport.setPointerCapture(event.pointerId);
    const state = this.getState();

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.mode = { type: "pinch", distance: pointerDistance(a, b), zoom: state.ui.zoom };
      return;
    }

    const entityElement = event.target.closest?.("[data-entity-id]");
    const annotationElement = event.target.closest?.("[data-annotation-id]");
    const handleElement = event.target.closest?.("[data-annotation-handle]");
    const useHand = state.ui.activeTool === "hand" || event.button === 1;
    if (useHand) {
      this.mode = { type: "pan", start: { x: event.clientX, y: event.clientY }, pan: { ...state.ui.pan } };
      return;
    }

    if (state.ui.activeTool === "text") {
      this.onText?.(this.renderer.clientToPitch(event.clientX, event.clientY));
      return;
    }

    if (state.ui.activeTool === "path") {
      this.onPathPoint?.(this.renderer.clientToPitch(event.clientX, event.clientY));
      return;
    }

    if (state.ui.activeTool === "arrow" || state.ui.activeTool === "zone") {
      this.mode = {
        type: "draw",
        tool: state.ui.activeTool,
        startPitch: this.renderer.clientToPitch(event.clientX, event.clientY),
        endPitch: this.renderer.clientToPitch(event.clientX, event.clientY),
      };
      return;
    }

    if (state.ui.activeTool !== "select") return;
    if (handleElement) {
      this.mode = {
        type: "annotation-resize",
        id: handleElement.dataset.annotationId,
        handle: handleElement.dataset.annotationHandle,
        endPitch: this.renderer.clientToPitch(event.clientX, event.clientY),
      };
      return;
    }
    if (entityElement) {
      const id = entityElement.dataset.entityId;
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      let selection = state.selection;
      if (additive) selection = selection.includes(id) ? selection.filter((item) => item !== id) : [...selection, id];
      else if (!selection.includes(id)) selection = [id];
      this.onSelection(selection);
      if (!selection.includes(id)) return;
      const entities = state.board.document.entities;
      const starts = Object.fromEntries(selection.map((selectedId) => {
        const entity = entities.find((item) => item.id === selectedId);
        return entity ? [selectedId, { ...entity.position }] : null;
      }).filter(Boolean));
      this.mode = {
        type: "drag",
        startPitch: this.renderer.clientToPitch(event.clientX, event.clientY),
        starts,
        positions: structuredClone(starts),
      };
      return;
    }

    if (annotationElement) {
      const id = annotationElement.dataset.annotationId;
      this.onSelection([id]);
      this.mode = {
        type: "annotation-drag",
        id,
        startPitch: this.renderer.clientToPitch(event.clientX, event.clientY),
        endPitch: this.renderer.clientToPitch(event.clientX, event.clientY),
      };
      return;
    }

    const bounds = this.viewport.getBoundingClientRect();
    const start = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    this.mode = { type: "marquee", start };
    this.updateMarquee(start, start);
  }

  pointerMove(event) {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const state = this.getState();
    if (!this.mode) {
      if (state.ui.activeTool === "path") this.onPathPreview?.(this.renderer.clientToPitch(event.clientX, event.clientY));
      return;
    }

    if (this.mode.type === "pinch" && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const zoom = clamp(this.mode.zoom * (pointerDistance(a, b) / Math.max(1, this.mode.distance)), 0.55, 3);
      this.onViewportChange({ zoom });
    } else if (this.mode.type === "pan") {
      this.onViewportChange({
        pan: {
          x: this.mode.pan.x + event.clientX - this.mode.start.x,
          y: this.mode.pan.y + event.clientY - this.mode.start.y,
        },
      });
    } else if (this.mode.type === "drag") {
      const current = this.renderer.clientToPitch(event.clientX, event.clientY);
      const delta = { x: current.x - this.mode.startPitch.x, y: current.y - this.mode.startPitch.y };
      const pitch = state.board.document.pitch;
      this.mode.positions = Object.fromEntries(Object.entries(this.mode.starts).map(([id, start]) => [
        id,
        clampToPitch({ x: start.x + delta.x, y: start.y + delta.y, z: start.z || 0 }, pitch),
      ]));
      this.renderer.previewEntityPositions(this.mode.positions);
    } else if (this.mode.type === "draw") {
      this.mode.endPitch = this.renderer.clientToPitch(event.clientX, event.clientY);
    } else if (this.mode.type === "annotation-drag") {
      this.mode.endPitch = this.renderer.clientToPitch(event.clientX, event.clientY);
      this.renderer.previewAnnotationMove(this.mode.id, this.mode.startPitch, this.mode.endPitch);
    } else if (this.mode.type === "annotation-resize") {
      this.mode.endPitch = this.renderer.clientToPitch(event.clientX, event.clientY);
      this.renderer.previewAnnotationResize(this.mode.id, this.mode.handle, this.mode.endPitch);
    } else if (this.mode.type === "marquee") {
      const bounds = this.viewport.getBoundingClientRect();
      this.updateMarquee(this.mode.start, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    }
  }

  pointerUp(event) {
    this.pointers.delete(event.pointerId);
    if (!this.mode) return;
    if (this.mode.type === "drag") {
      this.onMove(this.mode.starts, this.mode.positions);
    } else if (this.mode.type === "draw") {
      this.onDraw?.(this.mode.tool, this.mode.startPitch, this.mode.endPitch);
    } else if (this.mode.type === "annotation-drag") {
      this.onAnnotationMove?.(this.mode.id, this.mode.startPitch, this.mode.endPitch);
    } else if (this.mode.type === "annotation-resize") {
      this.onAnnotationResize?.(this.mode.id, this.mode.handle, this.mode.endPitch);
    } else if (this.mode.type === "marquee") {
      const rect = this.marquee.getBoundingClientRect();
      this.onSelection(this.renderer.entitiesInScreenRect(rect));
      this.marquee.hidden = true;
    }
    if (this.mode.type !== "pinch" || this.pointers.size < 2) this.mode = null;
  }

  updateMarquee(start, end) {
    this.marquee.hidden = false;
    this.marquee.style.left = `${Math.min(start.x, end.x)}px`;
    this.marquee.style.top = `${Math.min(start.y, end.y)}px`;
    this.marquee.style.width = `${Math.abs(end.x - start.x)}px`;
    this.marquee.style.height = `${Math.abs(end.y - start.y)}px`;
  }

  wheel(event) {
    event.preventDefault();
    const state = this.getState();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    this.onViewportChange({ zoom: clamp(state.ui.zoom * factor, 0.55, 3) });
  }

  drop(event) {
    event.preventDefault();
    const raw = event.dataTransfer?.getData("application/x-koru-player");
    if (!raw) return;
    try {
      this.onDropPlayer(JSON.parse(raw), this.renderer.clientToPitch(event.clientX, event.clientY));
    } catch {
      return;
    }
  }
}
