import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, TorusGeometry, Vector3,
} from "three";
import type { QualityTier } from "../game/performance";

type Material = MeshStandardMaterial | MeshBasicMaterial;

function panel(vertices: readonly number[], indices = [0, 1, 2, 0, 2, 3]): BufferGeometry {
  const geometry = new BufferGeometry();geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}

/** One continuous tapered body, with deliberate shoulder and sill facets. */
function bodyGeometry(): BufferGeometry {
  const stations = [[-2.22, 0.98, 0.66], [-1.65, 1.07, 0.79], [-0.65, 1.03, 0.78],
    [0.55, 1.01, 0.76], [1.40, 1.02, 0.65], [2.23, 0.88, 0.46]];
  const vertices: number[] = [];const indices: number[] = [];
  stations.forEach(([z, width, top]) => {
    for (const [x, y] of [[-width * 0.80, 0.28], [-width, top - 0.14], [-width * 0.9, top],
      [width * 0.9, top], [width, top - 0.14], [width * 0.80, 0.28]]) vertices.push(x, y, z);
  });
  const triangle = (a: number, b: number, c: number) => {
    const p = new Vector3().fromArray(vertices, a * 3);const q = new Vector3().fromArray(vertices, b * 3);const r = new Vector3().fromArray(vertices, c * 3);
    const normal = q.clone().sub(p).cross(r.clone().sub(p));
    const outward = p.clone().add(q).add(r).multiplyScalar(1 / 3);outward.y -= 0.5;
    if (Math.abs(normal.z) > Math.abs(normal.x) + Math.abs(normal.y)) outward.set(0, 0, outward.z);
    else outward.z = 0;
    indices.push(a, ...(normal.dot(outward) >= 0 ? [b, c] : [c, b]));
  };
  for (let station = 0; station < stations.length - 1; station++) for (let column = 0; column < 6; column++) {
    const a = station * 6 + column;const b = station * 6 + (column + 1) % 6;
    triangle(a, a + 6, b);triangle(b, a + 6, b + 6);
  }
  for (const station of [0, stations.length - 1]) {
    const base = station * 6;
    for (let index = 1; index < 5; index++) triangle(base, base + index, base + index + 1);
  }
  return panel(vertices, indices);
}

