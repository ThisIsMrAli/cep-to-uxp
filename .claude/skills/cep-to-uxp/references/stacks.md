# UI stacks

Ask the user which UI path to take before converting. Prefer native UXP HTML or a bolt Spectrum starter. Use a WebView only when the user wants to keep the old page.

The converter copies the panel source. If the user chose WebView, it loads the built JavaScript inside a UXP WebView. It does not run Vue, Svelte, Angular, TypeScript, or JSX compilers. If the CEP project already has a production bundle and the user chose to keep it, use that bundle. If the HTML entry points at a `.vue`, `.svelte`, `.tsx`, `.jsx`, or `.ts` file, build it with the project's existing tool first.

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

`--ui native` rewrites the panel into UXP's own HTML. Framework source does not belong in that document. Suggest it for small static or vanilla pages.

bolt-uxp (https://github.com/hyperbrew/bolt-uxp) is a Vite starter for a new React, Vue, or Svelte UXP UI. Suggest it for most component stacks. Use it only after the user chooses it. The converter then writes `bolt/` beside a loadable copy of the old page. Recreate the UI in `bolt/`. It does not run npm install.

Adobe Spectrum Web Components are a native-UXP choice for a new UI. They are not a drop-in replacement for an existing CEP component tree.

`--ui retarget` is last resort: keep the old UI in a WebView. It copies the editable tree to `ui-src/` and records the build script. The converter still does not run the compiler. The agent rebuilds, then replaces the WebView snapshot with that output. Do not choose retarget only because source exists.
