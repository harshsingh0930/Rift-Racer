import { BoxGeometry, Box3, BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { getDiveLayout } from "../game/cliff-dive";
import { sampleTrackPosition, sampleTrackSection, sampleTrackTangent, sampleTrackWidth, type TrackRoute } from "../game/track";
import type { QualityTier } from "../game/performance";
import { detailTexture, sceneryTexture } from "./texture-assets";

function canopyGeometry(cell: number): BufferGeometry {
  const positions: number[] = [];const uvs: number[] = [];const indices: number[] = [];
  const left = cell % 2 * 0.5 + 0.004;const bottom = (cell < 2 ? 0.5 : 0) + 0.004;
  for (let plane = 0; plane < 3; plane++) {
    const angle = plane * Math.PI / 3;const base = positions.length / 3;
    for (const [x, y, u, v] of [[-0.5, -0.5, 0, 0], [0.5, -0.5, 1, 0], [0.5, 0.5, 1, 1], [-0.5, 0.5, 0, 1]]) {
      positions.push(x * Math.cos(angle), y, x * Math.sin(angle));uvs.push(left + u * 0.492, bottom + v * 0.492);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

/** Irregular planted pockets in architectural gaps; never a continuous row. */
export function createRoadsidePlants(route: TrackRoute, quality: QualityTier, district: Group): Group {
  const root = new Group();root.name = "rift-dense-roadside-plants";
  const time = { value: 0 };root.userData.time = time;
  const atlas = sceneryTexture("foliage");const geometries = [0, 1, 2, 3].map(canopyGeometry);
  const leafMaterials = [0x9ca1c1, 0xb997c8, 0xd8a2b4, 0x9297b3].map(color => {
    const material = new MeshStandardMaterial({ color, map: atlas, alphaTest: 0.42, side: DoubleSide,
      roughness: 1, emissiveMap: atlas, emissive: 0x28203d, emissiveIntensity: 0.22 });
    material.onBeforeCompile = shader => {
      shader.uniforms.foliageTime = time;
      shader.vertexShader = 'uniform float foliageTime;\n' + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.x += sin(foliageTime*1.4+position.y*3.0+instanceMatrix[3].x)*0.025*(position.y+0.5);');
    };
    return material;
  });
  const bark = new MeshStandardMaterial({ color: 0x514054, map: detailTexture("bark"), roughness: 1 });
  const stone = new MeshStandardMaterial({ color: 0x403447, roughness: 0.95 });
  const trunkGeometry = new CylinderGeometry(0.065, 0.12, 1, 7);
  const stoneGeometry = new BoxGeometry(1, 1, 1);
  const buildings: Box3[] = [];const matrix = new Matrix4();
  district.traverse(object => {
    if (!(object instanceof InstancedMesh) || object.name !== "rift-grounded-buildings") return;
    object.geometry.computeBoundingBox();
    for (let i = 0; i < object.count; i++) { object.getMatrixAt(i, matrix);buildings.push(object.geometry.boundingBox!.clone().applyMatrix4(matrix).expandByScalar(4)); }
  });
  let seed = 4187;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;return seed / 4294967296; };
  const up = new Vector3(0, 1, 0);const rotation = new Quaternion();const dive = getDiveLayout(route);
  const spacing = quality === "eco" ? 27 : 22;
  for (let start = 0; start < route.totalLength; start += 48) {
    const leaves: Matrix4[][] = [[], [], [], []];const trunks: Matrix4[] = [];const bases: Matrix4[] = [];
    const chunk = new Group();chunk.name = "rift-planted-verge-chunk";chunk.userData.routeDistance = start + 24;
    for (let anchor = Math.ceil(start / spacing) * spacing; anchor < Math.min(route.totalLength, start + 48); anchor += spacing) {
      const distance = Math.max(start, Math.min(start + 47, anchor + (random() - 0.5) * 12));
      const section = sampleTrackSection(route, distance);
      if (section === "underwater" || section === "cliff-dive" || (section === "tunnel" && (!dive || distance < dive.approachStart)) || random() < 0.33) continue;
      const center = sampleTrackPosition(route, distance);if (center.y < -0.5) continue;
      const tangent = sampleTrackTangent(route, distance);const side = new Vector3().crossVectors(up, tangent).normalize();
      const sign = random() < 0.5 ? -1 : 1;
      const position = center.clone().addScaledVector(side, sign * (sampleTrackWidth(route, distance) / 2 + 2.7 + random() * 1.4));
      if (buildings.some(building => building.distanceToPoint(position) < 1)) continue;
      const obstructs = route.points.some((point, index) => {
        const gap = Math.abs(route.segments[index].startDistance - distance);
        return Math.min(gap, route.totalLength - gap) > 45 && Math.abs(point.position.y - center.y) < 7
          && Math.hypot(point.position.x - position.x, point.position.z - position.z) < point.width / 2 + 3;
      });
      if (obstructs) continue;
      const yaw = random() * Math.PI * 2;rotation.setFromAxisAngle(up, yaw);
      const scale = 0.85 + random() * 0.42;
      const kind = random() < 0.34 ? 1 : random() < 0.46 ? 2 : 3;
      // Only a small supporting island on bridges; city sidewalks stay unobstructed.
      matrix.compose(position.clone().addScaledVector(up, -0.24), rotation, new Vector3(4.6, 0.45, 5.8));bases.push(matrix.clone());
      const height = (kind === 3 ? 4.5 : 3.0) * scale;
      const trunkRotation = new Quaternion().setFromAxisAngle(new Vector3(Math.cos(yaw), 0, Math.sin(yaw)), (random() - 0.5) * 0.14);
      matrix.compose(position.clone().addScaledVector(up, height / 2), trunkRotation, new Vector3(scale, height, scale));trunks.push(matrix.clone());
      for (let crown = 0; crown < (kind === 3 ? 3 : 4); crown++) {
        const angle = yaw + crown * 2.399963;
        const crownPosition = position.clone().add(new Vector3(Math.cos(angle) * (kind === 3 ? 0.65 : 0.9), height + (crown % 2) * 0.55, Math.sin(angle) * 0.8));
        const size = (kind === 3 ? 2.5 : 2.25) * scale;
        rotation.setFromAxisAngle(up, angle);matrix.compose(crownPosition, rotation, new Vector3(size, size * (kind === 3 ? 0.85 : 0.95), size));leaves[kind].push(matrix.clone());
        if (kind !== 3) {
          const branchDirection = crownPosition.clone().sub(position.clone().addScaledVector(up, height * 0.55));
          const branchLength = branchDirection.length();const branchRotation = new Quaternion().setFromUnitVectors(up, branchDirection.normalize());
          matrix.compose(position.clone().addScaledVector(up, height * 0.55).add(crownPosition).multiplyScalar(0.5), branchRotation, new Vector3(0.7, branchLength, 0.7));trunks.push(matrix.clone());
        }
      }
      for (let shrub = 0; shrub < 1 + Math.floor(random() * 3); shrub++) {
        const point = position.clone().addScaledVector(tangent, (random() - 0.5) * 5).addScaledVector(side, (random() - 0.5) * 1.2);point.y += 0.65;
        const size = 1.0 + random() * 0.8;rotation.setFromAxisAngle(up, random() * Math.PI);
        matrix.compose(point, rotation, new Vector3(size * 1.3, size, size * 1.3));leaves[0].push(matrix.clone());
      }
    }
    for (const [kind, transforms] of leaves.entries()) {
      if (!transforms.length) continue;
      const mesh = new InstancedMesh(geometries[kind], leafMaterials[kind], transforms.length);
      mesh.name = ["rift-textured-shrubs", "rift-cherry-canopy", "rift-maple-canopy", "rift-palm"][kind];
      transforms.forEach((transform, index) => mesh.setMatrixAt(index, transform));mesh.computeBoundingSphere();chunk.add(mesh);
    }
    for (const [name, geometry, material, transforms] of [["rift-textured-tree-trunks", trunkGeometry, bark, trunks], ["rift-planted-island", stoneGeometry, stone, bases]] as const) {
      if (!transforms.length) continue;
      const mesh = new InstancedMesh(geometry, material, transforms.length);mesh.name = name;
      transforms.forEach((transform, i) => mesh.setMatrixAt(i, transform));mesh.computeBoundingSphere();chunk.add(mesh);
    }
    if (chunk.children.length) root.add(chunk);
  }
  return root;
}
