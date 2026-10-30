import path from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { inventoryDir, missingLabels } from "./lib/inventory.mjs";

const help = `Usage: node scripts/inventory-ui.mjs --cep <cep-or-cep-src> --uxp <uxp-ui-folder>

List visible CEP labels that are missing from the UXP UI source.
Exit 1 when any label is missing. This checks words, not layout.
`;

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.cep || !args.uxp) {
  process.stderr.write(help);
  process.exit(args.help ? 0 : 1);
}

const cep = inventoryDir(path.resolve(args.cep));
const uxp = inventoryDir(path.resolve(args.uxp));
const missing = missingLabels(cep, uxp);
process.stdout.write(`${JSON.stringify({ cep: cep.length, uxp: uxp.length, missing }, null, 2)}\n`);
process.exit(missing.length ? 1 : 0);