/** Low, wide mid-engine wedge coupe, readable as a single silhouette at speed. */
export function createCoupeModel(quality: QualityTier) {
  const group = new Group();group.name = "rift-car-grounded-visuals";
  const paint = new MeshPhysicalMaterial({ name: "rift-car-violet-paint", color: 0x512598,
    metalness: 0.30, roughness: 0.36, clearcoat: 0.3, clearcoatRoughness: 0.35,
    envMapIntensity: 0.32, emissive: 0x1c0b36, emissiveIntensity: 0.15, flatShading: true });
  const trim = new MeshStandardMaterial({ color: 0x10101b, roughness: 0.7, metalness: 0.15 });
  const glass = new MeshPhysicalMaterial({ name: "rift-car-smoked-glass", color: 0x09162e,
    roughness: 0.28, metalness: 0.15, envMapIntensity: 0.12, clearcoat: 0.1,
    emissive: 0x081c36, emissiveIntensity: 0.18, side: DoubleSide });
  const add = (name: string, geometry: BufferGeometry, material: Material) => {
    const mesh = new Mesh(geometry, material);mesh.name = name;mesh.castShadow = material instanceof MeshStandardMaterial;
    mesh.receiveShadow = material instanceof MeshStandardMaterial;group.add(mesh);return mesh;
  };
  const box = (name: string, size: [number, number, number], position: [number, number, number], material: Material = paint) => {
    const mesh = add(name, new BoxGeometry(...size), material);mesh.position.set(...position);return mesh;
  };
  const body = add("rift-car-body", bodyGeometry(), paint);
  box("rift-car-chassis", [1.64, 0.12, 3.9], [0, 0.26, 0], trim);
  box("rift-car-front-splitter", [1.86, 0.065, 0.25], [0, 0.285, 2.12], trim);
  box("rift-car-rear-bumper", [1.96, 0.10, 0.16], [0, 0.31, -2.20], trim);

  const cabin = add("rift-car-cabin-shell", panel([
    -0.87, 0.76, 0.91, 0.87, 0.76, 0.91, -0.87, 0.76, -1.61, 0.87, 0.76, -1.61,
    -0.67, 1.18, 0.05, 0.67, 1.18, 0.05, -0.67, 1.18, -0.76, 0.67, 1.18, -0.76,
  ], [0, 1, 4, 1, 5, 4, 5, 7, 4, 7, 6, 4, 2, 6, 3, 6, 7, 3,
    0, 4, 2, 4, 6, 2, 1, 3, 5, 3, 7, 5, 0, 2, 1, 2, 3, 1]), paint);
  cabin.castShadow = true;
  add("rift-car-windshield", panel([-0.80, 0.803, 0.845, 0.80, 0.803, 0.845,
    0.62, 1.145, 0.108, -0.62, 1.145, 0.108]), glass);
  add("rift-car-rear-window", panel([0.80, 0.803, -1.55, -0.80, 0.803, -1.55,
    -0.62, 1.145, -0.825, 0.62, 1.145, -0.825]), glass);
  for (const side of [-1, 1]) {
    add("rift-car-side-window", panel([side * 0.866, 0.80, 0.78, side * 0.866, 0.80, -1.47,
      side * 0.698, 1.14, -0.76, side * 0.698, 1.14, 0.055]), glass);
    const pillar = box("rift-car-window-divider", [0.045, 0.37, 0.045], [side * 0.773, 0.98, -0.35], paint);
    pillar.rotation.z = side * 0.45;
    box("rift-car-wing-mirror", [0.20, 0.09, 0.23], [side * 1.02, 0.88, 0.58], trim);
    box("rift-car-door-sill", [0.11, 0.10, 1.6], [side * 1.015, 0.33, -0.04], paint);
    const vent = box("rift-car-side-intake", [0.04, 0.19, 0.55], [side * 1.057, 0.62, -0.62], trim);
    vent.rotation.x = -0.1;
    for (let index = 0; index < 3; index++) box("rift-car-intake-strake", [0.045, 0.018, 0.58],
      [side * 1.08, 0.56 + index * 0.055, -0.63], paint);
  }
  for (let index = 0; index < 6; index++) {
    const louver = box("rift-car-rear-louver", [1.33 + index * 0.035, 0.023, 0.06],
      [0, 1.134 - index * 0.054, -0.86 - index * 0.108], trim);louver.rotation.x = -0.47;
  }
  for (const x of [-0.68, 0.68]) box("rift-car-spoiler-support", [0.065, 0.17, 0.12], [x, 0.80, -2.0], trim);
  const wing = box("rift-car-rear-spoiler", [2.08, 0.055, 0.27], [0, 0.905, -2.0]);wing.rotation.x = -0.08;
  box("rift-car-rear-diffuser", [1.56, 0.10, 0.31], [0, 0.23, -2.08], trim);
  for (const x of [-0.54, -0.27, 0, 0.27, 0.54]) {
    box("rift-car-diffuser-fin", [0.025, 0.11, 0.26], [x, 0.205, -2.15], trim);
  }
  box("rift-car-rear-lamp-recess", [1.83, 0.22, 0.04], [0, 0.53, -2.236], trim);
  const tailMaterial = new MeshBasicMaterial({ color: new Color(0xff3020).multiplyScalar(2.0) });
  const taillights: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
  const headlights: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
  const lampMaterial = new MeshBasicMaterial({ color: new Color(0xe1efff).multiplyScalar(2) });
  for (const side of [-1, 1]) {
    const tail = new Mesh(new BoxGeometry(0.47, 0.125, 0.025), tailMaterial);tail.name = "rift-car-taillight";
    tail.position.set(side * 0.59, 0.535, -2.265);group.add(tail);taillights.push(tail);
    box("rift-car-lamp-recess", [0.49, 0.105, 0.16], [side * 0.59, 0.50, 2.10], trim);
    const headlight = new Mesh(new BoxGeometry(0.39, 0.065, 0.025), lampMaterial);
    headlight.name = side < 0 ? "rift-car-headlight-left" : "rift-car-headlight-right";
    headlight.position.set(side * 0.59, 0.50, 2.19);group.add(headlight);headlights.push(headlight);
    const exhaust = new Mesh(new CylinderGeometry(0.058, 0.058, 0.18, 10), trim);
    exhaust.name = "rift-car-exhaust";exhaust.rotation.x = Math.PI / 2;exhaust.position.set(side * 0.73, 0.26, -2.27);group.add(exhaust);
  }
  box("rift-car-rear-plate", [0.25, 0.10, 0.025], [0, 0.51, -2.27], new MeshBasicMaterial({ color: 0x786093 }));

  const rubber = new MeshStandardMaterial({ name: "rift-car-tyre-rubber", color: 0x15151d, roughness: 0.92 });
  const alloy = new MeshStandardMaterial({ color: 0x929db0, metalness: 0.75, roughness: 0.35 });
  const rimNeon = new MeshBasicMaterial({ color: new Color(0x9be5ff).multiplyScalar(2.2) });
  const segments = quality === "ultra" ? 36 : quality === "balanced" ? 28 : 20;
  const tyreGeometry = new CylinderGeometry(0.405, 0.405, 0.29, segments);tyreGeometry.rotateZ(Math.PI / 2);
  const ringGeometry = new TorusGeometry(0.337, 0.012, 5, segments);ringGeometry.rotateY(Math.PI / 2);
  const rimGeometry = new TorusGeometry(0.255, 0.023, 6, segments);rimGeometry.rotateY(Math.PI / 2);
  const discGeometry = new CylinderGeometry(0.25, 0.25, 0.018, segments);discGeometry.rotateZ(Math.PI / 2);
  const wheelMeshes: Mesh<CylinderGeometry, MeshStandardMaterial>[] = [];
  for (const [x, z] of [[-1.03, 1.15], [1.03, 1.15], [-1.03, -1.25], [1.03, -1.25]]) {
    const tyre = new Mesh(tyreGeometry, rubber);tyre.name = "rift-car-wheel";tyre.position.set(x, 0.405, z);tyre.castShadow = true;
    group.add(tyre);wheelMeshes.push(tyre);const side = Math.sign(x);
    const disc = new Mesh(discGeometry, trim);disc.position.x = side * 0.15;tyre.add(disc);
    const rim = new Mesh(rimGeometry, alloy);rim.position.x = side * 0.17;tyre.add(rim);
    const outline = new Mesh(ringGeometry, rimNeon);outline.name = "rift-car-wheel-outline";outline.position.x = side * 0.17;tyre.add(outline);
    for (let index = 0; index < 5; index++) {
      const pivot = new Group();pivot.rotation.x = index / 5 * Math.PI * 2;
      const spoke = new Mesh(new BoxGeometry(0.025, 0.24, 0.045), alloy);spoke.position.set(side * 0.17, 0.12, 0);
      pivot.add(spoke);tyre.add(pivot);
    }
  }
  const underbodyTrims: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
  const neon = new MeshBasicMaterial({ color: 0x742a9b, transparent: true, opacity: 0.35 });
  for (const side of [-1, 1]) {
    const sill = new Mesh(new BoxGeometry(0.018, 0.022, 1.55), neon);sill.name = "rift-car-underbody-glow";
    sill.position.set(side * 1.06, 0.24, -0.1);group.add(sill);underbodyTrims.push(sill);
  }
  return { group, body, wheelMeshes, headlights, taillights, underbodyTrims };
}
