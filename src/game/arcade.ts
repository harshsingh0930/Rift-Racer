import { Vector3 } from "three";

/** A small input surface for the arcade driving model. Values are normalized. */
export type ArcadeInput = {
  /** Forward (+1) or reverse (-1) acceleration. */
  throttle?: number;
  /** Steering, where positive turns toward the player's right. */
  steer?: number;
  /** A brake/handbrake amount from 0 to 1. */
  brake?: number;
  /** Optional explicit drift request. Braking while steering also creates drift. */
  drift?: number;
  /** Alias for `steer`, useful when inputs come from a steering control. */
  steering?: number;
};

/** Tunable constants for the responsive, forgiving arcade handling model. */
export type ArcadeTuning = {
  maxSpeed: number;
  reverseMaxSpeed: number;
  acceleration: number;
  reverseAcceleration: number;
  braking: number;
  rollingDrag: number;
  /** Lateral velocity damping while the car has grip (units per second). */
  lateralGrip: number;
  /** Lateral velocity damping while drifting (lower means more slide). */
  driftGrip: number;
  steeringRate: number;
  steeringResponse: number;
  driftResponse: number;
  driftLateralResponse: number;
  /** Target lateral speed as a fraction of forward speed while drifting. */
  driftLateralSpeed: number;
  driftSteeringBoost: number;
  /** How much a heading change immediately rotates the velocity vector. */
  steeringVelocityInfluence: number;
  /** Retained speed after a soft wall bounce. */
  wallBounce: number;
  /** Tangential speed retained while sliding along a wall. */
  wallFriction: number;
  /** Position correction fraction for a wall penetration. */
  wallCorrection: number;
};

/** A car state is renderer-friendly but contains no scene or UI references. */
export type CarState = {
  position: Vector3;
  velocity: Vector3;
  /** Heading in radians. Zero points along positive Z. */
  heading: number;
  steering: number;
  throttle: number;
  brake: number;
  drift: number;
  /** Cached velocity magnitude, refreshed by every helper/update. */
  speed: number;
};

export type Vector3Like = Readonly<{ x: number; y: number; z: number }>;

/** Values accepted by `createCarState`; speed is derived from velocity. */
export type CarStateOptions = Partial<
  Omit<CarState, "position" | "velocity" | "speed">
> & {
  position?: Vector3Like;
  velocity?: Vector3Like;
};

/** Rectangular soft boundaries in the X/Z driving plane. */
export type SoftWallBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Optional car-radius padding inside the supplied rectangle. */
  padding?: number;
};

export type ArcadeUpdateOptions = {
  tuning?: Partial<ArcadeTuning>;
  walls?: SoftWallBounds;
};

export const DEFAULT_ARCADE_TUNING: Readonly<ArcadeTuning> = {
  maxSpeed: 34,
  reverseMaxSpeed: 11,
  acceleration: 42,
  reverseAcceleration: 22,
  braking: 68,
  rollingDrag: 0.7,
  lateralGrip: 9,
  driftGrip: 1.7,
  steeringRate: 2.4,
  steeringResponse: 9,
  driftResponse: 10,
  driftLateralResponse: 8,
  driftLateralSpeed: 0.65,
  driftSteeringBoost: 0.35,
  steeringVelocityInfluence: 0.55,
  wallBounce: 0.18,
  wallFriction: 0.78,
  wallCorrection: 1,
};

const UP = new Vector3(0, 1, 0);
const EPSILON = 1e-6;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function approach(current: number, target: number, amount: number): number {
  if (amount <= 0) return current;
  if (current < target) return Math.min(current + amount, target);
  return Math.max(current - amount, target);
}

function wrapAngle(angle: number): number {
  const fullTurn = Math.PI * 2;
  const wrapped = angle % fullTurn;
  return wrapped > Math.PI ? wrapped - fullTurn : wrapped <= -Math.PI ? wrapped + fullTurn : wrapped;
}

function positiveDelta(deltaSeconds: number): number {
  return Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
}

function resolveTuning(overrides?: Partial<ArcadeTuning>): ArcadeTuning {
  return { ...DEFAULT_ARCADE_TUNING, ...overrides };
}

function copyVector(value: Vector3Like | undefined): Vector3 {
  return value ? new Vector3(value.x, value.y, value.z) : new Vector3();
}

function cloneCarState(state: CarState): CarState {
  return {
    ...state,
    position: state.position.clone(),
    velocity: state.velocity.clone(),
  };
}

function normalizeInput(input: ArcadeInput): Required<
  Pick<ArcadeInput, "throttle" | "steer" | "brake" | "drift">
> {
  const steer = input.steer ?? input.steering ?? 0;
  return {
    throttle: clamp(input.throttle ?? 0, -1, 1),
    steer: clamp(steer, -1, 1),
    brake: clamp(input.brake ?? 0, 0, 1),
    drift: clamp(input.drift ?? 0, 0, 1),
  };
}

function forwardForHeading(heading: number): Vector3 {
  return new Vector3(Math.sin(heading), 0, Math.cos(heading));
}

