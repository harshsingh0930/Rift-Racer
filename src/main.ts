import {
  ACESFilmicToneMapping,
  Color,
  FogExp2,
  PCFShadowMap,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import './styles.css';
import './ui/hud.css';
import {
  createCarState,
  updateCarState,
  type CarState,
} from './game/arcade';
import { RouteProgress } from './game/progress';
import { RaceAudio } from './game/audio';
import { tyreSlip } from './game/tyres';
import { CliffDive } from './game/cliff-dive';
import { AutomaticTransmission } from './game/transmission';
import { constrainCarToRoad } from './game/road-contact';
import {
  findNearestTrackPoint,
  sampleTrackPosition,
  sampleTrackTangent,
  sampleTrackSection,
  SAMPLE_ROUTE,
} from './game/track';
import {
  FrameTimeGovernor,
  QUALITY_SETTINGS,
  normalizeQualityProfile,
  probeCapabilities,
  readQualityProfile,
  recommendQualityTier,
  saveQualityProfile,
  type QualityProfile,
  type QualitySettings,
} from './game/performance';
import { createKeyboardInput, type KeyboardInputController } from './input';
import { createRiftCar, type RiftCar } from './render/car';
import { createRiftEffects, type RiftEffects } from './render/effects';
import { createRiftWorld, type RiftWorld } from './render/world';
import { ChaseCamera, type CountdownCameraShot } from './render/camera';
import { RenderPipeline } from './render/pipeline';
import { createPaintEnvironment } from './render/lighting';
import { preloadSceneryTextures } from './render/texture-assets';
import { createRaceHud, type RaceHud } from './ui';

const TOTAL_LAPS = 3;
const WORLD_SPEED_TO_KMH = 3.6;
const transmission = new AutomaticTransmission();
const cliffDive = new CliffDive(SAMPLE_ROUTE);
let engineRpm = 950;
const CAR_ROAD_LIFT = 0.045;
const COUNTDOWN_STEP_SECONDS = 0.8;
const COUNTDOWN_STEPS = 3;
const GO_DISPLAY_SECONDS = 0.55;
const COUNTDOWN_CAMERA_SHOTS: readonly CountdownCameraShot[] = [
  'front-reveal',
  'rear-chase',
  'low-hero',
];

type GameStatus = 'loading' | 'ready' | 'countdown' | 'racing' | 'finished' | 'error';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')!;
const hudRoot = document.querySelector<HTMLElement>('#hud-root')!;
const loadingScreen = document.querySelector<HTMLElement>('#loading-screen')!;
const startScreen = document.querySelector<HTMLElement>('#start-screen')!;
const errorScreen = document.querySelector<HTMLElement>('#error-screen')!;
const loadingProgress = document.querySelector<HTMLElement>('#loading-progress');
const loadingCopy = document.querySelector<HTMLElement>('#loading-copy');
const errorCopy = document.querySelector<HTMLElement>('#error-copy');
const qualityLabel = document.querySelector<HTMLElement>('#quality-label')!;
const qualitySelect = document.querySelector<HTMLSelectElement>('#quality-select')!;
const startButton = document.querySelector<HTMLButtonElement>('#start-button')!;

if (!canvas || !hudRoot || !loadingScreen || !startScreen || !errorScreen || !qualityLabel || !qualitySelect || !startButton) {
    throw new Error('Rift Racer could not find its browser entry elements.');
}

let status: GameStatus = 'loading';
let quality: QualityProfile = 'balanced';
let requestedQuality: QualityProfile = quality;
let renderer: WebGLRenderer | undefined;
let scene: Scene | undefined;
let camera: PerspectiveCamera | undefined;
let chaseCamera: ChaseCamera | undefined;
let pipeline: RenderPipeline | undefined;
let world: RiftWorld | undefined;
let car: RiftCar | undefined;
let effects: RiftEffects | undefined;
let input: KeyboardInputController | undefined;
let hud: RaceHud | undefined;
let governor: FrameTimeGovernor | undefined;
let carState: CarState;
let elapsedSeconds = 0;
let raceDistanceMeters = 0;
let lapStartedAtMs = 0;
let totalRaceTimeMs = 0;
let maxSpeedKmh = 0;
let currentLap = 1;
let bestLapTimeMs: number | null = null;
let lapTimes: number[] = [];
let headlightsEnabled = false;
let lastFrameAt = performance.now();
let wallSparkCooldown = 0;
let countdownElapsedSeconds = 0;
let goDisplayRemaining = 0;
let nearestTrackDistance = 0;
const roadTangent = new Vector3();
const wheelPositions: Vector3[] = [];
const routeProgress = new RouteProgress(SAMPLE_ROUTE.totalLength);
const audio = new RaceAudio();
const coastFogColor = new Color(0x57354f);
const underwaterFogColor = new Color(0x076b8d);

const QA_AUTO_START = (() => {
  if (typeof window === 'undefined') return false;
  const localHost = window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1'
    || window.location.hostname === '::1'
    || window.location.hostname === '[::1]';
  if (!localHost) return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('qa') === '1' || params.get('autostart') === '1';
})();

function setLoadingProgress(value: number, copy: string): void {
  if (loadingProgress) loadingProgress.style.width = `${Math.max(0, Math.min(100, value))}%`;
  if (loadingCopy) loadingCopy.textContent = copy;
}

function showError(message: string): void {
  status = 'error';
  loadingScreen.hidden = true;
  startScreen.hidden = true;
  errorScreen.hidden = false;
  if (errorCopy) errorCopy.textContent = message;
}

function formatQualityLabel(tier: QualityProfile): string {
  return `${tier.toUpperCase()} QUALITY`;
}

function makeRenderer(tier: QualityProfile): WebGLRenderer {
  const settings = QUALITY_SETTINGS[tier];

  const createRenderer = (
    antialias: boolean | undefined,
    powerPreference: 'default' | 'high-performance',
  ): WebGLRenderer => {
    const nextRenderer = new WebGLRenderer({
      canvas,
      antialias,
      alpha: false,
      powerPreference,
      stencil: false,
      depth: true,
    });
    nextRenderer.setClearColor(new Color(0x070312), 1);
    nextRenderer.outputColorSpace = SRGBColorSpace;
    nextRenderer.toneMapping = ACESFilmicToneMapping;
    nextRenderer.toneMappingExposure = 1.15;
    nextRenderer.shadowMap.enabled = settings.shadowQuality !== 'off' && settings.shadows !== false;
    nextRenderer.shadowMap.type = settings.shadowQuality === 'high'
      ? PCFSoftShadowMap
      : PCFShadowMap;
    applyResolution(nextRenderer, tier, settings.resolutionScale);
    return nextRenderer;
  };

  try {
    return createRenderer(settings.antialias, 'high-performance');
  } catch {
    // Some browser implementations reject the MSAA/high-performance
    // combination even when a default WebGL 2 context is available. Keep the
    // same quality tier and let the browser choose a compatible configuration.
    return createRenderer(false, 'default');
  }
}

function applyResolution(targetRenderer: WebGLRenderer, tier: QualityProfile, scale: number): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // The tier scale and display scale multiply. Bound the final buffer so Ultra
  // does not accidentally render 14 million pixels on a 1440p laptop screen.
  targetRenderer.setPixelRatio(Math.max(0.5, Math.min(tier === 'ultra' ? 2 : 1.5, dpr * scale)));
  targetRenderer.setSize(window.innerWidth, window.innerHeight, false);
}

