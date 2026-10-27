# Manifest

The converter writes manifest v5. Required shape:

```json
{
  "manifestVersion": 5,
  "id": "com.example.panel",
  "name": "Panel",
  "version": "1.2.3",
  "main": "index.html",
  "host": { "app": "PS", "minVersion": "26.0.0" },
  "entrypoints": [
    {
      "type": "panel",
      "id": "com.example.panel.panel",
      "label": { "default": "Panel" },
      "minimumSize": { "width": 200, "height": 200 },
      "maximumSize": { "width": 600, "height": 900 },
      "preferredDockedSize": { "width": 280, "height": 420 },
      "preferredFloatingSize": { "width": 280, "height": 420 }
    }
  ]
}
```

`id` comes from `ExtensionBundleId`. Entrypoint ids come from each CEP `Extension Id`. Versions are normalized to `x.y.z`. Sizes come from CEP `Geometry`; missing sizes fall back to 230×200 minimum, 300×400 preferred, and 2000×2000 maximum.

Icons are copied only for PNG files whose IHDR size can be read. Premiere rejects a manifest that has two icons on one theme, or an icon with no `theme` (it treats that as a second root icon). RollOver and DarkRollOver are dropped. `Normal` maps to `lightest` and `light`. `DarkNormal` maps to `darkest`, `dark`, and `medium`. Every kept icon sets `species` to `["generic"]`. One icon is emitted per theme set. Missing icons are omitted so the host default is used.

Flyout items are not manifest fields. They are `menuItems` inside `entrypoints.setup`.

## Permissions written for a WebView

| Key | When |
| --- | --- |
| `webview.allow` | Always `"yes"` for a WebView build. |
| `webview.allowLocalRendering` | Always `"yes"`. |
| `webview.enableMessageBridge` | `localOnly`, or `localAndRemote` when any http(s)/ws(s) origin was found. |
| `webview.domains` | Origins copied from URL literals. |
| `localFileSystem` | `"plugin"`, or `"fullAccess"` when `cep.fs` or Node `fs` is used. |
| `network.domains` | Only when `fetch`, XHR, WebSocket, axios, or Node `http` appears. |
| `launchProcess.schemes` | Schemes passed to `openURLInDefaultBrowser` or `window.open`. A non-literal open adds `https`. |
| `clipboard` | `readAndWrite` when clipboard APIs appear. |
| `allowCodeGenerationFromStrings` | `true` when the page uses `eval(` or `new Function`. `evalScript` does not count. |

A native build omits `requiredPermissions` unless you add them while rewriting host calls. Do not leave a WebView permission on a panel that has no WebView.

Photoshop's `host.data.apiLevel` is optional. Current Photoshop uses API v2 by default. Set it only when the port still needs the v1 non-modal behavior, and say why.
