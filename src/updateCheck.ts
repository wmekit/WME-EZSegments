import { log, SCRIPT_VERSION } from './context';

const META_URL = 'https://update.greasyfork.org/scripts/518381/WME%20EZSegments.meta.js';
const SCRIPT_PAGE = 'https://greasyfork.org/en/scripts/518381-wme-ezsegments';
let latestVersion: string | null = null;
let showNotice: ((html: string) => void) | null = null;

// Compares dotted version strings (e.g. "3.9" vs "3.10") segment by segment as
// numbers, since a plain string/parseFloat compare gets "3.10" < "3.9" wrong.
export const isNewerVersion = (remote: string, local: string): boolean => {
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
const renderUpdateNotice = (): void => {
  if (!showNotice || !latestVersion) return;
  showNotice(
    `A new version (v${latestVersion}) is available - <a href="${SCRIPT_PAGE}" target="_blank" rel="noopener">update now</a>`,
  );
};

// Called by the settings tab once it's built, with its header's notice setter.
export const bindUpdateNotice = (setNotice: (html: string) => void): void => {
  showNotice = setNotice;
  renderUpdateNotice();
};

// Fetches the Greasyfork update metadata (just the userscript header block) and
// compares its @version against the running one. Uses GM_xmlhttpRequest rather than
// fetch() so it isn't subject to WME's page CSP.
export const checkForUpdate = (): void => {
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
