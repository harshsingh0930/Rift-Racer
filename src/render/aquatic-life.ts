import { BufferAttribute, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Object3D, Points, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";
import { sampleTrackPosition, sampleTrackSection, sampleTrackTangent, sampleTrackWidth, type TrackRoute } from "../game/track";
import type { QualityTier } from "../game/performance";
import { ReefLife } from "./reef-life";

/** Instanced sea gardens and one pooled draw of fish bubbles outside the glass. */
export class AquaticLife extends Group {
  private readonly plants: ShaderMaterial;
  private readonly bubbles: Points<BufferGeometry, ShaderMaterial>;
  private readonly sources: Object3D[];
  private readonly sourcePosition = new Vector3();
  private readonly reef: ReefLife;

  constructor(route: TrackRoute, quality: QualityTier, enclosure: Group) {
    super();this.name = "rift-aquatic-gardens";
    this.reef = new ReefLife(route, quality);this.add(this.reef);
    this.sources = [];
    enclosure.traverse(object => { if (object.name === "rift-underwater-fish" || object.name === "rift-underwater-fish-schoolmate") this.sources.push(object); });
    const vertices: number[] = [];const uvs: number[] = [];const indices: number[] = [];
    for (let row = 0; row <= 12; row++) {
      const y = row / 12;const width = Math.sin(y * Math.PI) * 0.55 + 0.05;
      for (const sign of [-1, 1]) { vertices.push(sign * width, y * 12, Math.sin(y * Math.PI * 1.4) * 0.75);uvs.push(sign < 0 ? 0 : 1, y); }
      if (row < 12) { const a = row * 2;indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geometry = new BufferGeometry();geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));geometry.setIndex(indices);
    this.plants = new ShaderMaterial({ side: DoubleSide, fog: true, uniforms: UniformsUtils.merge([UniformsLib.fog, { time: { value: 0 } }]),
      vertexShader: `uniform float time;varying vec2 vUv;varying float vKind;
        #include <fog_pars_vertex>
        void main(){vUv=uv;vKind=fract(instanceMatrix[3].x*0.13+instanceMatrix[3].z*0.31);vec3 p=position;
          p.x+=sin(time*0.7+instanceMatrix[3].x+uv.y*3.0)*uv.y*uv.y*0.45;
          vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `varying vec2 vUv;varying float vKind;
        #include <fog_pars_fragment>
        void main(){float vein=0.9+0.1*cos(vUv.x*18.0+vUv.y*8.0);
          vec3 base=mix(vec3(0.018,0.19,0.18),vec3(0.17,0.09,0.29),step(0.67,vKind));
          vec3 tip=mix(vec3(0.12,0.45,0.36),vec3(0.39,0.19,0.41),step(0.67,vKind));
          gl_FragColor=vec4(mix(base,tip,vUv.y)*vein,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }` });
    const matrices: Matrix4[] = [];
    for (let distance = 0, station = 0; distance < route.totalLength; distance += quality === "eco" ? 24 : 16, station++) {
      if (sampleTrackSection(route, distance) !== "underwater") continue;
      const center = sampleTrackPosition(route, distance);const tangent = sampleTrackTangent(route, distance);
      const side = new Vector3(tangent.z, 0, -tangent.x).normalize();
      for (const sign of [-1, 1]) for (let blade = 0; blade < 5; blade++) {
        const point = center.clone().addScaledVector(side, sign * (sampleTrackWidth(route, distance) / 2 + 5 + blade * 0.7));
        point.addScaledVector(tangent, Math.sin(station * 7.1 + blade) * 3);point.y -= 6;
        const matrix = new Matrix4().makeRotationY(station * 1.7 + blade * 2.1);
        const size = 0.65 + (Math.sin(station * 3.7 + blade * 2) + 1) * 0.3;
        matrix.scale(new Vector3(0.7 + blade * 0.2, size, 1));matrix.setPosition(point);matrices.push(matrix);
      }
    }
    const kelp = new InstancedMesh(geometry, this.plants, matrices.length);kelp.name = "rift-giant-sea-garden";
    matrices.forEach((matrix, index) => kelp.setMatrixAt(index, matrix));kelp.computeBoundingSphere();this.add(kelp);
    const count = Math.min(quality === "eco" ? 96 : 180, this.sources.length * 4);
    const bubbleGeometry = new BufferGeometry();bubbleGeometry.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
    bubbleGeometry.setAttribute("bubbleLife", new BufferAttribute(new Float32Array(count), 1));
    this.bubbles = new Points(bubbleGeometry, new ShaderMaterial({ transparent: true, depthWrite: false, fog: true,
      uniforms: UniformsUtils.merge([UniformsLib.fog]),
      vertexShader: `attribute float bubbleLife;varying float vLife;
        #include <fog_pars_vertex>
        void main(){vLife=bubbleLife;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*mvPosition;
          gl_PointSize=clamp((0.10+bubbleLife*0.12)*650.0/max(1.0,-mvPosition.z),1.0,16.0);
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vLife;
        #include <fog_pars_fragment>
        void main(){vec2 p=gl_PointCoord-0.5;float r=length(p);if(r>0.48)discard;
          float rim=exp(-pow((r-0.35)*24.0,2.0));float glint=exp(-dot(p-vec2(-0.15,0.15),p-vec2(-0.15,0.15))*180.0);
          gl_FragColor=vec4(0.68,0.91,0.95,(rim*0.24+glint*0.45)*sin(vLife*3.14159));
          #include <colorspace_fragment>
          #include <fog_fragment>
        }` }));
    this.bubbles.name = "rift-fish-rising-bubbles";this.bubbles.frustumCulled = false;this.bubbles.userData.dynamicVisibility = true;this.add(this.bubbles);
  }

  update(time: number, focus?: Readonly<{ x: number; y: number; z: number }>): void {
    this.reef.update(time);
    this.plants.uniforms.time.value = time;
    if (!this.visible || !this.sources.length) return;
    const positions = this.bubbles.geometry.getAttribute("position");const lives = this.bubbles.geometry.getAttribute("bubbleLife");
    for (let i = 0; i < positions.count; i++) {
      const source = this.sources[Math.floor(i / 4) % this.sources.length];
      // Fish are direct children of the underwater scene group.
      this.sourcePosition.copy(source.position);const p = this.sourcePosition;
      const life = (time * 0.35 + i * 0.247) % 1;
      const near = !focus || (p.x - focus.x) ** 2 + (p.z - focus.z) ** 2 < 85 ** 2;
      positions.setXYZ(i, p.x + Math.sin(life * 5 + i) * 0.25, p.y + life * 4.5, p.z + Math.cos(life * 6 + i) * 0.25);
      lives.setX(i, near ? life : 0);
    }
    positions.needsUpdate = true;lives.needsUpdate = true;
  }
}