function rightForHeading(heading: number): Vector3 {
  // The car faces +Z at heading zero and the chase camera follows from behind.
  // From that view, the player's right is -X, opposite the direction of
  // increasing Y rotation.
  return new Vector3(-Math.cos(heading), 0, Math.sin(heading));
}

/**
 * Create an independent car state. The vectors are cloned so callers can safely
 * reuse spawn points and velocity templates between cars.
 */
export function createCarState(options: CarStateOptions = {}): CarState {
  const velocity = copyVector(options.velocity);
  return {
    position: copyVector(options.position),
    velocity,
    heading: options.heading ?? 0,
    steering: clamp(options.steering ?? 0, -1, 1),
    throttle: clamp(options.throttle ?? 0, -1, 1),
    brake: clamp(options.brake ?? 0, 0, 1),
    drift: clamp(options.drift ?? 0, 0, 1),
    speed: velocity.length(),
  };
}

/**
 * Move longitudinal velocity toward the requested arcade target speed.
 * Braking always eases the car toward rest rather than creating a hard stop.
 */
export function applyResponsiveAcceleration(
  state: CarState,
  input: ArcadeInput = {},
  deltaSeconds: number,
  tuningOverrides?: Partial<ArcadeTuning>,
): CarState {
  const next = cloneCarState(state);
  const inputState = normalizeInput(input);
  const tuning = resolveTuning(tuningOverrides);
  const delta = positiveDelta(deltaSeconds);

  next.throttle = inputState.throttle;
  next.brake = inputState.brake;

  const forward = forwardForHeading(next.heading);
  const forwardSpeed = next.velocity.dot(forward);
  const lateralVelocity = next.velocity
    .clone()
    .addScaledVector(forward, -forwardSpeed);
  const targetSpeed =
    inputState.throttle >= 0
      ? inputState.throttle * tuning.maxSpeed
      : inputState.throttle * tuning.reverseMaxSpeed;
  const acceleration =
    inputState.throttle >= 0 ? tuning.acceleration : tuning.reverseAcceleration;

  let adjustedForwardSpeed = approach(
    forwardSpeed,
    targetSpeed,
    Math.max(0, acceleration) * delta,
  );
  adjustedForwardSpeed = approach(
    adjustedForwardSpeed,
    0,
    Math.max(0, tuning.braking) * inputState.brake * delta,
  );

  next.velocity
    .copy(lateralVelocity)
    .addScaledVector(forward, adjustedForwardSpeed);
  next.speed = next.velocity.length();
  return next;
}

/** Alias with a shorter name for callers that do not need the tuning terminology. */
export function applyArcadeAcceleration(
  state: CarState,
  input: ArcadeInput = {},
  deltaSeconds: number,
  tuningOverrides?: Partial<ArcadeTuning>,
): CarState {
  return applyResponsiveAcceleration(state, input, deltaSeconds, tuningOverrides);
}

/**
 * Smooth steering input into a heading change. A small amount of authority is
 * retained at low speed so the car never feels locked in place.
 */
export function applySteering(
  state: CarState,
  input: ArcadeInput = {},
  deltaSeconds: number,
  tuningOverrides?: Partial<ArcadeTuning>,
): CarState {
  const next = cloneCarState(state);
  const inputState = normalizeInput(input);
  const tuning = resolveTuning(tuningOverrides);
  const delta = positiveDelta(deltaSeconds);

  next.steering = approach(
    next.steering,
    inputState.steer,
    Math.max(0, tuning.steeringResponse) * delta,
  );

  const forward = forwardForHeading(next.heading);
  const forwardSpeed = next.velocity.dot(forward);
  const speedRatio = clamp(
    Math.abs(forwardSpeed) / Math.max(tuning.maxSpeed, EPSILON),
    0,
    1,
  );
  const steeringAuthority = 0.12 + speedRatio * 0.88;
  const travelDirection = forwardSpeed < -EPSILON ? -1 : 1;
  const driftBoost = 1 + Math.max(0, next.drift) * tuning.driftSteeringBoost;
  const headingDelta =
    -next.steering * tuning.steeringRate * steeringAuthority * travelDirection * driftBoost * delta;

  next.heading = wrapAngle(next.heading + headingDelta);
  if (Math.abs(headingDelta) > EPSILON) {
    next.velocity.applyAxisAngle(UP, headingDelta * tuning.steeringVelocityInfluence);
  }
  next.speed = next.velocity.length();
  return next;
}

/**
 * Convert braking plus steering into a controllable slide. Drift reduces grip
 * later in the update, while this helper gives the player a predictable lateral
 * velocity target so a handbrake turn is immediately readable.
 */
