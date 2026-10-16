import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { stepWoodShard, type WoodShard } from "../src/game/wood-debris";

function shard(height = 32, upwardSpeed = 1.5): WoodShard {
  return { position: new Vector3(0, height, 0), velocity: new Vector3(0, upwardSpeed, 55),
    rotation: new Quaternion(), angularVelocity: new Vector3(2, 1, 3), size: new Vector3(1.4, 0.32, 0.14),
    floatRotation: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2), wet: false, impactSpeed: 0 };
}

describe("individual wooden debris physics", () => {
  it("carries impact momentum, falls under gravity and enters water at different times", () => {
    const low = shard(32, 0.6);const high = shard(34, 3.5);
    let lowEntry = -1;let highEntry = -1;
    for (let frame = 0; frame < 500; frame++) {
      if (stepWoodShard(low, 1 / 120, -1.8)) lowEntry = frame;
      if (stepWoodShard(high, 1 / 120, -1.8)) highEntry = frame;
    }
    expect(lowEntry).toBeGreaterThan(250);expect(highEntry).toBeGreaterThan(lowEntry + 25);
    expect(low.position.z).toBeGreaterThan(100);
    expect(low.impactSpeed).toBeGreaterThan(20);expect(low.wet).toBe(true);
  });

  it("slows and dips on impact, then floats instead of snapping to the surface", () => {
    const piece = shard(-1.7, -24);piece.velocity.z = 40;
    expect(stepWoodShard(piece, 1 / 120, -1.8)).toBe(true);
    expect(piece.position.y).toBeLessThan(-1.8);
    expect(piece.velocity.z).toBeLessThan(10);
    let depth = piece.position.y;let impacts = 1;
    for (let frame = 0; frame < 1200; frame++) {
      if (stepWoodShard(piece, 1 / 120, -1.8)) impacts++;
      depth = Math.min(depth, piece.position.y);
    }
    expect(impacts).toBe(1);expect(depth).toBeLessThan(-1.9);
    expect(Math.abs(piece.position.y + 1.8)).toBeLessThan(0.06);
    expect(piece.velocity.length()).toBeLessThan(0.1);
    expect(piece.rotation.angleTo(piece.floatRotation)).toBeLessThan(0.02);
  });
});
