// WindMix · Prompt Studio 弹窗（iframe）提示词自动补全引擎
// ---------------------------------------------------------------------------
// 来源：WeiLin-ComfyUI-prompt-all-in-one/js/common/autocomplete.js（pysssss 原作，MIT）。
// 为什么需要它：Prompt Studio 弹窗是独立 iframe 文档，ComfyUI 主页面上的补全
// 引擎够不到它；上游 WeiLin 插件的做法正是「主页面模块 → 伸进 iframe 的 DOM
// 建实例，下拉挂进 iframe 内已有的 *_ins_autocom 容器」，这里照搬同一套机制。
//
// 与上游的差异（均为适配 WindMix 的必要改动，功能未删减）：
//   1. $el 用绝对路径 "/scripts/ui.js" 导入（跨插件目录相对路径不可靠）；
//   2. 不再 addStylesheet(import.meta.url)：下拉样式由 iframe 自己的
//      prompt_static/css/autocomplete.css（.autocom-* 规则）提供；
//   3. 镜像 div / 行高探测落在 element.ownerDocument（textarea 在 iframe 里，
//      必须在同一个 document 里测量，否则字体度量跨文档不准）；
//   4. 下拉配色用带兜底的变量（iframe 内没有 ComfyUI 的 CSS 变量，否则透明底）；
//   5. 插入失败走 setRangeText 兜底时补发 input/change，让 Prompt Studio 的
//      标签面板/字数统计跟着同步；
//   6. app.canvas.ds.scale 加可选链保护（该值当前固定按 1 用）。
//
// 铁律合规：本文件是 ES module，但只在 ComfyUI 主页面运行；iframe 内的页面脚本
// 一行都没改（iframe 内仍然禁止 <script type="module">）。
// ---------------------------------------------------------------------------

import { app } from "/scripts/app.js";
import { $el } from "/scripts/ui.js";