function applyQualitySettings(
  targetRenderer: WebGLRenderer,
  tier: QualityProfile,
): void {
  const settings: QualitySettings = QUALITY_SETTINGS[tier];
  const shadowsEnabled = settings.shadowQuality !== 'off' && settings.shadows !== false;
  targetRenderer.shadowMap.enabled = shadowsEnabled;
  targetRenderer.shadowMap.type = settings.shadowQuality === 'high'
    ? PCFSoftShadowMap
    : PCFShadowMap;
  applyResolution(targetRenderer, tier, settings.resolutionScale);

  // Scene adapters author shadow casters and light visibility deliberately.
  // Enabling every point-light shadow here adds six renders per light, and
  // overriding visibility also turns headlights on against their input state.
  pipeline?.setQuality(tier);
}

function setHeadlights(enabled: boolean): void {
  headlightsEnabled = Boolean(enabled);
  car?.setHeadlights(headlightsEnabled);
  input?.setHeadlights(headlightsEnabled);
  hud?.update({ headlightsEnabled });
}

function createWorldForQuality(tier: QualityProfile): RiftWorld {
  return createRiftWorld({
    route: SAMPLE_ROUTE,
    quality: tier,
  });
}

function createEffectsForQuality(tier: QualityProfile): RiftEffects {
  const settings = QUALITY_SETTINGS[tier];
  const baseSkidMarks = tier === 'eco' ? 512 : tier === 'ultra' ? 4096 : 2048;
  const baseSparks = tier === 'eco' ? 48 : tier === 'ultra' ? 180 : 108;

  return createRiftEffects({
    route: SAMPLE_ROUTE,
    quality: tier,
    maxSkidMarks: Math.max(4, Math.round(baseSkidMarks * settings.effectScale)),
    maxSparks: Math.max(8, Math.round(baseSparks * settings.effectScale)),
  });
}

