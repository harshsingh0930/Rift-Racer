import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, Points, Vector3 } from "three";
import { createCarState } from "../src/game/arcade";
import { SAMPLE_ROUTE, sampleTrackPosition, sampleTrackTangent } from "../src/game/track";
import { createRiftEffects } from "../src/render/effects";

describe("visible driving feedback", () => {
  it("sustains a dense bounded spark shower and lets all streaks expire", () => {
    const effects = createRiftEffects({ quality: "ultra", chevrons: false, maxSkidMarks: 8 });
    for (let burst = 0; burst < 4; burst++) {
      effects.emitSparks(new Vector3(0, 0.65, 0), new Vector3(0, 0, -1), 160);
      effects.update(0.025);
    }
    const positions = effects.sparkStreaks.geometry.getAttribute("position");
    let live = 0;for (let i = 0; i < positions.count; i += 2) if (positions.getY(i) > -100) live++;
    expect(live).toBeGreaterThan(600);expect(positions.count).toBe(4096);
    let left = Infinity;let right = -Infinity;let top = 0;let farthest = 0;
    for (let i = 0; i < positions.count; i += 2) {
      if (positions.getY(i) < -100) continue;
      left = Math.min(left, positions.getX(i));right = Math.max(right, positions.getX(i));top = Math.max(top, positions.getY(i));
      farthest = Math.max(farthest, -positions.getZ(i));
    }
    expect(farthest).toBeGreaterThan((right - left) * 3);
    expect(top).toBeGreaterThan(0.75);expect(top).toBeLessThan(1.2);
    for (let frame = 0; frame < 7; frame++) effects.update(0.1);
    expect(Array.from({ length: positions.count }, (_, i) => positions.getY(i)).every(y => y === -1000)).toBe(true);
    expect(effects.sparks.visible).toBe(false);
    effects.dispose();
  });
  it("draws upward facing, road aligned rubber trails that remain after the drift", () => {
    const effects = createRiftEffects({ chevrons: false, maxSkidMarks: 128, maxSparks: 16 });
    for (let step = 0; step < 30; step += 1) {
      const position = sampleTrackPosition(SAMPLE_ROUTE, 70 + step * 0.3);
      const tangent = sampleTrackTangent(SAMPLE_ROUTE, 70 + step * 0.3);
      effects.update(1 / 60, createCarState({ position, heading: Math.atan2(tangent.x, tangent.z),
        velocity: tangent.clone().multiplyScalar(20), steering: 0.7, drift: 0.9 }));
    }
    const marks = effects.skidMarks.getObjectByName("rift-persistent-tyre-trails") as Mesh;
    const positions = marks.geometry.getAttribute("position");
    const alpha = marks.geometry.getAttribute("trailAlpha");
    expect(alpha.getX(0)).toBeGreaterThan(0.3);
    const a = new Vector3().fromBufferAttribute(positions, 0);
    const b = new Vector3().fromBufferAttribute(positions, 2);
    const c = new Vector3().fromBufferAttribute(positions, 1);
    expect(b.sub(a).cross(c.sub(a)).normalize().y).toBeGreaterThan(0.95);
    expect(a.y).toBeGreaterThan(0);
    for (let step = 0; step < 60; step += 1) effects.update(0.1);
    expect(alpha.getX(0)).toBeGreaterThan(0.3);
    effects.clearEffects();
    expect(alpha.getX(0)).toBe(0);
    effects.dispose();
  });

  it("writes spark positions into the actual geometry buffer", () => {
    const effects = createRiftEffects({ chevrons: false, maxSkidMarks: 8, maxSparks: 16 });
    effects.emitSparks(new Vector3(10, 2, 0), new Vector3(1, 1, 0), 2);
    const positions = effects.sparks.geometry.getAttribute("position");
    const streakPositions = effects.sparkStreaks.geometry.getAttribute("position");
    expect(positions.getX(0)).toBeGreaterThan(9.8);
    expect(positions.getY(0)).toBeGreaterThan(1.8);
    expect(streakPositions.getX(0)).toBeGreaterThan(9.8);
    expect(streakPositions.getX(3)).toBeLessThan(streakPositions.getX(0));
    const first = positions.getX(0);
    effects.update(0.05);
    expect(positions.getX(0)).not.toBe(first);
    expect(streakPositions.getX(0)).not.toBe(first);
    effects.dispose();
  });

  it("renders a pooled spray crown and three expanding ripple rings", () => {
    const effects = createRiftEffects({ chevrons: false, maxSkidMarks: 8, maxSparks: 8 });
    const splash = effects.getObjectByName("rift-water-entry-splash")!;
    const spray = effects.getObjectByName("rift-water-entry-spray") as Points;
    const crown = effects.getObjectByName("rift-water-entry-crown") as Points;
    const firstRipple = effects.getObjectByName("rift-water-entry-ripple-0") as Mesh;
    const secondRipple = effects.getObjectByName("rift-water-entry-ripple-1") as Mesh;
    const thirdRipple = effects.getObjectByName("rift-water-entry-ripple-2") as Mesh;

    effects.emitSplash(new Vector3(12, -1.8, -7));
    effects.update(0.08);
    const firstScale = firstRipple.scale.x;

    expect(splash.visible).toBe(true);
    expect(spray.geometry.getAttribute("position").count).toBe(96);
    expect(crown.geometry.getAttribute("position").count).toBe(48);
    expect(firstRipple.visible).toBe(true);
    expect(secondRipple.visible).toBe(false);
    expect(thirdRipple.visible).toBe(false);

    effects.update(0.1);
    effects.update(0.1);
    expect(firstRipple.scale.x).toBeGreaterThan(firstScale);
    expect(secondRipple.visible).toBe(true);
    expect(thirdRipple.visible).toBe(true);

    effects.clearEffects();
    expect(splash.visible).toBe(false);
    expect(firstRipple.visible).toBe(false);
    effects.dispose();
  });

  it("keeps upright curve signs outside the road and points their arrows into the bend", () => {
    const effects = createRiftEffects({ quality: "eco", chevronSpacing: 3, maxSparks: 8, maxSkidMarks: 8 });
    const markers = effects.chevrons.children.filter(child => child.userData.riftChevron === true);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.length).toBeLessThanOrEqual(24);
    for (const marker of markers) {
      const distance = marker.userData.routeDistance;
      const tangent = sampleTrackTangent(SAMPLE_ROUTE, distance);
      const ahead = sampleTrackTangent(SAMPLE_ROUTE, distance + 28);
      const side = new Vector3().crossVectors(new Vector3(0, 1, 0), tangent).normalize();
      const lateral = marker.position.clone().sub(sampleTrackPosition(SAMPLE_ROUTE, distance)).dot(side);
      expect(Math.abs(lateral)).toBeGreaterThan(8);
      expect(lateral * tangent.clone().cross(ahead).y).toBeLessThan(0);
      expect(new Vector3(0, 1, 0).applyQuaternion(marker.quaternion).y).toBeCloseTo(1);
      const arrows = marker.children.filter(child => child.name === "rift-bend-direction-arrow");
      expect(arrows).toHaveLength(2);
      expect(Math.sign(arrows[0].scale.x)).toBe(Math.sign(tangent.clone().cross(ahead).y));
    }
    const marker = markers[0];
    const sweep = marker.getObjectByName("rift-chevron-sweep") as Mesh;
    const material = sweep.material as MeshBasicMaterial;
    const initialOpacity = material.opacity;
    const initialPosition = marker.position.clone();
    effects.update(0.1);
    expect(material.opacity).not.toBe(initialOpacity);
    expect(marker.position.equals(initialPosition)).toBe(true);
    expect(marker.scale.x).toBe(1);
    effects.dispose();
  });

  it("emits visible rear tyre haze for steering slip and clears it after recovery", () => {
    const effects = createRiftEffects({ quality: "eco", chevrons: false, maxSkidMarks: 128 });
    const state = createCarState({ position: { x: 0, y: 0.045, z: 0 }, velocity: { x: 6, y: 0, z: 40 }, steering: 0.8, drift: 0.7 });
    const wheels = [new Vector3(-1, 0.045, 1), new Vector3(1, 0.045, 1), new Vector3(-1, 0.045, -1), new Vector3(1, 0.045, -1)];
    for (let frame = 0; frame < 15; frame++) effects.update(1 / 60, state, { wheelPositions: wheels });
    const smoke = effects.getObjectByName("rift-drift-tyre-smoke") as Mesh;
    const alpha = smoke.geometry.getAttribute("puffAlpha");
    expect(Array.from(alpha.array).some(value => value > 0.15 && value < 0.4)).toBe(true);
    for (let frame = 0; frame < 15; frame++) effects.update(0.1);
    expect(Array.from(alpha.array).every(value => value === 0)).toBe(true);
    effects.dispose();
  });
});
