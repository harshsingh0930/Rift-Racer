import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import {
  SAMPLE_ROUTE,
  type TrackRoute,
  type TrackSegment,
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

type DynamicLightData = {
  light: PointLight;
  baseIntensity: number;
  phase: number;
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

type RouteFrame = {
  side: Vector3;
  miterScale: number;
};

function segmentTangent(segment: Pick<TrackSegment, "start" | "end">, target = new Vector3()): Vector3 {
  target.subVectors(segment.end.position, segment.start.position);
  if (target.lengthSq() <= EPSILON) return target.set(0, 0, 1);
  return target.normalize();
}

function makeRouteFrames(route: TrackRoute): RouteFrame[] {
  const frames: RouteFrame[] = route.points.map(() => ({
    side: new Vector3(1, 0, 0),
    miterScale: 1,
  }));

  route.points.forEach((_point, pointIndex) => {
    const incomingIndex = route.closed
      ? (pointIndex - 1 + route.segments.length) % route.segments.length
      : pointIndex - 1;
    const outgoingIndex = route.closed ? pointIndex % route.segments.length : pointIndex;
    const incoming = incomingIndex >= 0 ? route.segments[incomingIndex] : undefined;
    const outgoing = outgoingIndex < route.segments.length
      ? route.segments[outgoingIndex]
      : undefined;
    const incomingTangent = incoming && incoming.length > EPSILON
      ? segmentTangent(incoming)
      : undefined;
    const outgoingTangent = outgoing && outgoing.length > EPSILON
      ? segmentTangent(outgoing)
      : undefined;
    const tangent = new Vector3();
    if (incomingTangent) tangent.add(incomingTangent);
    if (outgoingTangent) tangent.add(outgoingTangent);
    if (tangent.lengthSq() <= EPSILON) {
      tangent.copy(outgoingTangent ?? incomingTangent ?? FORWARD);
    } else {
      tangent.normalize();
    }

    const side = makeSideVector(tangent);
    const referenceTangent = outgoingTangent ?? incomingTangent ?? tangent;
    const referenceSide = makeSideVector(referenceTangent);
    // Clamp the miter so a very tight authored corner cannot throw the road
    // edge far outside the route and create a visible spike.
    const sideAlignment = Math.max(0.62, Math.abs(side.dot(referenceSide)));
    frames[pointIndex] = {
      side,
      miterScale: Math.min(1.55, 1 / sideAlignment),
    };
  });

  return frames;
}

function segmentPointIndices(route: TrackRoute, segmentIndex: number): [number, number] {
  const startIndex = segmentIndex;
  const endIndex = route.closed
    ? (startIndex + 1) % route.points.length
    : startIndex + 1;
  return [startIndex, endIndex];
}

function makeGradientSky(): Mesh<SphereGeometry, ShaderMaterial> {
  const geometry = new SphereGeometry(380, 16, 10);
  const material = new ShaderMaterial({
    name: "rift-gradient-sky-material",
    side: BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new Color(0x07091f) },
      horizonColor: { value: new Color(0x75476f) },
      lowColor: { value: new Color(0x0b1730) },
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
        vec3 viewDirection = normalize(vWorldPosition - cameraPosition);
        float height = viewDirection.y;
        vec3 lower = mix(lowColor, horizonColor, smoothstep(-0.38, 0.06, height));
        vec3 sky = mix(lower, topColor, smoothstep(0.02, 0.42, height));
        // A cooler haze band keeps the horizon atmospheric instead of turning
        // every distant surface into the same hot-pink value.
        float haze = 1.0 - smoothstep(0.02, 0.16, abs(height - 0.01));
        sky = mix(sky, vec3(0.16, 0.15, 0.30), haze * 0.13);
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
    new SphereGeometry(12, 12, 6),
    new MeshBasicMaterial({
      color: 0xff9b78,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  glow.position.set(104, 30, 20);
  group.add(glow);

  const disc = new Mesh(
    new SphereGeometry(6.2, 12, 6),
    new MeshBasicMaterial({ color: 0xffc984, transparent: true, opacity: 0.86 }),
  );
  disc.position.copy(glow.position);
  group.add(disc);
  return group;
}

function makeCoastalWater(): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const water = new Mesh(
    new PlaneGeometry(160, 82),
    new MeshBasicMaterial({
      name: "rift-coastal-water",
      color: 0x0a345b,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  water.name = "rift-coastal-water-surface";
  water.rotation.x = -Math.PI * 0.5;
  water.position.set(36, -0.42, 17);
  return water;
}

function makeRoadGeometry(route: TrackRoute, roadLift: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const frames = makeRouteFrames(route);
  let vertex = 0;

  for (const segment of route.segments) {
    if (segment.length <= EPSILON) continue;
    const [startIndex, endIndex] = segmentPointIndices(route, segment.index);
    const startFrame = frames[startIndex] ?? { side: new Vector3(1, 0, 0), miterScale: 1 };
    const endFrame = frames[endIndex] ?? startFrame;
    const startWidth = Math.max(0.1, segment.start.width);
    const endWidth = Math.max(0.1, segment.end.width);
    const start = segment.start.position.clone().addScaledVector(UP, roadLift);
    const end = segment.end.position.clone().addScaledVector(UP, roadLift);
    const startLeft = start.clone().addScaledVector(
      startFrame.side,
      startWidth * 0.5 * startFrame.miterScale,
    );
    const startRight = start.clone().addScaledVector(
      startFrame.side,
      -startWidth * 0.5 * startFrame.miterScale,
    );
    const endLeft = end.clone().addScaledVector(
      endFrame.side,
      endWidth * 0.5 * endFrame.miterScale,
    );
    const endRight = end.clone().addScaledVector(
      endFrame.side,
      -endWidth * 0.5 * endFrame.miterScale,
    );

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
  const frames = makeRouteFrames(route);
  let vertex = 0;

  for (const segment of route.segments) {
    if (segment.length <= EPSILON) continue;
    const [startIndex, endIndex] = segmentPointIndices(route, segment.index);
    const startFrame = frames[startIndex] ?? { side: new Vector3(1, 0, 0), miterScale: 1 };
    const endFrame = frames[endIndex] ?? startFrame;
    const start = segment.start.position.clone().addScaledVector(UP, roadLift + 0.12);
    const end = segment.end.position.clone().addScaledVector(UP, roadLift + 0.12);
    const startOffset = startFrame.side.clone().multiplyScalar(
      sideSign * (segment.start.width * 0.5 + 0.02) * startFrame.miterScale,
    );
    const endOffset = endFrame.side.clone().multiplyScalar(
      sideSign * (segment.end.width * 0.5 + 0.02) * endFrame.miterScale,
    );
    const startInner = start.clone().add(startOffset);
    const endInner = end.clone().add(endOffset);
    const startOuter = startInner.clone().addScaledVector(
      startFrame.side,
      sideSign * ribbonWidth * startFrame.miterScale,
    );
    const endOuter = endInner.clone().addScaledVector(
      endFrame.side,
      sideSign * ribbonWidth * endFrame.miterScale,
    );

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

function makeShoulderGeometry(route: TrackRoute, roadLift: number, sideSign: 1 | -1): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const frames = makeRouteFrames(route);
  let vertex = 0;

  for (const segment of route.segments) {
    if (segment.length <= EPSILON) continue;
    const [startIndex, endIndex] = segmentPointIndices(route, segment.index);
    const startFrame = frames[startIndex] ?? { side: new Vector3(1, 0, 0), miterScale: 1 };
    const endFrame = frames[endIndex] ?? startFrame;
    const start = segment.start.position.clone().addScaledVector(UP, roadLift + 0.025);
    const end = segment.end.position.clone().addScaledVector(UP, roadLift + 0.025);
    const startInner = start.clone().addScaledVector(
      startFrame.side,
      sideSign * segment.start.width * 0.5 * startFrame.miterScale,
    );
    const endInner = end.clone().addScaledVector(
      endFrame.side,
      sideSign * segment.end.width * 0.5 * endFrame.miterScale,
    );
    const startOuter = start.clone().addScaledVector(
      startFrame.side,
      sideSign * (segment.start.width * 0.5 + 1.16) * startFrame.miterScale,
    );
    const endOuter = end.clone().addScaledVector(
      endFrame.side,
      sideSign * (segment.end.width * 0.5 + 1.16) * endFrame.miterScale,
    );
    const startInnerBottom = segment.start.position.clone().addScaledVector(
      UP,
      roadLift - 0.045,
    ).addScaledVector(
      startFrame.side,
      sideSign * segment.start.width * 0.5 * startFrame.miterScale,
    );
    const endInnerBottom = segment.end.position.clone().addScaledVector(
      UP,
      roadLift - 0.045,
    ).addScaledVector(
      endFrame.side,
      sideSign * segment.end.width * 0.5 * endFrame.miterScale,
    );
    const startOuterBottom = segment.start.position.clone().addScaledVector(
      UP,
      roadLift - 0.22,
    ).addScaledVector(
      startFrame.side,
      sideSign * (segment.start.width * 0.5 + 1.16) * startFrame.miterScale,
    );
    const endOuterBottom = segment.end.position.clone().addScaledVector(
      UP,
      roadLift - 0.22,
    ).addScaledVector(
      endFrame.side,
      sideSign * (segment.end.width * 0.5 + 1.16) * endFrame.miterScale,
    );

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
      startInnerBottom.x,
      startInnerBottom.y,
      startInnerBottom.z,
      startOuterBottom.x,
      startOuterBottom.y,
      startOuterBottom.z,
      endInnerBottom.x,
      endInnerBottom.y,
      endInnerBottom.z,
      endOuterBottom.x,
      endOuterBottom.y,
      endOuterBottom.z,
    );
    // Top cap, outer fascia, inner fascia, and a recessed underside. The
    // fascia is what makes the road edge read as a grounded curb instead of a
    // floating flat strip at bends and on the sloped route sections.
    const topFace = sideSign === 1
      ? [vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2]
      : [vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3];
    const outerFace = sideSign === 1
      ? [vertex + 1, vertex + 3, vertex + 5, vertex + 5, vertex + 3, vertex + 7]
      : [vertex + 1, vertex + 5, vertex + 3, vertex + 5, vertex + 7, vertex + 3];
    const innerFace = sideSign === 1
      ? [vertex, vertex + 4, vertex + 2, vertex + 4, vertex + 6, vertex + 2]
      : [vertex, vertex + 2, vertex + 4, vertex + 4, vertex + 2, vertex + 6];
    const underside = sideSign === 1
      ? [vertex + 4, vertex + 6, vertex + 5, vertex + 5, vertex + 6, vertex + 7]
      : [vertex + 4, vertex + 5, vertex + 6, vertex + 5, vertex + 7, vertex + 6];
    indices.push(
      ...topFace,
      ...outerFace,
      ...innerFace,
      ...underside,
    );
    vertex += 8;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeStartApproach(route: TrackRoute, roadLift: number): Group {
  const group = new Group();
  group.name = "rift-start-approach";
  const firstSegment = route.segments[0];
  if (!firstSegment || firstSegment.length <= EPSILON) return group;

  const tangent = new Vector3()
    .subVectors(firstSegment.end.position, firstSegment.start.position)
    .normalize();
  const center = firstSegment.start.position.clone().addScaledVector(tangent, -7);
  const heading = Math.atan2(tangent.x, tangent.z);
  const width = Math.max(0.1, firstSegment.start.width);

  const shoulder = new Mesh(
    new BoxGeometry(width + 2.2, 0.035, 18),
    new MeshBasicMaterial({ color: 0x2a2350 }),
  );
  shoulder.name = "rift-start-shoulder";
  shoulder.position.copy(center);
  shoulder.position.y += roadLift + 0.005;
  shoulder.rotation.y = heading;
  group.add(shoulder);

  const road = new Mesh(
    new BoxGeometry(width, 0.045, 18),
    new MeshBasicMaterial({ color: 0x111827 }),
  );
  road.name = "rift-start-road-apron";
  road.position.copy(center);
  road.position.y += roadLift + 0.03;
  road.rotation.y = heading;
  group.add(road);
  return group;
}

function makeTrackGroup(
  route: TrackRoute,
  roadLift: number,
  neonMaterials: MeshBasicMaterial[],
): Group {
  const group = new Group();
  group.name = "rift-track";
  group.add(makeStartApproach(route, roadLift));

  const road = new Mesh(
    makeRoadGeometry(route, roadLift),
    new MeshBasicMaterial({
      name: "rift-asphalt",
      color: 0x111827,
    }),
  );
  road.name = "rift-dark-road";
  road.receiveShadow = true;
  group.add(road);

  const shoulderMaterial = new MeshStandardMaterial({
    name: "rift-violet-shoulder",
    color: 0x2a2350,
    roughness: 0.86,
    metalness: 0.12,
    flatShading: true,
  });
  for (const sideSign of [1, -1] as const) {
    const shoulders = new Mesh(
      makeShoulderGeometry(route, roadLift, sideSign),
      shoulderMaterial,
    );
    shoulders.name = sideSign === 1 ? "rift-road-shoulder-right" : "rift-road-shoulder-left";
    shoulders.receiveShadow = true;
    group.add(shoulders);
  }

  const edgeMaterial = new MeshBasicMaterial({
    name: "rift-hot-pink-edge",
    color: 0xe24d9d,
    transparent: true,
    opacity: 0.64,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  neonMaterials.push(edgeMaterial);

  for (const sideSign of [1, -1] as const) {
    const ribbon = new Mesh(
      makeRibbonGeometry(route, sideSign, roadLift, 0.12),
      edgeMaterial,
    );
    ribbon.name = sideSign === 1 ? "rift-neon-ribbon-right" : "rift-neon-ribbon-left";
    ribbon.renderOrder = 2;
    group.add(ribbon);
  }

  // Short cyan lane dashes stay on the road surface instead of drawing a
  // closed route line through the sky when the camera looks across a bend.
  const laneMaterial = new MeshBasicMaterial({
    name: "rift-lane-guide",
    color: 0x5de4ff,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  neonMaterials.push(laneMaterial);
  const dashGeometry = new BoxGeometry(0.14, 0.045, 1.8);
  for (const segment of route.segments) {
    if (segment.length <= EPSILON) continue;
    const tangent = new Vector3().subVectors(segment.end.position, segment.start.position).normalize();
    const dashCount = Math.max(1, Math.ceil(segment.length / 5.5));
    for (let index = 0; index < dashCount; index += 1) {
      const amount = (index + 0.28) / dashCount;
      const dash = new Mesh(dashGeometry, laneMaterial);
      dash.name = "rift-cyan-lane-dash";
      dash.position.copy(segment.start.position).lerp(segment.end.position, amount);
      dash.position.y += roadLift + 0.09;
      dash.quaternion.setFromUnitVectors(FORWARD, tangent);
      dash.renderOrder = 1;
      group.add(dash);
    }
  }

  return group;
}

function createPalmTree(): Group {
  const palm = new Group();
  palm.name = "rift-palm";
  const base = new Mesh(
    new CylinderGeometry(0.34, 0.44, 0.14, 8),
    new MeshBasicMaterial({ color: 0x17162d }),
  );
  base.name = "rift-palm-ground-base";
  base.position.y = 0.07;
  palm.add(base);
  const trunk = new Mesh(
    new CylinderGeometry(0.16, 0.28, 4.6, 5),
    new MeshBasicMaterial({ color: 0x563a72 }),
  );
  trunk.position.y = 2.3;
  palm.add(trunk);

  const crownMaterial = new MeshBasicMaterial({
    color: 0x572673,
    transparent: true,
    opacity: 0.95,
    side: DoubleSide,
  });
  const crown = new Group();
  crown.position.y = 4.55;
  for (let index = 0; index < 6; index += 1) {
    const leaf = new Mesh(new ConeGeometry(0.34, 3.4, 4), crownMaterial);
    leaf.rotation.z = Math.PI * 0.5;
    leaf.rotation.y = (Math.PI * 2 * index) / 6;
    leaf.position.y = -0.6;
    leaf.position.x = Math.cos((Math.PI * 2 * index) / 6) * 1.05;
    leaf.position.z = Math.sin((Math.PI * 2 * index) / 6) * 1.05;
    crown.add(leaf);
  }
  palm.add(crown);
  return palm;
}

function createStreetLamp(): Group {
  const lamp = new Group();
  lamp.name = "rift-neon-street-lamp";
  const poleMaterial = new MeshBasicMaterial({ color: 0x3a315d });
  const base = new Mesh(
    new CylinderGeometry(0.2, 0.28, 0.14, 8),
    new MeshBasicMaterial({ color: 0x17162d }),
  );
  base.name = "rift-street-lamp-ground-base";
  base.position.y = 0.07;
  lamp.add(base);
  const pole = new Mesh(new CylinderGeometry(0.07, 0.11, 3.8, 5), poleMaterial);
  pole.position.y = 1.9;
  lamp.add(pole);

  const arm = new Mesh(new BoxGeometry(0.08, 0.08, 0.95), poleMaterial);
  arm.position.set(0, 3.72, 0.36);
  lamp.add(arm);

  const shade = new Mesh(
    new ConeGeometry(0.22, 0.14, 6),
    new MeshBasicMaterial({ color: 0x252044 }),
  );
  shade.name = "rift-street-lamp-shade";
  shade.position.set(0, 3.58, 0.78);
  lamp.add(shade);

  const glow = new Mesh(
    new SphereGeometry(0.16, 6, 4),
    new MeshBasicMaterial({
      color: 0xffd18a,
      transparent: true,
      opacity: 0.82,
      blending: AdditiveBlending,
    }),
  );
  glow.position.set(0, 3.62, 0.78);
  lamp.add(glow);
  return lamp;
}

function createBuilding(
  height: number,
  width: number,
  depth: number,
  buildingMaterial: MeshBasicMaterial,
  windowMaterial: MeshBasicMaterial,
): Group {
  const building = new Group();
  building.name = "rift-silhouette-building";
  const foundation = new Mesh(
    new BoxGeometry(width + 0.38, 0.16, depth + 0.38),
    new MeshBasicMaterial({ color: 0x101426 }),
  );
  foundation.name = "rift-building-ground-base";
  foundation.position.y = 0.08;
  building.add(foundation);
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
  const lampTemplate = createStreetLamp();
  const buildingMaterial = new MeshBasicMaterial({
    color: 0x1a1d3b,
  });
  const windowMaterial = new MeshBasicMaterial({
    color: 0xffc477,
    transparent: true,
    opacity: 0.58,
    blending: AdditiveBlending,
  });
  const spacing = quality === "eco" ? 2 : 1;
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

    const lamp = lampTemplate.clone(true);
    lamp.position.copy(midpoint).addScaledVector(side, edgeDistance + 2.6);
    lamp.rotation.y = Math.atan2(tangent.x, tangent.z);
    group.add(lamp);

    if (index % buildingStride === 0) {
      const height = 5.5 + (index % 4) * 1.7;
      const building = createBuilding(height, 3.4 + (index % 3), 3.2, buildingMaterial, windowMaterial);
      building.position.copy(midpoint).addScaledVector(side, -edgeDistance - 18 - (index % 2) * 4);
      building.rotation.y = Math.atan2(tangent.x, tangent.z) + Math.PI * 0.5;
      group.add(building);
    }
  });

  // A low skyline behind the start makes the coastal slice feel larger without
  // requiring a texture or a large number of draw calls.
  for (let index = 0; index < 5; index += 1) {
    const height = 7 + (index % 3) * 2.5;
    const building = createBuilding(height, 4 + index * 0.7, 4.2, buildingMaterial, windowMaterial);
    building.position.set(-30 + index * 13, -0.04, 26 + (index % 2) * 8);
    group.add(building);
  }
  group.add(makeHorizonFog());
  return group;
}

function makeHorizonFog(): Group {
  const group = new Group();
  group.name = "rift-horizon-fog";
  const material = new ShaderMaterial({
    name: "rift-horizon-fog-material",
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      fogColor: { value: new Color(0x46577f) },
      fogOpacity: { value: 0.16 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vFogUv;
      void main() {
        vFogUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 fogColor;
      uniform float fogOpacity;
      varying vec2 vFogUv;
      void main() {
        float lowerFade = smoothstep(0.0, 0.3, vFogUv.y);
        float upperFade = 1.0 - smoothstep(0.58, 1.0, vFogUv.y);
        gl_FragColor = vec4(fogColor, fogOpacity * lowerFade * upperFade);
      }
    `,
  });
  const geometry = new PlaneGeometry(150, 14);
  const farBand = new Mesh(geometry, material);
  farBand.name = "rift-distant-fog-band";
  farBand.position.set(18, 4.2, 48);
  farBand.frustumCulled = false;
  group.add(farBand);

  const sideBand = new Mesh(geometry, material);
  sideBand.name = "rift-coastal-fog-band";
  sideBand.position.set(-46, 3.1, -18);
  sideBand.rotation.y = Math.PI * 0.5;
  sideBand.frustumCulled = false;
  group.add(sideBand);
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
    color: 0xc8569f,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const shellMaterial = new MeshBasicMaterial({
    name: "rift-tunnel-shell-material",
    color: 0x101533,
    side: BackSide,
    transparent: true,
    opacity: 0.94,
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
    const shell = new Mesh(
      new CylinderGeometry(radius, radius, segment.length + 0.8, 12, 1, true),
      shellMaterial,
    );
    shell.name = "rift-tunnel-shell";
    shell.position.copy(center);
    shell.quaternion.setFromUnitVectors(UP, tangent);
    group.add(shell);

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
  const glassMaterial = new MeshBasicMaterial({
    name: "rift-underwater-glass-material",
    color: 0x1c9bd1,
    transparent: true,
    opacity: 0.13,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  const fishMaterial = new MeshBasicMaterial({
    name: "rift-underwater-fish-material",
    color: 0x45dff5,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const sharkMaterial = new MeshBasicMaterial({
    name: "rift-underwater-shark-material",
    color: 0x315c9d,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
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

    const glassTube = new Mesh(
      new CylinderGeometry(width + 1.4, width + 1.4, segment.length + 0.6, 12, 1, true),
      glassMaterial,
    );
    glassTube.name = "rift-underwater-glass-tube";
    glassTube.position.copy(center);
    glassTube.quaternion.setFromUnitVectors(UP, tangent);
    group.add(glassTube);

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

    const fish = new Mesh(new ConeGeometry(0.22, 1.4, 5), fishMaterial);
    fish.name = "rift-underwater-fish";
    fish.position
      .copy(center)
      .addScaledVector(side, width + 1.8)
      .addScaledVector(tangent, (index % 2 === 0 ? -1 : 1) * 1.9);
    fish.position.y += 1.4 + (index % 3) * 0.45;
    fish.quaternion.setFromUnitVectors(UP, tangent);
    group.add(fish);
    bubbles.push({
      object: fish,
      baseY: fish.position.y,
      phase: index * 0.51 + 0.4,
      amplitude: 0.18,
    });

    if (index === 2 || index === 5) {
      const shark = new Mesh(new ConeGeometry(0.5, 3.4, 5), sharkMaterial);
      shark.name = "rift-underwater-shark-silhouette";
      shark.position
        .copy(center)
        .addScaledVector(side, width + 4.6)
        .addScaledVector(tangent, -2.4);
      shark.position.y += 2.6;
      shark.quaternion.setFromUnitVectors(UP, tangent);
      group.add(shark);
      bubbles.push({
        object: shark,
        baseY: shark.position.y,
        phase: index * 0.7 + 1.1,
        amplitude: 0.12,
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
 * A scene-only rendering layer for the first Rift Racer route slice.
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
  private readonly dynamicLightData: DynamicLightData[] = [];
  private elapsedSeconds = 0;
  private disposed = false;

  constructor(options: RiftWorldOptions = {}) {
    super();
    this.name = "rift-racer-world";
    this.route = options.route ?? SAMPLE_ROUTE;
    this.quality = options.quality ?? "balanced";

    const roadLift = Math.max(0, finiteOr(options.roadLift, 0.035));
    this.sky = makeGradientSky();
    this.add(this.sky);
    this.add(makeSunGlow());
    this.add(makeCoastalWater());

    const ambientIntensity = this.quality === "eco" ? 0.86 : this.quality === "ultra" ? 1.34 : 1.08;
    this.add(new HemisphereLight(0x8062ad, 0x071126, ambientIntensity));
    const rimIntensity = this.quality === "ultra" ? 3.5 : this.quality === "eco" ? 1.35 : 2.45;
    const rimLight = new PointLight(0x9e3f88, rimIntensity, 150, 2);
    rimLight.name = "rift-rim-light";
    rimLight.position.set(-14, 18, -18);
    this.add(rimLight);
    this.dynamicLightData.push({ light: rimLight, baseIntensity: rimIntensity, phase: 0.4 });
    const waterIntensity = this.quality === "ultra" ? 4.1 : this.quality === "eco" ? 1.4 : 2.7;
    const waterLight = new PointLight(0x18a6ff, waterIntensity, 120, 2);
    waterLight.name = "rift-water-light";
    waterLight.position.set(-34, -2, -34);
    this.add(waterLight);
    this.dynamicLightData.push({ light: waterLight, baseIntensity: waterIntensity, phase: 1.8 });

    if (this.quality === "ultra") {
      const keyLight = new DirectionalLight(0xffd0df, 1.55);
      keyLight.name = "rift-ultra-key-light";
      keyLight.position.set(44, 52, 20);
      keyLight.target.position.set(24, 0, 0);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(2048, 2048);
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 180;
      keyLight.shadow.camera.left = -70;
      keyLight.shadow.camera.right = 70;
      keyLight.shadow.camera.top = 70;
      keyLight.shadow.camera.bottom = -70;
      this.add(keyLight, keyLight.target);

      const cyanFill = new PointLight(0x26cfff, 2.2, 48, 2);
      cyanFill.name = "rift-ultra-cyan-fill";
      cyanFill.position.set(26, 8, 16);
      this.add(cyanFill);
      this.dynamicLightData.push({ light: cyanFill, baseIntensity: 2.2, phase: 3.1 });
    }

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

    if (state.routeDistance !== undefined && this.route.totalLength > EPSILON) {
      const wrappedDistance = ((state.routeDistance % this.route.totalLength) + this.route.totalLength) % this.route.totalLength;
      const activeSegment = this.route.segments.find((segment) =>
        wrappedDistance >= segment.startDistance && wrappedDistance <= segment.endDistance,
      );
      const activeSection = activeSegment?.section ?? "coastal-boulevard";
      this.tunnelCues.visible = activeSection === "tunnel";
      this.underwaterCues.visible = activeSection === "underwater";
    }

    const speedBoost = clamp(Math.abs(finiteOr(state.speed, 0)) / 34, 0, 1);
    this.dynamicLightData.forEach(({ light, baseIntensity, phase }) => {
      const shimmer = 0.88 + 0.12 * (0.5 + 0.5 * Math.sin(this.elapsedSeconds * 3.8 + phase));
      light.intensity = baseIntensity * shimmer * (1 + speedBoost * 0.08);
    });
    const pulse = 0.74 + 0.26 * (0.5 + 0.5 * Math.sin(this.elapsedSeconds * 4.4)) + speedBoost * 0.08;
    this.neonMaterials.forEach((material, index) => {
      if (index === 0) material.opacity = clamp(0.52 + pulse * 0.28, 0.62, 0.86);
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
