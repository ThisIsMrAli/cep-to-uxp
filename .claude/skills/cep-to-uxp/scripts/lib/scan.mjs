import fs from "node:fs";
import path from "node:path";
import { descendants, elements, first, parseXml, textOf } from "./xml.mjs";
import { extractLaunchSchemes, extractOrigins, withCompanionOrigins } from "./domains.mjs";
import { createLayerNotes, discoverSiblingSources, isGeneratedPath, isMinifiedSource, projectRootFor } from "./layers.mjs";
import { mapCepHost } from "./hosts.mjs";

const SKIP_DIRS = new Set(["node_modules", ".git", "CSXS", "csxs"]);
const TEXT_EXT = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".html",
  ".htm",
  ".css",
  ".json",
  ".vue",
  ".svelte",
  ".jsxinc"
]);
const NODE_BUILTINS = new Set([
  "fs",
  "path",
  "os",
  "crypto",
  "http",
  "https",
  "url",
  "stream",
  "buffer",
  "zlib",
  "dns",
  "readline",
  "child_process",
  "net",
  "dgram",
  "cluster",
  "worker_threads",
  "vm",
  "tls",
  "assert",
  "util",
  "events",
  "querystring",
  "punycode",
  "string_decoder",
  "timers",
  "constants",
  "module",
  "process"
]);
export function extractEvalTsNames(text) {
  const code = String(text)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const names = new Set();
  for (const match of code.matchAll(/\bevalTS\s*\(\s*(['"`])([^'"`\n]{1,160})\1/g)) {
    names.add(match[2]);
  }
  return [...names].sort();
}

export const FRAMEWORK_PACKAGES = {
  react: "react",
  "react-dom": "react",
  preact: "preact",
  vue: "vue",
  "vue-router": "vue",
  nuxt: "nuxt",
  svelte: "svelte",
  "@sveltejs/kit": "svelte",
  "@angular/core": "angular",
  "solid-js": "solid",
  lit: "lit",
  "lit-element": "lit",
  alpinejs: "alpine",
  ember: "ember",
  backbone: "backbone",
  knockout: "knockout",
  mithril: "mithril",
  hyperapp: "hyperapp",
  inferno: "inferno",
  riot: "riot",
  "@stencil/core": "stencil",
  polymer: "polymer",
  aurelia: "aurelia",
  "bolt-cep": "bolt-cep"
};
const SOURCE_FRAMEWORKS = [
  [/from\s+['"]vue['"]|\bVue\.createApp\s*\(|\bnew\s+Vue\s*\(/, "vue"],
  [/from\s+['"]svelte['"]/, "svelte"],
  [/from\s+['"]solid-js['"]/, "solid"],
  [/from\s+['"]lit['"]|\bLitElement\b/, "lit"],
  [/from\s+['"]preact['"]/, "preact"],
  [/from\s+['"]react['"]|from\s+['"]react-dom['"]|\bReact\.createElement\s*\(/, "react"],
  [/from\s+['"]@angular\/core['"]|@Component\s*\(\s*\{/, "angular"],
  [/from\s+['"]alpinejs['"]|\bAlpine\.data\s*\(/, "alpine"]
];
const BROWSER_LIBS = [
  "jquery",
  "@mui/material",
  "antd",
  "bootstrap",
  "three",
  "pixi.js",
  "monaco-editor",
  "@codemirror/view",
  "chart.js",
  "gsap",
  "styled-components",
  "@emotion/react",
  "vuetify",
  "element-plus",
  "quasar",
  "primevue",
  "naive-ui",
  "@angular/material",
  "daisyui",
  "react-bootstrap"
];
const BUNDLERS = ["webpack", "vite", "parcel", "rollup", "esbuild", "gulp", "grunt", "browserify", "rspack", "bolt-cep"];
const OPENER_NAMES = new Set(["explorer.exe", "explorer", "open", "xdg-open"]);
const RUNTIME_LIB = /^(CSInterface|Vulcan|CEPEngine_extensions)(\.min)?\.js$/i;
const HYBRID_BUILTINS = new Set(["child_process", "net", "dgram", "cluster", "worker_threads", "vm", "tls"]);
const MAX_TEXT = 1_500_000;
const CHUNK_SIZE = 512 * 1024;
const CHUNK_OVERLAP = 16 * 1024;
const NOTABLE_CALLS = [
  [/evalExtendscript\s*\(\s*content\s*\)/, "evalExtendscript(content)"],
  [/\$\._subtitle\.importSrt\s*\(/, "$._subtitle.importSrt(path, time)"],
  [/\$\._subtitle\.importMogrt\s*\(/, "$._subtitle.importMogrt(rows, firstChunk)"],
  [/\$\._subtitle\.checkReApplyMarkers\s*\(/, "$._subtitle.checkReApplyMarkers(rows)"],
  [/\$\._subtitle\.reApplyMarkers\s*\(/, "$._subtitle.reApplyMarkers(rows)"],
  [/\$\._subtitle\.checkFetchMarkers\s*\(/, "$._subtitle.checkFetchMarkers()"],
  [/getPlayerPosition\s*\(\s*\)\s*\.seconds/, "app.project.activeSequence.getPlayerPosition().seconds"],
  [/selectDlg\s*\(\s*['"]Select a folder to export subtitle\.['"]\s*\)/, "Folder.selectDlg('Select a folder to export subtitle.')"]
];

const SIGNAL_PATTERNS = {
  evalScript: /\.evalScript\s*\(/g,
  csInterface: /\bnew\s+CSInterface\b|\bCSInterface\s*\(/g,
  adobeCep: /__adobe_cep__/g,
  cepFs: /\bcep\.fs\b/g,
  cepProcess: /\bcep\.process\b/g,
  cepEncoding: /\bcep\.encoding\b/g,
  cepUtil: /\bcep\.util\b/g,
  vulcan: /\bVulcanInterface\b/g,
  localStorage: /\blocalStorage\b/g,
  resizeContent: /\.resizeContent\s*\(/g,
  openURL: /\.openURLInDefaultBrowser\s*\(/g,
  flyout: /\.setPanelFlyoutMenu\s*\(/g,
  themeEvent: /ThemeColorChanged/g,
  clipboard: /navigator\.clipboard|execCommand\(\s*['"](?:copy|cut|paste)['"]/g,
  fetchApi: /\bfetch\s*\(|\bXMLHttpRequest\b|\baxios\b|\bWebSocket\s*\(/g,
  codeGeneration: /(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(/g,
  cepInterface: /cep-interface|evalExtendscript\s*\(/g,
  windowFs: /window(?:\.fs|\[['"]fs['"]\])/g,
  windowPath: /window(?:\.path|\[['"]path['"]\])/g,
  windowOs: /window(?:\.os|\[['"]os['"]\])/g,
  windowAesp: /window\.Aesp\b/g
};

export function extractEvalScripts(text) {
  const exact = new Set();
  const dynamic = [];
  const pattern = /\.evalScript\(\s*(['"`])([\s\S]*?)\1/g;
  for (const match of text.matchAll(pattern)) {
    const body = match[2];
    if (!body.trim()) continue;
    const quote = match[1];
    const dynamicCall = quote === "`" && body.includes("${");
    const incomplete = quote !== "`" && !body.trim().endsWith(")");
    if (dynamicCall || incomplete) dynamic.push(body.slice(0, 180));
    else exact.add(body);
  }
  return { exact: [...exact].sort(), dynamic };
}

export function extractFlyoutItems(text) {
  const items = [];
  const seen = new Set();
  const tags = text.match(/<MenuItem\b[^>]*>/g) || [];
  for (const tag of tags) {
    const id = attribute(tag, "Id");
    const label = attribute(tag, "Label");
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, label });
  }
  return items;
}

export function collectProcessCalls(text) {
  const calls = [];
  const pattern = /cep\.process\.([A-Za-z]+)\s*\(\s*(?:(['"])([\s\S]*?)\2)?/g;
  for (const match of text.matchAll(pattern)) {
    const arg = match[3] || "";
    const base = arg.split(/[\\/]/).pop().toLowerCase();
    calls.push({
      method: match[1],
      arg,
      opener: match[1] === "createProcess" && OPENER_NAMES.has(base)
    });
  }
  return calls;
}

export function processNeedsHybrid(calls) {
  return calls.some((call) => !call.opener);
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, "i"));
  return match ? match[2] : "";
}

function normalizeRel(value) {
  if (!value) return "";
  let relative = String(value).trim().replace(/\\/g, "/");
  if (relative.startsWith("./")) relative = relative.slice(2);
  return relative;
}

function normalizeVersion(version) {
  const match = String(version || "").trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return "1.0.0";
  return `${match[1]}.${match[2] || 0}.${match[3] || 0}`;
}

function elementSize(node) {
  if (!node) return null;
  const width = Number(textOf(node, "Width"));
  const height = Number(textOf(node, "Height"));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function relPosix(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function walk(root, onEntry) {
  function visit(directory) {
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          onEntry({ kind: "skipped-dir", name: entry.name, file: full });
          continue;
        }
        visit(full);
      } else if (entry.isFile()) {
        onEntry({ kind: "file", file: full });
      }
    }
  }
  visit(root);
}

function findManifests(root) {
  const found = [];
  function visit(directory, depth) {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (/^manifest\.xml$/i.test(entry.name)) found.push(full);
    }
  }
  visit(root, 0);
  return found.sort((a, b) => a.length - b.length);
}

function otherManifests(projectRoot, chosen) {
  const chosenPath = path.resolve(chosen);
  return findManifests(projectRoot).filter((file) => path.resolve(file) !== chosenPath);
}

function emptySignals() {
  return Object.fromEntries(Object.keys(SIGNAL_PATTERNS).map((key) => [key, 0]));
}

export function frameworksFromSource(text, ext = "") {
  const found = new Set();
  if (ext === ".vue") found.add("vue");
  if (ext === ".svelte") found.add("svelte");
  for (const [pattern, name] of SOURCE_FRAMEWORKS) {
    if (pattern.test(text)) found.add(name);
  }
  return [...found];
}

function readPackageDeps(file, report) {
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies
    };
    for (const name of Object.keys(deps || {})) {
      if (FRAMEWORK_PACKAGES[name]) report.frameworks.add(FRAMEWORK_PACKAGES[name]);
      if (name === "typescript") report.languages.add("typescript");
      if (BROWSER_LIBS.includes(name)) report.browserLibs.add(name);
      if (BUNDLERS.includes(name)) report.bundlers.add(name);
    }
  } catch (error) {
    report.warnings.push(`Could not parse ${file}: ${error.message}`);
  }
}

function isJsxbin(text) {
  return String(text || "").slice(0, 64).includes("@JSXBIN@");
}

function isExtendScript(relative, text, scriptPaths) {
  if (isJsxbin(text)) return true;
  if (/\.jsxinc$/i.test(relative)) return true;
  if (/from\s+['"]react['"]|require\(\s*['"]react['"]\s*\)/.test(text)) return false;
  const posix = relative.replace(/\\/g, "/");
  if (scriptPaths.has(posix)) return true;
  if (/(^|\/)jsx\//i.test(posix)) return true;
  if (/(^|\/)extendscript\/.+\.jsx$/i.test(posix)) return true;
  return /#target\b|charIDToTypeID|stringIDToTypeID|\$\.writeln|app\.activeDocument/.test(text);
}

function extendScriptFunctions(text) {
  if (isJsxbin(text)) return [];
  return [...text.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((match) => match[1]);
}

function isNodePreload(text, base) {
  if (/window\s*(?:\.\s*(?:fs|path|os|Aesp|child_process)|\[['"](?:fs|path|os|Aesp|child_process)['"]\])\s*=\s*require\s*\(/i.test(text)) {
    return true;
  }
  return /^BUNDLE\.js$/i.test(base) && /require\s*\(\s*['"](?:node:)?(?:fs|path|child_process|os)['"]\s*\)/.test(text);
}

function readChunks(file, size) {
  if (size <= MAX_TEXT) {
    return { chunks: [fs.readFileSync(file, "utf8")], chunked: false };
  }
  const chunks = [];
  const fd = fs.openSync(file, "r");
  try {
    let offset = 0;
    while (offset < size) {
      const length = Math.min(CHUNK_SIZE + CHUNK_OVERLAP, size - offset);
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, offset);
      if (n <= 0) break;
      chunks.push(buf.subarray(0, n).toString("utf8"));
      if (offset + n >= size) break;
      offset += CHUNK_SIZE;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { chunks, chunked: true };
}

function siblingRoots(extensionRoot) {
  return discoverSiblingSources(extensionRoot);
}

function noteRequire(spec, preload, state) {
  if (spec.startsWith(".")) {
    if (!spec.includes("../")) return;
    const nested = spec.replace(/^(?:\.\/|\.\.\/)+/, "");
    if (nested && !nested.includes("/") && !nested.includes("\\") && !/\.[a-z0-9]+$/i.test(nested)) {
      state.npmPackages.add(nested);
    }
    return;
  }
  const bare = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
  if (spec.endsWith(".node")) {
    state.nativeAddons.add(spec);
    if (preload) state.hybridNotBuilt = true;
    else state.appHybrid = true;
    return;
  }
  if (NODE_BUILTINS.has(bare) || NODE_BUILTINS.has(spec)) {
    const name = NODE_BUILTINS.has(spec) ? spec : bare;
    state.nodeBuiltins.add(name);
    if (HYBRID_BUILTINS.has(name)) {
      if (preload) state.hybridNotBuilt = true;
      else state.appHybrid = true;
    }
    return;
  }
  state.npmPackages.add(bare);
  if (preload && (bare === "open-file-explorer" || bare === "child_process")) state.hybridNotBuilt = true;
}

function parseManifest(file) {
  const root = parseXml(fs.readFileSync(file, "utf8"));
  if (root.tag !== "ExtensionManifest") {
    throw new Error(`${file} is not an ExtensionManifest`);
  }
  const bundle = {
    id: root.attrs.ExtensionBundleId || "",
    name: root.attrs.ExtensionBundleName || root.attrs.ExtensionBundleId || "CEP Panel",
    version: normalizeVersion(root.attrs.ExtensionBundleVersion),
    cepVersion: "",
    nodeEnabled: false,
    mixedContext: false
  };
  const runtime = descendants(root, "RequiredRuntime").find((node) => node.attrs.Name === "CSXS");
  if (runtime) bundle.cepVersion = runtime.attrs.Version || "";

  const declaredHosts = descendants(root, "Host").map((node) => ({
    ...mapCepHost(node.attrs.Name),
    versionRange: node.attrs.Version || ""
  }));

  const listed = new Map(
    elements(first(root, "ExtensionList"), "Extension").map((node) => [node.attrs.Id, node])
  );
  const extensions = [];
  for (const node of descendants(root, "Extension")) {
    if (!first(node, "DispatchInfo")) continue;
    const id = node.attrs.Id || "";
    const resources = first(first(node, "DispatchInfo"), "Resources");
    const ui = first(first(node, "DispatchInfo"), "UI");
    const geometry = ui ? first(ui, "Geometry") : null;
    const parameters = resources ? descendants(resources, "Parameter").map((item) => textOf(item)) : [];
    if (parameters.some((item) => item === "--enable-nodejs")) bundle.nodeEnabled = true;
    if (parameters.some((item) => item === "--mixed-context")) bundle.mixedContext = true;
    const icons = ui
      ? elements(first(ui, "Icons"), "Icon").map((icon) => ({
          type: icon.attrs.Type || "Normal",
          path: normalizeRel(textOf(icon))
        }))
      : [];
    extensions.push({
      id,
      version: normalizeVersion(node.attrs.Version || listed.get(id)?.attrs.Version || bundle.version),
      type: textOf(ui, "Type") || "Panel",
      menu: textOf(ui, "Menu") || bundle.name,
      mainPath: normalizeRel(textOf(resources, "MainPath")) || "index.html",
      scriptPath: normalizeRel(textOf(resources, "ScriptPath")),
      size: elementSize(geometry && first(geometry, "Size")),
      minSize: elementSize(geometry && first(geometry, "MinSize")),
      maxSize: elementSize(geometry && first(geometry, "MaxSize")),
      icons,
      cef: parameters.filter(Boolean)
    });
  }

  return { bundle, declaredHosts, extensions };
}

function chooseExtension(input) {
  const manifests = findManifests(input);
  if (manifests.length === 0) {
    throw new Error(`No CSXS/manifest.xml found under ${input}`);
  }
  const asRel = (file) => relPosix(input, file);
  const build = manifests.filter((file) => /(^|\/)build\/CSXS\/manifest\.xml$/i.test(asRel(file)));
  const pub = manifests.filter((file) => /(^|\/)public\/CSXS\/manifest\.xml$/i.test(asRel(file)));
  let chosen = manifests;
  let note = "";
  if (build.length && pub.length) {
    const drop = new Set(pub);
    chosen = manifests.filter((file) => !drop.has(file));
    note = "public/CSXS/manifest.xml is the Create React App public folder, not the extension the host loads. Using build/.";
  }
  if (chosen.length !== 1) {
    throw new Error(
      `Found ${chosen.length} CEP manifests. Ask which extension to convert, then pass that folder. Do not merge them:\n${chosen.join("\n")}`
    );
  }
  const manifest = chosen[0];
  let root = input;
  if (/(^|\/)build\/CSXS\/manifest\.xml$/i.test(asRel(manifest)) && path.basename(input) !== "build") {
    root = path.resolve(manifest, "../..");
  }
  return { root, manifest, note };
}

export function scanCep(input) {
  const requested = path.resolve(input);
  if (!fs.existsSync(requested) || !fs.statSync(requested).isDirectory()) {
    throw new Error(`CEP folder not found: ${requested}`);
  }
  const selected = chooseExtension(requested);
  const root = selected.root;
  const parsed = parseManifest(selected.manifest);
  const warnings = [];
  if (selected.note) warnings.push(selected.note);
  const signals = emptySignals();
  const hits = Object.fromEntries(Object.keys(signals).map((key) => [key, []]));
  const frameworks = new Set();
  const languages = new Set();
  const uncompiledEntries = [];
  const browserLibs = new Set();
  const bundlers = new Set();
  const nodeBuiltins = new Set();
  const nativeAddons = new Set();
  const npmPackages = new Set();
  const windowBindings = new Set();
  const notableCalls = new Set();
  const skippedFiles = [];
  const largeFiles = [];
  const preloadNames = new Set();
  let nodeServer = false;
  let appHybrid = false;
  let hybridNotBuilt = false;
  let bundlePresent = false;
  const origins = new Set();
  const launchSchemes = new Set();
  const evalScripts = new Set();
  const evalTsNames = new Set();
  const dynamicEvalScripts = [];
  const flyoutItems = [];
  const extendscript = [];
  const processCalls = [];
  const seenExtendscript = new Set();
  const reportBags = { frameworks, languages, browserLibs, bundlers, warnings };
  const scriptPaths = new Set(parsed.extensions.map((item) => item.scriptPath).filter(Boolean));
  let skippedNodeModules = false;
  let skippedEnv = false;
  const layerNotes = createLayerNotes();
  const linkedSources = siblingRoots(root);
  const state = {
    nodeBuiltins,
    nativeAddons,
    npmPackages,
    get appHybrid() {
      return appHybrid;
    },
    set appHybrid(value) {
      appHybrid = value;
    },
    get hybridNotBuilt() {
      return hybridNotBuilt;
    },
    set hybridNotBuilt(value) {
      hybridNotBuilt = value;
    }
  };

  function absorb(text, relative, base, ext, preload) {
    for (const [name, pattern] of Object.entries(SIGNAL_PATTERNS)) {
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      if (!matches) continue;
      signals[name] += matches.length;
      if (!hits[name].includes(relative)) hits[name].push(relative);
    }
    for (const match of text.matchAll(/require\(\s*['"](?:node:)?([^'"]+)['"]\s*\)/g)) {
      noteRequire(match[1], preload, state);
    }
    for (const match of text.matchAll(/window(?:\.([A-Za-z_$][\w$]*)|\[['"]([^'"]+)['"]\])\s*=\s*require\s*\(/g)) {
      windowBindings.add(match[1] || match[2]);
    }
    if (/\bcreateServer\s*\(/.test(text) || /require\(\s*['"]socket\.io['"]\s*\)/.test(text)) nodeServer = true;
    for (const match of text.matchAll(/from\s+['"](?:node:)?([^'"]+)['"]/g)) {
      const name = match[1];
      if (FRAMEWORK_PACKAGES[name]) frameworks.add(FRAMEWORK_PACKAGES[name]);
      if (NODE_BUILTINS.has(name)) nodeBuiltins.add(name);
      if (!preload && HYBRID_BUILTINS.has(name)) appHybrid = true;
      if (preload && HYBRID_BUILTINS.has(name)) hybridNotBuilt = true;
    }
    if (ext === ".ts" || ext === ".tsx") languages.add("typescript");
    if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) languages.add("javascript");
    for (const name of frameworksFromSource(text, ext)) frameworks.add(name);
    if (/\.html?$/i.test(ext) && /<script\b[^>]*\bsrc\s*=\s*['"][^'"]+\.(?:vue|svelte|tsx|jsx|ts)['"]/i.test(text)) {
      uncompiledEntries.push(relative);
    }
    if (/^jquery([-.].*)?\.js$/i.test(base)) browserLibs.add("jquery");
    if (!preload && !RUNTIME_LIB.test(base)) {
      for (const call of collectProcessCalls(text)) {
        if (processCalls.length < 40) processCalls.push({ ...call, file: relative });
        if (!call.opener) appHybrid = true;
      }
    }
    for (const origin of extractOrigins(text, { markup: /\.(html?|css)$/i.test(ext) })) origins.add(origin);
    for (const scheme of extractLaunchSchemes(text)) launchSchemes.add(scheme);
    const scripts = extractEvalScripts(text);
    for (const script of scripts.exact) evalScripts.add(script);
    for (const script of scripts.dynamic) {
      if (!dynamicEvalScripts.includes(script)) dynamicEvalScripts.push(script);
    }
    for (const name of extractEvalTsNames(text)) evalTsNames.add(name);
    for (const [pattern, label] of NOTABLE_CALLS) {
      if (pattern.test(text)) notableCalls.add(label);
    }
    flyoutItems.push(...extractFlyoutItems(text));
  }

  function inspect(file, relative, insideExtension) {
    const base = path.basename(file);
    if (insideExtension && /^BUNDLE\.js$/i.test(base)) bundlePresent = true;
    if (base === ".env" || base.startsWith(".env.")) {
      skippedEnv = true;
      return;
    }
    if (base === "package.json") readPackageDeps(file, reportBags);
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXT.has(ext)) return;
    let chunks = [];
    let chunked = false;
    try {
      const read = readChunks(file, fs.statSync(file).size);
      chunks = read.chunks;
      chunked = read.chunked;
    } catch (error) {
      skippedFiles.push({
        file: relative,
        reason: `Could not scan ${relative}: ${error.message}`
      });
      return;
    }
    if (chunked) {
      largeFiles.push({ file: relative, bytes: fs.statSync(file).size });
      warnings.push(`Chunk-scanned ${relative} because it is larger than ${MAX_TEXT} bytes.`);
    }
    const preload = chunks.some((chunk) => isNodePreload(chunk, base));
    if (preload) preloadNames.add(base);
    const generated = isGeneratedPath(relative, base) || chunks.some((chunk) => isMinifiedSource(chunk, ext));
    const extendscriptFile =
      insideExtension &&
      /\.(jsx|jsxinc)$/i.test(relative) &&
      chunks.length > 0 &&
      isExtendScript(relative, chunks[0], scriptPaths);
    for (const text of chunks) {
      absorb(text, relative, base, ext, preload);
      layerNotes.observe(relative, ext, text, { generated, extendscript: extendscriptFile, preload });
    }
    if (extendscriptFile) {
      if (seenExtendscript.has(relative)) return;
      seenExtendscript.add(relative);
      const jsxbin = isJsxbin(chunks[0]);
      extendscript.push({
        file: relative,
        jsxbin,
        functions: jsxbin ? [] : [...new Set(extendScriptFunctions(chunks[0]))].sort()
      });
    }
  }

  function walkRoot(directory, insideExtension) {
    walk(directory, (entry) => {
      if (entry.kind === "skipped-dir") {
        if (entry.name === "node_modules") skippedNodeModules = true;
        return;
      }
      const relative = insideExtension ? relPosix(root, entry.file) : relPosix(root, entry.file);
      inspect(entry.file, relative, insideExtension);
    });
  }

  walkRoot(root, true);
  for (const extra of linkedSources) walkRoot(extra, false);

  if (bundlePresent && preloadNames.size) preloadNames.add("BUNDLE.js");
  for (const label of notableCalls) {
    if (!dynamicEvalScripts.includes(label)) dynamicEvalScripts.push(label);
  }
  if (skippedNodeModules) {
    warnings.push("Skipped node_modules. Do not copy it into the UXP plugin. Ship a browser bundle instead.");
  }
  if (skippedEnv) warnings.push("Skipped .env and did not copy it.");

  const dedupedFlyout = [];
  const seenFlyout = new Set();
  for (const item of flyoutItems) {
    if (seenFlyout.has(item.id)) continue;
    seenFlyout.add(item.id);
    dedupedFlyout.push(item);
  }

  const missingAssets = [];
  for (const extension of parsed.extensions) {
    if (extension.mainPath && !fs.existsSync(path.join(root, extension.mainPath))) {
      missingAssets.push({ kind: "main", path: extension.mainPath });
    }
    if (extension.scriptPath && !fs.existsSync(path.join(root, extension.scriptPath))) {
      missingAssets.push({ kind: "script", path: extension.scriptPath });
    }
  }

  return {
    input: root,
    manifestPath: selected.manifest,
    bundle: parsed.bundle,
    hosts: parsed.declaredHosts,
    extensions: parsed.extensions,
    frameworks: [...frameworks].sort(),
    languages: [...languages].sort(),
    uncompiledEntries,
    browserLibs: [...browserLibs].sort(),
    bundlers: [...bundlers].sort(),
    nodeBuiltins: [...nodeBuiltins].sort(),
    nativeAddons: [...nativeAddons].sort(),
    npmPackages: [...npmPackages].sort(),
    nodeServer,
    signals,
    hits,
    origins: withCompanionOrigins(origins),
    launchSchemes: [...launchSchemes].sort(),
    evalScripts: [...evalScripts].sort(),
    evalTsNames: [...evalTsNames].sort(),
    dynamicEvalScripts,
    extendscript,
    flyoutItems: dedupedFlyout,
    processCalls,
    missingAssets,
    preloadScripts: [...preloadNames].sort(),
    renderGuard: preloadNames.size > 0 || signals.windowFs > 0 || signals.windowPath > 0,
    needsAesp: signals.windowAesp > 0,
    skippedFiles,
    largeFiles,
    windowBindings: [...windowBindings].sort(),
    appHybrid,
    hybridNotBuilt,
    layers: layerNotes.finish({
      extensionRoot: root,
      sourceRoots: linkedSources,
      projectRoot: projectRootFor(root),
      snapshot: Boolean(projectRootFor(root) !== root)
    }),
    otherManifests: otherManifests(projectRootFor(root), selected.manifest),
    warnings
  };
}
