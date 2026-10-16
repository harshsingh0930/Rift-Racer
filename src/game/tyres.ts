import type { CarState } from "./arcade";

/** Immediate scrub cue plus measured lateral slip; shared by sound and visuals. */
export function tyreSlip(state: CarState): number {
  if (state.speed < 6) return 0;
  const lateral = Math.abs(state.velocity.x * Math.cos(state.heading) - state.velocity.z * Math.sin(state.heading));
  const measured = lateral / Math.max(8, state.speed) * 2.6;
  const scrub = Math.min(1, Math.max(0, (state.speed - 16) / 45)) * Math.abs(state.steering) * 0.32;
  return Math.min(1, Math.max(state.drift, measured, scrub, state.brake * 0.25));
}
