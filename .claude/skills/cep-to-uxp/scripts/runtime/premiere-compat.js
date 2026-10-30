(function () {
  function SilentObserver() {
    this._observer = this;
  }
  SilentObserver.prototype.observe = function () {};
  SilentObserver.prototype.unobserve = function () {};
  SilentObserver.prototype.disconnect = function () {};
  SilentObserver.prototype.takeRecords = function () { return []; };

  function install(name) {
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        writable: true,
        value: SilentObserver
      });
    } catch (error) {
      window[name] = SilentObserver;
    }
    globalThis[name] = window[name];
  }

  install("IntersectionObserver");
  install("ResizeObserver");
  if (typeof window.MutationObserver !== "function") install("MutationObserver");

  var tags = {
    HTMLFormElement: "form",
    HTMLInputElement: "input",
    HTMLSelectElement: "select",
    HTMLTextAreaElement: "textarea",
    HTMLButtonElement: "button",
    HTMLIFrameElement: "iframe",
    HTMLOptionElement: "option",
    HTMLLabelElement: "label"
  };

  function ensureSetter(ctor, prop) {
    if (!ctor || !ctor.prototype) return;
    var current = Object.getOwnPropertyDescriptor(ctor.prototype, prop);
    if (current && typeof current.set === "function") return;
    Object.defineProperty(ctor.prototype, prop, {
      configurable: true,
      enumerable: true,
      get: function () {
        return this["__cepToUxp_" + prop];
      },
      set: function (value) {
        this["__cepToUxp_" + prop] = value;
      }
    });
  }

  var name;
  for (name in tags) {
    if (typeof globalThis[name] === "function") continue;
    var ctor = null;
    try {
      var el = document.createElement(tags[name]);
      if (el && typeof el.constructor === "function" && el.constructor !== Object) ctor = el.constructor;
    } catch (error) {
      ctor = null;
    }
    if (!ctor) ctor = function MissingDomElement() {};
    globalThis[name] = ctor;
    try {
      window[name] = ctor;
    } catch (error) {
      /* Premiere may already own the binding. */
    }
  }
  ensureSetter(globalThis.HTMLInputElement, "checked");
  ensureSetter(globalThis.HTMLInputElement, "value");
  ensureSetter(globalThis.HTMLSelectElement, "value");

  if (typeof NodeFilter !== "function" && typeof NodeFilter !== "object") {
    var Filter = function NodeFilter() {};
    Filter.FILTER_ACCEPT = 1;
    Filter.FILTER_REJECT = 2;
    Filter.FILTER_SKIP = 3;
    Filter.SHOW_ALL = 4294967295;
    Filter.SHOW_ELEMENT = 1;
    Filter.SHOW_TEXT = 4;
    Filter.SHOW_COMMENT = 128;
    globalThis.NodeFilter = Filter;
    try {
      NodeFilter = Filter;
    } catch (error) {
      /* The assignment above is enough when the name is already bound. */
    }
  }

  function collectElements(root, into) {
    var child = root && root.firstChild;
    while (child) {
      if (child.nodeType === 1) {
        into.push(child);
        collectElements(child, into);
      }
      child = child.nextSibling;
    }
    return into;
  }

  function makeTreeWalker(root, whatToShow, filter) {
    var nodes = [];
    var all = collectElements(root, []);
    var i;
    for (i = 0; i < all.length; i += 1) {
      var node = all[i];
      var verdict = 1;
      try {
        if (typeof filter === "function") verdict = filter(node);
        else if (filter && typeof filter.acceptNode === "function") verdict = filter.acceptNode(node);
      } catch (error) {
        verdict = 1;
      }
      if (verdict === 1) nodes.push(node);
    }
    var index = -1;
    return {
      root: root,
      currentNode: root,
      whatToShow: whatToShow || 1,
      filter: filter || null,
      nextNode: function () {
        index += 1;
        if (index >= nodes.length) return null;
        this.currentNode = nodes[index];
        return this.currentNode;
      },
      previousNode: function () {
        if (index <= 0) return null;
        index -= 1;
        this.currentNode = nodes[index];
        return this.currentNode;
      }
    };
  }

  function hardenDocument(doc) {
    if (!doc || doc === document) return document;
    if (typeof doc.createElement !== "function") {
      doc.createElement = function (tag, options) {
        return document.createElement(tag, options);
      };
    }
    if (typeof doc.createElementNS !== "function") {
      doc.createElementNS = function (ns, tag) {
        return document.createElementNS ? document.createElementNS(ns, tag) : document.createElement(tag);
      };
    }
    if (typeof doc.createTreeWalker !== "function") {
      doc.createTreeWalker = function (root, whatToShow, filter) {
        return makeTreeWalker(root, whatToShow, filter);
      };
    }
    if (!doc.defaultView) doc.defaultView = window;
    if (!doc.body) doc.body = document.body;
    return doc;
  }

  var nodeProto = window.Node && Node.prototype;
  if (nodeProto) {
    var ownerDesc = Object.getOwnPropertyDescriptor(nodeProto, "ownerDocument");
    var ownerGet = ownerDesc && ownerDesc.get;
    try {
      Object.defineProperty(nodeProto, "ownerDocument", {
        configurable: true,
        get: function () {
          if (this && this.nodeType === 9 && typeof this.createElement === "function") return this;
          var value = null;
          try {
            value = ownerGet ? ownerGet.call(this) : null;
          } catch (error) {
            value = null;
          }
          if (!value) return document;
          return hardenDocument(value);
        }
      });
    } catch (error) {
      /* Leave the host getter when it cannot be replaced. */
    }
  }

  if (!document.defaultView) {
    try {
      Object.defineProperty(document, "defaultView", {
        configurable: true,
        get: function () {
          return window;
        }
      });
    } catch (error) {
      document.defaultView = window;
    }
  }

  if (window.Document && Document.prototype) {
    Document.prototype.createTreeWalker = function (root, whatToShow, filter) {
      return makeTreeWalker(root, whatToShow, filter);
    };
  }

  if (window.Element && Element.prototype.setAttribute) {
    var setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (attr, value) {
      if ((attr === "stroke" || attr === "fill") && value === "currentColor") value = "#d8d8d8";
      if ((attr === "width" || attr === "height") && /^[\d.]+$/.test(String(value))) value = String(value) + "px";
      return setAttribute.call(this, attr, value);
    };
  }

  try {
    window.localStorage.getItem("__cep_to_uxp_probe");
  } catch (error) {
    var memory = {};
    var store = {
      getItem: function (key) {
        return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
      },
      setItem: function (key, value) {
        memory[String(key)] = String(value);
      },
      removeItem: function (key) {
        delete memory[key];
      },
      clear: function () {
        memory = {};
      },
      key: function (index) {
        return Object.keys(memory)[index] || null;
      }
    };
    Object.defineProperty(store, "length", {
      get: function () {
        return Object.keys(memory).length;
      }
    });
    try {
      Object.defineProperty(window, "localStorage", { configurable: true, value: store });
    } catch (defineError) {
      window.localStorage = store;
    }
  }
})();
