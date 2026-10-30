import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCoverage, uncoveredItems } from "./coverage.mjs";

const RUNTIME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../runtime");

export function runtimePath(name) {
  return path.join(RUNTIME, name);
}

export function readRuntime(name) {
  return fs.readFileSync(runtimePath(name));
}

export function webviewElementId(panelId) {
  return `cep-webview-${String(panelId).replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export function pluginUrl(mainPath) {
  const cleaned = String(mainPath || "index.html").replace(/^\.?\//, "");
  return `plugin:/webview/${cleaned}`;
}

function rgb(red, green, blue) {
  return { color: { red, green, blue, alpha: 255 }, type: 1 };
}

function skin() {
  const panel = rgb(50, 50, 50);
  const bar = rgb(38, 38, 38);
  return {
    baseFontFamily: "Adobe Clean",
    baseFontSize: 10,
    appBarBackgroundColor: bar,
    panelBackgroundColor: panel,
    appBarBackgroundColorSRGB: bar,
    panelBackgroundColorSRGB: panel,
    systemHighlightColor: rgb(46, 107, 230)
  };
}

function apiVersion(cepVersion) {
  const match = String(cepVersion || "0.0").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return {
    major: Number(match?.[1] || 0),
    minor: Number(match?.[2] || 0),
    micro: Number(match?.[3] || 0)
  };
}

export function renderBoot(scan, decision, extensionId) {
  const primary = decision.hosts[0];
  const declared = scan.hosts.find((host) => host.app === primary.app) || primary;
  const boot = {
    extensionId,
    environment: {
      appId: declared.cep,
      appName: primary.name,
      appVersion: "unknown",
      appLocale: "en_US",
      appUILocale: "en_US",
      isAppOffline: false,
      appSkinInfo: skin()
    },
    paths: {
      extension: "plugin:/",
      userData: "plugin-data:/"
    },
    apiVersion: apiVersion(scan.bundle.cepVersion),
    capabilities: {}
  };
  return `window.__CEP_TO_UXP_BOOT__ = ${JSON.stringify(boot, null, 2)};\n${renderBootGuards(scan)}`;
}

function renderBootGuards(scan) {
  const parts = [MEMORY_STORAGE];
  if (scan.renderGuard) parts.push(PATH_AND_FS);
  if (scan.needsAesp) parts.push(AESP_STUB);
  return parts.join("\n");
}

const MEMORY_STORAGE = `(function () {
  function storageThrows() {
    try {
      var store = window.localStorage;
      if (!store || typeof store.getItem !== "function") return true;
      store.getItem("__cep_to_uxp_probe__");
      return false;
    } catch (error) {
      return true;
    }
  }
  if (!storageThrows()) return;
  var memory = Object.create(null);
  var memoryStorage = {
    getItem: function (key) {
      var name = String(key);
      return Object.prototype.hasOwnProperty.call(memory, name) ? memory[name] : null;
    },
    setItem: function (key, value) {
      memory[String(key)] = String(value);
    },
    removeItem: function (key) {
      delete memory[String(key)];
    },
    clear: function () {
      memory = Object.create(null);
    },
    key: function (index) {
      return Object.keys(memory)[index] || null;
    },
    get length() {
      return Object.keys(memory).length;
    }
  };
  try {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: memoryStorage
    });
  } catch (error) {
    window.localStorage = memoryStorage;
  }
})();
`;

const PATH_AND_FS = `(function () {
  function join() {
    var result = "";
    for (var i = 0; i < arguments.length; i += 1) {
      var part = arguments[i];
      if (part === undefined || part === null || part === "") continue;
      part = String(part).replace(/\\\\/g, "/");
      if (!result) result = part;
      else if (result.charAt(result.length - 1) === "/") result += part.replace(/^\\/+/, "");
      else result += "/" + part.replace(/^\\/+/, "");
    }
    return result;
  }
  function basename(file, drop) {
    var base = String(file).split(/[\\\\/]/).pop();
    if (drop && base.slice(-String(drop).length) === String(drop)) return base.slice(0, -String(drop).length);
    return base;
  }
  function extname(file) {
    var base = basename(file);
    var index = base.lastIndexOf(".");
    return index <= 0 ? "" : base.slice(index);
  }
  function dirname(file) {
    var value = String(file).replace(/\\\\/g, "/");
    var index = value.lastIndexOf("/");
    return index < 0 ? "" : value.slice(0, index);
  }
  if (!window.path || typeof window.path.join !== "function") {
    window.path = { join: join, basename: basename, extname: extname, dirname: dirname };
  }
  function deny(name) {
    return function () {
      throw new Error("cep-to-uxp: Node fs." + name + " is not available in the UXP WebView. This is a render guard, not a filesystem.");
    };
  }
  if (!window.fs || typeof window.fs.readFileSync !== "function") {
    var methods = {
      readFileSync: deny("readFileSync"),
      readFile: deny("readFile"),
      writeFileSync: deny("writeFileSync"),
      writeFile: deny("writeFile"),
      existsSync: deny("existsSync"),
      readdirSync: deny("readdirSync"),
      statSync: deny("statSync"),
      mkdirSync: deny("mkdirSync"),
      unlinkSync: deny("unlinkSync"),
      copyFileSync: deny("copyFileSync")
    };
    window.fs = new Proxy(methods, {
      get: function (target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== "string") return undefined;
        return deny(prop);
      }
    });
  }
})();
`;

const AESP_STUB = `(function () {
  if (typeof window.Aesp !== "function") window.Aesp = function Aesp() {};
})();
`;

export function renderHandlers(scripts) {
  const entries = scripts
    .map((script) => {
      const literal = JSON.stringify(script);
      return `  ${literal}: async () => {\n    throw new Error("Rewrite this ExtendScript call in host-handlers.js: " + ${literal});\n  }`;
    })
    .join(",\n");
  return `// Generated by cep-to-uxp. Replace each throw with a host API call.
