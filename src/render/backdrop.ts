import { Box3, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import type { TrackRoute } from "../game/track";

/** Fixed layered coastal massifs, baked once and kept outside every road. */
export function createMountainBackdrop(route: TrackRoute): Group {
  const group = new Group();group.name = "rift-static-mountain-backdrop";
  group.userData.dynamicVisibility = true;
  const bounds = new Box3().setFromPoints(route.points.map(point => point.position));
  const center = bounds.getCenter(new Vector3());
  const radius = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 0.5 + 185;
  for (let layer = 0; layer < 3; layer++) {
    const vertices: number[] = [];const colors: number[] = [];const indices: number[] = [];
    const palette = [0x332343, 0x503251, 0x75465f];
    // Leave a broad sea/sunset opening to the east rather than walling in the sky.
    for (let step = 0; step <= 72; step++) {
      const t = step / 72;const angle = 0.52 + t * Math.PI * 1.48;
      const r = radius + layer * 72 + Math.sin(step * 1.47) * 12;
      const peak = 24 + layer * 9 + Math.abs(Math.sin(step * 0.43 + layer) * Math.cos(step * 0.16)) * (68 - layer * 9);
      for (const [height, multiplier] of [[-18, 0.50], [peak * 0.37, 0.75], [peak, 1]]) {
        const inset = height === -18 ? 25 : height === peak ? -12 : 0;
        vertices.push(center.x + Math.cos(angle) * (r + inset), height, center.z + Math.sin(angle) * (r + inset));
        const color = new Color(palette[layer]).multiplyScalar(multiplier);
        colors.push(color.r, color.g, color.b);
      }
      if (step < 72) for (let band = 0; band < 2; band++) {
        const a = step * 3 + band;indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
    const geometry = new BufferGeometry();geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));geometry.setIndex(indices);
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, fog: false }));
    mesh.name = layer === 0 ? "rift-static-sea-cliffs" : "rift-static-mountain-ridge";group.add(mesh);
  }
  return group;
}
