import {
  BEST_TIME_STORAGE_KEY,
  saveBestTime,
} from '../game/storage';
import type { StorageLike } from '../game/storage';
import type { AutomaticGear } from '../game/transmission';

export const HUD_BEST_TIMES_STORAGE_KEY = 'rift-racer.best-times';
export const DEFAULT_MAX_BEST_TIMES = 5;
export const DEFAULT_MAX_SPEED_KMH = 320;
export const SPEEDOMETER_ARC_LENGTH = Math.PI * 128;

export type RaceStartPhase = 'idle' | 'countdown' | 'go' | 'racing';

export interface BestTimeEntry {
  readonly timeMs: number;
  readonly recordedAt?: number;
  readonly track?: string;
}

export interface LocalBestTimesOptions {
  key?: string;
  storage?: StorageLike | null;
  limit?: number;
}

export interface BestTimeRecord {
  readonly entry: BestTimeEntry;
  readonly entries: readonly BestTimeEntry[];
  readonly isNewBest: boolean;
  readonly persisted: boolean;
}

export interface ResultsOverlayState {
  readonly finalTimeMs: number;
  readonly lapsCompleted?: number;
  readonly bestLapTimeMs?: number | null;
  readonly maxSpeedKmh?: number;
  readonly distanceKm?: number;
  readonly position?: number | null;
  readonly title?: string;
  readonly isNewBest?: boolean;
  /** Set false for a preview overlay that should not touch local storage. */
  readonly recordTime?: boolean;
}

export interface RaceHudState {
  readonly currentLap: number;
  readonly totalLaps: number;
  readonly lapTimeMs: number;
  readonly raceTimeMs: number;
  readonly bestLapTimeMs: number | null;
  readonly speedKmh: number;
  readonly maxSpeedKmh: number;
  readonly gear: AutomaticGear;
  readonly rpm: number;
  readonly distanceKm: number;
  readonly soundEnabled: boolean;
  readonly headlightsEnabled: boolean;
  readonly racePhase: RaceStartPhase;
  readonly countdownValue: number | null;
  readonly results: ResultsOverlayState | null;
  readonly bestTimes: readonly BestTimeEntry[];
}

/** A partial state update accepted by `RaceHud.update`. */
export interface RaceHudUpdate {
  currentLap?: number;
  totalLaps?: number;
  lapTimeMs?: number;
  raceTimeMs?: number;
  bestLapTimeMs?: number | null;
  speedKmh?: number;
  maxSpeedKmh?: number;
  gear?: AutomaticGear;
  rpm?: number;
  /** Convenience input when the game model tracks world units/metres. */
  distanceMeters?: number;
  distanceKm?: number;
  soundEnabled?: boolean;
  headlightsEnabled?: boolean;
  racePhase?: RaceStartPhase;
  countdownValue?: number | null;
  results?: ResultsOverlayState | null;
  bestTimes?: readonly BestTimeEntry[];
}

export type HudRoot = HTMLElement | string;

export interface RaceHudOptions {
  /** Mount immediately when a root is supplied. */
  root?: HudRoot;
  initialState?: Partial<RaceHudState>;
  /** Seed the panel without reading the local leaderboard. */
  bestTimes?: readonly BestTimeEntry[];
  maxSpeedKmh?: number;
  maxBestTimes?: number;
  storage?: StorageLike | null;
  bestTimeStorageKey?: string;
  bestTimesStorageKey?: string;
  onSoundToggle?: (enabled: boolean) => void;
  onHeadlightsToggle?: (enabled: boolean) => void;
  onRestart?: () => void;
  onExit?: () => void;
}

export type HudOptions = RaceHudOptions;

const DEFAULT_STATE: RaceHudState = {
  currentLap: 1,
  totalLaps: 3,
  lapTimeMs: 0,
  raceTimeMs: 0,
  bestLapTimeMs: null,
  speedKmh: 0,
  maxSpeedKmh: 0,
  gear: 1,
  rpm: 950,
  distanceKm: 0,
  soundEnabled: true,
  headlightsEnabled: false,
  racePhase: 'idle',
  countdownValue: null,
  results: null,
  bestTimes: [],
};

interface StorageHost {
  localStorage?: unknown;
}

