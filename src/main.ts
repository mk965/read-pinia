import { App as Apptype, createApp } from 'vue';
import './style.css';
import App from './App.vue';
import { createPinia } from './pinia';
import Log from './utils/log';

const pinia = createPinia();

// 给 pinia 安装插件
pinia.use((prop) => {
	Log('Pinia 插件使用');
	console.log('插件获取到的参数：', prop);
	return {
		$aaa: (param: string) => {
			console.log('这里是插件安装到 Pinia 上的功能');
			console.log('prop', prop);
			console.log('param', param);
		},
	};
});

Log('main.ts');
createApp(App).use(pinia).mount('#app');
