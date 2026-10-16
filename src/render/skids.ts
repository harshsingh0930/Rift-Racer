import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Float32BufferAttribute, Mesh, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";
import { findNearestTrackPoint, type TrackRoute } from "../game/track";

/** Two continuous rubber trails in one draw call, with a bounded circular buffer. */
export class TyreTrails {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly lives: Float32Array;
  private readonly strengths: Float32Array;
  private readonly previous: Array<Vector3 | undefined> = [undefined, undefined];
  private readonly previousEdges: Array<[Vector3, Vector3] | undefined> = [undefined, undefined];
  private cursor = 0;

  constructor(private readonly route: TrackRoute, readonly capacity = 768) {
    this.positions = new Float32Array(capacity * 12);
    this.positions.fill(-1000);
    this.alphas = new Float32Array(capacity * 4);
    this.lives = new Float32Array(capacity);
    this.strengths = new Float32Array(capacity);
    const uvs = new Float32Array(capacity * 8);
    const indices: number[] = [];
    for (let index = 0; index < capacity; index += 1) {
      uvs.set([0, 0, 1, 0, 0, 1, 1, 1], index * 8);
      const base = index * 4;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute("trailAlpha", new BufferAttribute(this.alphas, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    this.mesh = new Mesh(geometry, new ShaderMaterial({
      name: "rift-rubber-trail-material", transparent: true, depthWrite: false,
      uniforms: UniformsUtils.merge([UniformsLib.fog]),
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, fog: true,
      vertexShader: `attribute float trailAlpha; varying float vAlpha; varying vec2 vUv;
        #include <fog_pars_vertex>
        void main(){vAlpha=trailAlpha;vUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vAlpha; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main(){
          float edge=smoothstep(0.0,0.12,vUv.x)*(1.0-smoothstep(0.88,1.0,vUv.x));
          float tread=0.78+0.22*smoothstep(0.08,0.2,fract(vUv.x*8.0));
          gl_FragColor=vec4(vec3(0.004,0.005,0.009),vAlpha*edge*tread);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    }));
    this.mesh.name = "rift-persistent-tyre-trails";
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  draw(wheels: readonly Vector3[], intensity: number): void {
    for (let wheel = 0; wheel < 2; wheel += 1) {
      const point = wheels[wheel + 2];
      if (!point) continue;
      const previous = this.previous[wheel];
      if (!previous) { this.previous[wheel] = point.clone(); continue; }
      const distance = previous.distanceTo(point);
      if (distance < 0.055) continue;
      if (distance > 4) { this.previous[wheel] = point.clone(); this.previousEdges[wheel] = undefined; continue; }
      this.previousEdges[wheel] = this.add(previous, point, intensity, this.previousEdges[wheel]);
      previous.copy(point);
    }
  }

  add(start: Vector3, end: Vector3, intensity = 1, joinedEdges?: [Vector3, Vector3]): [Vector3, Vector3] {
    const side = end.clone().sub(start).cross(new Vector3(0, 1, 0)).normalize().multiplyScalar(0.15);
    const left = end.clone().add(side);
    const right = end.clone().sub(side);
    const startLeft = joinedEdges?.[0] ?? start.clone().add(side);
    const startRight = joinedEdges?.[1] ?? start.clone().sub(side);
    const corners = [startLeft, startRight, left, right];
    const index = this.cursor++ % this.capacity;
    for (let corner = 0; corner < 4; corner += 1) {
      const point = corners[corner];
      point.y = findNearestTrackPoint(this.route, point).position.y + 0.043;
      this.positions.set(point.toArray(), index * 12 + corner * 3);
    }
    this.lives[index] = 24;
    this.strengths[index] = Math.max(0, Math.min(0.92, intensity * 0.92));
    this.alphas.fill(this.strengths[index], index * 4, index * 4 + 4);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.trailAlpha.needsUpdate = true;
    return [left, right];
  }

  stop(): void {
    this.previous.fill(undefined);
    this.previousEdges.fill(undefined);
  }

  update(delta: number): void {
    for (let index = 0; index < this.capacity; index += 1) {
      if (this.lives[index] <= 0) continue;
      this.lives[index] = Math.max(0, this.lives[index] - delta);
      this.alphas.fill(this.strengths[index] * Math.min(1, this.lives[index] / 4), index * 4, index * 4 + 4);
    }
    this.mesh.geometry.attributes.trailAlpha.needsUpdate = true;
  }

  clear(): void {
    this.alphas.fill(0);
    this.lives.fill(0);
    this.cursor = 0;
    this.stop();
    this.mesh.geometry.attributes.trailAlpha.needsUpdate = true;
  }
}
