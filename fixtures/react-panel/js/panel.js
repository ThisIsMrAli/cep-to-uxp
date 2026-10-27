var cs = new CSInterface();
fetch("https://api.example.com/v1/items");
document.getElementById("run").onclick = function () {
  cs.evalScript('exportSelection("png")', function (result) {
    document.getElementById("result").textContent = result;
  });
};
