import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Points, Quaternion, RingGeometry, ShaderMaterial, Vector3 } from "three";
import { oceanSurfaceHeight } from "../game/ocean";

const CAPACITY = 6;
const DROPS = 16;

/** All small debris splashes share two draw calls and fixed buffers. */
export class WoodSplashPool extends Group {
  private readonly origins = Array.from({ length: CAPACITY }, () => new Vector3());
  private readonly ages = new Float32Array(CAPACITY).fill(2);
  private readonly strengths = new Float32Array(CAPACITY);
  private readonly spray: Points<BufferGeometry, ShaderMaterial>;
  private readonly rings: InstancedMesh<RingGeometry, ShaderMaterial>;
  private readonly ringMatrix = new Matrix4();
  private readonly ringRotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  private readonly ringScale = new Vector3();
  private readonly point = new Vector3();
  private cursor = 0;

  constructor() {
    super();this.name = "rift-wood-impact-splashes";this.userData.dynamicVisibility = true;this.visible = false;
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(CAPACITY * DROPS * 3), 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute("alpha", new BufferAttribute(new Float32Array(CAPACITY * DROPS), 1).setUsage(DynamicDrawUsage));
    this.spray = new Points(geometry, new ShaderMaterial({ transparent: true, depthWrite: false,
      vertexShader: `attribute float alpha;varying float vAlpha;void main(){vAlpha=alpha;vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;gl_PointSize=clamp(60.0/max(1.0,-p.z),1.0,5.0);}`,
      fragmentShader: `varying float vAlpha;void main(){float r=length(gl_PointCoord-0.5)*2.0;if(r>1.0)discard;gl_FragColor=vec4(0.72,0.94,1.0,vAlpha*(1.0-r*r));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }));
    this.spray.name = "rift-wood-impact-spray";this.spray.frustumCulled = false;
    const ringGeometry = new RingGeometry(0.78, 1, 24);
    ringGeometry.setAttribute("splashAlpha", new InstancedBufferAttribute(new Float32Array(CAPACITY), 1).setUsage(DynamicDrawUsage));
    this.rings = new InstancedMesh(ringGeometry, new ShaderMaterial({ transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
      vertexShader: `attribute float splashAlpha;varying float vAlpha;void main(){vAlpha=splashAlpha;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying float vAlpha;void main(){gl_FragColor=vec4(0.58,0.83,0.9,vAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    }), CAPACITY);
    this.rings.name = "rift-wood-impact-ripples";this.rings.frustumCulled = false;
    this.add(this.spray, this.rings);
  }

  emit(position: Vector3, impactSpeed: number): void {
    const slot = this.cursor++ % CAPACITY;
    this.origins[slot].copy(position);this.ages[slot] = 0;
    this.strengths[slot] = Math.min(1.5, 0.45 + impactSpeed / 30);this.visible = true;
  }

  update(delta: number, time: number): void {
    if (!this.visible) return;
    const positions = this.spray.geometry.getAttribute("position") as BufferAttribute;
    const alpha = this.spray.geometry.getAttribute("alpha") as BufferAttribute;
    const ringAlpha = this.rings.geometry.getAttribute("splashAlpha") as InstancedBufferAttribute;
    let active = false;
    for (let slot = 0; slot < CAPACITY; slot++) {
      const age = this.ages[slot] += delta;const strength = this.strengths[slot];
      const origin = this.origins[slot];const alive = age < 0.85;
      active ||= alive;
      for (let drop = 0; drop < DROPS; drop++) {
        const index = slot * DROPS + drop;const angle = drop * 2.39996;
        const outward = (0.8 + drop % 5 * 0.22) * strength;
        const y = (2.1 + drop % 3 * 0.45) * strength * age - 4.905 * age * age;
        positions.setXYZ(index, origin.x + Math.cos(angle) * outward * age, origin.y + y,
          origin.z + Math.sin(angle) * outward * age);
        alpha.setX(index, alive && y >= 0 ? Math.max(0, 0.65 - age) : 0);
      }
      this.point.set(origin.x, oceanSurfaceHeight(origin.x, origin.z, time) + 0.035, origin.z);
      this.ringMatrix.compose(this.point, this.ringRotation, this.ringScale.setScalar(alive ? 0.15 + age * 2.8 * strength : 0));
      this.rings.setMatrixAt(slot, this.ringMatrix);ringAlpha.setX(slot, alive ? (1 - age / 0.85) * 0.35 : 0);
    }
    positions.needsUpdate = alpha.needsUpdate = ringAlpha.needsUpdate = this.rings.instanceMatrix.needsUpdate = true;
    this.visible = active;
  }

  reset(): void { this.ages.fill(2);this.cursor = 0;this.visible = false; }
}
