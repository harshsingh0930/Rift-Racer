import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, DoubleSide,
  Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial,
  PlaneGeometry, ShaderMaterial, SphereGeometry, Vector3, Vector4,
} from "three";
import type { QualityTier } from "../game/performance";
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

/** Concentrate water vertices near the driver, leaving the horizon inexpensive. */
function oceanGeometry(quality: QualityTier): BufferGeometry {
  const rings = quality === "eco" ? 48 : quality === "ultra" ? 80 : 64;
  const sectors = quality === "eco" ? 96 : 128;
  const positions: number[] = [];const indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const radius = (ring / rings) ** 1.8 * 1250;
    for (let sector = 0; sector <= sectors; sector++) {
      const angle = sector / sectors * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      if (ring < rings && sector < sectors) {
        const a = ring * (sectors + 1) + sector;const b = a + sectors + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new BufferGeometry();geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));geometry.setIndex(indices);
  return geometry;
}

// Gravity-based phase speed keeps the larger swells slower than small waves.
const SWELL_GLSL = `
  float swell(vec2 p){
    return sin(dot(p,vec2(0.94,0.34))*0.19635-time*1.388)*0.22
      +sin(dot(p,vec2(-0.42,0.91))*0.3696-time*1.905)*0.11
      +sin(dot(p,vec2(0.65,-0.76))*0.7392-time*2.693)*0.045;
  }
`;

export function createCoastalEnvironment(route: TrackRoute, quality: QualityTier = "balanced"): Group {
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
    name: "rift-ocean-material", side: DoubleSide, transparent: true, depthWrite: false,
    uniforms: {
      time: { value: 0 },
      playerPosition: { value: new Vector3(0, 1, 0) },
      impactPosition: { value: new Vector3(0, -1.8, 0) },
      impactTime: { value: -1 },
      impactStrength: { value: 0 },
      debrisImpacts: { value: Array.from({ length: 8 }, () => new Vector4(0, 0, -1, 0)) },
      openings: { value: openings },
      openingCount: { value: openingCount },
      hazeColor: { value: new Color(0x0a4967) },
    },
    vertexShader: `uniform float time;uniform vec3 playerPosition;varying vec3 vWorld;
      ${SWELL_GLSL}
      void main(){
        vec4 world=modelMatrix*vec4(position,1.0);world.xz+=playerPosition.xz;
        world.y+=swell(world.xz);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;
      }`,
    fragmentShader: `uniform float time; uniform vec3 playerPosition; uniform vec3 impactPosition;
      uniform float impactTime; uniform float impactStrength; uniform vec3 hazeColor;
      uniform vec3 openings[64]; uniform int openingCount;uniform vec4 debrisImpacts[8]; varying vec3 vWorld;
      ${SWELL_GLSL}
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);
      }
      float heightAt(vec2 p){
        return swell(p)+noise(p*0.16+vec2(time*0.08,time*0.035))*0.065
          +noise(p*0.57+vec2(-time*0.06,time*0.1))*0.016;
      }
      void main(){
        if(playerPosition.y < -1.8 && cameraPosition.y > -1.8 && distance(vWorld.xz,playerPosition.xz)<9.0) discard;
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
        // Keep the water legible at the entry: a deep-blue base, cyan fresnel,
        // and a small wave lift read as water without hiding the dive geometry.
        vec3 water=mix(vec3(0.008,0.050,0.120),vec3(0.020,0.280,0.440),0.22+fresnel*0.78);
        float waveLift=smoothstep(-0.06,0.28,height);
        water+=vec3(0.000,0.115,0.185)*waveLift*(0.55+fresnel*0.45);
        vec3 sunDirection=normalize(vec3(230.0,35.0,9.0));
        float glint=pow(max(0.0,dot(reflect(-sunDirection,normal),view)),190.0);
        vec3 reflection=reflect(-view,normal);
        vec3 skyReflection=mix(vec3(0.72,0.19,0.32),vec3(0.08,0.025,0.18),smoothstep(0.0,0.6,reflection.y));
        water=mix(water,skyReflection,fresnel*0.42);
        water+=vec3(1.0,0.65,0.32)*glint*0.85;
        water+=vec3(0.000,0.026,0.050)*(height-0.04);
        // This band peaks just below the surface and fades in the deep route,
        // keeping the cliff landing clear without making the whole ocean flat.
        float belowSurface=1.0-smoothstep(-2.0,-1.2,cameraPosition.y);
        float entryBand=belowSurface*smoothstep(-8.0,-1.8,cameraPosition.y);
        float submerged=1.0-smoothstep(-1.8,-0.6,cameraPosition.y);
        float hazeDistance=1.0-exp(-0.00018*distanceToCamera*distanceToCamera);
        float hazeStrength=mix(0.34,0.14,entryBand)*mix(1.0,0.72,submerged);
        vec3 haze=mix(hazeColor,vec3(0.012,0.235,0.365),entryBand*0.72);
        water=mix(water,haze,hazeDistance*hazeStrength);
        water+=vec3(0.000,0.055,0.090)*entryBand;
        // A short-lived radial response makes the same impact read through
        // the ocean surface: a moving crest, inner echo, and caustic glow.
        float impactAge=max(impactTime,0.0);
        float impactActive=step(0.0,impactTime)*impactStrength*exp(-impactAge*1.35);
        float impactDistance=length(vWorld.xz-impactPosition.xz);
        float impactRadius=impactAge*24.0;
        float impactWidth=0.52+impactAge*0.3;
        float crest=exp(-pow((impactDistance-impactRadius)/impactWidth,2.0));
        float echo=exp(-pow((impactDistance-impactRadius*0.58)/(impactWidth*0.82),2.0));
        float causticPattern=0.5+0.5*sin(impactDistance*6.4-impactAge*13.0);
        float radialRipple=impactActive*(crest*0.9+echo*0.34)*(0.68+causticPattern*0.32);
        float radialCaustic=impactActive*exp(-impactDistance/(3.5+impactAge*8.0))
          *(0.55+0.45*sin(impactDistance*3.2+impactAge*8.0));
        water+=vec3(0.000,0.26,0.42)*radialRipple;
        water+=vec3(0.015,0.22,0.36)*radialCaustic*(0.6+fresnel*0.4);
        for(int i=0;i<8;i++){
          vec4 hit=debrisImpacts[i];if(hit.z<0.0)continue;
          float gap=length(vWorld.xz-hit.xy);
          float ring=exp(-pow((gap-hit.z*7.0)/(0.2+hit.z*0.35),2.0));
          water+=vec3(0.16,0.35,0.39)*ring*exp(-hit.z*2.1)*hit.w;
        }
        float waterOpacity=mix(0.84,0.54,submerged)-entryBand*0.16
          +radialRipple*0.12+radialCaustic*0.045;
        gl_FragColor=vec4(water,clamp(waterOpacity,0.34,0.94));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const ocean = new Mesh(oceanGeometry(quality), waterMaterial);
  ocean.name = "rift-coastal-water-surface";
  ocean.position.y = -1.8;
  ocean.frustumCulled = false;
  environment.add(ocean);
  const seabed = new Mesh(new PlaneGeometry(1600, 1600), new MeshStandardMaterial({
    name: "rift-seabed-material", color: 0x16404b, emissive: 0x05212b,
    emissiveIntensity: 0.45, roughness: 1,
  }));
  seabed.name = "rift-seabed";
  seabed.rotation.x = -Math.PI / 2;
  seabed.position.y = -40;
  environment.add(seabed);

  return environment;
}
