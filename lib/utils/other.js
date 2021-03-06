"use strict";

module.exports = {
	$: async (...$) => (await shell(...$)).stdout,
	round,
	getPrecision,
	getProperties,
	wait,
	setTheme,
	pipe,
	shell,
	sortForRegExp,
	tsvTable,
	waitToLoad,
};


/**
 * Round off a fractional value using arbitrary precision.
 *
 * @param {Number} value
 * @param {Number} [precision = 0]
 * @return {Number}
 */
function round(value, precision = 0){
	const factor = Math.pow(10, precision);
	return Math.round(value * factor) / factor;
}


/**
 * Return the number of digits after a value's decimal point.
 *
 * @example getPrecision(8.23); => 2
 * @param {Number} value
 * @return {Number}
 */
function getPrecision(value){
	return /\./.test(value)
		? value.toString().split(".").slice(1).join("").length
		: 0;
}


/**
 * Retrieve a descriptor for each property available on an object.
 *
 * Both inherited and non-enumerable properties are included.
 * The usual rules of prototypal inheritance apply; redefined
 * properties replace their inherited counterparts.
 *
 * @param {Object} subject
 * @return {Map} A list of property descriptors keyed by name.
 * @example getProperties(foo) == Map{"keys" => descriptors}
 * @version Alhadis/Utils@20442bd
 */
function getProperties(subject){
	let object = subject;
	const refs = new WeakSet();
	const ancestry = [subject];
	while((object = Object.getPrototypeOf(object)) && !refs.has(object))
		ancestry.push(object);
	
	const result = new Map();
	for(const obj of ancestry.reverse()){
		const names = Object.getOwnPropertyNames(obj);
		for(const name of names){
			const desc = Object.getOwnPropertyDescriptor(obj, name);
			result.set(name, desc);
		}
	}
	
	return result;
}


/**
 * Return a {@link Promise} that resolves after a delay.
 *
 * @param {Number} [delay=100] - Milliseconds to wait
 * @return {Promise}
 */
function wait(delay = 100){
	return new Promise(resolve => {
		setTimeout(() => resolve(), delay);
	});
}


/**
 * Change the active Atom themes.
 *
 * @example setTheme("one-dark").then(() => …);
 * @param {...String} names - Theme IDs, sans suffix.
 * @return {Promise}
 */
function setTheme(...names){
	const [ui, syntax] = names.length < 2
		? [`${names[0]}-ui`, `${names[0]}-syntax`]
		: names;
	
	return Promise.all([
		atom.packages.activatePackage(ui),
		atom.packages.activatePackage(syntax)
	]).then(() => {
		atom.config.set("core.themes", [ui, syntax]);
		atom.themes.addActiveThemeClasses();
		atom.themes.loadBaseStylesheets();
		atom.themes.emitter.emit("did-change-active-themes");
	}).then(() => wait(500));
}


/**
 * Pipe data through a child process.
 *
 * @param {String} input
 * @param {String} command
 * @param {Array} [argv=[]]
 * @return {Promise}
 */
async function pipe(input, cmd, argv = []){
	return await new Promise(done => {
		const {spawn} = require("child_process");
		const process = spawn(cmd, argv);
		let stdout = "";
		let stderr = "";
		process.stdin.write(input);
		process.stdin.end();
		process.stdout.on("data", chunk => stdout += chunk);
		process.stderr.on("data", chunk => stderr += chunk);
		process.on("close", (code, signal) => {
			done({stdout, stderr, code, signal});
		});
	});
}


/**
 * Execute a shell-command in a child process.
 *
 * @param {String} command
 * @return {Promise}
 */
async function shell({raw}, ...values){
	const {exec} = require("child_process");
	const source = raw.map((s,i) => s + (values[i] || "")).join("");
	return await new Promise((resolve, reject) => {
		const process = exec(source, (error, stdout, stderr) => {
			const {exitCode, pid} = process;
			return error
				? reject(error)
				: resolve({exitCode, pid, stdout, stderr});
		});
	});
}


/**
 * Order a list of strings for a regexp capturing group.
 *
 * Results are alphabetised, with anything containing another
 * entry as a substring appearing first in matching order.
 * 
 * @param {String|Array} input
 * @param {Boolean} [caseInsensitive=false]
 * @return {Array}
 */
function sortForRegExp(input, caseInsensitive = false){
	if(!Array.isArray(input))
		input = String(input).split(/\n+/);
	return input.sort((a, b) => {
		if(caseInsensitive){
			a = a.toLowerCase();
			b = b.toLowerCase();
		}
		if(0 === b.indexOf(a)) return  1;
		if(0 === a.indexOf(b)) return -1;
		if(a < b) return -1;
		if(a > b) return  1;
		return 0;
	});
}


/**
 * Construct an HTML table from TSV data.
 *
 * @param {String} tsv - Block of text holding tab-delimited data.
 * @return {String} HTML source for a <table> element
 */
function tsvTable(tsv){
	let rows = tsv
		.replace(/^\s+|\s+$/g, "")
		.replace(/\n{2,}/g, "\n\n")
		.split(/\n/);

	const join = (row, tag) => "\t\t<tr>\n"
		+ row.split(/\t/)
			.map(cell => `<${tag}>${cell}</${tag}>`)
			.join("\n")
			.replace(/^/gm, "\t".repeat(3))
		+ "\n\t\t</tr>\n";

	let html = "<table>\n";

	// Split leading rows into a <thead> if a blank row is present.
	const index = rows.indexOf("");
	if(-1 !== index)
		html += `\t<thead>\n`
			+ rows.slice(0, index)
			. map(tr => join(tr, "th"))
			. join("")
			+ `\t</thead>\n`;

	// Construct the table's body
	rows = rows.slice(index + 1);
	html += "\t<tbody>\n"
		+ rows.map(tr => join(tr, "td")).join("")
		+ "\t</tbody>\n"
	+ "</html>\n";

	return html;
}


/**
 * Return a {@link Promise} that resolves once a package is activated.
 *
 * @param {String} packageName
 * @return {Promise}
 */
function waitToLoad(packageName){
	return new Promise(resolve => {
		if(atom.packages.isPackageActive(packageName))
			return resolve(atom.packages.getActivePackage(packageName));
		const disposable = atom.packages.onDidActivatePackage(pkg => {
			if(packageName === pkg.name){
				disposable.dispose();
				resolve(pkg);
			}
		});
	});
}
