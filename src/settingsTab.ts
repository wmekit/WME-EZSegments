import { log, SCRIPT_VERSION, sdk } from './context';
import { type BooleanOptionKey, options, resetOptions, saveOptions } from './options';
import { roadTypeName, roadTypes, type RoadTypeEntry } from './roadTypes';
import { renderUpdateNotice, UPDATE_NOTICE_ID } from './updateCheck';

const LOCK_LEVELS = [1, 2, 3, 4, 5, 6];

const CHECKBOX_OPTIONS: { key: BooleanOptionKey; text: string }[] = [
  { key: 'setStreet', text: 'Set Street To None' },
  { key: 'unpaved', text: 'Set Road as Unpaved' },
  { key: 'setLock', text: 'Set the lock to the level' },
  { key: 'updateSpeed', text: 'Update speed limits' },
  { key: 'applyOnCreate', text: 'Auto-Apply On Create' },
];

const STYLES = `
  #ezroads-settings h2, #ezroads-settings h5 {
    margin-top: 0;
    margin-bottom: 10px;
  }
  .ezroads-section {
    margin-bottom: 15px;
  }
  .ezroads-option {
    margin-bottom: 8px;
  }
  .ezroads-radio-container {
    display: flex;
    align-items: center;
  }
  .ezroads-radio-container input[type="radio"] {
    margin-right: 5px;
  }
  .ezroads-radio-container label {
    flex: 1;
    margin-right: 10px;
    text-align: left;
  }
  .ezroads-radio-container select {
    width: 80px;
    margin-left: auto;
    margin-right: 5px;
  }
  .ezroads-radio-container input.ezroads-road-speed {
    width: 60px;
  }
  .ezroads-reset-button {
    margin-top: 20px;
    padding: 8px 12px;
    background-color: #f44336;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: bold;
  }
  .ezroads-reset-button:hover {
    background-color: #d32f2f;
  }
`;

const TEMPLATE = `
  <div id="ezroads-settings">
    <style>${STYLES}</style>
    <div class="ezroads-section">
      <h2>EZ Segments</h2>
      <div>Current Version: <b>${SCRIPT_VERSION}</b></div>
      <div>Update Keybind: <kbd>u</kbd></div>
      <div id="${UPDATE_NOTICE_ID}" style="display: none; margin-top: 5px; color: #f44336; font-weight: bold;"></div>
    </div>
    <div class="ezroads-section">
      <div style="display: flex; align-items: center;">
        <div style="flex-grow: 1; text-align: center;">Road Type</div>
        <div style="width: 80px; text-align: center;">Lock</div>
        <div style="width: 60px; text-align: center;">Speed</div>
      </div>
    </div>
    <div class="ezroads-section" data-ezroads="road-types"></div>
    <div class="ezroads-section">
      <h5>Additional Options</h5>
      <div data-ezroads="checkboxes"></div>
    </div>
    <button type="button" class="ezroads-reset-button">Reset All Options</button>
  </div>
`;

const fromHtml = <T extends Element>(html: string): T => {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild as T;
};

const createRoadTypeRow = (roadType: RoadTypeEntry): HTMLElement => {
  const id = `ezroads-road-${roadType.id}`;
  const lock = options.locks.find((l) => l.id === roadType.id)!;
  const speed = options.speeds.find((s) => s.id === roadType.id)!;

  const row = fromHtml<HTMLElement>(`
    <div class="ezroads-option">
      <div class="ezroads-radio-container">
        <input type="radio" id="${id}" name="ezroads-default-road">
        <label for="${id}"></label>
        <select class="ezroads-road-lock">
          ${LOCK_LEVELS.map((level) => `<option value="${level}">L${level}</option>`).join('')}
        </select>
        <input type="number" class="ezroads-road-speed" min="-1">
      </div>
    </div>
  `);

  const radio = row.querySelector<HTMLInputElement>('input[type="radio"]')!;
  const label = row.querySelector('label')!;
  const select = row.querySelector('select')!;
  const speedInput = row.querySelector<HTMLInputElement>('input.ezroads-road-speed')!;

  label.textContent = roadTypeName(roadType);
  radio.checked = options.roadType === roadType.value;
  select.value = String(lock.lock);
  select.disabled = !options.setLock;
  speedInput.value = String(speed.speed);
  speedInput.disabled = !options.updateSpeed;

  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    options.roadType = roadType.value;
    saveOptions();
  });

  select.addEventListener('change', () => {
    lock.lock = parseInt(select.value, 10);
    saveOptions();
  });

  speedInput.addEventListener('change', () => {
    let value = parseInt(speedInput.value, 10);
    if (isNaN(value)) {
      value = 0;
      speedInput.value = '0';
    }
    log(`Updating speed for road type ${roadType.id} to ${value}`);
    speed.speed = value;
    saveOptions();
  });

  return row;
};

const createCheckbox = (key: BooleanOptionKey, text: string, onChange?: (checked: boolean) => void): HTMLElement => {
  const id = `ezroads-${key}`;
  const row = fromHtml<HTMLElement>(`
    <div class="ezroads-option">
      <input type="checkbox" id="${id}">
      <label for="${id}"></label>
    </div>
  `);

  const input = row.querySelector('input')!;
  row.querySelector('label')!.textContent = text;
  input.checked = options[key];
  input.addEventListener('change', () => {
    options[key] = input.checked;
    saveOptions();
    onChange?.(input.checked);
  });

  return row;
};

export const constructSettings = async (): Promise<void> => {
  const { tabLabel, tabPane } = await sdk().Sidebar.registerScriptTab();
  tabLabel.innerText = 'EZ Segments';
  tabLabel.title = 'Easily Update Roads';

  tabPane.innerHTML = TEMPLATE;
  const roadTypeContainer = tabPane.querySelector('[data-ezroads="road-types"]')!;
  const checkboxContainer = tabPane.querySelector('[data-ezroads="checkboxes"]')!;

  roadTypes.forEach((rt) => roadTypeContainer.appendChild(createRoadTypeRow(rt)));

  // Lock/speed inputs are only editable while their option is on.
  const setDisabled = (selector: string, disabled: boolean): void => {
    tabPane.querySelectorAll<HTMLInputElement | HTMLSelectElement>(selector).forEach((el) => (el.disabled = disabled));
  };
  const onChange: Partial<Record<BooleanOptionKey, (checked: boolean) => void>> = {
    setLock: (checked) => setDisabled('.ezroads-road-lock', !checked),
    updateSpeed: (checked) => setDisabled('.ezroads-road-speed', !checked),
  };
  CHECKBOX_OPTIONS.forEach(({ key, text }) => checkboxContainer.appendChild(createCheckbox(key, text, onChange[key])));

  tabPane.querySelector('.ezroads-reset-button')!.addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all options to default values?')) {
      resetOptions();
      window.location.reload();
    }
  });

  // In case the update check already resolved before this tab was built.
  renderUpdateNotice();
};
