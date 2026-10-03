# WME EZSegments

A Tampermonkey userscript that adds quick segment-editing shortcuts (road type, lock, speed, street/city, unpaved) to the Waze Map Editor (WME).

- `src/*.ts` — the TypeScript source (`main.user.ts` is the entry point), bundled by rollup into one IIFE.
- `header.js` — the userscript metadata block (`@version` lives here). `header-dev.js` is the local-dev variant.
- `script.user.js` — **generated** by `npm run build` (header + Prettier-formatted bundle). Committed because Greasyfork syncs from it; never edit it by hand.
- `README.md` — changelog, kept in sync with the `@version` in `header.js`.

Build/check: `npm install`, then `npm run typecheck` and `npm run build`.

## Reference docs

- Official WME SDK reference: https://www.waze.com/editor/sdk/index.html
  - TypeScript typings (full method/type signatures, more reliable than the HTML docs): installed as the `wme-sdk-typings` dev dependency (`node_modules/wme-sdk-typings/index.d.ts`), from https://web-assets.waze.com/wme_sdk_docs/production/latest/wme-sdk-typings.tgz
- wme-sdk-plus (community SDK extension) wiki: https://github.com/TheEditorX/wme-sdk-plus/wiki — not currently used; the script uses the official SDK only.

Prefer the official SDK (`wmeSDK.*`) over DOM scraping/clicking wherever the SDK exposes the capability.

## Conventions

- **Always bump `@version` in `header.js`** whenever you change the script, even for small fixes — no exceptions. Then run `npm run build` so `script.user.js` picks it up, and commit both.
- Add a matching entry to the changelog in `README.md` (newest version on top) describing what changed, using the existing `+`/`~`/`-` diff-style format.
