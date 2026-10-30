# Spectrum

Adobe's UXP UI guide says a plugin you ship should use Spectrum. There are two supported ways, and they are not interchangeable:

| Kind | When the converter uses it | Setup |
| --- | --- | --- |
| Built-in Spectrum widgets | The loadable plugin shell: `sp-heading`, and dialogs opened with `uxpShowModal()` | None. These tags exist in the host. |
| Spectrum Web Components | The `bolt/` starter, via `featureFlags.enableSWCSupport` | npm install, import each component, and a bundler. Premiere currently expects SWC `0.37.0` and `@swc-uxp-wrappers`. |

Prefer Spectrum on a native UXP document or a bolt port. Spectrum replaces a control's widget. It does not remove the control, its label, or its prompt. The CEP page inside a WebView keeps its old CSS; Spectrum chrome there is only the UXP frame around it. `--design preserve` leaves that frame out. WebView is last resort.

Premiere's `sp-textfield`, `sp-picker`, and `sp-menu-item` expose `value` as a getter. React must not pass `value`. Set it with `element.setAttribute("value", next)` and `setAttribute("selected", ...)`.

A UXP Vite build sets `build.modulePreload` to false and emits an iife. Premiere has no `MutationObserver`, so Vite's modulepreload polyfill throws before the panel paints.

Do not put `sp-theme` on the loadable shell. Theme scoping belongs to Spectrum Web Components, which the shell does not bundle. Use host widgets there. Inside a bolt build, wrap new UI in `sp-theme` only after the SWC theme package is imported.

Buttons: `variant="cta"` for the one main action, `primary` or `secondary` for the rest, `negative` for destructive actions.

A modal CEP extension becomes a UXP command. Its dialog blocks the host until it closes. A normal CEP panel stays a docked UXP panel.

References: https://developer.adobe.com/uxp/guides/explanation/fundamentals/user-interfaces/ and https://developer.adobe.com/uxp/uxp-api/reference-spectrum/
