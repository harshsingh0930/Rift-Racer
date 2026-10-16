import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  Light,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Raycaster,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Texture,
  Vector3,
} from "three";
import {
  SAMPLE_ROUTE,
  findNearestTrackPoint,
  sampleTrackPosition,
  sampleTrackSection,
  sampleTrackTangent,
  sampleTrackWidth,
  type TrackRoute,
  type TrackSegment,
  type TrackSection,
} from "../game/track";
import type { QualityTier } from "../game/performance";
import { createCoastalEnvironment, createSynthwaveSun } from "./environment";
import { createAsphaltMaterial } from "./surfaces";
import { createUnderwaterStructure } from "./underwater";
import { createRoadsideDistrict } from "./district";
import { createRoadsidePlants } from "./foliage";
import { SkyLife } from "./sky-life";
import { createMountainBackdrop } from "./backdrop";
import { CityLife } from "./city-life";
import { AquaticLife } from "./aquatic-life";
import { createTunnelHeadland } from "./tunnel-dressing";
import { LocalSceneVisibility } from "./visibility";
import { CliffDiveTransition, createStartGate, getDiveLayout } from "./landmarks";
import { detailTexture, sceneryTexture } from "./texture-assets";

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
  playerPosition?: Readonly<{ x: number; y: number; z: number }>;
  submerged?: boolean;
}

type DynamicLightData = {
  light: PointLight;
  baseIntensity: number;
  phase: number;
};

type DecorativeCullItem = {
  object: Object3D;
  routeDistance: number;
  halfSpan: number;
};

type AirborneCue = {
  mesh: InstancedMesh;
  index: number;
  basePosition: Vector3;
  scale: Vector3;
  rotation: Quaternion;
  phase: number;
};

type TrackGroupData = {
  group: Group;
  decorative: DecorativeCullItem[];
};

type SceneryData = {
  group: Group;
  airborne: AirborneCue[];
};

type OwnedMaterial = MeshBasicMaterial | MeshStandardMaterial | ShaderMaterial;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

/**
 * Return the shortest horizontal distance from a world-space point to a route
 * segment. Scenery is visual-only, but it should still be kept away from the
 * complete road span rather than just from the authored control points. The
 * sample route is densely sampled; custom routes are not necessarily so this
 * segment test is deliberately conservative.
 */
function horizontalDistanceToSegment(
  position: Vector3,
  segment: Pick<TrackSegment, "start" | "end">,
): number {
  const start = segment.start.position;
  const end = segment.end.position;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  const amount = lengthSquared <= EPSILON
    ? 0
    : clamp(((position.x - start.x) * dx + (position.z - start.z) * dz) / lengthSquared, 0, 1);
  const closestX = start.x + dx * amount;
  const closestZ = start.z + dz * amount;
  return Math.hypot(position.x - closestX, position.z - closestZ);
}

function isClearOfRoad(route: TrackRoute, position: Vector3, radius: number): boolean {
  const safeRadius = Math.max(0, finiteOr(radius, 0));
  return route.segments.every((segment) => {
    const roadHalfWidth = Math.max(segment.start.width, segment.end.width) * 0.5;
    return horizontalDistanceToSegment(position, segment) > roadHalfWidth + safeRadius;
  });
}

function makeGradientSky(): Mesh<SphereGeometry, ShaderMaterial> {
  const geometry = new SphereGeometry(380, 16, 10);
  const material = new ShaderMaterial({
    name: "rift-gradient-sky-material",
    side: BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new Color(0x170a36) },
      horizonColor: { value: new Color(0xeb5795) },
      lowColor: { value: new Color(0x49244f) },
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
        vec3 sky = mix(lower, topColor, smoothstep(0.01, 0.26, height));
        // A cooler haze band keeps the horizon atmospheric instead of turning
        // every distant surface into the same hot-pink value.
        float haze = 1.0 - smoothstep(0.02, 0.16, abs(height - 0.01));
        sky = mix(sky, vec3(0.16, 0.15, 0.30), haze * 0.13);
        float sunset=step(topColor.g,topColor.r)*exp(-pow((height+0.008)/0.045,2.0));
        sky=mix(sky,vec3(0.95,0.32,0.11),sunset*0.65);
        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "rift-gradient-sky";
  mesh.frustumCulled = false;
  return mesh;
}

function makeRoadGeometry(route: TrackRoute, roadLift: number): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const frames = makeRouteFrames(route);
  let vertex = 0;

  for (const segment of route.segments) {
    if (segment.length <= EPSILON || segment.section === "cliff-dive") continue;
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
    uvs.push(0, segment.startDistance * 0.15, 1, segment.startDistance * 0.15,
      0, segment.endDistance * 0.15, 1, segment.endDistance * 0.15);
    const roadTriangle = (a: Vector3, b: Vector3, c: Vector3, ia: number, ib: number, ic: number): number[] => {
      const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      return normal.y >= 0 ? [ia, ib, ic] : [ia, ic, ib];
    };
    indices.push(
      ...roadTriangle(startLeft, startRight, endLeft, vertex, vertex + 1, vertex + 2),
      ...roadTriangle(startRight, endRight, endLeft, vertex + 1, vertex + 3, vertex + 2),
    );
    vertex += 4;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
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
  startDistance = 0,
  endDistance = Number.POSITIVE_INFINITY,
): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const frames = makeRouteFrames(route);
  let vertex = 0;

  for (const segment of route.segments) {
    if (segment.length <= EPSILON || segment.section === "cliff-dive") continue;
    if (segment.endDistance < startDistance || segment.startDistance > endDistance) continue;
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
    const color = new Color(segment.section === "underwater" ? 0x45ffd0 : 0xff7439);
    for (let index = 0; index < 4; index++) colors.push(color.r, color.g, color.b);
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
    vertex += 4;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Solid rail beam beneath the warm emissive strip. */
function makeGuardrailGeometry(route: TrackRoute, side: 1 | -1, lift: number, start: number, end: number): BufferGeometry {
  const ribbon = makeRibbonGeometry(route, side, lift + 0.42, 0.16, start, end);
  const source = ribbon.getAttribute("position");const vertices: number[] = [];const indices: number[] = [];
  for (let offset = 0; offset < source.count; offset += 4) {
    const base = vertices.length / 3;
    for (const lower of [false, true]) for (let vertex = 0; vertex < 4; vertex++) {
      vertices.push(source.getX(offset + vertex), source.getY(offset + vertex) - (lower ? 0.17 : 0.01), source.getZ(offset + vertex));
    }
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3,
      base, base + 4, base + 2, base + 2, base + 4, base + 6,
      base + 1, base + 3, base + 5, base + 3, base + 7, base + 5);
  }
  ribbon.dispose();const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));geometry.setIndex(indices);
  geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
}

