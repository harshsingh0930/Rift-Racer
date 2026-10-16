import { Quaternion, Vector3 } from "three";

export interface WoodShard {
  position: Vector3;
  velocity: Vector3;
  rotation: Quaternion;
  angularVelocity: Vector3;
  size: Vector3;
  floatRotation: Quaternion;
  wet: boolean;
  impactSpeed: number;
}

const angularStep = new Quaternion();
const angularAxis = new Vector3();

/** Advance one independent shard. Returns true exactly once at water contact. */
export function stepWoodShard(shard: WoodShard, delta: number, surfaceHeight: number): boolean {
  if (delta <= 0) return false;
  let entered = false;
  if (!shard.wet) {
    const airDrag = Math.exp(-0.06 * delta);
    shard.velocity.x *= airDrag;shard.velocity.z *= airDrag;
    shard.velocity.y -= 9.81 * delta;
    shard.position.addScaledVector(shard.velocity, delta);
    if (shard.position.y <= surfaceHeight) {
      shard.wet = true;entered = true;shard.impactSpeed = Math.max(0, -shard.velocity.y);
      // Water takes away momentum rather than moving the piece to a preset point.
      shard.velocity.multiplyScalar(0.22);
      shard.angularVelocity.multiplyScalar(0.35);
    }
  } else {
    const halfThickness = Math.max(0.07, shard.size.z * 0.5);
    const immersion = Math.max(0, Math.min(1, (surfaceHeight + halfThickness - shard.position.y) / (halfThickness * 2)));
    const lift = 9.81 * (immersion / 0.55 - 1);
    shard.velocity.y += lift * delta;
    shard.velocity.y *= Math.exp(-7 * immersion * delta);
    const drag = Math.exp(-2.6 * immersion * delta);
    shard.velocity.x *= drag;shard.velocity.z *= drag;
    shard.position.addScaledVector(shard.velocity, delta);
    shard.angularVelocity.multiplyScalar(Math.exp(-5 * immersion * delta));
    shard.rotation.slerp(shard.floatRotation, 1 - Math.exp(-3 * immersion * delta));
  }
  const angularSpeed = shard.angularVelocity.length();
  if (angularSpeed > 0.0001) {
    angularAxis.copy(shard.angularVelocity).multiplyScalar(1 / angularSpeed);
    angularStep.setFromAxisAngle(angularAxis, angularSpeed * delta);
    shard.rotation.premultiply(angularStep).normalize();
  }
  return entered;
}
