import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, TorusGeometry, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { QualityTier } from "../game/performance";

type Material = MeshStandardMaterial | MeshBasicMaterial;

function surface(rows: number, columns: number, point: (t: number, u: number) => number[]): BufferGeometry {
  const positions: number[] = [];const indices: number[] = [];const uvs: number[] = [];
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) { positions.push(...point(row / rows, column / columns));uvs.push(column / columns, row / rows); }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column;const b = a + columns + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new BufferGeometry();geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

function profile(z: number, values: number[][]): number {
  for (let i = 1; i < values.length; i++) if (z <= values[i][0]) {
    const a = values[i - 1];const b = values[i];const t = Math.max(0, Math.min(1, (z - a[0]) / (b[0] - a[0])));
    return a[1] + (b[1] - a[1]) * t;
  }
  return values[values.length - 1][1];
}
const widthAt = (z: number) => profile(z, [[-2.24, 1.00], [-1.55, 1.11], [-1.00, 1.10], [-0.2, 0.98], [0.7, 1.04], [1.3, 1.08], [2.24, 0.93]]);
const deckAt = (z: number) => profile(z, [[-2.24, 0.74], [-1.3, 0.82], [0, 0.76], [1.15, 0.69], [2.24, 0.47]]);
function skinHeight(z: number, u: number): number {
  const shoulder = profile(z, [[-2.24, 0.80], [-1.55, 0.93], [-1.0, 0.92], [0, 0.81], [0.75, 0.91], [1.5, 0.88], [2.24, 0.55]]);
  const centre = deckAt(z);const across = Math.abs(u);
  return across <= 0.66 ? centre + across * 0.025 : centre + 0.0165 + (shoulder - centre - 0.0165) * (across - 0.66) / 0.34;
}

function canopy(t: number, u: number): number[] {
  const z = -1.40 + t * 2.30;const across = u * 2 - 1;
  const points = [[-1.40, 0.77, 0.80], [-0.64, 0.60, 1.22], [0.00, 0.59, 1.22], [0.90, 0.77, 0.76]];
  let a = points[0], b = points[1];
  for (let i = 1; i < points.length; i++) if (z <= points[i][0] || i === points.length - 1) { a = points[i - 1];b = points[i];break; }
  const f = (z - a[0]) / (b[0] - a[0]);const width = a[1] + (b[1] - a[1]) * f;const height = a[2] + (b[2] - a[2]) * f;
  const shoulder = Math.max(0, 1 - Math.max(0, Math.abs(across) - 0.76) / 0.24);
  return [across * width, 0.76 + (height - 0.76) * shoulder, z];
}