/*
    https://github.com/component/textarea-caret-position
    The MIT License (MIT)

    Copyright (c) 2015 Jonathan Ong me@jongleberry.com

    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
const getCaretCoordinates = (function () {
	// We'll copy the properties below into the mirror div.
	// Note that some browsers, such as Firefox, do not concatenate properties
	// into their shorthand (e.g. padding-top, padding-bottom etc. -> padding),
	// so we have to list every single property explicitly.
	var properties = [
		"direction", // RTL support
		"boxSizing",
		"width", // on Chrome and IE, exclude the scrollbar, so the mirror div wraps exactly as the textarea does
		"height",
		"overflowX",
		"overflowY", // copy the scrollbar for IE

		"borderTopWidth",
		"borderRightWidth",
		"borderBottomWidth",
		"borderLeftWidth",
		"borderStyle",

		"paddingTop",
		"paddingRight",
		"paddingBottom",
		"paddingLeft",

		// https://developer.mozilla.org/en-US/docs/Web/CSS/font
		"fontStyle",
		"fontVariant",
		"fontWeight",
		"fontStretch",
		"fontSize",
		"fontSizeAdjust",
		"lineHeight",
		"fontFamily",

		"textAlign",
		"textTransform",
		"textIndent",
		"textDecoration", // might not make a difference, but better be safe

		"letterSpacing",
		"wordSpacing",

		"tabSize",
		"MozTabSize",
	];

	var isBrowser = typeof window !== "undefined";
	var isFirefox = isBrowser && window.mozInnerScreenX != null;

	return function getCaretCoordinates(element, position, options) {
		if (!isBrowser) {
			throw new Error("textarea-caret-position#getCaretCoordinates should only be called in a browser");
		}

		// 关键差异③：镜像 div 必须落在 textarea 所在的 document（可能是 iframe 文档）
		const ownerDoc = element.ownerDocument || document;
		const ownerWin = ownerDoc.defaultView || window;

		var debug = (options && options.debug) || false;
		if (debug) {
			var el = ownerDoc.querySelector("#input-textarea-caret-position-mirror-div");
			if (el) el.parentNode.removeChild(el);
		}

		// The mirror div will replicate the textarea's style
		var div = ownerDoc.createElement("div");
		div.id = "input-textarea-caret-position-mirror-div";
		ownerDoc.body.appendChild(div);

		var style = div.style;
		var computed = ownerWin.getComputedStyle
			? ownerWin.getComputedStyle(element)
			: element.currentStyle; // currentStyle for IE < 9
		var isInput = element.nodeName === "INPUT";

		// Default textarea styles
		style.whiteSpace = "pre-wrap";
		if (!isInput) style.wordWrap = "break-word"; // only for textarea-s

		// Position off-screen
		style.position = "absolute"; // required to return coordinates properly
		if (!debug) style.visibility = "hidden"; // not 'display: none' because we want rendering

		// Transfer the element's properties to the div
		properties.forEach(function (prop) {
			if (isInput && prop === "lineHeight") {
				// Special case for <input>s because text is rendered centered and line height may be != height
				if (computed.boxSizing === "border-box") {
					var height = parseInt(computed.height);
					var outerHeight =
						parseInt(computed.paddingTop) +
						parseInt(computed.paddingBottom) +
						parseInt(computed.borderTopWidth) +
						parseInt(computed.borderBottomWidth);
					var targetHeight = outerHeight + parseInt(computed.lineHeight);
					if (height > targetHeight) {
						style.lineHeight = height - outerHeight + "px";
					} else if (height === targetHeight) {
						style.lineHeight = computed.lineHeight;
					} else {
						style.lineHeight = 0;
					}
				} else {
					style.lineHeight = computed.height;
				}
			} else {
				style[prop] = computed[prop];
			}
		});

		if (isFirefox) {
			// Firefox lies about the overflow property for textareas: https://bugzilla.mozilla.org/show_bug.cgi?id=984275
			if (element.scrollHeight > parseInt(computed.height)) style.overflowY = "scroll";
		} else {
			style.overflow = "hidden"; // for Chrome to not render a scrollbar; IE keeps overflowY = 'scroll'
		}

		div.textContent = element.value.substring(0, position);
		// The second special handling for input type="text" vs textarea:
		// spaces need to be replaced with non-breaking spaces - http://stackoverflow.com/a/13402035/1269037
		if (isInput) div.textContent = div.textContent.replace(/\s/g, "\u00a0");

		var span = ownerDoc.createElement("span");
		// Wrapping must be replicated *exactly*, including when a long word gets
		// onto the next line, with whitespace at the end of the line before (#7).
		// The  *only* reliable way to do that is to copy the *entire* rest of the
		// textarea's content into the <span> created at the caret position.
		// For inputs, just '.' would be enough, but no need to bother.
		span.textContent = element.value.substring(position) || "."; // || because a completely empty faux span doesn't render at all
		div.appendChild(span);

		var coordinates = {
			top: span.offsetTop + parseInt(computed["borderTopWidth"]),
			left: span.offsetLeft + parseInt(computed["borderLeftWidth"]),
			height: parseInt(computed["lineHeight"]),
		};

		if (debug) {
			span.style.backgroundColor = "#aaa";
		} else {
			ownerDoc.body.removeChild(div);
		}

		return coordinates;
	};
})();

/*
    Key functions from:
    https://github.com/yuku/textcomplete
    © Yuku Takahashi - This software is licensed under the MIT license.

    The MIT License (MIT)

    Copyright (c) 2015 Jonathan Ong me@jongleberry.com

    Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
const CHAR_CODE_ZERO = "0".charCodeAt(0);
const CHAR_CODE_NINE = "9".charCodeAt(0);

class TextAreaCaretHelper {
	constructor(el, getScale) {
		this.el = el;
		this.getScale = getScale;
	}

	#calculateElementOffset() {
		const rect = this.el.getBoundingClientRect();
		const owner = this.el.ownerDocument;
		if (owner == null) {
			throw new Error("Given element does not belong to document");
		}
		const { defaultView, documentElement } = owner;
		if (defaultView == null) {
			throw new Error("Given element does not belong to window");
		}
		const offset = {
			top: rect.top + defaultView.pageYOffset,
			left: rect.left + defaultView.pageXOffset,
		};
		if (documentElement) {
			offset.top -= documentElement.clientTop;
			offset.left -= documentElement.clientLeft;
		}
		return offset;
	}

	#isDigit(charCode) {
		return CHAR_CODE_ZERO <= charCode && charCode <= CHAR_CODE_NINE;
	}

	#getLineHeightPx() {
		// 关键差异③：textarea 在 iframe 里，必须用它的 document 取计算样式
		const doc = this.el.ownerDocument || document;
		const win = doc.defaultView || window;
		const computedStyle = win.getComputedStyle(this.el);
		const lineHeight = computedStyle.lineHeight;
		// If the char code starts with a digit, it is either a value in pixels,
		// or unitless, as per:
		// https://drafts.csswg.org/css2/visudet.html#propdef-line-height
		// https://drafts.csswg.org/css2/cascade.html#computed-value
		if (this.#isDigit(lineHeight.charCodeAt(0))) {
			const floatLineHeight = parseFloat(lineHeight);
			// In real browsers the value is *always* in pixels, even for unit-less
			// line-heights. However, we still check as per the spec.
			return this.#isDigit(lineHeight.charCodeAt(lineHeight.length - 1))
				? floatLineHeight * parseFloat(computedStyle.fontSize)
				: floatLineHeight;
		}
		// Otherwise, the value is "normal".
		// If the line-height is "normal", calculate by font-size
		return this.#calculateLineHeightPx(this.el.nodeName, computedStyle);
	}

	/**
	 * Returns calculated line-height of the given node in pixels.
	 * 关键差异③：临时节点落在 textarea 自己的 document（可能是 iframe）。
	 */
	#calculateLineHeightPx(nodeName, computedStyle) {
		const doc = this.el.ownerDocument || document;
		const body = doc.body;
		if (!body) return 0;

		const tempNode = doc.createElement(nodeName);
		tempNode.innerHTML = "&nbsp;";
		Object.assign(tempNode.style, {
			fontSize: computedStyle.fontSize,
			fontFamily: computedStyle.fontFamily,
			padding: "0",
			position: "absolute",
		});
		body.appendChild(tempNode);

		// Make sure textarea has only 1 row
		if (tempNode instanceof HTMLTextAreaElement) {
			tempNode.rows = 1;
		}

		// Assume the height of the element is the line-height
		const height = tempNode.offsetHeight;
		body.removeChild(tempNode);

		return height;
	}

	getCursorOffset() {
		// const scale = this.getScale();
		const scale = 1;
		const elOffset = this.#calculateElementOffset();
		const elScroll = this.#getElScroll();
		const cursorPosition = this.#getCursorPosition();
		const lineHeight = this.#getLineHeightPx();
		const top = elOffset.top - scale * elScroll.top + scale * (cursorPosition.top + lineHeight);
		const left = elOffset.left - scale * elScroll.left + scale * cursorPosition.left;
		const clientTop = this.el.getBoundingClientRect().top;
		if (this.el.dir !== "rtl") {
			return { top, left, lineHeight, clientTop };
		} else {
			const doc = this.el.ownerDocument || document;
			const right = doc.documentElement ? doc.documentElement.clientWidth - left : 0;
			return { top, right, lineHeight, clientTop };
		}
	}

	#getElScroll() {
		return { top: this.el.scrollTop, left: this.el.scrollLeft };
	}

	#getCursorPosition() {
		return getCaretCoordinates(this.el, this.el.selectionEnd);
	}

	getBeforeCursor() {
		return this.el.selectionStart !== this.el.selectionEnd ? null : this.el.value.substring(0, this.el.selectionEnd);
	}

	getAfterCursor() {
		return this.el.value.substring(this.el.selectionEnd);
	}

	insertAtCursor(value, offset, finalOffset) {
		// 关键差异③：execCommand 必须在 textarea 所在的 document 上执行，
		// 否则焦点在 iframe 内时父文档的 execCommand 不生效（只能走无撤销的兜底）。
		const doc = this.el.ownerDocument || document;
		if (this.el.selectionStart != null) {
			const startPos = this.el.selectionStart;
			const endPos = this.el.selectionEnd;

			// Move selection to beginning of offset
			this.el.selectionStart = this.el.selectionStart + offset;

			// Using execCommand to support undo, but since it's officially
			// 'deprecated' we need a backup solution, but it won't support undo :(
			let pasted = true;
			try {
				if (!doc.execCommand("insertText", false, value)) {
					pasted = false;
				}
			} catch (e) {
				console.error("Error caught during execCommand:", e);
				pasted = false;
			}

			if (!pasted) {
				console.error("execCommand unsuccessful; not supported. Adding text manually, no undo support.");
				this.el.setRangeText(value, this.el.selectionStart, this.el.selectionEnd, "end");
				// 关键差异⑤：兜底路径不会触发 input 事件，补发一次让宿主同步
				this.#notifyHost();
			}

			this.el.selectionEnd = this.el.selectionStart = startPos + value.length + offset + (finalOffset ?? 0);
		} else {
			// Using execCommand to support undo, but since it's officially
			// 'deprecated' we need a backup solution, but it won't support undo :(
			let pasted = true;
			try {
				if (!doc.execCommand("insertText", false, value)) {
					pasted = false;
				}
			} catch (e) {
				console.error("Error caught during execCommand:", e);
				pasted = false;
			}

			if (!pasted) {
				console.error(
					"execCommand unsuccessful; not supported. Adding text manually, no undo support."
				);
				this.el.value += value;
				this.#notifyHost();
			}
		}
	}

	#notifyHost() {
		try {
			const doc = this.el.ownerDocument || document;
			const win = doc.defaultView || window;
			this.el.dispatchEvent(new win.Event("input", { bubbles: true }));
			this.el.dispatchEvent(new win.Event("change", { bubbles: true }));
		} catch (e) {
			/* 通知失败不影响插入本身 */
		}
	}
}

