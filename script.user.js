// ==UserScript==
// @name            WME EZSegments
// @namespace       https://greasyfork.org/en/scripts/518381-wme-ezsegments
// @version         5.0
// @description     Easily update roads
// @author          https://github.com/michaelrosstarr
// @include         /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor.*$/
// @exclude         https://www.waze.com/user/*editor/*
// @exclude         https://www.waze.com/*/user/*editor/*
// @grant           GM_xmlhttpRequest
// @grant           GM_info
// @grant           unsafeWindow
// @connect         update.greasyfork.org
// @icon            https://www.google.com/s2/favicons?sz=64&domain=waze.com
// @license         GNU GPL(v3)
// @downloadURL     https://update.greasyfork.org/scripts/518381/WME%20EZSegments.user.js
// @updateURL       https://update.greasyfork.org/scripts/518381/WME%20EZSegments.meta.js
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_ID = 'wme-ez-segments';
  const SCRIPT_NAME = 'EZ Segments';
  const SCRIPT_VERSION = GM_info.script.version;
  // The page's own window. With real @grants the userscript manager sandboxes us into an
  // isolated `window` that can't see globals WME sets (SDK_INITIALIZED, getWmeSdk), so
  // those - and localStorage, to share the page's settings - go through unsafeWindow.
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  let sdkInstance = null;
  const setSdk = (instance) => {
    sdkInstance = instance;
  };
  // Only called once bootstrap has set it, i.e. from anything running after init().
  const sdk = () => {
    if (!sdkInstance) throw new Error('WME SDK not initialised yet');
    return sdkInstance;
  };
  const log = (message) => {
    if (typeof message === 'string') {
      console.log('WME_EZRoads: ' + message);
    } else {
      console.log('WME_EZRoads: ', message);
    }
  };

  const roadTypes = [
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
  const findRoadType = (value) => roadTypes.find((rt) => rt.value === value);
  const localizedNames = new Map();
  const loadLocalizedRoadTypeNames = () => {
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
  const roadTypeName = (roadType) => localizedNames.get(roadType.value) || roadType.name;

  const newApplyRun = () => ({ emptyStreets: new Map() });
  // Runs one step for a segment in isolation - if it throws (e.g. a transient
  // InvalidStateError on a segment that's still being drawn/connected), the other steps
  // for this segment still get applied instead of being skipped.
  const safelyApply = (id, label, fn) => {
    try {
      fn();
    } catch (e) {
      log(`Failed to apply ${label} to segment ${id}: ${e}`);
    }
  };
  const lockRankFor = (options) => {
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
    return Math.max(0, Math.min(lockSetting.lock - 1, userInfo.rank));
  };
  const speedFor = (options) => {
    if (!options.updateSpeed) return null;
    const road = findRoadType(options.roadType);
    const speedSetting = road && options.speeds.find((s) => s.id === road.id);
    if (!speedSetting || isNaN(speedSetting.speed) || speedSetting.speed < 0) return null;
    return speedSetting.speed;
  };
  // Everything that differs from the segment's current state, as updateSegment args.
  const segmentChanges = (seg, options) => {
    const changes = {};
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
  const applySegmentChanges = (id, changes) => {
    const keys = Object.keys(changes);
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
    const groups = [];
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
  const isRealCity = (city) => !!city && !city.isEmpty;
  // Looks at segments directly connected to this one (both directions) and returns the
  // first real city used by one of their addresses. This is how we pick up the correct
  // suburb/city for a segment that doesn't have one of its own yet - based on the roads
  // it's actually attached to, rather than the map's overall "top city".
  const getNeighboringCity = (segmentId) => {
    const segments = sdk().DataModel.Segments;
    for (const reverseDirection of [false, true]) {
      let connected;
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
  const getEmptyCity = () => {
    const cities = sdk().DataModel.Cities;
    const countryId = sdk().DataModel.Countries.getTopCountry()?.id;
    return cities.getCity({ cityName: '', countryId }) || cities.addCity({ cityName: '', countryId });
  };
  // Finds (or creates) the "empty" street (streetName: '') for a given city, which is how
  // WME represents "no street" for a segment's address.
  const getEmptyStreet = (cityId, run) => {
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
  const applyEmptyStreet = (id, run) => {
    const segments = sdk().DataModel.Segments;
    const ownCity = segments.getAddress({ segmentId: id }).city;
    const topCity = sdk().DataModel.Cities.getTopCity();
    let source;
    let city;
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
  const applySettingsToSegment = (id, options, run) => {
    let seg;
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
  const applyToSelection = (options) => {
    const selection = sdk().Editing.getSelection();
    if (!selection || selection.objectType !== 'segment') return;
    log('Updating selected segments: ' + selection.ids.join(', '));
    const run = newApplyRun();
    for (const id of selection.ids) applySettingsToSegment(id, options, run);
  };

  // Same key as v4.x, so existing users keep their settings.
  const STORAGE_KEY = 'WME_EZRoads_Options';
  const DEFAULT_LOCK = 1;
  const DEFAULT_SPEED = 60;
  const defaultOptions = () => ({
    roadType: 1,
    unpaved: false,
    setStreet: false,
    applyOnCreate: false,
    setLock: false,
    updateSpeed: false,
    locks: roadTypes.map((rt) => ({ id: rt.id, lock: DEFAULT_LOCK })),
    speeds: roadTypes.map((rt) => ({ id: rt.id, speed: DEFAULT_SPEED })),
  });
  const toInt = (value, fallback) => {
    const n = parseInt(String(value), 10);
    return isNaN(n) ? fallback : n;
  };
  // Merges saved options over the defaults, and makes sure there's exactly one lock and
  // speed entry per road type (older saves may be missing some, or store speeds as strings).
  const load = () => {
    const defaults = defaultOptions();
    let saved = {};
    try {
      saved = JSON.parse(pageWindow.localStorage.getItem(STORAGE_KEY) || '{}') || {};
    } catch (e) {
      log('Could not parse saved options, using defaults: ' + e);
    }
    const merged = { ...defaults, ...saved };
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
  const options = load();
  const saveOptions = () => {
    pageWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  };
  const resetOptions = () => {
    pageWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultOptions()));
  };

  // Segment ids we've already auto-applied settings to, so re-selecting the same
  // still-unsaved segment doesn't run the whole thing again. Cleared after a successful
  // save, by which point those ids are no longer "new" anyway.
  const autoAppliedSegmentIds = new Set();
  const isFreshlyDrawn = (id) => {
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
        log(
          `Segment ${id} is new but already has an address - likely a split remnant of an existing road, skipping auto-apply`,
        );
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
  const maybeAutoApplyOnCreate = () => {
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
  const initAutoApply = () => {
    sdk().Events.on({
      eventName: 'wme-save-finished',
      eventHandler: ({ success }) => {
        if (success) autoAppliedSegmentIds.clear();
      },
    });
  };

  const BUTTON_ATTR = 'data-ez-road-button';
  const MAX_FRAMES = 30;
  const quickSet = () => applyToSelection(options);
  // The SDK has no API for adding to the segment edit panel, so the button is still
  // inserted into its DOM. The SDK event fires as the editor opens, which can be a frame
  // or two before WME has rendered #segment-edit-general, so retry briefly.
  const insertQuickSetButton = (frame = 0) => {
    const general = document.getElementById('segment-edit-general');
    if (!general?.parentNode) {
      if (frame < MAX_FRAMES) requestAnimationFrame(() => insertQuickSetButton(frame + 1));
      return;
    }
    const parent = general.parentNode;
    if (parent.querySelector(`[${BUTTON_ATTR}]`)) return;
    const button = document.createElement('wz-button');
    button.setAttribute('type', 'button');
    button.setAttribute('style', 'margin-bottom: 5px; width: 100%');
    button.setAttribute(BUTTON_ATTR, 'true');
    button.classList.add('send-button', 'ez-comment-button');
    button.textContent = 'Quick Set Road';
    button.addEventListener('mousedown', quickSet);
    parent.insertBefore(button, general);
  };
  const isSegmentSelected = () => sdk().Editing.getSelection()?.objectType === 'segment';
  const onSegmentEditorShown = () => {
    maybeAutoApplyOnCreate();
    insertQuickSetButton();
  };
  const initEditPanel = () => {
    sdk().Events.on({
      eventName: 'wme-feature-editor-opened',
      eventHandler: ({ featureType }) => {
        if (featureType === 'segment') onSegmentEditorShown();
      },
    });
    // Switching from one segment to another can re-render the panel without reopening it.
    sdk().Events.on({
      eventName: 'wme-selection-changed',
      eventHandler: () => {
        if (isSegmentSelected()) onSegmentEditorShown();
      },
    });
    // In case a segment is already selected when the script starts.
    if (isSegmentSelected()) onSegmentEditorShown();
  };
  const SHORTCUT_KEYS = 'U';
  // Registers "U" as a native WME shortcut, so it shows up in the editor's shortcut list
  // and WME itself takes care of ignoring the key while the user is typing in a field.
  // Falls back to a manual keydown listener if the SDK can't register it.
  const registerQuickSetShortcut = () => {
    const shortcuts = sdk().Shortcuts;
    try {
      if (shortcuts.areShortcutKeysInUse({ shortcutKeys: SHORTCUT_KEYS })) {
        throw new Error(`"${SHORTCUT_KEYS}" is already in use`);
      }
      shortcuts.createShortcut({
        shortcutId: 'wme-ezsegments-quick-set',
        description: 'EZ Segments: Quick Set Road',
        shortcutKeys: SHORTCUT_KEYS,
        callback: quickSet,
      });
      log(`Registered "${SHORTCUT_KEYS}" shortcut via SDK`);
    } catch (e) {
      log('Could not register SDK shortcut, falling back to manual keydown listener: ' + e);
      document.addEventListener('keydown', (event) => {
        const active = document.activeElement;
        const typing =
          !!active &&
          (['INPUT', 'TEXTAREA', 'WZ-AUTOCOMPLETE', 'WZ-TEXTAREA'].includes(active.tagName) ||
            active.isContentEditable);
        if (!typing && event.key.toLowerCase() === 'u') quickSet();
      });
    }
  };

  const META_URL = 'https://update.greasyfork.org/scripts/518381/WME%20EZSegments.meta.js';
  const SCRIPT_PAGE = 'https://greasyfork.org/en/scripts/518381-wme-ezsegments';
  const UPDATE_NOTICE_ID = 'ezroads-update-notice';
  let latestVersion = null;
  // Compares dotted version strings (e.g. "3.9" vs "3.10") segment by segment as
  // numbers, since a plain string/parseFloat compare gets "3.10" < "3.9" wrong.
  const isNewerVersion = (remote, local) => {
    const r = remote.split('.').map(Number);
    const l = local.split('.').map(Number);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      const rv = r[i] || 0;
      const lv = l[i] || 0;
      if (rv !== lv) return rv > lv;
    }
    return false;
  };
  // Puts an "update available" notice in the settings tab, if it's been rendered yet.
  // Safe to call before the tab exists (e.g. from the update check resolving early) -
  // it just no-ops until the settings tab calls it again once it's built.
  const renderUpdateNotice = () => {
    const el = document.getElementById(UPDATE_NOTICE_ID);
    if (!el || !latestVersion) return;
    el.style.display = 'block';
    el.innerHTML = `A new version (v${latestVersion}) is available - <a href="${SCRIPT_PAGE}" target="_blank" rel="noopener">update now</a>`;
  };
  // Fetches the Greasyfork update metadata (just the userscript header block) and
  // compares its @version against the running one. Uses GM_xmlhttpRequest rather than
  // fetch() so it isn't subject to WME's page CSP.
  const checkForUpdate = () => {
    if (typeof GM_xmlhttpRequest !== 'function') {
      log('GM_xmlhttpRequest unavailable, skipping update check');
      return;
    }
    GM_xmlhttpRequest({
      method: 'GET',
      url: META_URL,
      onload: (response) => {
        const match = response.responseText.match(/@version\s+([\d.]+)/);
        if (!match) {
          log('Update check: no @version found in Greasyfork metadata');
          return;
        }
        if (isNewerVersion(match[1], SCRIPT_VERSION)) {
          latestVersion = match[1];
          log(`New version available: ${latestVersion} (current: ${SCRIPT_VERSION})`);
          renderUpdateNotice();
        } else {
          log(`Update check: up to date (v${SCRIPT_VERSION}, Greasyfork has v${match[1]})`);
        }
      },
      onerror: (e) => log('Update check failed: ' + (e.error || e.status)),
    });
  };

  const LOCK_LEVELS = [1, 2, 3, 4, 5, 6];
  const CHECKBOX_OPTIONS = [
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
  const fromHtml = (html) => {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  };
  const createRoadTypeRow = (roadType) => {
    const id = `ezroads-road-${roadType.id}`;
    const lock = options.locks.find((l) => l.id === roadType.id);
    const speed = options.speeds.find((s) => s.id === roadType.id);
    const row = fromHtml(`
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
    const radio = row.querySelector('input[type="radio"]');
    const label = row.querySelector('label');
    const select = row.querySelector('select');
    const speedInput = row.querySelector('input.ezroads-road-speed');
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
  const createCheckbox = (key, text, onChange) => {
    const id = `ezroads-${key}`;
    const row = fromHtml(`
    <div class="ezroads-option">
      <input type="checkbox" id="${id}">
      <label for="${id}"></label>
    </div>
  `);
    const input = row.querySelector('input');
    row.querySelector('label').textContent = text;
    input.checked = options[key];
    input.addEventListener('change', () => {
      options[key] = input.checked;
      saveOptions();
      onChange?.(input.checked);
    });
    return row;
  };
  const constructSettings = async () => {
    const { tabLabel, tabPane } = await sdk().Sidebar.registerScriptTab();
    tabLabel.innerText = 'EZ Segments';
    tabLabel.title = 'Easily Update Roads';
    tabPane.innerHTML = TEMPLATE;
    const roadTypeContainer = tabPane.querySelector('[data-ezroads="road-types"]');
    const checkboxContainer = tabPane.querySelector('[data-ezroads="checkboxes"]');
    roadTypes.forEach((rt) => roadTypeContainer.appendChild(createRoadTypeRow(rt)));
    // Lock/speed inputs are only editable while their option is on.
    const setDisabled = (selector, disabled) => {
      tabPane.querySelectorAll(selector).forEach((el) => (el.disabled = disabled));
    };
    const onChange = {
      setLock: (checked) => setDisabled('.ezroads-road-lock', !checked),
      updateSpeed: (checked) => setDisabled('.ezroads-road-speed', !checked),
    };
    CHECKBOX_OPTIONS.forEach(({ key, text }) =>
      checkboxContainer.appendChild(createCheckbox(key, text, onChange[key])),
    );
    tabPane.querySelector('.ezroads-reset-button').addEventListener('click', () => {
      if (confirm('Are you sure you want to reset all options to default values?')) {
        resetOptions();
        window.location.reload();
      }
    });
    // In case the update check already resolved before this tab was built.
    renderUpdateNotice();
  };

  const init = () => {
    log('Initing');
    loadLocalizedRoadTypeNames();
    initAutoApply();
    initEditPanel();
    registerQuickSetShortcut();
    constructSettings().catch((e) => log('Could not build settings tab: ' + e));
    checkForUpdate();
    log('Completed Init');
  };
  const bootstrap = () => {
    // WME defines SDK_INITIALIZED during its own startup, which may not have happened yet.
    if (!pageWindow.SDK_INITIALIZED) {
      setTimeout(bootstrap, 250);
      return;
    }
    pageWindow.SDK_INITIALIZED.then(() => {
      if (!pageWindow.getWmeSdk) {
        log('getWmeSdk is missing even though SDK_INITIALIZED resolved');
        return;
      }
      setSdk(pageWindow.getWmeSdk({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME, version: SCRIPT_VERSION }));
      // wme-ready = initialised, logged in, and initial map data loaded.
      if (sdk().State.isReady()) {
        init();
      } else {
        sdk().Events.once({ eventName: 'wme-ready' }).then(init);
      }
    });
  };
  bootstrap();
})();
