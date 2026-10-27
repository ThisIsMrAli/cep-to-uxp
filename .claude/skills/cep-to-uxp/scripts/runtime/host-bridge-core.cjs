// Message router shared by the UXP shell. Copied into each converted plugin.
// WebView pages talk to this process with postMessage. ExtendScript does not run here.

const CHANNEL = "cep-to-uxp";

function isOurMessage(data) {
  return Boolean(data) && typeof data === "object" && data.channel === CHANNEL;
}

function createRouter(handlers) {
  const seen = new Set();

  return async function onMessage(data, reply) {
    if (!isOurMessage(data) || data.type !== "call") return false;
    if (data.id == null || seen.has(data.id)) return true;
    seen.add(data.id);
    const args = data.args || {};
    try {
      let value;
      if (data.method === "evalScript") {
        value = await handlers.evalScript(String(args.script ?? ""));
      } else if (data.method === "openExternal") {
        value = await handlers.openExternal(String(args.url ?? ""));
      } else if (data.method === "http") {
        if (typeof handlers.http !== "function") throw new Error("Unknown bridge method: http");
        value = await handlers.http(args);
      } else if (data.method === "unsupported") {
        if (typeof handlers.unsupported === "function") handlers.unsupported(args);
        value = "";
      } else {
        throw new Error(`Unknown bridge method: ${data.method}`);
      }
      reply({
        channel: CHANNEL,
        type: "result",
        id: data.id,
        ok: true,
        value: value == null ? "" : typeof value === "string" ? value : JSON.stringify(value)
      });
    } catch (error) {
      reply({
        channel: CHANNEL,
        type: "result",
        id: data.id,
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    }
    return true;
  };
}

module.exports = { CHANNEL, isOurMessage, createRouter };
