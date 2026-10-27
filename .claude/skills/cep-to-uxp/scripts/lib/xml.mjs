function decode(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseXml(source) {
  const xml = source
    .replace(/^\uFEFF/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .trim();
  let index = 0;

  function skipWhitespace() {
    while (index < xml.length && /\s/.test(xml[index])) index += 1;
  }

  function readName() {
    const start = index;
    while (index < xml.length && /[A-Za-z0-9_:.-]/.test(xml[index])) index += 1;
    if (start === index) {
      throw new Error(`Expected an XML name at offset ${index}`);
    }
    return xml.slice(start, index);
  }

  function readQuoted() {
    const quote = xml[index];
    if (quote !== '"' && quote !== "'") {
      throw new Error(`Expected a quoted attribute at offset ${index}`);
    }
    index += 1;
    const start = index;
    while (index < xml.length && xml[index] !== quote) index += 1;
    if (xml[index] !== quote) throw new Error("Unterminated XML attribute");
    const value = decode(xml.slice(start, index));
    index += 1;
    return value;
  }

  function parseNode() {
    skipWhitespace();
    if (xml[index] !== "<" || xml.startsWith("</", index)) return null;
    index += 1;
    const tag = readName();
    const attrs = {};
    while (index < xml.length) {
      skipWhitespace();
      if (xml.startsWith("/>", index)) {
        index += 2;
        return { tag, attrs, children: [] };
      }
      if (xml[index] === ">") {
        index += 1;
        break;
      }
      const name = readName();
      skipWhitespace();
      if (xml[index] !== "=") throw new Error(`Expected '=' after ${name}`);
      index += 1;
      skipWhitespace();
      attrs[name] = readQuoted();
    }

    const children = [];
    let text = "";
    while (index < xml.length) {
      if (xml.startsWith("</", index)) {
        index += 2;
        const end = readName();
        if (end !== tag) throw new Error(`Expected </${tag}> but found </${end}>`);
        skipWhitespace();
        if (xml[index] !== ">") throw new Error(`Unclosed </${tag}>`);
        index += 1;
        break;
      }
      if (xml[index] === "<") {
        if (text.trim()) children.push({ text: decode(text.trim()) });
        text = "";
        const child = parseNode();
        if (child) children.push(child);
      } else {
        text += xml[index];
        index += 1;
      }
    }
    if (text.trim()) children.push({ text: decode(text.trim()) });
    return { tag, attrs, children };
  }

  const root = parseNode();
  if (!root) throw new Error("XML document is empty");
  return root;
}

export function elements(node, tag) {
  if (!node || !node.children) return [];
  return node.children.filter((child) => child.tag === tag);
}

export function first(node, tag) {
  return elements(node, tag)[0] || null;
}

export function textOf(node, tag) {
  const child = tag ? first(node, tag) : node;
  if (!child || !child.children) return "";
  return child.children
    .filter((item) => typeof item.text === "string")
    .map((item) => item.text)
    .join("")
    .trim();
}

export function descendants(node, tag, found = []) {
  if (!node || !node.children) return found;
  for (const child of node.children) {
    if (child.tag === tag) found.push(child);
    descendants(child, tag, found);
  }
  return found;
}