/*********************/

/**
 * @typedef {{
 * 	text: string,
 * 	priority?: number,
 * 	info?: Function,
 * 	hint?: string,
 *  showValue?: boolean,
 *  caretOffset?: number
 * }} AutoCompleteEntry
 */
export class TextAreaAutoComplete {
	static globalSeparator = "";
	static enabled = true;
	static insertOnTab = true;
	static insertOnEnter = true;
	static replacer = undefined;
	static lorasEnabled = false;
	static suggestionCount = 20;

	/** @type {Record<string, Record<string, AutoCompleteEntry>>} */
	static groups = {};
	/** @type {Set<string>} */
	static globalGroups = new Set();
	/** @type {Record<string, AutoCompleteEntry>} */
	static globalWords = {};
	/** @type {Record<string, AutoCompleteEntry>} */
	static globalWordsExclLoras = {};

	/** @type {HTMLTextAreaElement} */
	el;
	/** @type {HTMLIFrameElement} */
	iframe;
	/** @type {HTMLElement} */
	insEl;

	/** @type {Record<string, AutoCompleteEntry>} */
	overrideWords;
	overrideSeparator = "";

	get words() {
		return this.overrideWords ?? TextAreaAutoComplete.globalWords;
	}

	get separator() {
		return this.overrideSeparator ?? TextAreaAutoComplete.globalSeparator;
	}