function makeShoulderGeometry(route: TrackRoute, roadLift: number, sideSign: 1 | -1): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertex = 0;

  for (const segment of route.segments) {
    if (segment.length <= EPSILON || segment.section === "cliff-dive") continue;
    // Each curb span uses its own tangent frame. Reusing the route miter at a
    // sharp bend can twist the top quad through itself and create a dark,
    // inverted triangle at the seam.
    const segmentFrame = {
      side: makeSideVector(segmentTangent(segment)),
      miterScale: 1,
    };
    const startFrame = segmentFrame;
    const endFrame = segmentFrame;
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
    const topTriangle = (a: Vector3, b: Vector3, c: Vector3, ia: number, ib: number, ic: number): number[] => {
      const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      return normal.y >= 0 ? [ia, ib, ic] : [ia, ic, ib];
    };
    const topFace = [
      ...topTriangle(startInner, endInner, startOuter, vertex, vertex + 2, vertex + 1),
      ...topTriangle(startOuter, endInner, endOuter, vertex + 1, vertex + 2, vertex + 3),
    ];
    const outerFace = sideSign === 1
      ? [vertex + 1, vertex + 3, vertex + 5, vertex + 5, vertex + 3, vertex + 7]
      : [vertex + 1, vertex + 5, vertex + 3, vertex + 5, vertex + 7, vertex + 3];
    const innerFace = sideSign === 1
      ? [vertex, vertex + 4, vertex + 2, vertex + 4, vertex + 6, vertex + 2]
      : [vertex, vertex + 2, vertex + 4, vertex + 4, vertex + 2, vertex + 6];
    const underside = sideSign === -1
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
  quality: QualityTier,
): TrackGroupData {
  const group = new Group();
  group.name = "rift-track";
  const decorative: DecorativeCullItem[] = [];
  if (!route.closed) {
    const approach = makeStartApproach(route, roadLift);
    group.add(approach);
    decorative.push({ object: approach, routeDistance: 0, halfSpan: 10 });
  }

  const road = new Mesh(
    makeRoadGeometry(route, roadLift),
    createAsphaltMaterial(quality),
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
    color: new Color(0xffffff).multiplyScalar(4.0),
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  });
  neonMaterials.push(edgeMaterial);

  // Decorative road geometry is chunked so an active run only pays for the
  // nearby route. The road and shoulders stay whole; these are purely visual.
  const chunkLength = quality === "eco" ? 144 : quality === "ultra" ? 176 : 160;
  const railMaterial = new MeshStandardMaterial({ name: "rift-solid-guardrail-material", color: 0x343047,
    metalness: 0.45, roughness: 0.55, side: DoubleSide });
  for (const sideSign of [1, -1] as const) {
    const ribbonParent = new Group();
    ribbonParent.name = sideSign === 1 ? "rift-neon-ribbon-right" : "rift-neon-ribbon-left";
    const railParent = new Group();
    railParent.name = sideSign === 1 ? "rift-raised-rail-right" : "rift-raised-rail-left";
    for (let startDistance = 0; startDistance < route.totalLength; startDistance += chunkLength) {
      const endDistance = Math.min(route.totalLength, startDistance + chunkLength);
      const midpoint = (startDistance + endDistance) * 0.5;
      const ribbon = new Mesh(
        makeRibbonGeometry(route, sideSign, roadLift, 0.12, startDistance, endDistance),
        edgeMaterial,
      );
      ribbon.name = `${ribbonParent.name}-chunk-${Math.floor(startDistance / chunkLength)}`;
      ribbon.renderOrder = 2;
      ribbonParent.add(ribbon);
      decorative.push({ object: ribbon, routeDistance: midpoint, halfSpan: chunkLength * 0.5 });

      const rail = new Mesh(
        makeRibbonGeometry(route, sideSign, roadLift + 0.47, 0.15, startDistance, endDistance),
        edgeMaterial,
      );
      rail.name = `${railParent.name}-chunk-${Math.floor(startDistance / chunkLength)}`;
      railParent.add(rail);
      const beam = new Mesh(makeGuardrailGeometry(route, sideSign, roadLift, startDistance, endDistance), railMaterial);
      beam.name = `rift-guardrail-beam-${sideSign}-${Math.floor(startDistance / chunkLength)}`;
      beam.receiveShadow = true;railParent.add(beam);
      decorative.push({ object: beam, routeDistance: midpoint, halfSpan: chunkLength * 0.5 });
      decorative.push({ object: rail, routeDistance: midpoint, halfSpan: chunkLength * 0.5 });
    }
    group.add(ribbonParent, railParent);
  }

  const postGeometry = new BoxGeometry(0.11, 0.54, 0.11);
  const postMaterial = new MeshStandardMaterial({ color: 0x3a365a, roughness: 0.7 });
  const postsParent = new Group();
  postsParent.name = "rift-guardrail-posts";
  const postMatrix = new Matrix4();
  for (let startDistance = 0; startDistance < route.totalLength; startDistance += chunkLength) {
    const endDistance = Math.min(route.totalLength, startDistance + chunkLength);
    const firstIndex = Math.ceil(startDistance / 6);
    const lastIndex = Math.floor((endDistance - EPSILON) / 6);
    const count = Math.max(0, lastIndex - firstIndex + 1) * 2;
    if (count === 0) continue;
    const posts = new InstancedMesh(postGeometry, postMaterial, count);
    posts.name = `${postsParent.name}-chunk-${Math.floor(startDistance / chunkLength)}`;
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const distance = index * 6;
      if (sampleTrackSection(route, distance) === "cliff-dive") {
        postMatrix.makeScale(0, 0, 0);
        posts.setMatrixAt((index - firstIndex) * 2, postMatrix);posts.setMatrixAt((index - firstIndex) * 2 + 1, postMatrix);continue;
      }
      const center = sampleTrackPosition(route, distance);
      const side = makeSideVector(sampleTrackTangent(route, distance));
      for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
        const position = center.clone().addScaledVector(side, (sideIndex === 0 ? 1 : -1) * (sampleTrackWidth(route, distance) * 0.5 + 0.06));
        position.y += roadLift + 0.29;
        postMatrix.makeTranslation(position.x, position.y, position.z);
        posts.setMatrixAt((index - firstIndex) * 2 + sideIndex, postMatrix);
      }
    }
    posts.computeBoundingSphere();
    postsParent.add(posts);
    decorative.push({ object: posts, routeDistance: (startDistance + endDistance) * 0.5, halfSpan: chunkLength * 0.5 });
  }
  group.add(postsParent);

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
  const dashGeometry = new BoxGeometry(0.12, 0.025, 1.8);
  const dashesParent = new Group();
  dashesParent.name = "rift-cyan-lane-dashes";
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  for (let startDistance = 0; startDistance < route.totalLength; startDistance += chunkLength) {
    const endDistance = Math.min(route.totalLength, startDistance + chunkLength);
    const firstIndex = Math.ceil((startDistance - 2.8) / 6);
    const lastIndex = Math.floor((endDistance - 2.8 - EPSILON) / 6);
    const dashCount = Math.max(0, lastIndex - firstIndex + 1);
    if (dashCount === 0) continue;
    const dashes = new InstancedMesh(dashGeometry, laneMaterial, dashCount);
    dashes.name = `${dashesParent.name}-chunk-${Math.floor(startDistance / chunkLength)}`;
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const distance = index * 6 + 2.8;
      if (sampleTrackSection(route, distance) === "cliff-dive") {
        matrix.makeScale(0, 0, 0);dashes.setMatrixAt(index - firstIndex, matrix);continue;
      }
      const position = sampleTrackPosition(route, distance);
      position.y += roadLift + 0.035;
      rotation.setFromUnitVectors(FORWARD, sampleTrackTangent(route, distance));
      matrix.compose(position, rotation, new Vector3(1, 1, 1));
      dashes.setMatrixAt(index - firstIndex, matrix);
    }
    dashes.computeBoundingSphere();
    dashesParent.add(dashes);
    decorative.push({ object: dashes, routeDistance: (startDistance + endDistance) * 0.5, halfSpan: chunkLength * 0.5 });
  }
  group.add(dashesParent);

  const startLine = new Group();
  startLine.name = "rift-start-finish-line";
  const startPosition = sampleTrackPosition(route, 1);
  const startTangent = sampleTrackTangent(route, 1);
  startLine.position.copy(startPosition);
  startLine.position.y += roadLift + 0.025;
  startLine.rotation.y = Math.atan2(startTangent.x, startTangent.z);
  const tileGeometry = new BoxGeometry(0.6, 0.025, 0.6);
  const tileMaterials = [new MeshBasicMaterial({ color: 0xd9edff }), new MeshBasicMaterial({ color: 0x18182c })];
  const columns = Math.floor(sampleTrackWidth(route, 1) / 0.6);
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const tile = new Mesh(tileGeometry, tileMaterials[(row + column) % 2]);
      tile.position.set((column - (columns - 1) / 2) * 0.6, 0, row * 0.6);
      startLine.add(tile);
    }
  }
  group.add(startLine);
  decorative.push({ object: startLine, routeDistance: 1, halfSpan: 3 });

  return { group, decorative };
}

