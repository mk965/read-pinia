<template>
    <div>
        <button @click="add">mapActions - add： +1</button>
        <button @click="increment">mapActions - increment： +1</button>
        <br />
        <div>平方：{{ square }}</div>
        <br />
        <button @click="mapStateCountAdd">{{ mapStateCount }} mapStateCount 直接修改 state 会有警告</button>
        <button @click="mapWritableStateCountAdd">{{ mapWritableStateCount }} mapWritableStateCount 直接修改 state 没有警告</button>
    </div>
</template>

<script lang="ts">
import { mapActions, mapState, mapStores, mapWritableState } from '../pinia';
import { useStore } from '../store';
export default {
    data: () => ({

    }),
    methods: {
        ...mapActions(useStore, { add: 'increment' }),
        ...mapActions(useStore, ['increment']),
        mapStateCountAdd() {
            this.mapStateCount++;
        },
        mapWritableStateCountAdd() {
            this.mapWritableStateCount++;
        }
    },
    computed: {
        ...mapStores(useStore),
        ...mapState(useStore, { mapStateCount: 'count' }),
        ...mapState(useStore, ['square']),
        ...mapWritableState(useStore, { mapWritableStateCount: 'count' }),
    },
    created() {
        this.add();
        const mapWritableStateResult = mapWritableState(useStore, { mapWritableStateCount: 'count' });
        console.log("----", mapWritableStateResult.mapWritableStateCount)

        console.log(this.$data)
        // const target = {
        //     get() {
        //         console.log("get")
        //     },
        //     set(t, n) {
        //         console.log("set", t, n)
        //     }
        // }
        // const mapWritableStateResultProxy = new Proxy(target, {
        //     get() {
        //         console.log("get")
        //     },
        //     set(t, n) {
        //         console.log("set", t, n)
        //     }
        // });
        // console.log(mapWritableStateResultProxy)

        // this.mapWritableStateResultProxy = mapWritableStateResultProxy
    }
}
</script>

<style lang="scss" scoped></style>