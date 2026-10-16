import { Vector3 } from "three";
import { findNearestTrackPoint, type TrackRoute } from "./track";
import type { CarState } from "./arcade";

const UP = new Vector3(0, 1, 0);

/** Slide along the barrier, accounting for the turned car's actual footprint. */
export function constrainCarToRoad(route: TrackRoute, state: CarState, roadLift = 0.045,
  nearest = findNearestTrackPoint(route, state.position)) {
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
  const railTangent = nearest.tangent.clone().setY(0).normalize();
  const carRight = new Vector3(Math.cos(state.heading), 0, -Math.sin(state.heading));
  const facingRail = forward.dot(outward);
  // The leading outer corner touches first when angled into a barrier. When
  // parallel, use the side panel rather than inventing a point behind the car.
  const hullContact = position.clone()
    .addScaledVector(forward, Math.abs(facingRail) > 0.025 ? Math.sign(facingRail) * 2.05 : 0)
    .addScaledVector(carRight, Math.sign(carRight.dot(outward)) * 1.08);
  const contactAlongRail = hullContact.sub(nearest.position).dot(railTangent);
  const travelSign = Math.sign(state.velocity.dot(railTangent)) || 1;
  const contact = penetration > -0.08 && state.speed > 6 ? {
    position: nearest.position.clone().addScaledVector(outward, nearest.width * 0.5 - 0.10)
      .addScaledVector(nearest.tangent, contactAlongRail).addScaledVector(UP, 0.63),
    direction: railTangent.multiplyScalar(-travelSign).addScaledVector(outward, -0.035).normalize(),
    impactSpeed,
  } : undefined;
  return { state: { ...state, position, velocity, speed: velocity.length() }, nearest, contact };
}
