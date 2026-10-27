var cs = new CSInterface();
document.getElementById("app").textContent = "vue";
cs.evalScript("listLayers()", function (result) {
  console.log(result);
});
