<script setup>
import { ref } from "vue";

const label = ref("layers");
function onExport() {
  const cs = new CSInterface();
  cs.evalScript("listLayers()", function (result) {
    label.value = result;
  });
}
</script>

<template>
  <button type="button" @click="onExport">{{ label }}</button>
</template>
