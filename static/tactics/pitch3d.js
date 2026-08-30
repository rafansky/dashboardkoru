import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { pitchTo3D } from "./geometry.js?v=20260829b";

const VIEW_RECTS = {
  full: { x: 0, y: 0, width: 105, height: 68 },
  half: { x: 52.5, y: 0, width: 52.5, height: 68 },
  "attacking-third": { x: 70, y: 0, width: 35, height: 68 },
  "defensive-third": { x: 0, y: 0, width: 35, height: 68 },
  "penalty-area": { x: 86.5, y: 10, width: 18.5, height: 48 },
  corner: { x: 94.5, y: 0, width: 10.5, height: 10.5 },
};

function disposeTree(root) {
  root.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => {
      Object.values(material).forEach((value) => value?.isTexture && value.dispose?.());
      material.dispose?.();
    });
  });
  root.clear();
}

function addLine(group, points, color = 0xeaf5ed, opacity = 0.72) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const line = new THREE.Line(geometry, material);
  group.add(line);
  return line;
}

function point3(point, pitch, height = 0.12) {
  const value = pitchTo3D(point, pitch);
  return new THREE.Vector3(value.x, height + (value.y || 0), value.z);
}

function addPitchRectangle(group, pitch, x, y, width, height, color, opacity) {
  const points = [
    point3({ x, y }, pitch),
    point3({ x: x + width, y }, pitch),
    point3({ x: x + width, y: y + height }, pitch),
    point3({ x, y: y + height }, pitch),
    point3({ x, y }, pitch),
  ];
  addLine(group, points, color, opacity);
}

function addPitchCircle(group, pitch, center, radius, color = 0xeaf5ed, opacity = 0.72, start = 0, end = Math.PI * 2) {
  const points = [];
  for (let index = 0; index <= 72; index += 1) {
    const angle = start + (end - start) * (index / 72);
    points.push(point3({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }, pitch));
  }
  addLine(group, points, color, opacity);
}

function makeTextTexture(text, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `900 ${options.fontSize || 58}px Inter, Arial`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.strokeStyle = options.stroke || "rgba(5, 8, 11, .96)";
  context.lineWidth = options.lineWidth || 18;
  context.strokeText(text, 256, 65);
  context.fillStyle = options.color || "#ffffff";
  context.fillText(text, 256, 65);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function makePlayerTexture(entity, team, anonymizePlayers) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  const primary = team?.primaryColor || "#f7f8fb";
  const secondary = team?.secondaryColor || "#f95516";
  const drawFrame = () => {
    context.save();
    context.beginPath();
    context.arc(128, 128, 108, 0, Math.PI * 2);
    context.lineWidth = 18;
    context.strokeStyle = secondary;
    context.stroke();
    context.restore();
    context.beginPath();
    context.arc(188, 190, 42, 0, Math.PI * 2);
    context.fillStyle = secondary;
    context.fill();
    context.lineWidth = 8;
    context.strokeStyle = "#ffffff";
    context.stroke();
    context.fillStyle = "#ffffff";
    context.font = "900 45px Inter, Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(entity.number ?? ""), 188, 195);
  };
  context.beginPath();
  context.arc(128, 128, 108, 0, Math.PI * 2);
  context.fillStyle = primary;
  context.fill();
  context.fillStyle = primary.toLowerCase() === "#f7f8fb" ? "#20252c" : "#ffffff";
  context.font = "900 92px Inter, Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(entity.number ?? ""), 128, 132);
  drawFrame();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const avatarUrl = entity.metadata?.avatarUrl;
  if (avatarUrl && /^(\/uploads\/|\/imageneskoru\/|\/assets\/)/.test(avatarUrl)) {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      context.clearRect(0, 0, 256, 256);
      context.save();
      context.beginPath();
      context.arc(128, 128, 101, 0, Math.PI * 2);
      context.clip();
      const scale = Math.max(202 / image.width, 202 / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(image, 128 - width / 2, 128 - height / 2, width, height);
      context.restore();
      drawFrame();
      texture.needsUpdate = true;
    };
    image.src = avatarUrl;
  }
  texture.userData = { label: anonymizePlayers ? `Jugador ${entity.number ?? ""}` : entity.name };
  return texture;
}

function createSprite(texture, width, height, depthTest = true) {
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  return sprite;
}

