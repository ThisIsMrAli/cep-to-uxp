# Premiere bolt ports

The DOM and CSS crashes below were found in Premiere. Adobe documents the same HTML and CSS gaps for Photoshop. The skill now applies the guards to every host. The shared list is [uxp-document.md](uxp-document.md).

Premiere's UXP document is not the CEP browser. An uncaught exception does not stay in the console. The host clears the panel to gray. These failures showed up one click at a time, mostly from Settings.

The converter copies three files when the host is `premierepro` and `--ui` is `bolt-*`:

| File | Role |
| --- | --- |
| `uxp-compat.js` | First script in `index.html`, before the bundle, on every host |
| `bolt/uxp-tailwind.cjs` | Tailwind plugin for selectors and colors the UXP document can paint |
| `bolt/patch-react-doc.mjs` | Rewrites React's document lookup in the built bundle |

`MIGRATION.md` says to load the parent folder. `bolt/uxp.config.ts` is not the plugin manifest.

## Compat script

Leave `uxp-compat.js` first. It already covers:

- `IntersectionObserver` and `ResizeObserver`. Each instance sets `_observer` to itself. Premiere constructs the real observer, then reads `_observer` on a view that was never set.
- `MutationObserver`, because the host does not have one.
- `NodeFilter` and `Document.prototype.createTreeWalker`. A focus trap needs both. One without the other still crashes.
- `HTMLFormElement`, `HTMLInputElement`, `HTMLSelectElement`, `HTMLTextAreaElement`, `HTMLButtonElement`, and `HTMLIFrameElement`, taken from `document.createElement(...).constructor` when that constructor is real. Radix uses `instanceof HTMLFormElement` before the identifier exists.
- A `checked` or `value` setter only when the host has none.
- `ownerDocument` falling back to `document`, and `defaultView` falling back to `window`.
- Lucide `stroke` and `fill` of `currentColor` rewritten to `#d8d8d8`. Unitless SVG `width` and `height` get a `px` unit. Premiere does not paint `currentColor`, so icon buttons look like empty circles.
- An in-memory `localStorage` when `plugin:/` throws. Values are not copied from the CEP panel. The user enters credentials again.

After the bolt build, run `node bolt/patch-react-doc.mjs <bundle>`. React's helper `nodeType === 9 ? node : node.ownerDocument` then calls `createElement` on `undefined` when a node has no document.

## Chrome and CSS

- Do not emit `<button>` for app chrome. Premiere skins every button and Tailwind loses. Use `<div role="button">`. Radix tabs, selects, and switches still emit buttons. Treat those as unsafe.
- Do not emit Radix Dialog, Popper, tooltip observers, or `react-remove-scroll`. A dialog is an absolute layer inside the panel. Scrim: `position: absolute; top: 0; left: 0; width: 100%; height: 100%` and a translucent background. The card is not full height, or it hides the panel behind it. Do not use `inset` or `bottom` as the only way to fill the panel. The app frame is `position: relative; height: 100%; overflow: hidden`.
- In `tailwind.config.js`, set `important: true` and `plugins: [require("./uxp-tailwind.cjs")]`.
- Premiere ignores `gap`. It does not match selectors Tailwind escapes, so `.mb-1\.5` and `.px-2\.5` never apply. `space-y-*` compiles to `:not([hidden]) ~ :not([hidden])`, which this host mishandles. The plugin writes `[class~="mb-1.5"]` and turns `gap` and `space-y` into child margins in pixels, not `rem`. Integer utilities such as `mt-2` can stay.
- `rgb(var(--token) / alpha)` does not paint. The plugin emits hex rules for the common text, background, and type utilities. `input`, `textarea`, and `select` get `appearance: none`, or the host draws a thick black bar.

## Done

Build the bolt app before calling the port done. A missing import should fail that build, not the first Settings click. `validate-uxp.mjs` printing `OK` does not mean the panel survives a click.
