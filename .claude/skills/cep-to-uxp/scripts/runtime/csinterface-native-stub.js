/* Native UXP build.
   This file replaces CSInterface.js so a leftover call fails with an actionable error.
   A native panel has no embedded browser bridge. Call require("uxp") and the host module
   (require("photoshop"), require("indesign"), or require("premierepro")) from the plugin script.
*/
function CSInterface() {
  throw new Error(
    "CSInterface is a CEP API. This native UXP build has no WebView bridge. Rewrite the call in the plugin script. See MIGRATION.md."
  );
}
CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";
