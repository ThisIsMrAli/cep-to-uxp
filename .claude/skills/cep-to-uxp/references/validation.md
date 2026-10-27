# Validation

From the skill directory:

```bash
node scripts/validate-uxp.mjs --input /absolute/path/to/extension-uxp
```

Exit 0 prints `OK`. Structural problems go to stderr and exit 1.

The validator checks:

- `manifest.json` is version 5, with `id`, `name`, `x.y.z` version, an existing `main`, and a supported host.
- Every panel id is unique and has `label.default`.
- `entrypoints.setup` mentions each panel id.
- WebView builds request `allowLocalRendering: "yes"` and `localOnly` or `localAndRemote`.
- Every `plugin:/webview/...` target exists on disk.
- The shim posts through `window.uxpHost`.
- Each exact `evalScript` string is a handler key and is listed in `MIGRATION.md`.
- Hybrid reports contain the hybrid section.
- Native builds do not request WebView permission and do not contain the WebView shim.
- `node_modules`, `.env`, and `CSXS/` were not copied.
- Domain strings do not put a wildcard in the top-level domain.
- Generated plugin scripts pass `node --check`.

`OK` means the folder is a coherent plugin. It does not mean the handlers implement the old JSX. When `RETARGET.md` is present, the port is unfinished until each source call is a host handler or still listed as uncovered.

## Manual check

Load the output folder with the UXP Developer Tool in the target host:

1. The panel opens and shows the old page, not a blank shell.
2. A control that called `evalScript` either returns the rewritten string or shows the explicit missing-handler error.
3. Buttons that open a URL raise the host consent dialog.
4. File access uses the permission you declared. `fullAccess` still fails on OS-protected folders.
5. Reloading the panel does not reset WebView state unexpectedly. `show()` must not assign `src` again; `mount` sets it once.
6. Package a `.ccx` only after `host` is a single object.

A white panel means the shell loaded and the page did not paint. `OK` does not check this. With Spectrum, a visible `sp-heading` and an empty page means the page crashed. Those errors are in the WebView inspector, not the UXP Developer Tool log. React deletes the app node when startup throws, including a throw from `initBolt` or `initializeCEP` before `createRoot().render()`.

`--design preserve` has no heading, so a white panel is the host background. The same blank page can be uncompiled `@tailwind` or `@apply` CSS, a `crossorigin` module script or stylesheet on `plugin:/`, or a WebView that was moved onto a panel root with no height. A `height="100%"` attribute is not enough after that move. Reloading the WebView does not reload `host-bridge.js`. Reload the plugin in the UXP Developer Tool.

If the WebView stays blank, confirm UXP 8 or newer, `allowLocalRendering`, and that subresources are relative. If the host rejects `ame`, try `mediaencoder` and record that in the migration notes.

The regression suite is `npm test` in this skill. Fixtures under `fixtures/` cover vanilla JS, React, a Node process, a static page, and an Illustrator-only extension.