// Handlers must return a string. UXP cannot execute ExtendScript or JSX files.
// Photoshop document changes belong inside require("photoshop").core.executeAsModal.
// Confirm require("indesign") and require("premierepro") against the current host docs before using them.

async function evalExtendScript(script) {
  const table = {
${entries}
  };
  if (Object.prototype.hasOwnProperty.call(table, script)) {
    const value = await table[script]();
    return value == null ? "" : String(value);
  }
  throw new Error("No UXP handler for ExtendScript: " + script);
}

module.exports = { evalExtendScript };
`;
}

export function renderHostBridge() {
  return `const { CHANNEL, createRouter } = require("./host-bridge-core.js");
const handlers = require("./host-handlers.js");

const webviews = new Set();

async function hostPayload() {
  const uxp = require("uxp");
  const payload = {
    paths: { extension: "plugin:/", userData: "plugin-data:/" },
    appVersion: ""
  };
  try {
    payload.appVersion = (uxp.host && uxp.host.version) || "";
  } catch (error) {
    payload.appVersion = "";
  }
  try {
    const folder = await uxp.storage.localFileSystem.getPluginFolder();
    if (folder && folder.nativePath) payload.paths.extension = folder.nativePath;
  } catch (error) {
    // The plugin folder is still addressable as plugin:/.
  }
  try {
    const folder = await uxp.storage.localFileSystem.getDataFolder();
    if (folder && folder.nativePath) payload.paths.userData = folder.nativePath;
  } catch (error) {
    // plugin-data:/ remains available.
  }
  return payload;
}

const router = createRouter({
  evalScript(script) {
    return handlers.evalExtendScript(script);
  },
  http(args) {
    return require("./host-http.js").request(args || {});
  },
  async openExternal(url) {
    const result = await require("uxp").shell.openExternal(
      String(url),
      "Open a link from the migrated CEP panel"
    );
    if (result) throw new Error(result);
    return "";
  },
  unsupported(args) {
    console.warn("CEP API is not available in UXP:", args && args.api ? args.api : args);
  }
});

