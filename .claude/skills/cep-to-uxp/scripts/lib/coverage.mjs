const NODE_GUIDE = {
  fs: ["rewrite", "Use the UXP host fs or localFileSystem APIs. The WebView cannot require('fs')."],
  path: ["rewrite", "Build plugin:/ and plugin-data:/ URLs in the host script."],
  os: ["rewrite", "Read require('uxp').host. There is no Node os module."],
  crypto: ["rewrite", "Use Web Crypto in the page, or the crypto API in the current UXP docs."],
  http: ["rewrite", "Use fetch for client requests. http.createServer and listen() are not available."],
  https: ["rewrite", "Use fetch. A Node HTTPS server is not available."],
  url: ["rewrite", "Use the URL class in the WebView or host."],
  stream: ["uncovered", "UXP has no Node stream module."],
  buffer: ["rewrite", "Use Uint8Array. formats.binary covers file bytes."],
  zlib: ["uncovered", "UXP has no Node zlib module."],
  dns: ["uncovered", "UXP has no Node dns module."],
  readline: ["uncovered", "UXP has no Node readline module."],
  child_process: ["uncovered", "UXP cannot spawn a process or pass arguments."],
  net: ["uncovered", "UXP cannot open a raw socket."],
  dgram: ["uncovered", "UXP has no UDP API."],
  cluster: ["uncovered", "UXP has no Node cluster module."],
  worker_threads: ["uncovered", "UXP has no Node worker_threads module."],
  vm: ["uncovered", "UXP will not run Node vm."],
  tls: ["uncovered", "UXP has no Node tls module."]
};

function evalDetail(script) {
  if (script.includes("$._subtitle") || script === "evalExtendscript(content)") {
    return "This call is built at runtime, or it is a whole JSXBIN file passed to evalExtendscript. Leave it as an explicit throw. Do not invent a Premiere DOM for code that exists only in JSXBIN.";
  }
  if (script.includes("getPlayerPosition")) {
    return "Readable ExtendScript. It can become a premierepro handler. No Premiere DOM was generated.";
  }
  if (script.includes("selectDlg")) {
    return "Readable ExtendScript. It can become localFileSystem.getFolder. request permission covers the folder picker only. No handler was generated.";
  }
  return "This script is built at runtime, so no handler stub exists.";
}

export function buildCoverage(scan) {
  const items = [];
  for (const file of scan.extendscript || []) {
    const functions = file.functions?.length ? ` Functions: ${file.functions.join(", ")}.` : "";
    items.push({
      kind: "jsx",
      name: file.file,
      status: "uncovered",
      detail: file.jsxbin
        ? "This file is JSXBIN. UXP cannot run it. There is no function list to extract. It was copied and is not evaluated."
        : `UXP does not execute this ExtendScript file.${functions}`
    });
  }
  for (const script of scan.evalScripts || []) {
    items.push({
      kind: "evalScript",
      name: script,
      status: "uncovered",
      detail: "The bridge delivers this string and the handler throws until it is rewritten with the host UXP API."
    });
  }
  for (const script of scan.dynamicEvalScripts || []) {
    items.push({
      kind: "evalScript",
      name: script,
      status: "uncovered",
      detail: evalDetail(script)
    });
  }
  for (const name of scan.nodeBuiltins || []) {
    const guide = NODE_GUIDE[name] || ["uncovered", "This Node API is not part of UXP."];
    let status = guide[0];
    let detail = guide[1];
    if (scan.renderGuard && (name === "fs" || name === "path" || name === "os")) {
      status = "uncovered";
      detail =
        "window.path.join and a throwing window.fs are a render guard so the first mount does not delete the UI. They do not implement Node or the packages inside the preload.";
    }
    if (name === "child_process") {
      detail = `${detail} A hybrid addon was not built.`;
    }
    items.push({ kind: "node", name, status, detail });
  }
  for (const name of scan.npmPackages || []) {
    if (["photoshop", "uxp", "indesign", "premierepro", "mediaencoder"].includes(name)) {
      items.push({
        kind: "host-module",
        name,
        status: "rewrite",
        detail: "This require is the UXP host module. It works in the plugin host script, not inside the WebView where CEP Node ran it."
      });
      continue;
    }
    const hybrid = name === "open-file-explorer" ? " A hybrid addon was not built." : "";
    items.push({
      kind: "npm",
      name,
      status: "uncovered",
      detail: `CEP ran this package in Node. The UXP host and the WebView cannot require it.${hybrid}`
    });
  }
  for (const name of scan.windowBindings || []) {
    if (name === "Aesp") continue;
    items.push({
      kind: "preload",
      name: `window.${name}`,
      status: "uncovered",
      detail: "The Node preload assigned this global from require. The WebView does not run that script, so the binding is not available."
    });
  }
  if (scan.needsAesp) {
    items.push({
      kind: "license",
      name: "window.Aesp",
      status: "uncovered",
      detail: "The license library did not load. The panel stays unlicensed."
    });
  }
  if (scan.signals?.localStorage > 0) {
    items.push({
      kind: "localStorage",
      name: "localStorage",
      status: "uncovered",
      detail: "The boot script installs an in-memory localStorage only when the real one throws. Those values are not saved."
    });
  }
  for (const skipped of scan.skippedFiles || []) {
    items.push({
      kind: "skipped",
      name: skipped.file,
      status: "uncovered",
      detail: skipped.reason
    });
  }
  for (const name of scan.nativeAddons || []) {
    items.push({
      kind: "addon",
      name,
      status: "uncovered",
      detail: "Native .node addons need a UXP hybrid plugin, which this converter does not build."
    });
  }
  if (scan.missingAssets?.length) {
    for (const missing of scan.missingAssets) {
      items.push({
        kind: missing.kind,
        name: missing.path,
        status: "uncovered",
        detail: "The CEP manifest points at this file, but it is not in the project. Build the extension before expecting its UI."
      });
    }
  }
  if (scan.nodeServer) {
    items.push({
      kind: "server",
      name: "listen",
      status: "uncovered",
      detail: "UXP cannot listen on a port. Keep the panel's tool names and perform the HTTP call with the host http bridge. A text-only cloud model is not a substitute."
    });
  }
  for (const name of scan.evalTsNames || []) {
    items.push({
      kind: "evalTS",
      name,
      status: "uncovered",
      detail: "This evalTS name was found in source. Give it a host handler that returns the old shape, or leave this line. Do not drop it."
    });
  }
  return items;
}

export function uncoveredItems(items) {
  return items.filter((item) => item.status === "uncovered");
}
