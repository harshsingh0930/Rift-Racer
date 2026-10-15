import { describe, expect, it } from "vitest";
import { createCarState, updateCarState } from "../src/game/arcade";
import {
  findNearestTrackPoint,
  SAMPLE_ROUTE,
} from "../src/game/track";
import {
  QUALITY_SETTINGS,
  recommendQualityTier,
} from "../src/game/performance";
import {
  readBestTime,
  saveBestTime,
  type StorageLike,
} from "../src/game/storage";

describe("game foundations", () => {
  it("advances the car with forward throttle", () => {
    const initial = createCarState();
    const next = updateCarState(initial, { throttle: 1 }, 0.25);

    expect(next.position.z).toBeGreaterThan(0);
    expect(next.speed).toBeGreaterThan(0);
  });

  it("finds the start of the sample route", () => {
    const nearest = findNearestTrackPoint(SAMPLE_ROUTE, { x: 0, y: 0, z: 0 });

    expect(nearest.distanceFromTrack).toBeCloseTo(0);
    expect(nearest.section).toBe("coastal-boulevard");
  });

  it("keeps conservative quality defaults for unavailable WebGL", () => {
    expect(recommendQualityTier({
      isBrowser: false,
      devicePixelRatio: 1,
      hardwareConcurrency: 8,
      webgl: false,
      webgl2: false,
      prefersReducedMotion: false,
    })).toBe("eco");
    expect(QUALITY_SETTINGS.eco.maxParticles).toBe(700);
  });

  it("only replaces a stored best time when the new time is faster", () => {
    const values = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };

    expect(saveBestTime(12_000, storage)).toBe(true);
    expect(saveBestTime(13_000, storage)).toBe(false);
    expect(saveBestTime(11_000, storage)).toBe(true);
    expect(readBestTime(storage)).toBe(11_000);
  });
});
