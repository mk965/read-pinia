<script setup lang="ts">
import { computed, reactive, ref, toRefs, watch } from 'vue';
import { useStore } from '../store';
import Log from '../utils/log';

Log('Component setup');

const store = useStore();
const count = computed(() => store.count);

const patch = () => {
  console.log("patch");
  store.$patch({ count: 100 });
  store.$patch((state) => state.count += 200);
  return "我是patch函数返回的内容"
}

store.$subscribe(() => {
  console.log("订阅收到通知")
})


store.$onAction(({ after, onError }) => {
  after((resolvedValue) => {
    console.log("after", resolvedValue)
  })
  onError((error) => {
    console.log("错误")
  })
})


store.$aaa('使用插件时传递的参数');

</script>

<template>
  <div class="card">
    <button type="button" @click="store.increment">count is {{ count }}</button>
    <button type="button" @click="patch">Patch</button>
  </div>
</template>

<style scoped>
.read-the-docs {
  color: #888;
}
</style>
