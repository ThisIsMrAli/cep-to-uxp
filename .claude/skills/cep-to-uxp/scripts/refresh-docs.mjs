import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDocFacts, mergeDocFacts } from "./lib/docs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const liveDir = path.join(root, "references/live");
const PAGES = [
  ["manifest", "https://developer.adobe.com/uxp/guides/explanation/concepts/manifest/"],
  ["webview", "https://developer.adobe.com/uxp/uxp-api/reference-js/global-members/html-elements/html-web-view-element"],
  ["interfaces", "https://developer.adobe.com/uxp/guides/explanation/fundamentals/user-interfaces/"],
  ["entrypoints", "https://developer.adobe.com/uxp/guides/explanation/concepts/panels-and-commands/"],
  ["migration", "https://developer.adobe.com/uxp/migration-center/"]
];

const BUNDLED_APPS = new Set(["PS", "ID", "premierepro", "ame", "mediaencoder"]);

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120000);
}

const pages = [];
for (const [id, url] of PAGES) {
  try {
    const response = await fetch(url, { headers: { accept: "text/html" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = htmlToText(await response.text());
    const facts = extractDocFacts(text);
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, `${id}.txt`), text);
    pages.push({ id, url, ok: true, facts });
  } catch (error) {
    pages.push({ id, url, ok: false, error: error.message });
  }
}

const merged = mergeDocFacts(pages);
const freshApps = merged.apps.filter((app) => !BUNDLED_APPS.has(app));
const summary = {
  fetchedAt: new Date().toISOString(),
  ok: pages.some((page) => page.ok),
  pages: pages.map(({ id, url, ok, error }) => ({ id, url, ok, error: error || "" })),
  apps: merged.apps,
  webview: merged.webview,
  spectrum: merged.spectrum,
  commands: merged.commands,
  appsMissingFromSkill: freshApps
};

fs.mkdirSync(liveDir, { recursive: true });
fs.writeFileSync(path.join(liveDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (!summary.ok) process.exitCode = 1;
