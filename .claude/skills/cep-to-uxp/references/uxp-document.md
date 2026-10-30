# UXP document limits

Photoshop, InDesign, Premiere Pro, and Media Encoder render a panel with the same UXP document. It is not Chromium and it is not the CEP browser. An uncaught exception can clear the panel instead of staying in the console.

Adobe publishes one known-issues list for that document. The Photoshop page and the Premiere page match on HTML and CSS. InDesign and Media Encoder do not have a separate HTML-limits page. Treat the shared list as applying to all four until a host build proves an item fixed.

Host APIs are not shared. `require("photoshop")`, `require("indesign")`, and `require("premierepro")` are different. None of them can run ExtendScript or JSX. A WebView is still a last resort on every host, because each one starts extra processes.

## Documented for the UXP document

Sources: [Photoshop known issues](https://developer.adobe.com/photoshop/uxp/2022/uxp/known-issues/) and [Premiere known issues](https://developer.adobe.com/premiere-pro/uxp/uxp-api/known-issues). Also [unsupported elements](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-html/general/unsupported-elements) and the [CSS styling recipe](https://developer.adobe.com/uxp/guides/how-to/recipes/css-styling/).

| Limit | What to do |
| --- | --- |
| `text-transform` is unsupported | Set the string in JavaScript, or ship a plain CSS rule the host has been shown to paint. |
| `font` shorthand is unsupported | Set `font-family`, `font-size`, and `font-weight` separately. |
| CSS transitions and animations are unsupported | Do not rely on them for state. |
| CSS grid is unsupported | Use flex. The supported style index also omits `gap`, `inset`, and `transform`. Do not depend on them. |
| `ul`, `ol`, and `li` are not supported | They become plain elements. Number a list in the text if the order matters. `title` can paint inside the panel. Hide it. |
| Global `aria*`, `hidden`, and `contenteditable` are unsupported | Do not use `hidden` to show or hide a control. Use `display`. Attach events with `addEventListener`. |
| Unitless SVG or image `width` and `height` are unsupported | Use `px` or CSS. `uxp-compat.js` appends `px` when `setAttribute` gets a bare number. |
| `select` value must be set with `setAttribute`, not the property | Same for `option`. Spectrum `sp-textfield`, `sp-picker`, and `sp-menu-item` showed the same getter-only `value` in Premiere. |
| `label`, `fieldset`, and `datalist` are unsupported | Unsupported tags become a plain element. |
| Forms do not submit to a URL | Only `method="dialog"`. |
| HTML5 input validation is unsupported | Check values in script. |
| `innerHTML` running scripts is not a contract | Do not inject handlers that way. |
| Drag and drop is unsupported | Keep the control if the CEP panel had it, and return the old error. |
| `localStorage` throws on `plugin:/` | `uxp-compat.js` installs an in-memory store. It does not copy CEP settings. |

`document.theme.getCurrent()` is documented for Premiere. Host CSS variables such as `--uxp-host-text-color` are documented as missing in Premiere. Do not assume either one in Photoshop, InDesign, or Media Encoder without checking that host's page.

## Seen in Premiere, not written up per host

These crashed a real Premiere panel. They are not called out on the known-issues page. The engine is shared, so the skill installs the same guards for every host. If a later host build already has the real API, the guard should leave it alone when the constructor exists. The observer stubs replace the host objects because the real ones crashed.

| What crashed | Guard |
| --- | --- |
| No `MutationObserver` | Stub. Vite `modulePreload` must stay false. |
| `IntersectionObserver` `rootMargin` and `_observer` | Silent observer whose instance sets `_observer`. |
| `ResizeObserver` reading `_observer` | Same stub. |
| `HTMLFormElement is not defined` during `instanceof` | Constructors from `createElement` when that constructor is real. |
| No `createTreeWalker` | `Document.prototype.createTreeWalker`. |
| `NodeFilter is not defined` | `SHOW_ELEMENT` and the filter constants. |
| `ownerDocument` missing, then `createElement` of `undefined` | `uxp-compat.js` plus `patch-react-doc.mjs` after the bundle build. |
| Lucide `currentColor` paints nothing | `setAttribute` rewrites `stroke` and `fill` to `#d8d8d8`. |
| `<button>` gets a host skin and Tailwind loses | Use `<div role="button">` for app chrome. |
| `gap`, escaped `.mb-1\.5`, and `rgb(var(--token) / alpha)` do not paint | `uxp-tailwind.cjs` with `important: true`. |
| Radix Dialog, tooltip, and `react-remove-scroll` | Do not mount them. A dialog is an absolute layer inside the panel. |

There is no public per-app matrix for these rows. Do not invent one. When a panel is loaded in a second host, record which row still crashes and update this file.