function createCarForQuality(tier: QualityProfile): RiftCar {
  const settings = QUALITY_SETTINGS[tier];
  return createRiftCar({
    quality: tier,
    realtimeLighting: settings.realTimeLighting,
    headlights: false,
    scale: 0.94,
  });
}

function createGovernorForQuality(tier: QualityProfile): FrameTimeGovernor {
  const settings = QUALITY_SETTINGS[tier];
  return new FrameTimeGovernor({
    initialTier: tier,
    initialSettings: settings,
    // Ultra is the player's explicit choice of image quality. Keep its full
    // resolution instead of silently reducing it after compilation hitches.
    minResolutionScale: tier === 'ultra' ? 0.85 : tier === 'balanced' ? 0.75 : 0.5,
    maxResolutionScale: settings.resolutionScale,
    maxParticleMultiplier: Math.max(2, settings.particleMultiplier),
    targetFrameTime: tier === 'eco' ? 1000 / 30 : 1000 / 60,
    slowFrameThreshold: 8,
    fastFrameThreshold: 20,
  });
}

/**
 * Rebuild only while the welcome screen is visible. The renderer context is
 * kept alive, while the scene-owned quality-sensitive groups and governor are
 * replaced transactionally. This makes a changed profile active for the next
 * run without rebuilding during a live race.
 */
function rebuildQualityScene(nextQuality: QualityProfile): boolean {
  if (!scene || !renderer || (status !== 'ready' && status !== 'finished')) {
    return false;
  }

  let nextWorld: RiftWorld | undefined;
  let nextEffects: RiftEffects | undefined;
  let nextCar: RiftCar | undefined;
  try {
    nextWorld = createWorldForQuality(nextQuality);
    nextEffects = createEffectsForQuality(nextQuality);
    nextCar = createCarForQuality(nextQuality);
  } catch (error) {
    nextWorld?.dispose();
    nextEffects?.dispose();
    nextCar?.dispose();
    console.warn('Rift Racer could not rebuild the selected quality profile.', error);
    return false;
  }

  const previousWorld = world;
  const previousEffects = effects;
  const previousCar = car;
  if (previousWorld) {
    scene.remove(previousWorld);
    previousWorld.dispose();
  }
  if (previousEffects) {
    scene.remove(previousEffects);
    previousEffects.dispose();
  }
  if (previousCar) {
    scene.remove(previousCar);
    previousCar.dispose();
  }

  world = nextWorld;
  effects = nextEffects;
  car = nextCar;
  scene.add(world, effects, car);
  quality = nextQuality;
  requestedQuality = nextQuality;
  governor = createGovernorForQuality(nextQuality);
  applyQualitySettings(renderer, nextQuality);
  setHeadlights(headlightsEnabled);
  resetCarState();
  qualityLabel.textContent = formatQualityLabel(nextQuality);
  qualitySelect.value = nextQuality;
  return true;
}

function handleQualitySelection(): void {
  const nextQuality = normalizeQualityProfile(qualitySelect.value, quality);
  requestedQuality = nextQuality;
  qualitySelect.value = nextQuality;
  saveQualityProfile(nextQuality);

  if (nextQuality === quality) {
    qualityLabel.textContent = formatQualityLabel(quality);
    return;
  }

  if (status === 'ready' || status === 'finished') {
    if (!rebuildQualityScene(nextQuality)) {
      requestedQuality = quality;
      qualitySelect.value = quality;
      qualityLabel.textContent = formatQualityLabel(quality);
    }
    return;
  }

  // A future caller can change the selection while a run is active; the
  // requested value is persisted and applied as soon as the title is shown.
  qualityLabel.textContent = formatQualityLabel(nextQuality);
}