function getDefaultStorage(): StorageLike | undefined {
  try {
    if (typeof globalThis === 'undefined') return undefined;
    const candidate = (globalThis as unknown as StorageHost).localStorage;
    if (!candidate || typeof candidate !== 'object') return undefined;
    const value = candidate as Partial<StorageLike>;
    return typeof value.getItem === 'function' &&
      typeof value.setItem === 'function' &&
      typeof value.removeItem === 'function'
      ? (candidate as StorageLike)
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveStorage(storage: StorageLike | null | undefined): StorageLike | undefined {
  return storage === undefined ? getDefaultStorage() : storage ?? undefined;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.max(1, Math.floor(value))
    : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function normalizeRaceStartPhase(value: unknown, fallback: RaceStartPhase): RaceStartPhase {
  return value === 'idle' || value === 'countdown' || value === 'go' || value === 'racing'
    ? value
    : fallback;
}

function normalizeBestTimeEntry(value: unknown): BestTimeEntry | undefined {
  if (typeof value === 'number') {
    const timeMs = finiteNonNegative(value, -1);
    return timeMs >= 0 ? { timeMs } : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as {
    timeMs?: unknown;
    time?: unknown;
    recordedAt?: unknown;
    timestamp?: unknown;
    track?: unknown;
  };
  const timeMs = finiteNonNegative(candidate.timeMs ?? candidate.time, -1);
  if (timeMs < 0) return undefined;

  const recordedAt = finiteNonNegative(
    candidate.recordedAt ?? candidate.timestamp,
    -1,
  );
  const track = typeof candidate.track === 'string' && candidate.track.trim()
    ? candidate.track.trim()
    : undefined;
  return {
    timeMs,
    ...(recordedAt >= 0 ? { recordedAt } : {}),
    ...(track ? { track } : {}),
  };
}

function sortBestTimes(entries: readonly BestTimeEntry[], limit: number): BestTimeEntry[] {
  return entries
    .map(normalizeBestTimeEntry)
    .filter((entry): entry is BestTimeEntry => entry !== undefined)
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(0, limit)
    .map((entry) => ({ ...entry }));
}

/** Read the local leaderboard without assuming localStorage is available. */
export function readLocalBestTimes(options: LocalBestTimesOptions = {}): BestTimeEntry[] {
  const storage = resolveStorage(options.storage);
  if (!storage) return [];
  const key = options.key || HUD_BEST_TIMES_STORAGE_KEY;
  const limit = positiveInteger(options.limit, DEFAULT_MAX_BEST_TIMES);

  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { entries?: unknown }).entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];
    return sortBestTimes(values, limit);
  } catch {
    return [];
  }
}

/** Persist a sanitized, sorted local leaderboard. */
export function writeLocalBestTimes(
  entries: readonly BestTimeEntry[],
  options: LocalBestTimesOptions = {},
): boolean {
  const storage = resolveStorage(options.storage);
  if (!storage) return false;
  const key = options.key || HUD_BEST_TIMES_STORAGE_KEY;
  const limit = positiveInteger(options.limit, DEFAULT_MAX_BEST_TIMES);
  const sanitized = sortBestTimes(entries, limit);

  try {
    storage.setItem(key, JSON.stringify(sanitized));
    return true;
  } catch {
    return false;
  }
}

/** Add one time to the local leaderboard and report whether it became #1. */
export function recordLocalBestTime(
  timeMs: number,
  options: LocalBestTimesOptions = {},
): BestTimeRecord | null {
  const normalized = finiteNonNegative(timeMs, -1);
  if (normalized < 0) return null;

  const existing = readLocalBestTimes(options);
  const isNewBest = existing.length === 0 || normalized < existing[0].timeMs;
  const entry: BestTimeEntry = {
    timeMs: normalized,
    recordedAt: Date.now(),
  };
  const entries = sortBestTimes(
    [...existing, entry],
    positiveInteger(options.limit, DEFAULT_MAX_BEST_TIMES),
  );
  const persisted = writeLocalBestTimes(entries, options);
  return { entry, entries, isNewBest, persisted };
}

export function formatRaceTime(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) {
    return '--:--.---';
  }
  const safeMilliseconds = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(safeMilliseconds / 60_000);
  const seconds = Math.floor((safeMilliseconds % 60_000) / 1_000);
  const millis = safeMilliseconds % 1_000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function formatDistance(distanceKm: number | null | undefined): string {
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(distanceKm)) {
    return '0.00 KM';
  }
  return `${Math.max(0, distanceKm).toFixed(2)} KM`;
}

