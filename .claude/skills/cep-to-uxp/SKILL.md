---
name: cep-to-uxp
description: >-
  Converts legacy Adobe CEP and CSXS extensions into UXP plugins for Photoshop,
  InDesign, Premiere Pro, and Media Encoder. Handles React, Vue, Svelte, Angular,
  Solid, Lit, Alpine, TypeScript, and vanilla JavaScript. Retarget keeps the
  existing UI in a WebView and moves ExtendScript and Node onto the UXP host.
  Use when the user mentions CEP, CSXS, CSInterface, evalScript, ExtendScript
  panels, manifest.xml, ZXP, bolt-cep, or migrating an Adobe panel to UXP or WebView.
license: MIT
compatibility: Requires Node.js 18 or newer. Uses only the Node standard library.
metadata:
  author: cep-to-uxp
  version: "1.5.0"
---

# CEP to UXP

Convert a CEP extension into a new UXP plugin directory. Do not modify the CEP source. The converter preserves an existing React, Vue, Svelte, Angular, Solid, Lit, TypeScript, or vanilla JavaScript page inside a UXP WebView. It does not execute ExtendScript and it does not compile source files.

The skill root is the directory that contains this `SKILL.md`. Run the tools from that directory, or pass its absolute path. The CEP project is only the `--input` argument. Do not assume the user's project is the working directory.

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

4. Ask two questions before writing files, unless the user already answered them. Also ask which host to ship when the scan lists more than one supported app.

UI:

- Retarget. Recommended when the project has editable source (a `src/` tree, Vue or Svelte files, TypeScript, or plain scripts) as well as a bundle. Keeps that UI in a WebView. You then separate ExtendScript and Node onto the UXP host and rebuild. A painted WebView is not finished.
- Keep the current bundle inside a UXP WebView. Use this when the drop is only a built panel, or as the first scaffold.
- Add a bolt-uxp React, Vue, or Svelte starter, and keep the current panel loadable. This is a new UI beside the port, not a replacement.
- Native UXP HTML only, with no WebView. Only for a small static page the user wants rewritten.

Design, for the UXP shell and any new UI:

- Spectrum. Recommended. Built-in `sp-heading` and `sp-button` widgets match the host. This chrome is the shell around the existing page. Retarget does not redraw the page in Spectrum.
- Preserve the CEP page with no Spectrum chrome.

Then convert:

```bash
node scripts/convert.mjs --input /absolute/path/to/cep-extension --out /absolute/path/to/extension-uxp --force --ui retarget --design spectrum --host premierepro
```

`--ui` is `retarget`, `keep`, `bolt-react`, `bolt-vue`, `bolt-svelte`, or `native`. `--design` is `spectrum` or `preserve`. `--host` is `PS`, `ID`, `premierepro`, or `ame` when you are shipping one app. Exit code 2 means only `MIGRATION.md` was written.

If the scan finds editable source, use `retarget` even when the user first said to keep the bundle. `keep` loads the old snapshot. Buttons that call ExtendScript or Node stay dead until you follow `RETARGET.md`.

5. If the strategy is `blocked`, stop. Explain which hosts cannot be targeted. Do not invent a manifest `app` id.
6. Read `MIGRATION.md`, `host-handlers.js`, and `legacy-extendscript/`. Rewrite every throwing handler before calling the port finished. Return strings to the page. Do not invent Photoshop `batchPlay` descriptors. Premiere calls use `require("premierepro")` after you confirm the current API.
7. Validate, then fix the output until it prints `OK`:

```bash
node scripts/validate-uxp.mjs --input /absolute/path/to/extension-uxp
```

8. Tell the user every **uncovered** line in `MIGRATION.md` before anything else. A valid manifest does not mean those features work.
9. If `RETARGET.md` exists, do that work before calling the port finished. Read the editable source, not the minified bundle. Keep the UI. Move every readable ExtendScript call and every Node call onto the host. Remote `fetch` from `plugin:/` is CORS-blocked; call `cepToUxp.http` so the host fetches it, and put the origin in `network.domains`. A local process or `listen()` is not a reason to stop: keep the tool names, run the ones the host can, and return the old error string for the rest. A cloud model that only returns text is not a substitute. JSXBIN and any call whose body you cannot read stay explicit throws. Do not invent a host DOM for them.
10. A white panel is not finished, even when `validate-uxp.mjs` prints `OK`. Before you tell the user it works, check all of these:

- `vite-cep` and `vite-cep-plugin` need a plain Vite build, not the CEP plugin. Inject `cep-to-uxp-boot.js` and `cep-to-uxp-shim.js` before the module script.
- Strip every `crossorigin` attribute. `plugin:/` does not answer a CORS request, so the script and the CSS never load.
- If the page uses Tailwind, point `css.postcss` at the project's `postcss.config.js`. A CSS file that still contains `@tailwind` or `@apply` was not compiled. The WebView ignores those rules and the page stays white.
- `initBolt` and `initializeCEP` run before React paints. The shim's `invokeSync` and `invokeAsync` return an empty string and must not throw. If the page still throws when they are missing, catch that error. A throw before `createRoot().render()` leaves the app node empty.
- The shell gives the WebView a real height and a dark background after it is moved into the UXP panel root. Do not rely on `height="100%"` alone.
- Point `index.html` at the new hashed bundle and delete the previous hashed files. Then reload the plugin in the UXP Developer Tool. Refreshing the WebView does not reload `host-*.js`.

11. The folder still has to be loaded in the UXP Developer Tool. "The panel opened" is not done. Done means the page is visible, and each source call returns the old string from a handler or is still named as uncovered with the file that calls it.

If you change the converter, run `npm test` from this skill directory and leave it passing.

## Strategy

| Report strategy | What was written |
| --- | --- |
| `webview` | UXP shell plus the CEP page in `<webview src="plugin:/...">`. `CSInterface.js` is the bridge shim. |
| `hybrid` | Same WebView shell, plus a hybrid section. Process, socket, and `.node` calls are not converted. |
| `native` | CEP HTML is the UXP document. No WebView. Leftover `CSInterface` calls throw. |
| `blocked` | Report only. |

`--ui retarget` is a WebView or native scaffold plus `ui-src/` and `RETARGET.md`. It is how a panel with source becomes a working UXP plugin: same UI, host calls on the UXP side. `--ui keep` only copies the current page. `--ui native` is a rewrite into UXP HTML. `--ui bolt-*` adds a new starter beside the loadable port.

React, Vue, Svelte, Angular, Solid, Lit, Alpine, TypeScript, and plain JavaScript stay in the WebView. Recognize source by its files and package, not by one folder name: `src/`, `app/`, `frontend/`, `.vue`, `.svelte`, `.tsx`, `.ts`, and a `package.json` build script. A directory named `build/`, `dist/`, `out/`, or `release/` is a snapshot. When both exist, read the source and rebuild into the WebView. Do not rewrite the page into Spectrum unless the user asks for a native panel. Read [references/decision.md](references/decision.md) before overriding the scanner.

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
