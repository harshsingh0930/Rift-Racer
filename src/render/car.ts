import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Vector3,
} from "three";
import type { CarState } from "../game/arcade";
import type { QualityTier } from "../game/performance";

const EPSILON = 1e-6;

/** Quality preset understood by the car renderer. */
export type RiftCarQuality = QualityTier;

export interface RiftCarOptions {
  /** Draw the emissive headlight meshes and enable their input state. */
  headlights?: boolean;
  /** Quality hint used to select the default car lighting budget. */
  quality?: RiftCarQuality;
  /**
   * Allocate dynamic headlight and underbody lights plus visible beam volumes.
    * When omitted, only `ultra` quality enables this more expensive path.
   */
  realtimeLighting?: boolean;
  /** A global scale for the car visual, useful for different camera rigs. */
  scale?: number;
  /** Start position and heading when a game state is not available yet. */
  position?: Readonly<{ x: number; y: number; z: number }>;
  heading?: number;
}

export interface RiftCarVisualState {
  position: Readonly<{ x: number; y: number; z: number }>;
  heading?: number;
  steering?: number;
  drift?: number;
  speed?: number;
  velocity?: Readonly<{ x: number; y: number; z: number }>;
  /** Grade of the road in the car's direction of travel, in radians. */
  roadPitch?: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function makeWedgeGeometry(): BufferGeometry {
  // Forward is +Z so the visual follows the heading convention in game/arcade.
  const vertices = new Float32Array([
    // lower front left/right, lower rear right/left
    -0.78, 0.12, 1.52,
    0.78, 0.12, 1.52,
    1.08, 0.12, -1.36,
    -1.08, 0.12, -1.36,
    // upper front left/right, roof right/left, upper rear right/left
    -0.43, 0.56, 1.08,
    0.43, 0.56, 1.08,
    0.64, 0.92, -0.55,
    -0.64, 0.92, -0.55,
    0.9, 0.64, -1.36,
    -0.9, 0.64, -1.36,
  ]);
  const indices = [
    // floor
    0, 3, 2, 0, 2, 1,
    // nose
    0, 1, 5, 0, 5, 4,
    // right flank and shoulder
    1, 2, 8, 1, 8, 6, 1, 6, 5,
    // left flank and shoulder
    0, 4, 7, 0, 7, 9, 0, 9, 3,
    // roof and rear shoulder
    4, 5, 6, 4, 6, 7,
    7, 6, 8, 7, 8, 9,
    // tail
    3, 9, 8, 3, 8, 2,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeWindshield(): Mesh<BoxGeometry, MeshStandardMaterial> {
  const windshield = new Mesh(
    new BoxGeometry(1.12, 0.045, 0.56),
    new MeshStandardMaterial({
      color: 0x050820,
      emissive: 0x16154d,
      emissiveIntensity: 0.7,
      metalness: 0.7,
      roughness: 0.16,
      transparent: true,
      opacity: 0.9,
    }),
  );
  windshield.name = "rift-car-windshield";
  windshield.position.set(0, 0.73, 0.17);
  windshield.rotation.x = -0.46;
  return windshield;
}

function makeWheel(material: MeshStandardMaterial): Mesh<CylinderGeometry, MeshStandardMaterial> {
  const wheel = new Mesh(new CylinderGeometry(0.39, 0.39, 0.26, 8), material);
  wheel.rotation.z = Math.PI * 0.5;
  wheel.castShadow = true;
  wheel.name = "rift-car-wheel";
  return wheel;
}

function makeHeadlightMesh(material: MeshBasicMaterial, x: number): Mesh<BoxGeometry, MeshBasicMaterial> {
  const light = new Mesh(new BoxGeometry(0.34, 0.15, 0.09), material);
  light.position.set(x, 0.48, 1.5);
  light.name = x < 0 ? "rift-car-headlight-left" : "rift-car-headlight-right";
  return light;
}

function makeTaillightMesh(material: MeshBasicMaterial, x: number): Mesh<BoxGeometry, MeshBasicMaterial> {
  const light = new Mesh(new BoxGeometry(0.36, 0.15, 0.1), material);
  light.position.set(x, 0.47, -1.43);
  light.name = x < 0 ? "rift-car-taillight-left" : "rift-car-taillight-right";
  return light;
}

function makeHeadlightBeam(material: MeshBasicMaterial, x: number): Mesh<ConeGeometry, MeshBasicMaterial> {
  // ConeGeometry points along +Y. Rotating it puts the tip down the road (+Z)
  // while the open sides keep the volume cheap and readable from the chase cam.
  const beam = new Mesh(new ConeGeometry(0.65, 4.8, 8, 1, true), material);
  beam.position.set(x, 0.45, 3.9);
  beam.rotation.x = -Math.PI * 0.5;
  beam.name = x < 0 ? "rift-car-headlight-beam-left" : "rift-car-headlight-beam-right";
  beam.renderOrder = 3;
  return beam;
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
 * Low-poly wedge car with emissive lights and a small amount of speed banking.
 * The class owns only render objects; simulation remains in game/arcade.ts.
 */
export class RiftCar extends Group {
  readonly body: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly wheelMeshes: readonly Mesh<CylinderGeometry, MeshStandardMaterial>[];
  readonly headlights: readonly Mesh<BoxGeometry, MeshBasicMaterial>[];
  readonly taillights: readonly Mesh<BoxGeometry, MeshBasicMaterial>[];
  readonly quality: RiftCarQuality;
  readonly realtimeLighting: boolean;
  headlightsEnabled = false;

  private readonly headlightBeams: readonly PointLight[];
  private readonly headlightBeamMeshes: readonly Mesh<ConeGeometry, MeshBasicMaterial>[];
  private readonly wheelDetails: readonly Object3D[];
  private readonly underbodyTrims: readonly Mesh<BoxGeometry, MeshBasicMaterial>[];
  private readonly underbodyLight?: PointLight;
  private readonly visualGroup: Group;
  private readonly initialScale: number;
  private readonly wheelRadius = 0.39;
  private disposed = false;
  private heading = 0;

  constructor(options: RiftCarOptions = {}) {
    super();
    this.name = "rift-racer-player-car";
    this.quality = options.quality ?? "balanced";
    this.realtimeLighting = options.realtimeLighting ?? this.quality === "ultra";
    this.initialScale = Math.max(0.1, finiteOr(options.scale, 1));
    this.scale.setScalar(this.initialScale);

    const bodyMaterial = new MeshStandardMaterial({
      name: "rift-car-violet-body",
      color: 0x754bc5,
      emissive: 0x2b145d,
      emissiveIntensity: 0.46,
      metalness: 0.62,
      roughness: 0.3,
      flatShading: true,
    });
    this.body = new Mesh(makeWedgeGeometry(), bodyMaterial);
    this.body.name = "rift-car-low-poly-wedge";
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.add(this.body);
    this.add(makeWindshield());

    const hoodTrim = new Mesh(
      new BoxGeometry(0.12, 0.06, 1.17),
      new MeshBasicMaterial({ color: 0x5eeaff, transparent: true, opacity: 0.76, blending: AdditiveBlending }),
    );
    hoodTrim.name = "rift-car-cyan-hood-trim";
    hoodTrim.position.set(0, 0.6, 0.63);
    this.add(hoodTrim);

    const aeroMaterial = new MeshStandardMaterial({
      name: "rift-car-aero-dark",
      color: 0x140d28,
      metalness: 0.72,
      roughness: 0.3,
      flatShading: true,
    });
    const accentMaterial = new MeshBasicMaterial({
      name: "rift-car-cyan-trim",
      color: 0x5eeaff,
      transparent: true,
      opacity: 0.82,
      blending: AdditiveBlending,
    });

    const frontSplitter = new Mesh(new BoxGeometry(1.78, 0.07, 0.24), aeroMaterial);
    frontSplitter.name = "rift-car-front-splitter";
    frontSplitter.position.set(0, 0.18, 1.42);
    this.add(frontSplitter);

    const splitterGlow = new Mesh(new BoxGeometry(1.34, 0.035, 0.045), accentMaterial);
    splitterGlow.name = "rift-car-front-splitter-glow";
    splitterGlow.position.set(0, 0.22, 1.54);
    this.add(splitterGlow);

    const underbodyTrims: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
    [-1, 1].forEach((side) => {
      const sill = new Mesh(new BoxGeometry(0.075, 0.055, 1.86), accentMaterial);
      sill.name = side < 0 ? "rift-car-underbody-glow-left" : "rift-car-underbody-glow-right";
      sill.position.set(side * 1.05, 0.24, -0.04);
      this.add(sill);
      underbodyTrims.push(sill);

      const shoulder = new Mesh(new BoxGeometry(0.055, 0.045, 1.62), accentMaterial);
      shoulder.name = side < 0 ? "rift-car-side-trim-left" : "rift-car-side-trim-right";
      shoulder.position.set(side * 1.045, 0.54, -0.08);
      this.add(shoulder);
    });
    this.underbodyTrims = underbodyTrims;

    const spoilerMaterial = new MeshBasicMaterial({
      name: "rift-car-spoiler-emission",
      color: 0x342a76,
      transparent: true,
      opacity: 0.9,
    });
    const spoiler = new Mesh(new BoxGeometry(1.72, 0.1, 0.16), spoilerMaterial);
    spoiler.name = "rift-car-rear-spoiler";
    spoiler.position.set(0, 0.86, -1.16);
    this.add(spoiler);
    [-0.62, 0.62].forEach((x) => {
      const support = new Mesh(new BoxGeometry(0.08, 0.38, 0.08), spoilerMaterial);
      support.name = "rift-car-spoiler-support";
      support.position.set(x, 0.69, -1.15);
      this.add(support);
    });

    const spoilerEdge = new Mesh(new BoxGeometry(1.48, 0.035, 0.045), accentMaterial);
    spoilerEdge.name = "rift-car-spoiler-cyan-edge";
    spoilerEdge.position.set(0, 0.92, -1.25);
    this.add(spoilerEdge);
    [-0.86, 0.86].forEach((x) => {
      const endplate = new Mesh(new BoxGeometry(0.07, 0.25, 0.2), aeroMaterial);
      endplate.name = "rift-car-spoiler-endplate";
      endplate.position.set(x, 0.84, -1.16);
      this.add(endplate);
    });

    const rearDiffuser = new Mesh(new BoxGeometry(1.82, 0.09, 0.2), aeroMaterial);
    rearDiffuser.name = "rift-car-rear-diffuser";
    rearDiffuser.position.set(0, 0.2, -1.28);
    this.add(rearDiffuser);

    const wheelMaterial = new MeshStandardMaterial({
      name: "rift-car-tire",
      color: 0x080b18,
      roughness: 0.93,
      metalness: 0.18,
      flatShading: true,
    });
    const hubMaterial = new MeshBasicMaterial({
      name: "rift-car-cyan-hub",
      color: 0x68edff,
      transparent: true,
      opacity: 0.94,
      blending: AdditiveBlending,
    });
    const rimMaterial = new MeshStandardMaterial({
      name: "rift-car-eight-spoke-rim",
      color: 0x3b456d,
      emissive: 0x15336b,
      emissiveIntensity: 0.68,
      metalness: 0.82,
      roughness: 0.24,
      flatShading: true,
    });
    const rimGeometry = new CylinderGeometry(0.3, 0.3, 0.275, 8);
    const hubGeometry = new CylinderGeometry(0.15, 0.15, 0.285, 8);
    const wheelPositions: readonly [number, number][] = [
      [-0.96, 0.84],
      [0.96, 0.84],
      [-1.02, -0.85],
      [1.02, -0.85],
    ];
    const wheels: Mesh<CylinderGeometry, MeshStandardMaterial>[] = [];
    const wheelDetails: Object3D[] = [];
    wheelPositions.forEach(([x, z]) => {
      const wheel = makeWheel(wheelMaterial);
      wheel.position.set(x, 0.38, z);
      this.add(wheel);
      wheels.push(wheel);

      const rim = new Mesh(rimGeometry, rimMaterial);
      rim.rotation.z = Math.PI * 0.5;
      rim.position.set(x, 0.38, z);
      rim.name = "rift-car-wheel-rim";
      this.add(rim);

      const hub = new Mesh(hubGeometry, hubMaterial);
      hub.rotation.z = Math.PI * 0.5;
      hub.position.set(x, 0.38, z);
      hub.name = "rift-car-wheel-hub";
      this.add(hub);
      wheelDetails.push(rim, hub);
    });
    this.wheelMeshes = wheels;
    this.wheelDetails = wheelDetails;

    const headlightMaterial = new MeshBasicMaterial({
      name: "rift-car-headlight-emission",
      color: 0xe7ffff,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
    });
    const headlights = [
      makeHeadlightMesh(headlightMaterial, -0.43),
      makeHeadlightMesh(headlightMaterial, 0.43),
    ];
    headlights.forEach((headlight) => this.add(headlight));
    this.headlights = headlights;

    const beamMeshes: Mesh<ConeGeometry, MeshBasicMaterial>[] = [];
    if (this.realtimeLighting) {
      const beamMaterial = new MeshBasicMaterial({
        name: "rift-car-headlight-beam-volume",
        color: 0x9eefff,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      });
      [-0.43, 0.43].forEach((x) => {
        const beam = makeHeadlightBeam(beamMaterial, x);
        this.add(beam);
        beamMeshes.push(beam);
      });
    }
    this.headlightBeamMeshes = beamMeshes;

    const tailMaterial = new MeshBasicMaterial({
      name: "rift-car-taillight-emission",
      color: 0xff3855,
      transparent: true,
      opacity: 0.98,
      blending: AdditiveBlending,
    });
    const rearPanel = new Mesh(new BoxGeometry(1.72, 0.3, 0.05), aeroMaterial);
    rearPanel.name = "rift-car-rear-light-panel";
    rearPanel.position.set(0, 0.48, -1.4);
    this.add(rearPanel);
    const taillights = [
      makeTaillightMesh(tailMaterial, -0.55),
      makeTaillightMesh(tailMaterial, 0.55),
    ];
    taillights.forEach((taillight) => this.add(taillight));
    this.taillights = taillights;

    const rearGlow = new Mesh(
      new BoxGeometry(1.22, 0.1, 0.07),
      new MeshBasicMaterial({ color: 0xff3b62, transparent: true, opacity: 0.6, blending: AdditiveBlending }),
    );
    rearGlow.name = "rift-car-rear-neon-bar";
    rearGlow.position.set(0, 0.51, -1.43);
    this.add(rearGlow);

    const beams: PointLight[] = [];
    if (this.realtimeLighting) {
      [-0.43, 0.43].forEach((x) => {
        const beam = new PointLight(0x8eeaff, 1.3, 10, 2);
        beam.position.set(x, 0.53, 1.5);
        beam.name = "rift-car-headlight-beam";
        this.add(beam);
        beams.push(beam);
      });
    }
    this.headlightBeams = beams;

    if (this.realtimeLighting) {
      const underbodyLight = new PointLight(0xff2fd6, 0.8, 5.5, 2);
      underbodyLight.position.set(0, 0.26, -0.08);
      underbodyLight.name = "rift-car-underbody-light";
      this.add(underbodyLight);
      this.underbodyLight = underbodyLight;
    }

    const contactShadowMaterial = new MeshBasicMaterial({
      name: "rift-car-contact-shadow-material",
      color: 0x02030b,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    const contactShadow = new Mesh(new CircleGeometry(1, 24), contactShadowMaterial);
    contactShadow.name = "rift-car-contact-shadow";
    contactShadow.rotation.x = -Math.PI * 0.5;
    contactShadow.position.set(0, 0.01, 0.04);
    contactShadow.scale.set(1.22, 1.72, 1);
    contactShadow.renderOrder = 0;
    this.add(contactShadow);

    const underglowMaterial = new MeshBasicMaterial({
      name: "rift-car-contact-ambient-material",
      color: 0x4e2e83,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const underglow = new Mesh(new CircleGeometry(1, 24), underglowMaterial);
    underglow.name = "rift-car-contact-ambient-glow";
    underglow.rotation.x = -Math.PI * 0.5;
    underglow.position.set(0, 0.018, 0.04);
    underglow.scale.set(1.08, 1.56, 1);
    underglow.renderOrder = 0;
    this.add(underglow);

    // Keep the public car transform aligned with game state while giving the
    // render-only silhouette a little more scale and lowering its wheels onto
    // the road supplied by the existing host lift.
    const visualGroup = new Group();
    visualGroup.name = "rift-car-grounded-visuals";
    visualGroup.position.y = (this.wheelRadius - 0.38) * 1.12;
    visualGroup.scale.setScalar(1.12);
    const existingChildren = [...this.children];
    visualGroup.add(...existingChildren);
    this.add(visualGroup);
    // Ground effects follow the road transform without the visual suspension.
    this.add(contactShadow, underglow);
    this.visualGroup = visualGroup;
    this.setHeadlights(options.headlights !== false);

    this.position.set(
      finiteOr(options.position?.x, 0),
      finiteOr(options.position?.y, 0),
      finiteOr(options.position?.z, 0),
    );
    this.heading = finiteOr(options.heading, 0);
    this.rotation.set(0, this.heading, 0, "YXZ");
  }

  /** Update visual transform and subtle motion from an arcade CarState. */
  update(state: CarState | RiftCarVisualState, deltaSeconds = 0): void {
    if (this.disposed) return;
    this.position.set(state.position.x, state.position.y, state.position.z);
    this.heading = finiteOr(state.heading, this.heading);
    const roadPitch = "roadPitch" in state ? finiteOr(state.roadPitch, 0) : 0;
    this.rotation.set(-roadPitch, this.heading, 0, "YXZ");

    const steering = clamp(finiteOr(state.steering, 0), -1, 1);
    const drift = clamp(finiteOr(state.drift, 0), 0, 1);
    const velocity = state.velocity;
    const speed = Math.max(
      0,
      finiteOr(
        state.speed,
        velocity ? Math.hypot(velocity.x, velocity.y, velocity.z) : 0,
      ),
    );
    // Readable, restrained lean: the player can still see the road under the car.
    this.visualGroup.rotation.z = clamp(-steering * 0.035 - steering * drift * 0.045, -0.08, 0.08);
    this.visualGroup.rotation.x = clamp(-speed * 0.0005, -0.025, 0.02);

    const wheelSpin = (speed * Math.max(0, deltaSeconds)) / Math.max(this.wheelRadius, EPSILON);
    this.wheelMeshes.forEach((wheel) => {
      wheel.rotation.x -= wheelSpin;
    });
    this.wheelDetails.forEach((detail) => {
      detail.rotation.x -= wheelSpin;
    });

    const speedGlow = clamp(speed / 34, 0, 1);
    const driftGlow = clamp(drift, 0, 1);
    const trimOpacity = 0.56 + speedGlow * 0.22 + driftGlow * 0.2;
    this.underbodyTrims.forEach((trim) => {
      trim.material.opacity = trimOpacity;
    });
    this.headlightBeams.forEach((beam) => {
      beam.visible = this.headlightsEnabled;
      beam.intensity = this.headlightsEnabled
        ? 8 + speed * 0.2 + driftGlow * 2
        : 0;
    });
    this.headlightBeamMeshes.forEach((beam) => {
      beam.visible = this.headlightsEnabled;
      beam.material.opacity = this.headlightsEnabled
        ? 0.08 + speedGlow * 0.06 + driftGlow * 0.08
        : 0;
      beam.scale.set(1 + driftGlow * 0.08, 1 + speedGlow * 0.12, 1 + speedGlow * 0.18);
    });
    if (this.underbodyLight) {
      // Keep the light quiet at rest, then let acceleration and drift lift the
      // neon spill. Headlights add a small cyan/pink readability boost.
      this.underbodyLight.intensity = 0.35 + speedGlow * 0.72 + driftGlow * 1.25
        + (this.headlightsEnabled ? 0.16 : 0);
      this.underbodyLight.distance = 4.8 + speedGlow * 1.8 + driftGlow * 1.4;
    }
    this.taillights.forEach((taillight) => {
      const material = taillight.material;
      material.opacity = 0.84 + drift * 0.14;
    });
  }

  /** Alias for call sites that use render terminology. */
  setState(state: CarState | RiftCarVisualState, deltaSeconds = 0): void {
    this.update(state, deltaSeconds);
  }

  setHeadlights(enabled: boolean): this {
    this.headlightsEnabled = Boolean(enabled);
    this.headlights.forEach((headlight) => {
      headlight.visible = this.headlightsEnabled;
    });
    this.headlightBeams.forEach((beam) => {
      beam.visible = this.headlightsEnabled;
      beam.intensity = this.headlightsEnabled ? Math.max(beam.intensity, 1.05) : 0;
    });
    this.headlightBeamMeshes.forEach((beam) => {
      beam.visible = this.headlightsEnabled;
      beam.material.opacity = this.headlightsEnabled ? Math.max(beam.material.opacity, 0.08) : 0;
    });
    return this;
  }

  toggleHeadlights(): boolean {
    this.setHeadlights(!this.headlightsEnabled);
    return this.headlightsEnabled;
  }

  /** Return the four wheel anchors in world space for skid effects. */
  getWheelWorldPositions(target: Vector3[] = []): Vector3[] {
    const offsets: readonly [number, number, number][] = [
      [-0.96, 0.38 - this.wheelRadius, 0.84],
      [0.96, 0.38 - this.wheelRadius, 0.84],
      [-1.02, 0.38 - this.wheelRadius, -0.85],
      [1.02, 0.38 - this.wheelRadius, -0.85],
    ];
    const result = target;
    result.length = 0;
    offsets.forEach(([x, y, z]) => {
      const point = new Vector3(x, y, z);
      this.visualGroup.localToWorld(point);
      result.push(point);
    });
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeObject(this);
    this.clear();
  }
}

export function createRiftCar(options: RiftCarOptions = {}): RiftCar {
  return new RiftCar(options);
}

export const createCarVisual = createRiftCar;
export { RiftCar as LowPolyRiftCar };
