export default function Log(content: string, ...props: any): void {
	const paramsArr = Array.from(props);
	console.log(
		`%c 🍍 RUNNING => %c ${content} %c ${paramsArr.length ? 'params: ' + JSON.stringify(paramsArr) : ''}`,
		'padding: 2px 1px; border-radius: 3px 0 0 3px; color: #fff; background: #42c02e; font-weight: bold;',
		'padding: 2px 1px; border-radius: 0 3px 3px 0; color: #fff; background: #606060; font-weight: bold;',
		'color: red'
	);
}
