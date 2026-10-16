/**
 * Keyboard input for the Rift Racer slice.
 *
 * The controller deliberately does not tick or mutate a game object. It keeps
 * the set of pressed keys and exposes a cheap snapshot for a game loop to read
 * whenever it advances the simulation.
 */

export type KeyboardKeyCode =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Space'
  | 'KeyL'
  | 'KeyW'
  | 'KeyA'
  | 'KeyS'
  | 'KeyD';

/** The normalized values consumed by the arcade movement helper. */
export interface KeyboardInputState {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly space: boolean;
  readonly accelerate: boolean;
  readonly reverse: boolean;
  readonly brakePressed: boolean;
  readonly driftPressed: boolean;
  readonly headlightsEnabled: boolean;
  /** Forward (+1) or reverse (-1) throttle. */
  readonly throttle: number;
  /** Left (-1) or right (+1) steering. */
  readonly steering: number;
  /** Alias for `steering`, matching `ArcadeInput`. */
  readonly steer: number;
  /** Brake amount in the inclusive range [0, 1]. */
  readonly brake: number;
  /** Drift amount in the inclusive range [0, 1]. Space requests both. */
  readonly drift: number;
}

/** Short alias for hosts that refer to the snapshot as generic input state. */
export type InputState = KeyboardInputState;

export interface KeyboardEventLike {
  readonly code?: string;
  readonly key?: string;
  readonly repeat?: boolean;
  preventDefault?: () => void;
}

export interface KeyboardTargetLike {
  addEventListener: (
    type: 'keydown' | 'keyup',
    listener: (event: KeyboardEventLike) => void,
  ) => void;
  removeEventListener: (
    type: 'keydown' | 'keyup',
    listener: (event: KeyboardEventLike) => void,
  ) => void;
}

export interface KeyboardInputOptions {
  /** An injected target is useful for tests or an embedded game surface. */
  target?: KeyboardTargetLike | null;
  /** Prevent scrolling while a movement key is being used. Defaults to true. */
  preventDefault?: boolean;
  /** Attach listeners during construction. Defaults to true. */
  autoAttach?: boolean;
  /** Initial state of the L-controlled headlight toggle. */
  headlightsEnabled?: boolean;
}

const MOVEMENT_CODES = new Set<KeyboardKeyCode>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyL',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
]);

const CONTROL_CODES = new Set<KeyboardKeyCode>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyL',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
]);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Convert browser key/code variants into one stable set of control names. */
export function normalizeKeyboardCode(value: string | undefined): KeyboardKeyCode | undefined {
  if (!value) return undefined;

  switch (value) {
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Space':
    case 'KeyL':
    case 'KeyW':
    case 'KeyA':
    case 'KeyS':
    case 'KeyD':
      return value;
    case ' ':
    case 'Spacebar':
      return 'Space';
    case 'l':
    case 'L':
      return 'KeyL';
    case 'w':
    case 'W':
      return 'KeyW';
    case 'a':
    case 'A':
      return 'KeyA';
    case 's':
    case 'S':
      return 'KeyS';
    case 'd':
    case 'D':
      return 'KeyD';
    default:
      return undefined;
  }
}

function codeFromEvent(event: KeyboardEventLike): KeyboardKeyCode | undefined {
  return normalizeKeyboardCode(event.code) ?? normalizeKeyboardCode(event.key);
}

function hasAny(keys: ReadonlySet<KeyboardKeyCode>, ...codes: KeyboardKeyCode[]): boolean {
  return codes.some((code) => keys.has(code));
}

/** Build a normalized immutable snapshot from a pressed-key set. */
export function createInputState(
  pressedKeys: Iterable<string> = [],
  headlightsEnabled = false,
): KeyboardInputState {
  const keys = new Set<KeyboardKeyCode>();
  for (const value of pressedKeys) {
    const code = normalizeKeyboardCode(value);
    if (code && MOVEMENT_CODES.has(code)) keys.add(code);
  }

  const up = hasAny(keys, 'ArrowUp', 'KeyW');
  const down = hasAny(keys, 'ArrowDown', 'KeyS');
  const left = hasAny(keys, 'ArrowLeft', 'KeyA');
  const right = hasAny(keys, 'ArrowRight', 'KeyD');
  const space = keys.has('Space');
  const throttle = clamp((up ? 1 : 0) - (down ? 1 : 0), -1, 1);
  const steering = clamp((right ? 1 : 0) - (left ? 1 : 0), -1, 1);
  const brake = space ? 1 : 0;

  return {
    up,
    down,
    left,
    right,
    space,
    accelerate: up,
    reverse: down,
    brakePressed: space,
    driftPressed: space,
    headlightsEnabled: Boolean(headlightsEnabled),
    throttle,
    steering,
    steer: steering,
    brake,
    drift: brake,
  };
}

