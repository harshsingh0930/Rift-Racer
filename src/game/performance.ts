/**
 * Small, dependency-free performance helpers for the game loop.
 *
 * Everything in this module is defensive about browser globals so it can be
 * imported by SSR code and exercised from a Node/Vitest environment.
 */

import type { StorageLike } from './storage';

/** Profiles that can be selected by a player and persisted locally. */
export type QualityProfile = 'eco' | 'balanced' | 'ultra';

/** Quality values accepted by the renderer and scene modules. */
export type QualityTier = QualityProfile;

/** Alias for callers that use tier terminology for the public profiles. */
export type SelectableQualityTier = QualityProfile;

export type ShadowQuality = 'off' | 'standard' | 'high';

export interface QualitySettings {
  /** Multiplier applied to the renderer's drawing-buffer resolution. */
  resolutionScale: number;
  /** Multiplier applied to the base particle budget. */
  particleMultiplier: number;
  /** Multiplier for pooled visual effects created by the scene adapters. */
  effectScale: number;
  /** Optional absolute cap for systems that use a particle budget. */
  maxParticles?: number;
  /** Optional renderer hints kept with the preset for callers that use them. */
  antialias?: boolean;
  shadows?: boolean;
  postProcessing?: boolean;
  /** Enable dynamic scene lights in the host renderer. */
  realTimeLighting: boolean;
  /** Spelling used by the car renderer's quality option. */
  realtimeLighting?: boolean;
  /** Shadow-map mode requested by the host renderer. */
  shadowQuality: ShadowQuality;
}

const ECO_SETTINGS: QualitySettings = Object.freeze({
  resolutionScale: 0.75,
  particleMultiplier: 0.5,
  effectScale: 0.65,
  maxParticles: 700,
  antialias: false,
  shadows: false,
  postProcessing: false,
  realTimeLighting: false,
  realtimeLighting: false,
  shadowQuality: 'off',
});

const BALANCED_SETTINGS: QualitySettings = Object.freeze({
  resolutionScale: 1,
  particleMultiplier: 1,
  effectScale: 1,
  maxParticles: 1_400,
  antialias: true,
  shadows: true,
  postProcessing: true,
  realTimeLighting: true,
  realtimeLighting: true,
  shadowQuality: 'standard',
});

const ULTRA_SETTINGS: QualitySettings = Object.freeze({
  resolutionScale: 1,
  particleMultiplier: 1.75,
  effectScale: 1.35,
  maxParticles: 3_200,
  antialias: true,
  shadows: true,
  postProcessing: true,
  realTimeLighting: true,
  realtimeLighting: true,
  shadowQuality: 'high',
});

/** Default settings used by each supported quality tier. */
export const QUALITY_SETTINGS: Readonly<Record<QualityProfile, QualitySettings>> =
  Object.freeze({
    eco: ECO_SETTINGS,
    balanced: BALANCED_SETTINGS,
    ultra: ULTRA_SETTINGS,
  });

/** Descriptive aliases for callers that prefer the word "preset". */
export const QUALITY_PRESETS = QUALITY_SETTINGS;
export const DEFAULT_QUALITY_SETTINGS = QUALITY_SETTINGS;

/** Storage key used for the player's selected welcome-screen profile. */
export const QUALITY_PROFILE_STORAGE_KEY = 'rift-racer.quality-profile';

function parseQualityProfile(value: unknown): QualityProfile | undefined {
  if (value === 'eco' || value === 'balanced' || value === 'ultra') {
    return value;
  }

  // Migrate the previous public name without making it selectable again.
  if (value === 'high') return 'ultra';
  return undefined;
}

export function isQualityProfile(value: unknown): value is QualityProfile {
  return parseQualityProfile(value) !== undefined;
}

/** Normalize persisted or externally supplied values to a public profile. */
export function normalizeQualityProfile(
  value: unknown,
  fallback: QualityProfile = 'balanced',
): QualityProfile {
  return parseQualityProfile(value) ?? fallback;
}

