import { describe, expect, it } from "vitest";
import { RouteProgress } from "../src/game/progress";

describe("ordered lap progress", () => {
  it("counts three forward laps after crossing all gates and the finish", () => {
    const progress = new RouteProgress(100);
    for (let distance = 1; distance <= 300; distance += 1) progress.update(distance % 100, 1);
    expect(progress.completedLaps).toBe(3);
  });

  it("does not earn laps by reversing or repeatedly crossing the start", () => {
    const progress = new RouteProgress(100);
    for (let distance = 1; distance <= 200; distance += 1) progress.update(-distance, 1);
    for (let iteration = 0; iteration < 50; iteration += 1) {
      progress.update(99, 1);
      progress.update(0, 1);
    }
    expect(progress.completedLaps).toBe(0);
  });

  it("rejects skipped gates, teleports, and crossings outside the road", () => {
    const progress = new RouteProgress(100);
    progress.update(50, 1);
    for (let distance = 51; distance <= 100; distance += 1) progress.update(distance, 1);
    expect(progress.completedLaps).toBe(0);
    progress.reset();
    for (let distance = 1; distance <= 100; distance += 1) progress.update(distance, 1, false);
    expect(progress.completedLaps).toBe(0);
  });
});
