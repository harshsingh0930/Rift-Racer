import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from "three";
import { getDiveLayout } from "../game/cliff-dive";
import { sampleTrackPosition, sampleTrackSection, sampleTrackTangent, sampleTrackWidth, type TrackRoute } from "../game/track";
import type { QualityTier } from "../game/performance";

/** Close planted verges, including bridge planters, in independently culled 48 m batches. */
export function createRoadsidePlants(route: TrackRoute, quality: QualityTier, palm: Group): Group {
  const root = new Group();root.name = "rift-dense-roadside-plants";
  const leaf = new MeshStandardMaterial({ color: 0x245849, emissive: 0x0a1c20, emissiveIntensity: 0.35, roughness: 0.95, flatShading: true });
  const planter = new MeshStandardMaterial({ color: 0x393247, roughness: 0.9 });
  const shrubGeometry = new SphereGeometry(1, 7, 5);const planterGeometry = new BoxGeometry(1, 1, 1);
  const palmMesh = palm.children.find(child => child instanceof Mesh) as Mesh;
  const matrix = new Matrix4();const rotation = new Quaternion();const up = new Vector3(0, 1, 0);
  const dive = getDiveLayout(route);const spacing = quality === "eco" ? 12 : quality === "balanced" ? 9 : 8;
  for (let start = 0; start < route.totalLength; start += 48) {
    const palms: Matrix4[] = [];const shrubs: Matrix4[] = [];const bases: Matrix4[] = [];
    for (let distance = Math.ceil(start / spacing) * spacing; distance < Math.min(route.totalLength, start + 48); distance += spacing) {
      const section = sampleTrackSection(route, distance);
      if (section === "underwater" || section === "cliff-dive" || (section === "tunnel" && (!dive || distance < dive.approachStart))) continue;
      const center = sampleTrackPosition(route, distance);if (center.y < -0.5) continue;
      const tangent = sampleTrackTangent(route, distance);const side = new Vector3().crossVectors(up, tangent).normalize();
      const station = Math.round(distance / spacing);rotation.setFromAxisAngle(up, Math.atan2(tangent.x, tangent.z));
      for (const sign of [-1, 1]) {
        const offset = sampleTrackWidth(route, distance) / 2 + 2.5;
        const position = center.clone().addScaledVector(side, sign * offset);
        const obstructs = route.points.some((point, index) => {
          const gap = Math.abs(route.segments[index].startDistance - distance);
          if (Math.min(gap, route.totalLength - gap) < 45) return false;
          return Math.abs(point.position.y - center.y) < 6
            && Math.hypot(point.position.x - position.x, point.position.z - position.z) < point.width / 2 + 2;
        });
        if (obstructs) continue;
        // Planter slabs extend into the shoulder, visibly supporting bridge vegetation.
        matrix.compose(position.clone().addScaledVector(up, -0.2), rotation, new Vector3(3.2, 0.48, spacing * 0.78));bases.push(matrix.clone());
        const scale = 0.95 + (station % 4) * 0.10;
        const palmRotation = new Quaternion().setFromAxisAngle(up, station * 1.27 + sign);
        matrix.compose(position.clone().addScaledVector(up, 0.08), palmRotation, new Vector3(scale, scale, scale));palms.push(matrix.clone());
        for (const along of [-spacing * 0.30, spacing * 0.29]) {
          const shrub = position.clone().addScaledVector(tangent, along);shrub.y += 0.48;
          matrix.compose(shrub, rotation, new Vector3(1.05, 0.65 + station % 3 * 0.13, 1.35));shrubs.push(matrix.clone());
        }
      }
    }
    if (!palms.length) continue;
    const chunk = new Group();chunk.name = "rift-planted-verge-chunk";
    for (const [name, geometry, material, transforms] of [
      ["rift-verge-palms", palmMesh.geometry, palmMesh.material, palms],
      ["rift-verge-shrubs", shrubGeometry, leaf, shrubs],
      ["rift-verge-planters", planterGeometry, planter, bases],
    ] as const) {
      const mesh = new InstancedMesh(geometry, material, transforms.length);mesh.name = name;
      transforms.forEach((transform, index) => mesh.setMatrixAt(index, transform));mesh.computeBoundingSphere();
      mesh.receiveShadow = true;chunk.add(mesh);
    }
    root.add(chunk);
  }
  return root;
}