	/**
	 * @param {HTMLTextAreaElement} el    iframe 内的 textarea
	 * @param {HTMLIFrameElement} iframe  该 textarea 所在的 iframe 元素
	 * @param {HTMLElement} insEl         iframe 内承载下拉的容器（*_ins_autocom）
	 * @param {Record<string, AutoCompleteEntry>} words 词库（可先传空对象、之后 Object.assign 填充）
	 * @param {string} separator          插入时的分隔符
	 */
	constructor(el, iframe, insEl, words = null, separator = null) {
		this.el = el;
		this.iframe = iframe;
		this.insEl = insEl;
		this.helper = new TextAreaCaretHelper(el, () => window.app?.canvas?.ds?.scale ?? 1);
		this.dropdown = $el("div.autocom-autocomplete");
		this.overrideWords = words;
		this.overrideSeparator = separator;

		this.#setup();
	}

	#setup() {
		this.el.addEventListener("keydown", this.#keyDown.bind(this));
		this.el.addEventListener("keypress", this.#keyPress.bind(this));
		this.el.addEventListener("keyup", this.#keyUp.bind(this));
		this.el.addEventListener("click", this.#hide.bind(this));
		this.el.addEventListener("blur", () => setTimeout(() => this.#hide(), 150));
	}

	/**
	 * @param {KeyboardEvent} e
	 */
	#keyDown(e) {
		if (!TextAreaAutoComplete.enabled) return;

		if (this.dropdown.parentElement) {
			// We are visible
			switch (e.key) {
				case "ArrowUp":
					e.preventDefault();
					if (this.currentWords?.length) {
						if (this.selected?.index) {
							this.#setSelected(this.currentWords[this.selected.index - 1].wordInfo);
						} else {
							this.#setSelected(this.currentWords[this.currentWords.length - 1].wordInfo);
						}
					}
					break;
				case "ArrowDown":
					e.preventDefault();
					if (this.currentWords?.length) {
						if (this.selected.index === this.currentWords.length - 1) {
							this.#setSelected(this.currentWords[0].wordInfo);
						} else {
							this.#setSelected(this.currentWords[this.selected.index + 1].wordInfo);
						}
					}
					break;
				case "Tab":
					if (TextAreaAutoComplete.insertOnTab) {
						this.#insertItem();
						e.preventDefault();
					}
					break;
			}
		}
	}

	/**
	 * @param {KeyboardEvent} e
	 */
	#keyPress(e) {
		if (!TextAreaAutoComplete.enabled) return;
		if (this.dropdown.parentElement) {
			// We are visible
			switch (e.key) {
				case "Enter":
					if (!e.ctrlKey) {
						if (TextAreaAutoComplete.insertOnEnter) {
							this.#insertItem();
							e.preventDefault();
						}
					}
					break;
			}
		}

		if (!e.defaultPrevented) {
			this.#update();
		}
	}

	#keyUp(e) {
		if (!TextAreaAutoComplete.enabled) return;
		if (this.dropdown.parentElement) {
			// We are visible
			switch (e.key) {
				case "Escape":
					e.preventDefault();
					this.#hide();
					break;
			}
		} else if (e.key.length > 1 && e.key != "Delete" && e.key != "Backspace") {
			return;
		}
		if (!e.defaultPrevented) {
			this.#update();
		}
	}

	#setSelected(item) {
		if (this.selected?.el) {
			this.selected.el.classList.remove("autocom-autocomplete-item--selected");
		}

		this.selected = item;
		if (this.selected?.el) {
			this.selected.el.classList.add("autocom-autocomplete-item--selected");
		}
	}

	#insertItem() {
		if (!this.selected) return;
		this.selected.el.click();
	}

