import { describe, expect, it } from "vitest";
import { Light, Mesh, PointLight, Raycaster, SpotLight, Vector3 } from "three";
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
  it("keeps the cabin roof closed and exposes four steering neon wheel rings", () => {
    const car = createRiftCar({ quality: "eco" });
    car.updateMatrixWorld(true);
    const cabin = car.getObjectByName("rift-car-cabin-shell") as Mesh;
    const ray = new Raycaster(new Vector3(0, 2, -0.5), new Vector3(0, -1, 0));
    const hits = ray.intersectObject(cabin);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.y).toBeGreaterThan(1.18);
    expect(hits[0].point.y).toBeLessThan(1.30);
    expect(car.getObjectByName("rift-car-rear-louver")).toBeUndefined();
    expect(car.getObjectByName("rift-car-rear-spoiler")).toBeUndefined();
    expect(namedChildren(car, "rift-car-wheel-outline")).toHaveLength(4);
    expect(car.taillights).toHaveLength(2);
    car.update(createCarState({ velocity: { x: 0, y: 0, z: 50 }, steering: 0.8 }), 1 / 60);
    expect(car.wheelMeshes[0].rotation.y).toBeLessThan(-0.3);
    expect(car.wheelMeshes[1].rotation.y).toBeLessThan(-0.3);
    expect(car.wheelMeshes[2].rotation.y).toBe(0);
    car.dispose();
  });

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

  it("lights the road with spotlights and reacts to speed and drift in Ultra", () => {
    const car = createRiftCar({ quality: "ultra", headlights: true });
    const dynamicLights = lights(car).filter((light) => light instanceof PointLight || light instanceof SpotLight);
    const underbodyLight = dynamicLights.find((light) => light.name === "rift-car-underbody-light");

    expect(dynamicLights).toHaveLength(3);
    expect(dynamicLights.filter((light) => light instanceof SpotLight)).toHaveLength(2);
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

    car.dispose();
  });
});
