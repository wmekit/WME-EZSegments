import { log, pageWindow, SCRIPT_ID, SCRIPT_NAME, SCRIPT_VERSION, setSdk, sdk } from './context';
import { initAutoApply } from './autoApply';
import { initEditPanel, registerQuickSetShortcut } from './editPanel';
import { loadLocalizedRoadTypeNames } from './roadTypes';
import { constructSettings } from './settingsTab';
import { checkForUpdate } from './updateCheck';

const init = (): void => {
  log('Initing');

  loadLocalizedRoadTypeNames();
  initAutoApply();
  initEditPanel();
  registerQuickSetShortcut();
  constructSettings().catch((e) => log('Could not build settings tab: ' + e));
  checkForUpdate();

  log('Completed Init');
};

const bootstrap = (): void => {
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
