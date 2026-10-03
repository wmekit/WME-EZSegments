// ==UserScript==
// @name            WME EZSegments
// @namespace       https://greasyfork.org/en/scripts/518381-wme-ezsegments
// @version         5.2
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
// @require         https://cdn.jsdelivr.net/gh/wmekit/wmekit-wme-ui@b4137432dc75c7a2b1768d08fcd269b0b1148569/dist/wmekit-wme-ui.min.js
// ==/UserScript==

(function (wmekitWmeUi) {
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
  let latestVersion = null;
  let showNotice = null;
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
  // it just no-ops until the settings tab hands over its notice setter.
  const renderUpdateNotice = () => {
    if (!showNotice || !latestVersion) return;
    showNotice(
      `A new version (v${latestVersion}) is available - <a href="${SCRIPT_PAGE}" target="_blank" rel="noopener">update now</a>`,
    );
  };
  // Called by the settings tab once it's built, with its header's notice setter.
  const bindUpdateNotice = (setNotice) => {
    showNotice = setNotice;
    renderUpdateNotice();
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
  const LOCK_WIDTH = 52;
  const SPEED_WIDTH = 56;
  const CHECKBOX_OPTIONS = [
    { key: 'setStreet', text: 'Set street to none', hint: 'Keeps the city, or borrows one from a connected segment' },
    { key: 'unpaved', text: 'Set as unpaved', hint: 'Ticks the unpaved box on every segment' },
    { key: 'setLock', text: 'Set lock level', hint: 'Uses the lock picked for the road type below' },
    { key: 'updateSpeed', text: 'Set speed limit', hint: 'Uses the speed picked for the road type below' },
    { key: 'applyOnCreate', text: 'Auto-apply to new segments', hint: 'Applies these settings to every road you draw' },
  ];
  // The lock select and speed input shown on each road type row.
  const createRoadTypeExtras = (roadType) => {
    const lock = options.locks.find((l) => l.id === roadType.id);
    const speed = options.speeds.find((s) => s.id === roadType.id);
    const lockSelect = wmekitWmeUi.select({
      options: LOCK_LEVELS.map((level) => ({ label: `L${level}`, value: level })),
      value: lock.lock,
      title: 'Lock level',
      width: LOCK_WIDTH,
      onChange: (value) => {
        lock.lock = parseInt(value, 10);
        saveOptions();
      },
    });
    const speedInput = wmekitWmeUi.numberInput({
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
  const constructSettings = async () => {
    const { tabLabel, tabPane } = await sdk().Sidebar.registerScriptTab();
    tabLabel.innerText = 'EZ Segments';
    tabLabel.title = 'Easily Update Roads';
    const root = wmekitWmeUi.createPane(tabPane, { id: 'ezroads-settings' });
    const head = wmekitWmeUi.header({
      title: 'EZ Segments',
      icon: wmekitWmeUi.ICONS.route,
      pills: [`v${SCRIPT_VERSION}`, { label: 'Quick set:', kbd: 'U' }],
    });
    // The lock/speed columns are only shown while their option is on.
    const columns = wmekitWmeUi.columnHeader([
      'Type',
      { label: 'Lock', width: LOCK_WIDTH },
      { label: 'Speed', width: SPEED_WIDTH },
    ]);
    const lockColumn = [columns.children[1]];
    const speedColumn = [columns.children[2]];
    const showColumn = (column, shown) => column.forEach((cell) => (cell.hidden = !shown));
    const roadTypeList = wmekitWmeUi.radioGroup({
      name: 'ezroads-default-road',
      value: String(options.roadType),
      items: roadTypes.map((rt) => {
        const { lockSelect, speedInput } = createRoadTypeExtras(rt);
        lockColumn.push(lockSelect);
        speedColumn.push(speedInput);
        return { label: roadTypeName(rt), value: String(rt.value), extras: [lockSelect, speedInput] };
      }),
      onChange: (value) => {
        options.roadType = roadTypes.find((rt) => String(rt.value) === value).value;
        saveOptions();
      },
    });
    showColumn(lockColumn, options.setLock);
    showColumn(speedColumn, options.updateSpeed);
    const onToggle = {
      setLock: (checked) => showColumn(lockColumn, checked),
      updateSpeed: (checked) => showColumn(speedColumn, checked),
    };
    const toggles = CHECKBOX_OPTIONS.map(({ key, text, hint }) =>
      wmekitWmeUi.toggle({
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
    const reset = wmekitWmeUi.button({
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
      wmekitWmeUi.card({ title: 'Options', children: toggles }),
      wmekitWmeUi.card({ title: 'Road type', children: [columns, roadTypeList] }),
      reset,
    );
    // Shows the notice now if the update check already resolved, or once it does.
    bindUpdateNotice(head.setNotice);
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
})(WMEKitUI);
