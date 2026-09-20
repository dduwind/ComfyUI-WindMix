// ComfyUI-WindMix — danbooru 中文词库 + 主页面 textarea 自动补全挂载器
//
// 供两处共用：
//   1) 「⚡ 预设文本」节点的内容编辑弹窗（web/windmix_preset_text.js）
//   2) 「预设管理器」的编辑弹窗（web/windmix_preset_manager.js）
// 共用同一个模块实例 → CSV 只下载一次（约 700KB），词库缓存也只有一份。
//
// 引擎是 prompt_studio 自带的 TextAreaAutoComplete（同目录 autocomplete.js，上游遗留资产），
// 它的样式由该模块顶部的 addStylesheet(import.meta.url) 自动注入主页面 <head>，
// 对应同目录的 autocomplete.css（配色已按 :root / html.dark-theme 两套主题适配）。
import { TextAreaAutoComplete } from "./autocomplete.js";

// 只走 WindMix 自己的路由（prompt_studio/api.py 注册）。
// 刻意不设 /weilin/... 兜底——那会变成向外部 WeiLin 插件取词，词库来源不唯一。
const WORDS_URL = "/WM_prompt/physton_prompt/get_csv?key=" + encodeURIComponent("danbooru-0-zh.csv");

let _words = null; // { tag: { text, hint } }，null = 未加载
let _loading = null; // 进行中的 Promise

// 加载词库（页面级缓存；空结果不缓存，下次重试）
export function ensureAcWords() {
    if (_words) return Promise.resolve(_words);
    if (!_loading) {
        _loading = fetch(WORDS_URL)
            .then((r) => (r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status))))
            .then((txt) => {
                const words = {};
                for (const line of txt.split(/\r?\n/)) {
                    const i = line.indexOf(",");
                    if (i <= 0) continue;
                    const tag = line.slice(0, i).trim();
                    const zh = line.slice(i + 1).trim();
                    if (!tag || !zh || zh === tag) continue;
                    // CSV 本身按热度排序，Object 保持插入序 → 前缀命中也按热度排列
                    words[tag] = { text: tag, hint: zh };
                }
                if (Object.keys(words).length) _words = words;
                return words;
            })
            .catch((e) => {
                console.warn("[WindMix] 自动补全词库加载失败（danbooru-0-zh.csv）：", e);
                return {};
            })
            .then((w) => {
                _loading = null;
                return w;
            });
    }
    return _loading;
}

// 挂到 textarea 上；返回 Promise<实例|null>（词库拿不到时返回 null，调用方不显示下拉）
// opts.zIndex：下拉层级，默认 100000（普通模态用）
// opts.width ：下拉宽度，默认 470
export function attachAutoComplete(ta, opts) {
    const zIndex = String((opts && opts.zIndex) || 100000);
    const width = (opts && opts.width) || 470;
    return ensureAcWords().then((words) => {
        if (!Object.keys(words).length) return null;
        const ac = new TextAreaAutoComplete(ta, document.body, words);
        // 上游下拉默认 position:static（为嵌入式布局设计），这里改成「跟随光标的 fixed」
        // 并压在模态之上。#update 每次刷新都会调 getCursorOffset，在这里顺带定位即可，
        // 无需侵入上游类。
        const origOffset = ac.helper.getCursorOffset.bind(ac.helper);
        ac.helper.getCursorOffset = () => {
            const pos = origOffset();
            const dd = ac.dropdown;
            dd.style.position = "fixed";
            dd.style.zIndex = zIndex;
            dd.style.width = width + "px";
            dd.style.maxWidth = "92vw";
            const left = Math.max(8, Math.min(pos.left - window.scrollX, window.innerWidth - width - 8));
            let top = pos.top - window.scrollY + 4;
            if (top + 240 > window.innerHeight) top = Math.max(8, top - 244); // 底部空间不足时翻到上方
            dd.style.left = left + "px";
            dd.style.top = top + "px";
            return pos;
        };
        return ac;
    });
}

// 摘掉下拉。注意：引擎 #setup() 会往 textarea 上挂 keydown/keyup/click/blur 监听且没有 destroy，
// 所以「复用同一个 textarea」的场景只能挂一次实例，隐藏时只清 DOM；
// 引擎的 #update 会在下次输入时把下拉重新挂回 mountEl。
export function detachAutoComplete(ac) {
    if (ac && ac.dropdown) ac.dropdown.remove();
}
