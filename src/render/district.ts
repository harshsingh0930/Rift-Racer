import { BoxGeometry, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Raycaster, Vector3, type Material } from "three";
import { sampleTrackPosition, sampleTrackSection, sampleTrackTangent, sampleTrackWidth, type TrackRoute } from "../game/track";
import type { QualityTier } from "../game/performance";
import { fadeArchitecture } from "./architecture";
import { detailTexture, sceneryTexture } from "./texture-assets";

const UP = new Vector3(0, 1, 0);

type Batch = { geometry: BufferGeometry; material: Material; matrices: Matrix4[]; name: string };

/** Close, grounded streets in small batches, with an open seaward promenade. */
export function createRoadsideDistrict(route: TrackRoute, quality: QualityTier, palm: Group, lamp: Group): Group {
  const district = new Group();
  district.name = "rift-roadside-district";
  const facade = sceneryTexture("facade");
  const facadeMaterial = new MeshStandardMaterial({ name: "rift-textured-facades", map: facade,
    emissiveMap: facade, emissive: 0xb9a2d6, emissiveIntensity: 0.38, roughness: 0.86, metalness: 0.04 });
  facadeMaterial.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec3 blockSize=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        vec2 facadeScale=vec2(abs(normal.x)>0.5?blockSize.z:blockSize.x,blockSize.y)/vec2(16.0,24.0);
        #ifdef USE_MAP
          vMapUv*=facadeScale;
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv*=facadeScale;
        #endif
      #endif`);
  };
  facadeMaterial.customProgramCacheKey = () => "rift-facade-metres-v1";
  const pavementMaterial = new MeshStandardMaterial({ name: "rift-promenade-concrete", map: detailTexture("concrete"),
    color: 0x77718b, roughness: 0.95, side: DoubleSide });
  const cliffMaterial = new MeshStandardMaterial({ name: "rift-violet-cliff-material", map: detailTexture("reef"),
    color: 0x61355f, emissive: 0x180b27, emissiveIntensity: 0.3, roughness: 0.95, flatShading: true, side: DoubleSide });
  const trimMaterial = new MeshBasicMaterial({ color: new Color(0xff8b55).multiplyScalar(1.4) });
  const roofMaterial = new MeshStandardMaterial({ color: 0x292034, roughness: 0.9 });
  fadeArchitecture(roofMaterial);
  fadeArchitecture(facadeMaterial);fadeArchitecture(trimMaterial);
  const block = new BoxGeometry(1, 1, 1);
  const rotation = new Quaternion();
  const matrix = new Matrix4();
  const chunkSize = 48;
  const groundingRay = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 3);

  const safeFootprint = (position: Vector3, radius: number, height: number): boolean => route.points.every((point) =>
    point.position.y < position.y - 0.7 || point.position.y > position.y + height + 1
      || Math.hypot(position.x - point.position.x, position.z - point.position.z) > point.width * 0.5 + radius,
  );
  const crossesOtherRoad = (position: Vector3, distance: number): boolean => route.points.some((point, index) => {
    const along = Math.abs(route.segments[index].startDistance - distance);
    if (Math.min(along, route.totalLength - along) < 50) return false;
    return Math.abs(point.position.y - position.y) < 10
      && Math.hypot(point.position.x - position.x, point.position.z - position.z) < point.width * 0.5 + 1.5;
  });

  for (let start = 0; start < route.totalLength; start += chunkSize) {
    const chunk = new Group();
    chunk.name = "rift-district-chunk";chunk.userData.routeDistance = start + 24;
    const batches = new Map<string, Batch>();
    const add = (geometry: BufferGeometry, material: Material, transform: Matrix4, name: string) => {
      const key = geometry.uuid + material.uuid;
      const batch = batches.get(key) ?? { geometry, material, matrices: [], name };
      batch.matrices.push(transform.clone());
      batches.set(key, batch);
    };
    const prop = (template: Group, position: Vector3, yaw: number, scale: number) => {
      const copy = template.clone();
      copy.position.copy(position);
      copy.rotation.y = yaw;
      copy.scale.setScalar(scale);
      copy.updateMatrixWorld(true);
      copy.traverse((object) => {
        if (object instanceof Mesh && !Array.isArray(object.material)) add(object.geometry, object.material, object.matrixWorld, template.name);
      });
    };

    const floorPositions: number[] = [];
    const floorUvs: number[] = [];
    const floorIndices: number[] = [];
    for (const segment of route.segments) {
      if (segment.startDistance < start || segment.startDistance >= start + chunkSize) continue;
      if (segment.section !== "coastal-boulevard" && segment.section !== "final-skyline") continue;
      if (segment.section === "final-skyline" && segment.start.position.y < 0.8) continue;
      for (const sign of [-1, 1]) {
        const width = segment.section === "coastal-boulevard" && sign === 1 ? 5 : 18;
        const corners: Vector3[] = [];
        for (const point of [segment.start, segment.end]) {
          const index = route.points.indexOf(point);
          const previous = route.points[(index - 1 + route.points.length) % route.points.length];
          const next = route.points[(index + 1) % route.points.length];
          const side = new Vector3().crossVectors(UP, next.position.clone().sub(previous.position)).normalize();
          for (const offset of [point.width * 0.5 + 1.1, point.width * 0.5 + width]) {
            const position = point.position.clone().addScaledVector(side, sign * offset);
            position.y -= 0.14;
            corners.push(position);
          }
        }
        if (corners.some((corner) => crossesOtherRoad(corner, segment.startDistance))) continue;
        const base = floorPositions.length / 3;
        for (const position of corners) {
          floorPositions.push(...position.toArray());
          floorUvs.push(position.x * 0.12, position.z * 0.12);
        }
        floorIndices.push(...(sign === 1 ? [base, base + 2, base + 1, base + 1, base + 2, base + 3]
          : [base, base + 1, base + 2, base + 1, base + 3, base + 2]));
      }
    }
    if (floorPositions.length) {
      const floor = new BufferGeometry();
      floor.setAttribute("position", new Float32BufferAttribute(floorPositions, 3));
      floor.setAttribute("uv", new Float32BufferAttribute(floorUvs, 2));
      floor.setIndex(floorIndices);floor.computeVertexNormals();floor.computeBoundingSphere();
      const platform = new Mesh(floor, pavementMaterial);
      platform.name = "rift-roadside-platform";platform.receiveShadow = true;
      chunk.add(platform);
    }

    const cliffPositions: number[] = [];
    const cliffUvs: number[] = [];
    const cliffIndices: number[] = [];
    for (const segment of route.segments) {
      if (segment.startDistance < Math.max(start, 155) || segment.startDistance >= start + chunkSize
        || segment.section !== "coastal-boulevard") continue;
      const corners: Vector3[] = [];
      for (const point of [segment.start, segment.end]) {
        const tangent = segment.end.position.clone().sub(segment.start.position);
        const side = new Vector3().crossVectors(UP, tangent).normalize();
        const near = point.position.clone().addScaledVector(side, -(point.width * 0.5 + 20));
        near.y -= 0.45;
        const ledge = point.position.clone().addScaledVector(side, -(point.width * 0.5 + 22));
        ledge.y += 8 + Math.sin(point.position.x * 0.08) * 2;
        const ridge = point.position.clone().addScaledVector(side, -(point.width * 0.5 + 29));
        ridge.y += 15 + Math.sin(point.position.z * 0.05) * 3;
        corners.push(near, ledge, ridge);
      }
      if (corners.some((point) => crossesOtherRoad(point, segment.startDistance))) continue;
      const base = cliffPositions.length / 3;
      for (let index = 0; index < corners.length; index += 1) {
        cliffPositions.push(...corners[index].toArray());
        cliffUvs.push((segment.startDistance + (index > 2 ? segment.length : 0)) * 0.06, index % 3 * 0.9);
      }
      cliffIndices.push(base, base + 3, base + 1, base + 1, base + 3, base + 4,
        base + 1, base + 4, base + 2, base + 2, base + 4, base + 5);
    }
    if (cliffPositions.length) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(cliffPositions, 3));
      geometry.setAttribute("uv", new Float32BufferAttribute(cliffUvs, 2));
      geometry.setIndex(cliffIndices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
      const cliff = new Mesh(geometry, cliffMaterial);cliff.name = "rift-coastal-cliff";
      chunk.add(cliff);
    }

    for (let distance = start + 7; distance < Math.min(start + chunkSize, route.totalLength); distance += 14) {
      const section = sampleTrackSection(route, distance);
      if (section === "tunnel" || section === "underwater" || section === "cliff-dive") continue;
      const center = sampleTrackPosition(route, distance);
      const tangent = sampleTrackTangent(route, distance);
      const side = new Vector3().crossVectors(UP, tangent).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);
      const halfWidth = sampleTrackWidth(route, distance) * 0.5;
      const station = Math.floor(distance / 14);
      const skyline = section === "final-skyline";
      if (section !== "causeway" && (!skyline || center.y >= 0.8)) {
        for (const sign of skyline ? [-1, 1] : [-1]) {
          const depth = 5.5 + station % 3;
          const width = 8 + station % 4;
          const height = (skyline ? 13 : 7.5) + station % 4 * 3.2;
          const position = center.clone().addScaledVector(side, sign * (halfWidth + 4 + depth * 0.5));
          position.y -= 0.14;
          if (!safeFootprint(position, Math.hypot(width, depth) * 0.5, height)) continue;
          const platform = chunk.getObjectByName("rift-roadside-platform");
          if (!platform) continue;
          groundingRay.ray.origin.copy(position).addScaledVector(UP, 1);
          const support = groundingRay.intersectObject(platform, false)[0];
          if (!support) continue;
          position.y = support.point.y;
          rotation.setFromAxisAngle(UP, yaw);
          matrix.compose(position.clone().addScaledVector(UP, height * 0.5), rotation, new Vector3(width, height, depth));
          add(block, facadeMaterial, matrix, "rift-grounded-buildings");
          const roof = position.clone().addScaledVector(UP, height + 0.08);
          matrix.compose(roof, rotation, new Vector3(width + 0.15, 0.14, depth + 0.15));
          add(block, roofMaterial, matrix, "rift-building-roof-cap");
          const roofEdge = roof.clone().addScaledVector(side, -sign * depth * 0.5);
          matrix.compose(roofEdge, rotation, new Vector3(width + 0.15, 0.06, 0.055));
          add(block, trimMaterial, matrix, "rift-building-roof-trim");
          // A solid plinth visibly connects the block to the promenade.
          matrix.compose(position.clone().addScaledVector(UP, -0.18), rotation, new Vector3(width + 0.4, 0.36, depth + 0.4));
          add(block, pavementMaterial, matrix, "rift-building-ground-plinths");
        }
      }
      if (station % 2 === 0) {
        const lampSide = station % 4 === 0 ? 1 : -1;
        const position = center.clone().addScaledVector(side, lampSide * (halfWidth + 1.25));
        prop(lamp, position, Math.atan2(-lampSide * side.x, -lampSide * side.z), 1);
      }
    }

    for (const batch of batches.values()) {
      const mesh = new InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
      mesh.name = batch.name;
      batch.matrices.forEach((transform, index) => mesh.setMatrixAt(index, transform));
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      chunk.add(mesh);
    }
    if (chunk.children.length) district.add(chunk);
  }
  return district;
}
