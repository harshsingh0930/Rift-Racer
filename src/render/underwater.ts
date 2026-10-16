import { BufferGeometry, CatmullRomCurve3, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TorusGeometry, TubeGeometry, Vector3 } from "three";
import { sampleTrackPosition, sampleTrackSection, sampleTrackTangent, sampleTrackWidth, type TrackRoute } from "../game/track";
import type { QualityTier } from "../game/performance";
import { detailTexture } from "./texture-assets";

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

/** Structural ribs, longitudinal seams and a reef bed make the glass enclosure legible. */
export function createUnderwaterStructure(route: TrackRoute, quality: QualityTier): Group {
  const group = new Group();
  group.name = "rift-underwater-structure";
  const divisions = quality === "ultra" ? 64 : quality === "balanced" ? 40 : 24;
  const ribGeometry = new TorusGeometry(1, 0.028, 6, divisions);
  const lightGeometry = new TorusGeometry(1, 0.008, 4, divisions, Math.PI);
  const frameMaterial = new MeshStandardMaterial({ color: 0x282c46, metalness: 0.5, roughness: 0.5,
    emissive: 0x08202e, emissiveIntensity: 0.25 });
  const lightMaterial = new MeshBasicMaterial({ color: new Color(0xff8a43).multiplyScalar(2.4) });
  const spacing = quality === "eco" ? 22 : quality === "ultra" ? 14 : 18;
  for (let distance = 0; distance < route.totalLength; distance += spacing) {
    if (sampleTrackSection(route, distance) !== "underwater") continue;
    const center = sampleTrackPosition(route, distance);
    center.y += 0.2;
    const radius = sampleTrackWidth(route, distance) * 0.5 + 1.23;
    const tangent = sampleTrackTangent(route, distance);
    const rib = new Mesh(ribGeometry, frameMaterial);
    rib.name = "rift-glass-tunnel-structural-rib";
    rib.position.copy(center);
    rib.rotation.set(-Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z)),
      Math.atan2(tangent.x, tangent.z), 0, "YXZ");
    rib.scale.setScalar(radius);
    group.add(rib);
    const light = new Mesh(lightGeometry, lightMaterial);
    light.name = "rift-glass-tunnel-rib-light";
    light.position.copy(center);
    light.quaternion.copy(rib.quaternion);
    light.scale.setScalar(radius - 0.12);
    light.position.addScaledVector(tangent, -0.22);
    group.add(light);
  }

  const positions: number[] = [];
  const bedPositions: number[] = [];
  const indices: number[] = [];
  const railPoints: Vector3[][] = [[], [], []];
  for (const segment of route.segments) {
    if (segment.section !== "underwater") continue;
    const base = positions.length / 3;
    for (const [point, distance] of [[segment.start, segment.startDistance], [segment.end, segment.endDistance]] as const) {
      const tangent = sampleTrackTangent(route, distance);
      const side = new Vector3().crossVectors(UP, tangent).normalize();
      const center = point.position;
      const width = point.width * 0.5 + 1.55;
      for (const sign of [-1, 1]) {
        const corner = center.clone().addScaledVector(side, sign * width);
        positions.push(corner.x, corner.y - 0.08, corner.z);
        const bed = center.clone().addScaledVector(side, sign * 38);
        bedPositions.push(bed.x, bed.y - 6.3, bed.z);
      }
    }
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    const tangent = sampleTrackTangent(route, segment.startDistance);
    const side = new Vector3().crossVectors(UP, tangent).normalize();
    const radius = segment.start.width * 0.5 + 1.18;
    for (let rail = 0; rail < 3; rail += 1) {
      const angle = Math.PI * (rail + 1) / 4;
      const point = segment.start.position.clone().addScaledVector(side, Math.cos(angle) * radius);
      point.y += 0.2 + Math.sin(angle) * radius;
      railPoints[rail].push(point);
    }
  }
  const deckGeometry = new BufferGeometry();
  deckGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  deckGeometry.setIndex(indices);
  deckGeometry.computeVertexNormals();
  const deck = new Mesh(deckGeometry, new MeshStandardMaterial({ color: 0x3b6573, roughness: 0.6, metalness: 0.3, side: DoubleSide }));
  deck.name = "rift-underwater-structural-deck";
  group.add(deck);
  const bedGeometry = new BufferGeometry();
  bedGeometry.setAttribute("position", new Float32BufferAttribute(bedPositions, 3));
  bedGeometry.setIndex(indices);
  bedGeometry.computeVertexNormals();
  const bed = new Mesh(bedGeometry, new MeshStandardMaterial({ color: 0x2d5863, roughness: 1, emissive: 0x032331,
    emissiveIntensity: 0.3, side: DoubleSide }));
  bed.name = "rift-underwater-reef-bed";
  group.add(bed);
  for (const points of railPoints) {
    if (points.length < 2) continue;
    const rail = new Mesh(new TubeGeometry(new CatmullRomCurve3(points), points.length, 0.065, 6), frameMaterial);
    rail.name = "rift-glass-tunnel-longitudinal-frame";
    group.add(rail);
  }
  const rockGeometry = new SphereGeometry(1, 9, 6);
  const rockMaterial = new MeshStandardMaterial({ color: 0x285367, map: detailTexture("reef"), roughness: 0.85, flatShading: true });
  for (let distance = 0, index = 0; distance < route.totalLength; distance += 31, index += 1) {
    if (sampleTrackSection(route, distance) !== "underwater") continue;
    const position = sampleTrackPosition(route, distance);
    const side = new Vector3().crossVectors(UP, sampleTrackTangent(route, distance)).normalize();
    for (const sign of [-1, 1]) {
      const rock = new Mesh(rockGeometry, rockMaterial);
      rock.position.copy(position).addScaledVector(side, sign * (12 + index % 6));
      rock.position.y -= 5.2;
      rock.scale.set(3 + index % 3, 1.7 + index % 2, 2.5);
      group.add(rock);
    }
  }
  return group;
}
