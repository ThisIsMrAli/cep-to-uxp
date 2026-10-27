import { parseArgs } from "./lib/args.mjs";
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
  process.stdout.write(`${JSON.stringify(scanCep(args.input), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
