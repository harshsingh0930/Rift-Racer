import { describe, expect, it } from "vitest";
import { DirectionalLight, PointLight } from "three";
import { createRiftWorld } from "../src/render/world";

describe("RiftWorld quality lighting", () => {
  it("adds a real-time shadow key light in Ultra", () => {
    const world = createRiftWorld({
      quality: "ultra",
      scenery: false,
      environmentCues: false,
    });
    const lights: (DirectionalLight | PointLight)[] = [];
    world.traverse((object) => {
      if (object instanceof DirectionalLight || object instanceof PointLight) lights.push(object);
    });

    expect(world.getObjectByName("rift-ultra-key-light")).toBeInstanceOf(DirectionalLight);
    expect(lights.some((light) => light instanceof PointLight && light.name === "rift-ultra-cyan-fill")).toBe(true);
    expect((world.getObjectByName("rift-ultra-key-light") as DirectionalLight).castShadow).toBe(true);

    world.dispose();
  });
});
