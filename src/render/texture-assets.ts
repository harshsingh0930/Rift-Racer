import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from "three";

export const TEXTURE_PATHS = {
  facade: "/textures/coastal-facade.png",
  fish: "/textures/reef-fish.png",
  foliage: "/textures/foliage-atlas.png",
} as const;

const images = new Map<string, HTMLImageElement>();

/** Decode once before starting; each scene still owns its GPU texture. */
export async function preloadSceneryTextures(): Promise<void> {
  if (typeof document === "undefined") return;
  await Promise.all(Object.values(TEXTURE_PATHS).map(async (path) => {
    const texture = await new TextureLoader().loadAsync(path);
    images.set(path, texture.image as HTMLImageElement);
    texture.dispose();
  }));
}

export function sceneryTexture(kind: keyof typeof TEXTURE_PATHS): Texture {
  const path = TEXTURE_PATHS[kind];
  const image = images.get(path);
  const texture = image ? new Texture(image)
    : typeof document !== "undefined" ? new TextureLoader().load(path)
      : new DataTexture(new Uint8Array(kind === "facade" ? [85, 73, 103, 255] : [90, 190, 209, 255]), 1, 1);
  texture.name = `rift-${kind}-texture`;
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  if (kind === "facade") texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Small shared detail maps for materials whose shape is authored in code. */
export function detailTexture(kind: "concrete" | "bark" | "leaf" | "reef"): DataTexture {
  const size = 512;
  const pixels = new Uint8Array(size * size * 4);
  let random = 3187;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      const grain = (random >>> 24) / 255;
      let value = 0.65 + grain * 0.18;
      if (kind === "concrete") value *= (x % 128 < 2 || y % 128 < 2) ? 0.62 : 1;
      if (kind === "bark") value *= 0.6 + 0.3 * Math.sin(y * 0.6 + Math.sin(x * 0.08) * 2) ** 2;
      if (kind === "leaf") {
        const vein = Math.abs(((y + Math.abs(x - 256) * 0.65) % 42) - 21) < 1.7;
        value *= Math.abs(x - 256) < 5 ? 1.25 : vein ? 0.65 : 0.95;
      }
      if (kind === "reef") value *= 0.8 + 0.2 * Math.sin(x * 0.07 + Math.cos(y * 0.05)) ** 2;
      const level = Math.min(255, Math.floor(value * 255));
      pixels.set([level, level, level, 255], (y * size + x) * 4);
    }
  }
  const texture = new DataTexture(pixels, size, size);
  texture.name = `rift-${kind}-detail`;
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}
