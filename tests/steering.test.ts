import { describe, expect, it } from "vitest";
import { createCarState, updateCarState } from "../src/game/arcade";
import { createInputState, toArcadeInput } from "../src/input/keyboard";

describe("keyboard steering semantics", () => {
  it.each([
    ["ArrowLeft", -1],
    ["KeyA", -1],
    ["ArrowRight", 1],
    ["KeyD", 1],
  ])("maps %s to the expected steering direction", (code, steering) => {
    const state = createInputState([code]);

    expect(state.steering).toBe(steering);
    expect(state.steer).toBe(steering);
  });

  it("turns left and right as seen from the chase camera", () => {
    const initial = createCarState({ velocity: { x: 0, y: 0, z: 20 } });
    const deltaSeconds = 0.1;
    const left = updateCarState(
      initial,
      toArcadeInput(createInputState(["ArrowLeft"])),
      deltaSeconds,
    );
    const right = updateCarState(
      initial,
      toArcadeInput(createInputState(["ArrowRight"])),
      deltaSeconds,
    );

    // Heading zero is +Z. The chase camera sits behind the car, so -X is
    // screen-right and +X is screen-left at this heading.
    expect(left.heading).toBeGreaterThan(0);
    expect(left.position.x).toBeGreaterThan(0);
    expect(right.heading).toBeLessThan(0);
    expect(right.position.x).toBeLessThan(0);
  });
});