/** Alias for callers that use tier terminology for the public profiles. */
export const normalizeQualityTier = normalizeQualityProfile;

function isStorageLike(value: unknown): value is StorageLike {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return false;
  }

  const candidate = value as Partial<StorageLike>;
  return (
    typeof candidate.getItem === 'function' &&
    typeof candidate.setItem === 'function' &&
    typeof candidate.removeItem === 'function'
  );
}

function getDefaultStorage(): StorageLike | undefined {
  try {
    if (typeof globalThis === 'undefined') return undefined;

    const candidate = (globalThis as unknown as { localStorage?: unknown }).localStorage;
    return isStorageLike(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** Read the selected profile without allowing storage failures to break boot. */
export function readQualityProfile(
  storage?: StorageLike | null,
): QualityProfile | null {
  const resolvedStorage = storage === undefined
    ? getDefaultStorage()
    : storage ?? undefined;
  if (!resolvedStorage) return null;

  try {
    return parseQualityProfile(resolvedStorage.getItem(QUALITY_PROFILE_STORAGE_KEY)) ?? null;
  } catch {
    return null;
  }
}

/** Persist a public profile; returns false when local storage is unavailable. */
export function saveQualityProfile(
  profile: QualityProfile,
  storage?: StorageLike | null,
): boolean {
  if (!isQualityProfile(profile)) return false;

  const resolvedStorage = storage === undefined
    ? getDefaultStorage()
    : storage ?? undefined;
  if (!resolvedStorage) return false;

  try {
    resolvedStorage.setItem(QUALITY_PROFILE_STORAGE_KEY, profile);
    return true;
  } catch {
    return false;
  }
}

export const readStoredQualityProfile = readQualityProfile;
export const writeQualityProfile = saveQualityProfile;

export interface MediaQueryLike {
  matches?: boolean;
}

export interface CanvasLike {
  getContext?: (contextId: string) => unknown;
}

export interface DocumentLike {
  createElement?: (tagName: string) => unknown;
}

export interface NavigatorLike {
  hardwareConcurrency?: number;
  /** Chromium exposes this non-standard but useful memory hint. */
  deviceMemory?: number;
}

export interface WindowLike {
  devicePixelRatio?: number;
  navigator?: NavigatorLike;
  document?: DocumentLike;
  matchMedia?: (query: string) => MediaQueryLike;
}

/** Optional injection point that makes capability probing easy to test. */
export interface CapabilityProbeOptions {
  window?: WindowLike;
  navigator?: NavigatorLike;
  document?: DocumentLike;
}

export interface PerformanceCapabilities {
  /** True when a browser-like window or document was available. */
  isBrowser: boolean;
  devicePixelRatio: number;
  hardwareConcurrency: number;
  deviceMemory?: number;
  webgl: boolean;
  webgl2: boolean;
  maxTextureSize?: number;
  prefersReducedMotion: boolean;
}

/** Alias retained for callers that refer to the result as a capability probe. */
export type CapabilityProbe = PerformanceCapabilities;

interface GlobalBrowserLike {
  window?: WindowLike;
  navigator?: NavigatorLike;
  document?: DocumentLike;
  devicePixelRatio?: number;
}

function getGlobalBrowser(): GlobalBrowserLike | undefined {
  try {
    if (typeof globalThis === 'undefined') {
      return undefined;
    }

    return globalThis as unknown as GlobalBrowserLike;
  } catch {
    return undefined;
  }
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function getWebGLCapabilities(documentLike: DocumentLike | undefined): {
  webgl: boolean;
  webgl2: boolean;
  maxTextureSize?: number;
} {
  if (!documentLike?.createElement) {
    return { webgl: false, webgl2: false };
  }

  try {
    const canvas = documentLike.createElement('canvas') as CanvasLike | null;
    if (!canvas?.getContext) {
      return { webgl: false, webgl2: false };
    }

    let webgl2Context: unknown;
    try {
      webgl2Context = canvas.getContext('webgl2');
    } catch {
      webgl2Context = undefined;
    }

    let webglContext = webgl2Context;
    if (!webglContext) {
      try {
        webglContext = canvas.getContext('webgl');
      } catch {
        webglContext = undefined;
      }
    }

    if (!webglContext) {
      try {
        webglContext = canvas.getContext('experimental-webgl');
      } catch {
        webglContext = undefined;
      }
    }

    if (!webglContext) {
      return { webgl: false, webgl2: false };
    }

    const context = webglContext as {
      MAX_TEXTURE_SIZE?: number;
      getParameter?: (parameter: number) => unknown;
    };
    let maxTextureSize: number | undefined;

    if (context.getParameter && typeof context.MAX_TEXTURE_SIZE === 'number') {
      try {
        maxTextureSize = finitePositive(
          context.getParameter(context.MAX_TEXTURE_SIZE),
        );
      } catch {
        maxTextureSize = undefined;
      }
    }

    return {
      webgl: true,
      webgl2: Boolean(webgl2Context),
      maxTextureSize,
    };
  } catch {
    return { webgl: false, webgl2: false };
  }
}

/**
 * Read inexpensive device hints without assuming that a DOM exists.
 * Browser API access is isolated behind try/catch because privacy settings and
 * sandboxed iframes can make individual properties throw.
 */
export function probeCapabilities(
  options: CapabilityProbeOptions = {},
): PerformanceCapabilities {
  const globalBrowser = getGlobalBrowser();
  const windowLike = options.window ?? globalBrowser?.window;
  const navigatorLike =
    options.navigator ?? windowLike?.navigator ?? globalBrowser?.navigator;
  const documentLike =
    options.document ?? windowLike?.document ?? globalBrowser?.document;

  let devicePixelRatio = 1;
  try {
    devicePixelRatio =
      finitePositive(windowLike?.devicePixelRatio) ??
      finitePositive(globalBrowser?.devicePixelRatio) ??
      1;
  } catch {
    devicePixelRatio = 1;
  }

  let hardwareConcurrency = 1;
  try {
    hardwareConcurrency = finitePositive(navigatorLike?.hardwareConcurrency) ?? 1;
  } catch {
    hardwareConcurrency = 1;
  }

  let deviceMemory: number | undefined;
  try {
    deviceMemory = finitePositive(navigatorLike?.deviceMemory);
  } catch {
    deviceMemory = undefined;
  }

  let prefersReducedMotion = false;
  try {
    prefersReducedMotion = Boolean(
      windowLike?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
    );
  } catch {
    prefersReducedMotion = false;
  }

  const webglCapabilities = getWebGLCapabilities(documentLike);

  return {
    isBrowser: Boolean(windowLike || documentLike),
    devicePixelRatio,
    hardwareConcurrency,
    deviceMemory,
    prefersReducedMotion,
    ...webglCapabilities,
  };
}

/** Common aliases for applications that use a detect/get naming convention. */
export const detectCapabilities = probeCapabilities;
export const getDeviceCapabilities = probeCapabilities;

/** Pick a conservative initial tier from the probed capabilities. */
export function recommendQualityTier(
  capabilities: PerformanceCapabilities = probeCapabilities(),
): QualityProfile {
  // Three.js r180's WebGLRenderer requires WebGL 2. A WebGL 1-only probe is
  // not a usable renderer capability, so keep the initial profile conservative.
  if (!capabilities.webgl2) {
    return 'eco';
  }

  const lowMemory =
    typeof capabilities.deviceMemory === 'number' && capabilities.deviceMemory <= 2;
  const lowCoreCount = capabilities.hardwareConcurrency <= 2;
  if (lowMemory || lowCoreCount) {
    return 'eco';
  }

  const highMemory =
    typeof capabilities.deviceMemory === 'number' && capabilities.deviceMemory >= 8;
  const highCoreCount = capabilities.hardwareConcurrency >= 8;
  const highTextureLimit =
    typeof capabilities.maxTextureSize === 'number' &&
    capabilities.maxTextureSize >= 4096;

  if (highMemory && highCoreCount && highTextureLimit) {
    return 'ultra';
  }

  return 'balanced';
}

export const getRecommendedQualityTier = recommendQualityTier;

export type GovernorDirection = 'up' | 'down' | 'hold';

export interface FrameTimeGovernorOptions {
  targetFrameTime?: number;
  initialTier?: QualityProfile;
  initialSettings?: Partial<QualitySettings>;
  minResolutionScale?: number;
  maxResolutionScale?: number;
  minParticleMultiplier?: number;
  maxParticleMultiplier?: number;
  resolutionStep?: number;
  particleStep?: number;
  /** Number of consecutive slow samples before reducing quality. */
  slowFrameThreshold?: number;
  /** Number of consecutive fast samples before restoring quality. */
  fastFrameThreshold?: number;
  smoothing?: number;
}

export interface FrameTimeRecommendation {
  settings: QualitySettings;
  /** Alias for consumers that call the output quality. */
  quality: QualitySettings;
  resolutionScale: number;
  particleMultiplier: number;
  averageFrameTime: number | undefined;
  frameTime: number | undefined;
  direction: GovernorDirection;
  changed: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function copySettings(settings: QualitySettings): QualitySettings {
  return { ...settings };
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A small adaptive-quality controller. Feed it frame durations from the game
 * loop; it returns a new recommendation instead of mutating caller settings.
 */
export class FrameTimeGovernor {
  private readonly targetFrameTime: number;
  private readonly minResolutionScale: number;
  private readonly maxResolutionScale: number;
  private readonly minParticleMultiplier: number;
  private readonly maxParticleMultiplier: number;
  private readonly resolutionStep: number;
  private readonly particleStep: number;
  private readonly slowFrameThreshold: number;
  private readonly fastFrameThreshold: number;
  private readonly smoothing: number;

  private readonly startingSettings: QualitySettings;
  private currentSettings: QualitySettings;
  private smoothedFrameTime: number | undefined;
  private lastFrameTime: number | undefined;
  private slowFrames = 0;
  private fastFrames = 0;
  private lastDirection: GovernorDirection = 'hold';

  constructor(options: FrameTimeGovernorOptions = {}) {
    const initialTier = options.initialTier ?? 'balanced';
    const preset = QUALITY_SETTINGS[initialTier] ?? QUALITY_SETTINGS.balanced;
    const initialSettings = options.initialSettings ?? {};

    this.minResolutionScale = clamp(
      finiteOr(options.minResolutionScale, 0.5),
      0.1,
      4,
    );
    this.maxResolutionScale = Math.max(
      this.minResolutionScale,
      clamp(finiteOr(options.maxResolutionScale, 1.5), 0.1, 4),
    );
    this.minParticleMultiplier = clamp(
      finiteOr(options.minParticleMultiplier, 0.25),
      0,
      10,
    );
    this.maxParticleMultiplier = Math.max(
      this.minParticleMultiplier,
      clamp(finiteOr(options.maxParticleMultiplier, 2), 0, 10),
    );
    this.targetFrameTime = Math.max(
      1,
      finiteOr(options.targetFrameTime, 1000 / 60),
    );
    this.resolutionStep = Math.max(0.001, finiteOr(options.resolutionStep, 0.05));
    this.particleStep = Math.max(0.001, finiteOr(options.particleStep, 0.1));
    this.slowFrameThreshold = Math.max(
      1,
      Math.floor(finiteOr(options.slowFrameThreshold, 1)),
    );
    this.fastFrameThreshold = Math.max(
      1,
      Math.floor(finiteOr(options.fastFrameThreshold, 4)),
    );
    this.smoothing = clamp(finiteOr(options.smoothing, 0.2), 0.01, 1);

    this.startingSettings = {
      ...copySettings(preset),
      ...initialSettings,
      resolutionScale: clamp(
        finiteOr(initialSettings.resolutionScale, preset.resolutionScale),
        this.minResolutionScale,
        this.maxResolutionScale,
      ),
      particleMultiplier: clamp(
        finiteOr(initialSettings.particleMultiplier, preset.particleMultiplier),
        this.minParticleMultiplier,
        this.maxParticleMultiplier,
      ),
    };
    this.currentSettings = copySettings(this.startingSettings);
  }

  /** Current recommendation without consuming a new frame sample. */
  get settings(): QualitySettings {
    return copySettings(this.currentSettings);
  }

  get averageFrameTime(): number | undefined {
    return this.smoothedFrameTime;
  }

  private snapshot(): FrameTimeRecommendation {
    const settings = copySettings(this.currentSettings);
    return {
      settings,
      quality: copySettings(settings),
      resolutionScale: settings.resolutionScale,
      particleMultiplier: settings.particleMultiplier,
      averageFrameTime: this.smoothedFrameTime,
      frameTime: this.lastFrameTime,
      direction: this.lastDirection,
      changed: this.lastDirection !== 'hold',
    };
  }

  /**
   * Record one frame duration in milliseconds and return the new recommendation.
   * Invalid samples are ignored, which keeps instrumentation safe in tests and
   * when a timer is temporarily unavailable.
   */
  update(frameTimeMs: number): FrameTimeRecommendation {
    if (!Number.isFinite(frameTimeMs) || frameTimeMs <= 0) {
      this.lastDirection = 'hold';
      return this.snapshot();
    }

    this.lastFrameTime = frameTimeMs;
    this.smoothedFrameTime =
      this.smoothedFrameTime === undefined
        ? frameTimeMs
        : this.smoothedFrameTime +
          (frameTimeMs - this.smoothedFrameTime) * this.smoothing;

    const slow = this.smoothedFrameTime > this.targetFrameTime * 1.1;
    const fast = this.smoothedFrameTime < this.targetFrameTime * 0.9;
    this.lastDirection = 'hold';

    if (slow) {
      this.slowFrames += 1;
      this.fastFrames = 0;
    } else if (fast) {
      this.fastFrames += 1;
      this.slowFrames = 0;
    } else {
      this.slowFrames = 0;
      this.fastFrames = 0;
    }

    if (this.slowFrames >= this.slowFrameThreshold) {
      this.currentSettings = {
        ...this.currentSettings,
        resolutionScale: clamp(
          this.currentSettings.resolutionScale - this.resolutionStep,
          this.minResolutionScale,
          this.maxResolutionScale,
        ),
        particleMultiplier: clamp(
          this.currentSettings.particleMultiplier - this.particleStep,
          this.minParticleMultiplier,
          this.maxParticleMultiplier,
        ),
      };
      this.slowFrames = 0;
      this.lastDirection = 'down';
    } else if (this.fastFrames >= this.fastFrameThreshold) {
      this.currentSettings = {
        ...this.currentSettings,
        resolutionScale: clamp(
          this.currentSettings.resolutionScale + this.resolutionStep,
          this.minResolutionScale,
          this.maxResolutionScale,
        ),
        particleMultiplier: clamp(
          this.currentSettings.particleMultiplier + this.particleStep,
          this.minParticleMultiplier,
          this.maxParticleMultiplier,
        ),
      };
      this.fastFrames = 0;
      this.lastDirection = 'up';
    }

    return this.snapshot();
  }

  /** Alias that reads naturally at a game-loop call site. */
  sample(frameTimeMs: number): FrameTimeRecommendation {
    return this.update(frameTimeMs);
  }

  /** Return the current recommendation, or record a sample when supplied. */
  recommend(frameTimeMs?: number): FrameTimeRecommendation {
    return frameTimeMs === undefined ? this.snapshot() : this.update(frameTimeMs);
  }

  /** Restore the initial settings and clear the timing history. */
  reset(): void {
    this.currentSettings = copySettings(this.startingSettings);
    this.smoothedFrameTime = undefined;
    this.lastFrameTime = undefined;
    this.slowFrames = 0;
    this.fastFrames = 0;
    this.lastDirection = 'hold';
  }
}

export function createFrameTimeGovernor(
  options: FrameTimeGovernorOptions = {},
): FrameTimeGovernor {
  return new FrameTimeGovernor(options);
}
