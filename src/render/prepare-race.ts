import { Object3D, PerspectiveCamera, Vector3, WebGLRenderer } from "three";
import { getDiveLayout } from "../game/cliff-dive";
import { sampleTrackPosition, sampleTrackTangent } from "../game/track";
import type { RiftWorld } from "./world";
import type { RiftEffects } from "./effects";
import type { RenderPipeline } from "./pipeline";

/** Upload transition geometry/textures and compile post effects behind the title. */
export function prepareRaceTransitions(renderer: WebGLRenderer, camera: PerspectiveCamera,
  world: RiftWorld, effects: RiftEffects, pipeline: RenderPipeline): void {
  const layout = getDiveLayout(world.route);if (!layout) return;
  const position = camera.position.clone();const rotation = camera.quaternion.clone();
  const hidden = new Map<Object3D, boolean>();
  for (const object of [world.getObjectByName("rift-cliff-board-debris"), world.getObjectByName("rift-wood-impact-splashes"),
    effects.getObjectByName("rift-water-entry-splash")]) {
    if (object) { hidden.set(object, object.visible); }
  }
  try {
    for (const distance of [0, layout.boardDistance - 12, layout.boundary + 25]) {
      const point = sampleTrackPosition(world.route, distance);
      const tangent = sampleTrackTangent(world.route, distance);
      world.update(0, { routeDistance: distance, speed: 0, playerPosition: point, elapsedSeconds: 0 });
      hidden.forEach((_, object) => { object.visible = true; });
      camera.position.copy(point).addScaledVector(tangent, -10).add(new Vector3(0, 3, 0));
      camera.lookAt(point.clone().addScaledVector(tangent, 15));world.sky.position.copy(camera.position);
      pipeline.prepareTransitions();
    }
  } finally {
    hidden.forEach((visible, object) => { object.visible = visible; });
    world.resetTransitions();effects.clearEffects();
    world.update(0, { routeDistance: 0, speed: 0, playerPosition: sampleTrackPosition(world.route, 0), elapsedSeconds: 0 });
    camera.position.copy(position);camera.quaternion.copy(rotation);world.sky.position.copy(position);
    renderer.setRenderTarget(null);
  }
}