function normalizeResults(results: ResultsOverlayState | null | undefined): ResultsOverlayState | null {
  if (!results) return null;
  const finalTimeMs = finiteNonNegative(results.finalTimeMs, -1);
  if (finalTimeMs < 0) return null;
  const lapsCompleted = results.lapsCompleted === undefined
    ? undefined
    : positiveInteger(results.lapsCompleted, 1);
  const bestLapTimeMs = results.bestLapTimeMs === null || results.bestLapTimeMs === undefined
    ? results.bestLapTimeMs ?? undefined
    : finiteNonNegative(results.bestLapTimeMs, 0);
  const maxSpeedKmh = results.maxSpeedKmh === undefined
    ? undefined
    : finiteNonNegative(results.maxSpeedKmh, 0);
  const distanceKm = results.distanceKm === undefined
    ? undefined
    : finiteNonNegative(results.distanceKm, 0);
  const position = results.position === null || results.position === undefined
    ? results.position ?? undefined
    : positiveInteger(results.position, 1);
  return {
    finalTimeMs,
    ...(lapsCompleted === undefined ? {} : { lapsCompleted }),
    ...(bestLapTimeMs === undefined ? {} : { bestLapTimeMs }),
    ...(maxSpeedKmh === undefined ? {} : { maxSpeedKmh }),
    ...(distanceKm === undefined ? {} : { distanceKm }),
    ...(position === undefined ? {} : { position }),
    ...(results.title ? { title: results.title } : {}),
    ...(results.isNewBest === undefined ? {} : { isNewBest: Boolean(results.isNewBest) }),
    ...(results.recordTime === undefined ? {} : { recordTime: results.recordTime !== false }),
  };
}

function normalizeState(
  state: Partial<RaceHudState>,
  bestTimesFallback: readonly BestTimeEntry[] = [],
  bestTimesLimit = DEFAULT_MAX_BEST_TIMES,
): RaceHudState {
  const totalLaps = positiveInteger(state.totalLaps, DEFAULT_STATE.totalLaps);
  const currentLap = Math.min(
    totalLaps,
    Math.max(1, Math.floor(finiteNonNegative(state.currentLap, DEFAULT_STATE.currentLap))),
  );
  const bestTimes = sortBestTimes(
    state.bestTimes ?? bestTimesFallback,
    positiveInteger(bestTimesLimit, DEFAULT_MAX_BEST_TIMES),
  );
  return {
    currentLap,
    totalLaps,
    lapTimeMs: finiteNonNegative(state.lapTimeMs, DEFAULT_STATE.lapTimeMs),
    raceTimeMs: finiteNonNegative(state.raceTimeMs, DEFAULT_STATE.raceTimeMs),
    bestLapTimeMs: state.bestLapTimeMs === null
      ? null
      : state.bestLapTimeMs === undefined
        ? DEFAULT_STATE.bestLapTimeMs
        : finiteNonNegative(state.bestLapTimeMs, DEFAULT_STATE.bestLapTimeMs ?? 0),
    speedKmh: finiteNonNegative(state.speedKmh, DEFAULT_STATE.speedKmh),
    maxSpeedKmh: finiteNonNegative(state.maxSpeedKmh, DEFAULT_STATE.maxSpeedKmh),
    gear: state.gear === 'R' ? 'R' : Math.min(6, positiveInteger(state.gear, 1)) as AutomaticGear,
    rpm: Math.min(9_000, finiteNonNegative(state.rpm, DEFAULT_STATE.rpm)),
    distanceKm: finiteNonNegative(state.distanceKm, DEFAULT_STATE.distanceKm),
    soundEnabled: state.soundEnabled === undefined ? DEFAULT_STATE.soundEnabled : Boolean(state.soundEnabled),
    headlightsEnabled: state.headlightsEnabled === undefined
      ? DEFAULT_STATE.headlightsEnabled
      : Boolean(state.headlightsEnabled),
    racePhase: normalizeRaceStartPhase(state.racePhase, DEFAULT_STATE.racePhase),
    countdownValue: state.countdownValue === null || state.countdownValue === undefined
      ? DEFAULT_STATE.countdownValue
      : nonNegativeInteger(state.countdownValue, 0),
    results: normalizeResults(state.results),
    bestTimes,
  };
}

