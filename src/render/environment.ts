import {
  AdditiveBlending, BackSide, BufferGeometry, Color, DoubleSide,
  Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  PlaneGeometry, ShaderMaterial, SphereGeometry, Vector3,
} from "three";
import { sampleTrackPosition, sampleTrackSection, sampleTrackTangent, sampleTrackWidth, type TrackRoute } from "../game/track";

const UP = new Vector3(0, 1, 0);

/** Ground follows the same route as the asphalt, with cliffs down to sea level. */
function makeCoastBanks(route: TrackRoute): Mesh<BufferGeometry, MeshStandardMaterial> {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const topColor = new Color(0x36304b);
  const cliffColor = new Color(0x171e33);
  let vertex = 0;
  for (let index = 0; index < route.segments.length; index += 1) {
    const segment = route.segments[index];
    if (segment.section === "underwater") continue;
    const ends = [segment.start, segment.end];
    for (let endIndex = 0; endIndex < 2; endIndex += 1) {
      const point = ends[endIndex];
      const next = route.points[(index + endIndex + 1) % route.points.length];
      const previous = route.points[(index + endIndex - 1 + route.points.length) % route.points.length];
      const tangent = next.position.clone().sub(previous.position).normalize();
      const side = new Vector3().crossVectors(UP, tangent).normalize();
      const halfWidth = point.width * 0.5 + 12;
      for (const [offset, height] of [[-halfWidth, -0.2], [halfWidth, -0.2], [-halfWidth - 4, -5], [halfWidth + 4, -5]]) {
        const position = point.position.clone().addScaledVector(side, offset);
        position.y = height === -5 ? Math.min(-3.5, point.position.y - 4) : point.position.y + height;
        positions.push(position.x, position.y, position.z);
        const color = height === -5 ? cliffColor : topColor;
        colors.push(color.r, color.g, color.b);
      }
    }
    indices.push(vertex, vertex + 1, vertex + 4, vertex + 1, vertex + 5, vertex + 4);
    indices.push(vertex, vertex + 4, vertex + 2, vertex + 2, vertex + 4, vertex + 6);
    indices.push(vertex + 1, vertex + 3, vertex + 5, vertex + 3, vertex + 7, vertex + 5);
    vertex += 8;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const banks = new Mesh(geometry, new MeshStandardMaterial({
    name: "rift-coast-ground-material", vertexColors: true, roughness: 0.92,
    emissive: 0x100d20, emissiveIntensity: 0.3, side: DoubleSide,
  }));
  banks.name = "rift-coastal-ground";
  banks.receiveShadow = true;
  return banks;
}

export function createSynthwaveSun(): Group {
  const group = new Group();
  group.name = "rift-synthwave-sun";
  const material = new ShaderMaterial({
    name: "rift-sunset-disc-material", toneMapped: false,
    vertexShader: `varying vec3 vSun; void main() { vSun=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vSun;
      void main() {
        float height=clamp(vSun.y/34.0*0.5+0.5,0.0,1.0);
        vec3 color=mix(vec3(1.0,0.12,0.28),vec3(1.0,0.87,0.40),smoothstep(0.0,0.65,height));
        color=mix(color,vec3(1.0,0.98,0.84),smoothstep(0.55,1.0,height));
        float stripe=step(0.18,fract((vSun.y+34.0)*0.17));
        if(height<0.40 && stripe<0.5) discard;
        gl_FragColor=vec4(color*2.4,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const disc = new Mesh(new SphereGeometry(34, 48, 32), material);
  disc.position.set(230, 35, 9);
  disc.name = "rift-sunset-disc";
  group.add(disc);
  const glowMaterial = new ShaderMaterial({
    name: "rift-sunset-halo-material", transparent: true, depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec2 vUv; void main(){float r=length(vUv-0.5)*2.0;float a=pow(max(0.0,1.0-r),3.0)*0.4;gl_FragColor=vec4(1.0,0.21,0.11,a); #include <colorspace_fragment> }`.replace(" #include", "\n#include"),
    side: DoubleSide,
  });
  const halo = new Mesh(new PlaneGeometry(150, 150), glowMaterial);
  halo.position.copy(disc.position);
  halo.lookAt(0, 5, 0);
  group.add(halo);
  return group;
}

export function createCoastalEnvironment(route: TrackRoute): Group {
  const environment = new Group();
  environment.name = "rift-coastal-environment";
  environment.add(makeCoastBanks(route));
  const waterMaterial = new ShaderMaterial({
    name: "rift-ocean-material", side: DoubleSide,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec3 vWorld; void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader: `uniform float time; varying vec3 vWorld;
      void main(){
        vec3 view=normalize(cameraPosition-vWorld);
        float distanceToCamera=length(cameraPosition.xz-vWorld.xz);
        float ripple=sin(vWorld.x*0.48+time*0.9+sin(vWorld.z*0.36-time*0.4))*sin(vWorld.z*0.7-time*0.8);
        float fresnel=pow(1.0-abs(view.y),3.0);
        vec3 water=mix(vec3(0.016,0.075,0.13),vec3(0.12,0.09,0.21),fresnel);
        float reflection=exp(-pow((vWorld.z-9.0)/(6.0+abs(vWorld.x)*0.07),2.0));
        float glint=pow(max(0.0,ripple),7.0)*reflection;
        water+=vec3(0.47,0.12,0.25)*glint*0.7;
        water+=vec3(0.012,0.04,0.055)*ripple;
        water=mix(water,vec3(0.15,0.08,0.19),smoothstep(100.0,650.0,distanceToCamera));
        if(cameraPosition.y < -1.8) water=mix(water,vec3(0.025,0.24,0.31),0.7);
        gl_FragColor=vec4(water,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ocean = new Mesh(new PlaneGeometry(1600, 1600), waterMaterial);
  ocean.name = "rift-coastal-water-surface";
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -1.8;
  environment.add(ocean);

  // Distant rock silhouettes give the horizon depth without external assets.
  const rockGeometry = new SphereGeometry(1, 7, 5);
  const rockMaterial = new MeshStandardMaterial({ color: 0x34213f, roughness: 1, flatShading: true });
  for (let index = 0; index < 13; index += 1) {
    const rock = new Mesh(rockGeometry, rockMaterial);
    rock.position.set(-160 + index * 33, -1, -164 - Math.sin(index * 1.7) * 18);
    rock.scale.set(20 + (index % 3) * 8, 15 + (index % 4) * 9, 20);
    environment.add(rock);
  }
  return environment;
}
