import type { RoadTypeId } from 'wme-sdk-typings';
import { log, sdk } from './context';

// `id` is our own 1..17 index, which stored lock/speed settings are keyed by - don't
// renumber it. `value` is the WME road type id (ROAD_TYPE in the SDK).
export interface RoadTypeEntry {
  id: number;
  name: string;
  value: RoadTypeId;
}

export const roadTypes: RoadTypeEntry[] = [
  { id: 1, name: 'Street', value: 1 },
  { id: 2, name: 'Primary Street', value: 2 },
  { id: 3, name: 'Freeway', value: 3 },
  { id: 4, name: 'Ramp', value: 4 },
  { id: 5, name: 'Walking Trail', value: 5 },
  { id: 6, name: 'Major Highway', value: 6 },
  { id: 7, name: 'Minor Freeway', value: 7 },
  { id: 8, name: 'Offroad', value: 8 },
  { id: 9, name: 'Walkway', value: 9 },
  { id: 10, name: 'Pedestrian Walkway', value: 10 },
  { id: 11, name: 'Ferry', value: 15 },
  { id: 12, name: 'Stairway', value: 16 },
  { id: 13, name: 'Private Road', value: 17 },
  { id: 14, name: 'Railroad', value: 18 },
  { id: 15, name: 'Runway/Taxiway', value: 19 },
  { id: 16, name: 'Parking Lot Road', value: 20 },
  { id: 17, name: 'Alley', value: 22 },
];

export const findRoadType = (value: RoadTypeId): RoadTypeEntry | undefined =>
  roadTypes.find((rt) => rt.value === value);

const localizedNames = new Map<RoadTypeId, string>();

export const loadLocalizedRoadTypeNames = (): void => {
  try {
    for (const rt of sdk().DataModel.Segments.getRoadTypes()) {
      localizedNames.set(rt.id, rt.localizedName || rt.name);
    }
  } catch (e) {
    log('Could not load localized road type names: ' + e);
  }
};

// Prefer the SDK's localized road type name (respects the editor's language setting),
// falling back to our hardcoded label if the lookup isn't available for some reason.
export const roadTypeName = (roadType: RoadTypeEntry): string => localizedNames.get(roadType.value) || roadType.name;
