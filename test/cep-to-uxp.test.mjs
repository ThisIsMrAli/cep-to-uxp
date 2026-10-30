import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { classifyDomain, extractOrigins, withCompanionOrigins } from "../.claude/skills/cep-to-uxp/scripts/lib/domains.mjs";
import { buildCoverage } from "../.claude/skills/cep-to-uxp/scripts/lib/coverage.mjs";
import { extractDocFacts, mergeDocFacts } from "../.claude/skills/cep-to-uxp/scripts/lib/docs.mjs";
import { mapCepHost } from "../.claude/skills/cep-to-uxp/scripts/lib/hosts.mjs";
import { extractEvalScripts, extractEvalTsNames, extractFlyoutItems, frameworksFromSource, FRAMEWORK_PACKAGES, collectProcessCalls, processNeedsHybrid, scanCep } from "../.claude/skills/cep-to-uxp/scripts/lib/scan.mjs";
import { selectManifestIcons } from "../.claude/skills/cep-to-uxp/scripts/lib/generate.mjs";
import { detectBuild } from "../.claude/skills/cep-to-uxp/scripts/lib/layers.mjs";
import { convertCep } from "../.claude/skills/cep-to-uxp/scripts/lib/convert.mjs";
import { missingLabels, visibleStrings } from "../.claude/skills/cep-to-uxp/scripts/lib/inventory.mjs";
import { suggestUi } from "../.claude/skills/cep-to-uxp/scripts/lib/decide.mjs";
import { validatePlugin } from "../.claude/skills/cep-to-uxp/scripts/lib/validate.mjs";

const require = createRequire(import.meta.url);
const { createRouter } = require("../.claude/skills/cep-to-uxp/scripts/runtime/host-bridge-core.cjs");
const repo = path.resolve(new URL("..", import.meta.url).pathname);
const skill = path.join(repo, ".claude/skills/cep-to-uxp");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cep-to-uxp-"));

test.after(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

function fixture(name) {
  return path.join(repo, "fixtures", name);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function contains(dir, needle) {
  const pending = [dir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (fs.readFileSync(full, "utf8").includes(needle)) return true;
    }
  }
  return false;
}

test("domain rules reject top-level wildcards and allow a left-most label", () => {
  assert.equal(classifyDomain("https://*.adobe.com").ok, true);
  assert.equal(classifyDomain("https://www.*").ok, false);
  assert.equal(classifyDomain("https://www.adobe.*").ok, false);
  assert.equal(classifyDomain("https://api.example.com").ok, true);
  assert.equal(classifyDomain("all").broad, true);
});

test("evalScript and flyout extractors keep exact calls and skip templates", () => {
  const found = extractEvalScripts('cs.evalScript("sayHello()"); cs.evalScript(`layer(${name})`);');
  assert.deepEqual(found.exact, ["sayHello()"]);
  assert.equal(found.dynamic.length, 1);
  assert.deepEqual(extractFlyoutItems('<MenuItem Id="refresh" Label="Refresh"/>'), [
    { id: "refresh", label: "Refresh" }
  ]);
});

test("CEP host codes map to documented UXP app ids", () => {
  assert.equal(mapCepHost("PHXS").app, "PS");
  assert.equal(mapCepHost("IDSN").app, "ID");
  assert.equal(mapCepHost("PPRO").app, "premierepro");
  assert.equal(mapCepHost("AME").app, "ame");
  assert.equal(mapCepHost("ILST").status, "blocked");
  assert.equal(mapCepHost("AEFT").status, "blocked");
});

test("router returns one string result and ignores a duplicate id", async () => {
  const replies = [];
  const router = createRouter({
    async evalScript(script) {
      if (script === "sayHello()") return "hello from host";
      throw new Error(`No UXP handler for ExtendScript: ${script}`);
    },
    async openExternal() {
      return "";
    }
  });
  const message = {
    channel: "cep-to-uxp",
    type: "call",
    id: 4,
    method: "evalScript",
    args: { script: "sayHello()" }
  };
  await router(message, (reply) => replies.push(reply));
  await router(message, () => replies.push("duplicate"));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].ok, true);
  assert.equal(replies[0].value, "hello from host");
});

