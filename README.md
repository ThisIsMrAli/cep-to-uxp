# CEP to UXP

An [Agent Skill](https://agentskills.io/specification) that turns a legacy Adobe CEP extension into a UXP plugin for Photoshop, InDesign, Premiere Pro, and Media Encoder.

The agent always asks which UI path to take. Prefer native UXP HTML or a bolt Spectrum starter. A [UXP WebView](https://developer.adobe.com/uxp/uxp-api/reference-js/global-members/html-elements/html-web-view-element) is last resort, for keeping an existing React, Vue, Svelte, Angular, Solid, Lit, Alpine, TypeScript, or plain JavaScript page. ExtendScript and Node move to the UXP host, where `require("photoshop")`, `require("indesign")`, `require("premierepro")`, and `localFileSystem` exist. The CEP project is not modified.

Invoke it in Cursor with `/cep-to-uxp`.

A designed copy of this guide is published at [thisismrali.github.io/cep-to-uxp](https://thisismrali.github.io/cep-to-uxp/). The source is [`docs/index.html`](docs/index.html). [Publish GitHub Pages](.github/workflows/pages.yml) updates it when `docs/` changes on `main`.

## What the agent actually does

A loaded WebView is not a finished port. Buttons that still call `evalScript`, `cep.fs`, or `require("fs")` inside the page do nothing, because that page is a browser and UXP is the host.

The skill makes the agent follow one procedure:

1. Confirm the folder contains `CSXS/manifest.xml`. Stop if it is already a UXP plugin.
2. Refresh Adobe’s public UXP docs, including known issues, unsupported HTML, and the supported CSS list. Read the live summary. If a documented app id is missing from the skill, stop. Do not invent one.
3. Scan the project. A `build/`, `dist/`, `out/`, or `release/` folder is a snapshot. Source next to it (`src/`, `app/`, Vue, Svelte, TSX, JSX, or a build script) is what gets read.
4. Stop and ask which UI mode, which shell design, and which host. Do not pick them automatically. Suggest native UXP or bolt first. WebView is last resort.
5. Write a new folder. Validate it until the checker prints `OK`.
6. Say every uncovered line in `MIGRATION.md` before anything else.
7. When the user chose bolt or native, recreate the UI on that path. When `RETARGET.md` is present, they chose WebView: edit `ui-src/`, move readable ExtendScript and Node onto `host-handlers.js`, rebuild with the project’s own script, and load that bundle in the WebView.

Done means each source call returns the old string from a host handler, or it is still named as uncovered with the file that calls it. "The panel opened" is not that list.

## Install

[Node.js 18](https://nodejs.org/) or newer. The converter uses the Node standard library. Tests use `jsdom`.

```bash
npx skills add <owner>/cep-to-uxp --skill cep-to-uxp -a cursor
npx skills add <owner>/cep-to-uxp --skill cep-to-uxp -a claude-code
npx skills add <owner>/cep-to-uxp --skill cep-to-uxp -a codex
```

Add `-g` to install it for every project. From a local clone, use `.` instead of `<owner>/cep-to-uxp`.

Claude Code can load this repository as a plugin:

```text
/plugin marketplace add <owner>/cep-to-uxp
/plugin install cep-to-uxp@cep-to-uxp
```

This clone already links the skill into Cursor, Claude, Codex, Gemini, Windsurf, Continue, OpenCode, GitHub Copilot, and the other agent folders. To link it into your home directory as well:

```bash
node install-agents.mjs --global
```

## Use it yourself

```bash
node .claude/skills/cep-to-uxp/scripts/refresh-docs.mjs
node .claude/skills/cep-to-uxp/scripts/scan-cep.mjs --input /path/to/cep-extension
node .claude/skills/cep-to-uxp/scripts/convert.mjs \
  --input /path/to/cep-extension \
  --out /path/to/extension-uxp \
  --force \
  --ui bolt-react \
  --design spectrum \
  --host PS
node .claude/skills/cep-to-uxp/scripts/validate-uxp.mjs --input /path/to/extension-uxp
```

`--host` is `PS`, `ID`, `premierepro`, or `ame`. Exit code 2 means only `MIGRATION.md` was written, because no declared host can be targeted.

Load the output folder in the [UXP Developer Tool](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/). This repository cannot start the Adobe apps.

## UI modes

| `--ui` | When to use it | What gets written |
| --- | --- | --- |
| `native` | Suggested for a small static or vanilla page. | The CEP HTML is the UXP document. No WebView. A leftover `new CSInterface()` throws. |
| `bolt-react` | Suggested for React, Preact, Angular, Solid, Lit, and similar stacks. | A pure UXP document plus `bolt/cep-src/` to clone. No WebView folder. Dependencies are not installed. |
| `bolt-vue` | Suggested for Vue or Nuxt. | A bolt-uxp Vue starter in `bolt/`. |
| `bolt-svelte` | Suggested for Svelte. | A bolt-uxp Svelte starter in `bolt/`. |
| `retarget` | Last resort: keep the existing UI in a WebView. | A loadable plugin, plus `ui-src/` and `RETARGET.md`. The agent separates ExtendScript and Node, rebuilds, and points the WebView at the new bundle. |
| `keep` | Last resort scaffold for a built panel only. | The current page inside `<webview src="plugin:/...">`. Buttons that still call CEP or Node stay dead until they are moved. |

## Shell design

| `--design` | What changes |
| --- | --- |
| `spectrum` | The UXP shell uses built-in `sp-heading` and `sp-button` so the frame matches the host. The page inside the WebView is still yours. Retarget does not redraw it. |
| `preserve` | No Spectrum chrome. The shell is only the frame that hosts the page. |

bolt-uxp starters set `enableSWCSupport` for Spectrum Web Components. That flag is for the new starter, not for the CEP page.

## Report strategies

The scanner picks one. `--strategy` can override a supported panel. It cannot override `blocked`.

| Strategy | Meaning |
| --- | --- |
| `webview` | UXP shell plus the CEP page in a WebView. `CSInterface.js` is replaced by the bridge shim. |
| `hybrid` | The same WebView shell. `child_process`, sockets, or a `.node` addon were found. Those calls are listed and are not converted. A native addon was not built. |
| `native` | No framework, Node, or CEP bridge was found, so the HTML can be the UXP document. |
| `blocked` | Illustrator, After Effects, or another host with no documented UXP panel id. Report only. |

Opening Finder or Explorer with `cep.process.createProcess` is not a hybrid plugin. That call becomes `shell.openPath`.

## UI stacks

The scanner recognizes the stack from file extensions, imports, and `package.json`. It does not compile.

| Stack | How it is recognized | What the WebView should load |
| --- | --- | --- |
| Plain JavaScript | `.js` with no framework | The existing scripts. `CSInterface.js` becomes the shim. |
| TypeScript | `typescript` or `.ts` / `.tsx` | The compiled JavaScript, not the `.ts` file. |
| React, Preact | `react`, `preact`, or JSX | The project’s webpack, Vite, or bolt-cep bundle. |
| Vue, Nuxt | `vue`, `nuxt`, or `.vue` | The Vite or webpack bundle. |
| Svelte | `svelte` or `.svelte` | The compiled bundle. |
| Angular | `@angular/core` | The Angular build output. |
| Solid | `solid-js` | The Solid build output. |
| Lit | `lit` or `LitElement` | The built page. |
| Alpine | `alpinejs` | The HTML page plus Alpine. |
| jQuery, MUI, Bootstrap, and other browser UI libraries | The dependency name | The page that already uses them. |

If both a snapshot (`build/`, `dist/`) and source exist, retarget reads the source. `public/` next to `build/` is treated as a Create React App public folder when both contain `CSXS/manifest.xml`.

## Hosts

| CEP `Host Name` | UXP `host.app` | Floor used by the converter |
| --- | --- | --- |
| `PHXS`, `PHSP` | `PS` | 26.0.0 |
| `IDSN` | `ID` | 20.0.0 |
| `PPRO` | `premierepro` | 25.6.0 |
| `AME` | `ame` | 26.5.0 |

`ame` is the id in Adobe’s shared manifest reference. If the UXP Developer Tool rejects it, change that one field to `mediaencoder`.

Illustrator (`ILST`) and After Effects (`AEFT`) stay on CEP until Adobe documents a UXP panel id. The converter will not invent one.

A packaged `.ccx` needs one host object. An array is only for the UXP Developer Tool.

## What the bridge does

- Exact `evalScript("...")` strings become keys in `host-handlers.js`. Each handler must return a string. Until it is rewritten, it throws.
- Dynamic scripts are listed in `MIGRATION.md` and hit the default throw.
- JSX files are copied to `legacy-extendscript/` and are not executed. `@JSXBIN@` has no function list. Leave a named throw. Do not invent a host DOM from the binary.
- Photoshop document changes belong inside `require("photoshop").core.executeAsModal`. `batchPlay` is Photoshop-only.
- Confirm `require("indesign")` and `require("premierepro")` against the current host docs before using them.
- A CEP modal dialog becomes a UXP command that opens with `uxpShowModal()`.

## What stays impossible inside the WebView

- Synchronous `cep.fs` and `cep.process` are not given working polyfills. If the page reads `window.path` or `window.fs` on first mount, the boot script installs `path.join` and an `fs` whose methods throw inside the caller’s `try`. That is a render guard, not a filesystem.
- `plugin:/` pages throw on `localStorage`. The boot script installs an in-memory store only when access throws. Those values are not saved.
- `shell.openPath` and `shell.openExternal` cannot take arguments or capture output.
- WebView subresources use relative paths. Do not point CSS or JavaScript at `plugin:/`.
- A Node preload that assigns `window.fs` from `require` is not loaded as a normal script. It throws before those globals exist and blanks the panel.
- `fetch` from `plugin:/` is CORS-blocked even when the origin is in `webview.domains`. The page calls `cepToUxp.http`. The host fetches it, using `network.domains`. `host-*.js` has no `TextDecoder`. Reloading the WebView does not reload host scripts. Reload the plugin in the UXP Developer Tool.
- `child_process`, sockets, `.node` addons, and servers that listen on a port are reported. A hybrid addon is not built. Keep the panel's tool names, run the ones the host can, and return the old error string for the rest. A cloud model that only returns text is not a substitute.
- Premiere icons keep one file per theme. RollOver states are dropped. An icon with no `theme` is rejected, because Premiere treats it as a second root icon.
- A folder named `cep` inside `dist/` or `build/` is still a snapshot. Source is the `src/` tree next to that snapshot. If the repository has more than one `CSXS/manifest.xml`, the agent asks which extension to convert and does not merge them.
- Domain wildcards cannot sit in the top-level label. `https://*.adobe.com` is valid. `https://adobe.*` is not.

On each conversion the skill refreshes Adobe’s public UXP docs into `references/live/`. That cache is local and is not part of git. If the refresh fails, the agent says so and uses the notes shipped in `references/`.

## Development

```bash
npm test
```

Fixtures live in `fixtures/`. The skill itself is [`.claude/skills/cep-to-uxp`](.claude/skills/cep-to-uxp/SKILL.md). The other agent directories in this repository are symlinks to that folder.

## License

[MIT](LICENSE)
