import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, DataTexture, DoubleSide, Float32BufferAttribute,
  Group, InstancedMesh, LinearFilter, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, TorusGeometry, Vector3,
} from "three";
import { sampleTrackPosition, sampleTrackTangent, sampleTrackWidth, type TrackRoute, type Vector3Like } from "../game/track";
import { getDiveLayout } from "../game/cliff-dive";
import type { QualityTier } from "../game/performance";
import { WoodSplashPool } from "./wood-splash";
import { stepWoodShard, type WoodShard } from "../game/wood-debris";
import { oceanSurfaceHeight } from "../game/ocean";

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);
const GLYPHS: Record<string, readonly string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  V: ["#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."],
};

function label(text: string, size: number, color: number): InstancedMesh {
  const cells: Array<[number, number]> = [];
  [...text].forEach((character, characterIndex) => {
    GLYPHS[character]?.forEach((row, y) => {
      [...row].forEach((pixel, x) => { if (pixel === "#") cells.push([characterIndex * 6 + x, y]); });
    });
  });
  // Keep every glyph. Capping individual pixels used to truncate whole words.
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color }), cells.length);
  const matrix = new Matrix4();
  cells.forEach(([x, y], index) => {
    matrix.makeScale(size * 0.88, size * 0.88, 0.022);
    matrix.setPosition((x - (text.length * 6 - 2) / 2) * size, (3 - y) * size, 0);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.userData.text = text;
  mesh.computeBoundingSphere();
  return mesh;
}

function placeOnRoute(group: Group, route: TrackRoute, distance: number, lift: number): void {
  group.position.copy(sampleTrackPosition(route, distance)).addScaledVector(UP, lift);
  const tangent = sampleTrackTangent(route, distance);
  group.rotation.set(-Math.atan2(tangent.y, Math.hypot(tangent.x, tangent.z)),
    Math.atan2(tangent.x, tangent.z), 0, "YXZ");
  group.userData.routeDistance = distance;
}

export { getDiveLayout } from "../game/cliff-dive";

/** A cloth-style race banner with slender supports, like the coastal reference. */
export function createStartGate(route: TrackRoute, lift: number): Group {
  const gate = new Group();
  gate.name = "rift-start-gate";
  if (!route.segments.length) return gate;
  const distance = Math.min(18, route.totalLength * 0.04);
  placeOnRoute(gate, route, distance, lift);
  const halfSpan = sampleTrackWidth(route, distance) / 2 + 1.6;
  const support = new MeshStandardMaterial({ color: 0x251d3b, metalness: 0.35, roughness: 0.7 });
  const accent = new MeshBasicMaterial({ color: new Color(0xff5cbd).multiplyScalar(1.15) });
  for (const side of [-1, 1]) {
    const post = new Mesh(new BoxGeometry(0.20, 5.9, 0.22), support);
    post.name = side < 0 ? "rift-start-gate-pylon-left" : "rift-start-gate-pylon-right";
    post.position.set(side * halfSpan, 2.95, 0);post.castShadow = true;gate.add(post);
    const light = new Mesh(new BoxGeometry(0.045, 1.4, 0.035), accent);
    light.position.set(side * halfSpan, 4.4, -0.13);gate.add(light);
  }
  const positions: number[] = [];
  const indices: number[] = [];
  for (let station = 0; station <= 12; station++) {
    const x = (station / 12 * 2 - 1) * halfSpan;
    const sag = Math.sin(station / 12 * Math.PI) * 0.24;
    positions.push(x, 5.75 - sag, 0, x, 4.55 - sag, 0);
    if (station < 12) { const v = station * 2;indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const banner = new Mesh(geometry, new MeshStandardMaterial({ color: 0xd52b99,
    emissive: 0x681257, emissiveIntensity: 0.35, roughness: 0.9, side: DoubleSide }));
  banner.name = "rift-start-finish-banner";banner.userData.text = "RIFT RACER";gate.add(banner);
  for (const side of [-1, 1]) {
    const text = label("RIFT RACER", 0.115, 0x26133f);
    text.name = "rift-start-finish-label";text.position.set(0, 4.95, side * 0.03);
    if (side < 0) text.rotation.y = Math.PI;
    gate.add(text);
  }
  return gate;
}

function woodTexture(): DataTexture {
  const pixels = new Uint8Array(128 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    const grain = Math.sin(y * 2.7 + Math.sin(x * 0.055) * 1.3) * 0.12;
    const value = Math.floor(178 + grain * 220 + ((x * 11 + y * 17) % 13));
    pixels.set([value, value, value, 255], (y * 128 + x) * 4);
  }
  const texture = new DataTexture(pixels, 128, 64);texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;texture.magFilter = LinearFilter;texture.needsUpdate = true;
  return texture;
}

type Debris = WoodShard & {
  origin: Vector3;
  initialRotation: Quaternion;
  baseX: number;
  seed: number;
};

/** An exposed cliff end with a wooden breakaway at the cliff lip. */
export class CliffDiveTransition {
  readonly group = new Group();
  readonly layout;
  private readonly barrier = new Group();
  private readonly debris = new Group();
  private readonly fragments: Debris[] = [];
  private readonly splashes = new WoodSplashPool();
  private shardMesh?: InstancedMesh<BufferGeometry, MeshStandardMaterial>;
  private readonly launchTangent = new Vector3();
  private readonly lateral = new Vector3();
  private readonly matrix = new Matrix4();
  private readonly renderScale = new Vector3();
  private readonly scratch = new Vector3();
  private oceanTime = 0;
  private previousFocus?: number;
  private elapsed = 0;
  private triggered = false;
  private readonly debrisLifetime = 12;

  constructor(private readonly route: TrackRoute, lift: number, quality: QualityTier,
    private readonly onDebrisSplash?: (position: Vector3, strength: number) => void) {
    this.group.name = "rift-cliff-transition";
    this.layout = getDiveLayout(route);
    if (!this.layout) return;
    const { boardDistance, approachStart, entranceDistance } = this.layout;
    const width = sampleTrackWidth(route, boardDistance);
    const lip = new Group();lip.name = "rift-cliff-lip";placeOnRoute(lip, route, boardDistance, lift);this.group.add(lip);
    lip.updateMatrix();this.launchTangent.copy(sampleTrackTangent(route, boardDistance)).setY(0).normalize();
    this.lateral.crossVectors(UP, this.launchTangent).normalize();this.group.add(this.splashes);
    const rockMaterial = new MeshStandardMaterial({ color: 0x55315d, roughness: 0.95,
      emissive: 0x221132, emissiveIntensity: 0.2, flatShading: true, side: DoubleSide });
    const faceGeometry = new BufferGeometry();
    const halfCliff = width / 2 + 12;
    faceGeometry.setAttribute("position", new Float32BufferAttribute([
      -halfCliff, -0.22, 0, halfCliff, -0.22, 0,
      -halfCliff - 4, -48, -4, halfCliff + 4, -48, -4,
    ], 3));
    faceGeometry.setIndex([0, 2, 1, 1, 2, 3]);faceGeometry.computeVertexNormals();
    const frontFace = new Mesh(faceGeometry, rockMaterial);frontFace.name = "rift-cliff-front-face";
    lip.add(frontFace);
    // Faceted banks follow the curved road; no independent boxes across the ramp.
    for (const side of [-1, 1]) {
      const vertices: number[] = [];const faces: number[] = [];
      const steps = quality === "eco" ? 14 : 22;
      for (let index = 0; index <= steps; index++) {
        const distance = approachStart + (boardDistance - 0.5 - approachStart) * index / steps;
        const center = sampleTrackPosition(route, distance);
        const lateral = new Vector3().crossVectors(UP, sampleTrackTangent(route, distance)).normalize();
        const edge = sampleTrackWidth(route, distance) / 2 + 1.4;
        const wallHeight = side > 0 ? 7 + Math.sin(index * 0.71) * 2 : 1.2;
        for (const [offset, height] of [[edge, -0.22], [edge + 4, wallHeight], [edge + 12, wallHeight + 2], [edge + 14, -48]]) {
          const point = center.clone().addScaledVector(lateral, side * offset);
          vertices.push(point.x, center.y + height, point.z);
        }
        if (index < steps) for (let column = 0; column < 3; column++) {
          const v = index * 4 + column;faces.push(v, v + 4, v + 1, v + 1, v + 4, v + 5);
        }
      }
      // Expose a vertical broken rock face at the end of both banks.
      const v = steps * 4;
      const a = new Vector3().fromArray(vertices, v * 3);const b = new Vector3().fromArray(vertices, (v + 2) * 3);
      vertices.push(a.x, a.y - 48, a.z, b.x, b.y - 48, b.z);
      faces.push(v, v + 2, v + 4, v + 2, v + 5, v + 4);
      const geometry = new BufferGeometry();geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      geometry.setIndex(faces);geometry.computeVertexNormals();
      const cliff = new Mesh(geometry, rockMaterial);cliff.name = side < 0 ? "rift-cliff-wall-left" : "rift-cliff-wall-right";
      cliff.receiveShadow = true;this.group.add(cliff);
    }
    const wood = new MeshStandardMaterial({ name: "rift-cliff-neon-timber", color: 0x805258,
      map: woodTexture(), metalness: 0, roughness: 0.9, emissive: 0x180c2c, emissiveIntensity: 0.18 });
    const frameMaterial = new MeshStandardMaterial({ name: "rift-cliff-neon-frame", color: 0x11152e,
      metalness: 0.82, roughness: 0.3, emissive: 0x17133d, emissiveIntensity: 0.8 });
    const cyanGlow = new MeshBasicMaterial({ name: "rift-cliff-cyan-edge", color: new Color(0x62f4ff).multiplyScalar(2.3),
      transparent: true, opacity: 0.92, depthWrite: false, blending: AdditiveBlending });
    const magentaGlow = new MeshBasicMaterial({ name: "rift-cliff-magenta-edge", color: new Color(0xff4fc4).multiplyScalar(2.15),
      transparent: true, opacity: 0.9, depthWrite: false, blending: AdditiveBlending });
    const timber = new BoxGeometry(1, 1, 1);
    this.barrier.name = "rift-cliff-end-board";this.barrier.userData.breakable = true;
    this.barrier.userData.hitPoints = 1;
    this.barrier.userData.dynamicVisibility = true;
    this.debris.name = "rift-cliff-board-debris";this.debris.userData.dynamicVisibility = true;
    lip.add(this.barrier);this.group.add(this.debris);
    for (const side of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.24, 3.8, 0.26), wood);
      post.position.set(side * (width / 2 + 0.7), 1.9, 0.2);this.barrier.add(post);
      const postGlow = new Mesh(new BoxGeometry(0.07, 3.2, 0.035), side < 0 ? cyanGlow : magentaGlow);
      postGlow.position.set(side * (width / 2 + 0.7), 1.92, 0.36);this.barrier.add(postGlow);
    }
    const header = new Mesh(new BoxGeometry(width + 1.8, 0.42, 0.16), frameMaterial);
    header.position.set(0, 3.3, 0.2);this.barrier.add(header);
    const headerGlow = new Mesh(new BoxGeometry(width + 1.55, 0.065, 0.04), cyanGlow);
    headerGlow.position.set(0, 3.57, 0.31);this.barrier.add(headerGlow);
    const lowerGlow = new Mesh(new BoxGeometry(width + 1.3, 0.045, 0.04), magentaGlow);
    lowerGlow.position.set(0, 0.27, 0.22);this.barrier.add(lowerGlow);
    const warning = label("END", 0.16, 0xff8ad7);warning.name = "rift-cliff-end-label";
    warning.position.set(0, 3.92, 0.33);this.barrier.add(warning);
    warning.rotation.y = Math.PI;
    const diveLabel = label("DIVE", 0.1, 0x72f5ff);
    diveLabel.position.set(0, 2.82, 0.33);this.barrier.add(diveLabel);
    diveLabel.rotation.y = Math.PI;
    const signBacking = new Mesh(new BoxGeometry(width + 1.38, 2.12, 0.12), frameMaterial);
    signBacking.position.set(0, 1.7, 0.12);this.barrier.add(signBacking);
    const plankSpan = width + 1.2;
    const plankHeight = 0.32;
    const chunkCount = quality === "eco" ? 6 : 8;
    for (let row = 0; row < 4; row++) {
      const plank = new Mesh(timber, wood);plank.position.set(0, 0.42 + row * 0.5, 0.22);
      plank.scale.set(plankSpan, plankHeight, 0.14);this.barrier.add(plank);
      const chunkWidth = plankSpan / chunkCount;
      for (let chunk = 0; chunk < chunkCount; chunk += 1) {
        const baseX = -plankSpan / 2 + chunkWidth / 2 + chunk * chunkWidth;
        const index = this.fragments.length;const seed = (Math.sin((index + 1) * 127.1) * 43758.5453) % 1;
        const origin = new Vector3(baseX, plank.position.y, 0.22).applyMatrix4(lip.matrix);
        const rotation = lip.quaternion.clone();
        const floatRotation = new Quaternion().setFromAxisAngle(UP, seed * Math.PI * 2)
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
        this.fragments.push({ origin, initialRotation: rotation.clone(), position: origin.clone(), velocity: new Vector3(), rotation,
          angularVelocity: new Vector3(), size: new Vector3(chunkWidth * (0.78 + Math.abs(seed) * 0.2), plankHeight, 0.14),
          floatRotation, baseX, seed, wet: false, impactSpeed: 0 });
      }
    }
    const shardGeometry = new BoxGeometry(1, 1, 1);
    const tips = shardGeometry.getAttribute("position");
    for (let index = 0; index < tips.count; index++) {
      const x = tips.getX(index);
      if (Math.abs(x) > 0.49) tips.setX(index, x - Math.sign(x) * (tips.getY(index) < 0 ? 0.16 : tips.getZ(index) < 0 ? 0.07 : 0));
    }
    shardGeometry.computeVertexNormals();
    this.shardMesh = new InstancedMesh(shardGeometry, wood, this.fragments.length);
    this.shardMesh.name = "rift-cliff-board-shards";this.shardMesh.frustumCulled = false;
    this.debris.add(this.shardMesh);
    // An open structural arch, always present; no translucent rectangle covering the driveable opening.
    const entrance = new Group();entrance.name = "rift-deep-water-entrance";
    placeOnRoute(entrance, route, entranceDistance, lift + 0.2);
    const radius = sampleTrackWidth(route, entranceDistance) / 2 + 1.23;
    const frame = new Mesh(new TorusGeometry(radius, 0.28, 8, quality === "eco" ? 24 : 48, Math.PI),
      new MeshStandardMaterial({ color: 0x282c46, metalness: 0.5, roughness: 0.5 }));
    frame.name = "rift-deep-water-entrance-arch";entrance.add(frame);
    const light = new Mesh(new TorusGeometry(radius - 0.04, 0.075, 6, quality === "eco" ? 24 : 48, Math.PI),
      new MeshBasicMaterial({ color: new Color(0xff8a43).multiplyScalar(2.4) }));
    light.position.z = -0.255;entrance.add(light);this.group.add(entrance);
    this.reset();
  }

  reset(): void {
    this.previousFocus = undefined;this.triggered = false;this.elapsed = 0;
    this.splashes.reset();this.barrier.visible = true;this.debris.visible = false;
    this.barrier.userData.hitPoints = 1;
    this.fragments.forEach(shard => {
      shard.position.copy(shard.origin);shard.rotation.copy(shard.initialRotation);
      shard.velocity.set(0, 0, 0);shard.angularVelocity.set(0, 0, 0);shard.wet = false;shard.impactSpeed = 0;
    });
    this.group.userData.transitionTriggered = false;this.group.userData.waterImpacts = 0;
    this.writeShardMatrices(1);
  }

  private breakTimber(speed: number, player?: Vector3Like): void {
    if (!this.layout) return;
    this.triggered = true;this.elapsed = 0;this.barrier.userData.hitPoints = 0;
    this.group.userData.transitionTriggered = true;
    const center = sampleTrackPosition(this.route, this.layout.boardDistance);
    const impactX = player ? this.scratch.set(player.x, player.y, player.z).sub(center).dot(this.lateral) : 0;
    this.fragments.forEach((shard, index) => {
      const offset = shard.baseX - impactX;
      const proximity = Math.exp(-offset * offset / 7);
      const forwardSpeed = Math.max(1, speed) * (0.30 + proximity * 0.64) + 1.5 + Math.abs(shard.seed) * 3;
      shard.velocity.copy(this.launchTangent).multiplyScalar(forwardSpeed)
        .addScaledVector(this.lateral, Math.sign(offset) * (0.7 + proximity * 1.8) + shard.seed);
      shard.velocity.y = 0.6 + Math.abs(shard.seed) * 3.4;
      shard.angularVelocity.set(Math.sin(index * 1.7) * 4.2, Math.cos(index * 2.3) * 2.6, shard.seed * 5);
    });
  }

  private writeShardMatrices(fade: number): void {
    if (!this.shardMesh) return;
    this.fragments.forEach((shard, index) => {
      this.renderScale.copy(shard.size).multiplyScalar(fade);
      this.matrix.compose(shard.position, shard.rotation, this.renderScale);
      this.shardMesh!.setMatrixAt(index, this.matrix);
    });
    this.shardMesh.instanceMatrix.needsUpdate = true;
  }

  update(delta: number, focus: number | undefined, speed: number, player?: Vector3Like, oceanTime?: number): void {
    if (!this.layout || focus === undefined) return;
    this.oceanTime = oceanTime ?? this.oceanTime + delta;
    if (this.route.closed && focus < 40 && this.previousFocus !== undefined && this.previousFocus > this.route.totalLength - 80) this.reset();
    if (!this.triggered) {
      const distance = this.layout.boardDistance;
      let advance = this.previousFocus === undefined ? 0 : focus - this.previousFocus;
      if (this.route.closed && Math.abs(advance) > this.route.totalLength / 2) advance -= Math.sign(advance) * this.route.totalLength;
      const gap = distance - focus;
      const crossed = this.previousFocus !== undefined && this.previousFocus < distance - 2.2 && focus >= distance - 2.2 && advance > 0;
      if (speed > 0.4 && advance >= 0 && ((gap <= 2.2 && gap >= -2.2) || crossed)) {
        const point = sampleTrackPosition(this.route, focus);
        const nearRoad = !player || Math.hypot(player.x - point.x, player.y - point.y, player.z - point.z) < sampleTrackWidth(this.route, focus) / 2 + 1;
        if (nearRoad) this.breakTimber(speed, player);
      }
    }
    this.previousFocus = focus;this.barrier.visible = !this.triggered;
    this.debris.visible = this.triggered && this.elapsed < this.debrisLifetime;
    if (this.debris.visible && delta > 0) {
      this.elapsed += delta;
      const steps = Math.max(1, Math.ceil(delta * 120));const dt = delta / steps;
      for (let substep = 0; substep < steps; substep++) {
        const time = this.oceanTime - delta + (substep + 1) * dt;
        for (const shard of this.fragments) {
          const surface = oceanSurfaceHeight(shard.position.x, shard.position.z, time);
          if (stepWoodShard(shard, dt, surface)) {
            this.scratch.copy(shard.position);this.scratch.y = surface;
            this.splashes.emit(this.scratch, shard.impactSpeed);
            this.onDebrisSplash?.(this.scratch, Math.min(0.6, 0.15 + shard.impactSpeed / 80));
            this.group.userData.waterImpacts++;
          }
        }
      }
      this.writeShardMatrices(Math.max(0, Math.min(1, (this.debrisLifetime - this.elapsed) / 2)));
    }
    this.splashes.update(delta, this.oceanTime);
  }
}
