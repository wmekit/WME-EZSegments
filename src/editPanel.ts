import { applyToSelection } from './apply';
import { maybeAutoApplyOnCreate } from './autoApply';
import { log, sdk } from './context';
import { options } from './options';

const BUTTON_ATTR = 'data-ez-road-button';
const MAX_FRAMES = 30;

const quickSet = (): void => applyToSelection(options);

// The SDK has no API for adding to the segment edit panel, so the button is still
// inserted into its DOM. The SDK event fires as the editor opens, which can be a frame
// or two before WME has rendered #segment-edit-general, so retry briefly.
const insertQuickSetButton = (frame = 0): void => {
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

const isSegmentSelected = (): boolean => sdk().Editing.getSelection()?.objectType === 'segment';

const onSegmentEditorShown = (): void => {
  maybeAutoApplyOnCreate();
  insertQuickSetButton();
};

export const initEditPanel = (): void => {
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
export const registerQuickSetShortcut = (): void => {
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
      const active = document.activeElement as HTMLElement | null;
      const typing =
        !!active &&
        (['INPUT', 'TEXTAREA', 'WZ-AUTOCOMPLETE', 'WZ-TEXTAREA'].includes(active.tagName) || active.isContentEditable);
      if (!typing && event.key.toLowerCase() === 'u') quickSet();
    });
  }
};