function resetCarState(): void {
  world?.resetTransitions();
  cliffDive.reset();
  pipeline?.resetWater();
  transmission.reset();
  engineRpm = 950;
  nearestTrackDistance = 0;
  const spawn = sampleTrackPosition(SAMPLE_ROUTE, 0, new Vector3());
  const tangent = sampleTrackTangent(SAMPLE_ROUTE, 0, new Vector3());
  carState = createCarState({
    position: { x: spawn.x, y: spawn.y + CAR_ROAD_LIFT, z: spawn.z },
    heading: Math.atan2(tangent.x, tangent.z),
  });
  updateCarVisual(0);
  effects?.clearEffects();
  raceDistanceMeters = 0;
  elapsedSeconds = 0;
  totalRaceTimeMs = 0;
  maxSpeedKmh = 0;
  currentLap = 1;
  lapStartedAtMs = 0;
  bestLapTimeMs = null;
  lapTimes = [];
  wallSparkCooldown = 0;
  countdownElapsedSeconds = 0;
  goDisplayRemaining = 0;
  nearestTrackDistance = 0;
  chaseCamera?.reset();
  routeProgress.reset();
  input?.clearPressedKeys();
  hud?.hideResults();
  hud?.update({
    currentLap,
    totalLaps: TOTAL_LAPS,
    lapTimeMs: 0,
    raceTimeMs: 0,
    speedKmh: 0,
    gear: 1,
    rpm: 950,
    maxSpeedKmh: 0,
    distanceMeters: 0,
    bestLapTimeMs: null,
    racePhase: 'idle',
    countdownValue: null,
    headlightsEnabled,
  });
}

function startRace(): void {
  if (status !== 'ready' && status !== 'finished') return;
  if (requestedQuality !== quality && status === 'ready') {
    rebuildQualityScene(requestedQuality);
  }
  resetCarState();
  void audio.start().then((available) => {
    if (!available) hud?.setSoundEnabled(false);
  });
  status = 'countdown';
  countdownElapsedSeconds = 0;
  goDisplayRemaining = 0;
  hud?.update({
    racePhase: 'countdown',
    countdownValue: COUNTDOWN_STEPS,
    raceTimeMs: 0,
    lapTimeMs: 0,
  });
  lastFrameAt = performance.now();
  loadingScreen.hidden = true;
  startScreen.hidden = true;
  hudRoot.hidden = false;
  startButton.blur();
}

function returnToTitle(): void {
  if (status === 'error') return;
  input?.clearPressedKeys();
  status = 'ready';
  countdownElapsedSeconds = 0;
  goDisplayRemaining = 0;
  if (requestedQuality !== quality) {
    rebuildQualityScene(requestedQuality);
  }
  hud?.hideResults();
  hud?.update({ racePhase: 'idle', countdownValue: null });
  startScreen.hidden = false;
  hudRoot.hidden = true;
}

function beginRaceAtGo(): void {
  status = 'racing';
  // The first racing frame must use the regular chase rig, not a damped
  // heading left over from the final countdown reveal.
  chaseCamera?.reset();
  elapsedSeconds = 0;
  totalRaceTimeMs = 0;
  lapStartedAtMs = 0;
  goDisplayRemaining = GO_DISPLAY_SECONDS;
  hud?.update({
    racePhase: 'go',
    countdownValue: null,
    raceTimeMs: 0,
    lapTimeMs: 0,
  });
}

function finishRace(): void {
  status = 'finished';
  goDisplayRemaining = 0;
  hud?.showResults({
    finalTimeMs: totalRaceTimeMs,
    lapsCompleted: TOTAL_LAPS,
    bestLapTimeMs,
    maxSpeedKmh,
    distanceKm: raceDistanceMeters / 1_000,
    position: 1,
    title: 'RIFT RUN COMPLETE',
  });
}

