import { Box3, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Raycaster, Vector3 } from "three";
import { getDiveLayout } from "../game/cliff-dive";
import { sampleTrackPosition, sampleTrackTangent, sampleTrackWidth, type TrackRoute } from "../game/track";
import { detailTexture, sceneryTexture } from "./texture-assets";

const UP = new Vector3(0, 1, 0);

/** A rocky headland, planted roof terraces and a masonry tunnel mouth, baked once. */
export function createTunnelHeadland(route: TrackRoute): Group {
  const root = new Group();root.name = "rift-tunnel-headland";
  const first = route.segments.find(segment => segment.section === "tunnel");
  const dive = getDiveLayout(route);if (!first || !dive) return root;
  const start = first.startDistance;const end = dive.approachStart - 0.5;
  const offsets = [-1.0, -0.76, -0.48, -0.24, 0, 0.24, 0.48, 0.76, 1.0];
  const crossSection = (distance: number, across: number): Vector3 => {
    const center = sampleTrackPosition(route, distance);const tangent = sampleTrackTangent(route, distance);
    const side = new Vector3(tangent.z, 0, -tangent.x).normalize();
    const radius = sampleTrackWidth(route, distance) / 2 + 1.25;
    const width = radius + 13 + Math.sin(distance * 0.043) * 2;
    const heights = offsets.map(offset => offset === 0 ? center.y + radius + 5.5 + Math.sin(distance * 0.09) * 2
      : Math.abs(offset) < 0.49 ? center.y + radius + 2.5 + Math.sin(distance * 0.071 + offset * 7) * 1.3
      : Math.abs(offset) < 0.77 ? center.y + radius * 0.1 - 1.5 : Math.min(-4, center.y - 9));
    const column = Math.min(offsets.length - 2, Math.max(0, offsets.findIndex(offset => offset >= across) - 1));
    const blend = (across - offsets[column]) / (offsets[column + 1] - offsets[column]);
    const height = heights[column] + (heights[column + 1] - heights[column]) * blend;
    return center.addScaledVector(side, across * width).setY(height);
  };
  const positions: number[] = [];const colors: number[] = [];const uvs: number[] = [];
  const quads: Array<{ vertices: Vector3[]; distance: number }> = [];
  for (let distance = start; distance < end; distance += 8) {
    const next = Math.min(end, distance + 8);
    for (let column = 0; column < offsets.length - 1; column++) {
      const vertices = [crossSection(distance, offsets[column]), crossSection(distance, offsets[column + 1]),
        crossSection(next, offsets[column]), crossSection(next, offsets[column + 1])];
      const box = new Box3().setFromPoints(vertices);const midpoint = (distance + next) / 2;
      const crossesRoad = route.points.some((point, index) => {
        const gap = Math.abs(route.segments[index].startDistance - midpoint);
        if (Math.min(gap, route.totalLength - gap) < 48) return false;
        const margin = point.width / 2 + 2;
        return point.position.x >= box.min.x - margin && point.position.x <= box.max.x + margin
          && point.position.z >= box.min.z - margin && point.position.z <= box.max.z + margin
          && point.position.y + 7 >= box.min.y && point.position.y - 0.3 <= box.max.y;
      });
      if (!crossesRoad) quads.push({ vertices, distance });
    }
  }
  // Close the rock face around each opening, leaving a real arch-shaped hole.
  for (const distance of [start, end]) {
    const center = sampleTrackPosition(route, distance);
    const radius = sampleTrackWidth(route, distance) / 2 + 2.2;
    const edge = (across: number, lower: boolean): Vector3 => {
      const point = crossSection(distance, across);
      if (lower) {
        const horizontal = Math.hypot(point.x - center.x, point.z - center.z);
        point.y = horizontal < radius ? center.y + 0.2 + Math.sqrt(radius ** 2 - horizontal ** 2) : Math.min(-4, center.y - 9);
      }
      return point;
    };
    for (let step = 0; step < 48; step++) {
      const a = -1 + step / 24;const b = -1 + (step + 1) / 24;
      quads.push({ vertices: [edge(a, false), edge(b, false), edge(a, true), edge(b, true)], distance });
    }
  }
  for (const { vertices, distance } of quads) for (const index of [0, 2, 1, 1, 2, 3]) {
    const point = vertices[index];positions.push(point.x, point.y, point.z);uvs.push(point.x * 0.07, point.y * 0.07 + point.z * 0.025);
    const color = new Color().lerpColors(new Color(0x272039), new Color(0x66506a), 0.4 + Math.sin(distance * 0.12 + point.y * 0.2) * 0.2);
    colors.push(color.r, color.g, color.b);
  }
  const geometry = new BufferGeometry();geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));geometry.computeVertexNormals();
  const rock = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.95,
    emissive: 0x110b20, emissiveIntensity: 0.25, side: DoubleSide, flatShading: true }));
  rock.name = "rift-tunnel-rocky-headland";rock.receiveShadow = true;root.add(rock);

  const mouth = new Group();mouth.name = "rift-tunnel-stone-entrance";
  const position = sampleTrackPosition(route, start);const tangent = sampleTrackTangent(route, start);
  mouth.position.copy(position).addScaledVector(tangent, -0.6);
  mouth.rotation.set(-Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z)), Math.atan2(tangent.x, tangent.z), 0, "YXZ");
  const radius = sampleTrackWidth(route, start) / 2 + 2.5;
  const stone = new InstancedMesh(new BoxGeometry(1.55, 1.1, 1.7), new MeshStandardMaterial({ color: 0x66516c,
    map: detailTexture("concrete"), roughness: 0.9 }), 19);
  stone.name = "rift-tunnel-masonry-arch";const matrix = new Matrix4();const rotation = new Quaternion();
  for (let index = 0; index < 19; index++) {
    const angle = index / 18 * Math.PI;rotation.setFromAxisAngle(new Vector3(0, 0, 1), angle + Math.PI / 2);
    matrix.compose(new Vector3(Math.cos(angle) * radius, 0.2 + Math.sin(angle) * radius, 0), rotation, new Vector3(1, 1, 1));stone.setMatrixAt(index, matrix);
  }
  stone.computeBoundingSphere();mouth.add(stone);
  const beaconMaterial = new MeshBasicMaterial({ color: new Color(0xff9e48).multiplyScalar(2.5) });
  const dark = new MeshStandardMaterial({ color: 0x20172d, roughness: 0.8 });
  for (const sign of [-1, 1]) {
    const plinth = new Mesh(new BoxGeometry(1.3, 2.7, 1.2), dark);plinth.position.set(sign * (radius + 0.2), 1.35, -0.2);mouth.add(plinth);
    const beacon = new Mesh(new BoxGeometry(0.16, 1.75, 0.08), beaconMaterial);beacon.position.set(sign * (radius + 0.2), 1.65, -0.85);mouth.add(beacon);
  }
  root.add(mouth);

  // Sample the built triangles so plants never float above or disappear inside the ridge.
  root.updateMatrixWorld(true);
  const down = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  const surfacePoint = (distance: number, across: number): Vector3 | undefined => {
    const point = crossSection(distance, across);down.ray.origin.copy(point).setY(point.y + 80);
    return down.intersectObject(rock)[0]?.point;
  };
  const leaves: Matrix4[] = [];const trunks: Matrix4[] = [];const scale = new Vector3();
  for (let distance = start + 9, index = 0; distance < end - 12; distance += 22, index++) {
    const across = (index % 2 ? -1 : 1) * (0.14 + (index % 3) * 0.10);
    const point = surfacePoint(distance, across);if (!point) continue;
    rotation.setFromAxisAngle(UP, index * 2.4);
    const height = 3.8 + index % 3 * 0.65;
    matrix.compose(point.clone().add(new Vector3(0, height / 2, 0)), rotation, scale.set(1.6, height, 1.6));trunks.push(matrix.clone());
    for (let crown = 0; crown < 3; crown++) {
      const center = point.clone().add(new Vector3(Math.sin(crown * 2.4) * 1.3, height + crown % 2 * 0.7, Math.cos(crown * 2.4) * 1.3));
      matrix.compose(center, rotation, scale.set(6.5, 5, 6.5));leaves.push(matrix.clone());
    }
  }
  const leafGeometry = new BufferGeometry();leafGeometry.setAttribute("position", new Float32BufferAttribute([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    0, -0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5,
  ], 3));
  leafGeometry.setAttribute("uv", new Float32BufferAttribute([
    0.504, 0.504, 0.996, 0.504, 0.996, 0.996, 0.504, 0.996,
    0.504, 0.504, 0.996, 0.504, 0.996, 0.996, 0.504, 0.996,
  ], 2));leafGeometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);leafGeometry.computeVertexNormals();
  const canopy = new InstancedMesh(leafGeometry, new MeshStandardMaterial({ color: 0xb8a2c3, map: sceneryTexture("foliage"), alphaTest: 0.42,
    side: DoubleSide, roughness: 1 }), leaves.length);canopy.name = "rift-tunnel-rooftop-blossoms";
  leaves.forEach((transform, index) => canopy.setMatrixAt(index, transform));canopy.computeBoundingSphere();root.add(canopy);
  const stems = new InstancedMesh(new CylinderGeometry(0.065, 0.13, 1, 6), new MeshStandardMaterial({ color: 0x453447, roughness: 1 }), trunks.length);
  stems.name = "rift-tunnel-rooftop-trunks";trunks.forEach((transform, index) => stems.setMatrixAt(index, transform));stems.computeBoundingSphere();root.add(stems);

  const boulders: Matrix4[] = [];
  for (let distance = start + 6, index = 0; distance < end - 10; distance += 13, index++) {
    const point = surfacePoint(distance, (index % 2 ? -1 : 1) * (0.32 + index % 3 * 0.09));if (!point) continue;
    rotation.setFromAxisAngle(UP, index * 1.91);
    matrix.compose(point, rotation, scale.set(2 + index % 3, 1.8 + index % 4 * 0.5, 2.6));boulders.push(matrix.clone());
  }
  const crags = new InstancedMesh(new DodecahedronGeometry(1, 0), new MeshStandardMaterial({ color: 0x4e3a5e, roughness: 1, flatShading: true }), boulders.length);
  crags.name = "rift-tunnel-ridge-boulders";boulders.forEach((transform, index) => crags.setMatrixAt(index, transform));crags.computeBoundingSphere();root.add(crags);

  // A small hilltop lantern pavilion provides a landmark above the portal.
  const lookoutPoint = surfacePoint(start + 18, -0.17);
  if (lookoutPoint) {
    const lookout = new Group();lookout.name = "rift-tunnel-lantern-pavilion";lookout.position.copy(lookoutPoint);
    const foundation = new Mesh(new BoxGeometry(5.8, 0.7, 5.8), dark);foundation.position.y = 0.2;lookout.add(foundation);
    for (const x of [-1.9, 1.9]) for (const z of [-1.9, 1.9]) {
      const post = new Mesh(new BoxGeometry(0.28, 3.4, 0.28), dark);post.position.set(x, 2, z);lookout.add(post);
      const lantern = new Mesh(new BoxGeometry(0.35, 0.8, 0.35), beaconMaterial);lantern.position.set(x, 2.8, z);lookout.add(lantern);
    }
    for (let tier = 0; tier < 2; tier++) {
      const roof = new Mesh(new ConeGeometry(4.8 - tier * 1.4, 1.4, 4), dark);
      roof.position.y = 4.1 + tier * 1.25;roof.rotation.y = Math.PI / 4;lookout.add(roof);
    }
    root.add(lookout);
  }
  return root;
}
