import { describe, expect, it } from "vitest";
import { tyreSound, vehicleSound } from "../src/game/audio";

describe("driving sound response", () => {
  it("keeps gentle steering a quiet scrub and brings in squeal only after traction breaks", () => {
    const scrub = tyreSound(65, 0.18);const slide = tyreSound(65, 0.85);
    expect(scrub.gain).toBeGreaterThan(0);
    expect(scrub.toneGain).toBe(0);expect(scrub.overtoneGain).toBe(0);
    expect(slide.gain).toBeGreaterThan(scrub.gain);
    expect(slide.toneGain).toBeGreaterThan(0.08);
    for (const sound of [tyreSound(0, 1), tyreSound(65, 1, false), tyreSound(65, 0)]) {
      expect(sound.gain + sound.toneGain + sound.overtoneGain).toBe(0);
    }
  });
  it("keeps sustained high revs quieter and limits harsh exhaust harmonics", () => {
    const launch = vehicleSound(20, 1, 3000, 0);
    const high = vehicleSound(80, 1, 8400, 0);
    expect(high.engineGain).toBeLessThan(launch.engineGain * 0.5);
    expect(high.exhaustCutoff).toBeLessThanOrEqual(1250);
    expect(high.firingHz).toBeGreaterThan(launch.firingHz);
  });
  it("raises exhaust pitch with engine revs and opens the exhaust under throttle", () => {
    const idle = vehicleSound(0, 0, 950, 0);
    const revving = vehicleSound(70, 1, 7500, 0);
    const coasting = vehicleSound(70, 0, 7500, 0);
    expect(revving.firingHz).toBeGreaterThan(idle.firingHz * 6);
    expect(revving.exhaustCutoff).toBeGreaterThan(coasting.exhaustCutoff);
    expect(revving.engineGain).toBeGreaterThan(coasting.engineGain);
    expect(revving.intakeGain).toBeGreaterThan(0);
    expect(coasting.intakeGain).toBe(0);
  });

  it("makes brake friction audible while moving and silent at rest or in the air", () => {
    expect(vehicleSound(65, 0, 4500, 1).brakeGain).toBeGreaterThan(0.05);
    expect(vehicleSound(65, 0, 4500, 0).brakeGain).toBe(0);
    expect(vehicleSound(0, 0, 950, 1).brakeGain).toBe(0);
    expect(vehicleSound(65, 0, 4500, 1, false).brakeGain).toBe(0);
    expect(tyreSound(65, 0.9).gain).toBeGreaterThan(tyreSound(65, 0.2).gain);
    expect(tyreSound(65, 0.9, false).gain).toBe(0);
  });
});
