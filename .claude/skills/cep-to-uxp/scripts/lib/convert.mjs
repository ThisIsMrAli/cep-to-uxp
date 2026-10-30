import fs from "node:fs";
import path from "node:path";
import { decide, suggestUi } from "./decide.mjs";
import {
  pluginUrl,
  readRuntime,
  renderBoot,
  renderHandlers,
  renderHostBridge,
  renderIndex,
  renderLegacyReadme,
  renderManifest,
  renderMigration,
  renderNativeEntry,
  renderRetarget,
  renderShellHtml,
  uxpKind,
  webviewElementId
} from "./generate.mjs";
import { injectBeforeCsInterface, injectScripts, relativeUrl, stripNodePreloads } from "./html.mjs";
import { scanCep } from "./scan.mjs";
import { CONFIG_FILES } from "./layers.mjs";
import { writeBoltStarter } from "./bolt.mjs";

const SKIP_DIRS = new Set(["node_modules", ".git", "CSXS", "csxs"]);
const UI_CHOICES = new Set(["keep", "bolt-react", "bolt-vue", "bolt-svelte", "native", "retarget"]);
const DESIGN_CHOICES = new Set(["spectrum", "preserve"]);

export function convertCep(options) {
  const input = path.resolve(options.input);
  const out = path.resolve(options.out);
  assertSeparate(input, out);
  const ui = normalizeUi(options.ui);
  const design = normalizeDesign(options.design);
  const scan = scanCep(input);
  const decision = decide(scan, {
    strategy: ui === "native" ? "native" : options.strategy || "auto",
    host: options.host
  });
  decision.ui = ui;
  decision.design = design;
  decision.suggestedUi = suggestUi(scan);
  decision.title = scan.bundle.name;
  prepareOut(out, options.force);

  if (decision.strategy === "blocked") {
    const report = { strategy: "blocked", panels: [], scan, decision };
    fs.writeFileSync(path.join(out, "migration-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(out, "MIGRATION.md"), renderMigration(scan, decision, { output: out }));
    return { exitCode: 2, report };
  }

  if (scan.extensions.length === 0) {
    throw new Error("The CEP manifest has no extensions with a DispatchInfo block.");
  }

  if (scan.bundle.id === "com.adobe.CEPHTMLTEST" && scan.extensions[0]?.id) {
    decision.warnings.push("ExtensionBundleId was the CEP HTML Test boilerplate. The plugin id is the Extension Id.");
    scan.bundle.id = scan.extensions[0].id;
    if (scan.extensions[0].menu) scan.bundle.name = scan.extensions[0].menu;
  }
  scan.bundle.id = sanitizeId(scan.bundle.id, "com.example.migrated-panel");
  scan.extensions.forEach((extension, index) => {
    extension.id = sanitizeId(extension.id, `${scan.bundle.id}.panel${index + 1}`);
    if (extension.type && uxpKind(extension.type) === "command") {
      decision.warnings.push(
        `CEP ${extension.type} "${extension.id}" is a UXP command. It opens a modal dialog instead of a docked panel.`
      );
    }
  });

  const panels = scan.extensions.map((extension) => ({
    id: extension.id,
    label: extension.menu || scan.bundle.name,
    kind: uxpKind(extension.type),
    mainPath: extension.mainPath,
    src: pluginUrl(extension.mainPath),
    elementId: webviewElementId(extension.id),
    size: extension.size || { width: 480, height: 360 }
  }));

  if (ui.startsWith("bolt-")) writeBoltProduct(scan, decision, out, panels, ui);
  else if (decision.strategy === "native" || ui === "native") writeNative(scan, decision, out, panels);
  else writeWebview(scan, decision, out, panels);
  if (ui === "retarget") writeRetarget(scan, out);

  const report = { strategy: decision.strategy, ui, panels, scan, decision };
  fs.writeFileSync(path.join(out, "migration-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, "MIGRATION.md"), renderMigration(scan, decision, { output: out, ui }));
  return { exitCode: 0, report };
}

function normalizeUi(value) {
  const ui = value || "keep";
  if (!UI_CHOICES.has(ui)) {
    throw new Error(`Unknown --ui ${ui}. Use keep, bolt-react, bolt-vue, bolt-svelte, native, or retarget.`);
  }
  return ui;
}

function normalizeDesign(value) {
  const design = value || "spectrum";
  if (!DESIGN_CHOICES.has(design)) {
    throw new Error(`Unknown --design ${design}. Use spectrum or preserve.`);
  }
  return design;
}

function applySpectrumChrome(html, title, design) {
  if (design === "preserve" || html.includes("<sp-heading")) return html;
  const heading = `<sp-heading>${String(title).replace(/[&<>]/g, "")}</sp-heading>`;
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, (match) => `${match}\n${heading}`);
  return `${heading}\n${html}`;
}

function writeRetarget(scan, out) {
  fs.writeFileSync(path.join(out, "RETARGET.md"), renderRetarget(scan));
  const roots = scan.layers?.sourceRoots || [];
  if (!roots.length) return;
  const extraSkip = new Set(["build", "dist", "out", "output", "release", "coverage", "webview"]);
  for (const sourceRoot of roots) {
    const destName = roots.length === 1 && path.resolve(sourceRoot) === path.resolve(scan.input) ? "panel" : path.basename(sourceRoot);
    copyTree(sourceRoot, path.join(out, "ui-src", destName), extraSkip);
  }
  fs.mkdirSync(path.join(out, "ui-src"), { recursive: true });
  for (const name of CONFIG_FILES) {
    const src = path.join(scan.layers.projectRoot, name);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(out, "ui-src", name));
  }
}

function writeBoltProduct(scan, decision, out, panels, ui) {
  if (decision.permissions) delete decision.permissions.webview;
  const pure = decision;
  copySourceForPort(scan, path.join(out, "bolt", "cep-src"));
  copyIcons(scan, out);
  writeBoltStarter(out, scan, pure, ui);
  fs.writeFileSync(path.join(out, "bolt", "PORT.md"), renderPortPlan(scan, ui));
  fs.writeFileSync(path.join(out, "bolt", "vite.config.ts"), viteUxpConfig());
  fs.writeFileSync(path.join(out, "cep-to-uxp-entry.js"), renderNativeEntry(panels, decision.flyoutItems));
  fs.writeFileSync(path.join(out, "uxp-compat.js"), readRuntime("premiere-compat.js"));
  fs.writeFileSync(path.join(out, "bolt", "uxp-tailwind.cjs"), readRuntime("premiere-tailwind.cjs"));
  fs.writeFileSync(path.join(out, "bolt", "patch-react-doc.mjs"), readRuntime("patch-react-doc.mjs"));
  fs.writeFileSync(path.join(out, "index.html"), renderPureHtml());
  copyLegacy(scan, out);
  fs.writeFileSync(path.join(out, "host-http.js"), readRuntime("host-http.cjs"));
  if (decision.hosts.some((host) => host.app === "premierepro")) {
    fs.writeFileSync(path.join(out, "host-premiere.js"), readRuntime("host-premiere.cjs"));
  }
  fs.writeFileSync(path.join(out, "host-handlers.js"), renderHandlers(scan.evalScripts));
  fs.writeFileSync(path.join(out, "manifest.json"), renderManifest(scan, pure, out, "", "index.html"));
}

function renderPureHtml() {
  return `<!DOCTYPE html>
<html>
  <head>
    <script src="uxp-compat.js"></script>
    <meta charset="utf-8" />
    <style>
      html, body, #root { margin: 0; width: 100%; height: 100%; background: #1e1e1e; }
      [role="button"] { cursor: pointer; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script src="cep-to-uxp-entry.js"></script>
  </body>
</html>
`;
}

function viteUxpConfig() {
  return `import { defineConfig } from "vite";

export default defineConfig({
  build: {
    modulePreload: false,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true
      }
    }
  }
});
`;
}

function renderPortPlan(scan, ui) {
  const documentNotes = `
## UXP document

Photoshop, InDesign, Premiere Pro, and Media Encoder share this document. It is not the CEP browser. The crashes below were hit in Premiere. Adobe's known-issues page lists the same HTML and CSS gaps for Photoshop. Treat them as shared until a host build proves one of them fixed. Read \`references/uxp-document.md\` in the skill.

\`uxp-compat.js\` is the first script in \`index.html\`. Leave it there, before the bundle. It stubs IntersectionObserver and ResizeObserver (each instance has \`_observer\`), MutationObserver, NodeFilter, createTreeWalker, missing HTML* constructors, ownerDocument, defaultView, and rewrites \`currentColor\` plus unitless SVG width and height.

Do not emit \`<button>\` for app chrome. The host can draw its own skin on a button and ignore Tailwind. Use \`<div role="button">\`. Radix tabs, selects, and switches still emit buttons. Treat those as unsafe on every host.

Do not emit Radix Dialog, Popper, tooltip observers, or react-remove-scroll. A dialog is an absolute layer inside the panel: \`position: absolute; top: 0; left: 0; width: 100%; height: 100%\` for the scrim, and a card that is not the full height. Do not use \`inset\` or \`bottom\` as the only way to fill the panel. The app frame is \`position: relative; height: 100%; overflow: hidden\`.

In \`tailwind.config.js\` set \`important: true\` and add \`require("./uxp-tailwind.cjs")\` to plugins. The UXP document ignores \`gap\`, does not match \`.mb-1\\\\.5\`, and drops \`rgb(var(--token) / alpha)\`. \`text-transform\` is documented as unsupported. The plugin writes \`[class~="mb-1.5"]\`, turns gap and space-y into child margins in pixels, and paints hex colors.

After the build, run \`node patch-react-doc.mjs <bundle>\`. React's \`nodeType === 9 ? node : node.ownerDocument\` throws when ownerDocument is missing. \`validate-uxp.mjs\` printing OK does not mean a click survives.

Spectrum \`sp-textfield\`, \`sp-picker\`, and \`sp-menu-item\` can expose \`value\` as a getter. Set \`value\` and \`selected\` with \`setAttribute\`. Adobe documents the same rule for \`select\` and \`option\`.

Build the bolt app before calling the port done.
`;
  return `# Port ${scan.bundle.name}

This is a pure UXP ${ui} plugin. There is no WebView folder and index.html has no <webview>.

Do not drop a visible control.

Clone the CEP screens in \`cep-src/\` into \`src/\`. Same regions, labels, prompts, empty states, menus, chips, composers, and actions. Spectrum widgets may replace a control the user asked to restyle. They are not a reason to delete credits, history, a model menu, suggestion cards, or the composer.

If a click cannot run in UXP (ExtendScript, a spawned process, or a listening port), keep the control. The click returns the old error string. Do not rewrite prompt copy so the action only "describes" the edit.

Premiere has no MutationObserver. The Vite config sets \`build.modulePreload\` to false and emits an iife bundle. Do not turn modulepreload back on.

Do not pass \`value\` as a React prop to \`sp-textfield\`, \`sp-picker\`, or \`sp-menu-item\`. Those properties are getter-only in Premiere. Set \`value\` and \`selected\` with \`setAttribute\`.

A name that appears only inside a comment, such as an \`evalTS("myFunc")\` example, is not a product feature. Name the real host functions you can read.

Do not point manifest icons at \`webview/\`. This plugin does not have that folder.
${documentNotes}`;
}

function copySourceForPort(scan, dest) {
  const roots = scan.layers?.sourceRoots || [];
  const extraSkip = new Set(["build", "dist", "out", "output", "release", "coverage", "webview", "node_modules"]);
  if (!roots.length) {
    copyTree(scan.input, dest, extraSkip);
    return;
  }
  for (const sourceRoot of roots) {
    const destName = roots.length === 1 && path.resolve(sourceRoot) === path.resolve(scan.input) ? "." : path.basename(sourceRoot);
    copyTree(sourceRoot, destName === "." ? dest : path.join(dest, destName), extraSkip);
  }
}

function copyIcons(scan, out) {
  for (const extension of scan.extensions) {
    for (const icon of extension.icons || []) {
      if (!icon.path) continue;
      const src = path.join(scan.input, icon.path);
      if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
      const dest = path.join(out, icon.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}

function writeWebview(scan, decision, out, panels) {
  const ui = path.join(out, "webview");
  copyTree(scan.input, ui);
  fs.writeFileSync(path.join(ui, "cep-to-uxp-boot.js"), renderBoot(scan, decision, panels[0].id));
  fs.writeFileSync(path.join(ui, "cep-to-uxp-shim.js"), readRuntime("csinterface-shim.js"));
  replaceNamed(ui, /^CSInterface\.js$/i, readRuntime("csinterface-shim.js"));
  patchHtml(ui, path.join(ui, "cep-to-uxp-boot.js"), path.join(ui, "cep-to-uxp-shim.js"), scan.preloadScripts);
  for (const panel of panels) {
    const page = path.join(ui, panel.mainPath);
    if (fs.existsSync(page)) continue;
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.writeFileSync(
      page,
      `<!DOCTYPE html><html><body><p>CEP MainPath ${panel.mainPath} was not in the project. Build the CEP extension, then convert again.</p></body></html>\n`
    );
  }
  copyLegacy(scan, out);
  fs.writeFileSync(path.join(out, "host-bridge-core.js"), readRuntime("host-bridge-core.cjs"));
  fs.writeFileSync(path.join(out, "host-http.js"), readRuntime("host-http.cjs"));
  if (decision.hosts.some((host) => host.app === "premierepro")) {
    fs.writeFileSync(path.join(out, "host-premiere.js"), readRuntime("host-premiere.cjs"));
  }
  fs.writeFileSync(path.join(out, "host-bridge.js"), renderHostBridge());
  fs.writeFileSync(path.join(out, "host-handlers.js"), renderHandlers(scan.evalScripts));
  fs.writeFileSync(path.join(out, "index.js"), renderIndex(panels, decision.flyoutItems));
  fs.writeFileSync(path.join(out, "index.html"), renderShellHtml(panels, decision));
  fs.writeFileSync(path.join(out, "manifest.json"), renderManifest(scan, decision, out, "webview", "index.html"));
}

function writeNative(scan, decision, out, panels) {
  copyTree(scan.input, out);
  replaceNamed(out, /^CSInterface\.js$/i, readRuntime("csinterface-native-stub.js"));
  const compat = path.join(out, "uxp-compat.js");
  fs.writeFileSync(compat, readRuntime("premiere-compat.js"));
  const entry = path.join(out, "cep-to-uxp-entry.js");
  fs.writeFileSync(entry, renderNativeEntry(panels, decision.flyoutItems));
  for (const panel of panels) {
    const htmlPath = path.join(out, panel.mainPath);
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, "utf8");
    const sources = [relativeUrl(htmlPath, compat), relativeUrl(htmlPath, entry)];
    fs.writeFileSync(htmlPath, applySpectrumChrome(injectScripts(html, sources), scan.bundle.name, decision.design));
  }
  copyLegacy(scan, out);
  fs.writeFileSync(path.join(out, "host-handlers.js"), renderHandlers(scan.evalScripts));
  const main = panels[0]?.mainPath || "index.html";
  fs.writeFileSync(path.join(out, "manifest.json"), renderManifest(scan, decision, out, "", main));
}

function patchHtml(root, bootFile, shimFile, preloadNames) {
  for (const file of filesUnder(root)) {
    if (!/\.html?$/i.test(file)) continue;
    let html = fs.readFileSync(file, "utf8");
    html = stripNodePreloads(html, preloadNames);
    const bootSrc = relativeUrl(file, bootFile);
    const loadsShim = /<script\b[^>]*\bCSInterface\.js/i.test(html);
    if (loadsShim) html = injectBeforeCsInterface(html, bootSrc);
    else html = injectScripts(html, [bootSrc, relativeUrl(file, shimFile)]);
    fs.writeFileSync(file, html);
  }
}

function copyLegacy(scan, out) {
  if (scan.extendscript.length === 0) return;
  for (const file of scan.extendscript) {
    const src = path.join(scan.input, file.file);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(out, "legacy-extendscript", file.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  fs.writeFileSync(path.join(out, "legacy-extendscript", "README.md"), renderLegacyReadme());
}

function copyTree(from, to, extraSkip = new Set()) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === ".DS_Store") continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || extraSkip.has(entry.name)) continue;
      copyTree(src, dest, extraSkip);
    } else if (!skipFile(entry.name)) {
      fs.copyFileSync(src, dest);
    }
  }
}

function skipFile(name) {
  if (name === ".debug" || name === ".env" || name.startsWith(".env.")) return true;
  if (["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"].includes(name)) return true;
  return [".pem", ".zxp", ".p12"].includes(path.extname(name).toLowerCase());
}

function replaceNamed(root, pattern, contents) {
  for (const file of filesUnder(root)) {
    if (pattern.test(path.basename(file))) fs.writeFileSync(file, contents);
  }
}

function filesUnder(root, found = []) {
  if (!fs.existsSync(root)) return found;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      filesUnder(full, found);
    } else found.push(full);
  }
  return found;
}

function prepareOut(out, force) {
  if (fs.existsSync(out) && fs.readdirSync(out).length > 0) {
    if (!force) throw new Error(`${out} already exists. Pass --force to replace it.`);
    fs.rmSync(out, { recursive: true, force: true });
  }
  fs.mkdirSync(out, { recursive: true });
}

function assertSeparate(input, out) {
  if (overlaps(input, out) || overlaps(out, input)) {
    throw new Error("The output folder must not be inside the CEP folder, or the other way around.");
  }
}

function overlaps(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function sanitizeId(id, fallback) {
  const cleaned = String(id || "").trim();
  if (/^[A-Za-z][A-Za-z0-9._-]*$/.test(cleaned)) return cleaned;
  const next = cleaned.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z]+/, "");
  return next || fallback;
}
