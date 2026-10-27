# CEP to UXP API map

The WebView shim covers the common `CSInterface` surface so the page keeps loading. A mapped getter is not a promise that the old CEP behavior still exists.

| CEP | UXP |
| --- | --- |
| `CSXS/manifest.xml` | `manifest.json`, `manifestVersion` 5 |
| Panel, modeless, modal | UXP panel. Non-panel CEP types are still declared as panels and called out in `MIGRATION.md`. |
| `evalScript` / `ScriptPath` JSX | A string sent to `host-handlers.js`. JSX in `legacy-extendscript/` is not loaded. |
| `CSInterface.getHostEnvironment()` | Boot object, then `require("uxp").host.version` after the handshake. `appId` stays the CEP code (`PHXS`, not `PS`) so old branches keep working. |
| `getSystemPath(SystemPath.EXTENSION)` | `plugin:/` until the handshake, then the plugin folder's `nativePath`. |
| `getSystemPath(SystemPath.USER_DATA)` | `plugin-data:/`, then the data folder's `nativePath`. |
| Other `SystemPath` values | Empty string. There is no silent access to Documents or the host install. |
| `openURLInDefaultBrowser` | `require("uxp").shell.openExternal`. Needs `launchProcess.schemes` and a user consent dialog. |
| `closeExtension`, `resizeContent`, `registerKeyEventsInterest` | No equivalent. The shim reports them and continues. |
| Flyout XML | Static `<MenuItem Id Label>` values become `menuItems`. Clicks arrive as `com.adobe.csxs.events.flyoutMenuClicked`. Runtime-built menus are not extracted. |
| `ThemeColorChanged` | One event after the handshake, with a static dark `appSkinInfo`. Later theme changes are not tracked. |
| `cep.fs`, `cep.encoding` | `require("uxp").storage.localFileSystem` or `require("fs")` in the **host** script. Read/write is async. `formats.utf8` and `formats.binary`, or `"utf-8"`. |
| `cep.process.createProcess` | Not available. `shell.openPath` cannot pass argv or capture stdout. Use a hybrid addon when the process is required. |
| Node `fs`, `path`, `os` | Move real reads and writes to the host. `path.join` and a throwing `fs` in the boot script are a render guard, not a filesystem. |
| Node `http`, `https` | Do not `fetch` from `plugin:/`. That page is CORS-blocked even when the origin is in `webview.domains`. Call `cepToUxp.http({ url, method, headers, body })`. The host performs `fetch` and needs `network.domains`. The host has no `TextDecoder`; the generated `host-http.js` decodes UTF-8 itself. |
| Node `child_process`, `net`, sockets, `.node` | The converter does not build a hybrid addon. Keep the panel's tool names. Replace a local process and a listening socket with the host `http` bridge when the helper was only an HTTP client. Return the old error string for anything the host still cannot run. A cloud model that only returns text is not a substitute. |
| Vulcan, cross-app events | Not available. Same-host `invokeCommand` / `showPanel` exist from UXP 6.0.2. |
| `localStorage` in the CEP page | Throws for `plugin:/` pages. The boot script installs an in-memory store when access throws. Those values are not saved. |
| `window.open`, `alert` as a new window | WebView does not open those windows. |
| CEP Node + DOM in one page (`--mixed-context`) | Split them. DOM stays in the WebView. Node moves to the host or a hybrid addon. |

## Host modules

| Host | Module | Document mutations |
| --- | --- | --- |
| Photoshop | `require("photoshop")` | `core.executeAsModal`. `batchPlay` only when the DOM lacks the operation. |
| InDesign | `require("indesign")` | Confirm the module name in the current InDesign UXP docs. |
| Premiere Pro | `require("premierepro")` | Use `host-premiere.js` for `Project.getActiveProject`, `getActiveSequence`, `getSequences`, `getRootItem`, `createSequence(name)`, `openSequence`, `setActiveSequence`, `setVideoFrameRect` inside `executeTransaction`, and `getVideoTrack` / `getTrackItems`. `createSequenceWithPresetPath` is 26.3 and needs a `.sqpreset` path. Do not invent further methods. |
| Media Encoder | host docs | Do not reuse Photoshop `batchPlay`. |

`require("uxp").versions.uxp` and `require("uxp").versions.plugin` replace CEP's API-version check. Photoshop `apiLevel` is a separate manifest field and is not required for current Photoshop.

## Filesystem permission

| CEP behavior | Declare |
| --- | --- |
| Plugin folder, settings, temp files | `"localFileSystem": "plugin"` |
| User picks a file or folder | `"request"` plus `getFileForOpening` / `getFolder` |
| Fixed arbitrary paths | `"fullAccess"` and say why in the migration notes |

Persistent access to a user-selected file uses `createPersistentToken`. Store the token in plugin data, not in WebView `localStorage`.
