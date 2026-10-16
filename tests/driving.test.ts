import { describe, expect, it } from "vitest";
import { createCarState, updateCarState } from "../src/game/arcade";
import { AutomaticTransmission } from "../src/game/transmission";
import { constrainCarToRoad } from "../src/game/road-contact";
import { createTrackRoute } from "../src/game/track";
import { Vector3 } from "three";

describe("road speed and coasting", () => {
  it("holds gentle high-speed corrections and regains grip promptly after a slide", () => {
    let gentle = createCarState({ velocity: { x: 0, y: 0, z: 70 } });
    for (let frame = 0; frame < 60; frame++) gentle = updateCarState(gentle, { throttle: 1, steer: 0.2 }, 1 / 60);
    expect(gentle.drift).toBeLessThan(0.1);
    let slide = createCarState({ velocity: { x: 0, y: 0, z: 70 } });
    for (let frame = 0; frame < 45; frame++) slide = updateCarState(slide, { throttle: 1, steer: 1 }, 1 / 60);
    expect(slide.drift).toBeGreaterThan(0.4);
    for (let frame = 0; frame < 45; frame++) slide = updateCarState(slide, { throttle: 1 }, 1 / 60);
    const travelHeading = Math.atan2(slide.velocity.x, slide.velocity.z);
    const slip = Math.abs(Math.atan2(Math.sin(travelHeading - slide.heading), Math.cos(travelHeading - slide.heading)));
    expect(slide.steering).toBe(0);expect(slide.drift).toBeLessThan(0.15);
    expect(slip).toBeLessThan(0.1);
  });
  it("breaks traction under hard high-speed steering without a handbrake and recovers when released", () => {
    let fast = createCarState({ velocity: { x: 0, y: 0, z: 250 / 3.6 } });
    let slow = createCarState({ velocity: { x: 0, y: 0, z: 18 } });
    for (let frame = 0; frame < 45; frame += 1) {
      fast = updateCarState(fast, { steer: 1, throttle: 1 }, 1 / 60);
      slow = updateCarState(slow, { steer: 1 }, 1 / 60);
    }
    expect(fast.drift).toBeGreaterThan(0.4);
    expect(slow.drift).toBeLessThan(0.1);
    const peakDrift = fast.drift;
    for (let frame = 0; frame < 180; frame += 1) fast = updateCarState(fast, {}, 1 / 60);
    expect(fast.drift).toBeLessThan(peakDrift * 0.2);
  });
  it("uses Down as a brake in forward motion, assists a steered drift, then permits reverse", () => {
    const initial = createCarState({ velocity: { x: 0, y: 0, z: 60 } });
    const braked = updateCarState(initial, { throttle: -1 }, 0.1);
    expect(braked.velocity.z).toBeGreaterThan(0);
    expect(braked.speed).toBeLessThan(58);
    expect(braked.brake).toBe(1);
    expect(braked.throttle).toBe(0);
    const drifted = updateCarState(initial, { throttle: -1, steer: 1 }, 0.1);
    expect(drifted.drift).toBeGreaterThan(0.5);
    expect(drifted.heading).toBeLessThan(0);
    let reversing = createCarState();
    for (let frame = 0; frame < 60; frame += 1) reversing = updateCarState(reversing, { throttle: -1 }, 1 / 60);
    expect(reversing.velocity.z).toBeLessThan(-5);
  });

  it("retains enough steering authority at 250 km/h without introducing unrequested straight-line wobble", () => {
    const initial = createCarState({ velocity: { x: 0, y: 0, z: 250 / 3.6 } });
    let turn = initial;
    let straight = initial;
    for (let frame = 0; frame < 60; frame += 1) {
      turn = updateCarState(turn, { throttle: 1, steer: 1 }, 1 / 60);
      straight = updateCarState(straight, { throttle: 1 }, 1 / 60);
    }
    expect(turn.heading).toBeLessThan(-0.6);
    expect(turn.position.x).toBeLessThan(-15);
    expect(straight.heading).toBe(0);
    expect(straight.velocity.x).toBe(0);
  });
  it("slides along a divider without bouncing and exposes the visible spark contact", () => {
    const route = createTrackRoute([
      { position: new Vector3(0, 0, 0), width: 12, section: "coastal-boulevard" },
      { position: new Vector3(0, 0, 100), width: 12, section: "coastal-boulevard" },
    ], false);
    const result = constrainCarToRoad(route, createCarState({
      position: { x: 5.7, y: 0.045, z: 20 }, velocity: { x: 12, y: 0, z: 70 },
    }));
    expect(result.state.position.x).toBeLessThan(4.9);
    expect(result.state.velocity.x).toBeCloseTo(0);
    expect(result.state.velocity.z).toBe(70);
    expect(result.contact?.position.x).toBeCloseTo(5.9);
    expect(result.contact?.position.y).toBeCloseTo(0.63);
    expect(result.contact?.position.z).toBeCloseTo(20);
    expect(result.contact!.direction.z).toBeLessThan(-0.99);
  });

  it("emits at the leading body corner during an angled scrape and trails opposite rail travel", () => {
    const route = createTrackRoute([
      { position: new Vector3(0, 0, 0), width: 12, section: "coastal-boulevard" },
      { position: new Vector3(0, 0, 100), width: 12, section: "coastal-boulevard" },
    ], false);
    const state = createCarState({ position: { x: 5.5, y: 0.045, z: 30 },
      heading: Math.PI / 8, velocity: { x: 10, y: 0, z: 60 } });
    const scrape = constrainCarToRoad(route, state);
    expect(scrape.contact!.position.x).toBeCloseTo(5.9);
    expect(scrape.contact!.position.z).toBeGreaterThan(31);
    expect(scrape.contact!.position.z).toBeLessThan(32);
    expect(scrape.contact!.direction.z).toBeLessThan(-0.99);
    state.velocity.z = -60;
    expect(constrainCarToRoad(route, state).contact!.direction.z).toBeGreaterThan(0.99);
  });

  it("travels actual metres at 250 km/h and retains momentum when throttle is released", () => {
    const speed = 250 / 3.6;
    let car = createCarState({ velocity: { x: 0, y: 0, z: speed } });
    for (let frame = 0; frame < 60; frame += 1) car = updateCarState(car, {}, 1 / 60);
    expect(car.position.z).toBeGreaterThan(67);
    expect(car.speed * 3.6).toBeGreaterThan(238);
    expect(car.speed * 3.6).toBeLessThan(250);
  });

  it("brakes substantially harder than coasting and reaches genuine high road speed", () => {
    let driven = createCarState();
    let braking = createCarState({ velocity: { x: 0, y: 0, z: 250 / 3.6 } });
    for (let frame = 0; frame < 420; frame += 1) {
      driven = updateCarState(driven, { throttle: 1 }, 1 / 60);
      if (frame < 60) braking = updateCarState(braking, { brake: 1 }, 1 / 60);
    }
    expect(driven.speed * 3.6).toBeGreaterThan(290);
    expect(driven.position.z).toBeGreaterThan(310);
    expect(braking.speed * 3.6).toBeLessThan(175);
  });

  it("shifts up and down without hunting and displays reverse", () => {
    const transmission = new AutomaticTransmission();
    const seen = new Set<number | string>();
    let state = transmission.update(0, 0, 1 / 60);
    expect(state.gear).toBe(1);
    for (let frame = 0; frame < 900; frame += 1) {
      state = transmission.update(Math.min(84, frame * 0.12), 1, 1 / 60);
      seen.add(state.gear);
    }
    expect([...seen]).toEqual([1, 2, 3, 4, 5, 6]);
    for (let frame = 0; frame < 90; frame += 1) {
      state = transmission.update(70, 0, 1 / 60);
      expect(state.gear).toBe(6);
      expect(state.rpm).toBeGreaterThan(1_000);
    }
    expect(transmission.update(-2, -1, 1 / 60).gear).toBe("R");
    transmission.reset();
    expect(transmission.update(0, 0, 1 / 60).gear).toBe(1);
  });
});
