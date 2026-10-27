# UI stacks

The converter copies the panel source and, when the page needs a browser, loads the built JavaScript inside a UXP WebView. It does not run Vue, Svelte, Angular, TypeScript, or JSX compilers. If the CEP project already has a production bundle, keep using that bundle. If the HTML entry points at a `.vue`, `.svelte`, `.tsx`, `.jsx`, or `.ts` file, build it with the project's existing tool first.

| Source | How it is detected | What to load in the WebView |
| --- | --- | --- |
| Vanilla JS | `.js` with no framework | The existing scripts. `CSInterface.js` is replaced by the shim. |
| TypeScript | `typescript` dependency or `.ts` / `.tsx` | The compiled `.js`, not the `.ts` file. |
| React / Preact | `react`, `preact`, or JSX | The existing webpack, Vite, or bolt-cep bundle. |
| Vue / Nuxt | `vue`, `nuxt`, or `.vue` | The Vite or webpack bundle. Single-file components stay in the tree as source. |
| Svelte | `svelte` or `.svelte` | The compiled bundle. |
| Angular | `@angular/core` or `@Component` | The Angular build output. |
| Solid | `solid-js` | The Solid build output. |
| Lit | `lit` or `LitElement` | The built page, or plain JS that already defines the elements. |
| Alpine | `alpinejs` | Usually a plain HTML page plus Alpine. Still a WebView page. |
| jQuery, Vuetify, Element Plus, Quasar, PrimeVue, MUI, Bootstrap | dependency name | The page that already uses them. Do not rewrite it into Spectrum. |
| bolt-cep | `bolt-cep` | Its `dist` (or configured output). Rebuild with a browser target if Node was bundled in. |

`--strategy native` is only for a panel the user wants rewritten into UXP's own HTML. Framework source does not belong in that document.

bolt-uxp (https://github.com/hyperbrew/bolt-uxp) is a Vite starter for a new React, Vue, or Svelte UXP UI. Use it only after the user chooses it. The converter then writes `bolt/` beside the loadable WebView port. It does not delete the working panel, and it does not run npm install.

Adobe Spectrum Web Components are a native-UXP choice for a new UI. They are not a drop-in replacement for an existing CEP component tree.

`--ui retarget` recognizes these stacks from file extensions, imports, and `package.json`. It copies the editable tree to `ui-src/` and records the build script. The converter still does not run the compiler. The agent rebuilds, then replaces the WebView snapshot with that output. The component tree stays the one the CEP panel already had.
