# WebView bridge

Local HTML in a WebView needs UXP 8 (`allowLocalRendering`) and manifest v5. The converter always writes that shape.

```json
"webview": {
  "allow": "yes",
  "allowLocalRendering": "yes",
  "enableMessageBridge": "localOnly",
  "domains": []
}
```

Use `localAndRemote` when the page loads remote origins. `allow` is still written because the API reference marks it required. A July 2026 changelog says newer runtimes ignore it. Keep it unless a host rejects the manifest.

`domains` entries are origins (`https://api.example.com`) or a left-most wildcard (`https://*.adobe.com`). Never `https://www.*` or `https://adobe.*`. Do not use `"all"` unless the page builds URLs at runtime.

## Layout

```text
extension-uxp/
  manifest.json
  index.html              UXP shell. One <webview> when there is one panel.
  index.js                entrypoints.setup, then bridge.mount
  host-bridge.js          listens for cep-to-uxp calls
  host-bridge-core.js     router
  host-handlers.js        ExtendScript replacements
  MIGRATION.md
  webview/                CEP page, with CSInterface.js replaced
    cep-to-uxp-boot.js    synchronous host snapshot
    cep-to-uxp-shim.js    same shim, for pages that did not load CSInterface.js
  legacy-extendscript/    JSX copied for reading. Not executed.
```

The shell loads `plugin:/webview/index.html`. Inside that page, CSS and JS stay relative (`./css/style.css`). A `plugin:/` URL for a subresource does not load.

Multiple panels get an empty shell. `create()` adds one WebView per panel. If a host shows a blank panel, the root node did not receive the element; `mount` appends it.

## Messages

Channel `cep-to-uxp`. Values must survive `JSON.parse(JSON.stringify(...))`.

Page to host:

```js
window.uxpHost.postMessage({
  channel: "cep-to-uxp",
  type: "call",
  id: 1,
  method: "evalScript",
  args: { script: "sayHello()" }
});
```

Host to page:

```js
webview.postMessage({
  channel: "cep-to-uxp",
  type: "result",
  id: 1,
  ok: true,
  value: "hello"
});
```

`host-ready` updates `appVersion` and native paths, then dispatches `com.adobe.csxs.events.ThemeColorChanged` once. Flyout clicks dispatch `com.adobe.csxs.events.flyoutMenuClicked` with the menu id in `event.data`.

The host listens on both `window` and the `<webview>` element because Adobe's examples disagree about which one fires. Duplicate ids are ignored.

`evalScript`'s callback receives a string. Failures are the error message, not CEP's generic `EvalScript error.` text.

## Host runtime

`host-*.js` is the UXP host, not the WebView. It has no `TextDecoder`, `TextEncoder`, `localStorage`, `child_process`, or a listening socket. `host-http.js` decodes UTF-8 itself. A `fetch` written in the page is still CORS-blocked on `plugin:/` when the origin is only in `webview.domains`. Call `window.cepToUxp.http({ url, method, headers, body })`. The host uses `network.domains`.

Changes to `host-*.js` load only when the plugin is reloaded in the UXP Developer Tool. Refreshing the WebView leaves the old host script running.

## What the shim does not do

- It does not run the script in ExtendScript.
- It does not make `cep.fs` synchronous.
- It does not provide Node inside the page.
- `getHostEnvironment()` is synchronous from the boot script, so it is available before the handshake. The version string stays `"unknown"` until `host-ready`.
- Opening the HTML in a desktop browser rejects bridge calls because `window.uxpHost` is missing.

Debugging the embedded page uses `uxpAllowInspector="true"` on the WebView element.

Sources: https://developer.adobe.com/uxp/uxp-api/reference-js/global-members/html-elements/html-web-view-element and https://developer.adobe.com/uxp/guides/explanation/concepts/entrypoints/
