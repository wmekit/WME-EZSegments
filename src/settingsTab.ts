import { log, SCRIPT_VERSION, sdk } from './context';
import { type BooleanOptionKey, options, resetOptions, saveOptions } from './options';
import { roadTypeName, roadTypes, type RoadTypeEntry } from './roadTypes';
import { renderUpdateNotice, UPDATE_NOTICE_ID } from './updateCheck';

const LOCK_LEVELS = [1, 2, 3, 4, 5, 6];

const CHECKBOX_OPTIONS: { key: BooleanOptionKey; text: string; hint: string }[] = [
  { key: 'setStreet', text: 'Set street to none', hint: 'Keeps the city, or borrows one from a connected segment' },
  { key: 'unpaved', text: 'Set as unpaved', hint: 'Ticks the unpaved box on every segment' },
  { key: 'setLock', text: 'Set lock level', hint: 'Uses the lock picked for the road type below' },
  { key: 'updateSpeed', text: 'Set speed limit', hint: 'Uses the speed picked for the road type below' },
  { key: 'applyOnCreate', text: 'Auto-apply to new segments', hint: 'Applies these settings to every road you draw' },
];

// A route icon (lucide "route") for the header badge.
const ROUTE_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>
  </svg>
`;

// The WME Kit (wmekit.com) look, scaled down for the sidebar.
const STYLES = `
  #ezroads-settings {
    --ez-ink: #121212;
    --ez-card: #fff;
    --ez-muted: #3d3d4a;
    --ez-orange: #ff8a4c;
    --ez-yellow: #ffcd1f;
    --ez-red: #ff6b6b;
    --ez-green: #2bc77a;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 4px 12px;
    color: var(--ez-ink);
    font-family: Rubik, system-ui, sans-serif;
    font-size: 13px;
  }
  #ezroads-settings * {
    box-sizing: border-box;
  }
  .ez-card {
    padding: 12px;
    border: 2px solid var(--ez-ink);
    border-radius: 14px;
    background: var(--ez-card);
    box-shadow: 3px 3px 0 var(--ez-ink);
  }
  .ez-card-title {
    margin: 0 0 10px;
    font-size: 14px;
    font-weight: 700;
  }
  .ez-muted {
    color: var(--ez-muted);
  }
  .ez-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px;
    border: 2px solid var(--ez-ink);
    border-radius: 999px;
    background: var(--ez-card);
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  }
  .ez-pill kbd {
    padding: 0 4px;
    border: 1.5px solid var(--ez-ink);
    border-radius: 4px;
    background: var(--ez-yellow);
    font: inherit;
  }

  /* Header */
  .ez-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ez-badge {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: 2px solid var(--ez-ink);
    border-radius: 50%;
    background: var(--ez-orange);
    color: var(--ez-ink);
  }
  .ez-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .ez-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  #${UPDATE_NOTICE_ID} {
    margin-top: 10px;
    padding: 4px 10px;
    border: 2px solid var(--ez-ink);
    border-radius: 999px;
    background: var(--ez-yellow);
    font-size: 12px;
    font-weight: 700;
  }
  #${UPDATE_NOTICE_ID} a {
    color: var(--ez-ink);
    text-decoration: underline;
  }

  /* Toggle switches */
  .ez-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    cursor: pointer;
  }
  .ez-toggle + .ez-toggle {
    border-top: 1px dashed rgb(0 0 0 / 15%);
  }
  .ez-toggle-text {
    flex: 1;
    min-width: 0;
  }
  .ez-toggle-label {
    display: block;
    font-weight: 700;
  }
  .ez-toggle-hint {
    display: block;
    font-size: 11px;
    line-height: 1.3;
  }
  .ez-switch {
    appearance: none;
    position: relative;
    flex: none;
    width: 36px;
    height: 20px;
    margin: 0;
    border: 2px solid var(--ez-ink);
    border-radius: 999px;
    background: #e4e4ea;
    cursor: pointer;
    transition: background 120ms ease;
  }
  .ez-switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border: 2px solid var(--ez-ink);
    border-radius: 50%;
    background: var(--ez-card);
    box-sizing: border-box;
    transition: transform 120ms ease;
  }
  .ez-switch:checked {
    background: var(--ez-green);
  }
  .ez-switch:checked::after {
    transform: translateX(16px);
  }
  .ez-switch:focus-visible {
    outline: 2px solid var(--ez-orange);
    outline-offset: 2px;
  }

  /* Road type rows */
  .ez-road-head,
  .ez-road {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ez-road-head {
    padding: 0 8px 4px 12px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .ez-road-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ez-road {
    min-height: 34px;
    padding: 3px 4px 3px 12px;
    border: 2px solid var(--ez-ink);
    border-radius: 999px;
    background: var(--ez-card);
    cursor: pointer;
    transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
  }
  .ez-road:hover {
    transform: translate(-1px, -1px);
    box-shadow: 4px 4px 0 var(--ez-ink);
  }
  .ez-road:active {
    transform: translate(2px, 2px);
    box-shadow: 1px 1px 0 var(--ez-ink);
  }
  .ez-road:has(input:checked) {
    background: var(--ez-orange);
    box-shadow: 3px 3px 0 var(--ez-ink);
  }
  .ez-road:has(input:focus-visible) {
    outline: 2px solid var(--ez-orange);
    outline-offset: 2px;
  }
  .ez-road input[type='radio'] {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .ez-road-name,
  .ez-col-name {
    flex: 1;
    min-width: 0;
  }
  .ez-road-name {
    overflow: hidden;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ez-col-lock {
    width: 52px;
    text-align: center;
  }
  .ez-col-speed {
    width: 56px;
    text-align: center;
  }
  .ez-road select,
  .ez-road input[type='number'] {
    height: 26px;
    margin: 0;
    padding: 0 6px;
    border: 2px solid var(--ez-ink);
    border-radius: 999px;
    background: var(--ez-card);
    color: var(--ez-ink);
    font: inherit;
    font-weight: 700;
    text-align: center;
    cursor: pointer;
  }
  .ez-road input[type='number'] {
    cursor: text;
    -moz-appearance: textfield;
  }
  .ez-road input[type='number']::-webkit-inner-spin-button,
  .ez-road input[type='number']::-webkit-outer-spin-button {
    margin: 0;
    -webkit-appearance: none;
  }
  .ez-no-lock .ez-col-lock,
  .ez-no-speed .ez-col-speed {
    display: none;
  }

  /* Reset */
  .ez-reset {
    align-self: center;
    padding: 4px 14px;
    border: 2px solid var(--ez-red);
    border-radius: 999px;
    background: transparent;
    color: #d64545;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  .ez-reset:hover {
    background: var(--ez-red);
    color: var(--ez-ink);
  }

  @media (prefers-reduced-motion: reduce) {
    .ez-road,
    .ez-switch,
    .ez-switch::after,
    .ez-reset {
      transition: none;
    }
  }
`;

const TEMPLATE = `
  <div id="ezroads-settings">
    <style>${STYLES}</style>
    <div class="ez-card">
      <div class="ez-header">
        <span class="ez-badge">${ROUTE_ICON}</span>
        <div>
          <h2 class="ez-title">EZ Segments</h2>
          <div class="ez-pills">
            <span class="ez-pill">v${SCRIPT_VERSION}</span>
            <span class="ez-pill">Quick set: <kbd>U</kbd></span>
          </div>
        </div>
      </div>
      <div id="${UPDATE_NOTICE_ID}" style="display: none;"></div>
    </div>
    <div class="ez-card">
      <h3 class="ez-card-title">Options</h3>
      <div data-ezroads="checkboxes"></div>
    </div>
    <div class="ez-card">
      <h3 class="ez-card-title">Road type</h3>
      <div class="ez-road-head ez-muted">
        <span class="ez-col-name">Type</span>
        <span class="ez-col-lock">Lock</span>
        <span class="ez-col-speed">Speed</span>
      </div>
      <div class="ez-road-list" data-ezroads="road-types"></div>
    </div>
    <button type="button" class="ez-reset">Reset all options</button>
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

  // The whole row is the radio's label; clicks on the lock/speed inputs don't select it.
  const row = fromHtml<HTMLElement>(`
    <label class="ez-road" for="${id}">
      <input type="radio" id="${id}" name="ezroads-default-road">
      <span class="ez-road-name"></span>
      <select class="ezroads-road-lock ez-col-lock" title="Lock level">
        ${LOCK_LEVELS.map((level) => `<option value="${level}">L${level}</option>`).join('')}
      </select>
      <input type="number" class="ezroads-road-speed ez-col-speed" min="-1" title="Speed limit">
    </label>
  `);

  const radio = row.querySelector<HTMLInputElement>('input[type="radio"]')!;
  const select = row.querySelector('select')!;
  const speedInput = row.querySelector<HTMLInputElement>('input.ezroads-road-speed')!;

  row.querySelector('.ez-road-name')!.textContent = roadTypeName(roadType);
  radio.checked = options.roadType === roadType.value;
  select.value = String(lock.lock);
  speedInput.value = String(speed.speed);

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

const createCheckbox = (
  key: BooleanOptionKey,
  text: string,
  hint: string,
  onChange?: (checked: boolean) => void,
): HTMLElement => {
  const id = `ezroads-${key}`;
  const row = fromHtml<HTMLElement>(`
    <label class="ez-toggle" for="${id}">
      <span class="ez-toggle-text">
        <span class="ez-toggle-label"></span>
        <span class="ez-toggle-hint ez-muted"></span>
      </span>
      <input type="checkbox" class="ez-switch" id="${id}" role="switch">
    </label>
  `);

  const input = row.querySelector('input')!;
  row.querySelector('.ez-toggle-label')!.textContent = text;
  row.querySelector('.ez-toggle-hint')!.textContent = hint;
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
  const root = tabPane.querySelector<HTMLElement>('#ezroads-settings')!;
  const roadTypeContainer = tabPane.querySelector('[data-ezroads="road-types"]')!;
  const checkboxContainer = tabPane.querySelector('[data-ezroads="checkboxes"]')!;

  roadTypes.forEach((rt) => roadTypeContainer.appendChild(createRoadTypeRow(rt)));

  // The lock/speed columns are only shown while their option is on.
  root.classList.toggle('ez-no-lock', !options.setLock);
  root.classList.toggle('ez-no-speed', !options.updateSpeed);
  const onChange: Partial<Record<BooleanOptionKey, (checked: boolean) => void>> = {
    setLock: (checked) => root.classList.toggle('ez-no-lock', !checked),
    updateSpeed: (checked) => root.classList.toggle('ez-no-speed', !checked),
  };
  CHECKBOX_OPTIONS.forEach(({ key, text, hint }) =>
    checkboxContainer.appendChild(createCheckbox(key, text, hint, onChange[key])),
  );

  tabPane.querySelector('.ez-reset')!.addEventListener('click', () => {
    if (confirm('Are you sure you want to reset all options to default values?')) {
      resetOptions();
      window.location.reload();
    }
  });

  // In case the update check already resolved before this tab was built.
  renderUpdateNotice();
};
