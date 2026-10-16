import { PerspectiveCamera, Vector3 } from "three";
import { findNearestTrackPoint, type TrackRoute, type Vector3Like } from "../game/track";

/** An upright orbit around a damped car pivot, including across the ±PI seam. */
export class ChaseCamera {
  private readonly pivot = new Vector3();
  private readonly target = new Vector3();
  private yaw = 0;
  private initialized = false;

  constructor(private readonly camera: PerspectiveCamera, private readonly route: TrackRoute) {}

  reset(): void {
    this.initialized = false;
  }

  update(position: Vector3Like, heading: number, speed: number, deltaSeconds: number): void {
    const delta = Math.min(0.05, Math.max(0, deltaSeconds));
    if (!this.initialized) {
      this.pivot.set(position.x, position.y, position.z);
      this.yaw = heading;
      this.initialized = true;
    } else {
      this.pivot.lerp(new Vector3(position.x, position.y, position.z), 1 - Math.exp(-delta * 16));
      const turn = Math.atan2(Math.sin(heading - this.yaw), Math.cos(heading - this.yaw));
      this.yaw += turn * (1 - Math.exp(-delta * 7));
    }

    const forward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.camera.position.copy(this.pivot).addScaledVector(forward, -6.9);
    this.camera.position.y += 2.7 + Math.min(0.25, Math.max(0, speed) * 0.007);
    const roadBelow = findNearestTrackPoint(this.route, this.camera.position);
    if (Math.hypot(roadBelow.position.x - this.camera.position.x, roadBelow.position.z - this.camera.position.z) < roadBelow.width) {
      this.camera.position.y = Math.max(this.camera.position.y, roadBelow.position.y + 1.5);
    }
    this.target.copy(this.pivot).addScaledVector(forward, 5.5);
    this.target.y += 0.75;

    // lookAt already produces the correct rotation with world +Y as up.
    // Editing Euler z afterward corrupts that rotation at some headings.
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    const targetFov = 60 + Math.min(7, Math.max(0, speed) * 0.2);
    this.camera.fov += (targetFov - this.camera.fov) * (delta === 0 ? 1 : 1 - Math.exp(-delta * 5));
    this.camera.updateProjectionMatrix();
  }
}
