import type { RoadTypeId } from 'wme-sdk-typings';
import { log, pageWindow } from './context';
import { roadTypes } from './roadTypes';

// Same key as v4.x, so existing users keep their settings.
const STORAGE_KEY = 'WME_EZRoads_Options';

export interface LockSetting {
  id: number;
  lock: number;
}

export interface SpeedSetting {
  id: number;
  speed: number;
}

export interface Options {
  roadType: RoadTypeId;
  unpaved: boolean;
  setStreet: boolean;
  applyOnCreate: boolean;
  setLock: boolean;
  updateSpeed: boolean;
  locks: LockSetting[];
  speeds: SpeedSetting[];
}

export type BooleanOptionKey = 'unpaved' | 'setStreet' | 'applyOnCreate' | 'setLock' | 'updateSpeed';

const DEFAULT_LOCK = 1;
const DEFAULT_SPEED = 60;

const defaultOptions = (): Options => ({
  roadType: 1,
  unpaved: false,
  setStreet: false,
  applyOnCreate: false,
  setLock: false,
  updateSpeed: false,
  locks: roadTypes.map((rt) => ({ id: rt.id, lock: DEFAULT_LOCK })),
  speeds: roadTypes.map((rt) => ({ id: rt.id, speed: DEFAULT_SPEED })),
});

const toInt = (value: unknown, fallback: number): number => {
  const n = parseInt(String(value), 10);
  return isNaN(n) ? fallback : n;
};

// Merges saved options over the defaults, and makes sure there's exactly one lock and
// speed entry per road type (older saves may be missing some, or store speeds as strings).
const load = (): Options => {
  const defaults = defaultOptions();
  let saved: Partial<Options> = {};
  try {
    saved = JSON.parse(pageWindow.localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch (e) {
    log('Could not parse saved options, using defaults: ' + e);
  }

  const merged: Options = { ...defaults, ...saved };
  merged.locks = roadTypes.map((rt) => ({
    id: rt.id,
    lock: toInt(saved.locks?.find((l) => l.id === rt.id)?.lock, DEFAULT_LOCK),
  }));
  merged.speeds = roadTypes.map((rt) => ({
    id: rt.id,
    speed: toInt(saved.speeds?.find((s) => s.id === rt.id)?.speed, DEFAULT_SPEED),
  }));
  return merged;
};

// Read once; everything reads this object and calls saveOptions() after changing it.
export const options: Options = load();

export const saveOptions = (): void => {
  pageWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
};

export const resetOptions = (): void => {
  pageWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultOptions()));
};