function resolveRoot(root: HudRoot | undefined): HTMLElement {
  if (typeof root !== 'string' && root) return root;
  if (typeof document === 'undefined') {
    throw new Error('RaceHud.mount requires a browser document.');
  }
  if (typeof root === 'string') {
    const element = document.querySelector<HTMLElement>(root);
    if (!element) throw new Error(`RaceHud root was not found: ${root}`);
    return element;
  }
  if (!document.body) throw new Error('RaceHud.mount requires document.body or a root element.');
  return document.body;
}

function setText(root: HTMLElement, selector: string, value: string): void {
  const element = root.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function setPressed(root: HTMLElement, selector: string, pressed: boolean): void {
  const element = root.querySelector<HTMLButtonElement>(selector);
  if (element) {
    element.setAttribute('aria-pressed', String(pressed));
    element.dataset.active = String(pressed);
  }
}

function clearChildren(element: Element): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function createHudElement(): HTMLElement {
  const element = document.createElement('section');
  element.className = 'vrr-hud';
  element.setAttribute('aria-label', 'Rift Racer heads-up display');
  element.innerHTML = `
    <div class="vrr-hud__topline">
      <section class="vrr-hud__lap-card" aria-label="Lap timer">
        <div class="vrr-hud__lap-heading">
          <div class="vrr-hud__eyebrow">
            <span class="vrr-hud__checkered" aria-hidden="true"></span>
            <span>LAP TIMER</span>
          </div>
          <span class="vrr-hud__race-time-label">RUN <output data-hud="race-time">00:00.000</output></span>
        </div>
        <output class="vrr-hud__lap-time" data-hud="lap-time" aria-live="polite">00:00.000</output>
        <div class="vrr-hud__lap-meta">
          <span data-hud="lap-count">LAP 1 / 3</span>
          <span class="vrr-hud__best-label" data-hud="best-lap">BEST --:--.---</span>
        </div>
      </section>

      <section class="vrr-hud__controls" aria-label="Race systems">
        <div class="vrr-hud__controls-heading">
          <span>RACE SYSTEMS</span>
          <span class="vrr-hud__controls-status">LIVE</span>
        </div>
        <div class="vrr-hud__control-grid">
        <button class="vrr-hud__toggle" type="button" data-hud-action="sound" aria-label="Toggle sound" aria-pressed="true">
          <span class="vrr-hud__toggle-icon" aria-hidden="true">♫</span>
          <span class="vrr-hud__toggle-copy">SOUND <strong data-hud="sound-state">ON</strong></span>
        </button>
        <button class="vrr-hud__toggle" type="button" data-hud-action="headlights" aria-label="Toggle headlights" aria-pressed="false">
          <span class="vrr-hud__toggle-icon" aria-hidden="true">◐</span>
          <span class="vrr-hud__toggle-copy">LIGHTS <strong data-hud="headlights-state">OFF</strong></span>
        </button>
        <button class="vrr-hud__toggle vrr-hud__toggle--exit" type="button" data-hud-action="exit" aria-label="Exit race">
          <span class="vrr-hud__toggle-icon" aria-hidden="true">×</span>
          <span class="vrr-hud__toggle-copy">EXIT</span>
        </button>
        </div>
      </section>
    </div>

    <section class="vrr-hud__speed-panel" aria-label="Automatic transmission, engine speed and road speed">
      <svg class="vrr-hud__speedometer" viewBox="0 0 320 320" role="img" aria-label="Tachometer, revolutions per minute">
        <path class="vrr-hud__speed-track" d="M 61 259 A 140 140 0 1 1 300 160" />
        <path class="vrr-hud__redline" d="M 252 54 A 140 140 0 0 1 300 160" />
        <g class="vrr-hud__speed-ticks" data-hud="speed-ticks" aria-hidden="true"></g>
        <text x="160" y="92" class="vrr-hud__rpm-label" text-anchor="middle">RPM × 1000</text>
        <g data-hud="rpm-needle" class="vrr-hud__rpm-needle">
          <path d="M 158 166 L 160 29 L 163 166 Z" />
        </g>
        <circle class="vrr-hud__gear-ring" cx="160" cy="160" r="33" />
      </svg>
      <div class="vrr-hud__gear"><output data-hud="gear" aria-label="Automatic gear">1</output><span>AUTO</span></div>
      <div class="vrr-hud__speed-readout">
        <span class="vrr-hud__speed-unit">KM/H</span>
        <output class="vrr-hud__speed-value" data-hud="speed" aria-live="polite">0</output>
      </div>
      <div class="vrr-hud__distance"><strong data-hud="distance">0.00 KM</strong><span data-hud="peak">PEAK 0 KM/H</span></div>
    </section>

    <aside class="vrr-hud__best-times" aria-label="Local best times">
      <div class="vrr-hud__panel-heading">
        <span>LOCAL BEST TIMES</span>
        <span class="vrr-hud__panel-count" data-hud="best-count">0 / 5</span>
      </div>
      <ol class="vrr-hud__best-list" data-hud="best-times-list"></ol>
      <p class="vrr-hud__best-empty" data-hud="best-times-empty">Finish a run to seed your local board.</p>
    </aside>

    <section class="vrr-hud__results" data-hud="results" aria-hidden="true" hidden>
      <div class="vrr-hud__results-card" role="dialog" aria-modal="false" aria-labelledby="vrr-results-title">
        <span class="vrr-hud__results-kicker">RIFT RUN COMPLETE</span>
        <h2 id="vrr-results-title" data-hud="results-title">RESULTS</h2>
        <div class="vrr-hud__results-time" data-hud="results-time">00:00.000</div>
        <div class="vrr-hud__new-best" data-hud="results-best">NEW LOCAL BEST</div>
        <div class="vrr-hud__results-stats">
          <span><b data-hud="results-laps">0</b> LAPS</span>
          <span><b data-hud="results-lap-best">--:--.---</b> BEST LAP</span>
          <span><b data-hud="results-speed">0 KM/H</b> PEAK SPEED</span>
          <span><b data-hud="results-distance">0.00 KM</b> DISTANCE</span>
          <span><b data-hud="results-position">—</b> POSITION</span>
        </div>
        <button class="vrr-hud__restart" type="button" data-hud-action="restart">RERUN THE RIFT <span aria-hidden="true">↗</span></button>
      </div>
    </section>

    <section class="vrr-hud__start-state" data-hud="start-state" aria-live="assertive" hidden>
      <span class="vrr-hud__start-kicker" data-hud="start-kicker">GET READY</span>
      <strong class="vrr-hud__start-value" data-hud="start-value">3</strong>
      <span class="vrr-hud__start-copy" data-hud="start-copy">HOLD ↑ TO LAUNCH</span>
    </section>
  `;

  const ticks = element.querySelector<SVGGElement>('[data-hud="speed-ticks"]');
  if (ticks) {
    const centerX = 160;
    const centerY = 160;
    for (let index = 0; index <= 45; index += 1) {
      const angle = (135 + index * 5) * Math.PI / 180;
      const major = index % 5 === 0;
      const outerRadius = 139;
      const innerRadius = major ? 128 : 134;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(centerX + Math.cos(angle) * innerRadius));
      line.setAttribute('y1', String(centerY + Math.sin(angle) * innerRadius));
      line.setAttribute('x2', String(centerX + Math.cos(angle) * outerRadius));
      line.setAttribute('y2', String(centerY + Math.sin(angle) * outerRadius));
      if (index >= 38) line.classList.add('vrr-hud__red-tick');
      ticks.appendChild(line);
      if (major) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', String(centerX + Math.cos(angle) * 116));
        text.setAttribute('y', String(centerY + Math.sin(angle) * 116 + 4));
        text.setAttribute('text-anchor', 'middle');
        if (index >= 40) text.classList.add('vrr-hud__red-tick');
        text.textContent = String(index / 5);
        ticks.appendChild(text);
      }
    }
  }

  return element;
}

