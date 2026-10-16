/** Shared with the ocean shader so floating objects follow the visible swells. */
export function oceanSurfaceHeight(x: number, z: number, time: number): number {
  return -1.8 + Math.sin((x * 0.94 + z * 0.34) * 0.19635 - time * 1.388) * 0.22
    + Math.sin((x * -0.42 + z * 0.91) * 0.3696 - time * 1.905) * 0.11
    + Math.sin((x * 0.65 - z * 0.76) * 0.7392 - time * 2.693) * 0.045;
}
