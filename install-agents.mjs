import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const canonical = path.join(repo, ".claude/skills/cep-to-uxp");
const skillName = "cep-to-uxp";

const projectAgents = [
  ".cursor/skills",
  ".agents/skills",
  ".windsurf/skills",
  ".codex/skills",
  ".gemini/skills",
  ".continue/skills",
  ".opencode/skills",
  ".qoder/skills",
  ".codebuddy/skills",
  ".factory/skills",
  ".kilocode/skills",
  ".trae/skills",
  ".antigravity/skills",
  ".kiro/skills",
  ".roo/skills",
  ".warp/skills",
  ".augment/skills",
  ".github/skills",
  ".amazonq/skills",
  ".kimi-code/skills",
  ".zcode/skills"
];

const globalAgents = [
  ".claude/skills",
  ".cursor/skills",
  ".agents/skills",
  ".codex/skills",
  ".gemini/skills",
  ".windsurf/skills",
  ".continue/skills",
  ".factory/skills",
  ".kiro/skills",
  ".kimi-code/skills",
  ".zcode/skills"
];

function linkSkill(parent, target, useRelative) {
  const dest = path.join(parent, skillName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let current = null;
  try {
    current = fs.lstatSync(dest);
  } catch {
    current = null;
  }
  if (current?.isSymbolicLink()) fs.unlinkSync(dest);
  else if (current) {
    throw new Error(`${dest} already exists and is not a symlink.`);
  }
  const linkTarget = useRelative ? path.relative(path.dirname(dest), target) : target;
  fs.symlinkSync(linkTarget, dest);
  return dest;
}

if (!fs.existsSync(path.join(canonical, "SKILL.md"))) {
  process.stderr.write(`Canonical skill is missing: ${canonical}\n`);
  process.exit(1);
}

for (const agent of projectAgents) {
  linkSkill(path.join(repo, agent), canonical, true);
}

if (process.argv.includes("--global")) {
  for (const agent of globalAgents) {
    linkSkill(path.join(os.homedir(), agent), canonical, false);
  }
}

process.stdout.write(`Linked ${skillName} for ${projectAgents.length} project agents.\n`);
