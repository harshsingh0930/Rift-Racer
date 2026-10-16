import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, DoubleSide,
  Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial,
  PlaneGeometry, ShaderMaterial, SphereGeometry, Vector3,
} from "three";
import { sampleTrackPosition, sampleTrackSection, sampleTrackTangent, sampleTrackWidth, type TrackRoute } from "../game/track";

const UP = new Vector3(0, 1, 0);

function makeBridgePiers(route: TrackRoute): InstancedMesh {
  const transforms: Matrix4[] = [];
  for (let distance = 12; distance < route.totalLength; distance += 36) {
    const section = sampleTrackSection(route, distance);
    if (section !== "causeway" && section !== "final-skyline") continue;
    const center = sampleTrackPosition(route, distance);
    if (center.y < 1) continue;
    const side = new Vector3().crossVectors(UP, sampleTrackTangent(route, distance)).normalize();
    for (const sign of [-1, 1]) {
      const position = center.clone().addScaledVector(side, sign * (sampleTrackWidth(route, distance) * 0.5 - 0.4));
      // A flyover support must not occupy the road beneath it.
      const obstructsRoad = route.points.some((point, index) => {
        const gap = Math.abs(route.segments[index].startDistance - distance);
        if (Math.min(gap, route.totalLength - gap) < 30) return false;
        return point.position.y > -5 && point.position.y < center.y
          && Math.hypot(point.position.x - position.x, point.position.z - position.z) < point.width * 0.5 + 1.5;
      });
      if (obstructsRoad) continue;
      const height = center.y + 5;
      const matrix = new Matrix4().makeScale(0.9, height, 0.9);
      matrix.setPosition(position.x, -5 + height * 0.5 - 0.12, position.z);
      transforms.push(matrix);
    }
  }
  const piers = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({
    color: 0x28243b, roughness: 0.9,
  }), transforms.length);
  piers.name = "rift-bridge-supports";
  transforms.forEach((matrix, index) => piers.setMatrixAt(index, matrix));
  piers.computeBoundingSphere();
  return piers;
}

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
    // Bridges and skyline flyovers need open space underneath. Wide banks
    // along those spans used to cut through the lower road at crossings.
    if (segment.section !== "coastal-boulevard") continue;
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
    fragmentShader: `varying vec2 vUv;
      void main(){
        float r=length(vUv-0.5)*2.0;
        float a=pow(max(0.0,1.0-r),3.0)*0.4;
        gl_FragColor=vec4(1.0,0.21,0.11,a);
        #include <colorspace_fragment>
      }`,
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
  environment.add(makeCoastBanks(route), makeBridgePiers(route));
  // Cut the sea surface around the glass enclosure itself, including the
  // descent ahead of the player. A player-centred hole hid the ramp at entry.
  const openings: Vector3[] = [];
  for (let distance = 0; distance < route.totalLength; distance += 6) {
    if (sampleTrackSection(route, distance) !== "underwater") continue;
    const center = sampleTrackPosition(route, distance);
    const radius = sampleTrackWidth(route, distance) / 2 + 1.7;
    const height = Math.abs(center.y + 1.8);
    if (height < radius && openings.length < 64) {
      openings.push(new Vector3(center.x, center.z, Math.sqrt(radius * radius - height * height) + 1));
    }
  }
  const openingCount = openings.length;
  while (openings.length < 64) openings.push(new Vector3());
  const waterMaterial = new ShaderMaterial({
    name: "rift-ocean-material", side: DoubleSide,
    uniforms: { time: { value: 0 }, playerPosition: { value: new Vector3(0, 1, 0) },
      openings: { value: openings }, openingCount: { value: openingCount }, hazeColor: { value: new Color(0x57354f) } },
    vertexShader: `varying vec3 vWorld; void main(){vec4 world=modelMatrix*vec4(position,1.0);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader: `uniform float time; uniform vec3 playerPosition; uniform vec3 hazeColor;
      uniform vec3 openings[64]; uniform int openingCount; varying vec3 vWorld;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);
      }
      float heightAt(vec2 p){
        return noise(p*0.16+vec2(time*0.08,time*0.035))*0.065
          +noise(p*0.57+vec2(-time*0.06,time*0.1))*0.016;
      }
      void main(){
        for(int i=0;i<64;i++){
          if(i>=openingCount) break;
          vec2 openingGap=vWorld.xz-openings[i].xy;
          if(dot(openingGap,openingGap)<openings[i].z*openings[i].z) discard;
        }
        vec3 view=normalize(cameraPosition-vWorld);
        float distanceToCamera=length(cameraPosition.xz-vWorld.xz);
        float height=heightAt(vWorld.xz);
        float detail=1.0-smoothstep(45.0,150.0,distanceToCamera);
        vec3 normal=normalize(vec3((height-heightAt(vWorld.xz+vec2(0.6,0.0)))*detail,0.6,(height-heightAt(vWorld.xz+vec2(0.0,0.6)))*detail));
        float fresnel=pow(1.0-max(0.0,dot(view,normal)),4.0);
        vec3 water=mix(vec3(0.006,0.019,0.035),vec3(0.15,0.065,0.14),fresnel*0.7);
        vec3 sunDirection=normalize(vec3(230.0,35.0,9.0));
        float glint=pow(max(0.0,dot(reflect(-sunDirection,normal),view)),190.0);
        water+=vec3(0.55,0.25,0.19)*glint*0.45;
        water+=vec3(0.004,0.008,0.009)*(height-0.04);
        vec3 haze=hazeColor;
        if(cameraPosition.y < -1.8){water=vec3(0.009,0.10,0.15)+water*0.2;haze=vec3(0.002,0.038,0.06);}
        water=mix(water,haze,1.0-exp(-0.000324*distanceToCamera*distanceToCamera));
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
  const seabed = new Mesh(new PlaneGeometry(1600, 1600), new MeshStandardMaterial({
    name: "rift-seabed-material", color: 0x16404b, emissive: 0x05212b,
    emissiveIntensity: 0.45, roughness: 1,
  }));
  seabed.name = "rift-seabed";
  seabed.rotation.x = -Math.PI / 2;
  seabed.position.y = -40;
  environment.add(seabed);

  // Distant rock silhouettes give the horizon depth without external assets.
  const rockGeometry = new SphereGeometry(1, 7, 5);
  const rockMaterial = new MeshStandardMaterial({ color: 0x34213f, roughness: 1, flatShading: true });
  for (let index = 0; index < 13; index += 1) {
    const rock = new Mesh(rockGeometry, rockMaterial);
    rock.position.set(-350 + index * 60, -1, -430 - Math.sin(index * 1.7) * 18);
    rock.scale.set(20 + (index % 3) * 8, 15 + (index % 4) * 9, 20);
    environment.add(rock);
  }
  return environment;
}
