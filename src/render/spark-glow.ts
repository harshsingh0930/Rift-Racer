import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, ShaderMaterial } from "three";

/** Camera-facing ribbons give sparks a hot core and glow at any WebGL line width. */
export class SparkGlow extends Mesh<BufferGeometry, ShaderMaterial> {
  constructor(private readonly capacity: number) {
    const geometry = new BufferGeometry();
    for (const name of ["position", "tail", "color"]) {
      geometry.setAttribute(name, new BufferAttribute(new Float32Array(capacity * 12), 3).setUsage(DynamicDrawUsage));
    }
    const corners = new Float32Array(capacity * 8);const indices: number[] = [];
    for (let index = 0; index < capacity; index++) {
      corners.set([0, -1, 0, 1, 1, -1, 1, 1], index * 8);
      const base = index * 4;indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    geometry.setAttribute("corner", new BufferAttribute(corners, 2));geometry.setIndex(indices);
    super(geometry, new ShaderMaterial({
      name: "rift-impact-spark-ribbon-material", transparent: true, depthWrite: false,
      blending: AdditiveBlending, side: DoubleSide, vertexColors: true,
      vertexShader: `
        attribute vec3 tail;attribute vec2 corner;
        varying vec2 vCorner;varying vec3 vColor;
        void main(){
          vec4 headView=modelViewMatrix*vec4(position,1.0);
          vec4 tailView=modelViewMatrix*vec4(tail,1.0);
          vec2 direction=headView.xy/max(0.1,-headView.z)-tailView.xy/max(0.1,-tailView.z);
          vec2 normal=vec2(-direction.y,direction.x)/max(0.00001,length(direction));
          vec4 point=mix(tailView,headView,corner.x);
          point.xy+=normal*corner.y*0.025;
          gl_Position=projectionMatrix*point;vCorner=corner;vColor=color;
        }`,
      fragmentShader: `
        varying vec2 vCorner;varying vec3 vColor;
        void main(){
          float rim=pow(max(0.0,1.0-abs(vCorner.y)),2.0);
          float ends=smoothstep(0.0,0.12,vCorner.x)*(1.0-smoothstep(0.87,1.0,vCorner.x));
          gl_FragColor=vec4(vColor*0.6,rim*ends*0.12);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.name = "rift-impact-spark-glow";this.frustumCulled = false;this.renderOrder = 8;
  }

  sync(endpoints: BufferAttribute, colors: BufferAttribute): void {
    const heads = this.geometry.getAttribute("position") as BufferAttribute;
    const tails = this.geometry.getAttribute("tail") as BufferAttribute;
    const tints = this.geometry.getAttribute("color") as BufferAttribute;
    for (let index = 0; index < this.capacity; index++) {
      for (let corner = 0; corner < 4; corner++) {
        const vertex = index * 4 + corner;
        heads.setXYZ(vertex, endpoints.getX(index * 2), endpoints.getY(index * 2), endpoints.getZ(index * 2));
        tails.setXYZ(vertex, endpoints.getX(index * 2 + 1), endpoints.getY(index * 2 + 1), endpoints.getZ(index * 2 + 1));
        const colorIndex = index * 2 + (corner < 2 ? 1 : 0);
        tints.setXYZ(vertex, colors.getX(colorIndex), colors.getY(colorIndex), colors.getZ(colorIndex));
      }
    }
    heads.needsUpdate = tails.needsUpdate = tints.needsUpdate = true;
  }
}
