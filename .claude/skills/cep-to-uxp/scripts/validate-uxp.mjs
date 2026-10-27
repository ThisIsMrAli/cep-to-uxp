import { parseArgs } from "./lib/args.mjs";
import { validatePlugin } from "./lib/validate.mjs";

const help = `Usage: node scripts/validate-uxp.mjs --input <uxp-folder>

Check a converted plugin folder. This does not load Photoshop or another host.
`;

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.input) {
  process.stderr.write(help);
  process.exit(args.help ? 0 : 1);
}

const result = validatePlugin(args.input);
for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
if (!result.ok) {
  for (const error of result.errors) process.stderr.write(`error: ${error}\n`);
  process.exit(1);
}
process.stdout.write("OK\n");