function keepCarOnRoute(nextState: CarState, nearest = findNearestTrackPoint(SAMPLE_ROUTE, nextState.position)): CarState {
  const result = constrainCarToRoad(SAMPLE_ROUTE, nextState, CAR_ROAD_LIFT, nearest);
  nearestTrackDistance = result.nearest.distanceAlongTrack;
  if (result.contact && wallSparkCooldown <= 0) {
    effects?.emitSparks(result.contact.position, result.contact.direction,
      28 + Math.min(44, result.state.speed * 0.4 + result.contact.impactSpeed * 1.5));
    wallSparkCooldown = 0.024;
  }
  return result.state;
}

function updateCamera(deltaSeconds: number): void {
  if (!camera || !car) return;
  if (status === 'countdown') {
    const shotIndex = Math.min(
      COUNTDOWN_CAMERA_SHOTS.length - 1,
      Math.floor(countdownElapsedSeconds / COUNTDOWN_STEP_SECONDS),
    );
    chaseCamera?.updateCountdown(
      car.position,
      carState.heading,
      COUNTDOWN_CAMERA_SHOTS[shotIndex],
    );
  } else {
    chaseCamera?.update(car.position, carState.heading, carState.speed, deltaSeconds, { ...carState, airborne: cliffDive.active });
  }
  world?.sky.position.copy(camera.position);
}

function updateCarVisual(deltaSeconds: number): void {
  sampleTrackTangent(SAMPLE_ROUTE, nearestTrackDistance, roadTangent);
  const carForward = new Vector3(Math.sin(carState.heading), 0, Math.cos(carState.heading));
  const roadPitch = Math.atan2(roadTangent.y, Math.hypot(roadTangent.x, roadTangent.z))
    * Math.sign(carForward.dot(roadTangent));
  car?.update({ ...carState, roadPitch: cliffDive.active ? cliffDive.pitch : roadPitch, airborne: cliffDive.active }, deltaSeconds);
}

function updateQuality(frameTimeMs: number): void {
  if (!renderer || !governor) return;
  const recommendation = governor.update(frameTimeMs);
  if (!recommendation.changed) return;
  applyResolution(renderer, quality, recommendation.resolutionScale);
  effects?.setEmissionScale(recommendation.particleMultiplier / QUALITY_SETTINGS[quality].particleMultiplier);
}

function updateRace(deltaSeconds: number): void {
  if (!input || !car || !effects || !hud || !world) return;

  const inputState = input.snapshot();
  if (inputState.headlightsEnabled !== headlightsEnabled) {
    setHeadlights(inputState.headlightsEnabled);
  }

  const previousPosition = carState.position.clone();
  const controls = input.getArcadeInput();
  const steps = Math.max(1, Math.ceil(deltaSeconds * 120));
  for (let step = 0; step < steps; step += 1) {
    const stepDelta = deltaSeconds / steps;
    if (!cliffDive.active) {
      const next = updateCarState(carState, controls, stepDelta);
      const nearest = findNearestTrackPoint(SAMPLE_ROUTE, next.position);
      if (!cliffDive.tryLaunch(next, nearest.distanceAlongTrack)) {
        carState = keepCarOnRoute(next, nearest);
        continue;
      }
      carState = next;
    }
    const flight = cliffDive.step(carState, controls, stepDelta);
    carState = flight.state;nearestTrackDistance = cliffDive.routeDistance;
    if (flight.splash) { world.emitSplash(flight.splash); effects.emitSplash(flight.splash);audio.playSplash();pipeline?.waterImpact(); }
    if (flight.landed) chaseCamera?.reset();
  }

  elapsedSeconds += deltaSeconds;
  totalRaceTimeMs = elapsedSeconds * 1_000;
  const travelDistance = previousPosition.distanceTo(carState.position);
  raceDistanceMeters += travelDistance;
  const speedKmh = carState.speed * WORLD_SPEED_TO_KMH;
  const signedSpeed = carState.velocity.x * Math.sin(carState.heading)
    + carState.velocity.z * Math.cos(carState.heading);
  const gearbox = transmission.update(signedSpeed, carState.throttle, deltaSeconds);
  engineRpm = gearbox.rpm;
  maxSpeedKmh = Math.max(maxSpeedKmh, speedKmh);
  goDisplayRemaining = Math.max(0, goDisplayRemaining - deltaSeconds);
  wallSparkCooldown = Math.max(0, wallSparkCooldown - deltaSeconds);

  const nearest = findNearestTrackPoint(SAMPLE_ROUTE, carState.position);
  const onTrack = cliffDive.active || nearest.distanceFromTrack <= nearest.width * 0.5 - 0.5;
  const completedLaps = routeProgress.update(nearestTrackDistance, travelDistance, onTrack);
  if (completedLaps >= currentLap) {
    const lapTimeMs = totalRaceTimeMs - lapStartedAtMs;
    lapTimes.push(lapTimeMs);
    bestLapTimeMs = bestLapTimeMs === null ? lapTimeMs : Math.min(bestLapTimeMs, lapTimeMs);
    lapStartedAtMs = totalRaceTimeMs;
    currentLap += 1;
    if (currentLap > TOTAL_LAPS) {
      finishRace();
    }
  }

  updateCarVisual(deltaSeconds);
  effects.update(deltaSeconds, carState, {
    wheelPositions: car.getWheelWorldPositions(wheelPositions),
    emitDriftEffects: !cliffDive.active,
  });
  world.update(deltaSeconds, {
    routeDistance: nearestTrackDistance,
    playerPosition: carState.position,
    speed: carState.speed,
    submerged: cliffDive.active ? cliffDive.submerged : undefined,
  });

  hud.update({
    currentLap: Math.min(currentLap, TOTAL_LAPS),
    totalLaps: TOTAL_LAPS,
    lapTimeMs: totalRaceTimeMs - lapStartedAtMs,
    raceTimeMs: totalRaceTimeMs,
    bestLapTimeMs,
    speedKmh,
    gear: gearbox.gear,
    rpm: gearbox.rpm,
    maxSpeedKmh,
    distanceMeters: raceDistanceMeters,
    racePhase: goDisplayRemaining > 0 ? 'go' : 'racing',
    headlightsEnabled,
  });
}

