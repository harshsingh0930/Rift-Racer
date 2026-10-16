import { describe, expect, it } from "vitest";
import { DirectionalLight, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Object3D, PointLight, Raycaster, ShaderMaterial, Vector3 } from "three";
import { createRiftWorld } from "../src/render/world";
import { getDiveLayout } from "../src/render/landmarks";
import { findNearestTrackPoint, SAMPLE_ROUTE, sampleTrackPosition, sampleTrackTangent } from "../src/game/track";

function countNamedObjects(root: Object3D, name: string): number {
  let count = 0;
  root.traverse((object) => {
    if (object.name === name) count += 1;
  });
  return count;
}

function getInstanceCount(root: Object3D, name: string): number {
  const object = root.getObjectByName(name);
  return object instanceof InstancedMesh ? object.count : 0;
}

describe("RiftWorld quality lighting", () => {
  it("distributes varied planting along the exposed route instead of exhausting one global cap", () => {
    const world = createRiftWorld({ quality: "eco", environmentCues: false });
    const plants = world.scenery.getObjectByName("rift-dense-roadside-plants")!;
    expect(plants.children.length).toBeGreaterThan(12);
    expect(plants.children.length).toBeLessThan(65);
    const distances = plants.children.map(child => child.userData.routeDistance as number);
    expect(Math.max(...distances)).toBeGreaterThan(SAMPLE_ROUTE.totalLength * 0.8);
    expect(plants.getObjectByName("rift-cherry-canopy")).toBeDefined();
    expect(plants.getObjectByName("rift-maple-canopy")).toBeDefined();
    expect(plants.getObjectByName("rift-textured-shrubs")).toBeDefined();
    expect(world.getObjectByName("rift-hot-air-balloon")).toBeDefined();
    expect(world.getObjectByName("rift-sky-comets")).toBeDefined();
    expect(world.getObjectByName("rift-black-birds")).toBeDefined();
    expect(world.getObjectByName("rift-white-birds")).toBeDefined();
    const endDistrict = world.scenery.children.filter(child => child.name === "rift-district-chunk").find(child => child.userData.routeDistance > SAMPLE_ROUTE.totalLength * 0.5)!;
    world.update(0, { routeDistance: 0 });expect(endDistrict.visible).toBe(false);
    world.update(0, { routeDistance: endDistrict.userData.routeDistance });expect(endDistrict.visible).toBe(true);
    world.update(0, { submerged: true });expect(world.getObjectByName("rift-living-sky")!.visible).toBe(false);
    world.dispose();
  });

  it("grounds roadside buildings above sea level on actual promenade geometry", () => {
    const world = createRiftWorld({ quality: "eco", environmentCues: false });
    world.updateMatrixWorld(true);
    const platforms: Object3D[] = [];
    const buildings: InstancedMesh[] = [];
    world.scenery.traverse((object) => {
      if (object.name === "rift-roadside-platform") platforms.push(object);
      if (object instanceof InstancedMesh && (object.name.startsWith("rift-grounded-buildings")
        || object.name.startsWith("rift-distant-building-blocks"))) buildings.push(object);
    });
    let count = 0;
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 0.8);
    for (const mesh of buildings) for (let index = 0; index < mesh.count; index += 1) {
      mesh.getMatrixAt(index, matrix);matrix.premultiply(mesh.matrixWorld);
      position.setFromMatrixPosition(matrix);scale.setFromMatrixScale(matrix);
      const base = position.y - scale.y * 0.5;
      expect(base).toBeGreaterThan(-1.8);
      ray.ray.origin.set(position.x, base + 0.3, position.z);
      const hits = ray.intersectObjects(platforms, false);
      expect(hits.length, `ungrounded building at ${position.x}, ${base}, ${position.z}`).toBeGreaterThan(0);
      count += 1;
    }
    expect(count).toBeGreaterThan(20);
    world.dispose();
  });
  it("keeps terrain and distant rocks below the driving surface throughout the route", () => {
    const world = createRiftWorld({ quality: "eco", scenery: false, environmentCues: false });
    world.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 4);
    const environment = world.getObjectByName("rift-coastal-environment")!;
    for (let distance = 0; distance < SAMPLE_ROUTE.totalLength; distance += 6) {
      const point = sampleTrackPosition(SAMPLE_ROUTE, distance);
      ray.ray.origin.copy(point).add(new Vector3(0, 3, 0));
      const hits = ray.intersectObject(environment, true);
      // The sea may cover the submerged road; tunnel glass separates it.
      const solid = hits.find((hit) => hit.object.name !== "rift-coastal-water-surface");
      if (solid) expect(solid.point.y, `terrain obstructs road at ${distance}m`).toBeLessThan(point.y + 0.02);
    }
    world.dispose();
  });
  it("keeps entry water clear while preserving the enclosure opening", () => {
    const world = createRiftWorld({ quality: "eco", scenery: false, environmentCues: false });
    const ocean = world.getObjectByName("rift-coastal-water-surface") as Mesh;
    const material = ocean.material as ShaderMaterial;

    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.openingCount.value).toBeGreaterThan(0);
    expect(material.fragmentShader).toContain("if(i>=openingCount) break;");
    expect(material.fragmentShader).toContain("discard;");
    expect(material.fragmentShader).toContain("entryBand");
    expect(material.fragmentShader).toContain("waterOpacity");
    world.dispose();
  });

  it("forwards a sea impact into a pooled ocean ripple and expires it", () => {
    const world = createRiftWorld({ quality: "eco", scenery: false, environmentCues: false });
    const ocean = world.getObjectByName("rift-coastal-water-surface") as Mesh;
    const material = ocean.material as ShaderMaterial;
    const impact = new Vector3(-250, -1.8, -151);

    expect(material.uniforms.impactTime.value).toBe(-1);
    expect(material.uniforms.impactStrength.value).toBe(0);
    expect(material.fragmentShader).toContain("radialRipple");
    expect(material.fragmentShader).toContain("radialCaustic");

    world.emitSplash(impact);
    expect(material.uniforms.impactPosition.value.equals(impact)).toBe(true);
    expect(material.uniforms.impactTime.value).toBe(0);
    expect(material.uniforms.impactStrength.value).toBe(1);

    world.update(0.1, { playerPosition: impact });
    expect(material.uniforms.impactTime.value).toBeCloseTo(0.1);
    for (let frame = 0; frame < 18; frame += 1) world.update(0.1);
    expect(material.uniforms.impactTime.value).toBe(-1);
    expect(material.uniforms.impactStrength.value).toBe(0);
    world.dispose();
  });

  it("keeps the road and both shoulder tops facing up and responding to lighting", () => {
    const world = createRiftWorld({ scenery: false, environmentCues: false });
    const road = world.getObjectByName("rift-dark-road") as Mesh;
    expect(road.material).toBeInstanceOf(MeshStandardMaterial);
    const roadPositions = road.geometry.getAttribute("position");
    const roadIndices = road.geometry.index!;
    for (let offset = 0; offset < roadIndices.count; offset += 3) {
      const a = new Vector3().fromBufferAttribute(roadPositions, roadIndices.getX(offset));
      const b = new Vector3().fromBufferAttribute(roadPositions, roadIndices.getX(offset + 1));
      const c = new Vector3().fromBufferAttribute(roadPositions, roadIndices.getX(offset + 2));
      expect(b.sub(a).cross(c.sub(a)).normalize().y).toBeGreaterThan(0.7);
    }
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

  it("keeps enclosures present and brings decoration in before section boundaries", () => {
    const world = createRiftWorld();
    world.update(1 / 60, { routeDistance: 0 });
    expect(world.tunnelCues.visible).toBe(false);
    expect(world.underwaterCues.visible).toBe(false);
    expect(world.getObjectByName("rift-tunnel-shell")?.parent?.name).toBe("rift-permanent-enclosures");
    expect(world.getObjectByName("rift-underwater-glass-tube")?.parent?.visible).toBe(true);
    const tunnelDistance = SAMPLE_ROUTE.segments.find((segment) => segment.section === "tunnel")?.startDistance ?? 0;
    world.update(1 / 60, { routeDistance: tunnelDistance - 50 });
    expect(world.tunnelCues.visible).toBe(true);
    world.update(1 / 60, { routeDistance: tunnelDistance + 0.5 });
    expect(world.tunnelCues.visible).toBe(true);
    expect(world.underwaterCues.visible).toBe(false);
    const underwaterDistance = SAMPLE_ROUTE.segments.find((segment) => segment.section === "underwater")?.startDistance ?? 0;
    world.update(1 / 60, { routeDistance: underwaterDistance + 0.5 });
    expect(world.tunnelCues.visible).toBe(true);
    expect(world.underwaterCues.visible).toBe(true);
    expect(world.scenery.children.length).toBeLessThan(150);
    const before = sampleTrackTangent(SAMPLE_ROUTE, SAMPLE_ROUTE.totalLength - 0.1);
    const after = sampleTrackTangent(SAMPLE_ROUTE, 0.1);
    expect(before.dot(after)).toBeGreaterThan(0.99);
    world.dispose();
  });

  it("keeps roadside decoration present and bounded by route chunks", () => {
    const visibilityRadii = { eco: 110, balanced: 140, ultra: 160 } as const;
    const maximumChunks = Math.ceil(SAMPLE_ROUTE.totalLength / 48);
    const maximumStations = Math.ceil(SAMPLE_ROUTE.totalLength / 14);

    for (const quality of ["eco", "balanced", "ultra"] as const) {
      const world = createRiftWorld({ quality, environmentCues: false });
      const scenery = world.scenery;
      expect(world.localVisibility.radius).toBe(visibilityRadii[quality]);
      const district = scenery;
      const chunks = district.children.filter((child) => child.name === "rift-district-chunk");
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.length).toBeLessThanOrEqual(maximumChunks);
      const decorationCaps = {
        "rift-roadside-platform": maximumChunks,
        "rift-grounded-buildings": maximumStations * 2,
        "rift-building-roof-trim": maximumStations * 2,
        "rift-building-ground-plinths": maximumStations * 2,
        "rift-palm": maximumStations,
        "rift-neon-street-lamp": maximumStations,
      };
      for (const [name, cap] of Object.entries(decorationCaps)) {
        expect(countNamedObjects(scenery, name), `${quality} is missing ${name}`).toBeGreaterThan(0);
        expect(countNamedObjects(scenery, name), `${quality} over-batches ${name}`).toBeLessThanOrEqual(cap);
      }
      expect(getInstanceCount(scenery, "rift-grounded-buildings")).toBeGreaterThan(0);
      expect(getInstanceCount(scenery, "rift-palm")).toBeGreaterThan(0);
      expect(getInstanceCount(scenery, "rift-neon-street-lamp")).toBeGreaterThan(0);
      world.dispose();
    }
  });

  it("prebuilds the city without a separate offshore building skyline", () => {
    const world = createRiftWorld({ quality: "eco", environmentCues: false });
    expect(world.getObjectByName("rift-distant-building-blocks")).toBeUndefined();
    expect(getInstanceCount(world.scenery, "rift-grounded-buildings")).toBeGreaterThan(0);
    const traffic = world.getObjectByName("rift-city-ambient-traffic") as InstancedMesh;
    const matrix = new Matrix4();traffic.getMatrixAt(0, matrix);const before = matrix.clone();
    world.update(0.1, { elapsedSeconds: 1 });traffic.getMatrixAt(0, matrix);
    expect(matrix.equals(before)).toBe(false);
    const backdrops = world.getObjectByName("rift-static-mountain-backdrop")!;
    expect(backdrops.children).toHaveLength(3);
    world.update(0.1, { submerged: true });expect(backdrops.visible).toBe(false);
    world.dispose();
  });

  it("shows section cues only within their active approach windows", () => {
    const world = createRiftWorld({ scenery: false });
    const sectionRange = (section: string) => {
      const segments = SAMPLE_ROUTE.segments.filter((candidate) => candidate.section === section);
      return {
        start: segments[0].startDistance,
        end: segments[segments.length - 1].endDistance,
      };
    };
    const tunnel = sectionRange("tunnel");
    const underwater = sectionRange("underwater");

    world.update(0);
    expect(world.tunnelCues.visible).toBe(true);
    expect(world.underwaterCues.visible).toBe(true);

    world.update(0, { routeDistance: tunnel.start - 101 });
    expect(world.tunnelCues.visible).toBe(false);
    expect(world.underwaterCues.visible).toBe(false);

    world.update(0, { routeDistance: tunnel.start - 99 });
    expect(world.tunnelCues.visible).toBe(true);
    expect(world.underwaterCues.visible).toBe(false);

    world.update(0, { routeDistance: underwater.start + 1 });
    expect(world.tunnelCues.visible).toBe(true);
    expect(world.underwaterCues.visible).toBe(true);

    world.update(0, { routeDistance: underwater.end + 101 });
    expect(world.tunnelCues.visible).toBe(false);
    expect(world.underwaterCues.visible).toBe(false);
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

  it("builds animated underwater glass dressing and shared tunnel arches", () => {
    const world = createRiftWorld({ scenery: false });
    const glass = world.getObjectByName("rift-underwater-glass-tube") as Mesh;
    const caustics = world.getObjectByName("rift-underwater-caustic-bands") as Mesh;
    expect(glass.material).toBeInstanceOf(ShaderMaterial);
    expect(caustics.material).toBeInstanceOf(ShaderMaterial);
    const glassMaterial = glass.material as ShaderMaterial;
    expect(glassMaterial.uniforms.time.value).toBe(0);

    let fishCount = 0;
    let kelpCount = 0;
    const archGeometries = new Set<unknown>();
    let archLightCount = 0;
    world.traverse((object) => {
      if (object.name === "rift-underwater-fish") fishCount += 1;
      if (object.name === "rift-underwater-kelp") kelpCount += 1;
      if (object.name === "rift-tunnel-neon-arch" && object instanceof Mesh) {
        archGeometries.add(object.geometry);
      }
      if (object.name === "rift-tunnel-arch-light") archLightCount += 1;
    });
    expect(fishCount).toBeGreaterThan(0);
    expect(kelpCount).toBeGreaterThan(0);
    expect(archGeometries.size).toBe(1);
    expect(archLightCount).toBeGreaterThan(0);

    world.update(0.1);
    expect(glassMaterial.uniforms.time.value).toBeCloseTo(0.1);
    world.dispose();
  });

  it("culls distant road decoration around route distance or player position", () => {
    const world = createRiftWorld({ quality: "eco", scenery: false, environmentCues: false });
    const decorativeParents = [
      "rift-neon-ribbon-right",
      "rift-neon-ribbon-left",
      "rift-raised-rail-right",
      "rift-raised-rail-left",
      "rift-guardrail-posts",
      "rift-cyan-lane-dashes",
    ].map((name) => world.getObjectByName(name)!);
    decorativeParents.forEach((parent) => expect(parent.children.length).toBeGreaterThan(4));

    world.update(0, { routeDistance: 0 });
    for (const parent of decorativeParents) {
      const nearChunk = parent.children.find((child) => child.name.endsWith("-chunk-0"));
      const farChunk = parent.children.find((child) => child.name.endsWith("-chunk-4"));
      expect(nearChunk, `${parent.name} has no start chunk`).toBeDefined();
      expect(farChunk, `${parent.name} has no distant chunk`).toBeDefined();
      expect(nearChunk?.visible).toBe(true);
      expect(farChunk?.visible).toBe(false);
    }

    const halfwayDistance = SAMPLE_ROUTE.totalLength * 0.5;
    world.update(0, { routeDistance: halfwayDistance });
    const visibleAtHalfway = decorativeParents.map((parent) => parent.children.map((child) => child.visible));
    const halfway = sampleTrackPosition(SAMPLE_ROUTE, SAMPLE_ROUTE.totalLength * 0.5);
    world.update(0, { playerPosition: halfway });
    decorativeParents.forEach((parent, parentIndex) => {
      parent.children.forEach((child, index) => expect(child.visible).toBe(visibleAtHalfway[parentIndex][index]));
    });
    world.dispose();
  });

  it("keeps the start banner above the driving corridor with complete lettering", () => {
    const world = createRiftWorld({ quality: "eco", scenery: false, environmentCues: false });
    const gate = world.startGate;
    const left = gate.getObjectByName("rift-start-gate-pylon-left")!;
    const right = gate.getObjectByName("rift-start-gate-pylon-right")!;
    expect(Math.abs(left.position.x)).toBeGreaterThan(7);
    expect(Math.abs(right.position.x)).toBeGreaterThan(7);
    const banner = gate.getObjectByName("rift-start-finish-banner") as Mesh;
    expect(banner.geometry.getAttribute("position").array.every(Number.isFinite)).toBe(true);
    const lettering = gate.getObjectByName("rift-start-finish-label") as InstancedMesh;
    expect(lettering.userData.text).toBe("RIFT RACER");
    expect(lettering.count).toBeGreaterThan(130);
    lettering.computeBoundingBox();
    expect(lettering.boundingBox!.max.x - lettering.boundingBox!.min.x).toBeGreaterThan(6);
    expect(gate.userData.routeDistance).toBe(18);
    world.dispose();
  });

  it("keeps cliff rock and the tunnel roof clear of the open approach road", () => {
    const world = createRiftWorld({ quality: "eco", scenery: false });
    const layout = getDiveLayout(SAMPLE_ROUTE)!;
    world.updateMatrixWorld(true);
    const walls = [world.getObjectByName("rift-cliff-wall-left")!, world.getObjectByName("rift-cliff-wall-right")!];
    const roofs: Object3D[] = [];
    world.traverse(object => { if (object.name.startsWith("rift-tunnel-shell")) roofs.push(object); });
    const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0), 0, 19.7);
    for (let distance = 0; distance < SAMPLE_ROUTE.totalLength; distance += 4) {
      const point = sampleTrackPosition(SAMPLE_ROUTE, distance);
      const lateral = new Vector3().crossVectors(new Vector3(0, 1, 0), sampleTrackTangent(SAMPLE_ROUTE, distance)).normalize();
      for (const offset of [-4.5, 0, 4.5]) {
        ray.ray.origin.copy(point).addScaledVector(lateral, offset).y += 20;
        expect(ray.intersectObjects(walls, false), `cliff crosses road at ${distance}, ${offset}`).toHaveLength(0);
      }
      if (distance > layout.approachStart + 3 && distance < layout.boundary) {
        ray.ray.origin.copy(point).y += 20;
        expect(ray.intersectObjects(roofs, false), `roof covers cliff approach at ${distance}`).toHaveLength(0);
      }
    }
    expect(world.getObjectByName("rift-deep-water-entrance")!.visible).toBe(true);
    expect(world.getObjectByName("rift-underwater-portal")).toBeUndefined();
    world.dispose();
  });

  it("breaks timber at front-bumper contact, keeps it broken through culling, and resets on replay", () => {
    const world = createRiftWorld({ quality: "balanced", scenery: false, environmentCues: false });
    const { boardDistance } = getDiveLayout(SAMPLE_ROUTE)!;
    const board = world.getObjectByName("rift-cliff-end-board")!;
    const debris = world.getObjectByName("rift-cliff-board-debris")!;
    const update = (distance: number, speed = 2, delta = 0) => world.update(delta, {
      routeDistance: distance, speed, playerPosition: sampleTrackPosition(SAMPLE_ROUTE, distance),
    });
    update(boardDistance + 5);
    update(boardDistance + 1); // Reversing does not shatter the warning.
    expect(board.visible).toBe(true);
    world.resetTransitions();
    update(boardDistance - 10);
    expect(board.visible).toBe(true);
    expect(debris.visible).toBe(false);
    update(boardDistance - 2, 2, 0.016);
    expect(board.visible).toBe(false);
    expect(debris.visible).toBe(true);
    expect(board.userData.hitPoints).toBe(0);
    expect((debris.getObjectByName("rift-cliff-board-shards") as InstancedMesh).count).toBeGreaterThan(8);
    expect(world.cliffTransition.userData.transitionTriggered).toBe(true);
    for (let frame = 0; frame < 45; frame++) update(boardDistance + frame * 2, 30, 0.1);
    expect(board.visible).toBe(false);
    expect(debris.visible).toBe(true); // Wood remains afloat after the car has gone.
    update(SAMPLE_ROUTE.totalLength - 1);
    update(2);
    expect(board.visible).toBe(true);
    expect(board.userData.hitPoints).toBe(1);
    expect(debris.visible).toBe(false);
    world.resetTransitions();
    update(boardDistance - 10);
    expect(board.visible).toBe(true);
    expect(debris.visible).toBe(false);
    // A slow frame must still detect crossing the bumper plane.
    update(boardDistance + 4, 84, 0.1);
    expect(board.visible).toBe(false);
    world.dispose();
  });

  it("lets wood follow independent paths and splash individually without snapping to the car", () => {
    const world = createRiftWorld({ quality: "balanced", scenery: false, environmentCues: false });
    const layout = getDiveLayout(SAMPLE_ROUTE)!;
    const board = world.getObjectByName("rift-cliff-end-board")!;
    const debris = world.getObjectByName("rift-cliff-board-debris")!;
    world.update(0, { routeDistance: layout.boardDistance - 10, speed: 70 });
    world.update(0.016, { routeDistance: layout.boardDistance - 1, speed: 70 });
    const shards = debris.getObjectByName("rift-cliff-board-shards") as InstancedMesh;
    expect(board.visible).toBe(false);expect(shards.count).toBeGreaterThanOrEqual(32);
    const entry = sampleTrackPosition(SAMPLE_ROUTE, layout.boundary - 15);entry.y = -1.8;
    const before = shards.instanceMatrix.array.slice();
    world.emitSplash(entry);
    world.update(0, { routeDistance: layout.boundary - 15, speed: 70, playerPosition: entry });
    expect(world.cliffTransition.userData.waterImpacts).toBe(0);
    expect(shards.instanceMatrix.array).toEqual(before);
    let partialEntry = false;let sawSplash = false;
    for (let frame = 0; frame < 250; frame++) {
      world.update(1 / 60, { routeDistance: layout.boundary + 5, speed: 60, playerPosition: entry });
      const hits = world.cliffTransition.userData.waterImpacts;
      partialEntry ||= hits > 0 && hits < shards.count;
      sawSplash ||= world.getObjectByName("rift-wood-impact-splashes")!.visible;
    }
    expect(partialEntry).toBe(true);expect(sawSplash).toBe(true);
    expect(world.cliffTransition.userData.waterImpacts).toBe(shards.count);
    const ocean = world.getObjectByName("rift-coastal-water-surface") as Mesh;
    const material = ocean.material as ShaderMaterial;
    expect(material.uniforms.debrisImpacts.value.some((impact: { z: number }) => impact.z >= 0)).toBe(true);
    world.resetTransitions();
    expect(board.visible).toBe(true);expect(world.getObjectByName("rift-wood-impact-splashes")!.visible).toBe(false);
    world.dispose();
  });
});
