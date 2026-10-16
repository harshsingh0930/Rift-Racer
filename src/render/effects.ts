import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Vector3,
} from "three";
import type { CarState } from "../game/arcade";
import { SAMPLE_ROUTE, type TrackRoute } from "../game/track";
import type { QualityTier } from "../game/performance";

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
const EPSILON = 1e-6;

export interface RiftEffectsOptions {
  route?: TrackRoute;
  quality?: QualityTier;
  maxSkidMarks?: number;
  maxSparks?: number;
  chevrons?: boolean;
  chevronSpacing?: number;
}

export interface RiftEffectsUpdateOptions {
  /** Optional authoritative wheel anchors from the visual car. */
  wheelPositions?: readonly Vector3[];
  /** Disable automatic drift emission for a frame while retaining particles. */
  emitDriftEffects?: boolean;
}

export interface ChevronMarkerOptions {
  spacing?: number;
  maxMarkers?: number;
  offsetFromEdge?: number;
  height?: number;
  length?: number;
  color?: number;
}

type SkidMark = {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  life: number;
  maxLife: number;
};

type Spark = {
  position: Vector3;
  velocity: Vector3;
  life: number;
  maxLife: number;
  active: boolean;
};

type ChevronPulse = {
  material: MeshBasicMaterial;
  phase: number;
};

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