function createCylinderBetween(start, end, radius, color, opacity = 1) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, Math.max(0.01, length), 12);
  const material = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function createArrow(start, end, color) {
  const group = new THREE.Group();
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < 0.1) return group;
  const unit = direction.clone().normalize();
  const headLength = Math.min(2.5, Math.max(1.1, length * 0.18));
  const shaftEnd = end.clone().addScaledVector(unit, -headLength * 0.72);
  group.add(createCylinderBetween(start, shaftEnd, 0.18, color));
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.72, headLength, 18), new THREE.MeshBasicMaterial({ color }));
  head.position.copy(end).addScaledVector(unit, -headLength / 2);
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit);
  group.add(head);
  return group;
}

function currentViewRect(pitch) {
  const source = VIEW_RECTS[pitch.view] || VIEW_RECTS.full;
  return {
    x: source.x * (pitch.width / 105),
    y: source.y * (pitch.height / 68),
    width: source.width * (pitch.width / 105),
    height: source.height * (pitch.height / 68),
  };
}

export class Pitch3DRenderer {
  constructor(container, options = {}) {
    this.container = container;
    this.onSelection = options.onSelection;
    this.document = null;
    this.annotations = [];
    this.movementPaths = [];
    this.layers = { home: true, away: true, ball: true, names: true, annotations: true, markings: true };
    this.selectedIds = new Set();
    this.entities = new Map();
    this.pickables = [];
    this.active = false;
    this.cameraKey = "";
    this.pointerStart = null;

    this.root = document.createElement("div");
    this.root.className = "tactical-pitch-3d";
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080b0e);
    this.scene.fog = new THREE.Fog(0x080b0e, 105, 210);
    this.camera = new THREE.PerspectiveCamera(39, 1, 0.1, 500);
    this.webgl = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.webgl.toneMappingExposure = 1.12;
    this.webgl.domElement.className = "tactical-pitch-3d-canvas";
    this.webgl.domElement.setAttribute("aria-label", "Campo tactico 3D");
    this.webgl.domElement.setAttribute("role", "img");
    this.root.append(this.webgl.domElement);
    this.container.append(this.root);

