import fs from "node:fs";
import path from "node:path";

const TEXT_EXT = new Set([".html", ".htm", ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte"]);
const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", "CSXS", "csxs"]);

const ATTR = /\b(?:placeholder|aria-label|title|alt)\s*=\s*["']([^"']{2,160})["']/g;
const JSX_ATTR = /\b(?:placeholder|aria-label|title|alt|label)\s*=\s*["']([^"']{2,160})["']/g;
const TEXT = />([^<>{}\n][^<>{}]{0,160})</g;

export function visibleStrings(text) {
  const found = new Set();
  const source = String(text).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const pattern of [ATTR, JSX_ATTR, TEXT]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) addLabel(found, match[1]);
  }
  return [...found].sort();
}

export function inventoryDir(dir) {
  const labels = new Set();
  walk(dir, (file) => {
    for (const label of visibleStrings(fs.readFileSync(file, "utf8"))) labels.add(label);
  });
  return [...labels].sort();
}

export function missingLabels(cepLabels, uxpLabels) {
  const have = new Set(uxpLabels.map(normalize));
  return cepLabels.filter((label) => !have.has(normalize(label)));
}

function addLabel(found, raw) {
  const label = String(raw).replace(/\s+/g, " ").trim();
  if (label.length < 2 || label.length > 160) return;
  if (/^[\d\s.,:;/\\|]+$/.test(label)) return;
  if (/^(https?:|plugin:|\.|\/|@|import |export |const |function )/i.test(label)) return;
  if (/[{}<>]/.test(label)) return;
  found.add(label);
}

function normalize(label) {
  return label.toLowerCase();
}

function walk(dir, visit) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) visit(full);
  }
}
