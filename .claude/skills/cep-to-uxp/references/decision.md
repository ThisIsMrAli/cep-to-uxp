# Strategy

`scripts/lib/decide.mjs` chooses the strategy. Read the scan report before overriding it.

Signal counts include a vendored `CSInterface.js` when that library contains `.evalScript(`. Use `evalScripts` for the exact string calls. Do not treat a high count inside the library as dozens of host features.

## Order

1. **blocked** when no declared host is supported. Hybrid or React signals do not unlock Illustrator or After Effects.
2. **hybrid** when the source uses `child_process`, `net`, `dgram`, `cluster`, `worker_threads`, `vm`, `tls`, `cep.process`, or a `.node` addon outside a Node preload. The UI is still a WebView. The converter does not build a native addon. Do not stop the port there. Keep the panel's tool names, replace a spawned helper and `listen()` with the host `http` bridge, and return the old error string for tools the host cannot run. A cloud model that only returns text is not a substitute for those tools.
3. **webview** when the panel has a framework (`react`, `preact`, `vue`, `svelte`, `angular`), a browser UI library (jQuery, MUI, Ant Design, Bootstrap, Three, Pixi, Monaco, CodeMirror, Chart.js, GSAP, styled-components, Emotion), `--enable-nodejs`, `CSInterface`, `evalScript`, `__adobe_cep__`, `cep.fs`, or any other Node builtin.
4. **native** when none of those are present. A static HTML panel can be the UXP document.

`--strategy` can override a supported panel. It cannot override `blocked`.

`--ui retarget` does not change that order. It adds `RETARGET.md` and an `ui-src/` copy so the existing UI can stay in the WebView while ExtendScript and Node move to the host. Use it whenever editable source exists. `--ui keep` is the scaffold alone. `--ui native` is a rewrite the user asked for.

## Source beside a bundle

A folder named `build`, `dist`, `out`, `output`, or `release` is a snapshot. Sibling directories named `src`, `app`, `frontend`, `client`, `jsx`, `extendscript`, or any directory with Vue, Svelte, TSX, JSX, or host calls are the source. Read those files. Do not separate layers by editing the minified bundle. After the boundary edits, run the `package.json` build script from `ui-src/` and copy the new page into `webview/`.

## Why WebView is the default for real panels

UXP's own document is not Chromium. Adobe's guidance is to skip WebView when UXP HTML is enough, because a WebView starts extra processes. An existing CEP page usually needs the browser anyway: the DOM, CSS, and npm UI it already shipped. Keeping that page in `<webview src="plugin:/...">` is the conversion. Rewriting it into Spectrum is a separate product change.

Use `--strategy native` only when the user wants that rewrite. The converter then installs a stub that throws on `new CSInterface()` so a half-ported page fails visibly.

## Warnings that do not change the strategy

- `localStorage` on a `plugin:/` page throws. The boot script can install an in-memory store so the page renders. Those values are not saved.
- `cep.fs` is synchronous. Call UXP file APIs from the host and return the result through the bridge.
- `resizeContent` is ignored. Sizes live in the manifest.
- Vulcan cannot message another host application.
- `cep.process.createProcess('/usr/bin/open')` or `explorer.exe` opens a folder. Replace it with `shell.openPath`. That is not a hybrid plugin.
- `cep.process` with any other program, or with stdin/stdout, is hybrid.
- `localFileSystem: "fullAccess"` is a migration default when the CEP panel read arbitrary paths. Narrow it to `request` if a picker will do.
- URL literals are copied into `webview.domains`. Delete origins that are only opened in the system browser.
