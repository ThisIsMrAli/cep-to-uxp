/* CEP-to-UXP WebView shim.
   Replaces CSInterface.js inside the embedded page.
   Synchronous getters read window.__CEP_TO_UXP_BOOT__.
   evalScript and openURLInDefaultBrowser are asynchronous and round-trip through window.uxpHost.
   cep.fs and Node require are not polyfilled. The boot script may install a throwing fs and an
   in-memory localStorage when the real one throws. Those stand-ins do not save files or settings.
*/
(function (global) {
  var CHANNEL = "cep-to-uxp";
  var boot = global.__CEP_TO_UXP_BOOT__ || {};
  var seq = 0;
  var pending = {};
  var listeners = {};

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? {} : value));
  }

  function send(method, args) {
    return new Promise(function (resolve, reject) {
      if (!global.uxpHost || typeof global.uxpHost.postMessage !== "function") {
        reject(new Error("UXP WebView bridge is unavailable. Load this page from a UXP <webview> src."));
        return;
      }
      var id = ++seq;
      pending[id] = { resolve: resolve, reject: reject };
      global.uxpHost.postMessage({
        channel: CHANNEL,
        type: "call",
        id: id,
        method: method,
        args: args || {}
      });
    });
  }

  function dispatch(type, event) {
    var list = listeners[type] ? listeners[type].slice() : [];
    for (var i = 0; i < list.length; i += 1) list[i](event);
  }

  if (typeof global.addEventListener === "function") {
    global.addEventListener("message", function (event) {
      var data = event.data;
      if (!data || data.channel !== CHANNEL) return;
      if (data.type === "host-ready") {
        var payload = data.payload || {};
        if (payload.paths) boot.paths = payload.paths;
        if (payload.appVersion && boot.environment) boot.environment.appVersion = payload.appVersion;
        var theme = new CSEvent(CSInterface.THEME_COLOR_CHANGED_EVENT, "APPLICATION");
        dispatch(theme.type, theme);
        return;
      }
      if (data.type === "result") {
        var waiter = pending[data.id];
        if (!waiter) return;
        delete pending[data.id];
        if (data.ok) waiter.resolve(data.value);
        else waiter.reject(new Error(data.error || "UXP bridge call failed"));
        return;
      }
      if (data.type === "event" && data.payload) {
        var evt = new CSEvent(data.payload.type, "APPLICATION");
        evt.data = data.payload.data == null ? "" : String(data.payload.data);
        dispatch(evt.type, evt);
      }
    });
  }

  function SystemPath() {}
  SystemPath.USER_DATA = "userData";
  SystemPath.COMMON_FILES = "commonFiles";
  SystemPath.MY_DOCUMENTS = "myDocuments";
  SystemPath.APPLICATION = "application";
  SystemPath.EXTENSION = "extension";
  SystemPath.HOST_APPLICATION = "hostApplication";
  global.SystemPath = SystemPath;

  function CSEvent(type, scope, appId, extensionId) {
    this.type = type;
    this.scope = scope || "APPLICATION";
    this.appId = appId || (boot.environment && boot.environment.appId) || "";
    this.extensionId = extensionId || boot.extensionId || "";
    this.data = "";
  }
  global.CSEvent = CSEvent;

  function CSInterface() {}
  CSInterface.THEME_COLOR_CHANGED_EVENT = "com.adobe.csxs.events.ThemeColorChanged";

  CSInterface.prototype.getHostEnvironment = function () {
    return clone(boot.environment || {});
  };

  CSInterface.prototype.getExtensionID = function () {
    return boot.extensionId || "";
  };

  CSInterface.prototype.getApplicationID = function () {
    return (boot.environment && boot.environment.appId) || "";
  };

  CSInterface.prototype.getHostCapabilities = function () {
    return clone(boot.capabilities || {});
  };

  CSInterface.prototype.getCurrentApiVersion = function () {
    return clone(boot.apiVersion || { major: 0, minor: 0, micro: 0 });
  };

  CSInterface.prototype.getOSInformation = function () {
    if (boot.os) return boot.os;
    if (typeof navigator !== "undefined" && navigator.platform) return navigator.platform;
    return "";
  };

  CSInterface.prototype.getScaleFactor = function () {
    return global.devicePixelRatio || 1;
  };

  CSInterface.prototype.setScaleFactorChangedHandler = function () {};

  CSInterface.prototype.getSystemPath = function (pathType) {
    var paths = boot.paths || {};
    if (pathType === SystemPath.EXTENSION) return paths.extension || "plugin:/";
    if (pathType === SystemPath.USER_DATA) return paths.userData || "plugin-data:/";
    return "";
  };

  CSInterface.prototype.evalScript = function (script, callback) {
    send("evalScript", { script: String(script) }).then(
      function (value) {
        if (typeof callback === "function") callback(value);
      },
      function (error) {
        if (typeof callback === "function") callback(error && error.message ? error.message : String(error));
      }
    );
  };

  CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    send("openExternal", { url: String(url) });
  };

  CSInterface.prototype.closeExtension = function () {
    send("unsupported", { api: "closeExtension" });
  };

  CSInterface.prototype.resizeContent = function () {
    send("unsupported", { api: "resizeContent" });
  };

  CSInterface.prototype.setWindowTitle = function () {};
  CSInterface.prototype.getWindowTitle = function () {
    return "";
  };

  CSInterface.prototype.addEventListener = function (type, listener) {
    if (typeof listener !== "function" || !type) return;
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(listener);
  };

  CSInterface.prototype.removeEventListener = function (type, listener) {
    var list = listeners[type] || [];
    listeners[type] = list.filter(function (item) {
      return item !== listener;
    });
  };

  CSInterface.prototype.dispatchEvent = function (event) {
    if (!event || !event.type) return;
    dispatch(event.type, event);
    send("unsupported", { api: "dispatchEvent", type: event.type });
  };

  CSInterface.prototype.requestOpenExtension = function () {
    send("unsupported", { api: "requestOpenExtension" });
  };

  CSInterface.prototype.getExtensions = function () {
    return [];
  };

  CSInterface.prototype.getNetworkPreferences = function () {
    return {};
  };

  CSInterface.prototype.initResourceBundle = function () {
    return {};
  };

  CSInterface.prototype.dumpInstallationInfo = function () {
    return "";
  };

  CSInterface.prototype.setPanelFlyoutMenu = function () {
    send("unsupported", { api: "setPanelFlyoutMenu" });
  };

  CSInterface.prototype.updatePanelMenuItem = function () {};
  CSInterface.prototype.setContextMenu = function () {};
  CSInterface.prototype.setContextMenuByJSON = function () {};
  CSInterface.prototype.updateContextMenuItem = function () {};

  CSInterface.prototype.registerKeyEventsInterest = function () {
    send("unsupported", { api: "registerKeyEventsInterest" });
  };

  global.CSInterface = CSInterface;

  global.__adobe_cep__ = {
    getHostEnvironment: function () {
      return JSON.stringify(new CSInterface().getHostEnvironment());
    },
    evalScript: function (script, callback) {
      new CSInterface().evalScript(script, callback);
    },
    getSystemPath: function (pathType) {
      return new CSInterface().getSystemPath(pathType);
    },
    closeExtension: function () {
      new CSInterface().closeExtension();
    },
    openURLInDefaultBrowser: function (url) {
      new CSInterface().openURLInDefaultBrowser(url);
    },
    resizeContent: function () {
      new CSInterface().resizeContent();
    },
    addEventListener: function (type, listener) {
      new CSInterface().addEventListener(type, listener);
    },
    removeEventListener: function (type, listener) {
      new CSInterface().removeEventListener(type, listener);
    },
    getOSInformation: function () {
      return new CSInterface().getOSInformation();
    },
    getCurrentApiVersion: function () {
      return JSON.stringify(new CSInterface().getCurrentApiVersion());
    },
    getScaleFactor: function () {
      return new CSInterface().getScaleFactor();
    },
    getExtensionId: function () {
      return new CSInterface().getExtensionID();
    },
    invokeSync: function () {
      return "";
    },
    invokeAsync: function () {
      for (var i = arguments.length - 1; i >= 0; i -= 1) {
        if (typeof arguments[i] === "function") {
          arguments[i]("");
          return;
        }
      }
    }
  };

  global.cepToUxp = {
    http: function (options) {
      return send("http", options || {}).then(function (value) {
        if (typeof value !== "string") return value;
        try {
          return JSON.parse(value);
        } catch (error) {
          return { ok: false, status: 0, text: value, events: [] };
        }
      });
    }
  };
})(window);