test("WebView shim round-trips evalScript and keeps sync host getters", async () => {
  const shim = fs.readFileSync(path.join(skill, "scripts/runtime/csinterface-shim.js"), "utf8");
  const messageListeners = [];
  const window = {
    devicePixelRatio: 2,
    __CEP_TO_UXP_BOOT__: {
      extensionId: "com.example.vanilla.panel",
      environment: {
        appId: "PHXS",
        appName: "Photoshop",
        appVersion: "unknown",
        appSkinInfo: { panelBackgroundColor: { color: { red: 50 } } }
      },
      paths: { extension: "plugin:/", userData: "plugin-data:/" },
      apiVersion: { major: 11, minor: 0, micro: 0 }
    },
    addEventListener(type, fn) {
      if (type === "message") messageListeners.push(fn);
    },
    deliver(data) {
      for (const fn of messageListeners) fn({ data });
    }
  };
  const router = createRouter({
    async evalScript(script) {
      if (script === "sayHello()") return "hello from host";
      throw new Error(`No UXP handler for ExtendScript: ${script}`);
    },
    async openExternal(url) {
      assert.equal(url, "https://developer.adobe.com/uxp/");
      return "";
    }
  });
  window.uxpHost = {
    postMessage(message) {
      return router(message, (reply) => window.deliver(reply));
    }
  };
  const context = vm.createContext({
    window,
    navigator: { platform: "MacIntel" },
    JSON,
    Promise,
    Error,
    String,
    Number,
    Object
  });
  vm.runInContext(shim, context);
  const cs = new context.window.CSInterface();
  assert.equal(cs.getHostEnvironment().appId, "PHXS");
  assert.equal(cs.getSystemPath(context.window.SystemPath.EXTENSION), "plugin:/");
  assert.equal(JSON.parse(context.window.__adobe_cep__.getHostEnvironment()).appName, "Photoshop");

  let themes = 0;
  cs.addEventListener(context.window.CSInterface.THEME_COLOR_CHANGED_EVENT, () => {
    themes += 1;
  });
  window.deliver({
    channel: "cep-to-uxp",
    type: "host-ready",
    payload: { appVersion: "27.1.0", paths: { extension: "/plugin", userData: "/data" } }
  });
  assert.equal(themes, 1);
  assert.equal(cs.getHostEnvironment().appVersion, "27.1.0");
  assert.equal(cs.getSystemPath(context.window.SystemPath.EXTENSION), "/plugin");

  let result = null;
  cs.evalScript("sayHello()", (value) => {
    result = value;
  });
  cs.openURLInDefaultBrowser("https://developer.adobe.com/uxp/");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result, "hello from host");

  let failure = null;
  cs.evalScript("missing()", (value) => {
    failure = value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(failure, /No UXP handler/);
});

test("vanilla JavaScript CEP becomes a Photoshop WebView plugin", () => {
  const out = path.join(temp, "vanilla");
  const result = convertCep({ input: fixture("vanilla-js"), out, force: true, ui: "keep" });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.strategy, "webview");
  assert.equal(result.report.scan.bundle.nodeEnabled, true);
  assert.deepEqual(result.report.scan.evalScripts, ["sayHello()"]);
  assert.ok(!result.report.scan.evalScripts.includes('SHOULD_NOT_SCAN()'));
  assert.deepEqual(result.report.decision.flyoutItems, [{ id: "refresh", label: "Refresh" }]);

  const manifest = readJson(path.join(out, "manifest.json"));
  assert.equal(manifest.manifestVersion, 5);
  assert.equal(manifest.id, "com.example.vanilla");
  assert.equal(manifest.version, "1.2.3");
  assert.deepEqual(manifest.host, { app: "PS", minVersion: "26.0.0" });
  assert.equal(manifest.entrypoints[0].id, "com.example.vanilla.panel");
  assert.deepEqual(manifest.entrypoints[0].preferredDockedSize, { width: 280, height: 420 });
  assert.equal(manifest.requiredPermissions.webview.allowLocalRendering, "yes");
  assert.equal(manifest.requiredPermissions.webview.enableMessageBridge, "localAndRemote");
  assert.ok(manifest.requiredPermissions.webview.domains.includes("https://developer.adobe.com"));
  assert.deepEqual(manifest.requiredPermissions.launchProcess.schemes, ["https"]);
  assert.equal(manifest.requiredPermissions.localFileSystem, "plugin");

  const page = fs.readFileSync(path.join(out, "webview/index.html"), "utf8");
  assert.ok(page.indexOf("cep-to-uxp-boot.js") < page.indexOf("CSInterface.js"));
  assert.equal(
    fs.readFileSync(path.join(out, "webview/js/CSInterface.js"), "utf8"),
    fs.readFileSync(path.join(skill, "scripts/runtime/csinterface-shim.js"), "utf8")
  );
  assert.match(fs.readFileSync(path.join(out, "webview/cep-to-uxp-boot.js"), "utf8"), /"appId": "PHXS"/);
  assert.match(fs.readFileSync(path.join(out, "index.js"), "utf8"), /Refresh/);
  assert.match(fs.readFileSync(path.join(out, "host-handlers.js"), "utf8"), /sayHello\(\)/);
  assert.match(fs.readFileSync(path.join(out, "index.html"), "utf8"), /plugin:\/webview\/index\.html/);
  assert.equal(fs.existsSync(path.join(out, "webview/css/style.css")), true);
  assert.equal(fs.existsSync(path.join(out, "legacy-extendscript/jsx/host.jsx")), true);
  assert.equal(fs.existsSync(path.join(out, "webview/node_modules")), false);
  assert.equal(contains(out, "fixture-secret"), false);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

test("React CEP stays in a WebView and drops Illustrator", () => {
  const out = path.join(temp, "react");
  const result = convertCep({ input: fixture("react-panel"), out, force: true, ui: "keep" });
  assert.equal(result.report.strategy, "webview");
  assert.deepEqual(result.report.scan.frameworks, ["react"]);
  assert.deepEqual(result.report.scan.browserLibs, ["jquery"]);
  assert.ok(result.report.decision.warnings.some((warning) => /Illustrator/.test(warning)));
  assert.ok(result.report.decision.warnings.some((warning) => /localStorage/.test(warning)));
  assert.deepEqual(result.report.scan.evalScripts, ['exportSelection("png")']);
  const manifest = readJson(path.join(out, "manifest.json"));
  assert.equal(manifest.host.app, "PS");
  assert.ok(manifest.requiredPermissions.webview.domains.includes("https://api.example.com"));
  assert.ok(manifest.requiredPermissions.network.domains.includes("https://api.example.com"));
  assert.equal(fs.existsSync(path.join(out, "webview/package.json")), false);
  assert.equal(fs.existsSync(path.join(out, "webview/src/App.jsx")), true);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

test("child_process CEP is scaffolded as a hybrid WebView plugin", () => {
  const out = path.join(temp, "hybrid");
  const result = convertCep({ input: fixture("node-hybrid"), out, force: true, ui: "keep" });
  assert.equal(result.report.strategy, "hybrid");
  const manifest = readJson(path.join(out, "manifest.json"));
  assert.deepEqual(manifest.host, { app: "premierepro", minVersion: "25.6.0" });
  assert.equal(manifest.requiredPermissions.webview.enableMessageBridge, "localOnly");
  assert.match(fs.readFileSync(path.join(out, "MIGRATION.md"), "utf8"), /Hybrid plugin required/);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

test("a static CEP page becomes a native UXP panel", () => {
  const out = path.join(temp, "static");
  const result = convertCep({ input: fixture("static-html"), out, force: true, ui: "native" });
  assert.equal(result.report.strategy, "native");
  const manifest = readJson(path.join(out, "manifest.json"));
  assert.equal(manifest.requiredPermissions, undefined);
  const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  assert.match(html, /Hello from CEP/);
  assert.match(html, /cep-to-uxp-entry\.js/);
  assert.equal(html.includes("<webview"), false);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

test("Illustrator-only CEP is reported and not packaged as UXP", () => {
  const out = path.join(temp, "illustrator");
  const result = convertCep({ input: fixture("illustrator-only"), out, force: true, ui: "keep" });
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.strategy, "blocked");
  assert.equal(fs.existsSync(path.join(out, "manifest.json")), false);
  assert.match(fs.readFileSync(path.join(out, "MIGRATION.md"), "utf8"), /Illustrator/);
});

test("--strategy native keeps the CEP page out of a WebView shim", () => {
  const out = path.join(temp, "forced-native");
  const result = convertCep({
    input: fixture("vanilla-js"),
    out,
    force: true,
    ui: "keep",
    strategy: "native"
  });
  assert.equal(result.report.strategy, "native");
  const shim = fs.readFileSync(path.join(out, "js/CSInterface.js"), "utf8");
  assert.equal(shim.includes("uxpHost"), false);
  assert.match(shim, /Native UXP build/);
  assert.match(fs.readFileSync(path.join(out, "MIGRATION.md"), "utf8"), /sayHello\(\)/);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

test("validator rejects a top-level WebView wildcard", () => {
  const out = path.join(temp, "wildcard");
  fs.cpSync(path.join(temp, "vanilla"), out, { recursive: true });
  const manifestPath = path.join(out, "manifest.json");
  const manifest = readJson(manifestPath);
  manifest.requiredPermissions.webview.domains = ["https://www.*"];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const result = validatePlugin(out);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /top-level domain/);
});

test("source stacks are recognized beyond React", () => {
  assert.equal(FRAMEWORK_PACKAGES.vue, "vue");
  assert.equal(FRAMEWORK_PACKAGES["solid-js"], "solid");
  assert.equal(FRAMEWORK_PACKAGES["@angular/core"], "angular");
  assert.equal(FRAMEWORK_PACKAGES.lit, "lit");
  assert.deepEqual(frameworksFromSource("<template></template>", ".vue"), ["vue"]);
  assert.ok(frameworksFromSource('import { createSignal } from "solid-js";').includes("solid"));
  assert.ok(frameworksFromSource("class Panel extends LitElement {}").includes("lit"));
  assert.ok(frameworksFromSource("@Component({\n  selector: 'app'\n})").includes("angular"));
});

test("Vue and TypeScript CEP panels convert to WebView plugins", () => {
  const vueOut = path.join(temp, "vue");
  const vue = convertCep({ input: fixture("vue-panel"), out: vueOut, force: true, ui: "keep" });
  assert.equal(vue.report.strategy, "webview");
  assert.ok(vue.report.scan.frameworks.includes("vue"));
  assert.deepEqual(vue.report.scan.evalScripts, ["listLayers()"]);
  assert.equal(fs.existsSync(path.join(vueOut, "webview/src/App.vue")), true);
  assert.equal(fs.existsSync(path.join(vueOut, "webview/package.json")), false);
  assert.equal(validatePlugin(vueOut).ok, true, validatePlugin(vueOut).errors.join("\n"));

  const tsOut = path.join(temp, "ts");
  const ts = convertCep({ input: fixture("typescript-panel"), out: tsOut, force: true, ui: "keep" });
  assert.equal(ts.report.strategy, "webview");
  assert.ok(ts.report.scan.languages.includes("typescript"));
  assert.equal(readJson(path.join(tsOut, "manifest.json")).host.app, "ID");
  assert.equal(fs.existsSync(path.join(tsOut, "webview/src/panel.ts")), true);
  assert.equal(validatePlugin(tsOut).ok, true, validatePlugin(tsOut).errors.join("\n"));
});

test("the skill folder matches the Agent Skills spec and is linked for other agents", () => {
  const text = fs.readFileSync(path.join(skill, "SKILL.md"), "utf8");
  assert.equal(path.basename(skill), "cep-to-uxp");
  assert.match(text, /^---\nname: cep-to-uxp\n/);
  const frontmatter = text.split("---")[1];
  const description = frontmatter
    .split("\n")
    .filter((line) => line.startsWith("  "))
    .map((line) => line.trim())
    .join(" ");
  assert.ok(description.length > 0 && description.length <= 1024);
  assert.match(frontmatter, /license: MIT/);
  assert.equal(fs.existsSync(path.join(skill, "scripts/scan-cep.mjs")), true);
  assert.equal(fs.existsSync(path.join(skill, "references/stacks.md")), true);
  assert.match(text, /Never pick `--ui`/);
  assert.match(text, /WebView \(last resort/);
  assert.match(text, /Pure UXP \(suggested\)/);
  for (const agent of [".cursor/skills", ".agents/skills", ".codex/skills", ".github/skills"]) {
    const linked = fs.realpathSync(path.join(repo, agent, "cep-to-uxp", "SKILL.md"));
    assert.equal(linked, fs.realpathSync(path.join(skill, "SKILL.md")));
  }
});

test("opening Finder or Explorer is not a hybrid plugin", () => {
  const openers = collectProcessCalls("window.cep.process.createProcess('/usr/bin/open', path);");
  assert.equal(openers[0].opener, true);
  assert.equal(processNeedsHybrid(openers), false);
  const other = collectProcessCalls("window.cep.process.createProcess('/usr/bin/true');");
  assert.equal(processNeedsHybrid(other), true);
});

test("suggested UI prefers native or bolt over WebView", () => {
  assert.equal(suggestUi(scanCep(fixture("static-html"))), "native");
  assert.equal(suggestUi(scanCep(fixture("vanilla-js"))), "native");
  assert.equal(suggestUi(scanCep(fixture("react-panel"))), "bolt-react");
  assert.equal(suggestUi(scanCep(fixture("vue-panel"))), "bolt-vue");
});

test("convert CLI requires --ui and does not pick a mode", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(skill, "scripts/convert.mjs"), "--input", fixture("vanilla-js"), "--out", path.join(temp, "no-ui")],
    { encoding: "utf8" }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--ui/);
});

test("UI inventory flags a CEP label the UXP page dropped", () => {
  const cep = visibleStrings('<button>Credits</button><input placeholder="Describe what you want to happen..." />');
  const uxp = visibleStrings("<button>Send</button>");
  assert.deepEqual(missingLabels(cep, uxp), ["Credits", "Describe what you want to happen..."]);
  assert.deepEqual(missingLabels(cep, visibleStrings(`${cep.map((label) => `<span>${label}</span>`).join("")}`)), []);
});

test("commented evalTS examples are not product features", () => {
  const names = extractEvalTsNames("// evalTS(\"myFunc\")\nexport function run(){ evalTS('gemoInspect'); }\n");
  assert.deepEqual(names, ["gemoInspect"]);
});

test("a Premiere bolt port ships the compat script and names the load folder", () => {
  const out = path.join(temp, "premiere-bolt");
  const result = convertCep({
    input: fixture("node-hybrid"),
    out,
    force: true,
    ui: "bolt-react",
    host: "premierepro"
  });
  assert.equal(result.report.decision.hosts[0].app, "premierepro");
  const html = fs.readFileSync(path.join(out, "index.html"), "utf8");
  assert.ok(html.indexOf("uxp-compat.js") < html.indexOf("cep-to-uxp-entry.js"));
  assert.match(fs.readFileSync(path.join(out, "uxp-compat.js"), "utf8"), /_observer = this/);
  assert.match(fs.readFileSync(path.join(out, "MIGRATION.md"), "utf8"), /Do not load `bolt\/`/);
  assert.match(fs.readFileSync(path.join(out, "bolt/PORT.md"), "utf8"), /Radix/);
  assert.match(fs.readFileSync(path.join(out, "bolt/uxp-tailwind.cjs"), "utf8"), /class~=/);
  assert.equal(fs.existsSync(path.join(out, "bolt/patch-react-doc.mjs")), true);
  assert.equal(fs.existsSync(path.join(out, "host-premiere.js")), true);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

test("bolt-react is a pure UXP port and does not write a WebView", () => {
  const out = path.join(temp, "bolt");
  const result = convertCep({ input: fixture("vanilla-js"), out, force: true, ui: "bolt-react" });
  assert.equal(result.report.ui, "bolt-react");
  assert.equal(result.report.strategy, "webview");
  assert.equal(fs.existsSync(path.join(out, "webview")), false);
  assert.equal(fs.readFileSync(path.join(out, "index.html"), "utf8").includes("<webview"), false);
  assert.equal(result.report.decision.permissions.webview, undefined);
  assert.equal(fs.existsSync(path.join(out, "bolt/src/main.tsx")), true);
  assert.equal(fs.existsSync(path.join(out, "bolt/cep-src/index.html")), true);
  assert.match(fs.readFileSync(path.join(out, "bolt/PORT.md"), "utf8"), /Do not drop a visible control/);
  assert.match(fs.readFileSync(path.join(out, "bolt/vite.config.ts"), "utf8"), /modulePreload: false/);
  assert.equal(fs.existsSync(path.join(out, "package.json")), false);
  const pkg = readJson(path.join(out, "bolt/package.json"));
  assert.ok(pkg.dependencies.react);
  assert.match(fs.readFileSync(path.join(out, "MIGRATION.md"), "utf8"), /bolt-react/);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

test("a modal CEP extension becomes a Spectrum UXP command", () => {
  const out = path.join(temp, "modal");
  const result = convertCep({ input: fixture("modal-command"), out, force: true, ui: "keep", design: "spectrum" });
  assert.equal(result.report.strategy, "webview");
  const manifest = readJson(path.join(out, "manifest.json"));
  assert.equal(manifest.host.app, "ame");
  assert.equal(manifest.entrypoints[0].type, "command");
  assert.equal(manifest.entrypoints[0].label.default, "Export Queue");
  const shell = fs.readFileSync(path.join(out, "index.html"), "utf8");
  assert.match(shell, /<sp-heading>/);
  assert.match(shell, /<dialog/);
  assert.match(fs.readFileSync(path.join(out, "index.js"), "utf8"), /uxpShowModal/);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

test("preserve keeps the UXP shell free of Spectrum widgets", () => {
  const out = path.join(temp, "preserve");
  convertCep({ input: fixture("vanilla-js"), out, force: true, ui: "keep", design: "preserve" });
  const shell = fs.readFileSync(path.join(out, "index.html"), "utf8");
  assert.equal(shell.includes("<sp-heading>"), false);
  assert.match(shell, /<webview/);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

test("coverage names Node packages and JSX the WebView cannot run", () => {
  const items = buildCoverage({
    extendscript: [{ file: "jsx/host.jsx", functions: ["exportQueue"] }],
    evalScripts: ["exportQueue()"],
    dynamicEvalScripts: [],
    nodeBuiltins: ["fs", "http"],
    npmPackages: ["feedparser", "socket.io"],
    nativeAddons: [],
    nodeServer: true
  });
  const uncovered = items.filter((item) => item.status === "uncovered").map((item) => item.name);
  assert.ok(uncovered.includes("jsx/host.jsx"));
  assert.ok(uncovered.includes("exportQueue()"));
  assert.ok(uncovered.includes("feedparser"));
  assert.ok(uncovered.includes("socket.io"));
  assert.ok(uncovered.includes("listen"));
  assert.equal(items.find((item) => item.name === "fs").status, "rewrite");
});

test("doc refresh extracts host ids without treating prose as an app id", () => {
  const facts = extractDocFacts('Use "premierepro" and {"app":"PS"}. Illustrator is mentioned but not as an id.');
  assert.ok(facts.apps.includes("premierepro"));
  assert.ok(facts.apps.includes("PS"));
  assert.equal(facts.apps.includes("Illustrator"), false);
  const limits = extractDocFacts("text-transform is not supported. CSS Grid Layout is not available.");
  assert.ok(limits.limits.includes("text-transform"));
  assert.ok(limits.limits.includes("css-grid"));
  const merged = mergeDocFacts([
    { ok: true, facts },
    { ok: false, facts: { apps: ["AE"] } }
  ]);
  assert.equal(merged.apps.includes("AE"), false);
});

test("scan CLI prints JSON", () => {
  const result = spawnSync(process.execPath, [path.join(skill, "scripts/scan-cep.mjs"), "--input", fixture("static-html")], {
    cwd: repo,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.bundle.id, "com.example.static");
});

test("fetched origins stay and xmlns or documentation links do not", () => {
  const text = [
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    'fetch("https://api.example.com/v1/items");',
    "see https://reactjs.org/docs/error-decoder.html",
    '<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">'
  ].join("\n");
  const origins = withCompanionOrigins(extractOrigins(text, { markup: true }));
  assert.ok(origins.includes("https://api.example.com"));
  assert.ok(origins.includes("https://fonts.googleapis.com"));
  assert.ok(origins.includes("https://fonts.gstatic.com"));
  assert.equal(origins.includes("http://www.w3.org"), false);
  assert.equal(origins.includes("https://reactjs.org"), false);
});

test("a Node preload and JSXBIN are reported instead of an empty scan", () => {
  const cep = path.join(temp, "preload-cep");
  const build = path.join(cep, "build");
  fs.mkdirSync(path.join(build, "CSXS"), { recursive: true });
  fs.mkdirSync(path.join(build, "extendscript"), { recursive: true });
  fs.mkdirSync(path.join(cep, "public", "CSXS"), { recursive: true });
  fs.mkdirSync(path.join(cep, "src"), { recursive: true });
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<ExtensionManifest ExtensionBundleId="com.example.preload" ExtensionBundleVersion="1.0.0" Version="11.0">
  <ExtensionList><Extension Id="com.example.preload" Version="1.0.0"/></ExtensionList>
  <ExecutionEnvironment>
    <HostList><Host Name="PPRO" Version="[14.0,99.9]"/></HostList>
    <RequiredRuntimeList><RequiredRuntime Name="CSXS" Version="11.0"/></RequiredRuntimeList>
  </ExecutionEnvironment>
  <DispatchInfoList>
    <Extension Id="com.example.preload">
      <DispatchInfo>
        <Resources><MainPath>./index.html</MainPath><CEFCommandLine><Parameter>--enable-nodejs</Parameter></CEFCommandLine></Resources>
        <UI><Type>Panel</Type><Menu>Preload</Menu><Geometry><Size><Width>400</Width><Height>300</Height></Size></Geometry></UI>
      </DispatchInfo>
    </Extension>
  </DispatchInfoList>
</ExtensionManifest>`;
  fs.writeFileSync(path.join(build, "CSXS", "manifest.xml"), manifest);
  fs.writeFileSync(path.join(cep, "public", "CSXS", "manifest.xml"), manifest.replace("com.example.preload", "com.example.public"));
  fs.writeFileSync(path.join(build, "extendscript", "json.jsx"), "@JSXBIN@ES@2.0@not-real-jsx");
  fs.writeFileSync(path.join(cep, "src", "calls.js"), "evalExtendscript(content); evalExtendscript(`$._subtitle.importSrt(${JSON.stringify(path)})`);");
  fs.writeFileSync(
    path.join(build, "index.html"),
    '<!doctype html><html><head><script src="./BUNDLE.js"></script></head><body><div id="root"></div><script src="./app.js"></script></body></html>'
  );
  const preload = `${"/*".padEnd(1_600_000, "x")}\nwindow.fs = require('fs');\nwindow.path = require('path');\nwindow.child_process = require('child_process');\n`;
  fs.writeFileSync(path.join(build, "BUNDLE.js"), preload);
  fs.writeFileSync(path.join(build, "app.js"), "document.getElementById('root').innerHTML = '<div class=\"App\"></div>';");
  const scanned = scanCep(cep);
  assert.equal(path.basename(scanned.input), "build");
  assert.equal(scanned.extendscript.some((file) => file.file.endsWith("json.jsx") && file.jsxbin), true);
  assert.ok(scanned.largeFiles.some((file) => file.file.endsWith("BUNDLE.js")));
  assert.ok(scanned.dynamicEvalScripts.includes("$._subtitle.importSrt(path, time)"));
  assert.ok(scanned.dynamicEvalScripts.includes("evalExtendscript(content)"));
  const out = path.join(temp, "preload-uxp");
  const result = convertCep({ input: build, out, force: true, ui: "keep", design: "spectrum", host: "premierepro" });
  const migration = fs.readFileSync(path.join(out, "MIGRATION.md"), "utf8");
  assert.equal(result.report.strategy, "webview");
  assert.equal(migration.includes("No ExtendScript, Node package, or server API was left uncovered."), false);
  assert.match(migration, /json\.jsx/);
  assert.match(migration, /JSXBIN/);
  assert.match(migration, /A hybrid addon was not built/);
  const page = fs.readFileSync(path.join(out, "webview", "index.html"), "utf8");
  assert.doesNotMatch(page, /<script\b[^>]*\bsrc\s*=\s*['"][^'"]*BUNDLE\.js['"]/i);
  const boot = fs.readFileSync(path.join(out, "webview", "cep-to-uxp-boot.js"), "utf8");
  assert.match(boot, /join/);
  assert.match(boot, /readFileSync/);
  assert.match(boot, /localStorage/);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

const subtitleBuild = "/Users/ali/Work/Letsmotion/subtitle/build";

test(
  "Letsmotion subtitle build keeps the React root mounted",
  { skip: fs.existsSync(subtitleBuild) ? false : "subtitle fixture is not on this machine", timeout: 120000 },
  () => {
    const out = path.join(temp, "subtitle-uxp");
    const result = convertCep({
      input: subtitleBuild,
      out,
      force: true,
      ui: "keep",
      design: "spectrum",
      host: "premierepro"
    });
    assert.equal(result.report.strategy, "webview");
    const manifest = readJson(path.join(out, "manifest.json"));
    assert.deepEqual(manifest.host, { app: "premierepro", minVersion: "25.6.0" });
    assert.equal(manifest.manifestVersion, 5);
    assert.equal(manifest.requiredPermissions.localFileSystem, "fullAccess");
    const domains = manifest.requiredPermissions.webview.domains;
    assert.ok(domains.includes("https://fonts.googleapis.com"));
    assert.ok(domains.includes("https://fonts.gstatic.com"));
    assert.ok(domains.includes("https://error-logger.dash.uxplugins.com"));
    assert.equal(domains.includes("http://www.w3.org"), false);
    const migration = fs.readFileSync(path.join(out, "MIGRATION.md"), "utf8");
    assert.equal(migration.includes("No ExtendScript, Node package, or server API was left uncovered."), false);
    assert.match(migration, /Not converted: After Effects/);
    for (const name of ["json.jsx", "premiere.jsx", "aftereffects.jsx"]) {
      assert.match(migration, new RegExp(name));
      const copied = path.join(out, "legacy-extendscript", "extendscript", name);
      assert.equal(fs.existsSync(copied), true);
      if (fs.readFileSync(copied, "utf8").startsWith("@JSXBIN@")) {
        assert.match(migration, new RegExp(`${name}\` \\(jsx\\): This file is JSXBIN`));
      }
    }
    for (const call of [
      "evalExtendscript(content)",
      "$._subtitle.importSrt(path, time)",
      "$._subtitle.importMogrt(rows, firstChunk)",
      "$._subtitle.checkReApplyMarkers(rows)",
      "$._subtitle.reApplyMarkers(rows)",
      "$._subtitle.checkFetchMarkers()",
      "app.project.activeSequence.getPlayerPosition().seconds",
      "Folder.selectDlg('Select a folder to export subtitle.')"
    ]) {
      assert.ok(migration.includes(call), call);
    }
    for (const name of ["fs", "path", "os", "child_process", "localStorage", "window.Aesp"]) {
      assert.ok(migration.includes(name), name);
    }
    for (const pack of [
      "translatte",
      "chardet",
      "temp",
      "mkdirp",
      "appdata-path",
      "youtube-captions-scraper",
      "recursive-readdir",
      "open-file-explorer",
      "glob",
      "rimraf",
      "youtube-subtitles-downloader"
    ]) {
      assert.ok(migration.includes(pack), pack);
    }
    assert.match(migration, /A hybrid addon was not built/);
    assert.match(migration, /Those values are not saved/);
    assert.match(migration, /panel stays unlicensed/);
    assert.match(migration, /WebView inspector/);
    const page = fs.readFileSync(path.join(out, "webview", "index.html"), "utf8");
    assert.doesNotMatch(page, /<script\b[^>]*\bsrc\s*=\s*['"][^'"]*BUNDLE\.js['"]/i);
    assert.doesNotMatch(page, /<script\b[^>]*\bsrc\s*=\s*['"]plugin:/i);
    assert.match(fs.readFileSync(path.join(out, "index.html"), "utf8"), /<sp-heading>/);
    const boot = fs.readFileSync(path.join(out, "webview", "cep-to-uxp-boot.js"), "utf8");
    assert.match(boot, /join/);
    assert.match(boot, /readFileSync/);
    assert.match(boot, /localStorage/);
    assert.match(boot, /Aesp/);
    const handlers = fs.readFileSync(path.join(out, "host-handlers.js"), "utf8");
    assert.equal(handlers.includes("@JSXBIN@"), false);
    assert.equal(handlers.includes("activeSequence"), false);
    assert.equal(handlers.includes("$._subtitle"), false);
    assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));

    const probe = spawnSync(
      process.execPath,
      ["--input-type=module"],
      {
        cwd: repo,
        encoding: "utf8",
        timeout: 60000,
        input: `
          import fs from "node:fs";
          import path from "node:path";
          import { JSDOM } from "jsdom";
          const root = ${JSON.stringify(path.join(out, "webview"))};
          const main = fs.readdirSync(path.join(root, "static/js")).find((name) => /^main\\..+\\.js$/.test(name) && !name.endsWith(".map"));
          let fsThrew = false;
          process.on("unhandledRejection", (reason) => {
            if (String(reason && reason.message).includes("Node fs.")) fsThrew = true;
            else {
              console.error(reason);
              process.exit(1);
            }
          });
          const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
            url: "https://plugin.invalid/webview/index.html",
            runScripts: "dangerously",
            pretendToBeVisual: true,
            beforeParse(window) {
              Object.defineProperty(window, "localStorage", {
                configurable: true,
                get() { throw new Error("localStorage blocked"); }
              });
            }
          });
          dom.window.eval(fs.readFileSync(path.join(root, "cep-to-uxp-boot.js"), "utf8"));
          dom.window.eval(fs.readFileSync(path.join(root, "cep-to-uxp-shim.js"), "utf8"));
          dom.window.eval(fs.readFileSync(path.join(root, "static/js", main), "utf8"));
          setTimeout(() => {
            const node = dom.window.document.getElementById("root");
            const html = node ? node.innerHTML : "";
            console.log(JSON.stringify({ app: html.includes('class="App"'), length: html.length, fsThrew }));
            process.exit(0);
          }, 50);
        `
      }
    );
    assert.equal(probe.status, 0, `${probe.stdout}\n${probe.stderr}`);
    const mounted = JSON.parse(probe.stdout.trim().split("\n").pop());
    assert.equal(mounted.app, true);
    assert.ok(mounted.length > 0);
    assert.equal(mounted.fsThrew, true);
  }
);

test("retarget keeps the UI and lists host calls from source", () => {
  const out = path.join(temp, "react-retarget");
  const result = convertCep({
    input: fixture("react-panel"),
    out,
    force: true,
    ui: "retarget",
    design: "spectrum"
  });
  assert.equal(result.report.strategy, "webview");
  assert.equal(result.report.scan.layers.layout, "source-only");
  const plan = fs.readFileSync(path.join(out, "RETARGET.md"), "utf8");
  assert.match(plan, /Do not call the port finished/);
  assert.match(plan, /Do not redraw the component tree in Spectrum/);
  assert.match(plan, /exportSelection/);
  assert.match(plan, /App\.jsx/);
  assert.equal(fs.existsSync(path.join(out, "ui-src", "panel", "src", "App.jsx")), true);
  assert.match(fs.readFileSync(path.join(out, "MIGRATION.md"), "utf8"), /RETARGET\.md/);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));

  const vueOut = path.join(temp, "vue-retarget");
  convertCep({ input: fixture("vue-panel"), out: vueOut, force: true, ui: "retarget" });
  assert.match(fs.readFileSync(path.join(vueOut, "RETARGET.md"), "utf8"), /App\.vue/);
  assert.equal(validatePlugin(vueOut).ok, true, validatePlugin(vueOut).errors.join("\n"));
});

test("retarget reads source beside a build snapshot", () => {
  const cep = path.join(temp, "split-cep");
  const build = path.join(cep, "dist");
  fs.mkdirSync(path.join(build, "CSXS"), { recursive: true });
  fs.mkdirSync(path.join(cep, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(build, "CSXS", "manifest.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<ExtensionManifest ExtensionBundleId="com.example.split" ExtensionBundleVersion="1.0.0" Version="11.0">
  <ExtensionList><Extension Id="com.example.split.panel" Version="1.0.0"/></ExtensionList>
  <ExecutionEnvironment>
    <HostList><Host Name="PPRO" Version="[14.0,99.9]"/></HostList>
    <RequiredRuntimeList><RequiredRuntime Name="CSXS" Version="11.0"/></RequiredRuntimeList>
  </ExecutionEnvironment>
  <DispatchInfoList>
    <Extension Id="com.example.split.panel">
      <DispatchInfo>
        <Resources><MainPath>./index.html</MainPath></Resources>
        <UI><Type>Panel</Type><Menu>Split</Menu><Geometry><Size><Width>400</Width><Height>300</Height></Size></Geometry></UI>
      </DispatchInfo>
    </Extension>
  </DispatchInfoList>
</ExtensionManifest>`
  );
  fs.writeFileSync(path.join(build, "index.html"), "<!doctype html><html><body><div id=\"app\"></div><script src=\"./app.js\"></script></body></html>");
  fs.writeFileSync(path.join(build, "app.js"), "/* snapshot */");
  fs.writeFileSync(path.join(cep, "src", "panel.ts"), "export function run(cs){ cs.evalScript('placeMarker()'); }\n");
  fs.writeFileSync(
    path.join(cep, "package.json"),
    JSON.stringify({ scripts: { build: "tsc" }, devDependencies: { typescript: "5.0.0" } })
  );
  const scanned = scanCep(build);
  assert.equal(scanned.layers.layout, "source-and-build");
  assert.ok(scanned.layers.callSites.some((site) => site.summary.includes("placeMarker")));
  assert.equal(scanned.layers.build.tool, "TypeScript");
  const out = path.join(temp, "split-uxp");
  const result = convertCep({ input: build, out, force: true, ui: "retarget", host: "premierepro" });
  assert.equal(result.report.strategy, "webview");
  assert.deepEqual(readJson(path.join(out, "manifest.json")).host, { app: "premierepro", minVersion: "25.6.0" });
  assert.match(fs.readFileSync(path.join(out, "RETARGET.md"), "utf8"), /tsc/);
  assert.equal(fs.existsSync(path.join(out, "ui-src", "src", "panel.ts")), true);
  assert.equal(fs.existsSync(path.join(out, "ui-src", "package.json")), true);
  assert.equal(fs.existsSync(path.join(out, "host-premiere.js")), true);
  assert.equal(fs.existsSync(path.join(out, "host-http.js")), true);
  assert.equal(fs.readFileSync(path.join(out, "host-http.js"), "utf8").includes("new TextDecoder"), false);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
});

test("a panel nested under dist is a snapshot, and rollover icons are not root icons", () => {
  const cep = path.join(temp, "nested-repo");
  const panel = path.join(cep, "dist", "cep");
  fs.mkdirSync(path.join(panel, "CSXS"), { recursive: true });
  fs.mkdirSync(path.join(panel, "icons"), { recursive: true });
  fs.mkdirSync(path.join(cep, "src"), { recursive: true });
  fs.mkdirSync(path.join(cep, "other-panel", "CSXS"), { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  fs.writeFileSync(path.join(panel, "icons", "normal.png"), png);
  fs.writeFileSync(path.join(panel, "icons", "dark.png"), png);
  fs.writeFileSync(
    path.join(panel, "CSXS", "manifest.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<ExtensionManifest ExtensionBundleId="com.example.nested" ExtensionBundleVersion="1.0.0" Version="11.0">
  <ExtensionList><Extension Id="com.example.nested.panel" Version="1.0.0"/></ExtensionList>
  <ExecutionEnvironment>
    <HostList><Host Name="PPRO" Version="[22.0,99.9]"/><Host Name="AEFT" Version="[22.0,99.9]"/></HostList>
    <RequiredRuntimeList><RequiredRuntime Name="CSXS" Version="11.0"/></RequiredRuntimeList>
  </ExecutionEnvironment>
  <DispatchInfoList>
    <Extension Id="com.example.nested.panel">
      <DispatchInfo>
        <Resources>
          <MainPath>./index.html</MainPath>
          <CEFCommandLine><Parameter>--enable-nodejs</Parameter></CEFCommandLine>
        </Resources>
        <UI>
          <Type>Panel</Type><Menu>Nested</Menu>
          <Geometry><Size><Width>400</Width><Height>300</Height></Size></Geometry>
          <Icons>
            <Icon Type="Normal">./icons/normal.png</Icon>
            <Icon Type="DarkNormal">./icons/dark.png</Icon>
            <Icon Type="RollOver">./icons/normal.png</Icon>
            <Icon Type="DarkRollOver">./icons/dark.png</Icon>
          </Icons>
        </UI>
      </DispatchInfo>
    </Extension>
  </DispatchInfoList>
</ExtensionManifest>`
  );
  fs.writeFileSync(path.join(panel, "index.html"), "<!doctype html><html><body><div id=\"root\"></div><script src=\"./bundle.js\"></script></body></html>");
  fs.writeFileSync(path.join(panel, "bundle.js"), "evalTS('createSequence');\n");
  fs.writeFileSync(path.join(cep, "src", "panel.ts"), "export function run(){ evalTS('createSequence'); }\n");
  fs.writeFileSync(
    path.join(cep, "package.json"),
    JSON.stringify({ scripts: { build: "vite-cep build" }, devDependencies: { "vite-cep": "1.0.0", vite: "6.0.0" } })
  );
  fs.writeFileSync(
    path.join(cep, "other-panel", "CSXS", "manifest.xml"),
    fs.readFileSync(path.join(panel, "CSXS", "manifest.xml"), "utf8").replaceAll("com.example.nested", "com.example.other")
  );
  const themes = selectManifestIcons([
    { type: "Normal", path: "a.png" },
    { type: "RollOver", path: "b.png" },
    { type: "DarkNormal", path: "c.png" },
    { type: "DarkRollOver", path: "d.png" }
  ]);
  assert.equal(themes.length, 2);
  assert.ok(themes.every((icon) => icon.species.includes("generic") && icon.theme.length));
  const scanned = scanCep(panel);
  assert.equal(scanned.layers.layout, "source-and-build");
  assert.ok(scanned.layers.sourceRoots.some((root) => root.endsWith(`${path.sep}src`)));
  assert.equal(scanned.layers.sourceRoots.some((root) => root.endsWith(`${path.sep}cep`)), false);
  assert.ok(scanned.otherManifests.some((file) => file.includes("other-panel")));
  assert.deepEqual(scanned.evalTsNames, ["createSequence"]);
  const out = path.join(temp, "nested-uxp");
  const result = convertCep({ input: panel, out, force: true, ui: "retarget", design: "preserve", host: "premierepro" });
  assert.equal(result.report.strategy, "webview");
  assert.equal(fs.existsSync(path.join(out, "ui-src", "src", "panel.ts")), true);
  assert.equal(fs.existsSync(path.join(out, "ui-src", "panel")), false);
  const manifest = readJson(path.join(out, "manifest.json"));
  assert.equal(manifest.icons.length, 2);
  assert.equal(validatePlugin(out).ok, true, validatePlugin(out).errors.join("\n"));
  assert.match(fs.readFileSync(path.join(out, "RETARGET.md"), "utf8"), /plain Vite config/);
  assert.match(fs.readFileSync(path.join(out, "RETARGET.md"), "utf8"), /invokeSync/);
  assert.match(fs.readFileSync(path.join(out, "RETARGET.md"), "utf8"), /crossorigin/);
  assert.match(fs.readFileSync(path.join(out, "index.html"), "utf8"), /#232323/);
  assert.match(fs.readFileSync(path.join(out, "host-bridge.js"), "utf8"), /#232323/);
  assert.match(fs.readFileSync(path.join(out, "webview/cep-to-uxp-shim.js"), "utf8"), /invokeSync/);
  const pluginPkg = path.join(temp, "vite-cep-plugin-pkg");
  fs.mkdirSync(pluginPkg, { recursive: true });
  fs.writeFileSync(
    path.join(pluginPkg, "package.json"),
    JSON.stringify({
      scripts: { build: "vite build" },
      devDependencies: { "vite-cep-plugin": "1.0.0", tailwindcss: "3.4.0" }
    })
  );
  const build = detectBuild(pluginPkg);
  assert.equal(build.viteCep, true);
  assert.equal(build.usesTailwind, true);
  assert.match(fs.readFileSync(path.join(out, "MIGRATION.md"), "utf8"), /other-panel/);
  const { decodeUtf8 } = require(path.join(skill, "scripts/runtime/host-http.cjs"));
  const pending = [];
  assert.equal(decodeUtf8([0x63, 0x61, 0x66, 0xc3], pending), "caf");
  assert.equal(decodeUtf8([0xa9], pending), "é");
});


