import { Vector3 } from "three";
import { findNearestTrackPoint, type TrackRoute } from "./track";
import type { CarState } from "./arcade";

const UP = new Vector3(0, 1, 0);

/** Slide along the barrier, accounting for the turned car's actual footprint. */
export function constrainCarToRoad(route: TrackRoute, state: CarState, roadLift = 0.045) {
  const nearest = findNearestTrackPoint(route, state.position);
  const side = new Vector3().crossVectors(UP, nearest.tangent).normalize();
  const forward = new Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
  const alongSide = Math.abs(side.dot(forward));
  const hullHalfWidth = alongSide * 2.05 + Math.sqrt(Math.max(0, 1 - alongSide ** 2)) * 1.08;
  const safeWidth = Math.max(1, nearest.width * 0.5 - hullHalfWidth - 0.12);
  const lateral = state.position.clone().sub(nearest.position).dot(side);
  const penetration = Math.abs(lateral) - safeWidth;
  const position = state.position.clone();
  const velocity = state.velocity.clone();
  const outward = side.multiplyScalar(Math.sign(lateral) || 1);
  const impactSpeed = Math.max(0, velocity.dot(outward));
  if (penetration > 0) {
    position.addScaledVector(outward, -penetration);
    // Reflecting this component made sustained divider contact oscillate.
    velocity.addScaledVector(outward, -impactSpeed);
  }
  position.y = nearest.position.y + roadLift;
  const contact = penetration > -0.08 && state.speed > 2 ? {
    position: nearest.position.clone().addScaledVector(outward, nearest.width * 0.5 - 0.06).addScaledVector(UP, 0.48),
    direction: velocity.clone().normalize().multiplyScalar(-1).addScaledVector(outward, -0.7).setY(0.5),
    impactSpeed,
  } : undefined;
  return { state: { ...state, position, velocity, speed: velocity.length() }, nearest, contact };
}
