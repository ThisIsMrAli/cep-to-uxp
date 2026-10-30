---
name: cep-to-uxp
description: >-
  Converts legacy Adobe CEP and CSXS extensions into UXP plugins for Photoshop,
  InDesign, Premiere Pro, and Media Encoder. Handles React, Vue, Svelte, Angular,
  Solid, Lit, Alpine, TypeScript, and vanilla JavaScript. Always ask the user
  which UI path to take. Prefer native UXP HTML or a bolt Spectrum starter.
  WebView is last resort. Use when the user mentions CEP, CSXS, CSInterface,
  evalScript, ExtendScript panels, manifest.xml, ZXP, bolt-cep, or migrating an
  Adobe panel to UXP.
license: MIT
compatibility: Requires Node.js 18 or newer. Uses only the Node standard library.
metadata:
  author: cep-to-uxp
  version: "1.7.0"
---

# CEP to UXP

Convert a CEP extension into a new UXP plugin directory. Do not modify the CEP source. The converter does not execute ExtendScript and it does not compile source files.

The skill root is the directory that contains this `SKILL.md`. Run the tools from that directory, or pass its absolute path. The CEP project is only the `--input` argument. Do not assume the user's project is the working directory.

## Do not auto-choose

Never pick `--ui`, `--design`, or `--host` on your own. Never infer them from a previous message, a scan strategy, or "the usual default."

Scan first. Then stop and ask. Convert only after the user answers. If they change their mind later, follow the new answer. Do not override it.

`scan-cep.mjs` prints `suggestedUi`. That is a recommendation to show the user, not a mode you may apply without asking.

## Workflow

1. Confirm the input contains `CSXS/manifest.xml`. If the parent repository has more than one, ask which extension to convert. Do not merge a sibling panel into this plugin. If it is already a UXP plugin (`manifest.json` with `manifestVersion`), stop. A folder named `cep` inside `dist/`, `build/`, `out/`, `output/`, or `release/` is still a built snapshot. Read `src/` next to that ancestor, not the minified bundle.
2. Refresh Adobe's current UXP docs. This is required on every conversion so the skill does not depend on a frozen snapshot:

```bash
node scripts/refresh-docs.mjs
```

Read `references/live/summary.json`. If the command fails, say the refresh failed and use [references/hosts.md](references/hosts.md). If `appsMissingFromSkill` is not empty, stop and tell the user. Do not invent a manifest app id from the page text.

3. Scan:

```bash
node scripts/scan-cep.mjs --input /absolute/path/to/cep-extension
```

4. Ask these questions and wait. Do not write files until they are answered. Also ask which host to ship when the scan lists more than one supported app.

UI, in this order. Recommend the first matching pure-UXP option. WebView comes last.

Pure UXP (suggested):

- Native UXP HTML, with no WebView (`--ui native`). Suggested for a small static page or vanilla HTML/JS that can be rewritten as the UXP document.
- bolt-uxp React (`--ui bolt-react`). Suggested when the CEP UI is React, Preact, Angular, Solid, Lit, or another component stack without a Vue/Svelte match.
- bolt-uxp Vue (`--ui bolt-vue`). Suggested when the CEP UI is Vue or Nuxt.
- bolt-uxp Svelte (`--ui bolt-svelte`). Suggested when the CEP UI is Svelte.

WebView (last resort, only if the user wants to keep the old page):

- Retarget (`--ui retarget`). Keep the existing UI in a WebView, copy source to `ui-src/`, and move ExtendScript and Node onto the UXP host.
- Keep the current bundle (`--ui keep`). Built snapshot only, or a temporary scaffold. Buttons that still call CEP or Node stay dead.

Do not recommend WebView first. Adobe's guidance is to skip WebView when UXP HTML or a Spectrum rebuild is enough. A WebView starts extra processes.

Design, for the UXP shell and any new UI:

- Spectrum. Recommended for the shell and for bolt starters. Built-in `sp-heading` and `sp-button` widgets match the host.
- Preserve. No Spectrum chrome.

Then convert with the user's answers. Example after they chose bolt-react, Spectrum, and Photoshop:

```bash
node scripts/convert.mjs --input /absolute/path/to/cep-extension --out /absolute/path/to/extension-uxp --force --ui bolt-react --design spectrum --host PS
```

`--ui` is required. It is `native`, `bolt-react`, `bolt-vue`, `bolt-svelte`, `retarget`, or `keep`. `--design` is `spectrum` or `preserve`. `--host` is `PS`, `ID`, `premierepro`, or `ame` when you are shipping one app. Exit code 2 means only `MIGRATION.md` was written.