	#getFilteredWords(term) {
		term = term.toLocaleLowerCase();

		const priorityMatches = [];
		const prefixMatches = [];
		const includesMatches = [];
		for (const word of Object.keys(this.words)) {
			const lowerWord = word.toLocaleLowerCase();
			if (lowerWord === term) {
				// Dont include exact matches
				continue;
			}

			const pos = lowerWord.indexOf(term);
			if (pos === -1) {
				// No match
				continue;
			}

			const wordInfo = this.words[word];
			if (wordInfo.priority) {
				priorityMatches.push({ pos, wordInfo });
			} else if (pos) {
				includesMatches.push({ pos, wordInfo });
			} else {
				prefixMatches.push({ pos, wordInfo });
			}
		}

		priorityMatches.sort(
			(a, b) =>
				b.wordInfo.priority - a.wordInfo.priority ||
				a.wordInfo.text.length - b.wordInfo.text.length ||
				a.wordInfo.text.localeCompare(b.wordInfo.text)
		);

		const top = priorityMatches.length * 0.2;
		return priorityMatches
			.slice(0, top)
			.concat(prefixMatches, priorityMatches.slice(top), includesMatches)
			.slice(0, TextAreaAutoComplete.suggestionCount);
	}

	#update() {
		let before = this.helper.getBeforeCursor();
		if (before?.length) {
			// 词片段 = 光标前结尾的连续 ASCII tag 字符（与主页面 autocomplete.js 同步）。
			// 不用上游的 [^\s|,|;|"]+：那会把中文、全角标点、{$@} 占位符并进片段，
			// 在既有内容结尾处打字永远匹配不到词库。保留 - . + 覆盖
			// two-tone_hair / u.a._school_uniform / 6+girls；剥前导连字符防 --- 污染。
			const m = before.match(/([a-zA-Z0-9_\-.+]+)$/);
			if (m) {
				before = m[0].replace(/^-+/, "");
			} else {
				before = null;
			}
		}

		if (!before) {
			this.#hide();
			return;
		}

		this.currentWords = this.#getFilteredWords(before);
		if (!this.currentWords.length) {
			this.#hide();
			return;
		}

		this.dropdown.style.display = "";

		let hasSelected = false;
		const items = this.currentWords.map(({ wordInfo, pos }, i) => {
			const parts = [
				$el("span", {
					textContent: wordInfo.text.substr(0, pos),
				}),
				$el("span.autocom-autocomplete-highlight", {
					textContent: wordInfo.text.substr(pos, before.length),
				}),
				$el("span", {
					textContent: wordInfo.text.substr(pos + before.length),
				}),
			];

			if (wordInfo.hint) {
				parts.push(
					$el("span.autocom-autocomplete-pill", {
						textContent: wordInfo.hint,
					})
				);
			}

			if (wordInfo.priority) {
				parts.push(
					$el("span.autocom-autocomplete-pill", {
						textContent: wordInfo.priority,
					})
				);
			}

			if (wordInfo.value && wordInfo.text !== wordInfo.value && wordInfo.showValue !== false) {
				parts.push(
					$el("span.autocom-autocomplete-pill", {
						textContent: wordInfo.value,
					})
				);
			}

			if (wordInfo.info) {
				parts.push(
					$el("a.autocom-autocomplete-item-info", {
						textContent: "ℹ️",
						title: "View info...",
						onclick: (e) => {
							e.stopPropagation();
							wordInfo.info();
							e.preventDefault();
						},
					})
				);
			}
			const item = $el(
				"div.autocom-autocomplete-item",
				{
					onclick: () => {
						this.el.focus();
						let value = wordInfo.value ?? wordInfo.text;
						const use_replacer = wordInfo.use_replacer ?? true;
						if (TextAreaAutoComplete.replacer && use_replacer) {
							value = TextAreaAutoComplete.replacer(value);
						}
						this.helper.insertAtCursor(value + this.separator, -before.length, wordInfo.caretOffset);
						setTimeout(() => {
							this.#update();
						}, 150);
					},
					onmousemove: () => {
						this.#setSelected(wordInfo);
					},
				},
				parts
			);

			if (wordInfo === this.selected) {
				hasSelected = true;
			}

			wordInfo.index = i;
			wordInfo.el = item;

			return item;
		});

		this.#setSelected(hasSelected ? this.selected : this.currentWords[0].wordInfo);
		this.dropdown.replaceChildren(...items);

		if (!this.dropdown.parentElement) {
			// 下拉挂到 iframe 的 <body> 上，位置由 helper.getCursorOffset 的包装设成
			// 「跟随光标的 fixed」。原先挂进 textarea 下方的 1px 容器（*_ins_autocom）走文档流，
			// 结果下拉固定贴在输入框底部、不跟光标 —— 观感别扭，已改。
			this.insEl.append(this.dropdown);
		}
		// 关键差异④：iframe 内没有 ComfyUI 的 CSS 变量，颜色必须带兜底
		this.dropdown.style.backgroundColor = "var(--windmix-ac-bg, #2b2b2f)";
		this.dropdown.style.color = "var(--windmix-ac-fg, #d8d8dc)";

		// maxHeight 必须用 textarea 所在文档的 window 算（不能是主页面的 window）
		const win = (this.el && this.el.ownerDocument && this.el.ownerDocument.defaultView) || window;
		const position = this.helper.getCursorOffset(); // 包装里已按光标设好 fixed / left / top / z-index
		const vTop = position && position.wmTop != null ? position.wmTop : position.top;
		this.dropdown.style.maxHeight = Math.max(120, win.innerHeight - vTop - 12) + "px";
	}

	#hide() {
		this.selected = null;
		this.dropdown.remove();
	}

	static updateWords(id, words, addGlobal = true) {
		const isUpdate = id in TextAreaAutoComplete.groups;
		TextAreaAutoComplete.groups[id] = words;
		if (addGlobal) {
			TextAreaAutoComplete.globalGroups.add(id);
		}

		if (isUpdate) {
			TextAreaAutoComplete.globalWords = Object.assign(
				{},
				...Object.keys(TextAreaAutoComplete.groups)
					.filter((key) => TextAreaAutoComplete.globalGroups.has(key))
					.map((key) => TextAreaAutoComplete.groups[key])
			);
		} else if (addGlobal) {
			Object.assign(TextAreaAutoComplete.globalWords, words);
		}
	}
}