type ClickHandler = () => void;

/**
 * Lightweight, mountable race HUD. It renders only when `mount`/`update` is
 * called; animation timing remains entirely in the host game loop.
 */
export class RaceHud {
  private readonly options: RaceHudOptions;
  private readonly maxSpeedKmh: number;
  private readonly maxBestTimes: number;
  private readonly storage: StorageLike | null | undefined;
  private readonly bestTimeStorageKey: string;
  private readonly bestTimesStorageKey: string;
  private stateValue: RaceHudState;
  private rootElement: HTMLElement | null = null;
  private readonly listeners: Array<{
    element: Element;
    type: 'click';
    handler: EventListener;
  }> = [];

  constructor(options: RaceHudOptions = {}) {
    this.options = options;
    this.maxSpeedKmh = Math.max(1, finiteNonNegative(options.maxSpeedKmh, DEFAULT_MAX_SPEED_KMH));
    this.maxBestTimes = positiveInteger(options.maxBestTimes, DEFAULT_MAX_BEST_TIMES);
    this.storage = options.storage;
    this.bestTimeStorageKey = options.bestTimeStorageKey || BEST_TIME_STORAGE_KEY;
    this.bestTimesStorageKey = options.bestTimesStorageKey || HUD_BEST_TIMES_STORAGE_KEY;

    const persistedTimes = options.bestTimes
      ?? options.initialState?.bestTimes
      ?? readLocalBestTimes({
        storage: options.storage,
        key: this.bestTimesStorageKey,
        limit: this.maxBestTimes,
      });
    this.stateValue = normalizeState(
      {
        ...DEFAULT_STATE,
        ...options.initialState,
        bestTimes: persistedTimes,
      },
      persistedTimes,
      this.maxBestTimes,
    );

    if (options.root !== undefined) this.mount(options.root);
  }

