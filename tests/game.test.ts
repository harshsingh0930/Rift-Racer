import { describe, expect, it } from "vitest";
import { createCarState, updateCarState } from "../src/game/arcade";
import {
  findNearestTrackPoint,
  SAMPLE_ROUTE,
} from "../src/game/track";
import {
  QUALITY_SETTINGS,
  QUALITY_PROFILE_STORAGE_KEY,
  readQualityProfile,
  recommendQualityTier,
  saveQualityProfile,
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

  it("keeps the WebGL 1-only path in the conservative quality tier", () => {
    expect(recommendQualityTier({
      isBrowser: true,
      devicePixelRatio: 1,
      hardwareConcurrency: 8,
      webgl: true,
      webgl2: false,
      prefersReducedMotion: false,
    })).toBe("eco");
  });

  it("uses Ultra for capable hardware and exposes its expensive rendering flags", () => {
    expect(recommendQualityTier({
      isBrowser: true,
      devicePixelRatio: 2,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      webgl: true,
      webgl2: true,
      maxTextureSize: 4096,
      prefersReducedMotion: false,
    })).toBe("ultra");

    expect(QUALITY_SETTINGS.ultra.resolutionScale).toBeGreaterThan(
      QUALITY_SETTINGS.balanced.resolutionScale,
    );
    expect(QUALITY_SETTINGS.ultra.effectScale).toBeGreaterThan(
      QUALITY_SETTINGS.balanced.effectScale,
    );
    expect(QUALITY_SETTINGS.ultra.realTimeLighting).toBe(true);
    expect(QUALITY_SETTINGS.ultra.realtimeLighting).toBe(true);
    expect(QUALITY_SETTINGS.ultra.shadowQuality).toBe("high");
    expect(QUALITY_SETTINGS.eco.realTimeLighting).toBe(false);
    expect(QUALITY_SETTINGS.eco.shadowQuality).toBe("off");
    expect("high" in QUALITY_SETTINGS).toBe(false);
  });

  it("persists profiles and migrates the old high name to Ultra", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    expect(saveQualityProfile("ultra", storage)).toBe(true);
    expect(values.get(QUALITY_PROFILE_STORAGE_KEY)).toBe("ultra");
    expect(readQualityProfile(storage)).toBe("ultra");

    values.set(QUALITY_PROFILE_STORAGE_KEY, "high");
    expect(readQualityProfile(storage)).toBe("ultra");
    values.set(QUALITY_PROFILE_STORAGE_KEY, "unsupported");
    expect(readQualityProfile(storage)).toBeNull();
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
