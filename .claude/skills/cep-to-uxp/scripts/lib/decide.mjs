import { classifyDomain } from "./domains.mjs";
import { dedupeSupported } from "./hosts.mjs";
import { processNeedsHybrid } from "./scan.mjs";

const HYBRID_BUILTINS = new Set([
  "child_process",
  "net",
  "dgram",
  "cluster",
  "worker_threads",
  "vm",
  "tls"
]);

const FILE_BUILTINS = new Set(["fs", "path", "os"]);

export function decide(scan, options = {}) {
  const supported = dedupeSupported(scan.hosts);
  const blockedHosts = scan.hosts.filter((host) => host.status !== "supported");
  const warnings = [...scan.warnings];
  const reasons = [];
  const processCalls = scan.processCalls || [];
  const hybrid = Boolean(scan.appHybrid) || processNeedsHybrid(processCalls);
  const add = (warning) => {
    if (!warnings.includes(warning)) warnings.push(warning);
  };

  if (supported.length === 0) {
    reasons.push("None of the CEP hosts have a UXP panel runtime that this skill can target.");
    for (const host of blockedHosts) reasons.push(`${host.name}: ${host.reason}`);
    return {
      strategy: "blocked",
      reasons,
      warnings,
      permissions: {},
      hosts: [],
      blockedHosts,
      flyoutItems: scan.flyoutItems
    };
  }

  for (const host of blockedHosts) {
    add(`${host.name} was left on CEP. ${host.reason}`);
  }
  if (scan.signals.localStorage > 0) {
    add(
      "localStorage throws for HTML loaded from plugin:/. The boot script installs an in-memory store when access throws so the page can render. Those values are not saved."
    );
  }
  if (scan.appHybrid || scan.nodeServer || scan.hybridNotBuilt) {
    add(
      "A local process or listening server cannot run in the WebView. Keep the panel's tool names. Replace the process and listen() with the host http bridge, and put the origin in network.domains. A cloud model that only returns text is not a substitute. Return the old error string for tools the host cannot run."
    );
  }
  if (scan.needsAesp) {
    add("window.Aesp did not load. The license library is missing and the panel stays unlicensed.");
  }
  const openers = processCalls.filter((call) => call.method === "createProcess" && call.opener);
  if (openers.length && !processNeedsHybrid(processCalls)) {
    add("cep.process.createProcess only opens Finder or Explorer. Replace it with shell.openPath. That does not need a hybrid addon.");
  }
  if (scan.signals.cepFs > 0) {
    add("cep.fs is synchronous. Rewrite each call to async UXP file APIs in the host script.");
  }
  if (scan.signals.resizeContent > 0) {
    add("resizeContent has no UXP equivalent. Panel size comes from manifest.json.");
  }
  if (scan.signals.vulcan > 0) {
    add("Vulcan cannot message other host applications. Same-host calls can use invokeCommand and showPanel.");
  }
  const needsBuild = ["react", "preact", "vue", "nuxt", "svelte", "angular", "solid", "lit", "stencil", "alpine"];
  if (scan.uncompiledEntries?.length || scan.languages?.includes("typescript") || scan.frameworks.some((name) => needsBuild.includes(name))) {
    add("WebView pages need built JavaScript. Vue, Svelte, Angular, Solid, Lit, React, and TypeScript sources are copied and are not compiled by this converter.");
  }
  if (scan.npmPackages?.length) {
    add(`CEP Node packages do not load in UXP: ${scan.npmPackages.join(", ")}.`);
  }
  if (scan.nodeServer) {
    add("This extension listens as a Node server. UXP cannot open a port, so that feature is not carried over.");
  }
  for (const name of scan.nodeBuiltins) {
    if (HYBRID_BUILTINS.has(name)) {
      add(`Node ${name} is not available in UXP. A hybrid addon or a redesigned workflow is required.`);
    } else if (FILE_BUILTINS.has(name) || name === "http" || name === "https") {
      add(`Node ${name} does not run inside the WebView. Move it to the UXP host script.`);
    }
  }

  let strategy = "native";
  if (hybrid) {
    strategy = "hybrid";
    reasons.push("The panel starts a process, opens a socket, or loads a native addon. UXP cannot host that in JavaScript.");
    reasons.push("The existing UI still loads in a WebView. The native work stays a separate hybrid addon.");
  } else if (
    scan.frameworks.length > 0 ||
    scan.browserLibs.length > 0 ||
    scan.bundle.nodeEnabled ||
    scan.signals.evalScript > 0 ||
    scan.signals.csInterface > 0 ||
    scan.signals.adobeCep > 0 ||
    scan.signals.cepFs > 0 ||
    scan.nodeBuiltins.length > 0
  ) {
    strategy = "webview";
    if (scan.frameworks.length) {
      reasons.push(`${scan.frameworks.join(", ")} stays in a WebView. UXP's own document is not a full browser.`);
    } else if (scan.browserLibs.length) {
      reasons.push(`${scan.browserLibs.join(", ")} stays in a WebView.`);
    } else if (scan.signals.evalScript || scan.signals.csInterface || scan.signals.adobeCep) {
      reasons.push("The existing page keeps running in a WebView. Host calls cross postMessage to the UXP shell.");
    } else if (scan.bundle.nodeEnabled) {
      reasons.push("The CEP manifest enables Node. The page loads in a WebView, and Node calls move to the UXP host.");
    } else {
      reasons.push("Browser or Node APIs in this panel need the WebView shell.");
    }
  } else {
    reasons.push("No framework, Node, or CEP bridge was found, so the HTML can be a native UXP panel.");
  }

  if (options.strategy && options.strategy !== "auto" && options.strategy !== strategy) {
    add(`Automatic strategy was ${strategy}. --strategy ${options.strategy} overrides it.`);
    strategy = options.strategy;
  }

  let hosts = supported;
  if (options.host) {
    hosts = supported.filter((host) => host.app === options.host);
    if (hosts.length === 0) {
      return {
        strategy: "blocked",
        reasons: [`None of the supported CEP hosts map to ${options.host}.`],
        warnings,
        permissions: {},
        hosts: [],
        blockedHosts,
        flyoutItems: scan.flyoutItems
      };
    }
  }

  return {
    strategy,
    reasons,
    warnings,
    permissions: collectPermissions(scan, strategy, add),
    hosts,
    blockedHosts,
    flyoutItems: scan.flyoutItems
  };
}

