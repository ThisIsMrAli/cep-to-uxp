var cs = new CSInterface();
var child = require("child_process");
window.cep.process.createProcess("/usr/bin/true");
cs.evalScript("runExport()", function (result) {
  console.log(child, result);
});
