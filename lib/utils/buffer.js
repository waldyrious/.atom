"use strict";

module.exports = {
	mutate,
	wrap,
	hasSelectedText,
	mergeContiguousCursors,
	selectEntireLines,
	getGrammarAtCursor,
	isAutoClosing,
	getMirrorChar,
	getCharBefore,
	getCharAfter,
	getCharAbove,
	getCharBelow,
	setCharBefore,
	setCharAfter,
	setCharAbove,
	setCharBelow,
};


/**
 * Execute a filter to transform selected text.
 *
 * If nothing's selected, the filter targets either the entire buffer,
 * or the text surrounding each cursor. The exact method of fallback
 * is governed by the `retarget` parameter.
 *
 * @param {TextEditor} editor
 * @param {Mutator} fn
 * @param {String} [retarget="buffer"] - One of "buffer", "cursor-words" or "cursor-lines".
 */
function mutate(editor, fn, retarget = "buffer"){
	/**
	 * @callback Mutator
	 *    A function returning a string to replace the affected text region.
	 *    Any other type of value causes the current iteration to be skipped.
	 *    Authors can use this to indicate when no changes should be made.
	 *
	 * @param {String} input
	 *    Contents of the buffer or current selection.
	 *
	 * @param {Selection} selection
	 *    Reference to the current {@link Selection} being iterated over.
	 *    Passed `null` when targeting the entire buffer.
	 *
	 * @param {TextEditor} editor
	 *    Reference to the affected editor.
	 *
	 * @example
	 *     <caption>Replica of <code>editor:upper-case</code>:</caption>
	 *     mutate(editor, text => text.toUpperCase());
	 */

	return editor.transact(100, () => {
		if(hasSelectedText(editor))
			editor.mutateSelectedText(selection => {
				const input = selection.getText();
				const output = fn(input, selection, editor);
				if("string" === typeof output)
					selection.insertText(output, {select: true});
			});
		else switch(retarget){
			case "cursor-words":
			case "cursor-lines":
				for(const cursor of editor.cursors){
					const range = "cursor-words" === retarget
						? cursor.getCurrentWordBufferRange()
						: cursor.getCurrentLineBufferRange();
					const input  = editor.buffer.getTextInRange(range);
					const output = fn(input, cursor.selection, editor);
					if("string" === typeof output){
						const position = cursor.getBufferPosition();
						editor.setTextInBufferRange(range, output);
						cursor.setBufferPosition(position);
					}
				}
				break;
			default:
				const input = editor.getText();
				const output = fn(input, null, editor);
				if("string" === typeof output)
					editor.setText(output);
		}
	});
}


/**
 * Enclose a text selection with two strings.
 *
 * @param {String} before
 * @param {String} after
 * @param {Selection} [target=null]
 * @internal
 */
function wrap(before, after, target = null){
	before = String(before);
	after  = String(after);
	target = target || atom.workspace.getActiveTextEditor();
	if(atom.workspace.isTextEditor(target))
		target = target.getLastSelection();
	const {editor} = target;
	const nl = /\r?\n/g;
	return editor.transact(100, () => {
		const range = target.getBufferRange();
		const Point = range.start.constructor;
		const xlate = new Point((before.match(nl) || []).length, (before.split(nl).pop()).length);
		const start = range.start.translate(xlate);
		const end   = range.end.translate(range.start.row === range.end.row ? xlate : [xlate.row, 0]);
		target.insertText(before + target.getText() + after, {normalizeLineEndings: false});
		target.setBufferRange([start, end]);
	});
}
	

/**
 * Report whether a {@link TextEditor} contains selected text.
 *
 * @param {TextEditor} editor
 * @return {Boolean}
 */
function hasSelectedText(editor){
	return !!(editor && editor.getSelections().map(s => s.getText()).join("").length);
}


/**
 * Merge multiple contiguous line selections.
 *
 * Cursors separated by at least one non-selected line remain separated.
 *
 * @param {TextEditor} editor
 * @private
 */
function mergeContiguousCursors(editor){
	editor.mergeSelections((A, B) => {
		const a = Math.max(...A.getBufferRowRange());
		const b = Math.min(...B.getBufferRowRange());
		return a >= (b - 1);
	});
}
	
	
/**
 * Extend selection ranges to cover each intersecting buffer row.
 *
 * NB: Atom's APIs probably offer an easier way to achieve this.
 * @param {TextEditor|Selection} target
 * @private
 */
function selectEntireLines(target){
	if(atom.workspace.isTextEditor(target))
		for(const selection of target.getSelections())
			selectEntireLines(selection);
	else{
		const {start, end} = target.getBufferRange();
		const {buffer} = target.editor;
		start.column = 0;
		end.column = buffer.rangeForRow(end.row).end.column;
		target.setBufferRange([start, end]);
	}
}
	
	
/**
 * Identify the grammar highlighting the token under a cursor.
 *
 * @param {Cursor} cursor
 * @return {Grammar}
 */