//==============================================================================
// WindMix 专用：iframe 注入 + 词库加载
//==============================================================================

// Prompt Studio iframe（prompt_static/index.html）里已有的 textarea + 挂载容器。
// 这两个容器原本是给上游 WeiLin 插件注入用的，一直空着 —— 正好复用。
const WM_FRAME_TARGETS = [
	{ textarea: "prompt_text_input", container: "prompt_great_ins_autocom" },
	{ textarea: "prompt_text_neg_input", container: "prompt_neg_ins_autocom" },
];

const WM_AC_ATTR = "data-windmix-ac";
// 词库只走 WindMix 自己的路由（api.py 注册，读 prompt_studio/storage/local_complete_tags）。
// 不设「旧前缀 /weilin/...」兜底：迁移后 WindMix 已不再注册该前缀，那条 URL 只会被
// 外部 WeiLin 插件应答，等于把词库来源偷偷换成别的插件的文件——来源不唯一，排查困难。
const WM_WORDS_URLS = [
	"/WM_prompt/physton_prompt/get_csv?key=danbooru-0-zh.csv",
];

let _wmWordsPromise = null;

/** 沿用主界面「Prompt Studio 自动补全启用」设置项（设置项由 autocomplete.js 注册，id 随语言变化）。 */
function wmAutocompleteEnabled() {
	try {
		const settings = app?.ui?.settings;
		for (const key of ["prompt_studio.自动补全.启用", "prompt_studio.autocomplete.enabled"]) {
			const value = settings?.getSettingValue?.(key);
			if (typeof value === "boolean") return value;
		}
	} catch (e) {
		/* 读不到就当开启 */
	}
	return true;
}

