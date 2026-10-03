import type { City, Segment, Street, UserRank, WmeSDK } from 'wme-sdk-typings';
import { log, sdk } from './context';
import type { Options } from './options';
import { findRoadType } from './roadTypes';

type UpdateSegmentArgs = Parameters<WmeSDK['DataModel']['Segments']['updateSegment']>[0];
type SegmentChanges = Omit<UpdateSegmentArgs, 'segmentId'>;

// State shared across the segments of a single apply run (one button press / shortcut /
// auto-apply), so e.g. the empty street for a city is only looked up/created once.
export interface ApplyRun {
  emptyStreets: Map<number, Street>;
}

export const newApplyRun = (): ApplyRun => ({ emptyStreets: new Map() });

// Runs one step for a segment in isolation - if it throws (e.g. a transient
// InvalidStateError on a segment that's still being drawn/connected), the other steps
// for this segment still get applied instead of being skipped.
const safelyApply = (id: number, label: string, fn: () => void): void => {
  try {
    fn();
  } catch (e) {
    log(`Failed to apply ${label} to segment ${id}: ${e}`);
  }
};

const lockRankFor = (options: Options): UserRank | null => {
  if (!options.setLock) return null;

  const road = findRoadType(options.roadType);
  const lockSetting = road && options.locks.find((l) => l.id === road.id);
  if (!lockSetting) return null;

  const userInfo = sdk().State.getUserInfo();
  if (!userInfo) {
    log('No user info available, skipping lock');
    return null;
  }

  // Settings store the displayed level (L1..L6); lockRank is zero-based.
  return Math.max(0, Math.min(lockSetting.lock - 1, userInfo.rank)) as UserRank;
};

const speedFor = (options: Options): number | null => {
  if (!options.updateSpeed) return null;

  const road = findRoadType(options.roadType);
  const speedSetting = road && options.speeds.find((s) => s.id === road.id);
  if (!speedSetting || isNaN(speedSetting.speed) || speedSetting.speed < 0) return null;

  return speedSetting.speed;
};

// Everything that differs from the segment's current state, as updateSegment args.
const segmentChanges = (seg: Segment, options: Options): SegmentChanges => {
  const changes: SegmentChanges = {};

  if (options.roadType && seg.roadType !== options.roadType) {
    changes.roadType = options.roadType;
  }

  const lockRank = lockRankFor(options);
  if (lockRank !== null && seg.lockRank !== lockRank) {
    changes.lockRank = lockRank;
  }

  const speed = speedFor(options);
  if (speed !== null && (seg.fwdSpeedLimit !== speed || seg.revSpeedLimit !== speed)) {
    changes.fwdSpeedLimit = speed;
    changes.revSpeedLimit = speed;
  }

  // Set per segment id, so it can never touch other selected segments, and only when
  // not already unpaved, so it's never toggled back off.
  if (options.unpaved && !seg.flagAttributes.unpaved) {
    changes.flagAttributes = { unpaved: true };
  }

  return changes;
};

// One updateSegment call (one action / undo entry) for all attribute changes. If WME
// rejects the combined update, retry each attribute on its own so one bad attribute
// can't block the rest.
const applySegmentChanges = (id: number, changes: SegmentChanges): void => {
  const keys = Object.keys(changes) as (keyof SegmentChanges)[];
  if (!keys.length) return;

  try {
    sdk().DataModel.Segments.updateSegment({ segmentId: id, ...changes });
    return;
  } catch (e) {
    if (keys.length === 1) {
      log(`Failed to apply ${keys[0]} to segment ${id}: ${e}`);
      return;
    }
    log(`Combined update failed for segment ${id}, retrying attributes one by one: ${e}`);
  }

  const groups: SegmentChanges[] = [];
  if (changes.roadType !== undefined) groups.push({ roadType: changes.roadType });
  if (changes.lockRank !== undefined) groups.push({ lockRank: changes.lockRank });
  if (changes.fwdSpeedLimit !== undefined) {
    groups.push({ fwdSpeedLimit: changes.fwdSpeedLimit, revSpeedLimit: changes.revSpeedLimit });
  }
  if (changes.flagAttributes) groups.push({ flagAttributes: changes.flagAttributes });

  for (const group of groups) {
    safelyApply(id, Object.keys(group)[0], () => sdk().DataModel.Segments.updateSegment({ segmentId: id, ...group }));
  }
};

