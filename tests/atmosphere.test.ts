import { describe, expect, it } from "vitest";
import { InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { SAMPLE_ROUTE, sampleTrackPosition } from "../src/game/track";
import { createRiftWorld } from "../src/render/world";
import { waterEntryWetness } from "../src/render/pipeline";

describe("scenery and water transitions", () => {
  it("dresses the tunnel roof while leaving the entire driving corridor clear", () => {
    const world = createRiftWorld({ quality: "eco", scenery: false });
    const headland = world.getObjectByName("rift-tunnel-headland")!;
    expect(headland.getObjectByName("rift-tunnel-masonry-arch")).toBeDefined();
    expect(headland.getObjectByName("rift-tunnel-rooftop-blossoms")).toBeDefined();
    expect(headland.getObjectByName("rift-tunnel-lantern-pavilion")).toBeDefined();
    expect(headland.getObjectByName("rift-tunnel-ridge-boulders")).toBeDefined();
    world.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(), new Vector3(0, 1, 0), 0, 7);
    for (let distance = 0; distance < SAMPLE_ROUTE.totalLength; distance += 3) {
      const point = sampleTrackPosition(SAMPLE_ROUTE, distance);point.y += 0.15;
      ray.ray.origin.copy(point);
      const hits = ray.intersectObject(headland, true);
      expect(hits, `tunnel dressing blocks road at ${distance}: ${hits.map(hit => hit.object.name + ":" + hit.point.toArray().join(",")).join(";")}`).toHaveLength(0);
    }
    world.dispose();
  });
  it("clears the lens within a fraction of a second, including while submerged", () => {
    expect(waterEntryWetness(0, false)).toBe(1);
    expect(waterEntryWetness(0.05, true)).toBeGreaterThan(0);
    expect(waterEntryWetness(0.10, true)).toBeGreaterThan(0.7);
    expect(waterEntryWetness(0.38, false)).toBe(0);
    expect(waterEntryWetness(0.32, true)).toBe(0);
    expect(waterEntryWetness(10, true)).toBe(0);
    let previous = 1;
    for (let time = 0; time < 0.25; time += 1 / 120) {
      const value = waterEntryWetness(time, time > 0.08);
      expect(value).toBeLessThanOrEqual(previous);previous = value;
    }
  });

  it("keeps every flyover support and deck out of the driving clearance", () => {
    const world = createRiftWorld({ quality: "eco", environmentCues: false });
    world.updateMatrixWorld(true);
    const city = world.getObjectByName("rift-city-highway-life")!;
    const ray = new Raycaster(new Vector3(), new Vector3(0, 1, 0), 0, 7);
    for (let distance = 0; distance < SAMPLE_ROUTE.totalLength; distance += 3) {
      const point = sampleTrackPosition(SAMPLE_ROUTE, distance);point.y += 0.1;
      ray.ray.origin.copy(point);
      expect(ray.intersectObject(city, true), `flyover blocks road at ${distance}`).toHaveLength(0);
    }
    world.dispose();
  });

  it("has tall underwater plants and rising bubbles seeded at fish", () => {
    const world = createRiftWorld({ quality: "eco", scenery: false });
    const garden = world.getObjectByName("rift-giant-sea-garden") as InstancedMesh;
    let plantCount = 0;world.traverse(object => {
      if (object instanceof InstancedMesh && object.name.startsWith("rift-giant-sea-garden")) plantCount += object.count;
    });
    expect(plantCount).toBeGreaterThan(80);
    const matrix = new Matrix4();garden.getMatrixAt(0, matrix);
    expect(new Vector3().setFromMatrixScale(matrix).y * 9).toBeGreaterThan(5);
    const bubbles = world.getObjectByName("rift-fish-rising-bubbles") as Mesh;
    const position = bubbles.geometry.getAttribute("position");
    world.update(0.1);const initialY = position.getY(0);
    world.update(0.1);expect(position.getY(0)).toBeGreaterThan(initialY);
    const fish = world.getObjectByName("rift-underwater-fish")!;
    const before = fish.position.clone();world.update(0.1);
    expect(Math.hypot(fish.position.x - before.x, fish.position.z - before.z)).toBeGreaterThan(0.001);
    expect(world.getObjectByName("rift-underwater-bubble-columns")).toBeDefined();
    expect(world.getObjectByName("rift-underwater-reef-spires")).toBeDefined();
    expect(world.getObjectByName("rift-swimming-fish-schools")).toBeInstanceOf(InstancedMesh);
    world.dispose();
  });

  it("keeps both orange rail strips constant across time and speed", () => {
    const world = createRiftWorld({ quality: "eco", scenery: false, environmentCues: false });
    const strips = ["rift-neon-ribbon-left", "rift-neon-ribbon-right"].map(name => world.getObjectByName(name)!.children[0] as Mesh);
    const materials = strips.map(strip => strip.material as MeshBasicMaterial);
    const original = materials.map(material => ({ opacity: material.opacity, color: material.color.clone() }));
    for (const time of [0.1, 1, 3.7, 9, 15]) {
      world.update(0.1, { elapsedSeconds: time, routeDistance: 0, speed: time * 5 });
      materials.forEach((material, index) => {
        expect(material.opacity).toBe(original[index].opacity);
        expect(material.color.equals(original[index].color)).toBe(true);
      });
    }
    world.dispose();
  });

  it.each(["eco", "balanced", "ultra"] as const)("keeps three entry rings on and sequences the remaining rings on %s", quality => {
    const world = createRiftWorld({ quality, scenery: false });
    const entrance = SAMPLE_ROUTE.segments.find(segment => segment.section === "tunnel")!.startDistance;
    const rings: Mesh[] = [];world.traverse(object => { if (object instanceof Mesh && object.name === "rift-tunnel-neon-arch") rings.push(object); });
    rings.sort((a, b) => a.userData.routeDistance - b.userData.routeDistance);
    const opacity = (ring: Mesh) => (ring.material as MeshBasicMaterial).opacity;
    expect(rings.slice(0, 3).every(ring => opacity(ring) === 0.86)).toBe(true);
    expect(rings.slice(3).every(ring => opacity(ring) === 0)).toBe(true);
    world.update(0.1, { routeDistance: entrance - 180 });
    expect(rings[0].parent?.name).toBe("rift-tunnel-permanent-entry-lights");
    expect(rings[0].parent?.visible).toBe(true);
    world.update(0.1, { routeDistance: entrance - 0.01 });
    expect(rings.slice(0, 3).every(ring => opacity(ring) === 0.86)).toBe(true);
    expect(rings.slice(3).every(ring => opacity(ring) === 0)).toBe(true);
    world.update(0, { routeDistance: entrance + 0.01 });
    world.update(0.1, { routeDistance: entrance + 0.01 });
    world.update(0.01, { routeDistance: entrance + 0.01 });
    expect(opacity(rings[3])).toBeGreaterThan(opacity(rings[4]));
    expect(opacity(rings[5])).toBe(0);
    for (let i = 0; i < 20; i++) world.update(1 / 60, { routeDistance: entrance + 0.01 });
    expect(rings.slice(0, 6).every(ring => opacity(ring) > 0.85)).toBe(true);
    expect(opacity(rings[6])).toBe(0);
    const distance = rings[3].userData.routeDistance;
    for (let i = 0; i < 25; i++) world.update(1 / 60, { routeDistance: distance });
    expect(opacity(rings[8])).toBeGreaterThan(0.85);
    world.resetTransitions();
    expect(rings.slice(0, 3).every(ring => opacity(ring) === 0.86)).toBe(true);
    expect(rings.slice(3).every(ring => opacity(ring) === 0)).toBe(true);
    world.dispose();
  });
});
