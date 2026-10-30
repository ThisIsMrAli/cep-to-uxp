import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { classifyDomain } from "./domains.mjs";
import { SUPPORTED_APPS } from "./hosts.mjs";

const VERSION = /^\d+\.\d+\.\d+$/;

export function validatePlugin(dir) {
  const errors = [];
  const warnings = [];
  const root = path.resolve(dir);
  const manifestPath = path.join(root, "manifest.json");
  const reportPath = path.join(root, "migration-report.json");
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, errors: ["manifest.json is missing"], warnings };
  }
  if (!fs.existsSync(reportPath)) errors.push("migration-report.json is missing");
  if (!fs.existsSync(path.join(root, "MIGRATION.md"))) errors.push("MIGRATION.md is missing");
  if (fs.existsSync(path.join(root, "CSXS"))) errors.push("CSXS/ was copied into the UXP plugin");
  if (findNamed(root, ".env").length || findNamed(root, "node_modules").length) {
    errors.push("node_modules or .env was copied into the plugin");
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { ok: false, errors: [`manifest.json did not parse: ${error.message}`], warnings };
  }
  let report = {};
  try {
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    errors.push(`migration-report.json did not parse: ${error.message}`);
  }

  if (manifest.manifestVersion !== 5) errors.push("manifestVersion must be 5");
  if (!manifest.id || !manifest.name) errors.push("manifest id and name are required");
  if (!VERSION.test(manifest.version || "")) errors.push("manifest version must be x.y.z");
  const mainPath = path.join(root, manifest.main || "");
  if (!manifest.main || !fs.existsSync(mainPath)) errors.push("manifest.main does not exist");

  const hosts = Array.isArray(manifest.host) ? manifest.host : [manifest.host];
  if (Array.isArray(manifest.host)) warnings.push("host is an array. Package one host object per .ccx.");
  for (const host of hosts) {
    if (!host || !SUPPORTED_APPS.includes(host.app)) errors.push(`Unsupported host app: ${host && host.app}`);
    if (!host || !VERSION.test(host.minVersion || "")) errors.push("host.minVersion must be x.y.z");
  }

  const panels = (manifest.entrypoints || []).filter((entry) => entry.type === "panel");
  const commands = (manifest.entrypoints || []).filter((entry) => entry.type === "command");
  if (panels.length + commands.length === 0) errors.push("At least one panel or command entrypoint is required");
  const ids = new Set();
  for (const panel of [...panels, ...commands]) {
    if (!panel.id || !panel.label || !panel.label.default) errors.push("Each panel needs an id and label.default");
    if (ids.has(panel.id)) errors.push(`Duplicate panel id ${panel.id}`);
    ids.add(panel.id);
  }

  const strategy = report.strategy || "webview";
  const migration = fs.existsSync(path.join(root, "MIGRATION.md"))
    ? fs.readFileSync(path.join(root, "MIGRATION.md"), "utf8")
    : "";
  const scripts = report.scan?.evalScripts || [];
  for (const script of scripts) {
    if (!migration.includes(script)) errors.push(`MIGRATION.md does not list evalScript ${script}`);
  }

  const ui = report.ui || "";
  if (ui.startsWith("bolt-")) validateBolt(root, manifest, report, errors);
  else if (strategy === "native" || ui === "native") validateNative(root, manifest, [...panels, ...commands], errors);
  else validateWebview(root, manifest, report, scripts, strategy, errors, warnings);

  for (const file of ["index.js", "host-bridge.js", "host-bridge-core.js", "host-handlers.js", "host-http.js", "host-premiere.js", "cep-to-uxp-entry.js"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    if (/new TextDecoder|new TextEncoder|require\(\s*['"]child_process['"]\s*\)/.test(text)) {
      errors.push(`${file} uses TextDecoder, TextEncoder, or child_process. The UXP host does not provide them.`);
    }
    const checked = spawnSync(process.execPath, ["--check", full], { encoding: "utf8" });
    if (checked.status !== 0) errors.push(`${file} failed node --check: ${checked.stderr || checked.stdout}`);
  }

  checkIcons(manifest, errors);
  for (const name of report.scan?.evalTsNames || []) {
    const covered = migration.includes(name) || (fs.existsSync(path.join(root, "host-handlers.js")) && fs.readFileSync(path.join(root, "host-handlers.js"), "utf8").includes(name));
    if (!covered) errors.push(`evalTS ${name} is neither a host handler nor listed as uncovered`);
  }

  if (report.ui === "retarget") {
    const planPath = path.join(root, "RETARGET.md");
    if (!fs.existsSync(planPath)) errors.push("retarget output is missing RETARGET.md");
    else {
      const plan = fs.readFileSync(planPath, "utf8");
      if (!plan.includes("Do not call the port finished")) {
        errors.push("RETARGET.md does not keep the port unfinished until the host bridge works");
      }
      if (!plan.includes("Do not redraw the component tree in Spectrum")) {
        errors.push("RETARGET.md must keep the existing UI");
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function checkIcons(manifest, errors) {
  const seen = new Set();
  for (const icon of manifest.icons || []) {
    if (!Array.isArray(icon.theme) || icon.theme.length === 0) {
      errors.push("A manifest icon is missing theme. Premiere treats that as a duplicate root icon.");
      continue;
    }
    if (!Array.isArray(icon.species) || !icon.species.includes("generic")) {
      errors.push("A manifest icon must set species to generic.");
    }
    for (const theme of icon.theme) {
      if (seen.has(theme)) errors.push(`Two manifest icons use the theme ${theme}.`);
      seen.add(theme);
    }
  }
}

function validateBolt(root, manifest, report, errors) {
  const migration = fs.existsSync(path.join(root, "MIGRATION.md"))
    ? fs.readFileSync(path.join(root, "MIGRATION.md"), "utf8")
    : "";
  if (!migration.includes("Do not load `bolt/`")) errors.push("MIGRATION.md must say to load this folder, not bolt/");
  if (manifest.requiredPermissions?.webview) errors.push("A bolt plugin must not request WebView permission");
  if (fs.existsSync(path.join(root, "webview"))) errors.push("A bolt plugin must not include a webview folder");
  const html = manifest.main && fs.existsSync(path.join(root, manifest.main))
    ? fs.readFileSync(path.join(root, manifest.main), "utf8")
    : "";
  if (html.includes("<webview")) errors.push("A bolt plugin must not contain a <webview> element");
  const plan = path.join(root, "bolt", "PORT.md");
  if (!fs.existsSync(plan)) errors.push("bolt/PORT.md is missing");
  else if (!fs.readFileSync(plan, "utf8").includes("Do not drop a visible control")) {
    errors.push("bolt/PORT.md must keep every visible CEP control");
  }
  const entry = path.join(root, "cep-to-uxp-entry.js");
  if (!fs.existsSync(entry) || !fs.readFileSync(entry, "utf8").includes("entrypoints.setup")) {
    errors.push("Bolt output is missing cep-to-uxp-entry.js");
  }
  if (!fs.existsSync(path.join(root, "bolt", "cep-src"))) errors.push("bolt/cep-src is missing");
  const vite = path.join(root, "bolt", "vite.config.ts");
  if (!fs.existsSync(vite) || !fs.readFileSync(vite, "utf8").includes("modulePreload: false")) {
    errors.push("bolt/vite.config.ts must set modulePreload to false");
  }
  const compat = path.join(root, "uxp-compat.js");
  if (!fs.existsSync(compat)) errors.push("uxp-compat.js is missing");
  else {
    const checked = spawnSync(process.execPath, ["--check", compat], { encoding: "utf8" });
    if (checked.status !== 0) errors.push(`uxp-compat.js failed node --check: ${checked.stderr || checked.stdout}`);
    const source = fs.readFileSync(compat, "utf8");
    for (const needle of ["IntersectionObserver", "ResizeObserver", "createTreeWalker", "NodeFilter", "currentColor"]) {
      if (!source.includes(needle)) errors.push(`uxp-compat.js is missing ${needle}`);
    }
  }
  if (!html.includes('src="uxp-compat.js"')) errors.push("index.html must load uxp-compat.js before the bundle");
  if (!fs.existsSync(path.join(root, "bolt", "uxp-tailwind.cjs"))) errors.push("bolt/uxp-tailwind.cjs is missing");
  if (!fs.existsSync(path.join(root, "bolt", "patch-react-doc.mjs"))) errors.push("bolt/patch-react-doc.mjs is missing");
  const planText = fs.existsSync(plan) ? fs.readFileSync(plan, "utf8") : "";
  if (!planText.includes("Radix")) errors.push("bolt/PORT.md must warn off Radix dialogs in the UXP document");
}

function validateNative(root, manifest, panels, errors) {
  if (manifest.requiredPermissions?.webview) {
    errors.push("A native panel must not request WebView permission");
  }
  const entry = path.join(root, "cep-to-uxp-entry.js");
  if (!fs.existsSync(entry)) errors.push("cep-to-uxp-entry.js is missing");
  const source = fs.existsSync(entry) ? fs.readFileSync(entry, "utf8") : "";
  if (!source.includes("entrypoints.setup")) errors.push("Native entry does not call entrypoints.setup");
  const html = manifest.main && fs.existsSync(path.join(root, manifest.main))
    ? fs.readFileSync(path.join(root, manifest.main), "utf8")
    : "";
  if (!html.includes("cep-to-uxp-entry.js")) errors.push("Panel HTML does not load cep-to-uxp-entry.js");
  for (const panel of panels) {
    if (!source.includes(panel.id)) errors.push(`Native entry is missing panel ${panel.id}`);
  }
  for (const file of findNamed(root, "CSInterface.js")) {
    const text = fs.readFileSync(file, "utf8");
    if (text.includes("uxpHost")) errors.push(`${path.relative(root, file)} is the WebView shim inside a native build`);
  }
}

function validateWebview(root, manifest, report, scripts, strategy, errors, warnings) {
  const webview = manifest.requiredPermissions?.webview;
  if (!webview) {
    errors.push("WebView permission is missing");
    return;
  }
  if (webview.allow !== undefined && webview.allow !== "yes") errors.push('webview.allow must be "yes" when present');
  if (webview.allow === undefined) {
    warnings.push('webview.allow is omitted. Older UXP 8 hosts still expect "yes".');
  }
  if (webview.allowLocalRendering !== "yes") errors.push('webview.allowLocalRendering must be "yes" to load plugin:/ HTML');
  if (!["localOnly", "localAndRemote"].includes(webview.enableMessageBridge)) {
    errors.push("webview.enableMessageBridge must be localOnly or localAndRemote");
  }
  checkDomains(webview.domains, "webview.domains", errors);
  checkDomains(manifest.requiredPermissions.network?.domains, "network.domains", errors);
  const filesystem = manifest.requiredPermissions.localFileSystem;
  if (filesystem && !["plugin", "request", "fullAccess"].includes(filesystem)) {
    errors.push(`Unexpected localFileSystem value ${filesystem}`);
  }

  const shell = fs.existsSync(path.join(root, manifest.main))
    ? fs.readFileSync(path.join(root, manifest.main), "utf8")
    : "";
  const index = fs.existsSync(path.join(root, "index.js")) ? fs.readFileSync(path.join(root, "index.js"), "utf8") : "";
  if (!index.includes("entrypoints.setup")) errors.push("index.js does not call entrypoints.setup");
  if (!index.includes("bridge.mount")) errors.push("index.js does not mount a WebView");
  for (const panel of report.panels || []) {
    if (!index.includes(panel.id)) errors.push(`index.js is missing panel ${panel.id}`);
    if (!panel.src || !fs.existsSync(pluginToDisk(root, panel.src))) {
      errors.push(`WebView source is missing for ${panel.src}`);
    }
  }
  const docked = (report.panels || []).filter((panel) => panel.kind !== "command");
  if (docked.length <= 1 && !shell.includes("<webview")) {
    errors.push("The shell HTML has no <webview> element");
  }
  if ((report.decision?.design || "spectrum") === "spectrum" && !shell.includes("<sp-heading")) {
    errors.push("Spectrum design is missing <sp-heading> in the UXP shell");
  }

  const shimCandidates = [
    ...findNamed(root, "CSInterface.js"),
    ...findNamed(root, "cep-to-uxp-shim.js")
  ].filter((file) => file.includes(`${path.sep}webview${path.sep}`));
  if (shimCandidates.length === 0) errors.push("The WebView CSInterface shim is missing");
  for (const file of shimCandidates) {
    if (!fs.readFileSync(file, "utf8").includes("uxpHost.postMessage")) {
      errors.push(`${path.relative(root, file)} does not post messages to window.uxpHost`);
    }
  }
  const boots = findNamed(root, "cep-to-uxp-boot.js");
  if (boots.length === 0) errors.push("cep-to-uxp-boot.js is missing");
  if (!fs.existsSync(path.join(root, "host-bridge-core.js"))) errors.push("host-bridge-core.js is missing");
  const handlers = path.join(root, "host-handlers.js");
  const handlerText = fs.existsSync(handlers) ? fs.readFileSync(handlers, "utf8") : "";
  if (!handlerText.includes("evalExtendScript")) errors.push("host-handlers.js is missing evalExtendScript");
  for (const script of scripts) {
    if (!handlerText.includes(JSON.stringify(script))) errors.push(`host-handlers.js has no stub for ${script}`);
  }
  if (strategy === "hybrid" && !fs.readFileSync(path.join(root, "MIGRATION.md"), "utf8").includes("Hybrid plugin required")) {
    errors.push("Hybrid output is missing the hybrid section in MIGRATION.md");
  }
}

function checkDomains(value, label, errors) {
  if (value == null) return;
  const list = Array.isArray(value) ? value : [value];
  for (const domain of list) {
    const result = classifyDomain(domain);
    if (!result.ok) errors.push(`${label}: ${result.reason}`);
  }
}

function pluginToDisk(root, src) {
  return path.join(root, src.replace(/^plugin:\//, ""));
}

function findNamed(root, name, found = []) {
  if (!fs.existsSync(root)) return found;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.name === name) found.push(full);
    if (entry.isDirectory() && entry.name !== name && entry.name !== "node_modules") {
      findNamed(full, name, found);
    }
  }
  return found;
}