export function applyBrakeAssistedDrift(
  state: CarState,
  input: ArcadeInput = {},
  deltaSeconds: number,
  tuningOverrides?: Partial<ArcadeTuning>,
): CarState {
  const next = cloneCarState(state);
  const inputState = normalizeInput(input);
  const tuning = resolveTuning(tuningOverrides);
  const delta = positiveDelta(deltaSeconds);
  const brakeDrift = inputState.brake * Math.abs(inputState.steer);
  const targetDrift = Math.max(inputState.drift, brakeDrift);

  next.brake = inputState.brake;
  next.drift = approach(
    next.drift,
    targetDrift,
    Math.max(0, tuning.driftResponse) * delta,
  );

  const forward = forwardForHeading(next.heading);
  const right = rightForHeading(next.heading);
  const forwardSpeed = next.velocity.dot(forward);
  const currentLateralSpeed = next.velocity.dot(right);
  const travelDirection = forwardSpeed < -EPSILON ? -1 : 1;
  const targetLateralSpeed =
    Math.abs(forwardSpeed) *
    inputState.steer *
    travelDirection *
    tuning.driftLateralSpeed *
    next.drift;
  const lateralResponse =
    Math.max(0, tuning.driftLateralResponse) * Math.max(next.drift, 0.12) * delta;
  const adjustedLateralSpeed = approach(
    currentLateralSpeed,
    targetLateralSpeed,
    lateralResponse,
  );

  next.velocity.addScaledVector(
    right,
    adjustedLateralSpeed - currentLateralSpeed,
  );
  next.speed = next.velocity.length();
  return next;
}

/** Apply rolling drag and lateral grip/friction without touching the position. */
export function applyGripAndFriction(
  state: CarState,
  deltaSeconds: number,
  tuningOverrides?: Partial<ArcadeTuning>,
): CarState {
  const next = cloneCarState(state);
  const tuning = resolveTuning(tuningOverrides);
  const delta = positiveDelta(deltaSeconds);
  const forward = forwardForHeading(next.heading);
  const right = rightForHeading(next.heading);
  const forwardSpeed = next.velocity.dot(forward);
  const lateralSpeed = next.velocity.dot(right);
  const grip =
    tuning.lateralGrip + (tuning.driftGrip - tuning.lateralGrip) * clamp(next.drift, 0, 1);
  const lateralDamping = Math.exp(-Math.max(0, grip) * delta);
  const rollingDamping = Math.exp(-Math.max(0, tuning.rollingDrag) * delta);

  next.velocity
    .set(0, 0, 0)
    .addScaledVector(forward, forwardSpeed * rollingDamping)
    .addScaledVector(right, lateralSpeed * lateralDamping);
  next.speed = next.velocity.length();
  return next;
}

/**
 * Keep the car inside soft rectangular walls. Position is corrected gently and
 * only the velocity component travelling into a wall is reflected and damped.
 */
export function resolveSoftWallCollision(
  state: CarState,
  bounds: SoftWallBounds,
  tuningOverrides?: Partial<ArcadeTuning>,
): CarState {
  const next = cloneCarState(state);
  const tuning = resolveTuning(tuningOverrides);
  const minimumX = Math.min(bounds.minX, bounds.maxX) + Math.max(0, bounds.padding ?? 0);
  const maximumX = Math.max(bounds.minX, bounds.maxX) - Math.max(0, bounds.padding ?? 0);
  const minimumZ = Math.min(bounds.minZ, bounds.maxZ) + Math.max(0, bounds.padding ?? 0);
  const maximumZ = Math.max(bounds.minZ, bounds.maxZ) - Math.max(0, bounds.padding ?? 0);
  const correction = clamp(tuning.wallCorrection, 0, 1);
  const wallBounce = clamp(tuning.wallBounce, 0, 1);
  const wallFriction = clamp(tuning.wallFriction, 0, 1);

  if (next.position.x < minimumX) {
    next.position.x += (minimumX - next.position.x) * correction;
    if (next.velocity.x < 0) next.velocity.x = -next.velocity.x * wallBounce;
    next.velocity.z *= wallFriction;
  } else if (next.position.x > maximumX) {
    next.position.x -= (next.position.x - maximumX) * correction;
    if (next.velocity.x > 0) next.velocity.x = -next.velocity.x * wallBounce;
    next.velocity.z *= wallFriction;
  }

  if (next.position.z < minimumZ) {
    next.position.z += (minimumZ - next.position.z) * correction;
    if (next.velocity.z < 0) next.velocity.z = -next.velocity.z * wallBounce;
    next.velocity.x *= wallFriction;
  } else if (next.position.z > maximumZ) {
    next.position.z -= (next.position.z - maximumZ) * correction;
    if (next.velocity.z > 0) next.velocity.z = -next.velocity.z * wallBounce;
    next.velocity.x *= wallFriction;
  }

  next.speed = next.velocity.length();
  return next;
}

/** Advance one deterministic arcade simulation step and return a new state. */
export function updateCarState(
  state: CarState,
  input: ArcadeInput = {},
  deltaSeconds: number,
  options: ArcadeUpdateOptions = {},
): CarState {
  const delta = positiveDelta(deltaSeconds);
  const tuning = resolveTuning(options.tuning);
  let next = applyResponsiveAcceleration(state, input, delta, tuning);
  next = applyBrakeAssistedDrift(next, input, delta, tuning);
  next = applySteering(next, input, delta, tuning);
  next = applyGripAndFriction(next, delta, tuning);
  next.position.addScaledVector(next.velocity, delta);
  if (options.walls) next = resolveSoftWallCollision(next, options.walls, tuning);
  next.speed = next.velocity.length();
  return next;
}
