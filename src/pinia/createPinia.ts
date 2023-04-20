import { Pinia, PiniaPlugin, setActivePinia, piniaSymbol } from './rootStore';
import { ref, App, markRaw, effectScope, isVue2, Ref } from 'vue-demi';
import { registerPiniaDevtools, devtoolsPlugin } from './devtools';
import { USE_DEVTOOLS } from './env';
import { StateTree, StoreGeneric } from './types';
import Log from '../utils/log';

/**
 * 创建应用程序要使用的Pinia实例
 */
export function createPinia(): Pinia {
	Log("createPinia()");

	/**
	 * effectScope:
	 * 创建一个 effect 作用域，可以捕获其中所创建的响应式副作用 (即计算属性和侦听器)，这样捕获到的副作用可以一起处理。对于该 API 的使用细节，请查阅对应的 RFC。
	 */
	const scope = effectScope(true);
	// NOTE: 在这里，我们可以检查窗口对象的状态，并直接设置它
	// 如果有类似Vue 3 SSR的东西
	const state = scope.run<Ref<Record<string, StateTree>>>(() => ref<Record<string, StateTree>>({}))!;

	// 所有需要安装的插件
	let _p: Pinia['_p'] = [];
	// 在调用 app.use(pinia) 前需要安装的插件
	let toBeInstalled: PiniaPlugin[] = [];

	// 使用 markRaw 包裹的 pinia 使其不会变为响应式
	const pinia: Pinia = markRaw({
		// app.use 执行的逻辑
		install(app: App) {
			Log('createPinia 插件的 install 阶段');
			// 设置当前使用的 pinia 实例
			setActivePinia(pinia);
			// 如果是 vue2 ，全局注册已经在 PiniaVuePlugin 完成，所以这段逻辑将跳过
			if (!isVue2) {
				// app 实例
				pinia._a = app;
				// 通过 provide 传递 pinia 实例，提供给后续使用
				app.provide(piniaSymbol, pinia);
				// 设置全局属性 $pinia
				app.config.globalProperties.$pinia = pinia;
				/* istanbul ignore else */
				if (USE_DEVTOOLS) {
					registerPiniaDevtools(app, pinia);
        }
				// 处理未执行插件
        toBeInstalled.forEach((plugin) => _p.push(plugin));
        // 处理完插件后清空
				toBeInstalled = [];
			}
		},

    /**
     * 为 Pinia 提供安装插件的能力
     * @param plugin 
     * @returns Pinia
     */
    use(plugin) {
      // 如果 use 阶段初始化完成则暂存 toBeInstalled 中
			if (!this._a && !isVue2) {
				toBeInstalled.push(plugin);
			} else {
				_p.push(plugin);
			}
			return this;
		},

		_p, // 所有的 pinia 插件
		// it's actually undefined here
		// @ts-expect-error
		_a: null,   // vue 实例，在 install 阶段设置
		_e: scope,  // pinia 的作用域对象，每个 store 都有单独的 scope
		_s: new Map<string, StoreGeneric>(),  // store 缓存，key 为 pinia 的 id，value 为 pinia 对外暴漏的数据
		state,      // pinia 所有的 state 的合集，key 为 pinia 的 id，value 为 store 下所有的 state
	});

	// pinia devtools rely on dev only features so they cannot be forced unless
	// pinia开发工具依赖于仅用于开发的功能，因此除非
	// the dev build of Vue is used. Avoid old browsers like IE11.
	// 使用Vue的开发版本。避免使用像IE11这样的旧浏览器。
	if (USE_DEVTOOLS && typeof Proxy !== 'undefined') {
		pinia.use(devtoolsPlugin);
	}

	return pinia;
}
