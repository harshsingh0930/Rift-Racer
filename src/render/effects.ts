import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  DataTexture,
  LinearFilter,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Color,
  Shape,
  ShapeGeometry,
  Texture,
  DoubleSide,
  Vector3,
  LineBasicMaterial,
  LineSegments,
} from "three";
import type { CarState } from "../game/arcade";
import { SAMPLE_ROUTE, sampleTrackPosition, sampleTrackTangent, sampleTrackSection, sampleTrackWidth, type TrackRoute } from "../game/track";
import type { QualityTier } from "../game/performance";
import { TyreTrails } from "./skids";
import { SpeedEffects } from "./speed-effects";
import { tyreSlip } from "../game/tyres";
import { WaterEntryEffect } from "./water-entry";
import { SparkGlow } from "./spark-glow";

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
  quality?: QualityTier;
  offsetFromEdge?: number;
  height?: number;
  length?: number;
  color?: number;
}

type Spark = {
  position: Vector3;
  velocity: Vector3;
  life: number;
  maxLife: number;
  active: boolean;
};

type ChevronPulse = {
  marker: Group;
  sweep: Mesh;
  phase: number;
  baseScale: number;
  sweepTravel: number;
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
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const glowPixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    const radius = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
    glowPixels.set([255, 255, 255, Math.round(Math.max(0, 1 - radius) ** 1.6 * 255)], (y * 32 + x) * 4);
  }
  const glow = new DataTexture(glowPixels, 32, 32);
  glow.magFilter = glow.minFilter = LinearFilter;glow.needsUpdate = true;
  const material = new PointsMaterial({
    name: "rift-drift-spark-material",
    map: glow,
    size: 0.14,
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

function createSparkStreaks(count: number): LineSegments<BufferGeometry, LineBasicMaterial> {
  const positions = new Float32Array(count * 2 * 3);
  positions.fill(-1000);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(count * 6), 3).setUsage(DynamicDrawUsage));
  const streaks = new LineSegments(geometry, new LineBasicMaterial({
    name: "rift-impact-spark-streak-material",
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    blending: AdditiveBlending,
  }));
  streaks.name = "rift-impact-spark-streaks";
  streaks.frustumCulled = false;
  streaks.renderOrder = 8;
  return streaks;
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
  materials.forEach((material) => {
    for (const value of Object.values(material)) if (value instanceof Texture) value.dispose();
    material.dispose();
  });
}

