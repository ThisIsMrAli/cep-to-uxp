import fs from "node:fs";
import path from "node:path";
import { decide } from "./decide.mjs";
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

  if (decision.strategy === "native") writeNative(scan, decision, out, panels);
  else writeWebview(scan, decision, out, panels);
  if (ui.startsWith("bolt-")) writeBoltStarter(out, scan, decision, ui);
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
  const entry = path.join(out, "cep-to-uxp-entry.js");
  fs.writeFileSync(entry, renderNativeEntry(panels, decision.flyoutItems));
  for (const panel of panels) {
    const htmlPath = path.join(out, panel.mainPath);
    if (!fs.existsSync(htmlPath)) continue;
    const html = fs.readFileSync(htmlPath, "utf8");
    const src = relativeUrl(htmlPath, entry);
    fs.writeFileSync(htmlPath, applySpectrumChrome(injectScripts(html, [src]), scan.bundle.name, decision.design));
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
