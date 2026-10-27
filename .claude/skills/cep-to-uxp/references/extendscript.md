# Rewriting ExtendScript

`host-handlers.js` exports `evalExtendScript(script)`. Each exact CEP call is a key. The function must return a string, because the page's callback used to receive a string.

```js
"sayHello()": async () => "hello from extendscript"
```

Leave the `throw` in place when the JSX touches the document and you cannot see the real behavior. A thrown error is delivered to the old callback as text. Do not replace it with a guessed document mutation.

## Photoshop

```js
const { app, core } = require("photoshop");

async function renameActiveLayer() {
  let name = "";
  await core.executeAsModal(async () => {
    const doc = app.activeDocument;
    if (!doc) throw new Error("No active document");
    doc.activeLayers[0].name = "Migrated";
    name = doc.activeLayers[0].name;
  }, { commandName: "Rename layer" });
  return name;
}
```

Use `action.batchPlay` only for an operation the DOM does not expose. Copy the descriptor from a recorded action or the Photoshop API reference. Do not invent event ids or OSTypes. `batchPlay` does not exist in InDesign, Premiere, or Media Encoder.

Property getters on the Photoshop DOM are often synchronous. Methods that change the document are modal. `await` the modal call. Do not block the panel with a busy loop.

## InDesign and Premiere

Read `legacy-extendscript/` and reimplement the behavior with that host's UXP DOM. The usual modules are `require("indesign")` and `require("premierepro")`. Confirm both in the current host API before shipping. Do not wrap those calls in Photoshop's `executeAsModal`.

For a Premiere retarget, `host-premiere.js` already contains the calls Adobe's 25.6 sample uses. Use those instead of leaving a matching `evalTS` name as a throw:

- `Project.getActiveProject`, `getActiveSequence`, `getSequences`, `getRootItem`
- `createSequence(name)`, `openSequence`, `setActiveSequence`
- Frame size through `Sequence.getSettings()`, `new RectF()` with `width` and `height`, `setVideoFrameRect`, then `createSetSettingsAction` inside `lockedAccess` and `executeTransaction`
- Track items through `getVideoTrack(index).getTrackItems()`

`createSequence(name)` is the one-argument form. `createSequenceWithPresetPath` is 26.3 and needs a `.sqpreset` path, so the generated file does not call it. If a sequence with that name already exists, activate it instead of creating another. JSX you cannot read stays an explicit throw. Do not invent methods that are not in that file.

## Arguments

`exportSelection("png")` is one exact key. A call built with string concatenation is dynamic: it falls through to the default branch. Parse `script` there only when the grammar is small and testable. Otherwise change the page to send a structured bridge method instead of a script string, and keep the shim's `evalScript` path for the calls you have not moved yet.

## Files

`legacy-extendscript/` is reference material. Do not add those JSX files to `manifest.json`, and do not `eval` them with `allowCodeGenerationFromStrings`.