function makeSkidMarkPool(count: number): SkidMark[] {
  const marks: SkidMark[] = [];
  for (let index = 0; index < count; index += 1) {
    const material = new MeshBasicMaterial({
      name: "rift-skid-mark-material",
      color: 0x130d24,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new Mesh(new PlaneGeometry(0.32, 1.35), material);
    mesh.name = "rift-drifting-skid-mark";
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.visible = false;
    mesh.renderOrder = 1;
    marks.push({ mesh, life: 0, maxLife: 1 });
  }
  return marks;
}

function createSparkPoints(count: number): {
  points: Points<BufferGeometry, PointsMaterial>;
  positions: Float32Array;
  colors: Float32Array;
} {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3 + 1] = -1000;
    colors[index * 3] = 1;
    colors[index * 3 + 1] = 0.38;
    colors[index * 3 + 2] = 0.08;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    name: "rift-drift-spark-material",
    size: 0.18,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new Points(geometry, material);
  points.name = "rift-drift-sparks";
  points.frustumCulled = false;
  return { points, positions, colors };
}

function getWheelPositionsFromState(state: CarState): Vector3[] {
  const forward = new Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
  const right = new Vector3(Math.cos(state.heading), 0, -Math.sin(state.heading));
  const offsets: readonly [number, number][] = [
    [0.84, -0.96],
    [0.84, 0.96],
    [-0.85, -1.02],
    [-0.85, 1.02],
  ];
  return offsets.map(([forwardOffset, sideOffset]) =>
    state.position
      .clone()
      .addScaledVector(forward, forwardOffset)
      .addScaledVector(right, sideOffset)
      .addScaledVector(UP, 0.08),
  );
}

function disposeObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<{ dispose: () => void }>();
  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: BufferGeometry;
      material?: { dispose: () => void } | { dispose: () => void }[];
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
 * Build hot-pink/cyan directional chevrons along the outside edge of each
 * route segment. They are meshes rather than fat lines, so they remain visible
 * on WebGL implementations that ignore LineBasicMaterial linewidth.
 */
export function createChevronMarkers(
  route: TrackRoute = SAMPLE_ROUTE,
  options: ChevronMarkerOptions = {},
): Group {
  const group = new Group();
  group.name = "rift-chevron-markers";
  const spacing = Math.max(3, finiteOr(options.spacing, 13));
  const maxMarkers = Math.max(1, Math.floor(finiteOr(options.maxMarkers, 48)));
  const edgeOffset = clamp(finiteOr(options.offsetFromEdge, 0.5), 0.1, 0.95);
  const height = Math.max(0.035, finiteOr(options.height, 0.095));
  const length = Math.max(0.28, finiteOr(options.length, 0.92));
  const color = options.color ?? 0xff42bd;
  const material = new MeshBasicMaterial({
    name: "rift-chevron-material",
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const barGeometry = new BoxGeometry(0.12, height, length);
  let markerCount = 0;

  for (const segment of route.segments) {
    if (segment.length <= EPSILON || markerCount >= maxMarkers) continue;
    const tangent = new Vector3().subVectors(
      segment.end.position,
      segment.start.position,
    ).normalize();
    const side = makeSideVector(tangent);
    const count = Math.max(1, Math.ceil(segment.length / spacing));
    for (let step = 0; step < count && markerCount < maxMarkers; step += 1) {
      const amount = (step + 0.5) / count;
      const position = segment.start.position.clone().lerp(segment.end.position, amount);
      const width = segment.start.width + (segment.end.width - segment.start.width) * amount;
      const marker = new Group();
      marker.name = "rift-chevron-marker";
      marker.position
        .copy(position)
        .addScaledVector(side, width * edgeOffset)
        .addScaledVector(UP, 0.13);
      marker.quaternion.setFromUnitVectors(FORWARD, tangent);
      marker.userData.riftChevron = true;

      const left = new Mesh(barGeometry, material);
      left.name = "rift-chevron-left";
      left.position.x = -length * 0.22;
      left.rotation.y = -0.62;
      const right = new Mesh(barGeometry, material);
      right.name = "rift-chevron-right";
      right.position.x = length * 0.22;
      right.rotation.y = 0.62;
      marker.add(left, right);
      group.add(marker);
      markerCount += 1;
    }
  }

  group.userData.riftChevronMaterial = material;
  return group;
}

/** A pooled, scene-only feedback layer for drifting, sparks, and turn cues. */
export class RiftEffects extends Group {
  readonly route: TrackRoute;
  readonly skidMarks: Group;
  readonly sparks: Points<BufferGeometry, PointsMaterial>;
  readonly chevrons: Group;

  private readonly skidPool: SkidMark[];
  private readonly sparkPool: Spark[];
  private readonly sparkPositions: Float32Array;
  private readonly sparkColors: Float32Array;
  private readonly sparkPositionAttribute: Float32BufferAttribute;
  private readonly sparkColorAttribute: Float32BufferAttribute;
  private readonly chevronPulses: ChevronPulse[] = [];
  private skidCursor = 0;
  private sparkCursor = 0;
  private skidAccumulator = 0;
  private sparkAccumulator = 0;
  private elapsedSeconds = 0;
  private randomState = 0x7251a9;
  private disposed = false;

  constructor(options: RiftEffectsOptions = {}) {
    super();
    this.name = "rift-racer-effects";
    this.route = options.route ?? SAMPLE_ROUTE;
    const quality = options.quality ?? "balanced";
    const defaultSkidMarks = quality === "eco" ? 24 : quality === "ultra" ? 72 : 44;
    const defaultSparks = quality === "eco" ? 48 : quality === "ultra" ? 180 : 108;
    const skidCount = Math.max(4, Math.floor(finiteOr(options.maxSkidMarks, defaultSkidMarks)));
    const sparkCount = Math.max(8, Math.floor(finiteOr(options.maxSparks, defaultSparks)));

    this.skidMarks = new Group();
    this.skidMarks.name = "rift-skid-marks";
    this.skidPool = makeSkidMarkPool(skidCount);
    this.skidPool.forEach((mark) => this.skidMarks.add(mark.mesh));
    this.add(this.skidMarks);

    const sparkData = createSparkPoints(sparkCount);
    this.sparks = sparkData.points;
    this.sparkPositions = sparkData.positions;
    this.sparkColors = sparkData.colors;
    this.sparkPositionAttribute = this.sparks.geometry.getAttribute("position") as Float32BufferAttribute;
    this.sparkColorAttribute = this.sparks.geometry.getAttribute("color") as Float32BufferAttribute;
    this.sparkPool = Array.from({ length: sparkCount }, () => ({
      position: new Vector3(0, -1000, 0),
      velocity: new Vector3(),
      life: 0,
      maxLife: 1,
      active: false,
    }));
    this.add(this.sparks);

    if (options.chevrons !== false) {
      this.chevrons = createChevronMarkers(this.route, {
        spacing: options.chevronSpacing,
      });
      this.chevrons.traverse((object) => {
        const material = (object as Mesh).material;
        if (material instanceof MeshBasicMaterial) {
          this.chevronPulses.push({ material, phase: this.chevronPulses.length * 0.28 });
        }
      });
    } else {
      this.chevrons = new Group();
      this.chevrons.name = "rift-chevron-markers-disabled";
    }
    this.add(this.chevrons);
  }

  /**
   * Add a skid stamp at a wheel anchor. The pool makes sustained drifts cheap.
   */
  emitSkid(position: Vector3, heading: number, intensity = 1): void {
    const mark = this.skidPool[this.skidCursor % this.skidPool.length];
    this.skidCursor = (this.skidCursor + 1) % this.skidPool.length;
    mark.life = 0.85 + clamp(intensity, 0, 1) * 0.85;
    mark.maxLife = mark.life;
    mark.mesh.visible = true;
    mark.mesh.position.copy(position);
    mark.mesh.position.y += 0.025;
    mark.mesh.rotation.set(-Math.PI * 0.5, heading, 0);
    mark.mesh.scale.set(0.85 + clamp(intensity, 0, 1) * 0.35, 0.8 + clamp(intensity, 0, 1) * 0.6, 1);
    mark.mesh.material.opacity = 0.42 + clamp(intensity, 0, 1) * 0.27;
  }

  /** Emit a short burst of orange/pink particles from a world-space point. */
  emitSparks(origin: Vector3, direction: Vector3 = new Vector3(), amount = 7): void {
    const count = Math.max(0, Math.min(32, Math.floor(amount)));
    const baseDirection = direction.lengthSq() > EPSILON
      ? direction.clone().normalize()
      : new Vector3(0, 0.25, 1);
    for (let index = 0; index < count; index += 1) {
      const spark = this.sparkPool[this.sparkCursor % this.sparkPool.length];
      this.sparkCursor = (this.sparkCursor + 1) % this.sparkPool.length;
      const random = () => this.nextRandom();
      spark.active = true;
      spark.life = 0.2 + random() * 0.36;
      spark.maxLife = spark.life;
      spark.position.copy(origin);
      spark.position.x += (random() - 0.5) * 0.25;
      spark.position.y += (random() - 0.5) * 0.16;
      spark.position.z += (random() - 0.5) * 0.25;
      spark.velocity.copy(baseDirection).multiplyScalar(1.6 + random() * 4.4);
      spark.velocity.x += (random() - 0.5) * 2.8;
      spark.velocity.y += 0.4 + random() * 1.8;
      spark.velocity.z += (random() - 0.5) * 2.8;
      const offset = this.sparkPool.indexOf(spark) * 3;
      this.sparkPositions[offset] = spark.position.x;
      this.sparkPositions[offset + 1] = spark.position.y;
      this.sparkPositions[offset + 2] = spark.position.z;
      const hot = random();
      this.sparkColors[offset] = 1;
      this.sparkColors[offset + 1] = 0.24 + hot * 0.64;
      this.sparkColors[offset + 2] = 0.06 + hot * 0.26;
    }
    this.sparkPositionAttribute.needsUpdate = true;
    this.sparkColorAttribute.needsUpdate = true;
  }

  /** Update pooled feedback and optionally derive new drift feedback from a car. */
  update(
    deltaSeconds = 0,
    carState?: CarState,
    options: RiftEffectsUpdateOptions = {},
  ): void {
    if (this.disposed) return;
    const delta = clamp(finiteOr(deltaSeconds, 0), 0, 0.1);
    this.elapsedSeconds += delta;

    this.updateSkidMarks(delta);
    this.updateSparks(delta);
    this.updateChevrons();

    if (!carState || options.emitDriftEffects === false) return;
    const speed = Math.max(0, finiteOr(carState.speed, carState.velocity.length()));
    const drift = clamp(finiteOr(carState.drift, 0), 0, 1);
    const steering = Math.abs(clamp(finiteOr(carState.steering, 0), -1, 1));
    if (drift <= 0.12 || speed <= 4 || steering <= 0.04) return;

    this.skidAccumulator += delta * (0.7 + speed * 0.07);
    this.sparkAccumulator += delta * (0.35 + drift * speed * 0.06);
    const wheels = options.wheelPositions ? [...options.wheelPositions] : getWheelPositionsFromState(carState);
    const heading = finiteOr(carState.heading, 0);
    if (this.skidAccumulator >= 0.055) {
      this.skidAccumulator = 0;
      const intensity = clamp(drift * 0.7 + steering * 0.3, 0, 1);
      // Rear wheels leave the readable marks; front wheels remain available to
      // callers that want four-wheel burnout feedback.
      if (wheels[2]) this.emitSkid(wheels[2], heading, intensity);
      if (wheels[3]) this.emitSkid(wheels[3], heading, intensity);
    }
    if (this.sparkAccumulator >= 0.14) {
      this.sparkAccumulator = 0;
      const origin = wheels[2] ?? carState.position;
      const direction = carState.velocity.clone().normalize().multiplyScalar(-1);
      this.emitSparks(origin, direction, 2 + Math.floor(drift * 4));
    }
  }

  step(deltaSeconds = 0, carState?: CarState, options: RiftEffectsUpdateOptions = {}): void {
    this.update(deltaSeconds, carState, options);
  }

  clearEffects(): void {
    this.skidPool.forEach((mark) => {
      mark.life = 0;
      mark.mesh.visible = false;
      mark.mesh.material.opacity = 0;
    });
    this.sparkPool.forEach((spark, index) => {
      spark.active = false;
      spark.life = 0;
      spark.position.set(0, -1000, 0);
      const offset = index * 3;
      this.sparkPositions[offset] = 0;
      this.sparkPositions[offset + 1] = -1000;
      this.sparkPositions[offset + 2] = 0;
    });
    this.sparkPositionAttribute.needsUpdate = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeObject(this);
    this.clearEffects();
    super.clear();
  }

  private updateSkidMarks(delta: number): void {
    this.skidPool.forEach((mark) => {
      if (mark.life <= 0) return;
      mark.life -= delta;
      if (mark.life <= 0) {
        mark.life = 0;
        mark.mesh.visible = false;
        mark.mesh.material.opacity = 0;
        return;
      }
      mark.mesh.material.opacity = 0.69 * clamp(mark.life / Math.max(mark.maxLife, EPSILON), 0, 1);
    });
  }

  private updateSparks(delta: number): void {
    this.sparkPool.forEach((spark, index) => {
      if (!spark.active) return;
      spark.life -= delta;
      const offset = index * 3;
      if (spark.life <= 0) {
        spark.active = false;
        spark.position.set(0, -1000, 0);
        this.sparkPositions[offset] = 0;
        this.sparkPositions[offset + 1] = -1000;
        this.sparkPositions[offset + 2] = 0;
        return;
      }
      spark.velocity.y -= delta * 7.8;
      spark.position.addScaledVector(spark.velocity, delta);
      this.sparkPositions[offset] = spark.position.x;
      this.sparkPositions[offset + 1] = spark.position.y;
      this.sparkPositions[offset + 2] = spark.position.z;
    });
    this.sparkPositionAttribute.needsUpdate = true;
  }

  private updateChevrons(): void {
    this.chevronPulses.forEach((pulse) => {
      pulse.material.opacity = 0.62 + 0.28 * (0.5 + 0.5 * Math.sin(this.elapsedSeconds * 4.2 + pulse.phase));
    });
  }

  private nextRandom(): number {
    // Small deterministic generator keeps replays and tests reproducible.
    this.randomState = (this.randomState * 1664525 + 1013904223) >>> 0;
    return this.randomState / 0x100000000;
  }
}

export const createRiftEffects = (options: RiftEffectsOptions = {}): RiftEffects =>
  new RiftEffects(options);

export const createDriftEffects = createRiftEffects;
export const createTrackChevrons = createChevronMarkers;