function attach(webview) {
  if (!webview || webview.__cepToUxpAttached) return;
  webview.__cepToUxpAttached = true;
  webviews.add(webview);
  const onMessage = (event) => {
    router(event.data, (message) => webview.postMessage(message));
  };
  window.addEventListener("message", onMessage);
  webview.addEventListener("message", onMessage);
  const sendReady = () => {
    hostPayload().then((payload) => {
      webview.postMessage({ channel: CHANNEL, type: "host-ready", payload });
    });
  };
  webview.addEventListener("loadstop", sendReady);
  sendReady();
}

function mount(root, options) {
  const elementId = options.elementId;
  const src = options.src;
  let webview = typeof document !== "undefined" ? document.getElementById(elementId) : null;
  if (webview && root && root.appendChild && webview.parentNode !== root) {
    root.appendChild(webview);
  }
  if (!webview) {
    webview = document.createElement("webview");
    webview.setAttribute("id", elementId);
    webview.setAttribute("width", "100%");
    webview.setAttribute("height", "100%");
    if (root && root.appendChild) root.appendChild(webview);
  }
  function fill(node) {
    if (!node || !node.style) return;
    node.style.width = "100%";
    node.style.height = "100%";
    node.style.display = "flex";
    node.style.flex = "1 1 auto";
    node.style.flexDirection = "column";
    node.style.background = "#232323";
  }
  fill(root);
  fill(webview);
  webview.style.border = "none";
  webview.setAttribute("uxpAllowInspector", "true");
  if (src && !webview.__cepToUxpSrc) {
    webview.setAttribute("src", src);
    webview.__cepToUxpSrc = src;
  }
  attach(webview);
  return webview;
}

function notifyFlyout(menuId) {
  const message = {
    channel: CHANNEL,
    type: "event",
    payload: {
      type: "com.adobe.csxs.events.flyoutMenuClicked",
      data: String(menuId)
    }
  };
  webviews.forEach((webview) => webview.postMessage(message));
}

module.exports = { attach, mount, notifyFlyout };
`;
}

export function renderIndex(panels, flyoutItems) {
  const menu = flyoutItems.length
    ? `,
      menuItems: ${JSON.stringify(flyoutItems, null, 8).replace(/\n/g, "\n      ")}`
    : "";
  const panelBodies = panels
    .filter((panel) => panel.kind !== "command")
    .map((panel) => {
      return `    ${JSON.stringify(panel.id)}: {
      create(root) {
        bridge.mount(root, { src: ${JSON.stringify(panel.src)}, elementId: ${JSON.stringify(panel.elementId)} });
      },
      show(root) {
        bridge.mount(root, { src: ${JSON.stringify(panel.src)}, elementId: ${JSON.stringify(panel.elementId)} });
      },
      hide() {},
      destroy() {},
      invokeMenu(menuId) {
        bridge.notifyFlyout(menuId);
      }${menu}
    }`;
    })
    .join(",\n");
  const commandBodies = panels
    .filter((panel) => panel.kind === "command")
    .map((panel) => {
      const size = panel.size || { width: 480, height: 360 };
      return `    ${JSON.stringify(panel.id)}: {
      run() {
        const dialog = document.getElementById(${JSON.stringify(`cep-dialog-${panel.elementId}`)});
        bridge.mount(dialog, { src: ${JSON.stringify(panel.src)}, elementId: ${JSON.stringify(panel.elementId)} });
        return dialog.uxpShowModal({
          title: ${JSON.stringify(panel.label || panel.id)},
          resize: "both",
          size: ${JSON.stringify(size)}
        });
      }
    }`;
    })
    .join(",\n");
  const sections = [];
  if (panelBodies) sections.push(`  panels: {\n${panelBodies}\n  }`);
  if (commandBodies) sections.push(`  commands: {\n${commandBodies}\n  }`);
  return `const { entrypoints } = require("uxp");
