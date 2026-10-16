import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { ChaseCamera } from "../src/render/camera";
import { SAMPLE_ROUTE, sampleTrackPosition, sampleTrackTangent } from "../src/game/track";

describe("chase camera orientation", () => {
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
