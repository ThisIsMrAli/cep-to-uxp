import fs from "node:fs";
import path from "node:path";

export const BUILD_DIR_NAMES = new Set(["build", "dist", "out", "output", "release"]);

const NAMED_SOURCE = new Set([
  "src",
  "app",
  "source",
  "frontend",
  "client",
  "panel",
  "pages",
  "components",
  "jsx",
  "extendscript",
  "host",
  "cep"
]);

const SKIP_SCAN = new Set([
  "node_modules",
  ".git",
  "public",
  "coverage",
  "webview",
  "CSXS",
  "csxs",
  ...BUILD_DIR_NAMES
]);

const CONFIG_FILES = [
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "tsconfig.app.json",
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "webpack.config.js",
  "webpack.config.cjs",
  "svelte.config.js",
  "svelte.config.ts",
  "angular.json",
  "babel.config.js",
  "rollup.config.js"
];

export function isGeneratedPath(relative, base = "") {
  const posix = String(relative || "").replace(/\\/g, "/");
  if (/(^|\/)(build|dist|out|output|release|coverage)\//.test(posix)) return true;
  if (/\/static\/(js|css)\//.test(posix)) return true;
  if (/(^|\/)(?:main|bundle|vendor|chunk)\.[0-9a-f]{6,}\.(?:js|css)$/i.test(posix)) return true;
  if (/(^|\/)BUNDLE\.js$/i.test(posix) || /^BUNDLE\.js$/i.test(base)) return true;
  if (/\.min\.js$/i.test(base || posix)) return true;
  return false;
}

export function isMinifiedSource(text, ext) {
  if ([".jsx", ".jsxinc", ".html", ".htm", ".css", ".vue", ".svelte"].includes(ext)) return false;
  const sample = String(text || "").slice(0, 8000);
  if (sample.length < 5000) return false;
  return sample.split("\n").length < 4;
}

const SKIP_SIBLING = /^(archive|archives|backup|backups|old|vendor|docs|documentation|examples|example|coverage|tmp|temp)$/i;

export function snapshotAncestor(directory) {
  let current = path.resolve(directory);
  const stop = path.parse(current).root;
  while (current && current !== stop) {
    if (BUILD_DIR_NAMES.has(path.basename(current))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

export function projectRootFor(extensionRoot) {
  const snapshot = snapshotAncestor(extensionRoot);
  return snapshot ? path.dirname(snapshot) : extensionRoot;
}

export function discoverSiblingSources(extensionRoot) {
  const snapshot = snapshotAncestor(extensionRoot);
  const parent = snapshot ? path.dirname(snapshot) : path.dirname(extensionRoot);
  if (!snapshot && !BUILD_DIR_NAMES.has(path.basename(extensionRoot))) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || SKIP_SCAN.has(entry.name)) continue;
    if (SKIP_SIBLING.test(entry.name)) continue;
    const full = path.join(parent, entry.name);
    if (NAMED_SOURCE.has(entry.name)) {
      found.push(full);
      continue;
    }
    if (fs.existsSync(path.join(full, "node_modules"))) {
      if (directoryHasAppEntry(full)) found.push(full);
      continue;
    }
    if (directoryLooksLikeSource(full)) found.push(full);
  }
  return found;
}

export function detectBuild(directory) {
  const file = path.join(directory, "package.json");
  if (!fs.existsSync(file)) return null;
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const scripts = pkg.scripts || {};
  const preferred = ["build", "build:prod", "compile", "cep-build", "build:cep"];
  const script = preferred.find((name) => scripts[name]) || Object.keys(scripts).find((name) => /build/i.test(name)) || "";
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  let tool = "the project's compiler";
  if (deps.vite || deps.nuxt) tool = "Vite";
  else if (deps.webpack || deps["webpack-cli"] || deps["bolt-cep"]) tool = "webpack";
  else if (deps["react-scripts"] || deps["create-cep-extension-scripts"]) tool = "the CEP build scripts";
  else if (deps["@angular/cli"] || deps["@angular/core"]) tool = "Angular";
  else if (deps["@sveltejs/kit"] || deps.svelte) tool = "Svelte";
  else if (deps.vue) tool = "Vue";
  else if (deps.typescript) tool = "TypeScript";
  return {
    cwd: directory,
    script,
    command: script ? scripts[script] : "",
    tool,
    viteCep: Boolean(deps["vite-cep"] || deps["@vite-cep"] || /vite-cep/.test(String(scripts[script] || "")))
  };
}

export function createLayerNotes() {
  const files = new Map();
  const callSites = [];
  const seenCalls = new Set();
  return {
    observe(file, ext, text, flags) {
      let row = files.get(file);
      if (!row) {
        row = { file, roles: new Set(), generated: Boolean(flags.generated) };
        files.set(file, row);
      }
      if (flags.generated) row.generated = true;
      for (const role of rolesFor(file, ext, text, flags)) row.roles.add(role);
      if (!row.generated && !flags.preload && callSites.length < 80) {
        for (const site of extractCallSites(file, text)) {
          const key = `${site.file}\0${site.kind}\0${site.summary}`;
          if (seenCalls.has(key)) continue;
          seenCalls.add(key);
          callSites.push(site);
          if (callSites.length >= 80) break;
        }
      }
    },
    finish({ extensionRoot, sourceRoots, projectRoot, snapshot }) {
      const rows = [...files.values()].map((row) => ({
        file: row.file,
        roles: [...row.roles].sort(),
        generated: row.generated
      }));
      const editable = rows.filter((row) => !row.generated);
      const ui = editable.filter((row) => row.roles.includes("ui"));
      const node = editable.filter((row) => row.roles.includes("node"));
      const bridge = editable.filter((row) => row.roles.includes("bridge"));
      const namedBuild = Boolean(snapshot) || BUILD_DIR_NAMES.has(path.basename(extensionRoot));
      const inside = editable.some((row) => !row.file.startsWith(".."));
      let layout = "source-only";
      if (namedBuild && sourceRoots.length) layout = "source-and-build";
      else if (namedBuild && !inside) layout = "build-only";
      const roots = layout === "source-and-build" ? sourceRoots : layout === "source-only" ? [extensionRoot] : [];
      const hasEditableSource = layout !== "build-only" && (ui.length + node.length + bridge.length + callSites.length > 0);
      return {
        layout,
        projectRoot,
        sourceRoots: roots,
        build: detectBuild(projectRoot),
        hasEditableSource,
        ui: ui.slice(0, 40).map((row) => row.file),
        uiCount: ui.length,
        node: node.slice(0, 40).map((row) => row.file),
        nodeCount: node.length,
        bridge: bridge.slice(0, 40).map((row) => row.file),
        callSites
      };
    }
  };
}

export { CONFIG_FILES };

function rolesFor(file, ext, text, flags) {
  const roles = [];
  if (flags.extendscript) roles.push("extendscript");
  if (flags.generated) roles.push("bundle");
  const uiExt = [".vue", ".svelte", ".css", ".scss", ".html", ".htm", ".tsx"];
  if (uiExt.includes(ext) || (ext === ".jsx" && !flags.extendscript)) roles.push("ui");
  if (/from\s+['"](?:react|react-dom|preact|vue|svelte|solid-js|lit|alpinejs)['"]|from\s+['"]@angular\/core['"]/.test(text)) {
    roles.push("ui");
  }
  if (/evalExtendscript\s*\(|\.evalScript\s*\(|\bevalTS\s*\(|\bnew\s+CSInterface\b|\b__adobe_cep__\b|cep-interface/.test(text)) {
    roles.push("bridge");
  }
  if (
    /require\(\s*['"](?:node:)?(?:fs|path|os|child_process|http|https|net|dgram)['"]\s*\)/.test(text) ||
    /\bcep\.fs\b|\bcep\.process\b/.test(text) ||
    /window\.(?:fs|path|os)\s*=\s*require\s*\(/.test(text)
  ) {
    roles.push("node");
  }
  if (!roles.length && [".js", ".mjs", ".cjs", ".ts"].includes(ext) && !flags.generated) roles.push("script");
  return roles;
}

function extractCallSites(file, text) {
  const sites = [];
  const patterns = [
    ["extendscript", /(?:evalExtendscript|\.evalScript|\bevalTS)\s*\(\s*(['"`])([\s\S]{0,180}?)\1/g],
    ["node", /require\(\s*['"](?:node:)?(fs|path|os|child_process|http|https|net|dgram)['"]\s*\)/g],
    ["node", /\bcep\.(?:fs|process)\b/g],
    ["node", /window\.(?:fs|path|os)\s*=\s*require\s*\(/g]
  ];
  for (const [kind, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const summary = (match[2] || match[1] || match[0]).replace(/\s+/g, " ").trim().slice(0, 140);
      if (!summary) continue;
      const line = text.slice(0, match.index).split("\n").length;
      sites.push({ file, kind, summary, line });
    }
  }
  return sites;
}

function directoryHasAppEntry(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (/\.(vue|svelte|tsx)$/.test(entry.name) || /\.jsx$/.test(entry.name)) return true;
    if (!/\.(js|mjs|cjs|ts)$/.test(entry.name)) continue;
    if (sampleHasAppSignal(path.join(dir, entry.name))) return true;
  }
  return false;
}

function sampleHasAppSignal(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(4000);
    const n = fs.readSync(fd, buf, 0, 4000, 0);
    fs.closeSync(fd);
    const sample = buf.toString("utf8", 0, n);
    return /evalScript|evalExtendscript|from\s+['"]react['"]|from\s+['"]vue['"]|require\(\s*['"]fs['"]|window\.fs\s*=/.test(sample);
  } catch {
    return false;
  }
}
function directoryLooksLikeSource(dir, depth = 0) {
  if (depth > 2) return false;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  let seen = 0;
  for (const entry of entries) {
    if (seen++ > 40) break;
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (directoryLooksLikeSource(full, depth + 1)) return true;
      continue;
    }
    if (/\.(vue|svelte|tsx|ts)$/.test(entry.name)) return true;
    if (/\.jsx$/.test(entry.name)) return true;
    if (!/\.(js|mjs|cjs)$/.test(entry.name) || /^CSInterface(?:\.min)?\.js$/i.test(entry.name)) continue;
    try {
      const fd = fs.openSync(full, "r");
      const buf = Buffer.alloc(4000);
      const n = fs.readSync(fd, buf, 0, 4000, 0);
      fs.closeSync(fd);
      const sample = buf.toString("utf8", 0, n);
      if (/evalScript|evalExtendscript|from\s+['"]react['"]|from\s+['"]vue['"]|require\(\s*['"]fs['"]|window\.fs\s*=/.test(sample)) {
        return true;
      }
    } catch {
      // Unreadable files are not source evidence.
    }
  }
  return false;
}
