import { PerspectiveCamera, Scene, Vector2, WebGLRenderer } from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { QUALITY_SETTINGS, type QualityProfile } from "../game/performance";

/** Tone mapping runs once, after a restrained HDR bloom on supported profiles. */
export class RenderPipeline {
  private composer?: EffectComposer;
  private width = 0;
  private height = 0;
  private pixelRatio = 0;
  private waterPass?: ShaderPass;
  private wetness = 0;
  private impactAge = 1;
  private postProcessing = false;
  private elapsed = 0;

  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene, private readonly camera: PerspectiveCamera) {}

  setQuality(quality: QualityProfile): void {
    this.dispose();
    this.postProcessing = !!QUALITY_SETTINGS[quality].postProcessing;
    this.composer = new EffectComposer(this.renderer);
    this.composer.renderTarget1.samples = quality === "eco" ? 0 : 2;
    this.composer.renderTarget2.samples = quality === "eco" ? 0 : 2;
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (QUALITY_SETTINGS[quality].postProcessing) this.composer.addPass(new UnrealBloomPass(new Vector2(1, 1), quality === "ultra" ? 0.5 : 0.35, 0.4, 1.05));
    this.waterPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, wetness: { value: 0 }, impactAge: { value: 0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `uniform sampler2D tDiffuse;uniform float time;uniform float wetness;uniform float impactAge;varying vec2 vUv;
        void main(){
          vec2 p=vUv-0.5;
          vec2 wave=vec2(sin(p.y*17.0+time*12.0+sin(p.x*8.0)),cos(p.x*14.0-time*10.0+sin(p.y*9.0)));
          wave+=vec2(sin(p.y*7.0-time*8.0),cos(p.x*6.0+time*7.0))*0.5;
          vec2 uv=clamp(vUv+wave*wetness*0.035,0.001,0.999);
          vec3 color=texture2D(tDiffuse,uv).rgb;
          color.r=texture2D(tDiffuse,clamp(uv+wave*wetness*0.002,0.001,0.999)).r;
          color.b=texture2D(tDiffuse,clamp(uv-wave*wetness*0.002,0.001,0.999)).b;
          color=mix(color,color*vec3(0.45,1.04,1.35)+vec3(0.01,0.09,0.15),wetness*0.36);
          float sheet=smoothstep(0.1,0.9,sin(vUv.y*5.0+vUv.x*2.0+time*12.0)*0.5+0.5);
          color+=vec3(0.03,0.10,0.13)*sheet*wetness;
          gl_FragColor=vec4(color,1.0);
        }`,
    });
    this.composer.addPass(this.waterPass);
    this.waterPass.enabled = this.wetness > 0;
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
    if (this.composer && (this.postProcessing || this.waterPass?.enabled)) {
      this.resize();
      this.composer.render();
    } else this.renderer.render(this.scene, this.camera);
  }

  /** Allocate and draw the otherwise dormant refraction pass during loading. */
  prepareTransitions(): void {
    if (!this.composer || !this.waterPass) return;
    const enabled = this.waterPass.enabled;const wetness = this.waterPass.uniforms.wetness.value;
    try {
      this.waterPass.enabled = true;this.waterPass.uniforms.wetness.value = 0;
      this.resize();this.composer.render(0);
    } finally {
      this.waterPass.enabled = enabled;this.waterPass.uniforms.wetness.value = wetness;
    }
  }

  waterImpact(): void { this.impactAge = 0;this.wetness = 1; }
  resetWater(): void { this.impactAge = 1;this.wetness = 0;if (this.waterPass) this.waterPass.enabled = false; }
  updateWater(delta: number, submerged: boolean): void {
    this.elapsed += delta;this.impactAge += Math.max(0, delta);
    this.wetness = waterEntryWetness(this.impactAge, submerged);
    if (!this.waterPass) return;
    this.waterPass.enabled = this.wetness > 0;
    this.waterPass.uniforms.time.value = this.elapsed;
    this.waterPass.uniforms.wetness.value = this.wetness;
    this.waterPass.uniforms.impactAge.value = this.impactAge;
  }

  dispose(): void {
    this.composer?.passes.forEach((pass) => pass.dispose());
    this.composer?.dispose();
    this.composer = undefined;
    this.waterPass = undefined;
  }
}

/** A short sheet of water at entry; the underwater view then stays clear. */
export function waterEntryWetness(age: number, submerged: boolean): number {
  const progress = Math.max(0, Math.min(1, age / (submerged ? 0.32 : 0.38)));
  return 1 - progress * progress * (3 - 2 * progress);
}
