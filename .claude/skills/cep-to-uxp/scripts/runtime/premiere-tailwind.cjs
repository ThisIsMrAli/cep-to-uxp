// Premiere ignores gap, drops escaped Tailwind selectors such as .mb-1\.5,
// and drops rgb(var(--token) / alpha). Require this from tailwind.config.js
// and set important: true.

function px(value) {
  if (typeof value !== "string") return null;
  if (value.endsWith("rem")) return `${parseFloat(value) * 16}px`;
  if (value.endsWith("px")) return value;
  return null;
}

function attr(name) {
  return `[class~="${name}"]`;
}

module.exports = function premiereTailwind({ addUtilities, theme }) {
  const spacing = theme("spacing") || {};
  const rules = {};
  const mark = (value) => `${value} !important`;
  for (const [key, raw] of Object.entries(spacing)) {
    const size = px(raw);
    if (!size) continue;
    if (String(key).includes(".")) {
      const box = (prefix, prop) => {
        rules[attr(`${prefix}-${key}`)] = { [prop]: mark(size) };
      };
      rules[attr(`m-${key}`)] = { margin: mark(size) };
      rules[attr(`mx-${key}`)] = { marginLeft: mark(size), marginRight: mark(size) };
      rules[attr(`my-${key}`)] = { marginTop: mark(size), marginBottom: mark(size) };
      box("mt", "marginTop");
      box("mr", "marginRight");
      box("mb", "marginBottom");
      box("ml", "marginLeft");
      rules[attr(`p-${key}`)] = { padding: mark(size) };
      rules[attr(`px-${key}`)] = { paddingLeft: mark(size), paddingRight: mark(size) };
      rules[attr(`py-${key}`)] = { paddingTop: mark(size), paddingBottom: mark(size) };
      box("pt", "paddingTop");
      box("pr", "paddingRight");
      box("pb", "paddingBottom");
      box("pl", "paddingLeft");
    }
    rules[`${attr(`gap-${key}`)} > * + *`] = { marginLeft: mark(size) };
    rules[`[class~="flex-col"]${attr(`gap-${key}`)} > * + *`] = {
      marginLeft: "0 !important",
      marginTop: mark(size)
    };
    rules[`[class~="flex-wrap"]${attr(`gap-${key}`)} > *`] = {
      marginRight: mark(size),
      marginBottom: mark(size)
    };
    rules[`[class~="flex-wrap"]${attr(`gap-${key}`)} > * + *`] = {
      marginLeft: "0 !important",
      marginTop: "0 !important"
    };
    rules[`${attr(`space-y-${key}`)} > * + *`] = { marginTop: mark(size) };
    rules[`${attr(`space-x-${key}`)} > * + *`] = { marginLeft: mark(size) };
  }

  const paint = {
    "text-ink": { color: "#e2e2e2" },
    "text-muted": { color: "#929292" },
    "text-faint": { color: "#686868" },
    "text-white": { color: "#ffffff" },
    "text-xs": { fontSize: "11px", lineHeight: "16px" },
    "text-sm": { fontSize: "12px", lineHeight: "18px" },
    "font-medium": { fontWeight: "500" },
    "font-mono": { fontFamily: "Menlo, Consolas, monospace" },
    uppercase: { textTransform: "uppercase", letterSpacing: "0.4px" },
    "bg-panel": { backgroundColor: "#181818" },
    "bg-surface": { backgroundColor: "#202020" },
    "bg-elevated": { backgroundColor: "#2a2a2a" }
  };
  for (const [paintName, declarations] of Object.entries(paint)) {
    const marked = {};
    for (const [prop, value] of Object.entries(declarations)) marked[prop] = mark(value);
    rules[attr(paintName)] = marked;
  }
  rules["input, textarea, select"] = {
    appearance: "none !important",
    backgroundColor: "#2a2a2a !important",
    color: "#e2e2e2 !important",
    border: "1px solid #3a3a3a !important",
    borderRadius: "4px !important",
    boxShadow: "none !important",
    outline: "none !important"
  };
  addUtilities(rules);
};
