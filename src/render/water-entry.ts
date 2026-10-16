import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from "three";

const SPRAY_COUNT = 96;
const CROWN_COUNT = 48;
const RIPPLE_COUNT = 3;
const EFFECT_LIFETIME = 1.35;

/** Pooled foam, spray, and ripple feedback at sea level; reused each lap. */
export class WaterEntryEffect extends Group {
  private age = EFFECT_LIFETIME;
  private readonly origin = new Vector3();
  private readonly spray: Points<BufferGeometry, PointsMaterial>;
  private readonly crown: Points<BufferGeometry, PointsMaterial>;
  private readonly foam: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly rings: Mesh<RingGeometry, MeshBasicMaterial>[];
  private readonly bubbles: Points<BufferGeometry, ShaderMaterial>;

  constructor() {
    super();
    this.name = "rift-water-entry-splash";
    this.visible = false;

    const sprayGeometry = new BufferGeometry();
    sprayGeometry.setAttribute("position", new BufferAttribute(new Float32Array(SPRAY_COUNT * 3), 3));
    this.spray = new Points(sprayGeometry, new PointsMaterial({
      name: "rift-water-entry-spray-material",
      color: 0xc1f8ff,
      size: 0.065,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }));
    this.spray.name = "rift-water-entry-spray";
    this.spray.frustumCulled = false;

    const crownGeometry = new BufferGeometry();
    crownGeometry.setAttribute("position", new BufferAttribute(new Float32Array(CROWN_COUNT * 3), 3));
    this.crown = new Points(crownGeometry, new PointsMaterial({
      name: "rift-water-entry-crown-material",
      color: 0xe5fcff,
      size: 0.085,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    }));
    this.crown.name = "rift-water-entry-crown";
    this.crown.frustumCulled = false;

    const ringGeometry = new RingGeometry(0.82, 1, 64);
    const makeRingMaterial = (name: string, color: number, opacity: number): MeshBasicMaterial => new MeshBasicMaterial({
      name,
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: DoubleSide,
    });

    this.foam = new Mesh(ringGeometry, makeRingMaterial("rift-water-entry-foam-material", 0xd9fbff, 0.82));
    this.foam.name = "rift-water-entry-foam";
    this.foam.rotation.x = -Math.PI / 2;
    this.foam.frustumCulled = false;

    this.rings = Array.from({ length: RIPPLE_COUNT }, (_, index) => {
      const ring = new Mesh(ringGeometry, makeRingMaterial(
        `rift-water-entry-ripple-material-${index}`,
        index === 0 ? 0x9ef6ff : 0x70e6ff,
        0.72 - index * 0.12,
      ));
      ring.name = `rift-water-entry-ripple-${index}`;
      ring.rotation.x = -Math.PI / 2;
      ring.frustumCulled = false;
      return ring;
    });

    const bubbleGeometry = new BufferGeometry();
    bubbleGeometry.setAttribute("position", new BufferAttribute(new Float32Array(32 * 3), 3));
    this.bubbles = new Points(bubbleGeometry, new ShaderMaterial({ transparent: true, depthWrite: false,
      uniforms: { opacity: { value: 0 } },
      vertexShader: `void main(){vec4 p=modelViewMatrix*vec4(position,1.0);gl_Position=projectionMatrix*p;gl_PointSize=clamp(90.0/max(1.0,-p.z),1.0,18.0);}`,
      fragmentShader: `uniform float opacity;void main(){vec2 p=gl_PointCoord-0.5;float r=length(p);if(r>0.48)discard;
        float rim=exp(-pow((r-0.34)*26.0,2.0));float glint=exp(-dot(p-vec2(-0.14,0.14),p-vec2(-0.14,0.14))*180.0);
        gl_FragColor=vec4(0.73,0.94,1.0,(rim*0.28+glint*0.5)*opacity);
        #include <colorspace_fragment>
      }` }));
    this.bubbles.name = "rift-water-entry-bubbles";this.bubbles.frustumCulled = false;
    for (const material of [this.spray.material, this.crown.material]) {
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          float dropletRadius=length(gl_PointCoord-0.5)*2.0;
          if(dropletRadius>1.0)discard;`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `diffuseColor.a*=1.0-smoothstep(0.4,1.0,dropletRadius);
          #include <opaque_fragment>`);
      };
      material.customProgramCacheKey = () => "rift-soft-spray-v1";
    }
    this.add(this.spray, this.crown, this.foam, ...this.rings, this.bubbles);
  }

  emit(position: Vector3): void {
    this.origin.copy(position);
    this.age = 0;
    this.visible = true;
    this.foam.visible = true;
    this.rings.forEach((ring) => { ring.visible = true; });
  }

  update(delta: number, carPosition?: Vector3): void {
    this.age += Math.max(0, delta);
    if (this.age > EFFECT_LIFETIME) {
      this.visible = false;
      this.foam.visible = false;
      this.rings.forEach((ring) => { ring.visible = false; });
      return;
    }

    this.position.copy(this.origin);
    const bubblePositions = this.bubbles.geometry.getAttribute("position");
    const diveDepth = carPosition ? Math.min(-0.25, carPosition.y - this.origin.y) : -1;
    for (let i = 0; i < bubblePositions.count; i++) {
      const t = i / bubblePositions.count;const angle = i * 2.39996;
      bubblePositions.setXYZ(i, Math.cos(angle) * (0.6 + t) + ((carPosition?.x ?? this.origin.x) - this.origin.x) * (1 - t),
        diveDepth * (1 - t) - 0.3 + this.age * (0.4 + t),
        Math.sin(angle) * (0.6 + t) + ((carPosition?.z ?? this.origin.z) - this.origin.z) * (1 - t));
    }
    bubblePositions.needsUpdate = true;
    this.bubbles.material.uniforms.opacity.value = Math.max(0, Math.sin(Math.min(1, this.age / 0.8) * Math.PI));

    const sprayPositions = this.spray.geometry.getAttribute("position");
    for (let index = 0; index < sprayPositions.count; index += 1) {
      const angle = index * 2.3999632297;
      const speed = 4.3 + (index % 9) * 0.62;
      const lift = 3.3 + (index % 7) * 0.5;
      sprayPositions.setXYZ(index,
        Math.cos(angle) * this.age * speed,
        0.12 + lift * this.age - 5.2 * this.age ** 2,
        Math.sin(angle) * this.age * speed,
      );
    }

    sprayPositions.needsUpdate = true;
    this.spray.material.opacity = Math.max(0, (1 - this.age / EFFECT_LIFETIME) * 0.9);

    const crownPositions = this.crown.geometry.getAttribute("position");
    const crownFade = Math.max(0, 1 - this.age / 1.05);
    for (let index = 0; index < crownPositions.count; index += 1) {
      const angle = index / CROWN_COUNT * Math.PI * 2;
      const crest = 0.82 + (index % 5) * 0.12;
      const radius = 0.64 + this.age * 3.2 + Math.sin(angle * 3) * 0.1;
      crownPositions.setXYZ(index,
        Math.cos(angle) * radius,
        0.08 + crest * Math.exp(-this.age * 3.1) + Math.sin(angle * 4) * 0.05,
        Math.sin(angle) * radius,
      );
    }
    crownPositions.needsUpdate = true;
    this.crown.material.opacity = crownFade * 0.95;

    const foamProgress = Math.min(1, this.age / 0.9);
    this.foam.position.y = 0.035;
    this.foam.scale.setScalar(0.6 + foamProgress * 2.7);
    this.foam.material.opacity = Math.max(0, (1 - this.age / 0.95) * 0.82);

    this.rings.forEach((ring, index) => {
      const delay = index * 0.1;
      const progress = Math.max(0, Math.min(1, (this.age - delay) / (1.12 - delay)));
      ring.visible = this.age >= delay;
      ring.position.y = 0.045 + index * 0.004;
      ring.scale.setScalar(0.78 + progress * (10.5 + index * 2.1));
      ring.material.opacity = ring.visible
        ? Math.max(0, (1 - progress) * (0.72 - index * 0.12))
        : 0;
    });
  }

  reset(): void {
    this.age = EFFECT_LIFETIME;
    this.visible = false;
    this.foam.visible = false;
    this.rings.forEach((ring) => { ring.visible = false; });
  }
}
