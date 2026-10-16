import { Vector3 } from "three";
import { cloneCarState, type ArcadeInput, type CarState } from "./arcade";
import { sampleTrackPosition, sampleTrackTangent, sampleTrackWidth, type TrackRoute } from "./track";

export const SEA_LEVEL = -1.8;
const GRAVITY = 9.81;

export function getDiveLayout(route: TrackRoute) {
  const launch = route.segments.find(segment => segment.section === "cliff-dive");
  const landing = route.segments.find(segment => segment.section === "underwater");
  if (!launch || !landing) return undefined;
  const boardDistance = launch.startDistance;
  return { boardDistance, boundary: landing.startDistance, approachStart: boardDistance - 85,
    entranceDistance: landing.startDistance + 1, gapStart: boardDistance, gapEnd: landing.startDistance };
}

export function isDiveGap(route: TrackRoute, distance: number): boolean {
  const layout = getDiveLayout(route);
  return !!layout && distance >= layout.gapStart && distance < layout.gapEnd;
}

/** Gravity drives the fall; a bounded arcade flight path lines up the tunnel mouth. */
export class CliffDive {
  readonly layout;
  active = false;
  submerged = false;
  routeDistance = 0;
  pitch = 0;
  private elapsed = 0;
  private duration = 1;
  private launchHeight = 0;
  private entrySlope = 1;
  private exitSlope = 1;
  private lateral = 0;
  private used = false;
  private previousDistance = 0;
  private didSplash = false;

  constructor(private readonly route: TrackRoute, private readonly lift = 0.045) {
    this.layout = getDiveLayout(route);
  }

  reset(): void {
    this.active = this.submerged = this.used = this.didSplash = false;
    this.elapsed = this.pitch = this.previousDistance = this.routeDistance = 0;
  }

  tryLaunch(state: CarState, distance: number): boolean {
    const layout = this.layout;
    if (!layout || this.active) return false;
    if (distance < 40 && this.previousDistance > this.route.totalLength - 80) this.used = false;
    this.previousDistance = distance;
    if (this.used || distance < layout.gapStart - 0.35 || distance > layout.gapStart + 8) return false;
    const tangent = sampleTrackTangent(this.route, layout.gapStart);
    if (state.velocity.dot(tangent) <= 0.5) return false;
    this.active = this.used = true;this.submerged = this.didSplash = false;this.elapsed = 0;
    this.launchHeight = sampleTrackPosition(this.route, layout.gapStart).y + this.lift;
    const landingHeight = sampleTrackPosition(this.route, layout.gapEnd).y + this.lift;
    this.duration = (1.5 + Math.sqrt(1.5 ** 2 + 2 * GRAVITY * Math.max(1, this.launchHeight - landingHeight))) / GRAVITY;
    const gapLength = layout.gapEnd - layout.gapStart;
    this.entrySlope = Math.max(0.15, Math.min(1.45, state.speed * this.duration / gapLength));
    this.exitSlope = Math.max(0.65, Math.min(1.3, Math.max(40, state.speed * 0.9) * this.duration / gapLength));
    const side = new Vector3().crossVectors(new Vector3(0, 1, 0), tangent).normalize();
    this.lateral = Math.max(-3, Math.min(3, state.position.clone().sub(sampleTrackPosition(this.route, layout.gapStart)).dot(side)));
    this.routeDistance = layout.gapStart;
    return true;
  }

  step(state: CarState, input: ArcadeInput, delta: number): { state: CarState; splash?: Vector3; landed: boolean } {
    if (!this.active || !this.layout) return { state, landed: false };
    const next = cloneCarState(state);
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, delta));
    const t = this.elapsed / this.duration;
    const progress = (-2 * t ** 3 + 3 * t ** 2) + (t ** 3 - 2 * t ** 2 + t) * this.entrySlope + (t ** 3 - t ** 2) * this.exitSlope;
    this.routeDistance = this.layout.gapStart + progress * (this.layout.gapEnd - this.layout.gapStart);
    const tangent = sampleTrackTangent(this.route, this.routeDistance);
    const side = new Vector3().crossVectors(new Vector3(0, 1, 0), tangent).normalize();
    this.lateral += Math.max(-1, Math.min(1, input.steer ?? 0)) * Math.max(0, delta) * 1.4;
    this.lateral = Math.max(-3, Math.min(3, this.lateral));
    next.position.copy(sampleTrackPosition(this.route, this.routeDistance)).addScaledVector(side, this.lateral * (1 - t * t));
    next.position.y = this.launchHeight + 1.5 * this.elapsed - 0.5 * GRAVITY * this.elapsed ** 2;
    next.velocity.copy(next.position).sub(state.position).divideScalar(Math.max(1e-6, delta));
    next.speed = next.velocity.length();next.drift = 0;next.steering *= Math.exp(-delta * 6);
    const heading = Math.atan2(tangent.x, tangent.z);
    const turn = Math.atan2(Math.sin(heading - next.heading), Math.cos(heading - next.heading));
    next.heading += turn * (1 - Math.exp(-delta * 6));
    this.pitch = Math.max(-0.55, Math.min(0.08, Math.atan2(1.5 - GRAVITY * this.elapsed, Math.max(20, Math.hypot(next.velocity.x, next.velocity.z)))));
    let splash: Vector3 | undefined;
    this.submerged = next.position.y < SEA_LEVEL;
    if (this.submerged && !this.didSplash) {
      this.didSplash = true;splash = next.position.clone();splash.y = SEA_LEVEL;
    }
    const landed = t >= 1;
    if (landed) {
      this.active = false;
      next.position.copy(sampleTrackPosition(this.route, this.layout.gapEnd)).y += this.lift;
      next.velocity.copy(tangent).setY(0).normalize().multiplyScalar(Math.max(40, Math.min(84, this.exitSlope * (this.layout.gapEnd - this.layout.gapStart) / this.duration)));
      next.speed = next.velocity.length();next.heading = heading;
    }
    return { state: next, splash, landed };
  }
}
