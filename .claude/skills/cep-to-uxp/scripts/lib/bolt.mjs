import fs from "node:fs";
import path from "node:path";

const FRAMEWORKS = {
  "bolt-react": {
    file: "src/main.tsx",
    packages: { react: "^19.1.0", "react-dom": "^19.1.0" },
    source(scan) {
      return `import React from "react";

export function App() {
  return <main id="cep-port-root" />;
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
    <p>Port the CEP screens from cep-src. Do not replace them with a smaller page.</p>
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
  <p>Port the CEP screens from cep-src. Do not replace them with a smaller page.</p>
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
    `# Bolt UXP port

This folder is the pure UXP UI. The parent folder is what the UXP Developer Tool loads. There is no WebView.

Read PORT.md. Clone every visible CEP screen from cep-src into src. Do not ship this starter as the product and do not drop controls the CEP panel showed.

Vite must keep build.modulePreload false. Premiere has no MutationObserver.

Versions were taken from bolt-uxp's public template. If install fails, copy the current template's package.json from that repository.
`
  );
}