/** Angular mid-engine supercar with a low wedge, Y lamps and large rear cooling ducts. */
export function createCoupeModel(quality: QualityTier) {
  const group = new Group();group.name = "rift-car-grounded-visuals";
  const paint = new MeshPhysicalMaterial({ name: "rift-car-violet-paint", color: 0x482487,
    metalness: 0.35, roughness: 0.40, clearcoat: 0.22, clearcoatRoughness: 0.35,
    envMapIntensity: 0.32, emissive: 0x130a2a, emissiveIntensity: 0.08, side: DoubleSide });
  const carbon = new MeshStandardMaterial({ color: 0x11121c, roughness: 0.55, metalness: 0.25, side: DoubleSide });
  const glass = new MeshPhysicalMaterial({ name: "rift-car-smoked-glass", color: 0x171351,
    roughness: 0.25, metalness: 0.15, envMapIntensity: 0.3, clearcoat: 0.4, emissive: 0x0d0838, emissiveIntensity: 0.35, side: DoubleSide });
  const add = (name: string, geometry: BufferGeometry, material: Material) => {
    const mesh = new Mesh(geometry, material);mesh.name = name;mesh.castShadow = material instanceof MeshStandardMaterial;
    mesh.receiveShadow = true;group.add(mesh);return mesh;
  };
  const box = (name: string, size: [number, number, number], position: [number, number, number], material: Material = paint) => {
    const mesh = add(name, new RoundedBoxGeometry(...size, 2, Math.min(...size) * 0.25), material);
    mesh.position.set(...position);return mesh;
  };
  const bodyGeometry = surface(64, 16, (t, u) => {
    const z = -2.24 + t * 4.48;const across = u * 2 - 1;
    return [across * widthAt(z), skinHeight(z, across), z];
  });
  const body = add("rift-car-body", bodyGeometry, paint) as Mesh<BufferGeometry, MeshStandardMaterial>;
  for (const z of [-2.24, 2.24]) add("rift-car-end-fascia", surface(2, 12, (t, u) => {
    const across = u * 2 - 1;
    return [across * widthAt(z), 0.27 + (skinHeight(z, across) - 0.27) * t, z];
  }), paint);
  for (const sign of [-1, 1]) {
    add("rift-car-sculpted-flank", surface(96, 4, (t, u) => {
      const z = -2.24 + t * 4.48;const gap = Math.min(Math.abs(z + 1.25), Math.abs(z - 1.15));
      const lower = gap < 0.46 ? 0.405 + Math.sqrt(0.46 ** 2 - gap ** 2) : 0.27;
      const upper = skinHeight(z, 1);const bottom = Math.min(lower, upper - 0.015);
      return [sign * (widthAt(z) - (1 - u) * 0.045), bottom + (upper - bottom) * u, z];
    }), paint);
    // A rising triangular intake is integrated into each flank behind the door.
    add("rift-car-triangular-intake", surface(1, 1, (t, u) => {
      const z = -0.88 + t * 1.13;const low = 0.38 + t * 0.03;const high = 0.83 - t * 0.30;
      return [sign * (widthAt(z) + 0.012), low + (high - low) * u, z];
    }), carbon);
    box("rift-car-side-blade", [0.055, 0.045, 0.98], [sign * 0.98, 0.34, -0.18], paint);
    box("rift-car-sill", [0.09, 0.08, 1.45], [sign * 0.98, 0.26, -0.04], carbon);
    const mirror = box("rift-car-mirror", [0.20, 0.075, 0.22], [sign * 0.94, 0.88, 0.43], carbon);
    mirror.rotation.y = sign * 0.2;
  }
  const cabin = add("rift-car-cabin-shell", surface(16, 8, canopy), glass);cabin.castShadow = true;
  add("rift-car-roof-spine", surface(12, 10, (t, u) => {
    const point = canopy(0.30 + t * 0.32, 0.18 + u * 0.64);point[1] += 0.012;return point;
  }), paint);
  add("rift-car-engine-glass", surface(8, 8, (t, u) => {
    const z = -1.98 + t * 0.57;const x = (u * 2 - 1) * 0.56;
    return [x, skinHeight(z, x / widthAt(z)) + 0.018, z];
  }), glass);
  box("rift-car-chassis", [1.60, 0.10, 3.95], [0, 0.25, 0], carbon);
  box("rift-car-front-splitter", [1.88, 0.055, 0.34], [0, 0.235, 2.13], carbon);
  box("rift-car-front-mouth", [1.30, 0.15, 0.13], [0, 0.34, 2.20], carbon);
  box("rift-car-front-centre-blade", [0.045, 0.16, 0.14], [0, 0.335, 2.18], paint);
  box("rift-car-rear-fascia", [1.94, 0.32, 0.15], [0, 0.55, -2.22], carbon);
  box("rift-car-tail-deck", [1.96, 0.05, 0.18], [0, 0.77, -2.13], paint);
  for (const sign of [-1, 1]) {
    box("rift-car-aero-wing-support", [0.065, 0.28, 0.16], [sign * 0.72, 0.86, -1.94], carbon);
    const endplate = box("rift-car-aero-endplate", [0.045, 0.14, 0.32], [sign * 1.045, 1.015, -1.96], carbon);endplate.rotation.x = 0.12;
  }
  box("rift-car-aero-wing", [2.15, 0.045, 0.27], [0, 1.025, -1.96], carbon);
  for (let i = 0; i < 3; i++) box("rift-car-engine-cover-vent", [1.05, 0.025, 0.07], [0, 0.755, -1.49 - i * 0.15], carbon);
  box("rift-car-registration-plate", [0.26, 0.16, 0.025], [0, 0.53, -2.285], new MeshBasicMaterial({ color: 0xc590e2 }));
  box("rift-car-diffuser", [1.62, 0.08, 0.40], [0, 0.22, -2.10], carbon);
  for (const x of [-0.62, -0.31, 0, 0.31, 0.62]) box("rift-car-diffuser-fin", [0.025, 0.12, 0.32], [x, 0.20, -2.14], carbon);
  const taillights: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
  const headlights: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
  const tailMaterial = new MeshBasicMaterial({ color: new Color(0xff352b).multiplyScalar(2.3) });
  const lampMaterial = new MeshBasicMaterial({ color: new Color(0xd8efff).multiplyScalar(2.3) });
  for (const sign of [-1, 1]) {
    const tail = new Mesh(new BoxGeometry(0.48, 0.045, 0.025), tailMaterial);
    tail.name = "rift-car-taillight";tail.position.set(sign * 0.64, 0.69, -2.31);group.add(tail);taillights.push(tail);
    const lamp = new Mesh(new BoxGeometry(0.19, 0.035, 0.035), lampMaterial);
    lamp.name = sign < 0 ? "rift-car-headlight-left" : "rift-car-headlight-right";
    lamp.position.set(sign * 0.64, 0.52, 2.20);lamp.rotation.z = sign * 0.12;group.add(lamp);headlights.push(lamp);
    box("rift-car-headlamp-housing", [0.44, 0.12, 0.10], [sign * 0.64, 0.51, 2.14], carbon);
    for (const direction of [-1, 1]) {
      const branch = new Mesh(new BoxGeometry(0.17, 0.025, 0.025), lampMaterial);
      branch.position.set(-sign * 0.12, direction * 0.045, 0);branch.rotation.z = direction * sign * 0.5;lamp.add(branch);
      const rearBranch = new Mesh(new BoxGeometry(0.14, 0.022, 0.025), tailMaterial);
      rearBranch.position.set(-sign * 0.18, -0.04 * direction, 0);rearBranch.rotation.z = sign * direction * 0.6;tail.add(rearBranch);
    }
    box("rift-car-front-air-scoop", [0.32, 0.12, 0.08], [sign * 0.66, 0.33, 2.12], carbon);
    const exhaust = add("rift-car-exhaust", new CylinderGeometry(0.075, 0.075, 0.17, 6), carbon);
    exhaust.rotation.x = Math.PI / 2;exhaust.position.set(sign * 0.16, 0.40, -2.32);
  }
  const grilleGeometry = new TorusGeometry(0.056, 0.006, 3, 6);
  const grilleMaterial = new MeshStandardMaterial({ color: 0x353442, metalness: 0.5, roughness: 0.6 });
  for (let row = 0; row < 2; row++) for (let column = 0; column < 14; column++) {
    const cell = add("rift-car-honeycomb-grille", grilleGeometry.clone(), grilleMaterial);
    cell.position.set(-0.84 + column * 0.128 + row * 0.032, 0.47 + row * 0.095, -2.305);
  }
  grilleGeometry.dispose();
  const rubber = new MeshStandardMaterial({ color: 0x12131a, roughness: 0.93 });
  const alloy = new MeshStandardMaterial({ color: 0x646e83, metalness: 0.82, roughness: 0.27 });
  const neon = new MeshBasicMaterial({ color: new Color(0xffddb1).multiplyScalar(2.0) });
  const segments = quality === "ultra" ? 40 : quality === "balanced" ? 28 : 20;
  const tyreGeometry = new CylinderGeometry(0.405, 0.405, 0.29, segments);tyreGeometry.rotateZ(Math.PI / 2);
  const ringGeometry = new TorusGeometry(0.33, 0.009, 5, segments);ringGeometry.rotateY(Math.PI / 2);
  const discGeometry = new CylinderGeometry(0.28, 0.28, 0.018, segments);discGeometry.rotateZ(Math.PI / 2);
  const wheelMeshes: Mesh<CylinderGeometry, MeshStandardMaterial>[] = [];
  for (const [x, z] of [[-1.03, 1.15], [1.03, 1.15], [-1.03, -1.25], [1.03, -1.25]]) {
    const tyre = new Mesh(tyreGeometry, rubber);tyre.name = "rift-car-wheel";tyre.position.set(x, 0.405, z);tyre.castShadow = true;group.add(tyre);wheelMeshes.push(tyre);
    const sign = Math.sign(x);const disc = new Mesh(discGeometry, carbon);disc.position.x = sign * 0.15;tyre.add(disc);
    const ring = new Mesh(ringGeometry, neon);ring.name = "rift-car-wheel-outline";ring.position.x = sign * 0.168;tyre.add(ring);
    const spokes = Array.from({ length: 10 }, (_, i) => {
      const shape = new BoxGeometry(0.025, 0.255, 0.025);shape.translate(sign * 0.165, 0.13, 0);shape.rotateX(Math.floor(i / 2) * Math.PI * 0.4 + (i % 2 ? 0.1 : -0.1));return shape;
    });
    tyre.add(new Mesh(mergeGeometries(spokes), alloy));spokes.forEach(geometry => geometry.dispose());
  }
  const underbodyTrims: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
  const glow = new MeshBasicMaterial({ color: 0x9d44e5, transparent: true, opacity: 0.35 });
  for (const sign of [-1, 1]) {
    const strip = new Mesh(new BoxGeometry(0.018, 0.018, 1.40), glow);strip.name = "rift-car-underbody-glow";
    strip.position.set(sign * 1.01, 0.24, -0.08);group.add(strip);underbodyTrims.push(strip);
  }
  const batches = new Map<Material, Mesh[]>();
  for (const child of [...group.children]) {
    if (!(child instanceof Mesh) || child === body || child === cabin || wheelMeshes.includes(child)
      || headlights.includes(child) || taillights.includes(child) || underbodyTrims.includes(child)) continue;
    const meshes = batches.get(child.material as Material) ?? [];meshes.push(child);batches.set(child.material as Material, meshes);
  }
  for (const [material, meshes] of batches) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => { mesh.updateMatrix();const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);return geometry.index ? geometry.toNonIndexed() : geometry; });
    const merged = mergeGeometries(geometries);
    if (merged) { const mesh = new Mesh(merged, material);mesh.name = "rift-car-baked-detail";mesh.castShadow = material instanceof MeshStandardMaterial;group.add(mesh);meshes.forEach(old => { group.remove(old);old.geometry.dispose(); }); }
    geometries.forEach(geometry => geometry.dispose());
  }
  return { group, body, wheelMeshes, headlights, taillights, underbodyTrims };
}
