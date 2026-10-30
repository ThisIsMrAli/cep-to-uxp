# Strategy

`scripts/lib/decide.mjs` chooses the **scan strategy**. That is an inventory of how the CEP page is built. It is not a UI mode. The agent must still ask the user which `--ui` to use, then pass that choice. `suggestUi(scan)` is only a recommendation to show while asking.

Signal counts include a vendored `CSInterface.js` when that library contains `.evalScript(`. Use `evalScripts` for the exact string calls. Do not treat a high count inside the library as dozens of host features.

## Ask, then convert

Never apply `suggestedUi`, `retarget`, `keep`, `native`, or a bolt starter without a user answer.

Suggested order when asking:

1. **native** — small static or vanilla HTML that can become the UXP document. No WebView.
2. **bolt-vue** / **bolt-svelte** / **bolt-react** — recreate the UI as Spectrum UXP. Match Vue or Svelte when the CEP stack is Vue or Svelte; otherwise bolt-react.
3. **retarget** — last resort. Keep the existing UI in a WebView and move host calls out of the page.
4. **keep** — last resort scaffold for a built snapshot only.

Adobe's guidance is to skip WebView when UXP HTML or a Spectrum rebuild is enough. A WebView starts extra processes.

## Scan order

1. **blocked** when no declared host is supported. Hybrid or React signals do not unlock Illustrator or After Effects.
2. **hybrid** when the source uses `child_process`, `net`, `dgram`, `cluster`, `worker_threads`, `vm`, `tls`, `cep.process`, or a `.node` addon outside a Node preload. The converter does not build a native addon. Do not stop the port there. Keep the panel's tool names, replace a spawned helper and `listen()` with the host `http` bridge, and return the old error string for tools the host cannot run. A cloud model that only returns text is not a substitute for those tools.
3. **webview** when the panel has a framework (`react`, `preact`, `vue`, `svelte`, `angular`), a browser UI library (jQuery, MUI, Ant Design, Bootstrap, Three, Pixi, Monaco, CodeMirror, Chart.js, GSAP, styled-components, Emotion), `--enable-nodejs`, `CSInterface`, `evalScript`, `__adobe_cep__`, `cep.fs`, or any other Node builtin. This means the *old page* needs a browser. It does not mean the agent should choose `--ui retarget`.
4. **native** when none of those are present. A static HTML panel can be the UXP document.

`--strategy` can override a supported panel. It cannot override `blocked`.

`--ui native` writes UXP HTML with no WebView. `--ui bolt-*` writes a Spectrum starter in `bolt/` and may still copy the old page as a fallback. `--ui retarget` adds `RETARGET.md` and `ui-src/` so the existing UI can stay in a WebView. `--ui keep` is the scaffold alone. Do not change the user's `--ui` because source exists.

## Source beside a bundle

A folder named `build`, `dist`, `out`, `output`, or `release` is a snapshot. Sibling directories named `src`, `app`, `frontend`, `client`, `jsx`, `extendscript`, or any directory with Vue, Svelte, TSX, JSX, or host calls are the source. Read those files. Do not separate layers by editing the minified bundle. After a WebView retarget, run the `package.json` build script from `ui-src/` and copy the new page into `webview/`. After a bolt choice, rebuild in `bolt/`.

## Warnings that do not change the strategy

- `localStorage` on a `plugin:/` page throws. The boot script can install an in-memory store so the page renders. Those values are not saved.
- `cep.fs` is synchronous. Call UXP file APIs from the host and return the result through the bridge.
- `resizeContent` is ignored. Sizes live in the manifest.
- Vulcan cannot message another host application.
- `cep.process.createProcess('/usr/bin/open')` or `explorer.exe` opens a folder. Replace it with `shell.openPath`. That is not a hybrid plugin.
- `cep.process` with any other program, or with stdin/stdout, is hybrid.
- `localFileSystem: "fullAccess"` is a migration default when the CEP panel read arbitrary paths. Narrow it to `request` if a picker will do.
- URL literals are copied into `webview.domains`. Delete origins that are only opened in the system browser.
