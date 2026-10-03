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