/** Upright yellow double chevrons on the outside of upcoming bends. */
export function createChevronMarkers(
  route: TrackRoute = SAMPLE_ROUTE,
  options: ChevronMarkerOptions = {},
): Group {
  const group = new Group();group.name = "rift-chevron-markers";
  const spacing = Math.max(6, finiteOr(options.spacing, 13));
  const cap = options.quality === "eco" ? 24 : options.quality === "ultra" ? 64 : 44;
  const maximum = Math.max(1, Math.min(Math.floor(finiteOr(options.maxMarkers, cap)), cap));
  const height = Math.max(0.6, finiteOr(options.height, 1.2));
  const width = Math.max(2, finiteOr(options.length, 3.6));
  const shape = new Shape();
  shape.moveTo(-0.57, -0.72);shape.lineTo(-0.02, -0.72);shape.lineTo(0.66, 0);
  shape.lineTo(-0.02, 0.72);shape.lineTo(-0.57, 0.72);shape.lineTo(0.12, 0);shape.closePath();
  const arrowGeometry = new ShapeGeometry(shape);
  const arrowMaterial = new MeshBasicMaterial({ color: new Color(options.color ?? 0xffdb42).multiplyScalar(2.5), side: DoubleSide });
  const backing = new MeshBasicMaterial({ color: 0x161326 });
  const signGeometry = new BoxGeometry(width, height * 1.5, 0.12);
  const poleGeometry = new BoxGeometry(0.12, 2.3, 0.12);
  const underlineGeometry = new BoxGeometry(width - 0.15, 0.035, 0.035);
  const candidates: Array<{ distance: number; side: number }> = [];
  let previous = -Infinity;
  for (let distance = spacing; distance < route.totalLength; distance += spacing) {
    if (sampleTrackSection(route, distance) === "cliff-dive") continue;
    const tangent = sampleTrackTangent(route, distance);
    const ahead = sampleTrackTangent(route, distance + 28);
    const turn = tangent.clone().cross(ahead).y;
    if (Math.abs(turn) < 0.15 || distance - previous < 15) continue;
    candidates.push({ distance, side: turn > 0 ? -1 : 1 });previous = distance;
  }
  const stride = Math.max(1, candidates.length / maximum);
  for (let selected = 0; selected < Math.min(maximum, candidates.length); selected++) {
    const candidate = candidates[Math.floor(selected * stride)];
    const { distance, side: turnSide } = candidate;
    const tangent = sampleTrackTangent(route, distance);
    const marker = new Group();marker.name = "rift-chevron-marker";
    marker.position.copy(sampleTrackPosition(route, distance)).addScaledVector(makeSideVector(tangent),
      turnSide * (sampleTrackWidth(route, distance) / 2 + width / 2 + 0.85));
    // Heading only keeps roadside signs vertical even on the steep dive.
    marker.rotation.y = Math.atan2(tangent.x, tangent.z);
    marker.userData.riftChevron = true;marker.userData.routeDistance = distance;marker.userData.turnSide = turnSide;
    marker.userData.riftChevronBaseScale = 1;marker.userData.riftChevronSweepTravel = 0;
    const sign = new Mesh(signGeometry, backing);sign.name = "rift-bend-sign-backplate";
    sign.position.y = 1.95;marker.add(sign);
    for (const x of [-width * 0.35, width * 0.35]) {
      const post = new Mesh(poleGeometry, backing);post.position.set(x, 1.15, 0.025);marker.add(post);
    }
    for (const offset of [-0.85, 0.85]) {
      const arrow = new Mesh(arrowGeometry, arrowMaterial);arrow.name = "rift-bend-direction-arrow";
      arrow.position.set(offset, 1.95, -0.075);arrow.scale.set(-turnSide * height / 1.2, height / 1.2, 1);marker.add(arrow);
    }
    const sweep = new Mesh(underlineGeometry, new MeshBasicMaterial({
      color: 0xffa74b, transparent: true, opacity: 0.8,
    }));
    sweep.name = "rift-chevron-sweep";sweep.position.set(0, 1.95 - height * 0.72, -0.085);marker.add(sweep);
    group.add(marker);
  }
  return group;
}

/** A pooled, scene-only feedback layer for drifting, sparks, and turn cues. */
export class RiftEffects extends Group {
  readonly route: TrackRoute;
  readonly skidMarks: Group;
  readonly sparks: Points<BufferGeometry, PointsMaterial>;
  readonly sparkStreaks: LineSegments<BufferGeometry, LineBasicMaterial>;
  readonly chevrons: Group;

  private readonly waterEntry = new WaterEntryEffect();
  private readonly tyreTrails: TyreTrails;
  private readonly speedEffects: SpeedEffects;
  private readonly sparkPool: Spark[];
  private readonly sparkPositions: Float32Array;
  private readonly sparkColors: Float32Array;
  private readonly sparkPositionAttribute: Float32BufferAttribute;
  private readonly sparkColorAttribute: Float32BufferAttribute;
  private readonly sparkStreakPositionAttribute: BufferAttribute;
  private readonly sparkGlow: SparkGlow;
  private readonly chevronPulses: ChevronPulse[] = [];
  private sparkCursor = 0;
  private sparkAccumulator = 0;
  private emissionScale = 1;
  private elapsedSeconds = 0;
  private randomState = 0x7251a9;
  private disposed = false;

