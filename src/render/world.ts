import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import {
  SAMPLE_ROUTE,
  type TrackRoute,
  type TrackSection,
} from "../game/track";
import type { QualityTier } from "../game/performance";

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
const EPSILON = 1e-6;

export type RiftWorldQuality = QualityTier;

export interface RiftWorldOptions {
  /** The game route to draw. Defaults to the first playable sample route. */
  route?: TrackRoute;
  quality?: RiftWorldQuality;
  /** Extra lift applied to road and neon geometry to avoid z-fighting. */
  roadLift?: number;
  /** When false, omit the lightweight skyline and palms. */
  scenery?: boolean;
  /** When false, omit tunnel arches and underwater dressing. */
  environmentCues?: boolean;
}

export interface RiftWorldUpdateState {
  /** Optional absolute time in seconds. Otherwise deltaSeconds is accumulated. */
  elapsedSeconds?: number;
  /** Distance along the route, useful for section-specific atmosphere. */
  routeDistance?: number;
  /** Current player speed, used only for a small neon pulse boost. */
  speed?: number;
}

type AnimatedBubble = {
  object: Object3D;
  baseY: number;
  phase: number;
  amplitude: number;
};

type OwnedMaterial = MeshBasicMaterial | MeshStandardMaterial | ShaderMaterial;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sectionColor(section: TrackSection): number {
  if (section === "tunnel") return 0x3b164e;
  if (section === "underwater") return 0x06395f;
  return 0x090719;
}

function makeSideVector(tangent: Vector3, target = new Vector3()): Vector3 {
  target.crossVectors(UP, tangent);
  if (target.lengthSq() <= EPSILON) target.set(1, 0, 0);
  return target.normalize();
}