function getGrammarAtCursor(cursor){
	const editor = atom.workspace.getActiveTextEditor();

	if(!cursor){
		if(!editor) return null;
		cursor = editor.getLastCursor();
	}

	// Construct a list of regular expressions to match each scope-name
	const patterns = [];
	const grammars = atom.grammars.grammarsByScopeName;
	for(let name in grammars){
		const grammar = grammars[name];
		const pattern = new RegExp("(?:^|[\\s.])" + name.replace(/\./g, "\\.") + "(?=$|[\\s.])");
		patterns.push([pattern, grammar]);
	}

	for(let scope of cursor.getScopeDescriptor().scopes.reverse()){
		// Corrections for embedded languages
		switch(scope){
			case "source.php":    return grammars["text.html.php"];
			case "text.html.php": return grammars["text.html.basic"];
		}
		const matchedGrammar = patterns.find(i => i[0].test(scope));
		if(matchedGrammar) return matchedGrammar[1];
	}

	return cursor.editor
		? cursor.editor.getGrammar()
		: editor.getGrammar();
}


/**
 * Check if a character auto-inserts another character when entered.
 *
 * @param {String} input
 * @return {Boolean}
 */
function isAutoClosing(input){
	switch(input){
		case "[": case "{": case "(": case "‘": case "«":
		case "'": case '"': case "`": case "“": case "‹":
			return true;
		default:
			return false;
	}
}


/**
 * Return the mirrored counterpart of a character, if any.
 *
 * If no counterpart exists, the input itself is returned.
 *
 * @example getMirrorChar("[") == "]";
 * @param {String} input
 * @return {String}
 */
function getMirrorChar(input){
	switch(input){
		case "[": return "]";
		case "{": return "}";
		case "(": return ")";
		case "<": return ">";
		case "“": return "”";
		case "‘": return "’";
		case "«": return "»";
		case "‹": return "›";
		default:  return input;
	}
}


/**
 * Return the character before the designated cursor.
 *
 * @param {Cursor} cursor
 * @return {String}
 */
function getCharBefore(cursor){
	const position = cursor.getBufferPosition();
	const {row, column} = position;

	if(!column) return "";
	return cursor.editor.getTextInBufferRange({
		start: {row, column: column - 1},
		end: position
	});
}


/**
 * Return the character following a cursor, if any.
 *
 * @param {Cursor} cursor
 * @return {String}
 */
function getCharAfter(cursor){
	if(cursor.isAtEndOfLine()) return "";

	const position = cursor.getBufferPosition();
	const {row, column} = position;

	return cursor.editor.getTextInBufferRange({
		start: [row, column + 1],
		end: position
	});
}


/**
 * Return the character in the row above the cursor.
 *
 * @param {Cursor} cursor
 * @return {String}
 */
function getCharAbove(cursor){
	const position = cursor.getBufferPosition();
	let {row, column} = position;
	if(!row) return "";
	--row;
	return cursor.editor.getTextInBufferRange({
		start: [row, column],
		end:   [row, column + 1]
	});
}


/**
 * Return the character in the row below the cursor.
 *
 * @param {Cursor} cursor
 * @return {String}
 */
function getCharBelow(cursor){
	const position = cursor.getBufferPosition();
	let {row, column} = position;
	++row;
	return cursor.editor.getTextInBufferRange({
		start: [row, column],
		end:   [row, column + 1]
	});
}


/**
 * Set the character immediately before a cursor.
 *
 * @param {Cursor} cursor
 * @param {String} to
 * @return {String}
 */
function setCharBefore(cursor, to){
	const position = cursor.getBufferPosition();
	const {row, column} = position;

	if(!column) return "";
	return cursor.editor.setTextInBufferRange({
		start: {row, column: column - 1},
		end: position
	}, to);
}


/**
 * Set the character immediately following a cursor.
 *
 * @param {Cursor} cursor
 * @param {String} to
 * @return {String}
 */
function setCharAfter(cursor, to){
	if(cursor.isAtEndOfLine()) return "";

	const position = cursor.getBufferPosition();
	const {row, column} = position;

	return cursor.editor.setTextInBufferRange({
		start: [row, column + 1],
		end: position
	}, to);
}


/**
 * Set the character in the row above the cursor.
 *
 * @param {Cursor} cursor
 * @param {String} to
 * @return {String}
 */
function setCharAbove(cursor, to){
	const position = cursor.getBufferPosition();
	let {row, column} = position;
	if(!row) return "";
	--row;
	return cursor.editor.setTextInBufferRange({
		start: [row, column],
		end:   [row, column + 1]
	}, to);
}


/**
 * Set the character in the row below the cursor.
 *
 * @param {Cursor} cursor
 * @param {String} to
 * @return {String}
 */
function setCharBelow(cursor, to){
	const position = cursor.getBufferPosition();
	let {row, column} = position;
	++row;
	return cursor.editor.setTextInBufferRange({
		start: [row, column],
		end:   [row, column + 1]
	}, to);
}