  constructor(options: RiftEffectsOptions = {}) {
    super();
    this.name = "rift-racer-effects";this.add(this.waterEntry);
    this.route = options.route ?? SAMPLE_ROUTE;
    const quality = options.quality ?? "balanced";
    const defaultSkidMarks = quality === "eco" ? 512 : quality === "ultra" ? 4096 : 2048;
    const defaultSparks = quality === "eco" ? 512 : quality === "ultra" ? 2048 : 1280;
    const skidCount = Math.max(4, Math.floor(finiteOr(options.maxSkidMarks, defaultSkidMarks)));
    const sparkCount = Math.max(8, Math.floor(finiteOr(options.maxSparks, defaultSparks)));

    this.skidMarks = new Group();
    this.skidMarks.name = "rift-skid-marks";
    this.tyreTrails = new TyreTrails(this.route, skidCount);
    this.speedEffects = new SpeedEffects(quality);this.add(this.speedEffects);
    this.skidMarks.add(this.tyreTrails.mesh);
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
    this.sparkStreaks = createSparkStreaks(sparkCount);
    this.sparkGlow = new SparkGlow(sparkCount);
    this.sparkStreakPositionAttribute = this.sparkStreaks.geometry.getAttribute("position") as BufferAttribute;
    this.sparks.visible = false; // The visible effect is a shower of streaks, with no round sprite heads.
    this.add(this.sparkStreaks, this.sparkGlow, this.sparks);

    if (options.chevrons !== false) {
      this.chevrons = createChevronMarkers(this.route, {
        spacing: options.chevronSpacing,
        quality,
      });
      this.chevrons.traverse((object) => {
        if (!(object instanceof Group) || object.userData.riftChevron !== true) return;
        const sweep = object.getObjectByName("rift-chevron-sweep");
        if (!(sweep instanceof Mesh)) return;
        this.chevronPulses.push({
          marker: object,
          sweep,
          phase: this.chevronPulses.length * 0.28,
          baseScale: finiteOr(object.userData.riftChevronBaseScale, 1),
          sweepTravel: finiteOr(object.userData.riftChevronSweepTravel, 1),
        });
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
    const forward = new Vector3(Math.sin(heading), 0, Math.cos(heading));
    this.tyreTrails.add(position.clone().addScaledVector(forward, -0.5), position.clone().addScaledVector(forward, 0.5), intensity);
  }

  /** Emit dense metal streaks trailing along the rail from the contact point. */
  emitSparks(origin: Vector3, direction: Vector3 = new Vector3(), amount = 7): void {
    const count = Math.max(0, Math.min(192, Math.round(amount * this.emissionScale)));
    const baseDirection = direction.lengthSq() > EPSILON
      ? direction.clone().normalize()
      : new Vector3(0, 0.25, 1);
    baseDirection.y = 0;
    if (baseDirection.lengthSq() < EPSILON) baseDirection.set(0, 0, 1);
    baseDirection.normalize();
    const fanSide = new Vector3(-baseDirection.z, 0, baseDirection.x);
    for (let index = 0; index < count; index += 1) {
      const poolIndex = this.sparkCursor;
      const spark = this.sparkPool[poolIndex];
      this.sparkCursor = (this.sparkCursor + 1) % this.sparkPool.length;
      const random = () => this.nextRandom();
      spark.active = true;
      spark.life = 0.18 + random() * 0.20;
      spark.maxLife = spark.life;
      spark.position.copy(origin);
      spark.position.x += (random() - 0.5) * 0.05;
      spark.position.y += (random() - 0.5) * 0.04;
      spark.position.z += (random() - 0.5) * 0.05;
      const angle = (random() - 0.5) * 0.28;
      const launchSpeed = 7 + random() * 18;
      spark.velocity.copy(baseDirection).multiplyScalar(Math.cos(angle) * launchSpeed)
        .addScaledVector(fanSide, Math.sin(angle) * launchSpeed);
      spark.velocity.y = 0.15 + random() ** 1.5 * 2.6;
      const offset = poolIndex * 3;
      this.sparkPositions[offset] = spark.position.x;
      this.sparkPositions[offset + 1] = spark.position.y;
      this.sparkPositions[offset + 2] = spark.position.z;
      const hot = random();
      this.sparkColors[offset] = 3.2;
      this.sparkColors[offset + 1] = 0.8 + hot * 1.6;
      this.sparkColors[offset + 2] = 0.18 + hot * 0.5;
      this.sparkStreakPositionAttribute.setXYZ(poolIndex * 2, spark.position.x, spark.position.y, spark.position.z);
      this.sparkStreakPositionAttribute.setXYZ(
        poolIndex * 2 + 1,
        spark.position.x - spark.velocity.x * 0.001,
        spark.position.y - spark.velocity.y * 0.001,
        spark.position.z - spark.velocity.z * 0.001,
      );
    }
    this.sparkPositionAttribute.needsUpdate = true;
    this.sparkColorAttribute.needsUpdate = true;
    this.sparkStreakPositionAttribute.needsUpdate = true;
    this.updateSparkColors();
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

    this.waterEntry.update(delta, carState?.position);
    this.tyreTrails.update(delta);
    this.updateSparks(delta);
    this.updateSparkColors();
    this.updateChevrons();
    const slip = carState ? tyreSlip(carState) : 0;
    const visuals = carState ? { ...carState, drift: options.emitDriftEffects === false ? 0 : slip } : undefined;
    this.speedEffects.update(delta, visuals, options.wheelPositions);
    if (!carState || options.emitDriftEffects === false) { this.tyreTrails.stop();return; }
    const wheels = options.wheelPositions ? [...options.wheelPositions] : getWheelPositionsFromState(carState);
    if (carState.speed < 6 || slip < 0.05) { this.tyreTrails.prime(wheels);return; }
    this.tyreTrails.draw(wheels, Math.min(1, 0.28 + slip * 0.65));
  }

  step(deltaSeconds = 0, carState?: CarState, options: RiftEffectsUpdateOptions = {}): void {
    this.update(deltaSeconds, carState, options);
  }

  emitSplash(position: Vector3): void { this.waterEntry.emit(position); }

  clearEffects(): void {
    this.waterEntry.reset();
    this.sparkAccumulator = 0;
    this.speedEffects.clearEffects();
    this.tyreTrails.clear();
    this.sparkPool.forEach((spark, index) => {
      spark.active = false;
      spark.life = 0;
      spark.position.set(0, -1000, 0);
      const offset = index * 3;
      this.sparkPositions[offset] = 0;
      this.sparkPositions[offset + 1] = -1000;
      this.sparkPositions[offset + 2] = 0;
      this.sparkStreakPositionAttribute.setXYZ(index * 2, 0, -1000, 0);
      this.sparkStreakPositionAttribute.setXYZ(index * 2 + 1, 0, -1000, 0);
    });
    this.sparkPositionAttribute.needsUpdate = true;
    this.sparkStreakPositionAttribute.needsUpdate = true;
    this.updateSparkColors();
  }

  private updateSparkColors(): void {
    const colors = this.sparkStreaks.geometry.getAttribute("color");
    this.sparkPool.forEach((spark, index) => {
      const fade = spark.active ? Math.sqrt(Math.max(0, spark.life / spark.maxLife)) : 0;
      colors.setXYZ(index * 2, 3 * fade, 1.5 * fade, 0.4 * fade);
      colors.setXYZ(index * 2 + 1, 1.2 * fade, 0.22 * fade, 0.015 * fade);
    });
    colors.needsUpdate = true;
    this.sparkGlow.sync(this.sparkStreakPositionAttribute, colors as BufferAttribute);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearEffects();
    disposeObject(this);
    super.clear();
  }

  setEmissionScale(scale: number): void {
    this.emissionScale = clamp(finiteOr(scale, 1), 0.2, 1.5);
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
        this.sparkStreakPositionAttribute.setXYZ(index * 2, 0, -1000, 0);
        this.sparkStreakPositionAttribute.setXYZ(index * 2 + 1, 0, -1000, 0);
        return;
      }
      spark.velocity.y -= delta * 16;
      spark.position.addScaledVector(spark.velocity, delta);
      const trailSeconds = Math.min(0.045, spark.maxLife - spark.life);
      this.sparkPositions[offset] = spark.position.x;
      this.sparkPositions[offset + 1] = spark.position.y;
      this.sparkPositions[offset + 2] = spark.position.z;
      this.sparkStreakPositionAttribute.setXYZ(index * 2, spark.position.x, spark.position.y, spark.position.z);
      this.sparkStreakPositionAttribute.setXYZ(
        index * 2 + 1,
        spark.position.x - spark.velocity.x * trailSeconds,
        spark.position.y - spark.velocity.y * trailSeconds,
        spark.position.z - spark.velocity.z * trailSeconds,
      );
    });
    this.sparkPositionAttribute.needsUpdate = true;
    this.sparkStreakPositionAttribute.needsUpdate = true;
  }

  private updateChevrons(): void {
    // Keep this animation pass allocation-free: the marker count is capped at
    // construction time, and every frame only mutates already-owned transforms.
    for (let index = 0; index < this.chevronPulses.length; index += 1) {
      const pulse = this.chevronPulses[index];
      const brightness = 0.5 + 0.5 * Math.sin(this.elapsedSeconds * 4.2 + pulse.phase);
      // Pulse the fine underline, keeping signs and posts firmly grounded.
      (pulse.sweep.material as MeshBasicMaterial).opacity = 0.55 + brightness * 0.4;
      const sweepCycle = ((this.elapsedSeconds * 0.9 + pulse.phase / (Math.PI * 2)) % 1 + 1) % 1;
      pulse.sweep.position.z = (sweepCycle * 2 - 1) * pulse.sweepTravel;
      pulse.sweep.scale.x = 0.88 + brightness * 0.12;
    }
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