  get element(): HTMLElement | null {
    return this.rootElement;
  }

  get state(): RaceHudState {
    return this.getState();
  }

  getState(): RaceHudState {
    return {
      ...this.stateValue,
      results: this.stateValue.results ? { ...this.stateValue.results } : null,
      bestTimes: this.stateValue.bestTimes.map((entry) => ({ ...entry })),
    };
  }

  /** Mount into a host element or selector. This method never starts a loop. */
  mount(root?: HudRoot): this {
    if (this.rootElement) this.unmount();
    const host = resolveRoot(root ?? this.options.root);
    this.rootElement = createHudElement();
    host.appendChild(this.rootElement);
    this.bindActions();
    this.render();
    return this;
  }

  /** Remove the DOM subtree and listeners while retaining state for remounting. */
  unmount(): this {
    for (const listener of this.listeners) {
      listener.element.removeEventListener(listener.type, listener.handler);
    }
    this.listeners.length = 0;
    this.rootElement?.remove();
    this.rootElement = null;
    return this;
  }

  destroy(): void {
    this.unmount();
  }

  update(patch: RaceHudUpdate): this {
    const next = { ...this.stateValue, ...patch } as Partial<RaceHudState> & RaceHudUpdate;
    if (patch.distanceMeters !== undefined && patch.distanceKm === undefined) {
      next.distanceKm = finiteNonNegative(patch.distanceMeters, 0) / 1_000;
    }
    this.stateValue = normalizeState(next, this.stateValue.bestTimes, this.maxBestTimes);
    this.render();
    return this;
  }

  setState(patch: RaceHudUpdate): this {
    return this.update(patch);
  }

  setSoundEnabled(enabled: boolean): this {
    const next = Boolean(enabled);
    this.stateValue = { ...this.stateValue, soundEnabled: next };
    this.options.onSoundToggle?.(next);
    this.render();
    return this;
  }

  toggleSound(): boolean {
    const enabled = !this.stateValue.soundEnabled;
    this.setSoundEnabled(enabled);
    return enabled;
  }

  setHeadlightsEnabled(enabled: boolean): this {
    const next = Boolean(enabled);
    this.stateValue = { ...this.stateValue, headlightsEnabled: next };
    this.options.onHeadlightsToggle?.(next);
    this.render();
    return this;
  }

  toggleHeadlights(): boolean {
    const enabled = !this.stateValue.headlightsEnabled;
    this.setHeadlightsEnabled(enabled);
    return enabled;
  }

