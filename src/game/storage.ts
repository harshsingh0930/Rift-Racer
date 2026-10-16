/**
 * Browser-local persistence for the single-player scoreboard.
 *
 * localStorage can be absent, disabled, or configured to throw (for example in
 * private/sandboxed contexts). Every access is therefore optional and guarded.
 */

export const BEST_TIME_STORAGE_KEY = 'rift-racer.best-time';
export const BEST_TIME_KEY = BEST_TIME_STORAGE_KEY;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BestTimeStorageOptions {
  key?: string;
  storage?: StorageLike | null;
  /** When true, an existing faster time is never replaced. */
  onlyIfBetter?: boolean;
}

type StorageInput =
  | BestTimeStorageOptions
  | StorageLike
  | string
  | null
  | undefined;

interface GlobalStorageHost {
  localStorage?: unknown;
}

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
    if (typeof globalThis === 'undefined') {
      return undefined;
    }

    const candidate = (globalThis as unknown as GlobalStorageHost).localStorage;
    return isStorageLike(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function resolveOptions(
  input?: StorageInput,
  secondStorage?: StorageLike | null,
): { key: string; storage: StorageLike | undefined; onlyIfBetter: boolean } {
  if (typeof input === 'string') {
    return {
      key: input || BEST_TIME_STORAGE_KEY,
      storage: secondStorage ?? getDefaultStorage(),
      onlyIfBetter: false,
    };
  }

  if (isStorageLike(input)) {
    return {
      key: BEST_TIME_STORAGE_KEY,
      storage: input,
      onlyIfBetter: false,
    };
  }

  if (input && typeof input === 'object') {
    return {
      key: input.key || BEST_TIME_STORAGE_KEY,
      storage: input.storage === undefined ? getDefaultStorage() : input.storage ?? undefined,
      onlyIfBetter: input.onlyIfBetter === true,
    };
  }

  return {
    key: BEST_TIME_STORAGE_KEY,
    storage: secondStorage ?? getDefaultStorage(),
    onlyIfBetter: false,
  };
}

function parseTime(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function readBestTime(
  input?: StorageInput,
  secondStorage?: StorageLike | null,
): number | null {
  const { key, storage } = resolveOptions(input, secondStorage);
  if (!storage) {
    return null;
  }

  try {
    return parseTime(storage.getItem(key));
  } catch {
    return null;
  }
}

export function writeBestTime(
  timeMs: number,
  input?: StorageInput,
  secondStorage?: StorageLike | null,
): boolean {
  const { key, storage, onlyIfBetter } = resolveOptions(input, secondStorage);
  if (!storage || !Number.isFinite(timeMs) || timeMs < 0) {
    return false;
  }

  if (onlyIfBetter) {
    const existing = readBestTime({ key, storage });
    if (existing !== null && existing <= timeMs) {
      return false;
    }
  }

  try {
    storage.setItem(key, String(timeMs));
    return true;
  } catch {
    return false;
  }
}

export function resetBestTime(
  input?: StorageInput,
  secondStorage?: StorageLike | null,
): boolean {
  const { key, storage } = resolveOptions(input, secondStorage);
  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Persist only a new personal best; returns false when it was not faster. */
export function saveBestTime(
  timeMs: number,
  input?: StorageInput,
  secondStorage?: StorageLike | null,
): boolean {
  const options = { ...asOptions(input) };
  if (options.storage === undefined && secondStorage !== undefined) {
    options.storage = secondStorage;
  }

  return writeBestTime(timeMs, { ...options, onlyIfBetter: true });
}

function asOptions(input: StorageInput): BestTimeStorageOptions {
  if (typeof input === 'string') {
    return { key: input };
  }
  if (isStorageLike(input)) {
    return { storage: input };
  }
  return input ?? {};
}

export const updateBestTime = saveBestTime;
