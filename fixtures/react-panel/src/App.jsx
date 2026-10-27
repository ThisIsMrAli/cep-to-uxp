import React from "react";

export function App({ csInterface }) {
  const saved = localStorage.getItem("panel-tab") || "layers";
  function onExport() {
    csInterface.evalScript('exportSelection("png")', function (result) {
      console.log(result);
    });
  }
  return React.createElement("button", { onClick: onExport }, saved);
}
