import path from "node:path";

export function relativeUrl(fromFile, toFile) {
  let relative = path.relative(path.dirname(fromFile), toFile);
  if (!relative.startsWith(".")) relative = `.${path.sep}${relative}`;
  return relative.split(path.sep).join("/");
}

export function injectBeforeCsInterface(html, bootSrc) {
  const bootTag = `<script src="${bootSrc}"></script>`;
  const pattern = /<script\b[^>]*\bsrc\s*=\s*(['"])[^'"]*CSInterface\.js\1[^>]*>\s*<\/script>/i;
  if (pattern.test(html)) return html.replace(pattern, (match) => `${bootTag}\n${match}`);
  return injectAtHead(html, bootTag);
}

export function injectScripts(html, sources) {
  const tags = sources.map((source) => `<script src="${source}"></script>`).join("\n");
  return injectAtHead(html, tags);
}

export function stripNodePreloads(html, names) {
  const blocked = new Set(names || []);
  if (!blocked.size) return html;
  return html.replace(/<script\b[^>]*>\s*<\/script>/gi, (full) => {
    const src = full.match(/\bsrc\s*=\s*(['"])([^'"]+)\1/i);
    if (!src) return full;
    const base = src[2].split("?")[0].split("/").pop();
    if (!blocked.has(base)) return full;
    return `<!-- cep-to-uxp removed Node preload ${base}. Loading it does not provide window.fs or window.path. It throws in the WebView before those assignments and blanks the panel. -->`;
  });
}

function injectAtHead(html, tags) {
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n${tags}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (match) => `${match}\n<head>\n${tags}\n</head>`);
  }
  return `${tags}\n${html}`;
}
