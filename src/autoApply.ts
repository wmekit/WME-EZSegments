import { applySettingsToSegment, newApplyRun } from './apply';
import { log, sdk } from './context';
import { options } from './options';

// Segment ids we've already auto-applied settings to, so re-selecting the same
// still-unsaved segment doesn't run the whole thing again. Cleared after a successful
// save, by which point those ids are no longer "new" anyway.
const autoAppliedSegmentIds = new Set<number>();

const isFreshlyDrawn = (id: number): boolean => {
  if (autoAppliedSegmentIds.has(id)) return false;

  try {
    if (!sdk().DataModel.isNew({ dataModelName: 'segments', objectId: id })) return false;
  } catch (e) {
    log(`Could not check if segment ${id} is new, skipping: ${e}`);
    return false;
  }

  // Drawing a new road that starts/ends/passes through an existing segment makes WME
  // split that existing segment into two pieces as a side effect. Both split pieces are
  // themselves unsaved ("new") until the save completes, exactly like the genuinely new
  // segment the user just drew - so `isNew` alone can't tell them apart. Split remnants
  // keep the original segment's address (isEmpty: false); a freshly drawn segment
  // always starts with none.
  try {
    const address = sdk().DataModel.Segments.getAddress({ segmentId: id });
    if (address && !address.isEmpty) {
      log(`Segment ${id} is new but already has an address - likely a split remnant of an existing road, skipping auto-apply`);
      return false;
    }
  } catch (e) {
    log(`Could not check address for segment ${id}, proceeding: ${e}`);
  }

  return true;
};

// If "Auto-Apply On Create" is on, and the selected segment(s) are genuinely new
// (unsaved, freshly drawn) and haven't been auto-applied yet, apply the same settings
// as the manual "Quick Set Road" flow. Everything is applied per segment id, so any
// existing segment that happens to be selected alongside is left alone.
export const maybeAutoApplyOnCreate = (): void => {
  if (!options.applyOnCreate) return;

  const selection = sdk().Editing.getSelection();
  if (!selection || selection.objectType !== 'segment') return;

  const newIds = selection.ids.filter(isFreshlyDrawn);
  if (!newIds.length) return;

  newIds.forEach((id) => autoAppliedSegmentIds.add(id));
  log('New segment(s) selected, auto-applying settings: ' + newIds.join(', '));

  const run = newApplyRun();
  for (const id of newIds) applySettingsToSegment(id, options, run);
};

export const initAutoApply = (): void => {
  sdk().Events.on({
    eventName: 'wme-save-finished',
    eventHandler: ({ success }) => {
      if (success) autoAppliedSegmentIds.clear();
    },
  });
};
