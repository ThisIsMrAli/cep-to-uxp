import path from "node:path";
import { parseArgs } from "./lib/args.mjs";
import { convertCep } from "./lib/convert.mjs";

const help = `Usage: node scripts/convert.mjs --input <cep-folder> --out <uxp-folder> --ui <mode> [--force] [--strategy auto|webview|native|hybrid] [--design spectrum|preserve] [--host PS|ID|premierepro|ame]

Read a CEP extension and write a new UXP plugin folder. Does not modify the CEP source.
--ui is required. Do not pick a mode automatically.
Prefer native UXP HTML or bolt-react / bolt-vue / bolt-svelte. Use retarget or keep only when the user chooses a WebView.
Exit 2 means every declared host is blocked and only a report was written.
`;

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.input || !args.out || !args.ui) {
  process.stderr.write(help);
  process.exit(args.help ? 0 : 1);
}

try {
  const result = convertCep({
    input: args.input,
    out: args.out,
    force: Boolean(args.force),
    strategy: args.strategy || "auto",
    host: args.host,
    ui: args.ui,
    design: args.design || "spectrum"
  });
  process.stderr.write(`${result.report.strategy} → ${path.resolve(args.out)}\n`);
  process.stdout.write(`${JSON.stringify({ strategy: result.report.strategy, out: path.resolve(args.out) }, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
