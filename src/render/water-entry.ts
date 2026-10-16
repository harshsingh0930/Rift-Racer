import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Points, PointsMaterial, RingGeometry, Vector3 } from "three";

/** Short foam burst at sea level; allocated once and reused each lap. */
export class WaterEntryEffect extends Group {
  private age = 2;
  private readonly origin = new Vector3();
  private readonly spray: Points<BufferGeometry, PointsMaterial>;
  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  constructor() {
    super();this.name = "rift-water-entry-splash";this.visible = false;
    const geometry = new BufferGeometry();geometry.setAttribute("position", new BufferAttribute(new Float32Array(48 * 3), 3));
    this.spray = new Points(geometry, new PointsMaterial({ color: 0xc1f8ff, size: 0.24, transparent: true, opacity: 0.85, depthWrite: false }));
    this.spray.frustumCulled = false;
    this.ring = new Mesh(new RingGeometry(0.85, 1, 48), new MeshBasicMaterial({ color: 0x9ef6ff, transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;this.add(this.spray, this.ring);
  }
  emit(position: Vector3): void { this.origin.copy(position);this.age = 0;this.visible = true; }
  update(delta: number): void {
    this.age += delta;if (this.age > 1.2) { this.visible = false;return; }
    this.position.copy(this.origin);
    const positions = this.spray.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const angle = i * 2.399963;const speed = 3 + i % 7 * 0.6;
      positions.setXYZ(i, Math.cos(angle) * this.age * speed,
        0.1 + (3 + i % 5) * this.age - 5 * this.age ** 2, Math.sin(angle) * this.age * speed);
    }
    positions.needsUpdate = true;this.spray.material.opacity = Math.max(0, (1 - this.age / 1.2) * 0.85);
    this.ring.position.y = 0.03;this.ring.scale.setScalar(0.8 + this.age * 8);
    this.ring.material.opacity = Math.max(0, (1 - this.age) * 0.7);
  }
  reset(): void { this.age = 2;this.visible = false; }
}
