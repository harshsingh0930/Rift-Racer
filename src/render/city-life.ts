import { BoxGeometry, CatmullRomCurve3, Color, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, TubeGeometry, Vector3 } from "three";
import { findNearestTrackPoint, sampleTrackPosition, sampleTrackSection, sampleTrackTangent, type TrackRoute } from "../game/track";
import type { QualityTier } from "../game/performance";

/** Baked flyovers with lightweight ambient traffic on separate elevated lanes. */
export class CityLife extends Group {
  private readonly curves: CatmullRomCurve3[] = [];
  private readonly bodies: InstancedMesh;
  private readonly lamps: InstancedMesh;
  private readonly trafficMatrix = new Matrix4();
  private readonly positionScratch = new Vector3();
  private readonly tangent = new Vector3();
  private readonly rotationScratch = new Quaternion();
  private readonly scaleScratch = new Vector3();

  constructor(route: TrackRoute, quality: QualityTier) {
    super();this.name = "rift-city-highway-life";this.userData.dynamicVisibility = true;
    const concrete = new MeshStandardMaterial({ color: 0x342c49, roughness: 0.9 });
    const edge = new MeshBasicMaterial({ color: new Color(0xff793b).multiplyScalar(1.7) });
    const supports: Matrix4[] = [];
    for (const distance of [route.totalLength * 0.07, route.totalLength * 0.91]) {
      const section = sampleTrackSection(route, distance);
      if (section === "underwater" || section === "tunnel" || section === "cliff-dive") continue;
      const center = sampleTrackPosition(route, distance);
      const along = sampleTrackTangent(route, distance).setY(0).normalize();
      const cross = new Vector3(along.z, 0, -along.x);
      const points = [-85, -45, 0, 45, 85].map((offset, index) => center.clone()
        .addScaledVector(cross, offset).addScaledVector(along, Math.sin(index * 0.8) * 13)
        .setY(center.y + 12 + Math.sin(index / 4 * Math.PI) * 2));
      const curve = new CatmullRomCurve3(points);this.curves.push(curve);
      // A flattened tube gives the deck a complete underside and rounded edge.
      const geometry = new TubeGeometry(curve, 48, 1, 4, false);
      const position = geometry.getAttribute("position");
      for (let i = 0; i < position.count; i++) {
        const row = Math.floor(i / 5);const p = curve.getPointAt(row / 48);
        position.setXYZ(i, p.x + (position.getX(i) - p.x) * 4.5,
          p.y + (position.getY(i) - p.y) * 0.7, p.z + (position.getZ(i) - p.z) * 4.5);
      }
      geometry.computeVertexNormals();const deck = new Mesh(geometry, concrete);deck.name = "rift-city-flyover-deck";this.add(deck);
      for (const sign of [-1, 1]) {
        const railPoints = Array.from({ length: 25 }, (_, i) => {
          const p = curve.getPointAt(i / 24);const tangent = curve.getTangentAt(i / 24);
          return p.add(new Vector3(tangent.z, 0, -tangent.x).normalize().multiplyScalar(sign * 4.3)).add(new Vector3(0, 0.6, 0));
        });
        const rail = new Mesh(new TubeGeometry(new CatmullRomCurve3(railPoints), 48, 0.065, 4), edge);
        rail.name = "rift-city-flyover-orange-rail";this.add(rail);
      }
      for (const t of [0.12, 0.30, 0.70, 0.88]) {
        const point = curve.getPointAt(t);const nearest = findNearestTrackPoint(route, point);
        // Never place a pillar through a lower route or the launch corridor.
        if (Math.hypot(point.x - nearest.position.x, point.z - nearest.position.z) < nearest.width / 2 + 6) continue;
        const height = point.y + 3;
        supports.push(new Matrix4().makeScale(1.2, height, 2).setPosition(point.x, -3 + height / 2, point.z));
      }
    }
    const piers = new InstancedMesh(new BoxGeometry(1, 1, 1), concrete, supports.length);
    piers.name = "rift-city-flyover-supports";supports.forEach((matrix, index) => piers.setMatrixAt(index, matrix));piers.computeBoundingSphere();this.add(piers);
    const count = this.curves.length * (quality === "eco" ? 6 : 10);
    this.bodies = new InstancedMesh(new BoxGeometry(1.5, 0.65, 3.3), new MeshStandardMaterial({ color: 0x514569, roughness: 0.45 }), count);
    this.bodies.name = "rift-city-ambient-traffic";this.bodies.frustumCulled = false;
    this.lamps = new InstancedMesh(new BoxGeometry(1.1, 0.10, 0.05), new MeshBasicMaterial({ color: new Color(0xff6430).multiplyScalar(2) }), count);
    this.lamps.name = "rift-city-traffic-taillights";this.lamps.frustumCulled = false;
    for (let i = 0; i < count; i++) this.bodies.setColorAt(i, new Color([0x55419b, 0x426d7d, 0x9a5e68, 0x77708a][i % 4]));
    this.add(this.bodies, this.lamps);this.update(0);
  }

  update(time: number, focus?: Readonly<{ x: number; y: number; z: number }>): void {
    const p = this.positionScratch;
    for (let i = 0; i < this.bodies.count; i++) {
      const curve = this.curves[i % this.curves.length];
      const reverse = Math.floor(i / this.curves.length) % 2 === 0;const t = ((i * 0.618 + time * (reverse ? -0.045 : 0.055)) % 1 + 1) % 1;
      curve.getPointAt(t, p);curve.getTangentAt(t, this.tangent);
      p.x += this.tangent.z * (reverse ? -1.8 : 1.8);p.z -= this.tangent.x * (reverse ? -1.8 : 1.8);p.y += 0.94;
      this.rotationScratch.setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(this.tangent.x, this.tangent.z) + (reverse ? Math.PI : 0));
      const visible = !focus || Math.hypot(p.x - focus.x, p.z - focus.z) < 175;
      this.scaleScratch.setScalar(visible ? 1 : 0);this.trafficMatrix.compose(p, this.rotationScratch, this.scaleScratch);this.bodies.setMatrixAt(i, this.trafficMatrix);
      const lamp = new Vector3(0, 0, -1.67).applyQuaternion(this.rotationScratch).add(p);
      this.trafficMatrix.setPosition(lamp);this.lamps.setMatrixAt(i, this.trafficMatrix);
    }
    this.bodies.instanceMatrix.needsUpdate = true;this.lamps.instanceMatrix.needsUpdate = true;
  }
}