  /** Record a completed time and refresh the local panel. */
  recordBestTime(timeMs: number): BestTimeRecord | null {
    const normalized = finiteNonNegative(timeMs, -1);
    if (normalized < 0) return null;

    const existing = this.stateValue.bestTimes;
    const isNewBest = existing.length === 0 || normalized < existing[0].timeMs;
    const entry: BestTimeEntry = { timeMs: normalized, recordedAt: Date.now() };
    const entries = sortBestTimes([...existing, entry], this.maxBestTimes);
    const persisted = writeLocalBestTimes(entries, {
      storage: this.storage,
      key: this.bestTimesStorageKey,
      limit: this.maxBestTimes,
    });
    // Keep the existing singular best-time API in sync for other game systems.
    saveBestTime(normalized, {
      storage: this.storage,
      key: this.bestTimeStorageKey,
      onlyIfBetter: true,
    });
    this.stateValue = {
      ...this.stateValue,
      bestTimes: entries,
    };
    this.render();
    return { entry, entries, isNewBest, persisted };
  }

  showResults(results: ResultsOverlayState): ResultsOverlayState | null {
    const normalized = normalizeResults(results);
    if (!normalized) return null;

    let isNewBest = normalized.isNewBest;
    if (normalized.recordTime !== false) {
      const record = this.recordBestTime(normalized.finalTimeMs);
      if (isNewBest === undefined) isNewBest = record?.isNewBest ?? false;
    }

    this.stateValue = {
      ...this.stateValue,
      bestLapTimeMs: normalized.bestLapTimeMs === undefined
        ? this.stateValue.bestLapTimeMs
        : normalized.bestLapTimeMs,
      results: { ...normalized, isNewBest },
    };
    this.render();
    return this.stateValue.results ? { ...this.stateValue.results } : null;
  }

  hideResults(): this {
    this.stateValue = { ...this.stateValue, results: null };
    this.render();
    return this;
  }

  clearBestTimes(): this {
    this.stateValue = { ...this.stateValue, bestTimes: [] };
    const storage = resolveStorage(this.storage);
    try {
      storage?.removeItem(this.bestTimesStorageKey);
      storage?.removeItem(this.bestTimeStorageKey);
    } catch {
      // A privacy-mode storage failure should not break the race HUD.
    }
    this.render();
    return this;
  }

  private addAction(selector: string, handler: ClickHandler): void {
    if (!this.rootElement) return;
    const element = this.rootElement.querySelector<HTMLButtonElement>(selector);
    if (!element) return;
    const listener: EventListener = () => handler();
    element.addEventListener('click', listener);
    this.listeners.push({ element, type: 'click', handler: listener });
  }

  private bindActions(): void {
    this.addAction('[data-hud-action="sound"]', () => this.toggleSound());
    this.addAction('[data-hud-action="headlights"]', () => this.toggleHeadlights());
    this.addAction('[data-hud-action="exit"]', () => this.options.onExit?.());
    this.addAction('[data-hud-action="restart"]', () => {
      this.options.onRestart?.();
      if (!this.options.onRestart) this.hideResults();
    });
  }

  private render(): void {
    const root = this.rootElement;
    if (!root) return;
    const state = this.stateValue;

    setText(root, '[data-hud="lap-time"]', formatRaceTime(state.lapTimeMs));
    setText(root, '[data-hud="race-time"]', formatRaceTime(state.raceTimeMs));
    setText(root, '[data-hud="lap-count"]', `LAP ${state.currentLap} / ${state.totalLaps}`);
    setText(root, '[data-hud="best-lap"]', `BEST ${formatRaceTime(state.bestLapTimeMs)}`);
    setPressed(root, '[data-hud-action="sound"]', state.soundEnabled);
    setPressed(root, '[data-hud-action="headlights"]', state.headlightsEnabled);
    setText(root, '[data-hud="sound-state"]', state.soundEnabled ? 'ON' : 'OFF');
    setText(root, '[data-hud="headlights-state"]', state.headlightsEnabled ? 'ON' : 'OFF');

    const speed = Math.round(state.speedKmh);
    const speedRatio = Math.max(0, Math.min(1, state.speedKmh / this.maxSpeedKmh));
    setText(root, '[data-hud="speed"]', String(speed));
    setText(root, '[data-hud="distance"]', formatDistance(state.distanceKm));
    setText(root, '[data-hud="peak"]', `PEAK ${Math.round(state.maxSpeedKmh)} KM/H`);
    setText(root, '[data-hud="gear"]', String(state.gear));
    const needle = root.querySelector<SVGGElement>('[data-hud="rpm-needle"]');
    needle?.setAttribute('transform', `rotate(${-135 + state.rpm / 9_000 * 225} 160 160)`);
    root.dataset.redline = String(state.rpm > 7_600);
    const arc = root.querySelector<SVGPathElement>('[data-hud="speed-arc"]');
    if (arc) {
      arc.style.strokeDasharray = `${SPEEDOMETER_ARC_LENGTH} ${SPEEDOMETER_ARC_LENGTH}`;
      arc.style.strokeDashoffset = String(SPEEDOMETER_ARC_LENGTH * (1 - speedRatio));
    }
    root.style.setProperty('--vrr-speed-progress', String(speedRatio));

    this.renderStartState(root);
    this.renderBestTimes(root);
    this.renderResults(root);
  }

