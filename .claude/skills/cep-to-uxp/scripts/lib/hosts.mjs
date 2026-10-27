// Snapshot of host support checked against Adobe's docs in October 2026.
// The shared manifest reference lists these app ids:
// https://developer.adobe.com/uxp/guides/explanation/concepts/manifest/
// Timeline: https://blog.developer.adobe.com/en/publish/2026/09/investing-in-the-future-of-creative-cloud-extensibility-uxp-comes-to-our-flagship-applications

export const SUPPORTED_APPS = ["PS", "ID", "premierepro", "ame", "mediaencoder"];

export const CEP_HOSTS = {
  PHXS: {
    app: "PS",
    name: "Photoshop",
    status: "supported",
    minVersion: "26.0.0",
    floor: "Local WebView (plugin:/) needs UXP 8. Photoshop 26 is the first public generation known to ship it."
  },
  PHSP: {
    app: "PS",
    name: "Photoshop",
    status: "supported",
    minVersion: "26.0.0",
    floor: "Same Photoshop runtime as PHXS."
  },
  IDSN: {
    app: "ID",
    name: "InDesign",
    status: "supported",
    minVersion: "20.0.0",
    floor: "Conservative floor for local WebView, not the first InDesign release that had any UXP. Raise it if the host docs require a newer app."
  },
  PPRO: {
    app: "premierepro",
    name: "Premiere Pro",
    status: "supported",
    minVersion: "25.6.0",
    floor: "25.6.0 is Adobe's documented Premiere UXP example. Raise it if local WebView fails to load."
  },
  AME: {
    app: "ame",
    name: "Media Encoder",
    status: "supported",
    minVersion: "26.5.0",
    floor: "Public beta. The shared manifest id is ame. Some sample repos still say mediaencoder; switch only if UDT rejects ame."
  },
  ILST: {
    app: null,
    name: "Illustrator",
    status: "blocked",
    reason:
      "Illustrator UXP plugins were announced for a public beta in spring 2027. There is no manifest app id to target yet."
  },
  AEFT: {
    app: null,
    name: "After Effects",
    status: "blocked",
    reason:
      "After Effects UXP plugins were announced for a public beta in November 2026. Do not invent an app id. Scaffold only after that host documents one and the panel loads in the UXP Developer Tool."
  }
};

const BLOCKED_DEFAULT =
  "This CEP host has no documented UXP panel runtime. Leave the CEP extension in place for that app.";

export function mapCepHost(name) {
  const code = String(name || "").trim().toUpperCase();
  const known = CEP_HOSTS[code];
  if (known) return { cep: code, ...known };
  return {
    cep: code || "UNKNOWN",
    app: null,
    name: code || "Unknown",
    status: "blocked",
    reason: BLOCKED_DEFAULT
  };
}

export function dedupeSupported(hosts) {
  const seen = new Set();
  const unique = [];
  for (const host of hosts) {
    if (host.status !== "supported" || !host.app) continue;
    if (seen.has(host.app)) continue;
    seen.add(host.app);
    unique.push(host);
  }
  return unique;
}