const bridge = require("./host-bridge.js");

entrypoints.setup({
${sections.join(",\n")}
});
`;
}

export function renderShellHtml(panels, decision = {}) {
  const list = Array.isArray(panels) ? panels : panels ? [panels] : [];
  const design = decision.design || "spectrum";
  const title = decision.title || (list[0] && list[0].label) || "Plugin";
  const docked = list.filter((panel) => panel.kind !== "command");
  const commands = list.filter((panel) => panel.kind === "command");
  const heading =
    design === "preserve" || docked.length === 0
      ? ""
      : `    <sp-heading>${escapeHtml(title)}</sp-heading>\n`;
  const panelView =
    docked.length === 1
      ? `    <webview id="${docked[0].elementId}" width="100%" height="100%" uxpAllowInspector="true" src="${docked[0].src}"></webview>\n`
      : "";
  const dialogs = commands
    .map((panel) => {
      return `    <dialog id="cep-dialog-${panel.elementId}">
      ${design === "preserve" ? "" : `<sp-heading>${escapeHtml(panel.label || title)}</sp-heading>`}
      <webview id="${panel.elementId}" width="100%" height="100%" uxpAllowInspector="true" src="${panel.src}"></webview>
    </dialog>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: #232323; display: flex; flex-direction: column; }
      webview { flex: 1 1 auto; width: 100%; height: 100%; border: none; background: #232323; }
      sp-heading { margin: 8px 12px; }
    </style>
  </head>
  <body>
${heading}${panelView}${dialogs}
    <script src="index.js"></script>
  </body>
</html>
`;
}

export function renderNativeEntry(panels, flyoutItems) {
  const menu = flyoutItems.length ? `,\n      menuItems: ${JSON.stringify(flyoutItems)}` : "";
  const panelBodies = panels
    .filter((panel) => panel.kind !== "command")
    .map((panel) => {
      return `    ${JSON.stringify(panel.id)}: {
      create() {},
      show() {},
      hide() {},
      destroy() {}${menu}
    }`;
    })
    .join(",\n");
  const commandBodies = panels
    .filter((panel) => panel.kind === "command")
    .map((panel) => {
      return `    ${JSON.stringify(panel.id)}: {
      async run() {
        const dialog = document.querySelector("dialog");
        if (dialog && dialog.uxpShowModal) {
          await dialog.uxpShowModal({ title: ${JSON.stringify(panel.label || panel.id)}, resize: "none", size: { width: 480, height: 320 } });
        }
      }
    }`;
    })
    .join(",\n");
  const sections = [];
  if (panelBodies) sections.push(`  panels: {\n${panelBodies}\n  }`);
  if (commandBodies) sections.push(`  commands: {\n${commandBodies}\n  }`);
  return `const { entrypoints } = require("uxp");

entrypoints.setup({
${sections.join(",\n")}
});
`;
}

function pngSize(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 24 || buf.subarray(0, 4).toString("hex") !== "89504e47") return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

export function selectManifestIcons(icons) {
  const chosen = [];
  const used = new Set();
  for (const icon of icons || []) {
    const theme = iconTheme(icon.type);
    if (!theme || theme.some((name) => used.has(name))) continue;
    theme.forEach((name) => used.add(name));
    chosen.push({ ...icon, theme, species: ["generic"] });
  }
  return chosen;
}

function iconTheme(type) {
  const value = String(type || "");
  if (/rollover/i.test(value)) return null;
  if (/dark/i.test(value)) return ["darkest", "dark", "medium"];
  if (/normal/i.test(value)) return ["lightest", "light"];
  return null;
}

function iconEntries(extension, outDir, prefix) {
  const entries = [];
  for (const icon of selectManifestIcons(extension.icons)) {
    const disk = path.join(outDir, prefix, icon.path);
    const size = pngSize(disk);
    if (!size) continue;
    entries.push({
      width: size.width,
      height: size.height,
      path: path.posix.join(prefix, icon.path),
      scale: [1],
      theme: icon.theme,
      species: icon.species
    });
  }
  return entries;
}

export function renderManifest(scan, decision, outDir, uiPrefix, main = "index.html") {
  const icons = scan.extensions.flatMap((extension) => iconEntries(extension, outDir, uiPrefix));
  const manifest = {
    manifestVersion: 5,
    id: scan.bundle.id,
    name: scan.bundle.name,
    version: scan.bundle.version,
    main,
    host: hostField(decision.hosts),
    entrypoints: scan.extensions.map((extension) => entrypoint(extension)),
    requiredPermissions: decision.permissions
  };
  if (icons.length) manifest.icons = icons;
  if (decision.strategy === "native") delete manifest.requiredPermissions;
  if (manifest.requiredPermissions && Object.keys(manifest.requiredPermissions).length === 0) {
    delete manifest.requiredPermissions;
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function hostField(hosts) {
  const fields = hosts.map((host) => ({ app: host.app, minVersion: host.minVersion }));
  return fields.length === 1 ? fields[0] : fields;
}

export function uxpKind(cepType) {
  const type = String(cepType || "Panel").toLowerCase();
  if (type.includes("custom") || type.includes("modal")) return "command";
  return "panel";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clampSize(size, fallback) {
  const width = Math.max(50, Number(size?.width) || fallback.width);
  const height = Math.max(50, Number(size?.height) || fallback.height);
  return { width, height };
}

function entrypoint(extension) {
  const label = { default: extension.menu || extension.id };
  if (uxpKind(extension.type) === "command") {
    return { type: "command", id: extension.id, label };
  }
  return {
    type: "panel",
    id: extension.id,
    label,
    minimumSize: clampSize(extension.minSize, { width: 230, height: 200 }),
    maximumSize: extension.maxSize || { width: 2000, height: 2000 },
    preferredDockedSize: extension.size || { width: 300, height: 400 },
    preferredFloatingSize: extension.size || { width: 300, height: 400 }
  };
}

export function renderRetarget(scan) {
  const layers = scan.layers || {};
  const lines = [
    `# Retarget ${scan.bundle.name}`,
    "",
    "Do not call the port finished because the WebView painted.",
    "The old page still calls CEP and Node from inside the browser view. Those calls do nothing until they cross the bridge into the UXP host.",
    "Do not redraw the component tree in Spectrum. Keep the user's UI.",
    "",
    `Layout: **${layers.layout || "unknown"}**`,
    ""
  ];
  if (layers.layout === "build-only") {
    lines.push(
      "No editable source was found next to this bundle. The WebView is a shipped snapshot.",
      "Minified bundles are a poor place to separate UI, Node, and ExtendScript. Ask for the project source, then run this mode again.",
      "Until then, every host call stays a throw in `host-handlers.js`.",
      ""
    );
  } else {
    lines.push(
      "## Separate the code",
      "",
      "UI stays in the WebView. ExtendScript and Node move to the UXP host (`host-handlers.js` and `host-bridge.js`). The page only sends a string and receives a string.",
      "",
      "### UI",
      layers.uiCount
        ? `${layers.uiCount} UI file(s). First paths:`
        : "No framework or HTML source file was classified. Treat the panel scripts as the UI.",
      ...(layers.ui || []).map((file) => `- \`${file}\``),
      "",
      "### Bridge calls in source",
      ...(layers.callSites?.length
        ? layers.callSites.map((site) => `- \`${site.file}:${site.line}\` (${site.kind}) \`${site.summary}\``)
        : ["- No readable evalScript, ExtendScript, or Node call was found in source. Check generated bundles in MIGRATION.md."]),
      "",
      "### Node",
      layers.nodeCount
        ? `${layers.nodeCount} source file(s) use Node or cep.fs / cep.process:`
        : "No Node call was found in editable source.",
      ...(layers.node || []).map((file) => `- \`${file}\``),
      "",
      "### ExtendScript",
      ...(scan.extendscript?.length
        ? scan.extendscript.map((file) =>
            file.jsxbin
              ? `- \`${file.file}\` is JSXBIN. There is no function list. Leave a named throw. Do not invent a host DOM from the binary.`
              : `- \`${file.file}\`${file.functions?.length ? ` (${file.functions.join(", ")})` : ""}. Port the functions you can read. Return strings.`
          )
        : ["- No ExtendScript file was copied."]),
      "",
      "## What to change",
      "1. Edit the copy in `ui-src/` when it exists. Do not modify the CEP project.",
      "2. Replace `CSInterface`, `evalScript`, `evalExtendscript`, `cep.fs`, and `require` of Node modules in the UI with a bridge call. The shim already posts `evalScript` through `window.uxpHost`.",
      "3. Implement each readable call in `host-handlers.js`. Photoshop document changes go inside `require(\"photoshop\").core.executeAsModal`. Confirm `require(\"indesign\")` and `require(\"premierepro\")` in the current host docs.",
    "4. Leave JSXBIN and any call whose body you cannot read as an explicit throw.",
    "5. Do not load a Node preload in the WebView. `path.join` and a throwing `fs` are a render guard, not a filesystem.",
    "6. Call `cepToUxp.http({ url, method, headers, body })` for remote HTTP. A `fetch` from `plugin:/` stays CORS-blocked even when the origin is listed in `webview.domains`. The host method uses `network.domains`.",
    (scan.hosts || []).some((host) => host.app === "premierepro")
      ? "7. Premiere calls that match `host-premiere.js` should use that file: active project, sequences, `createSequence(name)`, frame size inside `executeTransaction`, and video track items. Do not call `createSequenceWithPresetPath` unless you have a `.sqpreset` path. Leave every other `evalTS` name as the uncovered line in `MIGRATION.md`."
      : "7. Readable host calls go in `host-handlers.js`. Unreadable JSX and unknown `evalTS` names stay uncovered.",
    "8. Reload the plugin in the UXP Developer Tool after changing `host-*.js`. Refreshing the WebView does not reload the host.",
    "9. initBolt and initializeCEP must not throw when invokeSync is missing. The shim provides no-op invokeSync and invokeAsync. A throw before createRoot().render() leaves the app node empty and the panel white.",
    ""
  );
    if (layers.build?.script) {
      lines.push(
        "## Rebuild",
        `A build script was found: \`${layers.build.command}\` (\`${layers.build.script}\`, ${layers.build.tool}).`,
        "Run it from `ui-src/` after the boundary edits, then copy the new HTML, CSS, and JS into `webview/`. Do not copy `node_modules`.",
        "The WebView must load that new bundle. Editing source while the panel still serves the old snapshot leaves every button dead.",
        layers.build.viteCep
          ? "package.json uses a vite-cep plugin. Build the UXP page with a plain Vite config, not the CEP plugin. Inject cep-to-uxp-boot.js and cep-to-uxp-shim.js before the module script. Strip every crossorigin attribute. plugin:/ does not answer a CORS request, and crossorigin can block the script and the stylesheet. Point index.html at the new hashed file and delete the previous hashed bundle."
          : "",
        layers.build.usesTailwind
          ? "The page uses Tailwind. Point css.postcss at the project's postcss.config.js. A stylesheet that still contains @tailwind or @apply was not compiled. The WebView ignores those at-rules and the panel stays white."
          : "",
        ""
      );
    } else {
      lines.push(
        "## Rebuild",
        "No build script was found. The scripts in the WebView are the page. Apply the boundary edits there, or in `ui-src/` and copy the changed scripts back into `webview/`.",
        ""
      );
    }
  }
  lines.push(
    "## Done",
    "Every source call either returns the old string from a host handler, or it is still listed as uncovered in `MIGRATION.md` with the file that calls it.",
    "A valid manifest is not that list."
  );
  return `${lines.join("\n")}\n`;
}