  private renderStartState(root: HTMLElement): void {
    const startState = root.querySelector<HTMLElement>('[data-hud="start-state"]');
    if (!startState) return;

    const visible = this.stateValue.racePhase === 'countdown' || this.stateValue.racePhase === 'go';
    startState.hidden = !visible;
    startState.dataset.phase = this.stateValue.racePhase;
    if (!visible) return;

    const isGo = this.stateValue.racePhase === 'go';
    setText(root, '[data-hud="start-kicker"]', isGo ? 'RIFT LIVE' : 'GET READY');
    setText(root, '[data-hud="start-value"]', isGo ? 'GO' : String(this.stateValue.countdownValue ?? 3));
    setText(root, '[data-hud="start-copy"]', isGo ? 'FIND THE LINE' : 'HOLD ↑ TO LAUNCH');
  }

  private renderBestTimes(root: HTMLElement): void {
    const entries = this.stateValue.bestTimes;
    setText(root, '[data-hud="best-count"]', `${entries.length} / ${this.maxBestTimes}`);
    const empty = root.querySelector<HTMLElement>('[data-hud="best-times-empty"]');
    if (empty) empty.hidden = entries.length > 0;
    const list = root.querySelector<HTMLOListElement>('[data-hud="best-times-list"]');
    if (!list) return;
    clearChildren(list);
    for (const [index, entry] of entries.entries()) {
      const item = document.createElement('li');
      item.className = 'vrr-hud__best-row';
      const rank = document.createElement('span');
      rank.className = 'vrr-hud__best-rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      const time = document.createElement('span');
      time.className = 'vrr-hud__best-time';
      time.textContent = formatRaceTime(entry.timeMs);
      item.append(rank, time);
      list.appendChild(item);
    }
  }

  private renderResults(root: HTMLElement): void {
    const resultsRoot = root.querySelector<HTMLElement>('[data-hud="results"]');
    const result = this.stateValue.results;
    if (!resultsRoot) return;
    resultsRoot.hidden = result === null;
    resultsRoot.setAttribute('aria-hidden', String(result === null));
    if (!result) return;

    setText(root, '[data-hud="results-title"]', result.title || 'RESULTS');
    setText(root, '[data-hud="results-time"]', formatRaceTime(result.finalTimeMs));
    setText(root, '[data-hud="results-laps"]', String(result.lapsCompleted ?? this.stateValue.totalLaps));
    setText(root, '[data-hud="results-lap-best"]', formatRaceTime(result.bestLapTimeMs));
    setText(root, '[data-hud="results-speed"]', `${Math.round(result.maxSpeedKmh ?? this.stateValue.maxSpeedKmh)} KM/H`);
    setText(root, '[data-hud="results-distance"]', formatDistance(result.distanceKm ?? this.stateValue.distanceKm));
    setText(root, '[data-hud="results-position"]', result.position ? String(result.position) : '—');
    const badge = root.querySelector<HTMLElement>('[data-hud="results-best"]');
    if (badge) badge.hidden = result.isNewBest !== true;
  }
}

export function createRaceHud(options: RaceHudOptions = {}): RaceHud {
  return new RaceHud(options);
}

export const createHud = createRaceHud;
export const mountHud = (root: HudRoot, options: Omit<RaceHudOptions, 'root'> = {}): RaceHud =>
  new RaceHud({ ...options, root });
