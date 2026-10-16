import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { ChaseCamera, type CountdownCameraShot } from "../src/render/camera";
import { SAMPLE_ROUTE, sampleTrackPosition, sampleTrackTangent } from "../src/game/track";

describe("chase camera orientation", () => {
  it("covers the countdown with distinct upright start-line shots", () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1200);
    const rig = new ChaseCamera(camera, SAMPLE_ROUTE);
    const position = new Vector3(0, 0.045, 0);
    const shots: readonly CountdownCameraShot[] = ["front-reveal", "rear-chase", "low-hero"];
    const locations: Vector3[] = [];

    for (const shot of shots) {
      rig.updateCountdown(position, 0, shot);
      locations.push(camera.position.clone());
      camera.updateMatrixWorld(true);
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      expect(Math.abs(right.y)).toBeLessThan(1e-6);
      expect(up.y).toBeGreaterThan(0.85);
    }

    expect(locations[0].z).toBeGreaterThan(position.z);
    expect(locations[1].z).toBeLessThan(position.z);
    expect(locations[2].z).toBeLessThan(position.z);
    expect(Math.abs(locations[2].x)).toBeGreaterThan(Math.abs(locations[1].x));
    expect(locations[2].y).toBeLessThan(locations[1].y);
  });

  it("returns to the exact normal chase position after a countdown reveal", () => {
    const camera = new PerspectiveCamera();
    const rig = new ChaseCamera(camera, SAMPLE_ROUTE);
    const position = new Vector3(2, 0.045, 3);
    rig.updateCountdown(position, Math.PI / 3, "low-hero");
    rig.update(position, Math.PI / 3, 0, 0);

    const forward = new Vector3(Math.sin(Math.PI / 3), 0, Math.cos(Math.PI / 3));
    const expected = position.clone().addScaledVector(forward, -6.9);
    expected.y += 2.3;
    expect(camera.position.distanceTo(expected)).toBeLessThan(1e-6);
  });

  it("keeps its follow distance when the car translates at full racing speed", () => {
    const camera = new PerspectiveCamera();
    const rig = new ChaseCamera(camera, SAMPLE_ROUTE);
    for (let frame = 0; frame < 180; frame += 1) {
      const position = new Vector3(0, 0.045, frame * 84 / 60);
      rig.update(position, 0, 84, 1 / 60);
      expect(Math.hypot(camera.position.x - position.x, camera.position.z - position.z)).toBeCloseTo(6.9);
    }
    expect(camera.fov).toBeGreaterThan(80);
  });
  it("keeps the world horizon level through every heading and a complete route", () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 0.1, 1200);
    const rig = new ChaseCamera(camera, SAMPLE_ROUTE);
    for (let lap = 0; lap < 2; lap += 1) {
      for (let distance = 0; distance < SAMPLE_ROUTE.totalLength; distance += 1) {
        const position = sampleTrackPosition(SAMPLE_ROUTE, distance);
        position.y += 0.045;
        const tangent = sampleTrackTangent(SAMPLE_ROUTE, distance);
        rig.update(position, Math.atan2(tangent.x, tangent.z), 30, 1 / 30);
        camera.updateMatrixWorld(true);
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        expect(Math.abs(right.y)).toBeLessThan(1e-6);
        expect(up.y).toBeGreaterThan(0.85);
        expect(camera.position.y).toBeGreaterThan(position.y + 1);
      }
    }
  });

  it("shows the car's side during a slide without losing distance or rolling the horizon", () => {
    const camera = new PerspectiveCamera();
    const rig = new ChaseCamera(camera, SAMPLE_ROUTE);
    const position = new Vector3(0, 0.045, 0);
    const heading = 0.45;
    for (let frame = 0; frame < 90; frame++) {
      position.z += 70 / 60;
      rig.update(position, heading, 70, 1 / 60, { velocity: { x: 0, y: 0, z: 70 }, drift: 0.8, steering: 0.7 });
      expect(Math.hypot(camera.position.x - position.x, camera.position.z - position.z)).toBeCloseTo(6.9);
      camera.updateMatrixWorld(true);
      expect(new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).y).toBeGreaterThan(0.9);
    }
    const viewHeading = Math.atan2(position.x - camera.position.x, position.z - camera.position.z);
    expect(Math.abs(viewHeading - heading)).toBeGreaterThan(0.15);
  });

  it("takes the short turn across the heading seam without moving over the car", () => {
    const camera = new PerspectiveCamera();
    const rig = new ChaseCamera(camera, SAMPLE_ROUTE);
    const position = new Vector3(0, 0.045, 0);
    rig.update(position, Math.PI - 0.01, 0, 0);
    const previous = camera.position.clone();
    rig.update(position, -Math.PI + 0.01, 0, 1 / 60);
    expect(previous.distanceTo(camera.position)).toBeLessThan(0.05);
    for (let step = 0; step < 120; step += 1) {
      rig.update(position, 0, 0, 1 / 60);
      expect(Math.hypot(camera.position.x, camera.position.z)).toBeCloseTo(6.9);
    }
  });
});