function retargetLines(scan, decision, extras) {
  const layers = scan.layers;
  if (!layers || decision.strategy === "blocked") return [];
  const ui = extras.ui;
  if (ui === "native" || (typeof ui === "string" && ui.startsWith("bolt-"))) {
    return [
      "## UI path",
      ui === "native"
        ? "This plugin is native UXP HTML. There is no WebView. Recreate host calls in the UXP document. A leftover `new CSInterface()` throws."
        : `This plugin uses ${ui}. Recreate the UI in \`bolt/\` as Spectrum UXP. The copied CEP page is a fallback only, not the default shipped UI.`,
      ""
    ];
  }
  if (layers.layout === "build-only") {
    return [
      "## WebView",
      "This input is a built snapshot. No editable source was found beside it.",
      "WebView is a last-resort path. Prefer converting again with `--ui native` or a bolt starter if the user wants a pure UXP UI.",
      ""
    ];
  }
  if (!layers.hasEditableSource) return [];
  if (ui === "retarget") {
    return [
      "## WebView",
      "The user chose to keep the existing UI in a WebView. Follow `RETARGET.md`. Move ExtendScript and Node onto the UXP host, rebuild, and load that bundle in the WebView.",
      ""
    ];
  }
  return [
    "## WebView",
    "The current page is in a WebView. Buttons that still call CEP or Node inside that page stay dead until they move to the host.",
    "WebView is a last-resort path. Do not switch to `--ui retarget` unless the user asks to keep the old UI.",
    ""
  ];
}

