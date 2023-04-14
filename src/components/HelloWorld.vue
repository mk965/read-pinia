<script setup lang="ts">
import { computed, ref } from 'vue';
import { useStore } from '../store';

const store = useStore();
const count = computed(() => store.count);

</script>

<template>
  <div class="card">
    <button type="button" @click="store.increment">count is {{ count }}</button>
  </div>
</template>

<style scoped>
.read-the-docs {
  color: #888;
}
</style>
