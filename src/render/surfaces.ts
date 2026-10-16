import { DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RedFormat, RepeatWrapping, SRGBColorSpace } from "three";
import type { QualityTier } from "../game/performance";

/** Real surface detail: albedo, varied roughness and a separate fine height map. */
export function createAsphaltMaterial(quality: QualityTier): MeshStandardMaterial {
  const size = quality === "ultra" ? 2048 : quality === "balanced" ? 1024 : 512;
  const color = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const height = new Uint8Array(size * size);
  let seed = 8131;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed >>> 24;
      const index = y * size + x;
      const value = 176 + Math.floor(noise / 7);
      const offset = index * 4;
      color[offset] = color[offset + 1] = value;
      color[offset + 2] = value + 3;
      color[offset + 3] = 255;
      const rough = 222 + noise % 24;
      roughness[offset] = roughness[offset + 1] = roughness[offset + 2] = rough;
      roughness[offset + 3] = 255;
      height[index] = noise > 248 ? 75 : 118 + Math.floor(noise / 10);
    }
  }
  const configure = (texture: DataTexture) => {
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(2, 2);
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = quality === "ultra" ? 8 : 4;
    texture.needsUpdate = true;
    return texture;
  };
  const map = configure(new DataTexture(color, size, size));
  map.colorSpace = SRGBColorSpace;
  const roughnessMap = configure(new DataTexture(roughness, size, size));
  const bumpMap = configure(new DataTexture(height, size, size, RedFormat));
  return new MeshStandardMaterial({ name: "rift-asphalt", color: 0x181824, map, roughnessMap, bumpMap,
    bumpScale: 0.015, roughness: 0.95, metalness: 0.02, envMapIntensity: 0.06,
    emissive: 0x080b18, emissiveIntensity: 0.08 });
}
