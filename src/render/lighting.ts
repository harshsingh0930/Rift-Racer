import { PMREMGenerator, WebGLRenderer } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

/** Soft reflection panels give paint, glass and metal readable highlights. */
export function createPaintEnvironment(renderer: WebGLRenderer) {
  const environment = new RoomEnvironment();
  const generator = new PMREMGenerator(renderer);
  const target = generator.fromScene(environment, 0.04);
  environment.dispose();
  generator.dispose();
  return target;
}