/** 词库：danbooru-0-zh.csv（tag,中文），按热度序 → 前缀命中自然按热度排。 */
function wmLoadWords() {
	if (_wmWordsPromise) return _wmWordsPromise;
	_wmWordsPromise = (async () => {
		const words = {};
		let text = "";
		for (const url of WM_WORDS_URLS) {
			try {
				const resp = await fetch(url, { cache: "no-store" });
				if (resp.ok) {
					text = await resp.text();
					if (text) break;
				}
			} catch (e) {
				/* 试下一个 */
			}
		}
		if (!text) {
			console.warn("[WindMix] Prompt Studio 自动补全：词库加载失败（danbooru-0-zh.csv）");
			return words;
		}
		for (const rawLine of text.split(/\r?\n/)) {
			const line = rawLine.replace(/^\uFEFF/, "").trim();
			if (!line) continue;
			const idx = line.indexOf(",");
			const tag = (idx >= 0 ? line.slice(0, idx) : line).trim();
			if (!tag) continue;
			const hint = idx >= 0 ? line.slice(idx + 1).trim() : "";
			if (words[tag]) continue;
			words[tag] = hint ? { text: tag, hint } : { text: tag };
		}
		return words;
	})();
	return _wmWordsPromise;
}

/**
 * 给 Prompt Studio 弹窗（iframe）里的提示词框挂自动补全。
 * 幂等：同一个 textarea 只挂一次；iframe 重载会重新执行，靠 data 标记去重。
 * @param {HTMLIFrameElement} iframe
 */
