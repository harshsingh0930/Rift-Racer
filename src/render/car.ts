import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  ShaderMaterial,
  SpotLight,
  Vector3,
} from "three";
import type { CarState } from "../game/arcade";
import type { QualityTier } from "../game/performance";
import { createCoupeModel } from "./coupe";

const EPSILON = 1e-6;

/** Quality preset understood by the car renderer. */
export type RiftCarQuality = QualityTier;

export interface RiftCarOptions {
  /** Draw the emissive headlight meshes and enable their input state. */
  headlights?: boolean;
  /** Quality hint used to select the default car lighting budget. */
  quality?: RiftCarQuality;
  /**
   * Allocate dynamic headlight and underbody lights.
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
  airborne?: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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
    if (material instanceof MeshStandardMaterial) material.map?.dispose();
    material.dispose();
  });
}

/**
 * Detailed sports coupe with working lights and visual suspension.
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

  private readonly headlightBeams: readonly SpotLight[];
  private readonly underbodyTrims: readonly Mesh<BoxGeometry, MeshBasicMaterial>[];
  private readonly underbodyLight?: PointLight;
  private readonly visualGroup: Group;
  private readonly initialScale: number;
  private readonly wheelRadius = 0.405;
  private disposed = false;
  private heading = 0;

  constructor(options: RiftCarOptions = {}) {
    super();
    this.name = "rift-racer-player-car";
    this.quality = options.quality ?? "balanced";
    this.realtimeLighting = options.realtimeLighting ?? this.quality === "ultra";
    this.initialScale = Math.max(0.1, finiteOr(options.scale, 1));
    this.scale.setScalar(this.initialScale);
    const model = createCoupeModel(this.quality);
    this.body = model.body;
    this.wheelMeshes = model.wheelMeshes;
    this.headlights = model.headlights;
    this.taillights = model.taillights;
    this.underbodyTrims = model.underbodyTrims;
    this.visualGroup = model.group;
    this.add(this.visualGroup);

    const beams: SpotLight[] = [];
    if (this.realtimeLighting) {
      for (const x of [-0.60, 0.60]) {
        const light = new SpotLight(0xd8efff, 35, 28, Math.PI / 7, 0.65, 2);
        light.name = "rift-car-headlight-beam";
        light.position.set(x, 0.68, 2.1);
        light.target.position.set(x, 0.05, 13);
        this.visualGroup.add(light, light.target);
        beams.push(light);
      }
      const underbodyLight = new PointLight(0x8d52bc, 2, 5.5, 2);
      underbodyLight.position.set(0, 0.18, 0);
      underbodyLight.name = "rift-car-underbody-light";
      this.visualGroup.add(underbodyLight);
      this.underbodyLight = underbodyLight;
    }
    this.headlightBeams = beams;
    const shadow = new Mesh(new CircleGeometry(1, 32), new ShaderMaterial({
      name: "rift-car-contact-shadow-material", transparent: true, depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec2 vUv; void main(){float radius=length(vUv-0.5)*2.0;gl_FragColor=vec4(0.006,0.006,0.012,pow(max(0.0,1.0-radius),1.3)*0.55);}`,
    }));
    shadow.name = "rift-car-contact-shadow";
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.008;
    shadow.scale.set(1.35, 2.35, 1);
    this.add(shadow);
    this.setHeadlights(options.headlights !== false);
    this.position.set(finiteOr(options.position?.x, 0), finiteOr(options.position?.y, 0), finiteOr(options.position?.z, 0));
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
    const shadow = this.getObjectByName("rift-car-contact-shadow");
    if (shadow) shadow.visible = !("airborne" in state && state.airborne);

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
    this.wheelMeshes.forEach((wheel, index) => {
      wheel.rotation.order = "YXZ";
      wheel.rotation.x -= wheelSpin;
      wheel.rotation.y = index < 2 ? -steering * 0.46 : 0;
    });

    const speedGlow = clamp(speed / 34, 0, 1);
    const driftGlow = clamp(drift, 0, 1);
    const trimOpacity = 0.28 + speedGlow * 0.15 + driftGlow * 0.18;
    this.underbodyTrims.forEach((trim) => {
      trim.material.opacity = trimOpacity;
    });
    this.headlightBeams.forEach((beam) => {
      beam.visible = this.headlightsEnabled;
      beam.intensity = this.headlightsEnabled
        ? 35 + speed * 0.5 + driftGlow * 2
        : 0;
    });
    if (this.underbodyLight) {
      // Keep the light quiet at rest, then let acceleration and drift lift the
      // restrained violet spill. Headlights add a small readability boost.
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
    return this;
  }

  toggleHeadlights(): boolean {
    this.setHeadlights(!this.headlightsEnabled);
    return this.headlightsEnabled;
  }

  /** Return the four wheel anchors in world space for skid effects. */
  getWheelWorldPositions(target: Vector3[] = []): Vector3[] {
    const offsets: readonly [number, number, number][] = [
      [-1.03, 0, 1.15],
      [1.03, 0, 1.15],
      [-1.03, 0, -1.25],
      [1.03, 0, -1.25],
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
