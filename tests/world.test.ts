import { describe, expect, it } from "vitest";
import { DirectionalLight, Mesh, MeshStandardMaterial, PointLight, Vector3 } from "three";
import { createRiftWorld } from "../src/render/world";
import { SAMPLE_ROUTE, sampleTrackTangent } from "../src/game/track";

describe("RiftWorld quality lighting", () => {
  it("keeps the road and both shoulder tops facing up and responding to lighting", () => {
    const world = createRiftWorld({ scenery: false, environmentCues: false });
    const road = world.getObjectByName("rift-dark-road") as Mesh;
    expect(road.material).toBeInstanceOf(MeshStandardMaterial);
    for (const name of ["rift-road-shoulder-right", "rift-road-shoulder-left"]) {
      const shoulder = world.getObjectByName(name) as Mesh;
      const positions = shoulder.geometry.getAttribute("position");
      const indices = shoulder.geometry.index!;
      for (let offset = 0; offset < indices.count; offset += 24) {
        const a = new Vector3().fromBufferAttribute(positions, indices.getX(offset));
        const b = new Vector3().fromBufferAttribute(positions, indices.getX(offset + 1));
        const c = new Vector3().fromBufferAttribute(positions, indices.getX(offset + 2));
        const normal = b.sub(a).cross(c.sub(a)).normalize();
        expect(normal.y, `${name} span ${offset / 24} at ${a.toArray().join(",")}`).toBeGreaterThan(0.7);
      }
    }
    world.dispose();
  });

  it("keeps the tunnel visible from the coastal approach and bounds scenery density", () => {
    const world = createRiftWorld();
    world.update(1 / 60, { routeDistance: 0 });
    expect(world.tunnelCues.visible).toBe(true);
    expect(world.scenery.children.length).toBeLessThan(150);
    const before = sampleTrackTangent(SAMPLE_ROUTE, SAMPLE_ROUTE.totalLength - 0.1);
    const after = sampleTrackTangent(SAMPLE_ROUTE, 0.1);
    expect(before.dot(after)).toBeGreaterThan(0.99);
    world.dispose();
  });
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
