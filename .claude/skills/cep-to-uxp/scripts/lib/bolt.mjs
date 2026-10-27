import fs from "node:fs";
import path from "node:path";

const FRAMEWORKS = {
  "bolt-react": {
    file: "src/main.tsx",
    packages: { react: "^19.1.0", "react-dom": "^19.1.0" },
    source(scan) {
      return `import React from "react";

export function App() {
  return (
    <main>
      <h1>${escapeJsx(scan.bundle.name)}</h1>
      <p>Bolt UXP starter. The original panel still loads from the plugin root.</p>
    </main>
  );
}
`;
    }
  },
  "bolt-vue": {
    file: "src/App.vue",
    packages: { vue: "^3.5.13" },
    source(scan) {
      return `<script setup>
const name = ${JSON.stringify(scan.bundle.name)};
</script>

<template>
  <main>
    <h1>{{ name }}</h1>
    <p>Bolt UXP starter. The original panel still loads from the plugin root.</p>
  </main>
</template>
`;
    }
  },
  "bolt-svelte": {
    file: "src/App.svelte",
    packages: { svelte: "^5.0.0" },
    source(scan) {
      return `<script>
  const name = ${JSON.stringify(scan.bundle.name)};
</script>

<main>
  <h1>{name}</h1>
  <p>Bolt UXP starter. The original panel still loads from the plugin root.</p>
</main>
`;
    }
  }
};

function escapeJsx(value) {
  return String(value).replace(/[<>&]/g, "");
}

export function writeBoltStarter(out, scan, decision, ui) {
  const spec = FRAMEWORKS[ui];
  if (!spec) throw new Error(`Unknown bolt UI: ${ui}`);
  const root = path.join(out, "bolt");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const host = decision.hosts[0];
  const pkg = {
    name: scan.bundle.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase(),
    private: true,
    version: scan.bundle.version,
    scripts: {
      dev: "vite build --watch",
      build: "vite build"
    },
    dependencies: spec.packages,
    devDependencies: {
      typescript: "^5.8.3",
      vite: "^6.3.5",
      "bolt-uxp-utils": "^1.3.6",
      "vite-uxp-plugin": "^1.3.8"
    }
  };
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  fs.writeFileSync(path.join(root, spec.file), spec.source(scan));
  fs.writeFileSync(
    path.join(root, "uxp.config.ts"),
    `export const manifest = {
  id: ${JSON.stringify(scan.bundle.id)},
  name: ${JSON.stringify(scan.bundle.name)},
  version: ${JSON.stringify(scan.bundle.version)},
  main: "index.html",
  manifestVersion: 5,
  host: { app: ${JSON.stringify(host.app)}, minVersion: ${JSON.stringify(host.minVersion)} },
  featureFlags: { enableSWCSupport: true }
};
`
  );
  fs.writeFileSync(
    path.join(root, "README.md"),
    `# Bolt UXP starter

This folder is the new ${ui.replace("bolt-", "")} UI. It is not the plugin Premiere loads.

The loadable plugin is the parent folder. Open that folder in the UXP Developer Tool.

When you are ready to switch the panel UI to bolt-uxp:

1. Read https://github.com/hyperbrew/bolt-uxp
2. From this folder, install dependencies with npm.
3. Keep manifest version 5 for Premiere unless the current Premiere UXP docs say otherwise.
4. Move host calls out of \`../host-handlers.js\` into this UI only after the page no longer needs the WebView shim.

Versions were taken from bolt-uxp's public template. If install fails, copy the current template's package.json from that repository.
`
  );
}
