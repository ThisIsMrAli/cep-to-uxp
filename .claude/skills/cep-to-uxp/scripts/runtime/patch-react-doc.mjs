import fs from "node:fs";
import path from "node:path";

const file = path.resolve(process.argv[2] || path.join(process.cwd(), "..", "panel.js"));
if (!fs.existsSync(file)) {
  process.stderr.write(`Bundle not found: ${file}\nBuild the bolt app first, then pass the bundle path.\n`);
  process.exit(1);
}
const source = fs.readFileSync(file, "utf8");
const from = /function ([A-Za-z0-9_$]+)\(t\)\{return t\.nodeType===9\?t:t\.ownerDocument\}/;
const match = source.match(from);
if (source.includes('typeof d.createElement==="function"?d:document')) {
  process.stdout.write(`${path.basename(file)} document lookup already safe\n`);
} else if (!match) {
  process.stderr.write(`${path.basename(file)} document lookup pattern was not found\n`);
  process.exit(1);
} else {
  const to = `function ${match[1]}(t){var d=t&&t.nodeType===9?t:t&&t.ownerDocument;return d&&typeof d.createElement==="function"?d:document}`;
  fs.writeFileSync(file, source.replace(from, to));
  process.stdout.write(`patched ${path.basename(file)} document lookup\n`);
}