function updateCountdown(deltaSeconds: number): void {
  countdownElapsedSeconds += deltaSeconds;
  updateIdle(deltaSeconds);

  if (countdownElapsedSeconds >= COUNTDOWN_STEP_SECONDS * COUNTDOWN_STEPS) {
    beginRaceAtGo();
    return;
  }

  const step = Math.floor(countdownElapsedSeconds / COUNTDOWN_STEP_SECONDS);
  hud?.update({
    racePhase: 'countdown',
    countdownValue: Math.max(1, COUNTDOWN_STEPS - step),
    raceTimeMs: 0,
    lapTimeMs: 0,
  });
}

function updateIdle(deltaSeconds: number): void {
  effects?.update(deltaSeconds, undefined, { emitDriftEffects: false });
  world?.update(deltaSeconds, {
    routeDistance: nearestTrackDistance,
    playerPosition: carState.position,
    speed: 0,
  });
  updateCarVisual(deltaSeconds);
}

function renderFrame(now: number): void {
  const frameTimeMs = Math.min(250, Math.max(0, now - lastFrameAt));
  const deltaSeconds = frameTimeMs / 1_000;
  lastFrameAt = now;
  if (document.hidden) {
    audio.update(0, 0, 0, false);
    requestAnimationFrame(renderFrame);
    return;
  }

  if (status === 'racing') updateRace(deltaSeconds);
  else if (status === 'countdown') updateCountdown(deltaSeconds);
  else updateIdle(deltaSeconds);

  updateCamera(deltaSeconds);
  updateQuality(frameTimeMs);
  audio.update(carState.speed, carState.throttle, tyreSlip(carState), status === 'racing', engineRpm, !cliffDive.active,
    (cliffDive.active && cliffDive.submerged) || sampleTrackSection(SAMPLE_ROUTE, nearestTrackDistance) === 'underwater', carState.brake);
  if (scene?.fog instanceof FogExp2) {
    const underwater = (cliffDive.active && cliffDive.submerged) || sampleTrackSection(SAMPLE_ROUTE, nearestTrackDistance) === 'underwater';
    const amount = 1 - Math.exp(-deltaSeconds * (underwater ? 8 : 3));
    scene.fog.color.lerp(underwater ? underwaterFogColor : coastFogColor, amount);
    scene.fog.density += ((underwater ? 0.025 : 0.018) - scene.fog.density) * amount;
  }
  pipeline?.updateWater(deltaSeconds, (cliffDive.active && cliffDive.submerged) || sampleTrackSection(SAMPLE_ROUTE, nearestTrackDistance) === "underwater");
  pipeline?.render();
  requestAnimationFrame(renderFrame);
}

