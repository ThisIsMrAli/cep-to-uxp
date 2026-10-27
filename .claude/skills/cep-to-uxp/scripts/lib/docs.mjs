const DOC_PAGES = [
  {
    id: "manifest",
    url: "https://developer.adobe.com/uxp/guides/explanation/concepts/manifest/"
  },
  {
    id: "webview",
    url: "https://developer.adobe.com/uxp/uxp-api/reference-js/global-members/html-elements/html-web-view-element"
  },
  {
    id: "interfaces",
    url: "https://developer.adobe.com/uxp/guides/explanation/fundamentals/user-interfaces/"
  },
  {
    id: "entrypoints",
    url: "https://developer.adobe.com/uxp/guides/explanation/concepts/panels-and-commands/"
  },
  {
    id: "migration",
    url: "https://developer.adobe.com/uxp/migration-center/"
  }
];

const KNOWN_APP_IDS = ["PS", "ID", "premierepro", "ame", "mediaencoder", "AI", "AE"];

export function extractDocFacts(text) {
  const apps = new Set();
  const source = String(text);
  for (const match of source.matchAll(/"app"\s*:\s*"([A-Za-z0-9]+)"/g)) apps.add(match[1]);
  for (const id of KNOWN_APP_IDS) {
    if (source.includes(`"${id}"`) || source.includes(`\`${id}\``)) apps.add(id);
  }
  return {
    apps: [...apps].sort(),
    webview: /allowLocalRendering|HTMLWebViewElement|plugin:\//.test(source),
    spectrum: /Spectrum Web Components|enableSWCSupport/.test(source),
    commands: /type"\s*:\s*"command"|Commands are/.test(source)
  };
}

export function mergeDocFacts(pages) {
  const apps = new Set();
  const flags = { webview: false, spectrum: false, commands: false };
  for (const page of pages) {
    if (!page.ok) continue;
    for (const app of page.facts?.apps || []) apps.add(app);
    for (const key of Object.keys(flags)) flags[key] = flags[key] || Boolean(page.facts?.[key]);
  }
  return { apps: [...apps].sort(), ...flags };
}
