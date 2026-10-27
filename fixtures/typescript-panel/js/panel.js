var cs = new CSInterface();
document.getElementById("run").addEventListener("click", function () {
  cs.evalScript("placeText()", function (result) {
    console.log(result);
  });
});