function handleResize(): void {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
  applyResolution(renderer, quality, governor?.settings.resolutionScale ?? QUALITY_SETTINGS[quality].resolutionScale);
}

function createHud(): RaceHud {
  return createRaceHud({
    root: '#hud-root',
    initialState: {
      totalLaps: TOTAL_LAPS,
      headlightsEnabled: false,
    },
    bestTimesStorageKey: 'rift-racer.coast-v2.best-runs',
    bestTimeStorageKey: 'rift-racer.coast-v2.best-run',
    onSoundToggle: (enabled) => audio.setEnabled(enabled),
    onHeadlightsToggle: (enabled) => setHeadlights(enabled),
    onRestart: startRace,
    onExit: returnToTitle,
  });
}

function finishBoot(): void {
  resetCarState();
  hudRoot.hidden = true;
  loadingScreen.hidden = true;
  startScreen.hidden = false;
  errorScreen.hidden = true;
  status = 'ready';
  setLoadingProgress(100, 'Ready');
  window.addEventListener('resize', handleResize, { passive: true });
  window.addEventListener('blur', () => input?.clearPressedKeys());
  document.addEventListener('visibilitychange', () => {
    input?.clearPressedKeys();
    lastFrameAt = performance.now();
    if (document.hidden) audio.update(0, 0, 0, false);
  });
  startButton.addEventListener('click', startRace);
  qualitySelect.addEventListener('change', handleQualitySelection);
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Enter' && status === 'ready') startRace();
    if (event.code === 'Escape' && (status === 'countdown' || status === 'racing' || status === 'finished')) returnToTitle();
  });
  if (QA_AUTO_START) {
    // A local-only query flag keeps browser QA repeatable without changing the
    // normal welcome-screen flow for players or deployed builds.
    window.setTimeout(() => {
      if (status === 'ready') startRace();
    }, 120);
  }
  requestAnimationFrame(renderFrame);
}

async function boot(): Promise<void> {
  setLoadingProgress(18, 'Profiling your browser graphics path');
  const capabilities = probeCapabilities();
  quality = readQualityProfile() ?? recommendQualityTier(capabilities);
  requestedQuality = quality;
  qualitySelect.value = quality;
  qualityLabel.textContent = formatQualityLabel(quality);
  setLoadingProgress(36, `Selecting ${formatQualityLabel(quality)}`);

  if (!capabilities.webgl2) {
    showError('WebGL 2 is unavailable. Check browser graphics settings and GPU drivers, then restart your browser.');
    return;
  }

  try {
    renderer = makeRenderer(quality);
  } catch (error) {
    showError(error instanceof Error
      ? `${error.message} Check browser graphics settings and GPU drivers, then restart your browser.`
      : 'WebGL could not be initialized. Check browser graphics settings and GPU drivers.');
    return;
  }

  scene = new Scene();
  scene.background = new Color(0x070312);
  scene.environment = createPaintEnvironment(renderer).texture;
  scene.environmentIntensity = 0.4;
  scene.fog = new FogExp2(coastFogColor, 0.018);
  camera = new PerspectiveCamera(60, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 1200);
  chaseCamera = new ChaseCamera(camera, SAMPLE_ROUTE);
  pipeline = new RenderPipeline(renderer, scene, camera);
  camera.up.set(0, 1, 0);
  camera.position.set(-7, 3.1, -3);

  setLoadingProgress(48, 'Loading scenery textures');
  try {
    await preloadSceneryTextures();
  } catch (error) {
    showError('Scenery textures could not load. Reload to retry.');
    console.error(error);
    return;
  }
  setLoadingProgress(58, 'Building the Rift Racer coastline');
  world = createWorldForQuality(quality);
  effects = createEffectsForQuality(quality);
  car = createCarForQuality(quality);
  scene.add(world, effects, car);
  applyQualitySettings(renderer, quality);

  setLoadingProgress(85, 'Preparing scenery and shaders');
  await renderer.compileAsync(scene, camera);

  input = createKeyboardInput({ preventDefault: true, headlightsEnabled: false });
  governor = createGovernorForQuality(quality);

  hud = createHud();
  finishBoot();
}

boot();
