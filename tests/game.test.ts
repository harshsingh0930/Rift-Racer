import { describe, expect, it } from "vitest";
import { createCarState, updateCarState } from "../src/game/arcade";
import {
  findNearestTrackPoint,
  sampleTrackPosition,
  sampleTrackTangent,
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

  it("keeps the expanded route long, closed, and sectioned", () => {
    expect(SAMPLE_ROUTE.closed).toBe(true);
    expect(SAMPLE_ROUTE.totalLength).toBeGreaterThan(2_500);

    const sections = new Set(SAMPLE_ROUTE.segments.map((segment) => segment.section));
    expect(sections).toEqual(new Set([
      "coastal-boulevard",
      "causeway",
      "tunnel",
      "cliff-dive",
      "underwater",
      "final-skyline",
    ]));

    const start = sampleTrackPosition(SAMPLE_ROUTE, 0);
    const wrappedEnd = sampleTrackPosition(SAMPLE_ROUTE, SAMPLE_ROUTE.totalLength);
    expect(start.distanceTo(wrappedEnd)).toBeLessThan(0.001);

    const beforeStart = sampleTrackTangent(SAMPLE_ROUTE, SAMPLE_ROUTE.totalLength - 0.1);
    const afterStart = sampleTrackTangent(SAMPLE_ROUTE, 0.1);
    expect(beforeStart.dot(afterStart)).toBeGreaterThan(0.97);
  });

  it("keeps distant road corridors apart or provides flyover clearance", () => {
    const points = SAMPLE_ROUTE.points;
    for (let i = 0; i < points.length; i += 3) {
      for (let j = i + 3; j < points.length; j += 3) {
        const along = SAMPLE_ROUTE.segments[j].startDistance - SAMPLE_ROUTE.segments[i].startDistance;
        if (Math.min(along, SAMPLE_ROUTE.totalLength - along) < 55) continue;
        const a = points[i];
        const b = points[j];
        const horizontal = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
        if (horizontal > (a.width + b.width) * 0.5 + 1) continue;
        expect(Math.abs(a.position.y - b.position.y), `road overlap at spans ${i} and ${j}`).toBeGreaterThan(10);
      }
    }
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

    expect(QUALITY_SETTINGS.ultra.resolutionScale).toBe(1);
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