export function attachAutocompleteToIframe(iframe) {
	if (!iframe) return;

	// 跟随主界面的自动补全开关
	TextAreaAutoComplete.enabled = wmAutocompleteEnabled();

	// 词库对象先建好并马上传给实例，加载完成后原地填充 → 不阻塞弹窗打开
	const words = {};
	wmLoadWords().then((loaded) => {
		if (loaded && Object.keys(loaded).length) Object.assign(words, loaded);
	});

	let tries = 0;
	const tryAttach = () => {
		let doc = null;
		try {
			doc = iframe.contentDocument;
		} catch (e) {
			return; // 跨域/未就绪
		}
		if (!doc) {
			if (tries++ < 40) setTimeout(tryAttach, 250);
			return;
		}

		let pending = 0;
		for (const target of WM_FRAME_TARGETS) {
			const ta = doc.getElementById(target.textarea);
			if (!ta) {
				pending++;
				continue;
			}
			if (ta.getAttribute(WM_AC_ATTR) === "1") continue; // 已挂载
			ta.setAttribute(WM_AC_ATTR, "1");
			// insEl 用 iframe 的 <body>（不再用 *_ins_autocom 容器）：下拉改成 fixed 跟随光标，
			// 挂在文档流容器里只能贴在输入框下方。容器保留在页面上不动，互不影响。
			try {
				const ac = new TextAreaAutoComplete(ta, iframe, doc.body, words, ", ");
				// 把下拉从「文档流」摆到「跟随光标的 fixed」：
				// pos 是 iframe 文档坐标系，滚动量与视口尺寸都必须取 iframe 自己的 window。
				const win = doc.defaultView || window;
				const origOffset = ac.helper.getCursorOffset.bind(ac.helper);
				ac.helper.getCursorOffset = () => {
					const pos = origOffset();
					const dd = ac.dropdown;
					const width = Math.min(460, Math.max(240, win.innerWidth - 24));
					dd.style.position = "fixed";
					dd.style.zIndex = "910000"; // 与 iframe 内 .autocom-autocomplete 的层级保持一致
					dd.style.width = width + "px";
					dd.style.maxWidth = "92vw";
					const left = Math.max(8, Math.min(pos.left - win.scrollX, win.innerWidth - width - 8));
					let top = pos.top - win.scrollY + 4;
					if (top + 240 > win.innerHeight) top = Math.max(8, pos.top - win.scrollY - 244); // 底部空间不够时翻到光标上方
					dd.style.left = left + "px";
					dd.style.top = top + "px";
					return Object.assign({}, pos, { wmTop: top });
				};
			} catch (e) {
				ta.removeAttribute(WM_AC_ATTR);
				console.warn("[WindMix] Prompt Studio 自动补全挂载失败:", target.textarea, e);
			}
		}

		// 元素还没渲染出来（bundle 可能重排 DOM）→ 继续等
		if (pending && tries++ < 40) setTimeout(tryAttach, 250);
	};

	tryAttach();
}
