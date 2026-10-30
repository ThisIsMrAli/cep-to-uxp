import { parseArgs } from "./lib/args.mjs";
import { suggestUi } from "./lib/decide.mjs";
import { scanCep } from "./lib/scan.mjs";

const help = `Usage: node scripts/scan-cep.mjs --input <cep-folder>

Print a JSON inventory of a CEP extension. Read-only.
`;

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.input) {
  process.stderr.write(help);
  process.exit(args.help ? 0 : 1);
}

try {
  const scan = scanCep(args.input);
  process.stdout.write(`${JSON.stringify({ ...scan, suggestedUi: suggestUi(scan) }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