Do not switch `bolt-*` or `native` to `retarget` because source exists. Do not switch `keep` to `retarget` unless the user asked for a WebView. Follow the choice they just gave.

5. If the strategy is `blocked`, stop. Explain which hosts cannot be targeted. Do not invent a manifest `app` id.
6. Read `MIGRATION.md`, `host-handlers.js`, and `legacy-extendscript/`. Rewrite every throwing handler before calling the port finished. Return strings to the page. Do not invent Photoshop `batchPlay` descriptors. Premiere calls use `require("premierepro")` after you confirm the current API.
7. Validate, then fix the output until it prints `OK`:

```bash
node scripts/validate-uxp.mjs --input /absolute/path/to/extension-uxp
```

8. Tell the user every **uncovered** line in `MIGRATION.md` before anything else. A valid manifest does not mean those features work.
9. If the user chose `native` or `bolt-*`, clone the CEP UI. This is a pure UXP port, not a new smaller panel.

- Read `bolt/PORT.md` and the screens in `bolt/cep-src/` (or the CEP `src/` next to a built snapshot). Port every visible region: header actions, credits, history, menus, suggestion cards, chips, composer, attachments, and empty-state copy.
- Keep the same labels and prompts. Do not rewrite an edit command into "describe the edit."
- Spectrum is the widget set when a control is rewritten. It is not permission to delete a control.
- If the handler cannot perform the action (`evalScript`, JSX, `child_process`, `listen()`), the control stays and the click returns the old error string.
- Do not ship the bolt starter paragraph as the product. Do not design the page around only the host reads you have implemented.
- The converter does not write a `webview/` folder for this path. Do not add one. Do not put `<webview>` in `index.html`, even commented out. Do not point manifest icons at `webview/`.
- A hybrid scan is not a reason to keep the old page as the panel. Node that only loads when `window.cep` exists does not make the product a WebView.
- A name that appears only in a comment, such as `evalTS("myFunc")` in a bolt example, is not a feature. List the real host functions you can read.
- Premiere has no `MutationObserver`. Keep `build.modulePreload: false` and an iife bundle. Vite's modulepreload polyfill throws `MutationObserver is not defined` and the panel never paints.
- Do not pass `value` as a React prop on `sp-textfield`, `sp-picker`, or `sp-menu-item`. In Premiere those properties are getter-only and React throws `Cannot set property value`. Set `value` and `selected` with `setAttribute`.
10. If `RETARGET.md` exists, the user chose a WebView path. Do that work before calling the port finished. Read the editable source, not the minified bundle. Keep the UI. Move every readable ExtendScript call and every Node call onto the host. Remote `fetch` from `plugin:/` is CORS-blocked; call `cepToUxp.http` so the host fetches it, and put the origin in `network.domains`. A local process or `listen()` is not a reason to stop: keep the tool names, run the ones the host can, and return the old error string for the rest. A cloud model that only returns text is not a substitute. JSXBIN and any call whose body you cannot read stay explicit throws. Do not invent a host DOM for them.
11. A white panel is not finished, even when `validate-uxp.mjs` prints `OK`. Before you tell the user it works, check all of these when a WebView is in use:

- `vite-cep` and `vite-cep-plugin` need a plain Vite build, not the CEP plugin. Inject `cep-to-uxp-boot.js` and `cep-to-uxp-shim.js` before the module script.
- Strip every `crossorigin` attribute. `plugin:/` does not answer a CORS request, so the script and the CSS never load.
- If the page uses Tailwind, point `css.postcss` at the project's `postcss.config.js`. A CSS file that still contains `@tailwind` or `@apply` was not compiled. The WebView ignores those rules and the page stays white.
- `initBolt` and `initializeCEP` run before React paints. The shim's `invokeSync` and `invokeAsync` return an empty string and must not throw. If the page still throws when they are missing, catch that error. A throw before `createRoot().render()` leaves the app node empty.
- The shell gives the WebView a real height and a dark background after it is moved into the UXP panel root. Do not rely on `height="100%"` alone.
- Point `index.html` at the new hashed bundle and delete the previous hashed files. Then reload the plugin in the UXP Developer Tool. Refreshing the WebView does not reload `host-*.js`.

12. Check the UI before you call it done. A painted panel can still be the wrong screen.

Words:

```bash
node scripts/inventory-ui.mjs --cep /absolute/path/to/cep-src --uxp /absolute/path/to/extension-uxp/bolt/src
```

For a WebView port, point `--uxp` at `webview/` or `ui-src/`. Exit 1 means a visible CEP label is missing. Put it back, or name it in `MIGRATION.md` with the file that showed it. Do not drop it because the handler cannot run.

