import { describe, expect, it } from "vitest";
import { RaceHud } from "../src/ui/hud";

describe("race and lap record separation", () => {
  it("records race totals without replacing the lap best, and clears both race keys", () => {
    const values = new Map<string, string>();
    const hud = new RaceHud({
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
        removeItem: (key) => { values.delete(key); },
      },
      initialState: { bestLapTimeMs: 10_000 },
    });
    hud.recordBestTime(32_000);
    expect(hud.state.bestLapTimeMs).toBe(10_000);
    expect(hud.state.bestTimes[0].timeMs).toBe(32_000);
    expect(values.size).toBe(2);
    hud.clearBestTimes();
    expect(hud.state.bestTimes).toHaveLength(0);
    expect(values.size).toBe(0);
  });
});