// A "real" city means it's an actual named city/suburb, not the placeholder WME uses
// to represent "no city" (which is still a City object, just with isEmpty: true).
const isRealCity = (city: City | null | undefined): city is City => !!city && !city.isEmpty;

// Looks at segments directly connected to this one (both directions) and returns the
// first real city used by one of their addresses. This is how we pick up the correct
// suburb/city for a segment that doesn't have one of its own yet - based on the roads
// it's actually attached to, rather than the map's overall "top city".
const getNeighboringCity = (segmentId: number): City | null => {
  const segments = sdk().DataModel.Segments;
  for (const reverseDirection of [false, true]) {
    let connected: Segment[];
    try {
      connected = segments.getConnectedSegments({ segmentId, reverseDirection });
    } catch (e) {
      log(`Could not get connected segments (reverseDirection=${reverseDirection}) for segment ${segmentId}: ${e}`);
      continue;
    }

    for (const neighbor of connected) {
      const city = segments.getAddress({ segmentId: neighbor.id }).city;
      if (isRealCity(city)) return city;
    }
  }
  return null;
};

// Finds (or creates) the "empty" city (cityName: '') for the current country, which is how
// WME represents "no city" for a segment's address.
const getEmptyCity = (): City => {
  const cities = sdk().DataModel.Cities;
  const countryId = sdk().DataModel.Countries.getTopCountry()?.id;
  return cities.getCity({ cityName: '', countryId }) || cities.addCity({ cityName: '', countryId });
};

// Finds (or creates) the "empty" street (streetName: '') for a given city, which is how
// WME represents "no street" for a segment's address.
const getEmptyStreet = (cityId: number, run: ApplyRun): Street => {
  let street = run.emptyStreets.get(cityId);
  if (!street) {
    const streets = sdk().DataModel.Streets;
    street = streets.getStreet({ cityId, streetName: '' }) || streets.addStreet({ cityId, streetName: '' });
    run.emptyStreets.set(cityId, street);
  }
  return street;
};

// Sets the segment's street to "None". Prefers, in order: the segment's own city, the city
// used by a connected/neighboring segment (i.e. the actual suburb this road sits in), the
// map's overall top city, and only then the fully empty city as a last resort.
const applyEmptyStreet = (id: number, run: ApplyRun): void => {
  const segments = sdk().DataModel.Segments;
  const ownCity = segments.getAddress({ segmentId: id }).city;
  const topCity = sdk().DataModel.Cities.getTopCity();

  let source: string;
  let city: City;
  if (isRealCity(ownCity)) {
    [source, city] = ['own', ownCity];
  } else {
    const neighboringCity = getNeighboringCity(id);
    if (neighboringCity) [source, city] = ['neighbor', neighboringCity];
    else if (isRealCity(topCity)) [source, city] = ['top', topCity];
    else [source, city] = ['empty', getEmptyCity()];
  }

  const street = getEmptyStreet(city.id, run);
  log(`[setStreet] segment ${id}: city ${city.id} (${source}), street ${street.id}`);
  segments.updateAddress({ segmentId: id, addressData: { primaryStreetId: street.id } });
};

// Applies the configured options to a single segment. Shared by the manual
// "Quick Set Road" trigger (button/shortcut) and auto-apply-on-create.
export const applySettingsToSegment = (id: number, options: Options, run: ApplyRun): void => {
  let seg: Segment | null;
  try {
    if (!sdk().DataModel.Segments.hasPermissions({ segmentId: id })) {
      log(`Skipping segment ${id}, no edit permission`);
      return;
    }
    seg = sdk().DataModel.Segments.getById({ segmentId: id });
  } catch (e) {
    log(`Failed to look up segment ${id}: ${e}`);
    return;
  }
  if (!seg) return;

  applySegmentChanges(id, segmentChanges(seg, options));
  if (options.setStreet) safelyApply(id, 'street', () => applyEmptyStreet(id, run));
};

// Applies the settings to every currently selected segment.
export const applyToSelection = (options: Options): void => {
  const selection = sdk().Editing.getSelection();
  if (!selection || selection.objectType !== 'segment') return;

  log('Updating selected segments: ' + selection.ids.join(', '));
  const run = newApplyRun();
  for (const id of selection.ids) applySettingsToSegment(id, options, run);
};
