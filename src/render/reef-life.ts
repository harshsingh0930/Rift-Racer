import { BufferGeometry, Color, ConeGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Points, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from "three";
import { sampleTrackPosition, sampleTrackSection, sampleTrackTangent, sampleTrackWidth, type TrackRoute } from "../game/track";
import type { QualityTier } from "../game/performance";

/** Schools, reef silhouettes and vent bubbles make the water outside the tube inhabitable. */
export class ReefLife extends Group {
  private readonly time = { value: 0 };

  constructor(route: TrackRoute, quality: QualityTier) {
    super();this.name = "rift-living-reef";
    const fishMatrices: Matrix4[] = [];const rockMatrices: Matrix4[] = [];const coralMatrices: Matrix4[] = [];
    const bubbles: number[] = [];const seeds: number[] = [];
    const up = new Vector3(0, 1, 0);
    const spacing = quality === "eco" ? 40 : 28;
    const schoolSize = quality === "eco" ? 10 : quality === "ultra" ? 24 : 16;
    for (let distance = 0, station = 0; distance < route.totalLength; distance += spacing, station++) {
      if (sampleTrackSection(route, distance) !== "underwater") continue;
      const center = sampleTrackPosition(route, distance);const tangent = sampleTrackTangent(route, distance).setY(0).normalize();
      const side = new Vector3(tangent.z, 0, -tangent.x);const halfWidth = sampleTrackWidth(route, distance) / 2;
      for (const sign of [-1, 1]) {
        const school = center.clone().addScaledVector(side, sign * (halfWidth + 7 + station % 4));school.y += 2.0 + station % 3;
        for (let fish = 0; fish < schoolSize; fish++) {
          const point = school.clone().addScaledVector(tangent, Math.sin(fish * 2.4) * 4.5)
            .addScaledVector(side, sign * ((fish % 5) * 0.7));point.y += Math.cos(fish * 1.7) * 1.4;
          const size = 0.3 + (fish % 4) * 0.07;
          fishMatrices.push(new Matrix4().makeRotationY(Math.atan2(-tangent.z, tangent.x))
            .scale(new Vector3(size, size, size)).setPosition(point));
        }
        const vent = center.clone().addScaledVector(side, sign * (halfWidth + 3.5 + station % 3));vent.y -= 4.5;
        for (let bubble = 0; bubble < (quality === "eco" ? 10 : 18); bubble++) {
          bubbles.push(vent.x + Math.sin(bubble * 2.4) * 0.55, vent.y, vent.z + Math.cos(bubble * 1.9) * 0.55);
          seeds.push((bubble * 0.618 + station * 0.17) % 1);
        }
        for (let layer = 0; layer < 2; layer++) {
          const point = center.clone().addScaledVector(side, sign * (halfWidth + 14 + layer * 9));point.y -= 7;
          const height = 10 + (station * 3 + layer) % 12;
          const overlaps = route.points.some(road => Math.hypot(point.x - road.position.x, point.z - road.position.z) < road.width / 2 + 7
            && road.position.y > point.y - 7 && road.position.y < point.y + height);
          if (!overlaps) rockMatrices.push(new Matrix4().makeRotationY(station * 1.7).scale(new Vector3(4.5, height, 5.5)).setPosition(point.x, point.y + height / 2 - 3, point.z));
        }
        const coral = center.clone().addScaledVector(side, sign * (halfWidth + 4.5));coral.y -= 5.5;
        coralMatrices.push(new Matrix4().makeRotationY(station * 2.1).scale(new Vector3(1.2, 1 + station % 3 * 0.3, 1.2)).setPosition(coral));
      }
    }
    const fishGeometry = new BufferGeometry();fishGeometry.setAttribute("position", new Float32BufferAttribute([
      0.8, 0, 0, 0, 0.23, 0, -0.55, 0, 0, 0.8, 0, 0, -0.55, 0, 0, 0, -0.23, 0,
      -0.45, 0, 0, -0.95, 0.35, 0, -0.95, -0.35, 0,
    ], 3));
    const fishMaterial = new MeshBasicMaterial({ vertexColors: false, side: DoubleSide, color: 0xffffff, fog: true });
    fishMaterial.onBeforeCompile = shader => {
      shader.uniforms.reefTime = this.time;
      shader.vertexShader = "uniform float reefTime;\n" + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float phase=instanceMatrix[3].z*0.015;
        transformed.x+=sin(reefTime*0.6+phase)*5.0;
        transformed.y+=sin(reefTime*0.9+phase)*0.6;
        transformed.z+=sin(reefTime*8.0+position.x*4.0+phase)*0.09;`);
    };
    const fish = new InstancedMesh(fishGeometry, fishMaterial, fishMatrices.length);fish.name = "rift-swimming-fish-schools";
    fishMatrices.forEach((matrix, index) => { fish.setMatrixAt(index, matrix);fish.setColorAt(index, new Color([0xc28cc8, 0x9bc9df, 0x9c8fc9, 0x6ac0d5][index % 4])); });
    fish.computeBoundingSphere();this.add(fish);
    const rocks = new InstancedMesh(new ConeGeometry(1, 1, 6, 2), new MeshStandardMaterial({ color: 0x276587, roughness: 1,
      emissive: 0x062b44, emissiveIntensity: 0.35, flatShading: true }), rockMatrices.length);
    rocks.name = "rift-underwater-reef-spires";rockMatrices.forEach((matrix, index) => rocks.setMatrixAt(index, matrix));rocks.computeBoundingSphere();this.add(rocks);
    const branches: number[] = [];
    for (let branch = 0; branch < 8; branch++) {
      const height = 1 + branch * 0.35;const x = Math.sin(branch * 2.4) * (0.4 + branch * 0.12);
      branches.push(-0.08, 0, 0, 0.08, 0, 0, x + 0.06, height, 0,
        -0.08, 0, 0, x + 0.06, height, 0, x - 0.06, height, 0);
    }
    const coralGeometry = new BufferGeometry();coralGeometry.setAttribute("position", new Float32BufferAttribute(branches, 3));
    const coral = new InstancedMesh(coralGeometry, new MeshBasicMaterial({ color: 0xa580be, side: DoubleSide }), coralMatrices.length);
    coral.name = "rift-underwater-sea-fans";coralMatrices.forEach((matrix, index) => coral.setMatrixAt(index, matrix));coral.computeBoundingSphere();this.add(coral);
    const bubbleGeometry = new BufferGeometry();bubbleGeometry.setAttribute("position", new Float32BufferAttribute(bubbles, 3));
    bubbleGeometry.setAttribute("bubbleSeed", new Float32BufferAttribute(seeds, 1));
    const bubbleCloud = new Points(bubbleGeometry, new ShaderMaterial({ transparent: true, depthWrite: false, fog: true,
      uniforms: UniformsUtils.merge([UniformsLib.fog, { reefTime: this.time }]),
      vertexShader: `uniform float reefTime;attribute float bubbleSeed;varying float vAlpha;
        #include <fog_pars_vertex>
        void main(){float age=fract(reefTime*0.16+bubbleSeed);vec3 p=position;p.y+=age*15.0;
          p.x+=sin(age*7.0+bubbleSeed*20.0)*0.35;p.z+=cos(age*6.0+bubbleSeed*15.0)*0.35;
          vec4 mvPosition=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mvPosition;
          gl_PointSize=clamp((0.18+bubbleSeed*0.28)*650.0/max(1.0,-mvPosition.z),1.0,22.0);
          vAlpha=sin(age*3.14159)*(1.0-smoothstep(55.0,95.0,-mvPosition.z));
          #include <fog_vertex>
        }`,
      fragmentShader: `varying float vAlpha;
        #include <fog_pars_fragment>
        void main(){vec2 p=gl_PointCoord-0.5;float r=length(p);if(r>0.49)discard;
          float rim=exp(-pow((r-0.37)*29.0,2.0));float shine=exp(-dot(p-vec2(-0.14,0.15),p-vec2(-0.14,0.15))*150.0);
          gl_FragColor=vec4(0.6,0.92,1.0,(rim*0.52+shine*0.65)*vAlpha);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }` }));
    bubbleCloud.material.uniforms.reefTime = this.time;
    bubbleCloud.name = "rift-underwater-bubble-columns";bubbleCloud.frustumCulled = false;this.add(bubbleCloud);
  }

  update(time: number): void { this.time.value = time; }
}
