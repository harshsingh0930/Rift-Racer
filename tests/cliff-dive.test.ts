import { describe, expect, it } from "vitest";
import { Mesh, Raycaster, Vector3 } from "three";
import { createCarState } from "../src/game/arcade";
import { CliffDive, getDiveLayout, SEA_LEVEL } from "../src/game/cliff-dive";
import { tyreSound } from "../src/game/audio";
import { SAMPLE_ROUTE, sampleTrackPosition, sampleTrackTangent } from "../src/game/track";
import { createRiftWorld } from "../src/render/world";

describe("cliff to underwater stunt", () => {
  it.each([20, 50, 84])("falls independently of the road and lands inside the tunnel at %s m/s", speed => {
    const dive = new CliffDive(SAMPLE_ROUTE);const layout = getDiveLayout(SAMPLE_ROUTE)!;
    const start = sampleTrackPosition(SAMPLE_ROUTE, layout.gapStart);start.y += 0.045;
    const tangent = sampleTrackTangent(SAMPLE_ROUTE, layout.gapStart).setY(0).normalize();
    let state = createCarState({ position: start, heading: Math.atan2(tangent.x, tangent.z), velocity: tangent.multiplyScalar(speed) });
    expect(dive.tryLaunch(state, layout.gapStart)).toBe(true);
    let splashes = 0;let frames = 0;let highest = start.y;let midFallClearance = 0;let previousDistance = layout.gapStart;
    while (dive.active && frames++ < 600) {
      const result = dive.step(state, { throttle: 1, steer: 0.35 }, 1 / 120);state = result.state;
      if (result.splash) { splashes++;expect(result.splash.y).toBe(SEA_LEVEL); }
      highest = Math.max(highest, state.position.y);
      midFallClearance = Math.max(midFallClearance, state.position.y - sampleTrackPosition(SAMPLE_ROUTE, dive.routeDistance).y);
      expect(dive.routeDistance).toBeGreaterThanOrEqual(previousDistance);previousDistance = dive.routeDistance;
      expect(state.drift).toBe(0);expect(Number.isFinite(state.speed)).toBe(true);
    }
    expect(frames).toBeLessThan(500);expect(splashes).toBe(1);
    expect(highest - state.position.y).toBeGreaterThan(40);
    expect(midFallClearance).toBeGreaterThan(3);
    const landing = sampleTrackPosition(SAMPLE_ROUTE, layout.gapEnd);landing.y += 0.045;
    expect(state.position.distanceTo(landing)).toBeLessThan(0.001);
    expect(state.speed).toBeGreaterThan(35);
    dive.reset();expect(dive.active).toBe(false);expect(dive.tryLaunch(createCarState({ position: start, velocity: { x: 0, y: 0, z: 0 } }), layout.gapStart)).toBe(false);
  });

  it("ends the asphalt and rails at the warning board, leaving a real empty span", () => {
    const world = createRiftWorld({ quality: "eco", scenery: false, environmentCues: false });
    const layout = getDiveLayout(SAMPLE_ROUTE)!;world.updateMatrixWorld(true);
    const road: Mesh[] = [];world.traverse(object => { if (object instanceof Mesh && object.name.startsWith("rift-dark-road")) road.push(object); });
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 5);
    for (const amount of [0.1, 0.3, 0.5, 0.8, 0.95]) {
      const point = sampleTrackPosition(SAMPLE_ROUTE, layout.gapStart + (layout.gapEnd - layout.gapStart) * amount);
      ray.ray.origin.copy(point).y += 2;expect(ray.intersectObjects(road)).toHaveLength(0);
    }
    expect(world.getObjectByName("rift-cliff-front-face")).toBeDefined();world.dispose();
  });

  it("keeps tyre noise silent without grip contact and eases it in with slip", () => {
    expect(tyreSound(70, 1, false).gain).toBe(0);
    expect(tyreSound(2, 1).gain).toBe(0);
    expect(tyreSound(70, 0).toneGain).toBe(0);
    expect(tyreSound(70, 0.4).gain).toBeLessThan(tyreSound(70, 1).gain);
    expect(tyreSound(70, 1).frequency).toBeLessThan(1200);
  });
});
