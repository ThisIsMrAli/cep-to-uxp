# React and other bundled panels

Vue, Svelte, Angular, Solid, Lit, and TypeScript follow the same rule as React: keep the existing UI in the WebView and load its built JavaScript. Stack-by-stack notes are in [stacks.md](stacks.md).

## What the converter does

- Copies `src/` and the built `js/` or `dist/` tree into `webview/`. It does not copy `node_modules`, lockfiles, or `package.json`.
- Replaces a classic `<script src=".../CSInterface.js">` with the shim and loads `cep-to-uxp-boot.js` first.
- Leaves JSX source in place for you to edit. The WebView does not compile JSX.

## What you do

1. Prefer the bundle the CEP project already shipped. Point the panel HTML at that bundle.
2. If `CSInterface` was bundled inside the output, the global shim cannot replace it. Change the source import to the shim (or to `window.CSInterface`), rebuild with a browser target, and run the converter again.
3. If the webpack or Vite config used a Node target or `--mixed-context`, rebuild `target: "web"`. Move `fs`, `child_process`, and native addons out of the bundle and into `host-handlers.js` or a hybrid addon.
4. Bare imports such as `import React from "react"` in the HTML entry will fail in the WebView. They need a bundle.
5. Do not add a new bundler when the project already has one. Do not port the component tree to Spectrum Web Components unless the user asked for a native UXP UI.

`localStorage` throws for HTML loaded from `plugin:/`. `cep-to-uxp-boot.js` installs an in-memory store only when that access throws, so a bundle can create its store during module load. Those values are not saved. Move anything that must persist to the UXP data folder.

Vue, Svelte, Angular, and Preact follow this same path.