function createPalmTree(): Group {
  const palm = new Group();
  palm.name = "rift-palm";
  const positions: number[] = [];
  const indices: number[] = [];
  const addVertex = (x: number, y: number, z: number): number => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const addBox = (center: Vector3, size: Vector3): void => {
    const half = size.clone().multiplyScalar(0.5);
    const base = positions.length / 3;
    [
      [-half.x, -half.y, -half.z], [half.x, -half.y, -half.z], [half.x, half.y, -half.z], [-half.x, half.y, -half.z],
      [-half.x, -half.y, half.z], [half.x, -half.y, half.z], [half.x, half.y, half.z], [-half.x, half.y, half.z],
    ].forEach(([x, y, z]) => addVertex(center.x + x, center.y + y, center.z + z));
    indices.push(
      base, base + 1, base + 2, base, base + 2, base + 3,
      base + 1, base + 5, base + 6, base + 1, base + 6, base + 2,
      base + 5, base + 4, base + 7, base + 5, base + 7, base + 6,
      base + 4, base, base + 3, base + 4, base + 3, base + 7,
      base + 3, base + 2, base + 6, base + 3, base + 6, base + 7,
      base + 4, base + 5, base + 1, base + 4, base + 1, base,
    );
  };
  // A low-poly trunk and grounding collar are one mesh so the district can
  // batch every palm into one instanced draw per route chunk.
  addBox(new Vector3(0, 0.07, 0), new Vector3(0.72, 0.14, 0.72));
  const trunkSides = 5;
  const trunkBase = positions.length / 3;
  for (let ring = 0; ring <= 1; ring += 1) {
    const y = 0.14 + ring * 4.38;
    const radius = ring === 0 ? 0.28 : 0.16;
    for (let side = 0; side < trunkSides; side += 1) {
      const angle = side / trunkSides * Math.PI * 2;
      addVertex(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    }
  }
  for (let side = 0; side < trunkSides; side += 1) {
    const next = (side + 1) % trunkSides;
    indices.push(
      trunkBase + side, trunkBase + next, trunkBase + trunkSides + next,
      trunkBase + side, trunkBase + trunkSides + next, trunkBase + trunkSides + side,
    );
  }
  const crownY = 4.55;
  for (let leafIndex = 0; leafIndex < 11; leafIndex += 1) {
    const angle = leafIndex / 11 * Math.PI * 2;
    const direction = new Vector3(Math.sin(angle), 0, Math.cos(angle));
    const across = new Vector3(direction.z, 0, -direction.x);
    const leafBase = positions.length / 3;
    for (let step = 0; step <= 6; step += 1) {
      const amount = step / 6;
      const width = Math.sin(amount * Math.PI) * 0.58 + 0.015;
      const height = Math.sin(amount * Math.PI) * 0.4 - amount * amount * 1.2;
      const center = direction.clone().multiplyScalar(amount * 3.4).add(new Vector3(0, crownY + height, 0));
      addVertex(center.x - across.x * width, center.y, center.z - across.z * width);
      addVertex(center.x + across.x * width, center.y, center.z + across.z * width);
      if (step < 6) {
        const vertex = leafBase + step * 2;
        indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new MeshStandardMaterial({
    color: 0x245354,
    emissive: 0x091724,
    emissiveIntensity: 0.65,
    roughness: 0.9,
    flatShading: true,
    side: DoubleSide,
  });
  const silhouette = new Mesh(geometry, material);
  silhouette.name = "rift-palm-silhouette";
  silhouette.castShadow = true;
  palm.add(silhouette);
  return palm;
}

function createStreetLamp(): Group {
  const lamp = new Group();lamp.name = "rift-neon-street-lamp";
  const metal = new MeshStandardMaterial({ color: 0x35243e, roughness: 0.75, metalness: 0.18 });
  const add = (size: [number, number, number], position: [number, number, number]) => {
    const mesh = new Mesh(new BoxGeometry(...size), metal);mesh.position.set(...position);lamp.add(mesh);return mesh;
  };
  add([0.40, 0.12, 0.40], [0, 0.06, 0]);
  add([0.12, 7.2, 0.12], [0, 3.6, 0]);
  add([0.10, 0.12, 3.55], [0, 7.12, 1.72]);
  const tube = new Mesh(new BoxGeometry(0.09, 0.07, 3.15), new MeshBasicMaterial({
    name: "rift-orange-streetlight-emitter", color: new Color(0xff8c32).multiplyScalar(4.0),
  }));
  tube.name = "rift-orange-streetlight-strip";tube.position.set(0, 7.04, 1.86);lamp.add(tube);
  const pool = new Mesh(new PlaneGeometry(4.7, 7.8), new ShaderMaterial({
    name: "rift-streetlight-road-spill", transparent: true, depthWrite: false,
    blending: AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;vec4 p=vec4(position,1.0);
      #ifdef USE_INSTANCING
        p=instanceMatrix*p;
      #endif
      gl_Position=projectionMatrix*modelViewMatrix*p;}`,
    fragmentShader: `varying vec2 vUv;void main(){vec2 p=(vUv-0.5)*2.0;
      float a=exp(-dot(p,p)*3.5)*0.14;
      gl_FragColor=vec4(0.65,0.22,0.055,a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  }));
  pool.name = "rift-streetlight-pool";pool.rotation.x = -Math.PI / 2;pool.position.set(0, 0.075, 3.6);lamp.add(pool);
  return lamp;
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
  const foundation = new Mesh(
    new BoxGeometry(width + 0.38, 0.16, depth + 0.38),
    new MeshBasicMaterial({ color: 0x101426 }),
  );
  foundation.name = "rift-building-ground-base";
  foundation.position.y = 0.08;
  building.add(foundation);
  const body = new Mesh(new BoxGeometry(width, height, depth), buildingMaterial);
  body.position.y = height * 0.5;
  body.castShadow = true;
  body.receiveShadow = true;
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

function makeKiteGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([
    0, 1, 0,
    -0.72, 0, 0,
    0, -1, 0,
    0.72, 0, 0,
  ]), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array([
    0.5, 1, 0, 0.5, 0.5, 0, 1, 0.5,
  ]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

type PlantationSpot = {
  position: Vector3;
  scale: number;
  rotation: number;
};

/**
 * Add a small, low-poly plantation layer behind the roadside district. The
 * district owns the grounded palms and buildings; these silhouettes fill the
 * gaps between it and the horizon without creating one object per plant.
 */
function makePlantation(route: TrackRoute, quality: RiftWorldQuality): Group {
  const group = new Group();
  group.name = "rift-plantation";

  const vegetationCap = quality === "eco" ? 28 : quality === "ultra" ? 72 : 48;
  const spots: PlantationSpot[] = [];
  const spacing = quality === "eco" ? 34 : quality === "ultra" ? 20 : 26;
  for (let distance = 18, index = 0; distance < route.totalLength && spots.length < vegetationCap; distance += spacing, index += 1) {
    const section = sampleTrackSection(route, distance);
    if (section !== "coastal-boulevard" && section !== "final-skyline") continue;
    const tangent = sampleTrackTangent(route, distance);
    const side = makeSideVector(tangent);
    const center = sampleTrackPosition(route, distance);
    const halfWidth = sampleTrackWidth(route, distance) * 0.5;
    const clusterCount = quality === "ultra" ? 3 : 2;
    for (let cluster = 0; cluster < clusterCount && spots.length < vegetationCap; cluster += 1) {
      const sign = (index + cluster) % 2 === 0 ? 1 : -1;
      const position = center.clone()
        .addScaledVector(side, sign * (halfWidth + 3.2 + cluster * 0.35))
        .addScaledVector(tangent, (cluster - 1) * 2.8);
      // Use the whole route for the test: this also protects a custom route
      // whose control points are sparse or whose road crosses at another lap.
      if (!isClearOfRoad(route, position, 1.5)) continue;
      if (section === "final-skyline" && center.y < 0.8) continue;
      position.y -= 0.14;
      spots.push({
        position,
        scale: 0.9 + ((index + cluster) % 4) * 0.16,
        rotation: index * 0.67 + cluster * 1.8,
      });
    }
  }

  if (spots.length === 0) return group;

  // Reuse one generated detail map for both plantation layers; creating a
  // second 512px procedural texture here would cost more than the geometry.
  const plantationDetail = detailTexture("leaf");
  const shrubGeometry = new ConeGeometry(1, 1.4, 6);
  const shrubMaterial = new MeshStandardMaterial({
    name: "rift-plantation-shrub-material",
    map: plantationDetail,
    color: 0x1d5b58,
    emissive: 0x071d28,
    emissiveIntensity: 0.5,
    roughness: 0.95,
    flatShading: true,
  });
  const shrubs = new InstancedMesh(shrubGeometry, shrubMaterial, spots.length);
  shrubs.name = "rift-plantation-shrubs";
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  spots.forEach((spot, index) => {
    rotation.setFromAxisAngle(UP, spot.rotation);
    matrix.compose(
      spot.position.clone().addScaledVector(UP, spot.scale * 0.62),
      rotation,
      new Vector3(spot.scale * 1.35, spot.scale * 1.25, spot.scale * 1.35),
    );
    shrubs.setMatrixAt(index, matrix);
  });
  shrubs.instanceMatrix.needsUpdate = true;
  shrubs.computeBoundingSphere();
  group.add(shrubs);

  const reedCount = Math.min(spots.length, quality === "eco" ? 14 : quality === "ultra" ? 40 : 26);
  const reedGeometry = new CylinderGeometry(0.09, 0.16, 1.8, 5);
  const reedMaterial = new MeshStandardMaterial({
    name: "rift-plantation-reed-material",
    map: plantationDetail,
    color: 0x39775f,
    emissive: 0x0a2a2c,
    emissiveIntensity: 0.4,
    roughness: 1,
    flatShading: true,
  });
  const reeds = new InstancedMesh(reedGeometry, reedMaterial, reedCount);
  reeds.name = "rift-plantation-reeds";
  for (let index = 0; index < reedCount; index += 1) {
    const spot = spots[index];
    rotation.setFromAxisAngle(UP, spot.rotation + 0.35);
    matrix.compose(
      spot.position.clone().addScaledVector(UP, 0.9),
      rotation,
      new Vector3(spot.scale * 0.46, spot.scale * (1.1 + (index % 3) * 0.18), spot.scale * 0.46),
    );
    reeds.setMatrixAt(index, matrix);
  }
  reeds.instanceMatrix.needsUpdate = true;
  reeds.computeBoundingSphere();
  group.add(reeds);
  return group;
}

type HorizonBuilding = {
  position: Vector3;
  side: Vector3;
  width: number;
  height: number;
  depth: number;
  rotation: number;
};

/**
 * Batch a sparse second skyline row. The roadside district gives the player
 * nearby architecture; this layer keeps the horizon legible at a distance
 * while sharing all geometry and materials.
 */
function makeHorizonObjects(route: TrackRoute, quality: RiftWorldQuality, district: Group): Group {
  const group = new Group();
  group.name = "rift-horizon-objects";
  const buildings: HorizonBuilding[] = [];
  const platforms: Object3D[] = [];
  district.updateMatrixWorld(true);
  district.traverse((object) => { if (object.name === "rift-roadside-platform") platforms.push(object); });
  const groundingRay = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 3);
  const groundPosition = (position: Vector3): boolean => {
    groundingRay.ray.origin.copy(position).addScaledVector(UP, 1);
    const hit = groundingRay.intersectObjects(platforms, false)[0];
    if (!hit) return false;
    position.y = hit.point.y;
    return true;
  };
  const spacing = quality === "eco" ? 64 : quality === "ultra" ? 40 : 48;
  const buildingCap = quality === "eco" ? 16 : quality === "ultra" ? 32 : 24;
  for (let distance = 12, marker = 0; distance < route.totalLength && buildings.length < buildingCap; distance += spacing, marker += 1) {
    const section = sampleTrackSection(route, distance);
    const skyline = section === "final-skyline";
    if (!skyline) continue;
    const tangent = sampleTrackTangent(route, distance);
    const side = makeSideVector(tangent).multiplyScalar(skyline && marker % 2 === 0 ? 1 : -1);
    const center = sampleTrackPosition(route, distance);
    if (skyline && center.y < 0.8) continue;
    const edgeDistance = sampleTrackWidth(route, distance) * 0.5;
    const distanceFromRoad = edgeDistance + 14;
    const position = center.clone().addScaledVector(side, distanceFromRoad);
    position.y = center.y - 0.14;
    if (!isClearOfRoad(route, position, 10)) continue;
    if (!groundPosition(position)) continue;
    const baseHeight = skyline ? 10 : 6;
    buildings.push({
      position,
      side: side.clone(),
      width: skyline ? 7 + (marker % 3) * 2 : 5 + (marker % 3),
      height: baseHeight + (marker % (skyline ? 5 : 4)) * (skyline ? 4.2 : 2.4),
      depth: skyline ? 5 : 4,
      rotation: Math.atan2(tangent.x, tangent.z) + Math.PI * 0.5,
    });

    if (skyline && quality !== "eco" && marker % 3 === 0 && buildings.length < buildingCap) {
      const opposite = center.clone().addScaledVector(side, -distanceFromRoad);
      opposite.y = center.y - 0.14;
      if (isClearOfRoad(route, opposite, 10) && groundPosition(opposite)) {
        buildings.push({
          position: opposite,
          side: side.clone().negate(),
          width: 4.5 + (marker % 2),
          height: baseHeight + 2 + (marker % 3) * 3,
          depth: 3.5,
          rotation: Math.atan2(tangent.x, tangent.z) - Math.PI * 0.5,
        });
      }
    }
  }

  if (buildings.length === 0) return group;

  const blockGeometry = new BoxGeometry(1, 1, 1);
  const buildingMaterial = new MeshStandardMaterial({
    name: "rift-horizon-building-material",
    map: sceneryTexture("facade"),
    color: 0xb2a6c9,
    emissive: 0x110d2c,
    emissiveIntensity: 0.55,
    roughness: 0.7,
    metalness: 0.12,
  });
  const blocks = new InstancedMesh(blockGeometry, buildingMaterial, buildings.length);
  blocks.name = "rift-distant-building-blocks";
  blocks.castShadow = false;
  blocks.receiveShadow = false;
  const facadeGeometry = new PlaneGeometry(1, 1);
  const facadeMaterial = new MeshBasicMaterial({
    name: "rift-horizon-window-material",
    map: sceneryTexture("facade"),
    color: 0xc5b8da,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const facades = new InstancedMesh(facadeGeometry, facadeMaterial, buildings.length);
  facades.name = "rift-distant-building-facades";
  const blockMatrix = new Matrix4();
  const facadeMatrix = new Matrix4();
  const rotation = new Quaternion();
  for (let index = 0; index < buildings.length; index += 1) {
    const building = buildings[index];
    const base = building.position.clone();
    rotation.setFromAxisAngle(UP, building.rotation);
    blockMatrix.compose(
      base.clone().addScaledVector(UP, building.height * 0.5),
      rotation,
      new Vector3(building.width, building.height, building.depth),
    );
    blocks.setMatrixAt(index, blockMatrix);
    const facadePosition = base.clone()
      .addScaledVector(building.side, -building.depth * 0.5 - 0.04)
      .addScaledVector(UP, building.height * 0.58);
    rotation.setFromAxisAngle(UP, Math.atan2(-building.side.x, -building.side.z));
    facadeMatrix.compose(
      facadePosition,
      rotation,
      new Vector3(building.width * 0.72, building.height * 0.62, 1),
    );
    facades.setMatrixAt(index, facadeMatrix);
  }
  blocks.instanceMatrix.needsUpdate = true;
  facades.instanceMatrix.needsUpdate = true;
  blocks.computeBoundingSphere();
  facades.computeBoundingSphere();
  group.add(blocks, facades);

  const skylineCap = quality === "eco" ? 6 : quality === "ultra" ? 20 : 12;
  const antennaGeometry = new CylinderGeometry(0.09, 0.16, 1, 5);
  const antennaMaterial = new MeshBasicMaterial({
    name: "rift-horizon-antenna-material",
    color: new Color(0x58dfff).multiplyScalar(1.8),
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const antennas = new InstancedMesh(antennaGeometry, antennaMaterial, Math.min(skylineCap, buildings.length));
  antennas.name = "rift-skyline-antennas";
  const rooftopGeometry = new BoxGeometry(1, 0.12, 0.22);
  const rooftopMaterial = new MeshBasicMaterial({
    name: "rift-skyline-rooftop-light-material",
    color: new Color(0xff5fbb).multiplyScalar(1.7),
    transparent: true,
    opacity: 0.74,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const rooftops = new InstancedMesh(rooftopGeometry, rooftopMaterial, Math.min(skylineCap, buildings.length));
  rooftops.name = "rift-skyline-rooftop-lights";
  const antennaMatrix = new Matrix4();
  const rooftopMatrix = new Matrix4();
  const identityRotation = new Quaternion();
  for (let index = 0; index < Math.min(skylineCap, buildings.length); index += 1) {
    const building = buildings[(index * 2) % buildings.length];
    antennaMatrix.makeTranslation(
      building.position.x,
      building.position.y + building.height + 0.85 + (index % 2) * 0.25,
      building.position.z,
    );
    antennas.setMatrixAt(index, antennaMatrix);
    rooftopMatrix.compose(
      building.position.clone().addScaledVector(UP, building.height + 0.1),
      identityRotation,
      new Vector3(building.width * 0.58, 1, building.depth * 0.12),
    );
    rooftops.setMatrixAt(index, rooftopMatrix);
  }
  antennas.instanceMatrix.needsUpdate = true;
  rooftops.instanceMatrix.needsUpdate = true;
  antennas.computeBoundingSphere();
  rooftops.computeBoundingSphere();
  group.add(antennas, rooftops);
  return group;
}

function makeAirborneScenery(route: TrackRoute, quality: RiftWorldQuality): {
  group: Group;
  airborne: AirborneCue[];
} {
  const group = new Group();
  group.name = "rift-sky-events";
  const airborne: AirborneCue[] = [];
  const balloonCap = quality === "eco" ? 2 : quality === "ultra" ? 7 : 4;
  const kiteCap = quality === "eco" ? 1 : quality === "ultra" ? 5 : 3;
  const balloonGeometry = new SphereGeometry(1, quality === "ultra" ? 10 : 8, quality === "ultra" ? 7 : 6);
  const balloonMaterial = new MeshBasicMaterial({
    name: "rift-airborne-balloon-material",
    color: new Color(0xff648f).multiplyScalar(1.6),
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const balloons = new InstancedMesh(balloonGeometry, balloonMaterial, balloonCap);
  balloons.name = "rift-airborne-balloons";
  const kites = new InstancedMesh(
    makeKiteGeometry(),
    new MeshBasicMaterial({
      name: "rift-airborne-kite-material",
      color: new Color(0x63e8ff).multiplyScalar(1.35),
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    }),
    kiteCap,
  );
  kites.name = "rift-airborne-kites";
  const matrix = new Matrix4();
  const identityRotation = new Quaternion();
  let balloonIndex = 0;
  let kiteIndex = 0;
  const spacing = quality === "eco" ? 220 : quality === "ultra" ? 150 : 185;
  for (let distance = 90, marker = 0; distance < route.totalLength && (balloonIndex < balloonCap || kiteIndex < kiteCap); distance += spacing, marker += 1) {
    const section = sampleTrackSection(route, distance);
    if (section !== "coastal-boulevard" && section !== "causeway" && section !== "final-skyline") continue;
    const tangent = sampleTrackTangent(route, distance);
    const side = makeSideVector(tangent);
    const center = sampleTrackPosition(route, distance);
    const halfWidth = sampleTrackWidth(route, distance) * 0.5;
    const position = center.clone().addScaledVector(side, (marker % 2 === 0 ? 1 : -1) * (halfWidth + 44 + (marker % 3) * 10));
    if (!isClearOfRoad(route, position, 14)) continue;
    if (balloonIndex < balloonCap) {
      const balloonPosition = position.clone().addScaledVector(UP, 19 + (marker % 3) * 3.5);
      const scale = new Vector3(2, 2.55, 2);
      matrix.compose(balloonPosition, identityRotation, scale);
      balloons.setMatrixAt(balloonIndex, matrix);
      airborne.push({ mesh: balloons, index: balloonIndex, basePosition: balloonPosition, scale, rotation: identityRotation.clone(), phase: marker * 1.27 });
      balloonIndex += 1;
    }
    if (kiteIndex < kiteCap && marker % 2 === 1) {
      const kitePosition = position.clone().addScaledVector(tangent, 12).addScaledVector(UP, 29 + (marker % 2) * 4);
      const scale = new Vector3(2.8, 3.5, 1);
      const rotation = new Quaternion().setFromAxisAngle(UP, marker * 0.8);
      matrix.compose(kitePosition, rotation, scale);
      kites.setMatrixAt(kiteIndex, matrix);
      airborne.push({ mesh: kites, index: kiteIndex, basePosition: kitePosition, scale, rotation, phase: marker * 1.71 + 0.8 });
      kiteIndex += 1;
    }
  }
  balloons.count = balloonIndex;
  kites.count = kiteIndex;
  if (balloonIndex > 0) {
    balloons.instanceMatrix.needsUpdate = true;
    balloons.computeBoundingSphere();
    group.add(balloons);
  }
  if (kiteIndex > 0) {
    kites.instanceMatrix.needsUpdate = true;
    kites.computeBoundingSphere();
    group.add(kites);
  }
  return { group, airborne };
}

function makeScenery(route: TrackRoute, quality: RiftWorldQuality): SceneryData {
  const palm = createPalmTree();
  const district = createRoadsideDistrict(route, quality, palm, createStreetLamp());
  district.add(createRoadsidePlants(route, quality, district));


  // Architecture belongs to the grounded roadside district. An additional
  // horizon row stays sparse and well clear of the racing surface.

  return { group: district, airborne: [] };
}

type TunnelCue = {
  ring: Mesh<TorusGeometry, MeshBasicMaterial>;
  distance: number;
  spacing: number;
  activateAt: number;
  lightMaterial: MeshBasicMaterial;
};

type UnderwaterMaterial = ShaderMaterial & {
  uniforms: ShaderMaterial["uniforms"] & { time: { value: number } };
};

type CoastalWaterMaterial = ShaderMaterial & {
  uniforms: ShaderMaterial["uniforms"] & {
    time: { value: number };
    impactPosition: { value: Vector3 };
    impactTime: { value: number };
    impactStrength: { value: number };
  };
};

function makeTunnelArchGeometry(): TorusGeometry {
  // A unit arch is scaled per route width. Keeping one geometry avoids the
  // slightly different faceting and floating-point seams of per-ring toruses.
  return new TorusGeometry(1, 0.018, 6, 24, Math.PI);
}

function makeUnderwaterGlassMaterial(
  name: string,
  causticOnly = false,
  volumeOnly = false,
): UnderwaterMaterial {
  return new ShaderMaterial({
    name,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: { time: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      varying vec3 vGlassNormal;
      void main() {
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        vGlassNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      varying vec3 vWorldPosition;
      varying vec3 vGlassNormal;
      void main() {
        vec3 p = vWorldPosition;
        float waveA = sin(p.x * 0.52 + time * 1.45 + sin(p.z * 0.19 - time * 0.55));
        float waveB = sin(p.z * 0.78 - time * 1.05 + sin(p.x * 0.13 + time * 0.38));
        float caustic = smoothstep(0.18, 0.92, waveA * 0.55 + waveB * 0.45);
        float thinBand = smoothstep(0.72, 0.97, sin(p.x * 1.7 - p.z * 0.34 + time * 2.15) * 0.5 + 0.5);
        vec3 deepBlue = vec3(0.015, 0.20, 0.34);
        vec3 cyan = vec3(0.08, 0.78, 0.92);
         vec3 color = mix(deepBlue, cyan, caustic * 0.78 + thinBand * 0.22);
         float fresnel = pow(1.0 - abs(dot(normalize(vGlassNormal), normalize(cameraPosition-p))), 3.0);
         float alpha = ${causticOnly
           ? "0.01 + caustic * 0.05 + thinBand * 0.035"
           : volumeOnly
             ? "0.065 + fresnel * 0.025 + caustic * 0.045"
             : "0.025 + fresnel * 0.14 + caustic * 0.025"};
         alpha *= exp(-0.000625 * dot(cameraPosition-p,cameraPosition-p));
         gl_FragColor = vec4(color * ${causticOnly ? "1.75" : volumeOnly ? "0.68" : "0.9"}, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }) as UnderwaterMaterial;
}

function makeFishGeometry(): BufferGeometry {
  // A deliberately flat silhouette reads as wildlife outside the glass from
  // the chase camera, without the visual bulk of a cone or sphere.
  const positions = new Float32Array([
    0.92, 0, 0, 0.22, 0.26, 0, -0.62, 0.16, 0,
    -0.62, 0.16, 0, -0.62, -0.16, 0, 0.22, -0.26, 0,
    -0.62, 0.08, 0, -1.12, 0.48, 0, -0.94, 0, 0,
    -0.62, -0.08, 0, -0.94, 0, 0, -1.12, -0.48, 0,
    0.06, 0.18, 0, -0.2, 0.58, 0, -0.42, 0.18, 0,
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex([
    0, 1, 2, 2, 4, 5, 5, 0, 2,
    6, 7, 8, 9, 10, 11,
  ]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeKelpBladeGeometry(): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const steps = 6;
  for (let step = 0; step <= steps; step += 1) {
    const amount = step / steps;
    const sway = Math.sin(amount * Math.PI * 1.35) * 0.55;
    const width = (1 - amount * 0.72) * 0.3;
    const height = amount * 6.2;
    positions.push(sway - width, height, amount * 0.18, sway + width, height, amount * 0.18);
    if (step < steps) {
      const vertex = step * 2;
      indices.push(vertex, vertex + 2, vertex + 1, vertex + 1, vertex + 2, vertex + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(Array.from({ length: steps + 1 }, (_, step) => [0, step / steps, 1, step / steps]).flat(), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeKelpCluster(
  bladeGeometry: BufferGeometry,
  material: MeshBasicMaterial,
  scale: number,
  index: number,
): Group {
  const cluster = new Group();
  cluster.name = "rift-underwater-kelp";
  const bladeCount = scale > 0.9 ? 3 : 2;
  for (let bladeIndex = 0; bladeIndex < bladeCount; bladeIndex += 1) {
    const blade = new Mesh(bladeGeometry, material);
    blade.scale.setScalar(scale * (0.86 + (bladeIndex % 3) * 0.12));
    blade.rotation.y = index * 0.7 + bladeIndex * 1.8;
    blade.rotation.z = (bladeIndex - 1) * 0.12;
    cluster.add(blade);
  }
  return cluster;
}

/** Continuous cross sections prevent gaps and overlapping cylinders on bends. */
function makeCanopyGeometry(route: TrackRoute, section: TrackSection, fullTube = false, radialSteps = 32): BufferGeometry {
  const frames = makeRouteFrames(route);
  const positions: number[] = [];
  const indices: number[] = [];
  const dive = getDiveLayout(route);
  for (const segment of route.segments) {
    if (segment.section !== section) continue;
    if (section === "tunnel" && dive && segment.endDistance > dive.approachStart) continue;
    const base = positions.length / 3;
    for (const pointIndex of segmentPointIndices(route, segment.index)) {
      const point = route.points[pointIndex];
      const frame = frames[pointIndex];
      const radius = point.width * 0.5 + 1.25;
      for (let step = 0; step <= radialSteps; step += 1) {
        const angle = step / radialSteps * (fullTube ? Math.PI * 2 : Math.PI);
        const position = point.position.clone().addScaledVector(frame.side, Math.cos(angle) * radius * frame.miterScale);
        position.y += 0.2 + Math.sin(angle) * radius;
        positions.push(position.x, position.y, position.z);
      }
    }
    for (let step = 0; step < radialSteps; step += 1) {
      const vertex = base + step;
      const nextRow = vertex + radialSteps + 1;
      indices.push(vertex, nextRow, vertex + 1, vertex + 1, nextRow, nextRow + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeTunnelCues(route: TrackRoute, quality: RiftWorldQuality): {
  group: Group;
  cues: TunnelCue[];
} {
  const group = new Group();
  group.name = "rift-tunnel-cues";
  const cues: TunnelCue[] = [];
  const material = new MeshBasicMaterial({
    color: new Color(0xf54fbc).multiplyScalar(3),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const cyanLightMaterial = new MeshBasicMaterial({
    name: "rift-tunnel-cyan-light-material",
    color: new Color(0xa768ff).multiplyScalar(2.5),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const pinkLightMaterial = new MeshBasicMaterial({
    name: "rift-tunnel-pink-light-material",
    color: new Color(0xff63c7).multiplyScalar(2.5),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const archGeometry = makeTunnelArchGeometry();
  const lightGeometry = new BoxGeometry(0.14, 0.07, 1.25);
  const shellMaterial = new MeshStandardMaterial({
    name: "rift-tunnel-shell-material",
    color: 0x22243c,
    emissive: 0x10132c,
    emissiveIntensity: 0.6,
    roughness: 0.75,
    side: DoubleSide,
  });
  const shell = new Mesh(makeCanopyGeometry(route, "tunnel"), shellMaterial);
  shell.name = "rift-tunnel-shell";
  shell.receiveShadow = true;
  group.add(shell);
  const spacing = quality === "eco" ? 18 : quality === "ultra" ? 8 : 11;

  for (let distance = spacing * 0.5; distance < route.totalLength; distance += spacing) {
    if (sampleTrackSection(route, distance) !== "tunnel") continue;
    const dive = getDiveLayout(route);
    if (dive && distance >= dive.approachStart) continue;
    const tangent = sampleTrackTangent(route, distance);
    const center = sampleTrackPosition(route, distance);
    center.y += 0.2;
    const radius = sampleTrackWidth(route, distance) * 0.5 + 1.18;
    const ring = new Mesh(archGeometry, material.clone());
    ring.name = "rift-tunnel-neon-arch";
    ring.userData.routeDistance = distance;
    ring.position.copy(center);
    ring.scale.set(radius, radius, 1);
    ring.rotation.set(-Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z)),
      Math.atan2(tangent.x, tangent.z), 0, "YXZ");
    ring.renderOrder = 3;
    group.add(ring);

    const lightMaterial = ((Math.floor(distance / spacing) % 2 === 0)
      ? cyanLightMaterial
      : pinkLightMaterial).clone();
    const light = new Mesh(lightGeometry, lightMaterial);
    light.name = "rift-tunnel-arch-light";
    light.position.copy(center).addScaledVector(UP, radius - 0.08);
    light.quaternion.copy(ring.quaternion);
    light.renderOrder = 4;
    group.add(light);
    cues.push({ ring, distance, spacing, activateAt: Infinity, lightMaterial });
  }

  return { group, cues };
}

type UnderwaterCue = {
  object: Object3D;
  baseY: number;
  phase: number;
  amplitude: number;
  baseScale: number;
};

function makeUnderwaterCues(route: TrackRoute, quality: RiftWorldQuality): {
  group: Group;
  bubbles: UnderwaterCue[];
  materials: UnderwaterMaterial[];
} {
  const group = new Group();
  group.name = "rift-underwater-cues";
  group.add(createUnderwaterStructure(route, quality));
  const bubbles: UnderwaterCue[] = [];
  const bubbleGeometry = new SphereGeometry(0.11, quality === "ultra" ? 20 : 12, quality === "ultra" ? 12 : 8);
  const bubbleMaterial = new MeshPhysicalMaterial({
    color: 0x53e8ff,
    transparent: true,
    opacity: 0.18,
    roughness: 0.12,
    metalness: 0.2,
    clearcoat: 1,
    depthWrite: false,
  });
  const kelpMaterial = new MeshBasicMaterial({
    name: "rift-underwater-kelp-material",
    map: detailTexture("leaf"),
    color: 0x087e79,
    transparent: true,
    opacity: 0.82,
    side: DoubleSide,
  });
  const glassMaterial = makeUnderwaterGlassMaterial("rift-underwater-glass-material");
  const causticMaterial = makeUnderwaterGlassMaterial("rift-underwater-caustic-material", true);
  const fishMap = sceneryTexture("fish");
  const fishMaterial = new SpriteMaterial({
    name: "rift-underwater-fish-material",
    map: fishMap,
    color: 0xdafaff,
    transparent: true,
    opacity: 0.95,
    alphaTest: 0.04,
    depthWrite: false,
  });
  const sharkMaterial = new SpriteMaterial({
    name: "rift-underwater-shark-material",
    map: fishMap,
    color: 0x7e9fbf,
    transparent: true,
    opacity: 0.82,
    alphaTest: 0.04,
    depthWrite: false,
  });
  const glassGeometry = makeCanopyGeometry(route, "underwater", true, quality === "ultra" ? 64 : quality === "eco" ? 24 : 40);
  const glassTube = new Mesh(glassGeometry, glassMaterial);
  glassTube.name = "rift-underwater-glass-tube";
  glassTube.renderOrder = 1;
  group.add(glassTube);
  const causticTube = new Mesh(glassGeometry, causticMaterial);
  causticTube.name = "rift-underwater-caustic-bands";
  causticTube.renderOrder = 2;
  group.add(causticTube);
  const kelpGeometry = makeKelpBladeGeometry();
  const spacing = quality === "eco" ? 26 : quality === "ultra" ? 12 : 17;
  const fishPerStation = quality === "ultra" ? 2 : 1;
  const bubblesPerStation = quality === "eco" ? 2 : quality === "ultra" ? 4 : 3;
  for (let distance = 0, index = 0; distance < route.totalLength; distance += spacing, index += 1) {
    if (sampleTrackSection(route, distance) !== "underwater") continue;
    const tangent = sampleTrackTangent(route, distance);
    const side = makeSideVector(tangent);
    const center = sampleTrackPosition(route, distance);
    const width = Math.max(5, sampleTrackWidth(route, distance) * 0.5);

    for (let bubbleIndex = 0; bubbleIndex < bubblesPerStation; bubbleIndex += 1) {
      const bubble = new Mesh(bubbleGeometry, bubbleMaterial);
      const offset = (bubbleIndex % 2 === 0 ? 1 : -1) * (width + 2.2 + bubbleIndex * 0.4);
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
        baseScale: 0.7 + bubbleIndex * 0.22,
      });
    }

    for (let fishIndex = 0; fishIndex < fishPerStation; fishIndex += 1) {
      const fish = new Sprite(fishIndex === 0 ? fishMaterial : sharkMaterial);
      fish.name = fishIndex === 0 ? "rift-underwater-fish" : "rift-underwater-fish-schoolmate";
      fish.position
        .copy(center)
        .addScaledVector(side, (fishIndex % 2 === 0 ? 1 : -1) * (width + 1.8))
        .addScaledVector(tangent, (index % 2 === 0 ? -1 : 1) * (1.9 + fishIndex * 1.2));
      fish.position.y += 1.4 + (index % 3) * 0.45 + fishIndex * 1.1;
      fish.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), tangent);
      const fishScale = (fishIndex === 0 ? 0.92 : 2.15) * (0.9 + (index % 3) * 0.08);
      fish.scale.set(fishScale * 2.4, fishScale * 1.2, 1);
      group.add(fish);
      bubbles.push({
        object: fish,
        baseY: fish.position.y,
        phase: index * 0.51 + fishIndex * 0.9 + 0.4,
        amplitude: 0.18,
        baseScale: fishScale,
      });
    }

    if (index % 5 === 0 && fishPerStation === 1) {
      const shark = new Sprite(sharkMaterial);
      shark.name = "rift-underwater-shark-silhouette";
      shark.position
        .copy(center)
        .addScaledVector(side, width + 4.6)
        .addScaledVector(tangent, -2.4);
      shark.position.y += 2.6;
      shark.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), tangent);
      shark.scale.set(5.16, 2.58, 1);
      group.add(shark);
      bubbles.push({
        object: shark,
        baseY: shark.position.y,
        phase: index * 0.7 + 1.1,
        amplitude: 0.12,
        baseScale: 2.15,
      });
    }

    const plantScale = quality === "eco" ? 0.82 : quality === "ultra" ? 1.12 : 0.98;
    const kelp = makeKelpCluster(kelpGeometry, kelpMaterial, plantScale, index);
    kelp.position.copy(center).addScaledVector(side, width + 1.5);
    kelp.position.y -= 6.3;
    kelp.rotation.z = 0.16 + (index % 3) * 0.12;
    group.add(kelp);
    if (quality !== "eco" && index % 2 === 0) {
      const farKelp = makeKelpCluster(kelpGeometry, kelpMaterial, plantScale * 0.78, index + 2);
      farKelp.position.copy(center).addScaledVector(side, -(width + 2.4));
      farKelp.position.y -= 6.3;
      farKelp.rotation.z = -0.12;
      group.add(farKelp);
    }
  }

  return { group, bubbles, materials: [glassMaterial, causticMaterial] };
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
    if (object instanceof Light || object instanceof InstancedMesh) object.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
    material.dispose();
  });
}

/**
 * A scene-only rendering layer for the first Rift Racer route slice.
 * Add the group to any Three.js Scene and call update from the host game loop.
 */
export class RiftWorld extends Group {
  readonly route: TrackRoute;
  readonly quality: RiftWorldQuality;
  readonly track: Group;
  readonly startGate: Group;
  readonly cliffTransition: Group;
  readonly scenery: Group;
  readonly tunnelCues: Group;
  readonly underwaterCues: Group;
  readonly sky: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly environment: Group;
  private readonly shadowLight?: DirectionalLight;
  private readonly skyLife?: SkyLife;
  private readonly cityLife?: CityLife;
  private readonly aquaticLife?: AquaticLife;
  private readonly mountainBackdrop: Group;
  private readonly plantTime?: { value: number };
  private previousTunnelFocus = 0;
  private readonly roadsideChunks: Group[] = [];

  private readonly neonMaterials: MeshBasicMaterial[] = [];
  private readonly tunnelCueData: TunnelCue[];
  private readonly bubbleData: UnderwaterCue[];
  private readonly underwaterMaterials: UnderwaterMaterial[];
  private readonly dynamicLightData: DynamicLightData[] = [];
  private readonly decorativeCullItems: DecorativeCullItem[];
  private readonly airborneCues: AirborneCue[];
  private readonly diveTransition: CliffDiveTransition;
  private readonly oceanMaterial: CoastalWaterMaterial;
  readonly localVisibility: LocalSceneVisibility;
  private readonly sectionRanges = new Map<TrackSection, Array<{ start: number; end: number }>>();
  private elapsedSeconds = 0;
  private disposed = false;

  constructor(options: RiftWorldOptions = {}) {
    super();
    this.name = "rift-racer-world";
    this.route = options.route ?? SAMPLE_ROUTE;
    this.quality = options.quality ?? "balanced";
    for (const span of this.route.segments) {
      const ranges = this.sectionRanges.get(span.section) ?? [];
      const previous = ranges[ranges.length - 1];
      if (previous && Math.abs(previous.end - span.startDistance) < EPSILON) previous.end = span.endDistance;
      else ranges.push({ start: span.startDistance, end: span.endDistance });
      this.sectionRanges.set(span.section, ranges);
    }

    const roadLift = Math.max(0, finiteOr(options.roadLift, 0.035));
    this.sky = makeGradientSky();
    this.add(this.sky);
    this.add(createSynthwaveSun());
    this.environment = createCoastalEnvironment(this.route);
    this.add(this.environment);
    this.mountainBackdrop = createMountainBackdrop(this.route);this.add(this.mountainBackdrop);
    const ocean = this.environment.getObjectByName("rift-coastal-water-surface") as Mesh<PlaneGeometry, ShaderMaterial>;
    this.oceanMaterial = ocean.material as CoastalWaterMaterial;

    const ambientIntensity = this.quality === "eco" ? 2 : 1.55;
    this.add(new HemisphereLight(0xc6b5ef, 0x26324b, ambientIntensity));
    const rimIntensity = this.quality === "ultra" ? 3.5 : this.quality === "eco" ? 1.35 : 2.45;
    const rimLight = new PointLight(0x9e3f88, rimIntensity, 150, 2);
    rimLight.name = "rift-rim-light";
    rimLight.position.set(-14, 18, -18);
    rimLight.visible = this.quality !== "eco";
    this.add(rimLight);
    this.dynamicLightData.push({ light: rimLight, baseIntensity: rimIntensity, phase: 0.4 });
    const waterIntensity = this.quality === "ultra" ? 4.1 : this.quality === "eco" ? 1.4 : 2.7;
    const waterLight = new PointLight(0x18a6ff, waterIntensity, 120, 2);
    waterLight.name = "rift-water-light";
    waterLight.position.set(-34, -2, -34);
    waterLight.visible = this.quality !== "eco";
    this.add(waterLight);
    this.dynamicLightData.push({ light: waterLight, baseIntensity: waterIntensity, phase: 1.8 });

    if (this.quality !== "eco") {
      const keyLight = new DirectionalLight(0xffcab5, 2.2);
      keyLight.name = this.quality === "ultra" ? "rift-ultra-key-light" : "rift-key-light";
      keyLight.position.set(44, 52, 20);
      keyLight.target.position.set(24, 0, 0);
      keyLight.castShadow = true;
      const mapSize = this.quality === "ultra" ? 2048 : 1024;
      keyLight.shadow.mapSize.set(mapSize, mapSize);
      keyLight.shadow.bias = -0.0003;
      keyLight.shadow.normalBias = 0.04;
      keyLight.shadow.camera.near = 1;
      keyLight.shadow.camera.far = 300;
      keyLight.shadow.camera.left = -38;
      keyLight.shadow.camera.right = 38;
      keyLight.shadow.camera.top = 38;
      keyLight.shadow.camera.bottom = -38;
      this.add(keyLight, keyLight.target);
      this.shadowLight = keyLight;

      const cyanFill = new PointLight(0x26cfff, 8, 48, 2);
      cyanFill.name = "rift-ultra-cyan-fill";
      cyanFill.position.set(26, 8, 16);
      this.add(cyanFill);
      this.dynamicLightData.push({ light: cyanFill, baseIntensity: 2.2, phase: 3.1 });
    }

    const trackData = makeTrackGroup(this.route, roadLift, this.neonMaterials, this.quality);
    this.track = trackData.group;
    this.decorativeCullItems = trackData.decorative;
    this.startGate = createStartGate(this.route, roadLift);
    this.track.add(this.startGate);
    this.diveTransition = new CliffDiveTransition(this.route, roadLift, this.quality);
    this.cliffTransition = this.diveTransition.group;
    this.track.add(this.cliffTransition);
    this.add(this.track);

    const sceneryData = options.scenery === false
      ? { group: new Group(), airborne: [] as AirborneCue[] }
      : makeScenery(this.route, this.quality);
    this.scenery = sceneryData.group;
    this.airborneCues = sceneryData.airborne;
    this.scenery.name = "rift-scenery";
    this.add(this.scenery);
    this.scenery.traverse(object => { if (object instanceof Group && (object.name === "rift-district-chunk" || object.name === "rift-planted-verge-chunk")) this.roadsideChunks.push(object); });
    this.plantTime = this.scenery.getObjectByName("rift-dense-roadside-plants")?.userData.time;
    if (options.scenery !== false) {
      this.skyLife = new SkyLife(this.route, this.quality);this.add(this.skyLife);
      this.cityLife = new CityLife(this.route, this.quality);this.add(this.cityLife);
    }

    const tunnelData = options.environmentCues === false
      ? { group: new Group(), cues: [] as TunnelCue[] }
      : makeTunnelCues(this.route, this.quality);
    this.tunnelCues = tunnelData.group;
    this.tunnelCueData = tunnelData.cues;
    this.add(this.tunnelCues);

    const underwaterData = options.environmentCues === false
      ? { group: new Group(), bubbles: [] as UnderwaterCue[], materials: [] as UnderwaterMaterial[] }
      : makeUnderwaterCues(this.route, this.quality);
    this.underwaterCues = underwaterData.group;
    this.bubbleData = underwaterData.bubbles;
    this.underwaterMaterials = underwaterData.materials;
    this.add(this.underwaterCues);
    if (options.environmentCues !== false) {
      this.aquaticLife = new AquaticLife(this.route, this.quality, this.underwaterCues);
      this.underwaterCues.add(this.aquaticLife);
    }

    // The enclosure is part of the map, not regional decoration. Keep these
    // two surfaces present even when distant fish, ribs and lights are culled.
    const enclosures = new Group();
    enclosures.name = "rift-permanent-enclosures";
    for (const name of ["rift-tunnel-shell", "rift-underwater-glass-tube"]) {
      const shell = this.getObjectByName(name);
      if (shell) enclosures.add(shell);
    }
    this.add(enclosures);
    if (options.environmentCues !== false) this.add(createTunnelHeadland(this.route));
    this.localVisibility = new LocalSceneVisibility(this, this.route, this.quality);
  }

  resetTransitions(): void {
    this.diveTransition.reset();
    this.resetWaterImpact();
    this.resetTunnelLights();
  }

  private resetTunnelLights(): void {
    this.tunnelCueData.forEach(cue => {
      cue.activateAt = Infinity;cue.ring.material.opacity = 0;cue.lightMaterial.opacity = 0;
    });
    this.previousTunnelFocus = 0;
  }

  /** Feed a sea-level landing into the pooled ocean shader response. */
  emitSplash(position: Vector3): void {
    if (this.disposed) return;
    this.oceanMaterial.uniforms.impactPosition.value.copy(position);
    this.oceanMaterial.uniforms.impactTime.value = 0;
    this.oceanMaterial.uniforms.impactStrength.value = 1;
  }

  private resetWaterImpact(): void {
    this.oceanMaterial.uniforms.impactTime.value = -1;
    this.oceanMaterial.uniforms.impactStrength.value = 0;
  }

  /** Animate emissive accents and environment dressing for one host frame. */
  update(deltaSeconds = 0, state: RiftWorldUpdateState = {}): void {
    if (this.disposed) return;
    const delta = clamp(finiteOr(deltaSeconds, 0), 0, 0.1);
    this.elapsedSeconds = state.elapsedSeconds === undefined
      ? this.elapsedSeconds + delta
      : finiteOr(state.elapsedSeconds, this.elapsedSeconds);

    // Real geometry remains visible on approach; the depth buffer handles
    // occlusion. Hiding whole sections caused the tunnel to pop into view.
    this.oceanMaterial.uniforms.time.value = this.elapsedSeconds;
    if (this.oceanMaterial.uniforms.impactTime.value >= 0) {
      const impactTime = this.oceanMaterial.uniforms.impactTime.value + delta;
      if (impactTime > 1.8) this.resetWaterImpact();
      else this.oceanMaterial.uniforms.impactTime.value = impactTime;
    }
    let focusDistance: number | undefined;
    let normalizedFocus: number | undefined;
    if (typeof state.routeDistance === "number" && Number.isFinite(state.routeDistance)) {
      focusDistance = state.routeDistance;
    } else if (state.playerPosition
      && Number.isFinite(state.playerPosition.x)
      && Number.isFinite(state.playerPosition.y)
      && Number.isFinite(state.playerPosition.z)) {
      focusDistance = findNearestTrackPoint(this.route, state.playerPosition).distanceAlongTrack;
    }
    // Apply broad spatial visibility first. The route-distance pass below is
    // intentionally authoritative for road decoration, so a nearby flyover
    // cannot accidentally re-enable a far route chunk.
    const focus = state.playerPosition ?? (focusDistance === undefined ? undefined : sampleTrackPosition(this.route, focusDistance));
    this.localVisibility.update(focus);
    if (focusDistance !== undefined && this.route.totalLength > EPSILON) {
      normalizedFocus = this.route.closed
        ? ((focusDistance % this.route.totalLength) + this.route.totalLength) % this.route.totalLength
        : clamp(focusDistance, 0, this.route.totalLength);
      const cullRadius = this.quality === "eco" ? 176 : this.quality === "ultra" ? 300 : 236;
      for (const item of this.decorativeCullItems) {
        const distance = Math.abs(item.routeDistance - normalizedFocus);
        const routeGap = this.route.closed
          ? Math.min(distance, this.route.totalLength - distance)
          : distance;
        item.object.visible = item.object.visible && routeGap <= cullRadius + item.halfSpan;
      }
    } else {
      // Editor previews and static screenshots have no player focus; keep all
      // decorative chunks available in that mode.
      this.decorativeCullItems.forEach((item) => { item.object.visible = true; });
    }
    for (const chunk of this.roadsideChunks) {
      const gap = normalizedFocus === undefined ? 0 : Math.abs(chunk.userData.routeDistance - normalizedFocus);
      const along = this.route.closed ? Math.min(gap, this.route.totalLength - gap) : gap;
      chunk.visible = along < (chunk.name === "rift-district-chunk" ? 220 : 118);
    }
    this.diveTransition.update(delta, normalizedFocus, finiteOr(state.speed, 0), state.playerPosition);
    const activeSection = focusDistance === undefined
      ? "coastal-boulevard"
      : sampleTrackSection(this.route, focusDistance);
    const underwater = state.submerged ?? activeSection === "underwater";
    this.mountainBackdrop.visible = !underwater;
    if (this.cityLife) { this.cityLife.visible = !underwater;this.cityLife.update(this.elapsedSeconds, state.playerPosition); }
    const sun = this.getObjectByName("rift-synthwave-sun");
    if (sun) sun.visible = !underwater;
    if (this.skyLife) { this.skyLife.visible = !underwater;this.skyLife.update(this.elapsedSeconds, state.playerPosition); }
    if (this.plantTime) this.plantTime.value = this.elapsedSeconds;
    // Bring decoration in before the entrance. The enclosure surfaces above
    // stay visible regardless of region; fog softens the distant detail limit.
    const nearSection = (section: TrackSection): boolean => normalizedFocus === undefined
      || (this.sectionRanges.get(section) ?? []).some((range) => {
        const distance = normalizedFocus!;
        const dive = getDiveLayout(this.route);
        // Keep the tunnel's neon approach cue alive across the cliff launch
        // and water entry. The shell itself is permanent; this prevents the
        // last tunnel lights from popping off before the car reaches the sea.
        const tunnelDiveWindow = section === "tunnel" && dive
          && distance >= dive.approachStart - 100 && distance <= dive.boundary + 100;
        return (distance >= range.start - 100 && distance <= range.end + 100)
          || tunnelDiveWindow
          || (this.route.closed && (
            distance + this.route.totalLength <= range.end + 100
            || distance - this.route.totalLength >= range.start - 100
          ));
      });
    this.tunnelCues.visible = nearSection("tunnel");
    this.underwaterCues.visible = nearSection("underwater");
    const skyColors = underwater ? [0x026f9b, 0x086d96, 0x03394e] : [0x170a36, 0xeb5795, 0x49244f];
    const fade = delta === 0 ? 1 : 1 - Math.exp(-delta * (underwater ? 8 : 3));
    for (const [index, name] of ["topColor", "horizonColor", "lowColor"].entries()) {
      (this.sky.material.uniforms[name].value as Color).lerp(new Color(skyColors[index]), fade);
    }
    if (this.shadowLight && state.playerPosition) {
      const position = state.playerPosition;
      this.shadowLight.target.position.set(position.x, position.y, position.z);
      this.shadowLight.position.copy(this.shadowLight.target.position).add(new Vector3(44, 65, 20));
    }
    if (state.playerPosition) {
      const position = state.playerPosition;
      (this.oceanMaterial.uniforms.playerPosition.value as Vector3).set(position.x, position.y, position.z);
      this.getObjectByName("rift-synthwave-sun")?.position.set(position.x, position.y, position.z);
    }

    const speedBoost = clamp(Math.abs(finiteOr(state.speed, 0)) / 34, 0, 1);
    this.dynamicLightData.forEach(({ light, baseIntensity, phase }) => {
      const shimmer = 0.88 + 0.12 * (0.5 + 0.5 * Math.sin(this.elapsedSeconds * 3.8 + phase));
      light.intensity = baseIntensity * shimmer * (1 + speedBoost * 0.08);
    });

    const tunnelStart = this.sectionRanges.get("tunnel")?.[0]?.start;
    if (normalizedFocus !== undefined && normalizedFocus < 40 && this.previousTunnelFocus > this.route.totalLength - 80) this.resetTunnelLights();
    if (normalizedFocus !== undefined) this.previousTunnelFocus = normalizedFocus;
    const enteredTunnel = tunnelStart !== undefined && normalizedFocus !== undefined
      && normalizedFocus >= tunnelStart && activeSection === "tunnel";
    this.tunnelCueData.forEach((cue) => {
      if (enteredTunnel && cue.distance <= normalizedFocus! + cue.spacing * 6 && cue.activateAt === Infinity) {
        const ahead = Math.max(0, (cue.distance - normalizedFocus!) / cue.spacing);
        cue.activateAt = this.elapsedSeconds + ahead * 0.025;
      }
      const progress = clamp((this.elapsedSeconds - cue.activateAt) / 0.065, 0, 1);
      const brightness = progress * progress * (3 - 2 * progress);
      cue.ring.material.opacity = 0.86 * brightness;
      cue.lightMaterial.opacity = 0.9 * brightness;
    });
    this.underwaterMaterials.forEach((material) => {
      material.uniforms.time.value = this.elapsedSeconds;
    });
    const airborneMatrix = new Matrix4();
    const updatedAirborneMeshes = new Set<InstancedMesh>();
    this.airborneCues.forEach((cue) => {
      const sway = Math.sin(this.elapsedSeconds * 0.32 + cue.phase);
      const lift = Math.sin(this.elapsedSeconds * 0.8 + cue.phase * 1.7) * 0.45;
      const position = cue.basePosition.clone()
        .add(new Vector3(sway * 1.4, lift, Math.cos(this.elapsedSeconds * 0.24 + cue.phase) * 0.8));
      airborneMatrix.compose(position, cue.rotation, cue.scale);
      cue.mesh.setMatrixAt(cue.index, airborneMatrix);
      updatedAirborneMeshes.add(cue.mesh);
    });
    updatedAirborneMeshes.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
    this.bubbleData.forEach((bubble) => {
      bubble.object.position.y = bubble.baseY + Math.sin(this.elapsedSeconds * 1.7 + bubble.phase) * bubble.amplitude;
      const scale = bubble.baseScale * (0.88 + 0.15 * Math.sin(this.elapsedSeconds * 2.2 + bubble.phase));
      if (bubble.object instanceof Sprite) {
        const anchor = bubble.object.userData.swimAnchor ??= bubble.object.position.clone();
        bubble.object.position.x = anchor.x + Math.sin(this.elapsedSeconds * 0.55 + bubble.phase) * 1.8;
        bubble.object.position.z = anchor.z + Math.cos(this.elapsedSeconds * 0.4 + bubble.phase) * 0.9;
        bubble.object.scale.set(scale * 2.4, scale * 1.2, 1);
      }
      else bubble.object.scale.setScalar(scale);
    });
    this.aquaticLife?.update(this.elapsedSeconds, state.playerPosition);
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
