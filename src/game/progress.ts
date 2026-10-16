/** Ordered route gates keep drifting, reversing and shortcuts from earning laps. */
export class RouteProgress {
  completedLaps = 0;
  private previousDistance = 0;
  private nextGate = 1;

  constructor(readonly length: number, readonly gateCount = 16) {
    if (!Number.isFinite(length) || length <= 0 || !Number.isInteger(gateCount) || gateCount < 2) {
      throw new RangeError("Route progress needs a positive length and at least two gates.");
    }
  }

  reset(distance = 0): void {
    this.completedLaps = 0;
    this.nextGate = 1;
    this.previousDistance = this.wrap(distance);
  }

  update(distance: number, travelDistance: number, onTrack = true): number {
    if (!Number.isFinite(distance) || !Number.isFinite(travelDistance)) return this.completedLaps;
    const current = this.wrap(distance);
    let delta = current - this.previousDistance;
    if (delta > this.length / 2) delta -= this.length;
    if (delta < -this.length / 2) delta += this.length;
    const previous = this.previousDistance;
    this.previousDistance = current;

    // Projection may move a little more than the car around a bend. Large
    // changes mean a reset, teleport or a jump onto a different route span.
    if (!onTrack || delta <= 0 || delta > Math.max(0.5, Math.max(0, travelDistance) * 1.8 + 0.15)) {
      return this.completedLaps;
    }
    for (let count = 0; count < this.gateCount; count += 1) {
      const gateDistance = (this.nextGate % this.gateCount) * this.length / this.gateCount;
      const distanceToGate = this.wrap(gateDistance - previous);
      if (distanceToGate <= 1e-7 || distanceToGate > delta + 1e-7) break;
      this.nextGate += 1;
      if (this.nextGate > this.gateCount) {
        this.completedLaps += 1;
        this.nextGate = 1;
      }
    }
    return this.completedLaps;
  }

  private wrap(distance: number): number {
    return ((distance % this.length) + this.length) % this.length;
  }
}