/** Alias for callers that prefer a derive/transform naming convention. */
export const deriveInputState = createInputState;

/** Convert a keyboard snapshot to the shape accepted by `updateCarState`. */
export function toArcadeInput(state: KeyboardInputState): {
  throttle: number;
  steer: number;
  steering: number;
  brake: number;
  drift: number;
} {
  return {
    throttle: state.throttle,
    steer: state.steer,
    steering: state.steering,
    brake: state.brake,
    drift: state.drift,
  };
}

function getDefaultKeyboardTarget(): KeyboardTargetLike | undefined {
  try {
    if (typeof globalThis === 'undefined') return undefined;
    const candidate = globalThis as typeof globalThis & {
      addEventListener?: KeyboardTargetLike['addEventListener'];
      removeEventListener?: KeyboardTargetLike['removeEventListener'];
    };
    if (!candidate.addEventListener || !candidate.removeEventListener) return undefined;
    return {
      addEventListener: candidate.addEventListener.bind(candidate),
      removeEventListener: candidate.removeEventListener.bind(candidate),
    };
  } catch {
    return undefined;
  }
}

/**
 * Read-only-by-convention keyboard controller. The game loop owns timing and
 * calls `snapshot()` (or `getArcadeInput()`) as often as it needs.
 */
export class KeyboardInputController {
  private readonly target: KeyboardTargetLike | undefined;
  private readonly preventDefault: boolean;
  private readonly pressedKeys = new Set<KeyboardKeyCode>();
  private headlightsEnabled: boolean;
  private attached = false;

  private readonly onKeyDown = (event: KeyboardEventLike): void => {
    this.handleKeyDown(event);
  };

  private readonly onKeyUp = (event: KeyboardEventLike): void => {
    this.handleKeyUp(event);
  };

  constructor(options: KeyboardInputOptions = {}) {
    this.target = options.target === undefined ? getDefaultKeyboardTarget() : options.target ?? undefined;
    this.preventDefault = options.preventDefault !== false;
    this.headlightsEnabled = Boolean(options.headlightsEnabled);
    if (options.autoAttach !== false) this.attach();
  }

  /** Attach key listeners. Calling this more than once is harmless. */
  attach(): this {
    if (this.attached || !this.target) return this;
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.attached = true;
    return this;
  }

  /** Detach key listeners while retaining the current state. */
  detach(): this {
    if (!this.attached || !this.target) return this;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.attached = false;
    return this;
  }

  /** Handle a keydown directly when an app supplies its own event bridge. */
  handleKeyDown(event: KeyboardEventLike): void {
    const code = codeFromEvent(event);
    if (!code) return;

    const firstPress = !this.pressedKeys.has(code);
    this.pressedKeys.add(code);
    if (this.preventDefault && CONTROL_CODES.has(code)) event.preventDefault?.();

    // L is a toggle, so repeats and keyup/keydown chatter must not flip it
    // more than once for a physical press.
    if (code === 'KeyL' && firstPress && !event.repeat) {
      this.headlightsEnabled = !this.headlightsEnabled;
    }
  }

  /** Handle a keyup directly when an app supplies its own event bridge. */
  handleKeyUp(event: KeyboardEventLike): void {
    const code = codeFromEvent(event);
    if (!code) return;
    this.pressedKeys.delete(code);
    if (this.preventDefault && CONTROL_CODES.has(code)) event.preventDefault?.();
  }

  /** Current normalized state. A fresh object is returned on each call. */
  snapshot(): KeyboardInputState {
    return createInputState(this.pressedKeys, this.headlightsEnabled);
  }

  getState(): KeyboardInputState {
    return this.snapshot();
  }

  /** Current values in the shape expected by the arcade game model. */
  getArcadeInput(): ReturnType<typeof toArcadeInput> {
    return toArcadeInput(this.snapshot());
  }

  isPressed(code: string): boolean {
    const normalized = normalizeKeyboardCode(code);
    return normalized ? this.pressedKeys.has(normalized) : false;
  }

  setHeadlights(enabled: boolean): this {
    this.headlightsEnabled = Boolean(enabled);
    return this;
  }

  toggleHeadlights(): boolean {
    this.headlightsEnabled = !this.headlightsEnabled;
    return this.headlightsEnabled;
  }

  /** Release all movement keys without changing the headlight toggle. */
  clearPressedKeys(): this {
    this.pressedKeys.clear();
    return this;
  }

  /** Stop listening and reset transient input state. */
  dispose(): void {
    this.detach();
    this.clearPressedKeys();
  }
}

export function createKeyboardInput(options: KeyboardInputOptions = {}): KeyboardInputController {
  return new KeyboardInputController(options);
}

/** Friendly aliases for entry points that call this a controller/keyboard. */
export const createKeyboardController = createKeyboardInput;
export { KeyboardInputController as KeyboardInput };
