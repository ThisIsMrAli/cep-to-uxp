const ORIGIN = /^(https?|wss?):\/\/([^/?#]+)$/;

export function classifyDomain(value) {
  if (value === "all") return { ok: true, broad: true };
  const match = String(value).match(ORIGIN);
  if (!match) return { ok: false, reason: `${value} is not an origin without a path` };
  const labels = match[2].split(".");
  if (labels.length < 2) return { ok: false, reason: `${value} has an incomplete host` };
  if (labels[labels.length - 1].includes("*")) {
    return { ok: false, reason: `${value} puts a wildcard in the top-level domain` };
  }
  if (labels.slice(1).some((label) => label.includes("*"))) {
    return { ok: false, reason: `${value} puts a wildcard outside the leftmost label` };
  }
  if (labels[0].includes("*") && labels[0] !== "*") {
    return { ok: false, reason: `${value} uses a partial wildcard` };
  }
  return { ok: true, broad: false };
}

const SCHEMA_HOSTS = new Set(["www.w3.org", "ns.adobe.com", "purl.org", "json-schema.org"]);

function looksFetched(text, index, raw, markup) {
  const before = text.slice(Math.max(0, index - 180), index);
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if (/xmlns(?::[\w.-]+)?\s*=\s*['"]?$/i.test(line.slice(-48))) return false;
  if (/sampleResults|error-decoder|for more information|polyfill|repository|homepage/i.test(line)) return false;
  if (/\/docs\//i.test(raw)) return false;
  if (/(?:fetch|axios|XMLHttpRequest|WebSocket|openURLInDefaultBrowser|window\.open)\s*\(\s*['"`]?$/i.test(before)) return true;
  if (/(?:dsn|url)\s*[:=]\s*['"`]$/i.test(before)) return true;
  if (markup && /\b(?:src|href|action)\s*=\s*['"]$/i.test(before)) return true;
  if (markup && /url\(\s*['"]?$/i.test(before)) return true;
  if (/\.(?:get|post|put|patch|delete|open|send)\s*\(\s*['"`]$/.test(before)) return true;
  try {
    const url = new URL(raw);
    if (/\/(?:translate|v\d|projects|ingest|get_video_info|api)\//i.test(`${url.pathname}/`)) return true;
  } catch {
    return false;
  }
  return false;
}

export function extractOrigins(text, options = {}) {
  const found = new Set();
  const pattern = /\b(?:https?|wss?):\/\/[^\s"'`)<>]+/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0].replace(/[.,);]+$/g, "");
    if (!looksFetched(text, match.index, raw, options.markup === true)) continue;
    try {
      const url = new URL(raw);
      if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) continue;
      if (url.hostname.includes("*")) continue;
      if (SCHEMA_HOSTS.has(url.hostname)) continue;
      found.add(url.origin);
    } catch {
      // Ignore malformed literals. The agent can add a domain if a runtime call needs it.
    }
  }
  return [...found].sort();
}

export function withCompanionOrigins(origins) {
  const next = new Set(origins);
  if (next.has("https://fonts.googleapis.com")) next.add("https://fonts.gstatic.com");
  return [...next].sort();
}

export function extractLaunchSchemes(text) {
  const schemes = new Set();
  const calls = text.matchAll(
    /(?:openURLInDefaultBrowser|openExternal|window\.open)\(\s*(['"`])([^'"`]+)\1/g
  );
  let sawCall = false;
  const callPattern =
    /(?:openURLInDefaultBrowser|openExternal|window\.open|cep\.util\.openURLInDefaultBrowser)\s*\(/;
  if (callPattern.test(text)) sawCall = true;
  for (const match of calls) {
    const target = match[2];
    const scheme = target.match(/^([a-z][a-z0-9+.-]*):/i);
    if (scheme) schemes.add(scheme[1].toLowerCase());
  }
  if (sawCall && schemes.size === 0) schemes.add("https");
  return [...schemes].sort();
}