function makeGradientSky(): Mesh<SphereGeometry, ShaderMaterial> {
  const geometry = new SphereGeometry(380, 16, 10);
  const material = new ShaderMaterial({
    name: "rift-gradient-sky-material",
    side: BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new Color(0x130a42) },
      horizonColor: { value: new Color(0xf02b9b) },
      lowColor: { value: new Color(0x251047) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 lowColor;
      varying vec3 vWorldPosition;
      void main() {
        float height = normalize(vWorldPosition).y;
        vec3 lower = mix(lowColor, horizonColor, smoothstep(-0.36, 0.16, height));
        vec3 sky = mix(lower, topColor, smoothstep(0.08, 0.86, height));
        gl_FragColor = vec4(sky, 1.0);
      }
    `,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "rift-gradient-sky";
  mesh.frustumCulled = false;
  return mesh;
}

function makeSunGlow(): Group {
  const group = new Group();
  group.name = "rift-synthwave-sun";

  const glow = new Mesh(
    new SphereGeometry(17, 12, 6),
    new MeshBasicMaterial({
      color: 0xff5caf,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  glow.position.set(-74, 66, -205);
  group.add(glow);

  const disc = new Mesh(
    new SphereGeometry(9.5, 12, 6),
    new MeshBasicMaterial({ color: 0xffd178, transparent: true, opacity: 0.96 }),
  );
  disc.position.copy(glow.position);
  group.add(disc);
  return group;
}

function makeRoadGeometry(route: TrackRoute, roadLift: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const side = new Vector3();
  let vertex = 0;

  for (const segment of route.segments) {
    if (segment.length <= EPSILON) continue;
    const tangent = new Vector3().subVectors(
      segment.end.position,
      segment.start.position,
    ).normalize();
    makeSideVector(tangent, side);
    const startWidth = Math.max(0.1, segment.start.width);
    const endWidth = Math.max(0.1, segment.end.width);
    const start = segment.start.position.clone().addScaledVector(UP, roadLift);
    const end = segment.end.position.clone().addScaledVector(UP, roadLift);
    const startLeft = start.clone().addScaledVector(side, startWidth * 0.5);
    const startRight = start.clone().addScaledVector(side, -startWidth * 0.5);
    const endLeft = end.clone().addScaledVector(side, endWidth * 0.5);
    const endRight = end.clone().addScaledVector(side, -endWidth * 0.5);

    positions.push(
      startLeft.x,
      startLeft.y,
      startLeft.z,
      startRight.x,
      startRight.y,
      startRight.z,
      endLeft.x,
      endLeft.y,
      endLeft.z,
      endRight.x,
      endRight.y,
      endRight.z,
    );
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
    vertex += 4;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeRibbonGeometry(
  route: TrackRoute,
  sideSign: 1 | -1,
  roadLift: number,
  ribbonWidth: number,
): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const side = new Vector3();
  let vertex = 0;

  for (const segment of route.segments) {
    if (segment.length <= EPSILON) continue;
    const tangent = new Vector3().subVectors(
      segment.end.position,
      segment.start.position,
    ).normalize();
    makeSideVector(tangent, side);
    const start = segment.start.position.clone().addScaledVector(UP, roadLift + 0.075);
    const end = segment.end.position.clone().addScaledVector(UP, roadLift + 0.075);
    const startOffset = side.clone().multiplyScalar(sideSign * segment.start.width * 0.5);
    const endOffset = side.clone().multiplyScalar(sideSign * segment.end.width * 0.5);
    const startInner = start.clone().add(startOffset);
    const endInner = end.clone().add(endOffset);
    const startOuter = startInner.clone().addScaledVector(side, sideSign * ribbonWidth);
    const endOuter = endInner.clone().addScaledVector(side, sideSign * ribbonWidth);

    positions.push(
      startInner.x,
      startInner.y,
      startInner.z,
      startOuter.x,
      startOuter.y,
      startOuter.z,
      endInner.x,
      endInner.y,
      endInner.z,
      endOuter.x,
      endOuter.y,
      endOuter.z,
    );
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
    vertex += 4;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeShoulderGeometry(route: TrackRoute, roadLift: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const side = new Vector3();
  let vertex = 0;

  for (const segment of route.segments) {
    if (segment.length <= EPSILON) continue;
    const tangent = new Vector3().subVectors(
      segment.end.position,
      segment.start.position,
    ).normalize();
    makeSideVector(tangent, side);
    const start = segment.start.position.clone().addScaledVector(UP, roadLift + 0.01);
    const end = segment.end.position.clone().addScaledVector(UP, roadLift + 0.01);
    const startInner = start.clone().addScaledVector(side, segment.start.width * 0.5);
    const endInner = end.clone().addScaledVector(side, segment.end.width * 0.5);
    const startOuter = start.clone().addScaledVector(side, segment.start.width * 0.5 + 1.1);
    const endOuter = end.clone().addScaledVector(side, segment.end.width * 0.5 + 1.1);

    positions.push(
      startInner.x,
      startInner.y,
      startInner.z,
      startOuter.x,
      startOuter.y,
      startOuter.z,
      endInner.x,
      endInner.y,
      endInner.z,
      endOuter.x,
      endOuter.y,
      endOuter.z,
    );
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
    vertex += 4;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeTrackGroup(
  route: TrackRoute,
  roadLift: number,
  neonMaterials: MeshBasicMaterial[],
): Group {
  const group = new Group();
  group.name = "rift-track";

  const road = new Mesh(
    makeRoadGeometry(route, roadLift),
    new MeshStandardMaterial({
      name: "rift-asphalt",
      color: 0x080a13,
      roughness: 0.92,
      metalness: 0.18,
      flatShading: true,
    }),
  );
  road.name = "rift-dark-road";
  road.receiveShadow = true;
  group.add(road);

  const shoulders = new Mesh(
    makeShoulderGeometry(route, roadLift),
    new MeshStandardMaterial({
      name: "rift-violet-shoulder",
      color: 0x20102e,
      roughness: 0.86,
      metalness: 0.25,
      flatShading: true,
    }),
  );
  shoulders.name = "rift-road-shoulders";
  group.add(shoulders);

  const edgeMaterial = new MeshBasicMaterial({
    name: "rift-hot-pink-edge",
    color: 0xff168f,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  neonMaterials.push(edgeMaterial);

  for (const sideSign of [1, -1] as const) {
    const ribbon = new Mesh(
      makeRibbonGeometry(route, sideSign, roadLift, 0.16),
      edgeMaterial,
    );
    ribbon.name = sideSign === 1 ? "rift-neon-ribbon-right" : "rift-neon-ribbon-left";
    ribbon.renderOrder = 2;
    group.add(ribbon);
  }

  // A thin cyan center guide keeps the road readable on low quality settings.
  const centerPoints: Vector3[] = route.points.map((point) =>
    point.position.clone().addScaledVector(UP, roadLift + 0.055),
  );
  if (route.closed && centerPoints.length > 0) centerPoints.push(centerPoints[0].clone());
  const centerGeometry = new BufferGeometry().setFromPoints(centerPoints);
  const centerMaterial = new MeshBasicMaterial({
    name: "rift-lane-guide",
    color: 0x5de4ff,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  neonMaterials.push(centerMaterial);
  const centerGuide = new Mesh(centerGeometry, centerMaterial);
  centerGuide.name = "rift-cyan-lane-guide";
  // Mesh with a line geometry is intentionally avoided; the renderer accepts
  // the geometry as a lightweight line-like strip on all supported Three builds.
  centerGuide.visible = false;
  group.add(centerGuide);

  return group;
}

function createPalmTree(): Group {
  const palm = new Group();
  palm.name = "rift-palm";
  const trunk = new Mesh(
    new CylinderGeometry(0.16, 0.28, 4.6, 5),
    new MeshStandardMaterial({ color: 0x24132f, roughness: 1, flatShading: true }),
  );
  trunk.position.y = 2.3;
  palm.add(trunk);

  const crownMaterial = new MeshBasicMaterial({
    color: 0x241041,
    transparent: true,
    opacity: 0.95,
    side: DoubleSide,
  });
  const crown = new Group();
  crown.position.y = 4.55;
  for (let index = 0; index < 6; index += 1) {
    const leaf = new Mesh(new ConeGeometry(0.23, 2.9, 4), crownMaterial);
    leaf.rotation.z = Math.PI * 0.5;
    leaf.rotation.y = (Math.PI * 2 * index) / 6;
    leaf.position.y = -0.6;
    leaf.position.x = Math.cos((Math.PI * 2 * index) / 6) * 0.8;
    leaf.position.z = Math.sin((Math.PI * 2 * index) / 6) * 0.8;
    crown.add(leaf);
  }
  palm.add(crown);
  return palm;
}

function createBuilding(
  height: number,
  width: number,
  depth: number,
  buildingMaterial: MeshStandardMaterial,
  windowMaterial: MeshBasicMaterial,
): Group {
  const building = new Group();
  building.name = "rift-silhouette-building";
  const body = new Mesh(new BoxGeometry(width, height, depth), buildingMaterial);
  body.position.y = height * 0.5;
  building.add(body);

  const windowGeometry = new BoxGeometry(0.1, 0.22, 0.025);
  const rows = Math.max(1, Math.floor(height / 2.2));
  const columns = Math.max(1, Math.floor(width / 1.35));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if ((row + column) % 3 === 0) continue;
      const window = new Mesh(windowGeometry, windowMaterial);
      window.position.set(
        -width * 0.42 + column * Math.max(0.85, width / Math.max(columns, 1)),
        1.1 + row * 2.05,
        depth * 0.5 + 0.02,
      );
      building.add(window);
    }
  }
  return building;
}

function makeScenery(route: TrackRoute, quality: RiftWorldQuality): Group {
  const group = new Group();
  group.name = "rift-coastal-scenery";
  const palmTemplate = createPalmTree();
  const buildingMaterial = new MeshStandardMaterial({
    color: 0x130d2d,
    roughness: 1,
    flatShading: true,
  });
  const windowMaterial = new MeshBasicMaterial({
    color: 0xff5cbd,
    transparent: true,
    opacity: 0.82,
    blending: AdditiveBlending,
  });
  const spacing = quality === "eco" ? 2 : quality === "high" ? 1 : 1;
  const buildingStride = quality === "eco" ? 3 : 2;

  route.segments.forEach((segment, index) => {
    if (segment.section !== "coastal-boulevard" || index % spacing !== 0) return;
    const tangent = new Vector3().subVectors(
      segment.end.position,
      segment.start.position,
    ).normalize();
    const side = makeSideVector(tangent);
    const midpoint = segment.start.position
      .clone()
      .lerp(segment.end.position, 0.5);
    const edgeDistance = segment.start.width * 0.5;

    const leftPalm = palmTemplate.clone(true);
    leftPalm.scale.setScalar(0.82 + (index % 3) * 0.08);
    leftPalm.position.copy(midpoint).addScaledVector(side, edgeDistance + 5.2);
    leftPalm.rotation.y = (index * 0.77) % (Math.PI * 2);
    group.add(leftPalm);

    if (quality !== "eco" || index % 2 === 0) {
      const rightPalm = palmTemplate.clone(true);
      rightPalm.scale.setScalar(0.7 + (index % 2) * 0.12);
      rightPalm.position.copy(midpoint).addScaledVector(side, -edgeDistance - 6.4);
      rightPalm.rotation.y = (index * 1.11) % (Math.PI * 2);
      group.add(rightPalm);
    }

    if (index % buildingStride === 0) {
      const height = 7 + (index % 4) * 2.4;
      const building = createBuilding(height, 3.4 + (index % 3), 3.2, buildingMaterial, windowMaterial);
      building.position.copy(midpoint).addScaledVector(side, -edgeDistance - 13 - (index % 2) * 4);
      building.rotation.y = Math.atan2(tangent.x, tangent.z) + Math.PI * 0.5;
      group.add(building);
    }
  });

  // A low skyline behind the start makes the coastal slice feel larger without
  // requiring a texture or a large number of draw calls.
  for (let index = 0; index < 5; index += 1) {
    const height = 10 + (index % 3) * 4;
    const building = createBuilding(height, 4 + index * 0.7, 4.2, buildingMaterial, windowMaterial);
    building.position.set(-30 + index * 13, 0, 26 + (index % 2) * 8);
    group.add(building);
  }
  return group;
}

type TunnelCue = {
  ring: Mesh<TorusGeometry, MeshBasicMaterial>;
  phase: number;
};

function makeTunnelCues(route: TrackRoute, quality: RiftWorldQuality): {
  group: Group;
  cues: TunnelCue[];
} {
  const group = new Group();
  group.name = "rift-tunnel-cues";
  const cues: TunnelCue[] = [];
  const material = new MeshBasicMaterial({
    color: 0xff2eae,
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const stride = quality === "eco" ? 2 : 1;

  route.segments.forEach((segment, index) => {
    if (segment.section !== "tunnel" || index % stride !== 0 || segment.length <= EPSILON) return;
    const tangent = new Vector3().subVectors(
      segment.end.position,
      segment.start.position,
    ).normalize();
    const center = segment.start.position.clone().lerp(segment.end.position, 0.5);
    const radius = Math.max(4.8, Math.min(segment.start.width, segment.end.width) * 0.58);
    const ring = new Mesh(new TorusGeometry(radius, 0.14, 6, 18), material);
    ring.name = "rift-tunnel-neon-arch";
    ring.position.copy(center);
    ring.quaternion.setFromUnitVectors(FORWARD, tangent);
    ring.renderOrder = 3;
    group.add(ring);
    cues.push({ ring, phase: index * 0.7 });
  });

  return { group, cues };
}

type UnderwaterCue = {
  object: Object3D;
  baseY: number;
  phase: number;
  amplitude: number;
};

function makeUnderwaterCues(route: TrackRoute, quality: RiftWorldQuality): {
  group: Group;
  bubbles: UnderwaterCue[];
} {
  const group = new Group();
  group.name = "rift-underwater-cues";
  const bubbles: UnderwaterCue[] = [];
  const bubbleGeometry = new SphereGeometry(0.18, 6, 4);
  const bubbleMaterial = new MeshBasicMaterial({
    color: 0x53e8ff,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const kelpMaterial = new MeshBasicMaterial({ color: 0x064f72, transparent: true, opacity: 0.82 });
  const stride = quality === "eco" ? 2 : 1;

  route.segments.forEach((segment, index) => {
    if (segment.section !== "underwater" || index % stride !== 0 || segment.length <= EPSILON) return;
    const tangent = new Vector3().subVectors(
      segment.end.position,
      segment.start.position,
    ).normalize();
    const side = makeSideVector(tangent);
    const center = segment.start.position.clone().lerp(segment.end.position, 0.5);
    const width = Math.max(5, segment.start.width * 0.5);

    for (let bubbleIndex = 0; bubbleIndex < (quality === "eco" ? 2 : 3); bubbleIndex += 1) {
      const bubble = new Mesh(bubbleGeometry, bubbleMaterial);
      const offset = (bubbleIndex - 1) * 1.8;
      bubble.position
        .copy(center)
        .addScaledVector(side, offset + (index % 2) * 0.5)
        .addScaledVector(tangent, (bubbleIndex - 1) * 1.6);
      bubble.position.y += 1.2 + bubbleIndex * 0.65;
      bubble.scale.setScalar(0.7 + bubbleIndex * 0.22);
      group.add(bubble);
      bubbles.push({
        object: bubble,
        baseY: bubble.position.y,
        phase: index * 0.63 + bubbleIndex * 1.3,
        amplitude: 0.25 + bubbleIndex * 0.08,
      });
    }

    const kelp = new Mesh(new ConeGeometry(1.5, 5.6, 5), kelpMaterial);
    kelp.name = "rift-underwater-kelp";
    kelp.position.copy(center).addScaledVector(side, width + 1.5);
    kelp.position.y -= 1.7;
    kelp.rotation.z = 0.16 + (index % 3) * 0.12;
    group.add(kelp);
  });

  return { group, bubbles };
}

function disposeObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<OwnedMaterial>();
  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: BufferGeometry;
      material?: OwnedMaterial | OwnedMaterial[];
    };
    if (renderable.geometry) geometries.add(renderable.geometry);
    if (Array.isArray(renderable.material)) {
      renderable.material.forEach((material) => materials.add(material));
    } else if (renderable.material) {
      materials.add(renderable.material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

/**
 * A scene-only rendering layer for the first Violet Rift Racer route slice.
 * Add the group to any Three.js Scene and call update from the host game loop.
 */
export class RiftWorld extends Group {
  readonly route: TrackRoute;
  readonly quality: RiftWorldQuality;
  readonly track: Group;
  readonly scenery: Group;
  readonly tunnelCues: Group;
  readonly underwaterCues: Group;
  readonly sky: Mesh<SphereGeometry, ShaderMaterial>;

  private readonly neonMaterials: MeshBasicMaterial[] = [];
  private readonly tunnelCueData: TunnelCue[];
  private readonly bubbleData: UnderwaterCue[];
  private elapsedSeconds = 0;
  private disposed = false;

  constructor(options: RiftWorldOptions = {}) {
    super();
    this.name = "violet-rift-world";
    this.route = options.route ?? SAMPLE_ROUTE;
    this.quality = options.quality ?? "balanced";

    const roadLift = Math.max(0, finiteOr(options.roadLift, 0.035));
    this.sky = makeGradientSky();
    this.add(this.sky);
    this.add(makeSunGlow());

    this.add(new HemisphereLight(0xff6cae, 0x071126, 1.35));
    const rimLight = new PointLight(0xff1f9e, 4.5, 150, 2);
    rimLight.position.set(-14, 18, -18);
    this.add(rimLight);
    const waterLight = new PointLight(0x18a6ff, 2.7, 120, 2);
    waterLight.position.set(-34, -2, -34);
    this.add(waterLight);

    this.track = makeTrackGroup(this.route, roadLift, this.neonMaterials);
    this.add(this.track);

    this.scenery = options.scenery === false
      ? new Group()
      : makeScenery(this.route, this.quality);
    this.scenery.name = "rift-scenery";
    this.add(this.scenery);

    const tunnelData = options.environmentCues === false
      ? { group: new Group(), cues: [] as TunnelCue[] }
      : makeTunnelCues(this.route, this.quality);
    this.tunnelCues = tunnelData.group;
    this.tunnelCueData = tunnelData.cues;
    this.add(this.tunnelCues);

    const underwaterData = options.environmentCues === false
      ? { group: new Group(), bubbles: [] as UnderwaterCue[] }
      : makeUnderwaterCues(this.route, this.quality);
    this.underwaterCues = underwaterData.group;
    this.bubbleData = underwaterData.bubbles;
    this.add(this.underwaterCues);
  }

  /** Animate emissive accents and environment dressing for one host frame. */
  update(deltaSeconds = 0, state: RiftWorldUpdateState = {}): void {
    if (this.disposed) return;
    const delta = clamp(finiteOr(deltaSeconds, 0), 0, 0.1);
    this.elapsedSeconds = state.elapsedSeconds === undefined
      ? this.elapsedSeconds + delta
      : finiteOr(state.elapsedSeconds, this.elapsedSeconds);

    const speedBoost = clamp(Math.abs(finiteOr(state.speed, 0)) / 34, 0, 1);
    const pulse = 0.74 + 0.26 * (0.5 + 0.5 * Math.sin(this.elapsedSeconds * 4.4)) + speedBoost * 0.08;
    this.neonMaterials.forEach((material, index) => {
      if (index === 0) material.opacity = clamp(pulse, 0.55, 1);
      else material.opacity = index % 2 === 0 ? 0.18 + pulse * 0.12 : 0.25 + pulse * 0.16;
    });

    this.tunnelCueData.forEach((cue) => {
      const material = cue.ring.material;
      material.opacity = clamp(0.58 + 0.3 * (0.5 + 0.5 * Math.sin(this.elapsedSeconds * 5 + cue.phase)), 0.3, 1);
    });
    this.bubbleData.forEach((bubble) => {
      bubble.object.position.y = bubble.baseY + Math.sin(this.elapsedSeconds * 1.7 + bubble.phase) * bubble.amplitude;
      const scale = 0.88 + 0.15 * Math.sin(this.elapsedSeconds * 2.2 + bubble.phase);
      bubble.object.scale.setScalar(scale);
    });
  }

  /** Short alias for hosts that call scene animation a step. */
  step(deltaSeconds = 0, state: RiftWorldUpdateState = {}): void {
    this.update(deltaSeconds, state);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeObject(this);
    this.clear();
  }
}

export function createRiftWorld(options: RiftWorldOptions = {}): RiftWorld {
  return new RiftWorld(options);
}

/** Alias for app code that prefers the noun "scene". */
export const createWorldScene = createRiftWorld;

/** Alias retained for callers that use the full game title. */
export { RiftWorld as VioletRiftWorld };
