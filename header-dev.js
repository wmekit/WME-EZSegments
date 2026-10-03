// ==UserScript==
// @name            WME EZSegments (dev)
// @namespace       https://greasyfork.org/en/scripts/518381-wme-ezsegments
// @version         5.0
// @description     Local development build - loads the compiled TypeScript straight from .out/main.user.js.
// @author          https://github.com/michaelrosstarr
// @include         /^https:\/\/(www|beta)\.waze\.com\/(?!user\/)(.{2,6}\/)?editor.*$/
// @exclude         https://www.waze.com/user/*editor/*
// @exclude         https://www.waze.com/*/user/*editor/*
// @grant           GM_xmlhttpRequest
// @grant           GM_info
// @grant           unsafeWindow
// @connect         update.greasyfork.org
// @license         GNU GPL(v3)
// @require         https://cdn.jsdelivr.net/gh/wmekit/wmekit-wme-ui@1.0.0/dist/wmekit-wme-ui.min.js
// @require         file:///ABSOLUTE/PATH/TO/WME-EZSegments/.out/main.user.js
// ==/UserScript==

// Local dev header - not published anywhere.
//
// 1. Run `npm run watch` to keep .out/main.user.js up to date.
// 2. Enable "Allow access to file URLs" for Tampermonkey:
//    https://www.tampermonkey.net/faq.php?locale=en#Q204
// 3. Replace the file:/// @require path above with the absolute path to this repo's
//    .out/main.user.js on your machine, then paste this whole file into a new
//    Tampermonkey script (and disable the released one while you do). To try local
//    wmekit-wme-ui changes, point its @require at that repo's dist/wmekit-wme-ui.js
//    the same way.
// 4. Reloading the WME tab picks up the latest compiled output - no reinstall needed.
