import { PerspectiveCamera, Scene, Vector2, WebGLRenderer } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { QUALITY_SETTINGS, type QualityProfile } from "../game/performance";

/** Tone mapping runs once, after a restrained HDR bloom on supported profiles. */
export class RenderPipeline {
  private composer?: EffectComposer;
  private width = 0;
  private height = 0;
  private pixelRatio = 0;

  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene, private readonly camera: PerspectiveCamera) {}

  setQuality(quality: QualityProfile): void {
    this.dispose();
    if (!QUALITY_SETTINGS[quality].postProcessing) return;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new Vector2(1, 1), quality === "ultra" ? 0.38 : 0.26, 0.35, 1.05));
    this.composer.addPass(new OutputPass());
    this.width = 0;
    this.resize();
  }

  resize(): void {
    if (!this.composer) return;
    const size = this.renderer.getSize(new Vector2());
    const pixelRatio = this.renderer.getPixelRatio();
    if (size.x === this.width && size.y === this.height && pixelRatio === this.pixelRatio) return;
    this.width = size.x;
    this.height = size.y;
    this.pixelRatio = pixelRatio;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(size.x, size.y);
  }

  render(): void {
    if (this.composer) {
      this.resize();
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer?.passes.forEach((pass) => pass.dispose());
    this.composer?.dispose();
    this.composer = undefined;
  }
}