    this.controls = new OrbitControls(this.camera, this.webgl.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 22;
    this.controls.maxDistance = 210;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.screenSpacePanning = false;

    this.scene.add(new THREE.HemisphereLight(0xddeeff, 0x122218, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(-35, 70, 28);
    this.scene.add(keyLight);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.webgl.domElement.addEventListener("pointerdown", (event) => {
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
    this.webgl.domElement.addEventListener("pointerup", (event) => this.selectAtPointer(event));
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
  }

  setActive(active) {
    this.active = active;
    this.root.hidden = !active;
    this.controls.enabled = active;
    if (active) {
      this.resize();
      this.webgl.render(this.scene, this.camera);
    }
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.webgl.setSize(width, height, false);
  }

  render(documentData, annotations = [], movementPaths = []) {
    this.document = documentData;
    this.annotations = annotations;
    this.movementPaths = movementPaths;
    disposeTree(this.world);
    this.entities.clear();
    this.pickables = [];

    this.surfaceGroup = new THREE.Group();
    this.markingsGroup = new THREE.Group();
    this.annotationsGroup = new THREE.Group();
    this.homeGroup = new THREE.Group();
    this.awayGroup = new THREE.Group();
    this.ballGroup = new THREE.Group();
    this.world.add(this.surfaceGroup, this.markingsGroup, this.annotationsGroup, this.homeGroup, this.awayGroup, this.ballGroup);

    this.addSurface(documentData.pitch);
    this.addMarkings(documentData.pitch);
    this.addAnnotations(annotations, movementPaths, documentData.pitch);
    this.addEntities(documentData);
    this.setSelection(this.selectedIds);
    this.setLayers(this.layers);

    const nextCameraKey = `${documentData.pitch.width}:${documentData.pitch.height}:${documentData.pitch.view}:${documentData.pitch.orientation}`;
    if (this.cameraKey !== nextCameraKey) {
      this.cameraKey = nextCameraKey;
      this.resetCamera();
    }
    this.resize();
  }

  addSurface(pitch) {
    const outside = new THREE.Mesh(
      new THREE.PlaneGeometry(pitch.width + 34, pitch.height + 34),
      new THREE.MeshStandardMaterial({ color: 0x11181a, roughness: 1 }),
    );
    outside.rotation.x = -Math.PI / 2;
    outside.position.y = -0.08;
    this.surfaceGroup.add(outside);

    const stripeCount = pitch.surface === "stripes" ? 10 : 1;
    const stripeWidth = pitch.width / stripeCount;
    for (let index = 0; index < stripeCount; index += 1) {
      const color = pitch.surface === "stripes" && index % 2 ? 0x23784b : 0x1b6941;
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(stripeWidth + 0.02, pitch.height),
        new THREE.MeshStandardMaterial({ color, roughness: 0.94, metalness: 0 }),
      );
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(-pitch.width / 2 + stripeWidth * (index + 0.5), 0, 0);
      this.surfaceGroup.add(stripe);
    }
  }

  addMarkings(pitch) {
    const line = 0xeaf5ed;
    addPitchRectangle(this.markingsGroup, pitch, 0, 0, pitch.width, pitch.height, line, 0.76);
    addLine(this.markingsGroup, [point3({ x: pitch.width / 2, y: 0 }, pitch), point3({ x: pitch.width / 2, y: pitch.height }, pitch)], line, 0.76);
    addPitchCircle(this.markingsGroup, pitch, { x: pitch.width / 2, y: pitch.height / 2 }, 9.15, line, 0.76);

    const penaltyWidth = Math.min(40.32, pitch.height - 4);
    const goalWidth = Math.min(18.32, pitch.height - 8);
    const penaltyY = (pitch.height - penaltyWidth) / 2;
    const goalY = (pitch.height - goalWidth) / 2;
    addPitchRectangle(this.markingsGroup, pitch, 0, penaltyY, 16.5, penaltyWidth, line, 0.72);
    addPitchRectangle(this.markingsGroup, pitch, pitch.width - 16.5, penaltyY, 16.5, penaltyWidth, line, 0.72);
    addPitchRectangle(this.markingsGroup, pitch, 0, goalY, 5.5, goalWidth, line, 0.72);
    addPitchRectangle(this.markingsGroup, pitch, pitch.width - 5.5, goalY, 5.5, goalWidth, line, 0.72);
    addPitchCircle(this.markingsGroup, pitch, { x: 11, y: pitch.height / 2 }, 0.38, line, 0.9);
    addPitchCircle(this.markingsGroup, pitch, { x: pitch.width - 11, y: pitch.height / 2 }, 0.38, line, 0.9);
    addPitchCircle(this.markingsGroup, pitch, { x: pitch.width / 2, y: pitch.height / 2 }, 0.38, line, 0.9);

    this.addGoal(pitch, 0, -1);
    this.addGoal(pitch, pitch.width, 1);
    this.addOverlays(pitch);
  }

  addGoal(pitch, x, direction) {
    const zHalf = 3.66;
    const worldX = x - pitch.width / 2;
    const material = new THREE.MeshBasicMaterial({ color: 0xf4f7f8 });
    const postGeometry = new THREE.CylinderGeometry(0.09, 0.09, 2.44, 10);
    [-zHalf, zHalf].forEach((z) => {
      const post = new THREE.Mesh(postGeometry, material.clone());
      post.position.set(worldX, 1.22, z);
      this.markingsGroup.add(post);
    });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, zHalf * 2, 10), material.clone());
    bar.rotation.x = Math.PI / 2;
    bar.position.set(worldX, 2.44, 0);
    this.markingsGroup.add(bar);
    const depth = 2.1;
    [-zHalf, zHalf].forEach((z) => {
      addLine(this.markingsGroup, [new THREE.Vector3(worldX, 2.44, z), new THREE.Vector3(worldX + direction * depth, 0.08, z)], 0xeaf5ed, 0.5);
    });
  }

  addOverlays(pitch) {
    if (pitch.overlays?.includes("thirds")) {
      [1, 2].forEach((third) => addLine(this.markingsGroup, [point3({ x: pitch.width * third / 3, y: 0 }, pitch, 0.16), point3({ x: pitch.width * third / 3, y: pitch.height }, pitch, 0.16)], 0xfacc15, 0.48));
    }
    if (pitch.overlays?.includes("five-lanes")) {
      [1, 2, 3, 4].forEach((lane) => addLine(this.markingsGroup, [point3({ x: 0, y: pitch.height * lane / 5 }, pitch, 0.17), point3({ x: pitch.width, y: pitch.height * lane / 5 }, pitch, 0.17)], 0x12d6df, 0.38));
    }
    if (pitch.overlays?.includes("grid")) {
      for (let x = 10; x < pitch.width; x += 10) addLine(this.markingsGroup, [point3({ x, y: 0 }, pitch, 0.15), point3({ x, y: pitch.height }, pitch, 0.15)], 0xffffff, 0.16);
      for (let y = 10; y < pitch.height; y += 10) addLine(this.markingsGroup, [point3({ x: 0, y }, pitch, 0.15), point3({ x: pitch.width, y }, pitch, 0.15)], 0xffffff, 0.16);
    }
  }

  addEntities(documentData) {
    const teams = Object.fromEntries(documentData.teams.map((team) => [team.id, team]));
    documentData.entities.filter((entity) => entity.visible).forEach((entity) => {
      if (entity.type === "player") this.addPlayer(entity, teams[entity.teamId] || teams.home, documentData);
      else if (entity.type === "ball") this.addBall(entity, documentData.pitch);
    });
  }

  addPlayer(entity, team, documentData) {
    const group = new THREE.Group();
    group.userData.entityId = entity.id;
    group.userData.type = "player";
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.35, 1.55, 0.42, 32),
      new THREE.MeshStandardMaterial({ color: team?.secondaryColor || "#f95516", roughness: 0.58 }),
    );
    base.position.y = 0.22;
    group.add(base);

