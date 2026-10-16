export type AutomaticGear = 1 | 2 | 3 | 4 | 5 | 6 | "R";
export type TransmissionState = Readonly<{ gear: AutomaticGear; rpm: number }>;

const GEAR_LIMITS_KMH = [60, 100, 150, 205, 260, 320];

/** Display and audio revs follow a six-speed automatic with shift hysteresis. */
export class AutomaticTransmission {
  private gear = 1;
  private rpm = 950;
  private shiftCooldown = 0;

  reset(): void {
    this.gear = 1;
    this.rpm = 950;
    this.shiftCooldown = 0;
  }

  update(signedSpeedMps: number, throttle: number, deltaSeconds: number): TransmissionState {
    const delta = Math.min(0.1, Math.max(0, deltaSeconds));
    const speedKmh = Math.abs(signedSpeedMps) * 3.6;
    this.shiftCooldown = Math.max(0, this.shiftCooldown - delta);
    const reversing = signedSpeedMps < -0.3 || (speedKmh < 1 && throttle < 0);
    if (!reversing && this.shiftCooldown === 0) {
      const revs = speedKmh / GEAR_LIMITS_KMH[this.gear - 1] * 8_000;
      if (revs > 7_300 && this.gear < 6) {
        this.gear += 1;
        this.shiftCooldown = 0.22;
      } else if (revs < 3_200 && this.gear > 1) {
        this.gear -= 1;
        this.shiftCooldown = 0.22;
      }
    }
    if (speedKmh < 2) this.gear = 1;
    const roadRevs = speedKmh / (reversing ? 38 : GEAR_LIMITS_KMH[this.gear - 1]) * 8_000;
    const launchRevs = speedKmh < 18 ? Math.max(0, throttle) * 1_350 : 0;
    const target = Math.max(950 + launchRevs, Math.min(8_400, roadRevs));
    this.rpm += (target - this.rpm) * (1 - Math.exp(-delta * 14));
    return { gear: reversing ? "R" : this.gear as AutomaticGear, rpm: this.rpm };
  }
}