export function renderMigration(scan, decision, extras) {
  const coverage = buildCoverage(scan);
  const uncovered = uncoveredItems(coverage);
  const lines = [
    `# ${scan.bundle.name} → UXP`,
    "",
    "## Tell the user",
    uncovered.length || scan.skippedFiles?.length
      ? "These CEP features are not running in the UXP plugin. Say each one before calling the port finished."
      : "No ExtendScript, Node package, or server API was left uncovered.",
    ...coverage.map((item) => `- **${item.status}** \`${item.name}\` (${item.kind}): ${item.detail}`),
    "",
    ...retargetLines(scan, decision, extras),
    `Strategy: **${decision.strategy}**`,
    "",
    "## Why",
    ...decision.reasons.map((reason) => `- ${reason}`),
    "",
    "## Hosts",
    ...decision.hosts.map((host) => `- ${host.name} (\`${host.app}\`, min ${host.minVersion}). ${host.floor || ""}`),
    ...decision.blockedHosts.map((host) => `- Not converted: ${host.name}. ${host.reason}`),
    ...(scan.otherManifests?.length
      ? [
          "",
          "Other CEP manifests were found and were not included. Ask which extension to convert. Do not merge them.",
          ...scan.otherManifests.map((file) => `- \`${file}\``)
        ]
      : []),
    "",
    "## Permissions",
    "```json",
    JSON.stringify(decision.permissions, null, 2),
    "```",
    "",
    "URL literals were copied into WebView domains. Remove origins that are only opened in the system browser.",
    decision.hosts.length > 1
      ? "A packaged .ccx can target one host. The manifest uses an array, which is for the UXP Developer Tool only. Split it before distribution."
      : "Distribution uses one host object, which this manifest already does.",
    "",
    ...(extras.ui && String(extras.ui).startsWith("bolt-")
      ? [
          "## New UI",
          `A ${extras.ui} starter is in \`bolt/\`. The plugin root is still the loadable WebView port.`,
          "Install the bolt-uxp toolchain from https://github.com/hyperbrew/bolt-uxp before running the starter. The starter is not a second manifest.",
          ""
        ]
      : []),
    "## ExtendScript",
    "UXP does not load JSX and does not implement evalScript. Each stub in `host-handlers.js` must be rewritten or left as an explicit failure.",
    ...scan.evalScripts.map((script) => `- \`${script}\``),
    ...(scan.dynamicEvalScripts.length
      ? ["Dynamic evalScript calls must be handled in the default branch:", ...scan.dynamicEvalScripts.map((script) => `- \`${script}\``)]
      : []),
    ...(scan.extendscript.length
      ? scan.extendscript.map(
          (file) => `- \`${file.file}\`${file.functions.length ? ` (${file.functions.join(", ")})` : ""} copied to legacy-extendscript/ and not executed`
        )
      : ["- No ExtendScript files detected."]),
    "",
    ...(decision.strategy === "blocked"
      ? [
          "## Stop",
          "Do not invent a manifest app id. Leave this extension on CEP until the host documents a UXP panel runtime you can load in the UXP Developer Tool.",
          ""
        ]
      : [
          "## Agent checklist",
          "1. Rewrite every throwing handler. Return a string, matching the old callback contract.",
          "2. Keep Photoshop document mutations inside `executeAsModal`. Do not invent batchPlay descriptors; record them or read the host API.",
          "3. Rebuild a browser bundle if the page imports Node or bare npm packages. The WebView has no Node resolver.",
          "4. Run `node scripts/validate-uxp.mjs --input <output>` from this skill directory.",
          "5. Load the output folder in the UXP Developer Tool. This converter cannot start Photoshop, InDesign, Premiere, or Media Encoder.",
          ""
        ]),
    "## Known behavior changes",
    "- Theme data in the boot script is a static dark palette. The shim emits ThemeColorChanged once after the host handshake. It does not track later theme switches.",
    "- `resizeContent` and `closeExtension` do nothing useful. The user resizes or closes the panel.",
    "- Flyout clicks that were declared as static MenuItem XML are forwarded as `com.adobe.csxs.events.flyoutMenuClicked`. Menus built at runtime are not.",
    "- Messages are JSON values. Functions and DOM nodes do not survive the bridge.",
    ...(scan.renderGuard || scan.frameworks?.includes("react")
      ? [
          "- A white panel means the shell loaded and the page did not paint. With Spectrum, a visible sp-heading and an empty page means the page crashed. Those errors are in the WebView inspector, not the UXP Developer Tool log. React deletes the app node when startup throws. The same white panel can be uncompiled @tailwind CSS, a crossorigin script on plugin:/, or a WebView moved onto a panel root with no height. The validator does not check those."
        ]
      : []),
    ""
  ];
  if (decision.warnings.length) {
    lines.push("## Warnings", ...decision.warnings.map((warning) => `- ${warning}`), "");
  }
  if (decision.strategy === "hybrid") {
    lines.push(
      "## Hybrid plugin required",
      "Process, socket, and `.node` usage cannot be rewritten into UXP JavaScript.",
      "Read https://developer.adobe.com/uxp/guides/how-to/hybrid-plugins/build before promising those features.",
      "Premiere already ships hybrid plugins. Photoshop ships them. InDesign hybrid plugins were announced for summer 2027.",
      ""
    );
  }
  if (decision.strategy === "native") {
    lines.push(
      "## Native UXP panel",
      "The CEP HTML is the plugin document. It is not a Chromium page.",
      "If a control calls CSInterface, that call now throws. Move host work into the plugin script.",
      ""
    );
  }
  if (extras.output) lines.push(`Output: \`${extras.output}\``, "");
  return `${lines.join("\n")}\n`;
}

export function renderLegacyReadme() {
  return `# Legacy ExtendScript

These files were copied from the CEP extension so the host logic can be rewritten.
UXP does not execute them. Do not add them to manifest.json.
`;
}
