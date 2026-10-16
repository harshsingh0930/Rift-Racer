import {
  ACESFilmicToneMapping,
  Color,
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
import {
  findNearestTrackPoint,
  sampleTrackPosition,
  sampleTrackTangent,
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
import { createRaceHud, type RaceHud } from './ui';

const TOTAL_LAPS = 3;
const WORLD_SPEED_TO_KMH = 7.75;
const CAR_ROAD_LIFT = 0.24;
const COUNTDOWN_STEP_SECONDS = 0.8;
const COUNTDOWN_STEPS = 3;
const GO_DISPLAY_SECONDS = 0.55;

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
let cameraHasTarget = false;

const cameraTarget = new Vector3();
const cameraTargetDesired = new Vector3();
const cameraDesired = new Vector3();
const forward = new Vector3();
const cameraForward = new Vector3();
const roadCenterAhead = new Vector3();
const roadTangent = new Vector3();
const roadTangentAhead = new Vector3();
const wheelPositions: Vector3[] = [];

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
  const dpr = Math.min(window.devicePixelRatio || 1, tier === 'ultra' ? 2.5 : 1.5);
  targetRenderer.setPixelRatio(Math.max(0.5, dpr * scale));
  targetRenderer.setSize(window.innerWidth, window.innerHeight, false);
}

function applyQualitySettings(
  targetScene: Scene,
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

  targetScene.traverse((object) => {
    const renderable = object as typeof object & {
      castShadow?: boolean;
      receiveShadow?: boolean;
      isLight?: boolean;
      type?: string;
    };

    if (renderable.castShadow !== undefined) {
      renderable.castShadow = shadowsEnabled;
    }
    if (renderable.receiveShadow !== undefined) {
      renderable.receiveShadow = shadowsEnabled;
    }
    if (renderable.isLight) {
      // Keep the cheap hemisphere fill in Eco so standard materials remain
      // readable, while disabling the dynamic point lights and their shadows.
      const dynamicLight = renderable.type !== 'HemisphereLight';
      renderable.visible = !dynamicLight || settings.realTimeLighting;
      if ('castShadow' in renderable) {
        renderable.castShadow = shadowsEnabled && settings.realTimeLighting;
      }
    }
  });
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
  const baseSkidMarks = tier === 'eco' ? 24 : tier === 'ultra' ? 72 : 44;
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
    maxResolutionScale: Math.max(1.5, settings.resolutionScale),
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
  applyQualitySettings(scene, renderer, nextQuality);
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
  const spawn = sampleTrackPosition(SAMPLE_ROUTE, 0, new Vector3());
  const tangent = sampleTrackTangent(SAMPLE_ROUTE, 0, new Vector3());
  carState = createCarState({
    position: { x: spawn.x, y: spawn.y + CAR_ROAD_LIFT, z: spawn.z },
    heading: Math.atan2(tangent.x, tangent.z),
  });
  car?.update(carState, 0);
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
  cameraHasTarget = false;
  hud?.hideResults();
  hud?.update({
    currentLap,
    totalLaps: TOTAL_LAPS,
    lapTimeMs: 0,
    raceTimeMs: 0,
    speedKmh: 0,
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

function keepCarOnRoute(nextState: CarState, deltaSeconds: number): CarState {
  const nearest = findNearestTrackPoint(SAMPLE_ROUTE, nextState.position);
  nearestTrackDistance = nearest.distanceAlongTrack;
  const safeHalfWidth = Math.max(3.1, nearest.width * 0.5 - 1.8);
  const correctedPosition = nextState.position.clone();
  const correctedVelocity = nextState.velocity.clone();

  const towardCenter = new Vector3()
    .subVectors(nearest.position, correctedPosition)
    .setY(0);
  const distance = towardCenter.length();
  const outside = distance > safeHalfWidth;

  if (outside && distance > 0.001) {
    const correction = Math.min(distance - safeHalfWidth, 3.4) * Math.min(1, deltaSeconds * 7);
    towardCenter.normalize();
    correctedPosition.addScaledVector(towardCenter, correction);
    const inwardSpeed = correctedVelocity.dot(towardCenter);
    if (inwardSpeed < 0) correctedVelocity.addScaledVector(towardCenter, -inwardSpeed * 1.4);
    if (wallSparkCooldown <= 0) {
      effects?.emitSparks(correctedPosition, towardCenter, 5);
      wallSparkCooldown = 0.16;
    }
  }

  correctedPosition.y += (nearest.position.y + CAR_ROAD_LIFT - correctedPosition.y) * Math.min(1, deltaSeconds * 4);
  return {
    ...nextState,
    position: correctedPosition,
    velocity: correctedVelocity,
    speed: correctedVelocity.length(),
  };
}

function updateCamera(deltaSeconds: number): void {
  if (!camera || !car) return;

  forward.set(Math.sin(carState.heading), 0, Math.cos(carState.heading));
  sampleTrackTangent(SAMPLE_ROUTE, nearestTrackDistance, roadTangent);

  const speed = Math.max(0, carState.speed);
  const lookAheadDistance = 5.5 + Math.min(7.2, speed * 0.2);
  sampleTrackPosition(
    SAMPLE_ROUTE,
    nearestTrackDistance + lookAheadDistance,
    roadCenterAhead,
  );
  sampleTrackTangent(
    SAMPLE_ROUTE,
    nearestTrackDistance + lookAheadDistance,
    roadTangentAhead,
  );

  // Keep the chase rig aligned to the car. A route tangent blend is useful for
  // smoothing a drift, but letting it steer the whole camera makes the start
  // view feel rotated on tight authored corners.
  cameraForward.copy(forward).lerp(roadTangent, 0.12);
  if (cameraForward.lengthSq() < 0.001) cameraForward.copy(forward);
  cameraForward.normalize();

  const tangentAlignment = Math.max(-1, Math.min(1, roadTangent.dot(roadTangentAhead)));
  const cornerSharpness = Math.max(0, Math.min(1, 1 - tangentAlignment));
  const cameraHeight = 3.35 + cornerSharpness * 0.65 + Math.min(0.3, speed * 0.008);

  cameraDesired
    .copy(car.position)
    .addScaledVector(cameraForward, -8.4);
  cameraDesired.y += cameraHeight;

  cameraTargetDesired
    .copy(car.position)
    .addScaledVector(cameraForward, lookAheadDistance + 1.5)
    // Recenter the horizon only a little. The car stays in the lower middle of
    // frame while the next bend remains visible instead of pulling the camera
    // sideways across the road.
    .lerp(roadCenterAhead, 0.18);
  cameraTargetDesired.y += 0.82 + cornerSharpness * 0.18;

  const followAmount = 1 - Math.exp(-Math.max(0, deltaSeconds) * 7.5);
  if (!cameraHasTarget) {
    camera.position.copy(cameraDesired);
    cameraTarget.copy(cameraTargetDesired);
    cameraHasTarget = true;
  } else {
    camera.position.lerp(cameraDesired, followAmount);
    cameraTarget.lerp(cameraTargetDesired, followAmount);
  }

  camera.lookAt(cameraTarget);
  // Keep the horizon level. A chase-camera roll makes the route edge read like
  // floating triangles when the car is stationary on the opening straight.
  camera.rotation.z = 0;

  const targetFov = 64 + Math.min(10, speed * 0.2);
  camera.fov += (targetFov - camera.fov) * Math.min(1, Math.max(0, deltaSeconds) * 5);
  camera.updateProjectionMatrix();
}

function updateQuality(frameTimeMs: number): void {
  if (!renderer || !governor) return;
  const recommendation = governor.update(frameTimeMs);
  if (!recommendation.changed) return;
  applyResolution(renderer, quality, recommendation.resolutionScale);
}

function updateRace(deltaSeconds: number): void {
  if (!input || !car || !effects || !hud || !world) return;

  const inputState = input.snapshot();
  if (inputState.headlightsEnabled !== headlightsEnabled) {
    setHeadlights(inputState.headlightsEnabled);
  }

  const nextState = updateCarState(
    carState,
    input.getArcadeInput(),
    deltaSeconds,
  );
  carState = keepCarOnRoute(nextState, deltaSeconds);

  elapsedSeconds += deltaSeconds;
  totalRaceTimeMs = elapsedSeconds * 1_000;
  raceDistanceMeters += carState.speed * deltaSeconds;
  const speedKmh = carState.speed * WORLD_SPEED_TO_KMH;
  maxSpeedKmh = Math.max(maxSpeedKmh, speedKmh);
  goDisplayRemaining = Math.max(0, goDisplayRemaining - deltaSeconds);
  wallSparkCooldown = Math.max(0, wallSparkCooldown - deltaSeconds);

  const lapLength = SAMPLE_ROUTE.totalLength;
  const completedLaps = Math.floor(raceDistanceMeters / lapLength);
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

  car.update(carState, deltaSeconds);
  effects.update(deltaSeconds, carState, {
    wheelPositions: car.getWheelWorldPositions(wheelPositions),
  });
  world.update(deltaSeconds, {
    elapsedSeconds,
    routeDistance: raceDistanceMeters,
    speed: carState.speed,
  });

  hud.update({
    currentLap: Math.min(currentLap, TOTAL_LAPS),
    totalLaps: TOTAL_LAPS,
    lapTimeMs: totalRaceTimeMs - lapStartedAtMs,
    raceTimeMs: totalRaceTimeMs,
    bestLapTimeMs,
    speedKmh,
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
  world?.update(deltaSeconds, {
    elapsedSeconds,
    routeDistance: raceDistanceMeters,
    speed: 0,
  });
  car?.update(carState, deltaSeconds);
}

function renderFrame(now: number): void {
  const frameTimeMs = Math.min(100, Math.max(0, now - lastFrameAt));
  const deltaSeconds = Math.min(0.05, frameTimeMs / 1_000);
  lastFrameAt = now;

  if (status === 'racing') updateRace(deltaSeconds);
  else if (status === 'countdown') updateCountdown(deltaSeconds);
  else updateIdle(deltaSeconds);

  updateCamera(deltaSeconds);
  updateQuality(frameTimeMs);
  if (renderer && scene && camera) renderer.render(scene, camera);
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
    onSoundToggle: () => {
      // Sound synthesis will be added after the visual slice. The HUD state is
      // still real and ready for the audio bus, so the control is not dead UI.
    },
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

function boot(): void {
  setLoadingProgress(18, 'Profiling your browser graphics path');
  const capabilities = probeCapabilities();
  quality = readQualityProfile() ?? recommendQualityTier(capabilities);
  requestedQuality = quality;
  qualitySelect.value = quality;
  qualityLabel.textContent = formatQualityLabel(quality);
  setLoadingProgress(36, `Selecting ${formatQualityLabel(quality)}`);

  if (!capabilities.webgl2) {
    showError('WebGL 2 is unavailable. Enable hardware acceleration, then reload Rift Racer.');
    return;
  }

  try {
    renderer = makeRenderer(quality);
  } catch (error) {
    showError(error instanceof Error
      ? `${error.message} Enable hardware acceleration, then reload Rift Racer.`
      : 'WebGL could not be initialized. Enable hardware acceleration, then reload Rift Racer.');
    return;
  }

  scene = new Scene();
  scene.background = new Color(0x070312);
  camera = new PerspectiveCamera(66, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 600);
  camera.up.set(0, 1, 0);
  camera.position.set(-7, 3.1, -3);

  setLoadingProgress(58, 'Building the Rift Racer coastline');
  world = createWorldForQuality(quality);
  effects = createEffectsForQuality(quality);
  car = createCarForQuality(quality);
  scene.add(world, effects, car);
  applyQualitySettings(scene, renderer, quality);

  input = createKeyboardInput({ preventDefault: true, headlightsEnabled: false });
  governor = createGovernorForQuality(quality);

  hud = createHud();
  finishBoot();
}

boot();
