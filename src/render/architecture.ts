import type { MeshBasicMaterial, MeshStandardMaterial } from "three";

/** Fade architecture before it becomes a distinct skyline across another road. */
export function fadeArchitecture(material: MeshBasicMaterial | MeshStandardMaterial): void {
  const previous = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey();
  material.transparent = true;
  // The ocean is transparent too: facade depth must occlude the water behind
  // it, otherwise a cyan horizon band gets composited over the ground floors.
  material.depthWrite = true;
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.vertexShader = 'varying float architectureFade;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 architectureWorld=vec4(transformed,1.0);
      #ifdef USE_INSTANCING
        architectureWorld=instanceMatrix*architectureWorld;
      #endif
      architectureWorld=modelMatrix*architectureWorld;
      architectureFade=1.0-smoothstep(85.0,155.0,length(architectureWorld.xz-cameraPosition.xz));`);
    shader.fragmentShader = 'varying float architectureFade;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      diffuseColor.a*=architectureFade;
      if(diffuseColor.a<0.003) discard;
      #include <alphatest_fragment>`);
  };
  material.customProgramCacheKey = () => key + '-near-architecture-smooth-v2';
}
