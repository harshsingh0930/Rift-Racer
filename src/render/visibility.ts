import { Box3, BufferGeometry, Color, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh, Object3D, Sphere, Sprite, Vector3 } from "three";
import { findNearestTrackPoint, type TrackRoute, type Vector3Like } from "../game/track";
import type { QualityTier } from "../game/performance";

const LARGE_SURFACES = new Set([
  "rift-dark-road", "rift-road-shoulder-right", "rift-road-shoulder-left", "rift-coastal-ground",
  "rift-tunnel-shell", "rift-underwater-glass-tube", "rift-underwater-caustic-bands",
  "rift-underwater-structural-deck", "rift-underwater-reef-bed", "rift-glass-tunnel-longitudinal-frame",
]);

function partitionSurface(mesh: Mesh, route: TrackRoute): Mesh[] {
  const source = mesh.geometry;
  const positions = source.getAttribute("position");
  const indices = source.index;
  if (!positions || !indices || indices.count < 300) return [mesh];
  const groups = new Map<number, number[]>();
  const primitiveSize = mesh.name.includes("shoulder") ? 24 : 6;
  const point = new Vector3();
  for (let offset = 0; offset < indices.count; offset += primitiveSize) {
    point.fromBufferAttribute(positions, indices.getX(offset));
    const bucket = Math.floor(findNearestTrackPoint(route, point).distanceAlongTrack / 48);
    const selected = groups.get(bucket) ?? [];
    for (let cursor = offset; cursor < Math.min(indices.count, offset + primitiveSize); cursor += 1) selected.push(indices.getX(cursor));
    groups.set(bucket, selected);
  }
  if (groups.size < 2) return [mesh];
  const chunks: Mesh[] = [];
  for (const [bucket, selected] of groups) {
    const geometry = new BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) {
      const values = new Float32Array(selected.length * attribute.itemSize);
      selected.forEach((index, offset) => {
        for (let component = 0; component < attribute.itemSize; component += 1) {
          values[offset * attribute.itemSize + component] = attribute.getComponent(index, component);
        }
      });
      geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize));
    }
    geometry.setIndex(Array.from({ length: selected.length }, (_, index) => index));
    geometry.computeBoundingSphere();
    if (chunks.length === 0) {
      mesh.geometry = geometry;
      chunks.push(mesh);
    } else {
      const chunk = new Mesh(geometry, mesh.material);
      chunk.name = `${mesh.name}-chunk-${bucket}`;
      chunk.position.copy(mesh.position);chunk.quaternion.copy(mesh.quaternion);chunk.scale.copy(mesh.scale);
      chunk.castShadow = mesh.castShadow;chunk.receiveShadow = mesh.receiveShadow;chunk.renderOrder = mesh.renderOrder;
      mesh.parent?.add(chunk);
      chunks.push(chunk);
    }
  }
  source.dispose();
  return chunks;
}

/** A single instanced batch spanning the map cannot be distance culled. */
function partitionInstances(mesh: InstancedMesh): void {
  if (mesh.count < 2 || mesh.name.startsWith("rift-airborne")) return;
  mesh.computeBoundingSphere();
  if (!mesh.boundingSphere || mesh.boundingSphere.radius < 70) return;
  const cells = new Map<string, Array<{ matrix: Matrix4; color?: Color }>>();
  const position = new Vector3();
  for (let index = 0; index < mesh.count; index += 1) {
    const matrix = new Matrix4();mesh.getMatrixAt(index, matrix);
    position.setFromMatrixPosition(matrix);
    const key = `${Math.floor(position.x / 48)},${Math.floor(position.z / 48)}`;
    const cell = cells.get(key) ?? [];
    const color = mesh.instanceColor ? new Color() : undefined;
    if (color) mesh.getColorAt(index, color);
    cell.push({ matrix, color });cells.set(key, cell);
  }
  let first = true;
  for (const [key, instances] of cells) {
    const cell = first ? mesh : new InstancedMesh(mesh.geometry, mesh.material, instances.length);
    if (!first) {
      cell.name = `${mesh.name}-cell-${key}`;
      cell.position.copy(mesh.position);cell.quaternion.copy(mesh.quaternion);cell.scale.copy(mesh.scale);
      cell.castShadow = mesh.castShadow;cell.receiveShadow = mesh.receiveShadow;cell.renderOrder = mesh.renderOrder;
      mesh.parent?.add(cell);
    }
    cell.count = instances.length;
    instances.forEach((instance, index) => {
      cell.setMatrixAt(index, instance.matrix);
      if (instance.color) cell.setColorAt(index, instance.color);
    });
    cell.instanceMatrix.needsUpdate = true;
    if (cell.instanceColor) cell.instanceColor.needsUpdate = true;
    cell.boundingBox = null;cell.boundingSphere = null;
    cell.computeBoundingSphere();
    first = false;
  }
}

/** Spatial culling also preserves nearby flyovers on distant parts of the lap. */
export class LocalSceneVisibility {
  private readonly items: Array<{ object: Object3D; bounds: Sphere }> = [];
  readonly radius: number;
  visibleCount = 0;

  constructor(root: Object3D, route: TrackRoute, quality: QualityTier) {
    this.radius = quality === "eco" ? 110 : quality === "balanced" ? 140 : 160;
    const surfaces: Mesh[] = [];
    root.traverse((object) => {
      if (object instanceof Mesh && LARGE_SURFACES.has(object.name)) surfaces.push(object);
    });
    surfaces.forEach((mesh) => partitionSurface(mesh, route));
    const batches: InstancedMesh[] = [];
    root.traverse((object) => { if (object instanceof InstancedMesh) batches.push(object); });
    batches.forEach(partitionInstances);
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      // Animated breakaway timber owns its visibility and moves beyond its
      // initial bounds. The landmark updates it after this static cull pass.
      for (let ancestor: Object3D | null = object; ancestor; ancestor = ancestor.parent) {
        if (ancestor.userData.dynamicVisibility) return;
      }
      if (object.parent?.name === "rift-synthwave-sun" || object.name.startsWith("rift-sunset") || object.name === "rift-gradient-sky"
        || object.name === "rift-coastal-water-surface" || object.name === "rift-seabed") return;
      if (!(object instanceof Mesh) && !(object instanceof Sprite)) return;
      if (object instanceof InstancedMesh) object.computeBoundingSphere();
      const box = new Box3().setFromObject(object);
      if (!box.isEmpty()) this.items.push({ object, bounds: box.getBoundingSphere(new Sphere()) });
    });
  }

  update(position?: Vector3Like): void {
    this.visibleCount = 0;
    for (const item of this.items) {
      const sphere = item.bounds;
      item.object.visible = !position || (position.x - sphere.center.x) ** 2
        + (position.y - sphere.center.y) ** 2 + (position.z - sphere.center.z) ** 2
        <= (this.radius + sphere.radius + 4) ** 2;
      if (item.object.visible) this.visibleCount += 1;
    }
  }

  get totalCount(): number { return this.items.length; }
}
