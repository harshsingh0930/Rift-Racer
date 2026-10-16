import { describe, expect, it } from "vitest";
import { Light, Mesh, PointLight } from "three";
import { createCarState } from "../src/game/arcade";
import { createRiftCar } from "../src/render/car";

function namedChildren(root: Mesh | ReturnType<typeof createRiftCar>, prefix: string): Mesh[] {
  const matches: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh && object.name.startsWith(prefix)) matches.push(object);
  });
  return matches;
}

function lights(root: ReturnType<typeof createRiftCar>): Light[] {
  const matches: Light[] = [];
  root.traverse((object) => {
    if (object instanceof Light) matches.push(object);
  });
  return matches;
}

describe("RiftCar quality-aware lighting", () => {
  it("allocates working headlights even when the car starts with them off", () => {
    const car = createRiftCar({ quality: "ultra", headlights: false });
    const beams = lights(car).filter((light) => light.name === "rift-car-headlight-beam");
    expect(beams).toHaveLength(2);
    expect(beams.every((light) => !light.visible)).toBe(true);
    car.setHeadlights(true);
    expect(beams.every((light) => light.visible)).toBe(true);
    car.dispose();
  });
  it.each(["eco", "balanced"] as const)(
    "keeps %s on emissive meshes without dynamic lights",
    (quality) => {
      const car = createRiftCar({ quality, headlights: true });

      expect(lights(car)).toHaveLength(0);
      expect(namedChildren(car, "rift-car-headlight")).toHaveLength(2);
      expect(namedChildren(car, "rift-car-underbody-glow")).toHaveLength(2);
      expect(car.realtimeLighting).toBe(false);

      car.dispose();
    },
  );

  it("adds visible dynamic headlight beams and speed/drift-reactive underbody light in Ultra", () => {
    const car = createRiftCar({ quality: "ultra", headlights: true });
    const dynamicLights = lights(car).filter((light) => light instanceof PointLight);
    const beamMeshes = namedChildren(car, "rift-car-headlight-beam-");
    const underbodyLight = dynamicLights.find((light) => light.name === "rift-car-underbody-light");

    expect(dynamicLights).toHaveLength(3);
    expect(beamMeshes).toHaveLength(2);
    expect(beamMeshes.every((beam) => beam.visible)).toBe(true);
    expect(underbodyLight).toBeDefined();

    const state = createCarState({
      velocity: { x: 6, y: 0, z: 28 },
      steering: 0.8,
      drift: 0.85,
    });
    car.update(state, 1 / 60);
    expect(underbodyLight?.intensity).toBeGreaterThan(1);
    expect(dynamicLights.slice(0, 2).every((light) => light.intensity > 1)).toBe(true);

    car.setHeadlights(false);
    expect(dynamicLights.slice(0, 2).every((light) => !light.visible && light.intensity === 0)).toBe(true);
    expect(beamMeshes.every((beam) => !beam.visible)).toBe(true);

    car.dispose();
  });
});
