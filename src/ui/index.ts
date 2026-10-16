export {
  DEFAULT_MAX_BEST_TIMES,
  DEFAULT_MAX_SPEED_KMH,
  HUD_BEST_TIMES_STORAGE_KEY,
  RaceHud,
  SPEEDOMETER_ARC_LENGTH,
  createHud,
  createRaceHud,
  formatDistance,
  formatRaceTime,
  mountHud,
  readLocalBestTimes,
  recordLocalBestTime,
  writeLocalBestTimes,
} from './hud';

export type {
  BestTimeEntry,
  BestTimeRecord,
  HudOptions,
  HudRoot,
  LocalBestTimesOptions,
  RaceHudOptions,
  RaceHudState,
  RaceHudUpdate,
  ResultsOverlayState,
} from './hud';
