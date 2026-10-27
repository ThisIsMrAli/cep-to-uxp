// Host-side HTTP for a UXP plugin. The WebView must not fetch remote APIs itself:
// plugin:/ pages are blocked by CORS even when the origin is in webview.domains.
// Put the origin in network.domains. This file runs in the host, which has no
// TextDecoder, TextEncoder, localStorage, child_process, or listening socket.

function decodeUtf8(bytes, pending) {
  const input = pending.concat(Array.from(bytes || []));
  pending.length = 0;
  let out = "";
  let i = 0;
  while (i < input.length) {
    const lead = input[i];
    let size = 1;
    let code = lead;
    if (lead >= 0x80 && lead < 0xc0) {
      i += 1;
      continue;
    } else if (lead >= 0xc0 && lead < 0xe0) {
      size = 2;
      code = lead & 0x1f;
    } else if (lead >= 0xe0 && lead < 0xf0) {
      size = 3;
      code = lead & 0x0f;
    } else if (lead >= 0xf0 && lead < 0xf8) {
      size = 4;
      code = lead & 0x07;
    }
    if (i + size > input.length) {
      pending.push(...input.slice(i));
      break;
    }
    let valid = true;
    for (let part = 1; part < size; part += 1) {
      const next = input[i + part];
      if ((next & 0xc0) !== 0x80) valid = false;
      code = (code << 6) | (next & 0x3f);
    }
    out += valid ? String.fromCodePoint(code) : "\uFFFD";
    i += size;
  }
  return out;
}

function parseSse(text) {
  const events = [];
  const blocks = String(text || "").split(/\n\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    let event = "message";
    const data = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    events.push({ event, data: data.join("\n") });
  }
  return events;
}

async function readBody(response) {
  const pending = [];
  const body = response && response.body;
  if (!body || typeof body.getReader !== "function") {
    const text = typeof response.text === "function" ? await response.text() : "";
    return { text: String(text || ""), events: parseSse(text) };
  }
  const reader = body.getReader();
  let text = "";
  for (;;) {
    const step = await reader.read();
    if (step.value) text += decodeUtf8(step.value, pending);
    if (step.done) break;
  }
  if (pending.length) text += decodeUtf8([], pending);
  return { text, events: parseSse(text) };
}

async function request(args) {
  const url = String((args && args.url) || "");
  if (!url) throw new Error("Host http bridge needs a url.");
  const response = await fetch(url, {
    method: (args && args.method) || "GET",
    headers: (args && args.headers) || {},
    body: args && args.body != null ? String(args.body) : undefined
  });
  const body = await readBody(response);
  return {
    ok: Boolean(response.ok),
    status: response.status,
    text: body.text,
    events: body.events
  };
}

module.exports = { decodeUtf8, parseSse, request };