function collectPermissions(scan, strategy, add) {
  if (strategy === "blocked" || strategy === "native") return {};
  const domains = scan.origins.filter((origin) => classifyDomain(origin).ok);
  const permissions = {
    localFileSystem: filePermission(scan),
    webview: {
      allow: "yes",
      allowLocalRendering: "yes",
      enableMessageBridge: domains.length ? "localAndRemote" : "localOnly",
      domains
    }
  };
  if (scan.signals.fetchApi > 0 || scan.nodeBuiltins.includes("http") || scan.nodeBuiltins.includes("https")) {
    permissions.network = { domains: domains.length ? domains : "all" };
    if (!domains.length) {
      add("Network calls were found without a literal origin. network.domains is \"all\"; narrow it.");
    }
  }
  if (scan.launchSchemes.length) {
    permissions.launchProcess = { schemes: scan.launchSchemes };
  }
  if (scan.signals.clipboard > 0) permissions.clipboard = "readAndWrite";
  if (scan.signals.codeGeneration > 0) permissions.allowCodeGenerationFromStrings = true;
  if (permissions.localFileSystem === "fullAccess") {
    add(
      "localFileSystem fullAccess is required once arbitrary path reads and writes move to the host. request is enough for a folder picker only."
    );
  }
  return permissions;
}

function filePermission(scan) {
  if (scan.signals.cepFs > 0 || scan.nodeBuiltins.includes("fs")) return "fullAccess";
  const picker = (scan.dynamicEvalScripts || []).some((script) => /selectDlg|getFolder/.test(script));
  return picker ? "request" : "plugin";
}
