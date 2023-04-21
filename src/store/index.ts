import { defineStore } from '../pinia';
export const useStore = defineStore('store', {
	state: () => ({
		count: 1,
	}),
	getters: {
		square(state) {
			return Math.pow(state.count, 2);
		},
	},
	actions: {
		increment() {
			this.count++;
		},
	},
	hydrate(state, initialState) {
		console.log("12312312",initialState);
		// 在这种情况下，我们可以完全忽略初始状态
		// 因为我们想从浏览器中读取数值
		state.count = 1000
	},
});
