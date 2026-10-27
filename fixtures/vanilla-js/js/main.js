var cs = new CSInterface();

function onReady() {
  var env = cs.getHostEnvironment();
  document.getElementById("host").textContent = env.appName;
  cs.setPanelFlyoutMenu('<Menu><MenuItem Id="refresh" Label="Refresh"/></Menu>');
  document.getElementById("run").addEventListener("click", function () {
    cs.evalScript("sayHello()", function (result) {
      document.getElementById("result").textContent = result;
    });
  });
  document.getElementById("site").addEventListener("click", function () {
    cs.openURLInDefaultBrowser("https://developer.adobe.com/uxp/");
  });
}

document.addEventListener("DOMContentLoaded", onReady);