    const playerSprite = createSprite(makePlayerTexture(entity, team, documentData.settings.anonymizePlayers), 5.4, 5.4, false);
    playerSprite.position.y = 3.1;
    playerSprite.renderOrder = 5;
    playerSprite.userData.entityId = entity.id;
    group.add(playerSprite);

    const labelText = documentData.settings.anonymizePlayers ? `Jugador ${entity.number ?? ""}` : entity.name;
    const label = createSprite(makeTextTexture(labelText), 9.5, 2.38, false);
    label.position.y = 6.05;
    label.renderOrder = 6;
    label.userData.isName = true;
    group.add(label);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(2.25, 0.16, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0xff6a2f, transparent: true, opacity: 0.95 }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.12;
    halo.visible = false;
    halo.userData.selectionHalo = true;
    group.add(halo);

    group.position.copy(point3(entity.position, documentData.pitch, 0));
    (entity.teamId === "away" ? this.awayGroup : this.homeGroup).add(group);
    this.entities.set(entity.id, group);
    this.pickables.push(base, playerSprite);
  }

  addBall(entity, pitch) {
    const group = new THREE.Group();
    group.userData.entityId = entity.id;
    group.userData.type = "ball";
    const texture = new THREE.TextureLoader().load("/assets/tactical-ball.png");
    texture.colorSpace = THREE.SRGBColorSpace;
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.92, 32, 22),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.62 }),
    );
    ball.position.y = 1.02;
    ball.userData.entityId = entity.id;
    group.add(ball);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.13, 10, 42),
      new THREE.MeshBasicMaterial({ color: 0xff6a2f, transparent: true, opacity: 0.95 }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.13;
    halo.visible = false;
    halo.userData.selectionHalo = true;
    group.add(halo);
    group.position.copy(point3(entity.position, pitch, 0));
    this.ballGroup.add(group);
    this.entities.set(entity.id, group);
    this.pickables.push(ball);
  }

  addAnnotations(annotations, movementPaths, pitch) {
    annotations.forEach((annotation) => {
      const color = new THREE.Color(annotation.color || "#f95516");
      if (annotation.type === "arrow") {
        this.annotationsGroup.add(createArrow(point3(annotation.start, pitch, 0.35), point3(annotation.end, pitch, 0.35), color));
      } else if (annotation.type === "zone") {
        const width = Math.max(0.2, Math.abs(annotation.end.x - annotation.start.x));
        const height = Math.max(0.2, Math.abs(annotation.end.y - annotation.start.y));
        const zone = new THREE.Mesh(
          new THREE.PlaneGeometry(width, height),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
        );
        zone.rotation.x = -Math.PI / 2;
        zone.position.copy(point3({ x: (annotation.start.x + annotation.end.x) / 2, y: (annotation.start.y + annotation.end.y) / 2 }, pitch, 0.2));
        this.annotationsGroup.add(zone);
      } else if (annotation.type === "text") {
        const text = createSprite(makeTextTexture(annotation.text || "Nota", { color: annotation.color || "#f95516" }), 12, 3, false);
        text.position.copy(point3(annotation.position, pitch, 2.2));
        text.renderOrder = 7;
        this.annotationsGroup.add(text);
      }
    });

    movementPaths.forEach((path) => {
      if (!path.points?.length) return;
      const color = new THREE.Color(path.color || "#f95516");
      const points = path.points.map((point) => point3(point, pitch, 0.28));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineDashedMaterial({ color, dashSize: 1.5, gapSize: 0.85, transparent: true, opacity: 0.95 });
      const line = new THREE.Line(geometry, material);
      line.computeLineDistances();
      this.annotationsGroup.add(line);
      if (points.length > 1) this.annotationsGroup.add(createArrow(points.at(-2), points.at(-1), color));
    });
  }

  setSelection(ids) {
    this.selectedIds = new Set(ids || []);
    this.entities.forEach((group, id) => {
      group.traverse((item) => {
        if (item.userData.selectionHalo) item.visible = this.selectedIds.has(id);
      });
    });
  }

  setLayers(layers = {}) {
    this.layers = { ...this.layers, ...layers };
    if (!this.homeGroup) return;
    this.homeGroup.visible = this.layers.home !== false;
    this.awayGroup.visible = this.layers.away !== false;
    this.ballGroup.visible = this.layers.ball !== false;
    this.annotationsGroup.visible = this.layers.annotations !== false;
    this.markingsGroup.visible = this.layers.markings !== false;
    this.entities.forEach((group) => group.traverse((item) => {
      if (item.userData.isName) item.visible = this.layers.names !== false;
    }));
  }

  previewEntityPositions(positions) {
    if (!this.document) return;
    Object.entries(positions).forEach(([id, position]) => {
      const group = this.entities.get(id);
      if (group) group.position.copy(point3(position, this.document.pitch, 0));
    });
  }

  resetCamera() {
    if (!this.document) return;
    const pitch = this.document.pitch;
    const rect = currentViewRect(pitch);
    const center = point3({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, pitch, 0);
    const span = Math.max(rect.width, rect.height, 28);
    const aspect = Math.max(0.45, this.camera.aspect || 1);
    const framingScale = Math.max(1.22, Math.min(1.9, 0.96 / aspect));
    const height = Math.max(24, span * 0.66 * framingScale);
    const depth = Math.max(31, span * 0.78 * framingScale);
    const offsets = {
      "top-to-bottom": new THREE.Vector3(depth, height, 0),
      "bottom-to-top": new THREE.Vector3(-depth, height, 0),
      "right-to-left": new THREE.Vector3(0, height, -depth),
      "left-to-right": new THREE.Vector3(0, height, depth),
    };
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(offsets[pitch.orientation] || offsets["left-to-right"]);
    this.camera.near = 0.1;
    this.camera.far = 500;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  selectAtPointer(event) {
    if (!this.active || !this.pointerStart || Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 6) return;
    const bounds = this.webgl.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hit = raycaster.intersectObjects(this.pickables, true)[0]?.object;
    let target = hit;
    while (target && !target.userData.entityId) target = target.parent;
    const id = target?.userData.entityId;
    if (!id) {
      this.onSelection?.([]);
      return;
    }
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const current = [...this.selectedIds];
    const selection = additive
      ? (this.selectedIds.has(id) ? current.filter((item) => item !== id) : [...current, id])
      : [id];
    this.onSelection?.(selection);
  }

  animate(time) {
    this.frame = requestAnimationFrame(this.animate);
    if (!this.active) return;
    this.controls.update();
    const pulse = 1 + Math.sin(time * 0.0045) * 0.09;
    this.entities.forEach((group) => group.traverse((item) => {
      if (item.userData.selectionHalo && item.visible) {
        item.scale.setScalar(pulse);
        item.material.opacity = 0.72 + Math.sin(time * 0.0045) * 0.22;
      }
    }));
    this.webgl.render(this.scene, this.camera);
  }
}
