import { describe, expect, it } from "vitest";
import { createCarState, updateCarState } from "../src/game/arcade";
import { createInputState, createKeyboardInput, toArcadeInput, type KeyboardEventLike } from "../src/input/keyboard";

describe("keyboard steering semantics", () => {
  it("makes short taps subtle, builds steering when held and centres promptly on release", () => {
    const initial = createCarState({ velocity: { x: 0, y: 0, z: 70 } });
    let tap = initial;
    for (let frame = 0; frame < 5; frame++) tap = updateCarState(tap, { steer: 1, throttle: 1 }, 1 / 60);
    expect(tap.steering).toBeGreaterThan(0.1);
    expect(tap.steering).toBeLessThan(0.25);
    expect(Math.abs(tap.heading)).toBeLessThan(0.025);
    expect(tap.drift).toBeLessThan(0.1);
    let held = tap;
    for (let frame = 0; frame < 25; frame++) held = updateCarState(held, { steer: 1, throttle: 1 }, 1 / 60);
    expect(held.steering).toBeGreaterThan(0.95);
    for (let frame = 0; frame < 12; frame++) held = updateCarState(held, { throttle: 1 }, 1 / 60);
    expect(held.steering).toBe(0);
  });
  it("releases held movement keys on blur while retaining the light toggle", () => {
    const listeners = new Map<string, (event: KeyboardEventLike) => void>();
    const keyboard = createKeyboardInput({ target: {
      addEventListener: (type, listener) => { listeners.set(type, listener); },
      removeEventListener: (type) => { listeners.delete(type); },
    } });
    listeners.get("keydown")?.({ code: "KeyW" });
    listeners.get("keydown")?.({ code: "ArrowLeft" });
    listeners.get("keydown")?.({ code: "KeyL" });
    expect(keyboard.snapshot().throttle).toBe(1);
    listeners.get("blur")?.({});
    expect(keyboard.snapshot().throttle).toBe(0);
    expect(keyboard.snapshot().steering).toBe(0);
    expect(keyboard.snapshot().headlightsEnabled).toBe(true);
    keyboard.dispose();
    expect(listeners.size).toBe(0);
  });
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