Layout: the inventory does not see spacing, cards, or a missing column. Premiere cannot be opened from this skill. After the labels match, look at the page. Build the panel and open that HTML in a browser when it does not require `require("uxp")` at import time. Otherwise ask the user for a screenshot of the UXP panel next to the CEP panel. Compare header, suggestion cards, chips, and the composer. Do not say the UI matches until that picture does.

13. The folder still has to be loaded in the UXP Developer Tool. "The panel opened" is not done. Done means the page is visible, the inventory has no unexplained missing labels, the screenshot matches the CEP layout, and each source call returns the old string from a handler or is still named as uncovered with the file that calls it.

If you change the converter, run `npm test` from this skill directory and leave it passing.

## Strategy

The scanner reports how the CEP page is built. That report is not a UI choice. You still ask.

| Report strategy | What it means |
| --- | --- |
| `webview` | The CEP page needs a browser. If the user still chose native or bolt, recreate the UI in UXP. If they chose WebView, the shell hosts `<webview src="plugin:/...">`. |
| `hybrid` | Same UI question, plus process, socket, or `.node` calls that are not converted. |
| `native` | No framework, Node, or CEP bridge was found, so HTML can be the UXP document. Still ask. |
| `blocked` | Report only. |

`--ui native` writes UXP HTML and no WebView. `--ui bolt-*` writes a pure UXP document plus `bolt/cep-src/` to clone. It does not write a `webview/` folder. `--ui retarget` is a WebView plus `ui-src/` and `RETARGET.md`. `--ui keep` only copies the current page.

Recognize source by its files and package, not by one folder name: `src/`, `app/`, `frontend/`, `.vue`, `.svelte`, `.tsx`, `.ts`, and a `package.json` build script. A directory named `build/`, `dist/`, `out/`, or `release/` is a snapshot. When both exist, read the source. Read [references/decision.md](references/decision.md) before overriding the scanner.

## After the scaffold

- Exact `evalScript("...")` calls become keys in `host-handlers.js`. Dynamic calls are listed in `MIGRATION.md` and hit the default throw.
- Photoshop document changes go inside `require("photoshop").core.executeAsModal`. `batchPlay` is Photoshop-only.
- Confirm `require("indesign")` and `require("premierepro")` in the current host docs before using them.
- A packaged `.ccx` needs one host object. An array is only for the UXP Developer Tool.
- Narrow `webview.domains`, `network.domains`, and `localFileSystem: "fullAccess"` to what the panel actually uses.

## Hard limits

- UXP cannot run JSX or `evalScript`. The shim only transports the script string.
- Do not polyfill synchronous `cep.fs` or `cep.process` as working file or process APIs. A page that reads `window.path` or `window.fs` during the first mount gets a render guard only: `path.join`, `basename`, `extname`, and `dirname`, plus an `fs` object whose methods throw inside the caller's `try`. That guard is not a filesystem and it does not implement the packages in a Node preload.
- `plugin:/` pages throw on `localStorage`. When access throws, the boot script installs an in-memory `localStorage` so the bundle can render. Those values are not saved.
- `shell.openPath` and `shell.openExternal` cannot take arguments or capture output.
- WebView subresources use relative paths. Do not point CSS or JS at `plugin:/`.
- Do not allow a wildcard in a top-level domain (`https://www.*`, `https://adobe.*`). `https://*.adobe.com` is valid. Avoid `"all"` unless origins are dynamic.
- Illustrator and After Effects stay blocked until [references/hosts.md](references/hosts.md) is updated with a documented app id.

## Read next

| Need | File |
| --- | --- |
| Current UXP docs | Run `scripts/refresh-docs.mjs`, then read `references/live/summary.json` |
| Spectrum UI | [references/spectrum.md](references/spectrum.md) |
| Hosts and plugin types | [references/apps.md](references/apps.md) |
| React, Vue, or another UI stack | [references/stacks.md](references/stacks.md) |
| Host ids, versions, and what is blocked | [references/hosts.md](references/hosts.md) |
| Why a strategy was chosen | [references/decision.md](references/decision.md) |
| CEP API replacements | [references/api-map.md](references/api-map.md) |
| WebView bridge and permissions | [references/webview-bridge.md](references/webview-bridge.md) |
| Manifest fields the converter writes | [references/manifest.md](references/manifest.md) |
| React or a bundler | [references/react.md](references/react.md) |
| Rewriting JSX and handlers | [references/extendscript.md](references/extendscript.md) |
| Validator and the manual host check | [references/validation.md](references/validation.md) |
