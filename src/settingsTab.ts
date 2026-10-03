import {
  button,
  card,
  columnHeader,
  createPane,
  header,
  ICONS,
  numberInput,
  radioGroup,
  select,
  toggle,
} from 'wmekit-wme-ui';
import { log, SCRIPT_VERSION, sdk } from './context';
import { type BooleanOptionKey, options, resetOptions, saveOptions } from './options';
import { roadTypeName, roadTypes, type RoadTypeEntry } from './roadTypes';
import { bindUpdateNotice } from './updateCheck';

const LOCK_LEVELS = [1, 2, 3, 4, 5, 6];
const LOCK_WIDTH = 52;
const SPEED_WIDTH = 56;

const CHECKBOX_OPTIONS: { key: BooleanOptionKey; text: string; hint: string }[] = [
  { key: 'setStreet', text: 'Set street to none', hint: 'Keeps the city, or borrows one from a connected segment' },
  { key: 'unpaved', text: 'Set as unpaved', hint: 'Ticks the unpaved box on every segment' },
  { key: 'setLock', text: 'Set lock level', hint: 'Uses the lock picked for the road type below' },
  { key: 'updateSpeed', text: 'Set speed limit', hint: 'Uses the speed picked for the road type below' },
  { key: 'applyOnCreate', text: 'Auto-apply to new segments', hint: 'Applies these settings to every road you draw' },
];

// The lock select and speed input shown on each road type row.
const createRoadTypeExtras = (roadType: RoadTypeEntry): { lockSelect: HTMLElement; speedInput: HTMLInputElement } => {
  const lock = options.locks.find((l) => l.id === roadType.id)!;
  const speed = options.speeds.find((s) => s.id === roadType.id)!;

  const lockSelect = select({
    options: LOCK_LEVELS.map((level) => ({ label: `L${level}`, value: level })),
    value: lock.lock,
    title: 'Lock level',
    width: LOCK_WIDTH,
    onChange: (value) => {
      lock.lock = parseInt(value, 10);
      saveOptions();
    },
  });

  const speedInput = numberInput({
    value: speed.speed,
    min: -1,
    title: 'Speed limit',
    width: SPEED_WIDTH,
    onChange: (parsed) => {
      let value = Math.trunc(parsed);
      if (isNaN(value)) {
        value = 0;
        speedInput.value = '0';
      }
      log(`Updating speed for road type ${roadType.id} to ${value}`);
      speed.speed = value;
      saveOptions();
    },
  });

  return { lockSelect, speedInput };
};

export const constructSettings = async (): Promise<void> => {
  const { tabLabel, tabPane } = await sdk().Sidebar.registerScriptTab();
  tabLabel.innerText = 'EZ Segments';
  tabLabel.title = 'Easily Update Roads';

  const root = createPane(tabPane, { id: 'ezroads-settings' });

  const head = header({
    title: 'EZ Segments',
    icon: ICONS.route,
    pills: [`v${SCRIPT_VERSION}`, { label: 'Quick set:', kbd: 'U' }],
  });

  // The lock/speed columns are only shown while their option is on.
  const columns = columnHeader(['Type', { label: 'Lock', width: LOCK_WIDTH }, { label: 'Speed', width: SPEED_WIDTH }]);
  const lockColumn: HTMLElement[] = [columns.children[1] as HTMLElement];
  const speedColumn: HTMLElement[] = [columns.children[2] as HTMLElement];
  const showColumn = (column: HTMLElement[], shown: boolean) => column.forEach((cell) => (cell.hidden = !shown));

  const roadTypeList = radioGroup({
    name: 'ezroads-default-road',
    value: String(options.roadType),
    items: roadTypes.map((rt) => {
      const { lockSelect, speedInput } = createRoadTypeExtras(rt);
      lockColumn.push(lockSelect);
      speedColumn.push(speedInput);
      return { label: roadTypeName(rt), value: String(rt.value), extras: [lockSelect, speedInput] };
    }),
    onChange: (value) => {
      options.roadType = roadTypes.find((rt) => String(rt.value) === value)!.value;
      saveOptions();
    },
  });

  showColumn(lockColumn, options.setLock);
  showColumn(speedColumn, options.updateSpeed);
  const onToggle: Partial<Record<BooleanOptionKey, (checked: boolean) => void>> = {
    setLock: (checked) => showColumn(lockColumn, checked),
    updateSpeed: (checked) => showColumn(speedColumn, checked),
  };

  const toggles = CHECKBOX_OPTIONS.map(({ key, text, hint }) =>
    toggle({
      label: text,
      hint,
      checked: options[key],
      id: `ezroads-${key}`,
      onChange: (checked) => {
        options[key] = checked;
        saveOptions();
        onToggle[key]?.(checked);
      },
    }),
  );

  const reset = button({
    label: 'Reset all options',
    variant: 'danger',
    onClick: () => {
      if (confirm('Are you sure you want to reset all options to default values?')) {
        resetOptions();
        window.location.reload();
      }
    },
  });

  root.append(
    head.el,
    card({ title: 'Options', children: toggles }),
    card({ title: 'Road type', children: [columns, roadTypeList] }),
    reset,
  );

  // Shows the notice now if the update check already resolved, or once it does.
  bindUpdateNotice(head.setNotice);
};
