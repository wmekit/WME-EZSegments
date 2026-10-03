import type { WmeSDK } from 'wme-sdk-typings';

export const SCRIPT_ID = 'wme-ez-segments';
export const SCRIPT_NAME = 'EZ Segments';
export const SCRIPT_VERSION: string = GM_info.script.version;

// The page's own window. With real @grants the userscript manager sandboxes us into an
// isolated `window` that can't see globals WME sets (SDK_INITIALIZED, getWmeSdk), so
// those - and localStorage, to share the page's settings - go through unsafeWindow.
export const pageWindow = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window) as Window & typeof globalThis;

let sdkInstance: WmeSDK | null = null;

export const setSdk = (instance: WmeSDK): void => {
  sdkInstance = instance;
};

// Only called once bootstrap has set it, i.e. from anything running after init().
export const sdk = (): WmeSDK => {
  if (!sdkInstance) throw new Error('WME SDK not initialised yet');
  return sdkInstance;
};

export const log = (message: unknown): void => {
  if (typeof message === 'string') {
    console.log('WME_EZRoads: ' + message);
  } else {
    console.log('WME_EZRoads: ', message);
  }
};
