import { PerspectiveCamera, Vector3 } from "three";
import { findNearestTrackPoint, type TrackRoute, type Vector3Like } from "../game/track";

/** The three fixed coverage angles used while the race start countdown runs. */
export type CountdownCameraShot = "front-reveal" | "rear-chase" | "low-hero";

interface ChaseMotion {
  velocity: Vector3Like;
  drift: number;
  steering: number;
  airborne?: boolean;
}

/** An upright orbit around a damped car pivot, including across the ±PI seam. */
export class ChaseCamera {
  private readonly pivot = new Vector3();
  private readonly target = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly cinematicPosition = new Vector3();
  private readonly cinematicTarget = new Vector3();
  private yaw = 0;
  private lateralOffset = 0;
  private initialized = false;

  constructor(private readonly camera: PerspectiveCamera, private readonly route: TrackRoute) {}

  reset(): void {
    this.initialized = false;
    this.lateralOffset = 0;
  }

  update(position: Vector3Like, heading: number, speed: number, deltaSeconds: number, motion?: ChaseMotion): void {
    const delta = Math.min(0.1, Math.max(0, deltaSeconds));
    const pace = Math.min(1, Math.max(0, speed) / 84);
    let viewHeading = heading;
    if (motion && speed > 8) {
      const travelHeading = Math.atan2(motion.velocity.x, motion.velocity.z);
      const slip = Math.atan2(Math.sin(travelHeading - heading), Math.cos(travelHeading - heading));
      // During a slide follow its travel, so the body rotates visibly in
      // frame and the countersteering front wheel can be seen. Bound the
      // angle to avoid orbiting around a reversing or spinning car.
      viewHeading += Math.max(-0.65, Math.min(0.65, slip)) * Math.min(0.9, motion.drift);
    }
    if (!this.initialized) {
      this.pivot.set(position.x, position.y, position.z);
      this.yaw = viewHeading;
      this.initialized = true;
    } else {
      // Smooth rotation, not translation: damping the pivot adds several
      // metres of follow lag at racing speed and pulls the car out of frame.
      this.pivot.set(position.x, position.y, position.z);
      const turn = Math.atan2(Math.sin(viewHeading - this.yaw), Math.cos(viewHeading - this.yaw));
      this.yaw += turn * (1 - Math.exp(-delta * 20));
    }

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const desiredOffset = motion ? Math.max(-1, Math.min(1, motion.steering)) * pace * 1.3 : 0;
    this.lateralOffset += (desiredOffset - this.lateralOffset) * (delta === 0 ? 1 : 1 - Math.exp(-delta * 8));
    this.camera.position.copy(this.pivot)
      .addScaledVector(this.forward, -Math.sqrt(6.9 ** 2 - this.lateralOffset ** 2))
      .addScaledVector(this.right, this.lateralOffset);
    this.camera.position.y += 2.3 - pace * 0.4;
    const roadBelow = findNearestTrackPoint(this.route, this.camera.position);
    if (!motion?.airborne && Math.hypot(roadBelow.position.x - this.camera.position.x, roadBelow.position.z - this.camera.position.z) < roadBelow.width) {
      this.camera.position.y = Math.max(this.camera.position.y, roadBelow.position.y + 1.5);
    }
    this.target.copy(this.pivot).addScaledVector(this.forward, 5.5);
    this.target.y += 0.75;

    // lookAt already produces the correct rotation with world +Y as up.
    // Editing Euler z afterward corrupts that rotation at some headings.
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    const targetFov = 60 + 22 * pace * pace * (3 - 2 * pace);
    this.camera.fov += (targetFov - this.camera.fov) * (delta === 0 ? 1 : 1 - Math.exp(-delta * 5));
    this.camera.updateProjectionMatrix();
  }

  /**
   * Place the camera in one of the fixed start-line reveal angles.
   *
   * These offsets intentionally use only the car's horizontal heading. The
   * car's pitch/roll never enters the camera transform, and world +Y remains
   * the camera up axis for every shot.
   */
  updateCountdown(
    position: Vector3Like,
    heading: number,
    shot: CountdownCameraShot,
  ): void {
    // The next normal update must re-seed yaw from the car so GO is an exact
    // handoff rather than a turn toward the heading used by a prior shot.
    this.initialized = false;
    this.forward.set(Math.sin(heading), 0, Math.cos(heading));
    this.right.set(-Math.cos(heading), 0, Math.sin(heading));

    switch (shot) {
      case "front-reveal":
        this.setCountdownView(position, 6.8, 3.6, 2.35, 0.35, 0, 0.85);
        break;
      case "rear-chase":
        this.setCountdownView(position, -6.9, 0, 2.3, 4.8, 0, 0.75);
        break;
      case "low-hero":
        this.setCountdownView(position, -5.2, 4.4, 0.85, 1.1, 0, 0.7);
        break;
    }

    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.cinematicTarget);
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
  }

  private setCountdownView(
    position: Vector3Like,
    cameraForward: number,
    cameraSide: number,
    cameraHeight: number,
    targetForward: number,
    targetSide: number,
    targetHeight: number,
  ): void {
    this.cinematicPosition.set(position.x, position.y, position.z)
      .addScaledVector(this.forward, cameraForward)
      .addScaledVector(this.right, cameraSide);
    this.cinematicPosition.y += cameraHeight;
    this.camera.position.copy(this.cinematicPosition);

    this.cinematicTarget.set(position.x, position.y, position.z)
      .addScaledVector(this.forward, targetForward)
      .addScaledVector(this.right, targetSide);
    this.cinematicTarget.y += targetHeight;
  }
}
