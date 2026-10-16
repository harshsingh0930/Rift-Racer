import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, LineSegments, Points, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";
import type { CarState } from "../game/arcade";
import type { QualityTier } from "../game/performance";

/** Bounded tyre haze and subtle screen-edge streaks; one draw each. */
export class SpeedEffects extends Group {
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly sizes: Float32Array;
  private readonly velocities: Vector3[];
  private readonly lives: Float32Array;
  private readonly smoke: Points<BufferGeometry, ShaderMaterial>;
  private readonly streaks: LineSegments<BufferGeometry, ShaderMaterial>;
  private cursor = 0;
  private emission = 0;
  private time = 0;

  constructor(quality: QualityTier) {
    super();
    this.name = "rift-speed-atmosphere";
    const capacity = quality === "eco" ? 20 : quality === "balanced" ? 36 : 48;
    this.positions = new Float32Array(capacity * 3);this.positions.fill(-1000);
    this.alphas = new Float32Array(capacity);
    this.sizes = new Float32Array(capacity);
    this.lives = new Float32Array(capacity);
    this.velocities = Array.from({ length: capacity }, () => new Vector3());
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute("puffAlpha", new BufferAttribute(this.alphas, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute("puffSize", new BufferAttribute(this.sizes, 1).setUsage(DynamicDrawUsage));
    this.smoke = new Points(geometry, new ShaderMaterial({
      name: "rift-tyre-smoke", transparent: true, depthWrite: false, fog: true,
      uniforms: UniformsUtils.merge([UniformsLib.fog]),
      vertexShader: `attribute float puffAlpha;attribute float puffSize;varying float vAlpha;
        #include <fog_pars_vertex>
        void main(){vAlpha=puffAlpha;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;gl_PointSize=clamp(puffSize*650.0/max(1.0,-mvPosition.z),1.0,110.0);
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vAlpha;
        #include <fog_pars_fragment>
        void main(){float r=length(gl_PointCoord-0.5)*2.0;float edge=pow(max(0.0,1.0-r),1.4);gl_FragColor=vec4(0.68,0.64,0.74,edge*vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    }));
    this.smoke.name = "rift-drift-tyre-smoke";this.smoke.frustumCulled = false;this.add(this.smoke);
    const lines = new BufferGeometry();
    lines.setAttribute("position", new BufferAttribute(new Float32Array(18 * 6), 3).setUsage(DynamicDrawUsage));
    this.streaks = new LineSegments(lines, new ShaderMaterial({
      name: "rift-peripheral-speed-streaks", transparent: true, depthTest: false, depthWrite: false,
      uniforms: { opacity: { value: 0 } },
      vertexShader: `void main(){gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader: `uniform float opacity;void main(){gl_FragColor=vec4(0.8,0.82,1.0,opacity);}`,
    }));
    this.streaks.name = "rift-speed-streaks";this.streaks.frustumCulled = false;this.streaks.renderOrder = 100;
    this.add(this.streaks);
  }

  update(deltaSeconds: number, state?: CarState, wheels?: readonly Vector3[]): void {
    const delta = Math.min(0.1, Math.max(0, deltaSeconds));this.time += delta;
    const speed = state?.speed ?? 0;
    const drift = state?.drift ?? 0;
    if (state && wheels && speed > 7 && drift > 0.12) {
      this.emission += delta * drift * 24;
      while (this.emission >= 1) {
        this.emission -= 1;
        for (const wheel of [wheels[2], wheels[3]]) {
          if (!wheel) continue;
          const index = this.cursor++ % this.lives.length;
          this.positions.set([wheel.x, wheel.y + 0.12, wheel.z], index * 3);
          this.velocities[index].copy(state.velocity).multiplyScalar(-0.035).setY(0.45);
          this.lives[index] = 1.05;this.sizes[index] = 0.45;
        }
      }
    } else this.emission = 0;
    for (let index = 0; index < this.lives.length; index += 1) {
      this.lives[index] = Math.max(0, this.lives[index] - delta);
      this.alphas[index] = Math.min(0.62, this.lives[index] * 0.85);
      if (this.lives[index] === 0) continue;
      const velocity = this.velocities[index];
      this.positions[index * 3] += velocity.x * delta;
      this.positions[index * 3 + 1] += velocity.y * delta;
      this.positions[index * 3 + 2] += velocity.z * delta;
      this.sizes[index] += delta * 1.2;
    }
    for (const attribute of Object.values(this.smoke.geometry.attributes)) attribute.needsUpdate = true;
    const pace = Math.max(0, Math.min(1, (speed - 40) / 44));
    this.streaks.visible = pace > 0.01;
    this.streaks.material.uniforms.opacity.value = pace * pace * 0.2;
    const positions = this.streaks.geometry.getAttribute("position");
    for (let index = 0; index < 18; index += 1) {
      const angle = index * 2.399963;
      const radius = 0.7 + ((this.time * (0.3 + pace * 0.6) + index * 0.618) % 1) * 0.65;
      const length = 0.025 + pace * 0.065;
      positions.setXYZ(index * 2, Math.cos(angle) * radius * 1.25, Math.sin(angle) * radius, 0);
      positions.setXYZ(index * 2 + 1, Math.cos(angle) * (radius + length) * 1.25, Math.sin(angle) * (radius + length), 0);
    }
    positions.needsUpdate = true;
  }

  clearEffects(): void {
    this.lives.fill(0);this.alphas.fill(0);this.emission = 0;
    this.smoke.geometry.attributes.puffAlpha.needsUpdate = true;
    this.streaks.visible = false;
  }
}
