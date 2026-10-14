// ComfyUI-WindMix — ⚡ 预设文本 节点前端（v3：换成 LoRA 卡片那一套皮）
//
// 界面全部复用 web/windmix_lora_manager.js 导出的共用件（样式 / 图标 / 提示条 /
// 底距几何引擎），DOM 一律 wm2-* 类，节点尺寸字段沿用 node.__wm2*（引擎按这套名字读缓存）。
//
// 与 LoRA 卡片的差异（也就是本节点自己的功能）：
//   · 工具栏摆 新建文件夹 / 分隔符 / 名称宽 / 随机选择 / 数量 —— 后两个框和旧版一样直接摆在
//     外面改数值，框里只显示内容本身（不写「分隔符」「名称宽」几个字），叫什么靠 title 提示。
//   · 每行行尾是「书签」按钮，三态：灰空心=没存过；紫实心=存过且一致；紫实心+橙点=本地又改了。
//     判定靠条目上绑的 presetId（库里那条的 id）+ 内容比对，预设换目录/改名都不会认错。
//     名称也算身份：行上改了名称就退回灰空心，点书签另存一份新的，不覆盖库里那条；
//     只有名称没动、只改内容，才是紫实心+橙点，点书签按 id 覆盖。
//   · 点内容弹出的编辑弹窗：只编辑内容（名称在行上改），整窗右下角可拖大小，尺寸记住下次用。
//   · 预设管理器的「发送 / 发送选中 / 发送整个目录」会把库里的 id 一起送进来，落到节点即绑定。
//
// 数据契约（隐藏 preset_text_data 控件，ComfyUI 自动序列化；后端只读 items/entries/enabled/
// content/separator/randomEnabled/randomCount，多出来的 presetId/presetHash 对后端是惰性字段）：
//   { items:[{kind:"entry",id,enabled,title,content,presetId,presetHash}
//           | {kind:"folder",id,name,enabled,collapsed,entries:[…同上]}],
//     separator, randomEnabled, randomCount, nameWidth }
import { app } from "../../scripts/app.js";
// 自动补全：复用 prompt_studio 自带的 TextAreaAutoComplete 引擎，
// 词库加载 + 挂载封装在 windmix_preset_ac.js（预设文本节点与预设管理器共用同一份缓存）
import { attachAutoComplete, detachAutoComplete } from "./js/prompt_studio/windmix_preset_ac.js";
// LoRA 界面共用件：样式、图标、提示条、底距几何引擎
import {
    injectStyle as injectKitStyle, IC, warn,
    lockBottomBar, ensureNodeFits, measureChrome, bottomGapState,
    UI_H, MIN_NODE_W, MAX_ROWS,
} from "./windmix_lora_manager.js";

const NODE_TYPE = "WindMixPresetText";
const DATA_WIDGET = "preset_text_data";
const API_PRESETS = "/windmix/preset_text/presets";

const MIN_W = MIN_NODE_W;               // 400：分隔符/名称宽收到最紧摆在工具栏，宽度一点没动
const NAME_W_DEF = 80;
const LIB_TTL = 4000;                   // 预设库缓存 4s，够一次批量操作复用
const SIZE_KEY = "WindMix.pedit.size";  // 编辑弹窗尺寸记这儿，下次打开还是那么大
const FS_KEY = "WindMix.pedit.fs";      // 编辑弹窗字号（小/中/大 三挡）
const FS_DEF = "中";

let _stStyleInjected = false;
function injectStyle() {
    injectKitStyle();
    if (_stStyleInjected) return;
    _stStyleInjected = true;
    const s = document.createElement("style");
    s.id = "wm-preset-style";
    s.textContent = `
/* ---- 顶部工具栏：分隔符 / 名称宽 和旧版一样直接摆在外面，只是各带一条 title 提示 ---- */
.wm2-tbar { display:flex; align-items:center; gap:5px; flex-wrap:wrap; flex:none; font-size:11px; color:var(--wm-lo-dim); }
.wm2-tbar .gap { flex:1; min-width:0; }
.wm2-tbar .fbtn { width:28px; height:28px; flex:none; border:1px solid var(--wm-lo-accent); border-radius:7px;
  background:var(--wm-lo-field); color:var(--wm-lo-accent); display:inline-flex; align-items:center;
  justify-content:center; cursor:pointer; padding:0; }
.wm2-tbar .fbtn:hover { background:var(--wm-lo-accent-soft); }
.wm2-tbar .fbtn.on { background:var(--wm-lo-accent-soft); border-color:var(--wm-lo-param); }
.wm2-tbar .chk { display:inline-flex; align-items:center; gap:6px; height:28px; padding:0 9px 0 8px; cursor:pointer;
  background:var(--wm-lo-field); border:1px solid var(--wm-lo-line2); border-radius:7px; color:var(--wm-lo-fg); }

/* 工具栏字段：框里只有内容，名字写在 title 和空框的 placeholder 上。
   少掉两个标签反而比旧版更省宽度，400px 最小宽度下六个控件占 ~306px（可用 370）。 */
.wm2-tbar .fld { display:inline-flex; align-items:center; gap:4px; height:28px; padding:0 6px; flex:none;
  background:var(--wm-lo-field); border:1px solid var(--wm-lo-line2); border-radius:7px; color:var(--wm-lo-fg); }
.wm2-tbar .fld:focus-within { border-color:var(--wm-lo-accent);
  box-shadow:0 0 0 2px var(--wm-lo-accent-soft); }
.wm2-tbar .fld .k { color:var(--wm-lo-dim); font-size:10.5px; white-space:nowrap; }
.wm2-tbar .fld input { background:none; border:none; outline:none; color:var(--wm-lo-fg);
  font-size:11.5px; font-family:inherit; width:100%; min-width:0; }
.wm2-tbar .fld input::placeholder { color:var(--wm-lo-dim); opacity:.75; font-style:italic; }
.wm2-tbar .sep input { width:52px; }
.wm2-tbar .nw input { width:40px; text-align:center; }
.wm2-tbar .rc input { width:25px; text-align:center; }
.wm2-tbar input[type=number]::-webkit-outer-spin-button, .wm2-tbar input[type=number]::-webkit-inner-spin-button {
  -webkit-appearance:none; margin:0; }
.wm2-tbar input[type=number] { -moz-appearance:textfield; appearance:textfield; }

/* 名称：还是在行上输入（宽度由「名称宽」统一调），编辑弹窗里没有这一行 */
.wm2-nmi { flex:0 0 80px; min-width:0; height:22px; box-sizing:border-box; background:var(--wm-lo-field);
  border:1px solid transparent; border-radius:5px; padding:0 7px; color:var(--wm-lo-fg);
  font-size:11.5px; font-family:inherit; }
.wm2-nmi:hover, .wm2-nmi:focus { border-color:var(--wm-lo-accent); outline:none; }

/* 内容摘要：一行省略，点击打开编辑弹窗 */
.wm2-ct { flex:1; min-width:0; height:22px; display:flex; align-items:center; background:var(--wm-lo-field);
  border:1px solid transparent; border-radius:5px; padding:0 7px; font-size:11.5px; color:var(--wm-lo-fg);
  cursor:pointer; overflow:hidden; }
.wm2-ct .txt { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wm2-ct .txt.empty { color:var(--wm-lo-dim); font-style:italic; opacity:.75; }
.wm2-ct:hover { border-color:var(--wm-lo-accent); }

/* 书签按钮（保存到预设）：只有三种状态，不做「库里没了」那种反向提醒 */
.wm2-bk { flex:none; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center;
  position:relative; border-radius:5px; cursor:pointer; color:var(--wm-lo-dim);
  border:1px solid var(--wm-lo-line); background:var(--wm-lo-field); }
.wm2-bk svg { width:13px; height:13px; }
.wm2-bk:hover { color:var(--wm-lo-accent); border-color:var(--wm-lo-accent); }
.wm2-bk.saved { color:var(--wm-lo-param); border-color:var(--wm-lo-param); background:var(--wm-lo-accent-soft); }
.wm2-bk.saved svg { fill:var(--wm-lo-param); }
/* 改过 = 紫实心（它确实存进过库）+ 右上角橙点（内容和库里那条不一致了） */
.wm2-bk.dirty { color:var(--wm-lo-param); border-color:var(--wm-lo-param); background:var(--wm-lo-accent-soft); }
.wm2-bk.dirty svg { fill:var(--wm-lo-param); }
.wm2-bk.dirty::after { content:''; position:absolute; top:-3px; right:-3px; width:8px; height:8px;
  border-radius:50%; background:var(--wm-lo-warn); border:1.5px solid var(--wm-lo-panel); }
/* 组头里的书签排在计数之后、删除之前 */
.wm2-gh .wm2-bk { margin-left:auto; }

/* 底栏：左「预设文本」描边、右「＋ 新增文本框」实心，位置与职能跟旧版一致 */
.wm2-solid { background:var(--wm-lo-brand); border-color:var(--wm-lo-brand); color:#fff; font-weight:600; }
.wm2-solid:hover { background:var(--wm-lo-accent); border-color:var(--wm-lo-accent); }

/* 内容编辑弹窗：直接带 .wm2-modal 拿共用件令牌（和 LoRA 浏览弹窗同一套外观）。
   resize:both 给整个弹窗 → 右下角一个把手就能把弹窗和内容框一起拉大，
   内容框 width:100% + flex:1 跟着长，尺寸写进 localStorage 下次沿用。 */
.wm2-pedit { width:640px; max-width:96vw; max-height:94vh; resize:both; overflow:auto; }
.wm2-pedit .sub { display:flex; align-items:center; gap:8px; font-size:11px; color:var(--wm-lo-dim); font-style:italic; }
.wm2-pedit .sub .sp { flex:1; min-width:0; }
/* 字号三挡：提示语后面紧跟，选中的那挡填紫（和书签/参数色一致） */
.wm2-pedit .fs { display:flex; align-items:center; gap:4px; flex:none; font-style:normal; }
.wm2-pedit .fs button { width:26px; height:20px; padding:0; border-radius:5px; cursor:pointer; font-family:inherit;
  border:1px solid var(--wm-lo-line2); background:var(--wm-lo-field); color:var(--wm-lo-dim); font-size:11px; }
.wm2-pedit .fs button:hover { color:var(--wm-lo-accent); border-color:var(--wm-lo-accent); }
.wm2-pedit .fs button.on { color:var(--wm-lo-param); border-color:var(--wm-lo-param); background:var(--wm-lo-accent-soft); }
.wm2-pedit textarea { flex:1 1 auto; width:100%; min-height:130px; box-sizing:border-box; resize:none;
  background:var(--wm-lo-field); border:1px solid var(--wm-lo-line2); border-radius:8px; color:var(--wm-lo-fg);
  font-size:13px; padding:10px; font-family:inherit; line-height:1.55; outline:none; }
.wm2-pedit textarea:focus { border-color:var(--wm-lo-accent); box-shadow:0 0 0 2px var(--wm-lo-accent-soft); }
.wm2-pedit .foot { display:flex; align-items:center; gap:9px; flex:none; }
.wm2-pedit .foot .sp { flex:1; }
.wm2-pedit .foot button { padding:6px 18px; border-radius:7px; cursor:pointer; font-size:12.5px; font-family:inherit;
  border:1px solid var(--wm-lo-line2); background:none; color:var(--wm-lo-fg); }
.wm2-pedit .foot button.ok { background:var(--wm-lo-brand); border-color:var(--wm-lo-brand); color:#fff; font-weight:600; }
.wm2-pedit .foot .tip { font-size:11px; color:var(--wm-lo-dim); font-style:italic; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; max-width:60%; }
/* 自动补全下拉跟着内容框字号：只有编辑弹窗这个下拉会被打上 .wm2-ac-sync，
   管理器里的补全（同一套 prompt_studio 样式）不受影响。胶囊原本写死 11px，这里放开成继承。 */
.wm2-ac-sync .prompt-studio-autocomplete-item,
.wm2-ac-sync .prompt-studio-autocomplete-pill { font-size:inherit; }
/* 自动补全下拉的配色：上游样式全靠 ComfyUI 的 --bg-color/--fg-color/--border-color，
   这几个变量在浅色主题下未必定义，一缺就退回它自己的深色 fallback —— 浅色界面里冒出一块
   黑底。这里按共用件那套浅/深色显式重画一遍，只认 .wm2-ac-scope（编辑弹窗的下拉才有这个
   标记），预设管理器 iframe 里的补全一行样式都不碰。 */
.wm2-ac-scope.prompt-studio-autocomplete {
  background:#fff; color:#14141a; border:1px solid #b4b4c0; box-shadow:0 10px 30px rgba(30,30,60,.18); }
.wm2-ac-scope .prompt-studio-autocomplete-item,
.wm2-ac-scope .prompt-studio-autocomplete-item-info { color:#14141a; }
.wm2-ac-scope .prompt-studio-autocomplete-item:hover,
.wm2-ac-scope .prompt-studio-autocomplete-item.prompt-studio-autocomplete-item--selected { background:rgba(83,74,183,.14); }
.wm2-ac-scope .prompt-studio-autocomplete-highlight { color:#4a41a8; }
.wm2-ac-scope .prompt-studio-autocomplete-pill { background:rgba(83,74,183,.12); color:#55555f; }
html.dark-theme .wm2-ac-scope.prompt-studio-autocomplete {
  background:#2f2f33; color:#ececee; border-color:#4e4e54; box-shadow:0 14px 40px rgba(0,0,0,.5); }
html.dark-theme .wm2-ac-scope .prompt-studio-autocomplete-item,
html.dark-theme .wm2-ac-scope .prompt-studio-autocomplete-item-info { color:#ececee; }
html.dark-theme .wm2-ac-scope .prompt-studio-autocomplete-item:hover,
html.dark-theme .wm2-ac-scope .prompt-studio-autocomplete-item.prompt-studio-autocomplete-item--selected { background:rgba(155,138,245,.24); }
html.dark-theme .wm2-ac-scope .prompt-studio-autocomplete-highlight { color:#9b8af5; }
html.dark-theme .wm2-ac-scope .prompt-studio-autocomplete-pill { background:rgba(155,138,245,.16); color:#9a9aa2; }
`;
    document.head.append(s);
}

// 书签图标（线条 + currentColor，和 IC 里那几个同风格）
const BK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>`;
const DEL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>`;

//==============================================================================
// 数据读写
//==============================================================================
function genId() { return "e_" + Math.random().toString(36).slice(2, 9); }
function genFolderId() { return "f_" + Math.random().toString(36).slice(2, 9); }

// 内容指纹（FNV-1a）：预设库暂时读不到时用它判断「本地有没有改过」，不打扰用户
function hashStr(s) {
    let h = 0x811c9dc5;
    const str = String(s == null ? "" : s);
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16);
}

function defaultEntry() {
    return { id: genId(), enabled: true, title: "", content: "", presetId: "", presetHash: "" };
}

// 全新节点（没有任何条目）默认带一个空白文本框，避免创建后没有任何可输入区域。
// 仅在「无已存数据」时使用：带 preset_text_data 的已保存工作流（即使是空的）一律尊重，不回灌空白框。
function ensureSeed(node) {
    if (!node.__stData || typeof node.__stData !== "object") node.__stData = { items: [] };
    if (!node.__stData.items || node.__stData.items.length === 0) {
        node.__stData.items = [defaultEntry()];
    }
}

function normEntry(e) {
    return {
        id: (e && e.id) || genId(),
        enabled: !!(e && e.enabled),
        title: (e && e.title) || "",
        content: (e && e.content) || "",
        // 绑到库里那条预设的 id（不是路径），预设换目录/改名都认得；旧数据没这两个字段 → 空串
        presetId: (e && e.presetId) || "",
        presetHash: (e && e.presetHash) || "",
    };
}

// 顶层结构归一为有序 items 序列（entry / folder 可交错），
// 兼容旧结构（rootEntries + folders）→ 转换为 items（rootEntries 在前、folders 在后）。
function normItem(it) {
    if (!it || typeof it !== "object") return { kind: "entry", ...defaultEntry() };
    if (it.kind === "folder") {
        return {
            kind: "folder",
            id: it.id || genFolderId(),
            name: it.name || "新建文件夹",
            // 文件夹整体启用开关（默认 true）；后端会跳过 enabled=false 的整个文件夹
            enabled: it.enabled === false ? false : true,
            // 折叠状态（默认展开）；持久化到 data，刷新/重载后保持
            collapsed: !!(it.collapsed),
            entries: Array.isArray(it.entries) ? it.entries.map(normEntry) : [],
        };
    }
    return { kind: "entry", ...normEntry(it) };
}

function normalizeData(data) {
    if (!data || typeof data !== "object") data = {};
    const out = {};
    let items;
    if (Array.isArray(data.items)) {
        items = data.items.map(normItem);
    } else {
        const root = Array.isArray(data.rootEntries)
            ? data.rootEntries : (Array.isArray(data.entries) ? data.entries : []);
        items = root.map((e) => normItem({ kind: "entry", ...normEntry(e) }));
        const folders = Array.isArray(data.folders) ? data.folders : [];
        items = items.concat(folders.map((f) => normItem({ kind: "folder", ...f })));
    }
    out.items = items;
    out.separator = typeof data.separator === "string" ? data.separator : ",\\n---\\n";
    out.randomEnabled = !!data.randomEnabled;
    out.randomCount = typeof data.randomCount === "number" ? data.randomCount : 1;
    out.nameWidth = typeof data.nameWidth === "number" ? data.nameWidth : NAME_W_DEF;
    return out;
}

function loadData(node) {
    const hw = node.widgets && node.widgets.find((w) => w.name === DATA_WIDGET);
    const raw = hw ? hw.value : "{}";
    let data = null;
    try { data = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { data = null; }
    return normalizeData(data);
}

function saveData(node) {
    const hw = node.widgets && node.widgets.find((w) => w.name === DATA_WIDGET);
    if (hw) hw.value = JSON.stringify(node.__stData);
    // 打字是高频操作，这里只写数据、不碰尺寸：节点高度与条目数解耦（固定高度 + 列表内滚动），
    // 只有条目增减、折叠这类结构性变化才需要 lockBottomBar 重新分配列表高度；
    // 工具栏常年一排，输入时不碰尺寸。
}

// 载入新数据但保持 __stData 的对象身份。
// buildUI 只建一次，工具栏各输入框的事件闭包持的就是当时那个 __stData 引用；
// 而 ComfyUI 载入工作流一定是「先 onNodeCreated 建界面，再 onConfigure 灌数据」，
// 若这里换成新对象，工具栏那些改动（新增文本框、分隔符、名称宽、随机选择）就全写进
// 被丢弃的旧对象里，表现为「重载过的节点改不动、改完也不落盘」。
function applyData(node, parsed) {
    if (!parsed || typeof parsed !== "object") return;
    if (!node.__stData || typeof node.__stData !== "object") node.__stData = parsed;
    else Object.assign(node.__stData, parsed);
}

function findEntry(node, entryId) {
    const items = (node.__stData && node.__stData.items) || [];
    for (const it of items) {
        if (it.kind === "folder") {
            const e = (it.entries || []).find((x) => x.id === entryId);
            if (e) return e;
        } else if (it.id === entryId) return it;
    }
    return null;
}
function findFolder(node, folderId) {
    const items = (node.__stData && node.__stData.items) || [];
    return items.find((x) => x.kind === "folder" && x.id === folderId) || null;
}
function folderIdOfEntry(node, entryId) {
    const items = (node.__stData && node.__stData.items) || [];
    for (const it of items) {
        if (it.kind === "folder" && (it.entries || []).some((e) => e.id === entryId)) return it.id;
    }
    return null;
}

//==============================================================================
// 结构增删与拖拽排序
//==============================================================================
let _drag = null;   // { kind:"entry"|"folder", id }

// 从任意位置取出一个 entry（顶层 items 或某个 folder 内），返回该对象（已脱离原数组）
function takeEntry(node, entryId) {
    const items = node.__stData.items;
    for (const f of items) {
        if (f.kind === "folder") {
            const i = (f.entries || []).findIndex((e) => e.id === entryId);
            if (i >= 0) return f.entries.splice(i, 1)[0];
        }
    }
    const i = items.findIndex((x) => x.kind === "entry" && x.id === entryId);
    if (i >= 0) return items.splice(i, 1)[0];
    return null;
}

function removeEntry(node, entryId, folderId) {
    if (folderId == null) {
        const i = node.__stData.items.findIndex((x) => x.kind === "entry" && x.id === entryId);
        if (i >= 0) node.__stData.items.splice(i, 1);
    } else {
        const f = findFolder(node, folderId);
        if (f) {
            const i = (f.entries || []).findIndex((e) => e.id === entryId);
            if (i >= 0) f.entries.splice(i, 1);
        }
    }
}

function itemKey(it) { return it.kind + ":" + it.id; }

// 放进某个文件夹：anchorId 之前/之后；anchorId=null → 末尾。
// 调用方必须先把被拖对象取出数组（takeEntry），这样锚点索引才不会被自己占位。
function placeInFolder(node, obj, folderId, anchorId, after) {
    const f = findFolder(node, folderId);
    if (!f) { node.__stData.items.push(obj); return; }
    f.entries = f.entries || [];
    const i = anchorId == null ? -1 : f.entries.findIndex((e) => e.id === anchorId);
    if (i < 0) f.entries.push(obj);
    else f.entries.splice(after ? i + 1 : i, 0, obj);
}

function placeTop(node, obj, anchorKey, after) {
    const items = node.__stData.items;
    const i = anchorKey == null ? -1 : items.findIndex((x) => itemKey(x) === anchorKey);
    if (i < 0) items.push(obj);
    else items.splice(after ? i + 1 : i, 0, obj);
}

// 文本行落点：folderId=null 表示落在顶层
function moveEntryTo(node, drag, folderId, anchorId, after) {
    if (!drag || drag.kind !== "entry" || anchorId === drag.id) return;
    const obj = takeEntry(node, drag.id);
    if (!obj) return;
    if (folderId == null) placeTop(node, obj, anchorId ? "entry:" + anchorId : null, after);
    else placeInFolder(node, obj, folderId, anchorId, after);
    // 目标文件夹是折叠的就展开，免得拖进去看不见
    const tf = folderId == null ? null : findFolder(node, folderId);
    if (tf && tf.collapsed) { tf.collapsed = false; saveData(node); }
    saveData(node);
    renderList(node, true);
}

// 顶层排序：entry 或 folder 移动到 anchorKey 之前/之后
function moveTopLevel(node, drag, anchorKey, after) {
    if (!drag) return;
    // 落点是自身则等价于不移动。否则自身被先移出数组后就找不到锚点，
    // 会被 push 到末尾，造成「轻微误拖即跳到列表最后」
    if (anchorKey === (drag.kind === "folder" ? "folder:" : "entry:") + drag.id) return;
    const items = node.__stData.items;
    let obj = null;
    if (drag.kind === "entry") obj = takeEntry(node, drag.id);
    else {
        const i = items.findIndex((x) => x.kind === "folder" && x.id === drag.id);
        if (i >= 0) obj = items.splice(i, 1)[0];
    }
    if (!obj) return;
    placeTop(node, obj, anchorKey, after);
    saveData(node);
    renderList(node, true);
}

// 列表里当前鼠标位置对应的顶层锚点（y 落在某卡片上半=插到它之前，下半=之后）
function topAnchor(list, y) {
    const kids = Array.from(list.children).filter((el) => el.dataset && el.dataset.key);
    for (const el of kids) {
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) return { key: el.dataset.key, after: false };
        if (y < r.bottom) return { key: el.dataset.key, after: true };
    }
    return { key: null, after: true };      // 末尾
}

function clearMarks(node) {
    (node.__wm2Container?.querySelectorAll(".over-top,.over-bot,.drag,.over") || []).forEach((x) => {
        x.classList.remove("over-top", "over-bot", "drag", "over");
    });
}

//==============================================================================
// 预设库：书签三态的数据源 + 保存
//==============================================================================
// 一次 GET 拿全量：presets = [{id,name,content,folder,parent,image}]
let _lib = { at: 0, ok: false, map: null };
let _libPromise = null;

function fetchLib(force) {
    if (!force && _lib.ok && _lib.map && Date.now() - _lib.at < LIB_TTL) return Promise.resolve(_lib);
    if (_libPromise) return _libPromise;
    _libPromise = fetch(API_PRESETS + "?all=1")
        .then(async (r) => {
            let d = null;
            try { d = await r.json(); } catch (e) { d = null; }
            return r.ok && d && d.success ? d : null;
        })
        .then((d) => {
            const map = new Map();
            ((d && d.presets) || []).forEach((p) => { if (p && p.id) map.set(p.id, p); });
            // 名称索引：库里同名往往就是同一条文本（从管理器发过来的行没带 id 时靠它认亲），
            // 也用它拦下「同名再存一份」这种重复项。
            const byName = new Map();
            map.forEach((p) => {
                const k = (p.name || "").trim();
                if (!byName.has(k)) byName.set(k, []);
                byName.get(k).push(p);
            });
            _lib = { at: Date.now(), ok: !!d, map: d ? map : (_lib.map || null),
                     byName: d ? byName : (_lib.byName || null) };
            _libPromise = null;
            return _lib;
        })
        .catch(() => {
            _libPromise = null;
            _lib = { at: Date.now(), ok: false, map: _lib.map, byName: _lib.byName };
            return _lib;
        });
    return _libPromise;
}
function invalidateLib() { _lib = { at: 0, ok: false, map: _lib.map, byName: _lib.byName }; _libPromise = null; }

// 写完库 / 库刷新后，把所有还挂着的节点书签重画一遍
function refreshLib(node) {
    return fetchLib(false).then(() => {
        const set = window.__wmPresetNodes;
        if (set && set.forEach) {
            set.forEach((n) => {
                if (!n || !n.__wm2Container || !n.__wm2Container.isConnected) { set.delete(n); return; }
                paintBookmarks(n);
            });
        }
        if (node) paintBookmarks(node);
        return _lib;
    });
}

// 条目 → 书签状态：none / saved / dirty
function bkState(entry) {
    if (!entry || !entry.presetId) return adoptOrNone(entry);
    const p = _lib.ok && _lib.map ? _lib.map.get(entry.presetId) : null;
    if (!p) {
        // 库读不到（服务没回 / 还没发过请求）：按本地指纹判断，不乱改状态、也不当没存过
        if (!_lib.ok) {
            const same = !entry.presetHash || entry.presetHash === hashStr(entry.content);
            return { st: same ? "saved" : "dirty", where: "", pending: true };
        }
        return adoptOrNone(entry);     // 绑的那条已被删：先认认库里有没有同名同内容的，再退回没存过
    }
    const where = whereOf(p);
    // 名称就是这条预设的身份：行上把名称改了，等于「要的是另一条预设」，书签回到灰空心，
    // 点保存另存一份新的，绝不覆盖库里原来那条（只有内容改动才走覆盖）。
    const titleSame = (entry.title || "") === (p.name || "");
    if (!titleSame) return { st: "none", renamed: true, where, p };
    const same = (entry.content || "") === (p.content || "");
    return { st: same ? "saved" : "dirty", where, p };
}
// 库里同名且内容一致的那条（行上没绑 id 时的认亲依据）
function matchLib(entry) {
    if (!entry || !_lib.byName) return null;
    const arr = _lib.byName.get((entry.title || "").trim()) || [];
    return arr.find((p) => (p.content || "") === (entry.content || "")) || null;
}
function adoptOrNone(entry) {
    const m = _lib.ok ? matchLib(entry) : null;
    if (m) return { st: "saved", where: whereOf(m), p: m, auto: m.id };
    return { st: "none" };
}
// 同名查重：exact=库里已有同名同内容的一条（直接绑，不用再存）；other=同名但内容不同
function dupCheck(name, content) {
    const arr = (_lib.byName && _lib.byName.get(name)) || [];
    return { exact: arr.find((p) => (p.content || "") === (content || "")) || null,
             other: arr[0] || null };
}
// 把「其实库里早就有」的行绑回那条预设：以后改内容才是覆盖，而不是又存一份重复的
function adoptBindings(node) {
    if (!node.__stData || !_lib.ok || !_lib.byName) return false;
    let changed = false;
    (node.__stData.items || []).forEach((it) => {
        const es = it.kind === "folder" ? (it.entries || []) : [it];
        es.forEach((e) => {
            const m = matchLib(e);
            if (m && e.presetId !== m.id) { e.presetId = m.id; e.presetHash = hashStr(e.content); changed = true; }
        });
    });
    return changed;
}
function whereOf(p) {
    const f = p.folder || "未分类";
    return p.parent ? p.parent + " / " + f : f;
}
// 文件夹书签：整组都一致算 saved，有一条没绑/改过就算 dirty
function folderBkState(folder) {
    const es = (folder && folder.entries) || [];
    if (!es.length) return { st: "none" };
    let bound = 0, dirty = 0, renamed = 0, where = "";
    es.forEach((e) => {
        const s = bkState(e);
        if (s.st === "saved" || s.st === "dirty") {
            bound += 1;
            if (s.st === "dirty") dirty += 1;
            if (!where && s.where) where = s.where;
        } else if (s.renamed) {                 // 改了名称：组按钮按「有东西要另存」亮橙点
            renamed += 1;
            if (!where && s.where) where = s.where;
        }
    });
    if (!bound && !renamed) return { st: "none" };
    return { st: dirty || renamed ? "dirty" : "saved", where, n: es.length,
             dirty, renamed };
}
function bkTip(info, kind) {
    const f = kind === "folder";
    if (info.pending) {
        if (info.st === "dirty") return f ? "存过，但组里有内容本地改过（还没读到库，点了按 id 覆盖）"
                                          : "存过，但本地内容改过（还没读到库，点了按 id 覆盖）";
        return f ? "这一组存进过预设库（还没读到库，稍后自动确认）" : "存进过预设库（还没读到库，稍后自动确认）";
    }
    if (info.st === "saved") {
        return f ? `这一组已保存 · 内容一致`
                 : `已保存到「${info.where}」· 内容没改过`;
    }
    if (info.st === "dirty") {
        if (f) {
            const bits = [];
            if (info.dirty) bits.push(`${info.dirty} 条内容改过`);
            if (info.renamed) bits.push(`${info.renamed} 条改了名称`);
            const act = info.dirty && info.renamed ? "改过的覆盖回库里、改了名的另存新条目"
                      : info.renamed ? "把改了名的另存成新预设（库里原来那条不动）"
                      : `覆盖回库里「${info.where}」`;
            return `存过，但组里有 ${bits.join("、")} · 点这里${act}`;
        }
        return `存过，但本地又改了 · 点这里把新内容覆盖回库里那条「${info.where}」`;
    }
    if (info.renamed) {
        return `改了名称 · 点这里把这条另存成新的预设（库里「${info.where}」那条不动）`;
    }
    return f ? "这一组还没存过 · 点这里把组里的文本都存进预设库"
             : "没存过 · 点这里存进预设库（存完书签变紫）";
}

function postLib(payload) {
    return fetch(API_PRESETS, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).then(async (r) => {
        let d = null;
        try { d = await r.json(); } catch (e) { d = null; }
        if (!r.ok) return { success: false, message: "请求失败 (HTTP " + r.status + ")" };
        return d || { success: false, message: "服务端返回为空" };
    }).catch((e) => ({ success: false, message: "请求失败：" + e }));
}

function bindEntry(entry, id) {
    entry.presetId = id || "";
    entry.presetHash = hashStr(entry.content);
}

// 连点保护：书签是异步写库，同一条目在写完之前不再重复发起（否则会存出两条）
const _busy = new Set();
function busy(key, fn) {
    if (_busy.has(key)) return Promise.resolve();
    _busy.add(key);
    return Promise.resolve().then(fn).finally(() => _busy.delete(key));
}

// 单条：没存过 → 新建；存过且改过 → 覆盖更新那一条；存过且一致 → 只报位置
function saveEntryToLib(node, entry) {
    if (!entry) return;
    return busy("e" + entry.id, async () => {
        const info = bkState(entry);
        if (info.st === "saved") {
            warn(node, `这条已经在「${info.where || "预设库"}」里，内容一致，不用覆盖`);
            return;
        }
        if (info.st === "dirty") {
            const r = await postLib({
                action: "update", id: entry.presetId,
                name: entry.title || "未命名", content: entry.content || "",
            });
            if (!r || !r.success) { warn(node, (r && r.message) || "覆盖失败", true); return; }
            entry.presetHash = hashStr(entry.content);
            invalidateLib();
            await refreshLib(node);
            saveData(node);
            warn(node, `已覆盖更新「${info.where}」`);
            return;
        }
        // 没存过 → 先查重再新建：库里已经有同名同内容的那条就直接绑，同名不同内容就拦下来，
        // 免得点一次书签多一条重复预设。
        const name = (entry.title || "").trim() || "未命名";
        await fetchLib(false);
        if ((entry.title || "").trim()) {
            const dup = dupCheck(name, entry.content || "");
            if (dup.exact) {
                bindEntry(entry, dup.exact.id);
                invalidateLib();
                await refreshLib(node);
                saveData(node);
                warn(node, `库里「${whereOf(dup.exact)}」已经有同名同内容的一条，已直接绑定，没有重复保存`);
                return;
            }
            if (dup.other) {
                warn(node, `库里已有同名预设「${name}」（在「${whereOf(dup.other)}」），但内容不一样 · ` +
                           `换个名称再存，或先到预设管理器里改那条`, true);
                return;
            }
        }
        const M = window.WindMixPresetManager;
        let newId = "";
        if (M && M.importPreset) {
            try { newId = await M.importPreset(name, entry.content || "") || ""; } catch (e) { newId = ""; }
        }
        if (!newId) {
            // 管理器没加载 / 没回 id：自己直接建（先确保两级「未分类」在，
            // 否则 add 会被「父级大分类不存在」校验拦下）
            await postLib({ action: "add_folder", name: "未分类", parent: "" });
            await postLib({ action: "add_folder", name: "未分类", parent: "未分类" });
            const r = await postLib({
                action: "add", name, content: entry.content || "",
                folder: "未分类", parent: "未分类",
            });
            if (!r || !r.success) { warn(node, (r && r.message) || "保存失败", true); return; }
            newId = r.id || "";
        }
        bindEntry(entry, newId);
        invalidateLib();
        await refreshLib(node);
        saveData(node);
        warn(node, `已存进预设库：「${name}」（未分类）`);
    });
}

// 整组：已绑好的逐条覆盖，没绑的打包新建，再把新 id 绑回去
function saveFolderToLib(node, folder) {
    if (!folder) return;
    return busy("f" + folder.id, async () => {
        const es = folder.entries || [];
        if (!es.length) { warn(node, "文件夹里还没有文本，没什么可保存的", true); return; }
        // 三分：只改了内容的按 id 覆盖；没绑过的和改了名称的都另存新条目（改名的那条
        // 跟库里那条已经不是同一个预设了，覆盖会把原来的名字冲掉）；一致的不碰。
        const bound = [];
        const fresh = [];
        es.forEach((e) => {
            const s = bkState(e);
            if (!e.presetId || s.renamed) fresh.push(e);
            else if (s.st === "dirty") bound.push(e);
        });
        let updated = 0;

        for (const e of bound) {
            if (bkState(e).st !== "dirty") continue;      // 一致的不动
            const r = await postLib({
                action: "update", id: e.presetId,
                name: e.title || "未命名", content: e.content || "",
            });
            if (r && r.success) { e.presetHash = hashStr(e.content); updated += 1; }
        }
        let reused = 0;       // 库里已有同名同内容，直接绑
        let skipped = 0;      // 同名但内容不同，拦下来不新建
        if (fresh.length) {
            await fetchLib(false);
            const keep = [];
            fresh.forEach((e) => {
                const nm = (e.title || "").trim();
                if (!nm) { keep.push(e); return; }
                const d = dupCheck(nm, e.content || "");
                if (d.exact) { bindEntry(e, d.exact.id); reused += 1; }
                else if (d.other) { skipped += 1; }
                else keep.push(e);
            });
            if (keep.length) {
            const fname = ((folder.name || "新建文件夹").trim()) || "新建文件夹";
            const items = keep.map((e) => ({ name: e.title || "未命名", content: e.content || "" }));
            const M = window.WindMixPresetManager;
            let okAdd = false;
            let ids = [];
            if (M && M.importFolder) {
                try {
                    const got = await M.importFolder(fname, items.map((x) => ({ title: x.name, content: x.content })));
                    okAdd = true;
                    if (Array.isArray(got)) ids = got;
                } catch (e) { okAdd = false; }
            }
            if (!okAdd) {
                await postLib({ action: "add_folder", name: "未分类", parent: "" });
                await postLib({ action: "add_folder", name: fname, parent: "未分类" });
                const r = await postLib({ action: "add_many", items, folder: fname, parent: "未分类" });
                if (!r || !r.success) { warn(node, (r && r.message) || "整组保存失败", true); return; }
                if (Array.isArray(r.ids)) ids = r.ids;
            }
            if (ids.length === keep.length) {
                // 后端把新建的 id 按提交顺序原样回传，直接一一对应绑上，不用猜名字
                keep.forEach((e, i) => bindEntry(e, ids[i]));
            } else {
                // 旧版后端没回 ids：重新读库，按「同目录 + 同名，内容一致优先」把 id 绑回去，
                // 匹配到一个就从池子里摘掉，避免重名条目全绑到同一条预设上
                const lib = await fetchLib(true);
                const pool = [];
                if (lib.map) lib.map.forEach((p) => { if ((p.folder || "未分类") === fname) pool.push(p); });
                keep.forEach((e) => {
                    const nm = e.title || "未命名";
                    let i = pool.findIndex((p) => (p.name || "") === nm && (p.content || "") === (e.content || ""));
                    if (i < 0) i = pool.findIndex((p) => (p.name || "") === nm);
                    if (i >= 0) bindEntry(e, pool.splice(i, 1)[0].id);
                    else e.presetHash = hashStr(e.content);
                });
            }
            }
        }
        invalidateLib();
        await refreshLib(node);
        saveData(node);
        const extra = [];
        if (reused) extra.push(`库里已有 ${reused} 条同名同内容，直接绑定`);
        if (skipped) extra.push(`${skipped} 条同名但内容不同，没另存（要存请先改名）`);
        const st = folderBkState(folder);
        warn(node, (st.st === "saved" ? `已把「${folder.name || "新建文件夹"}」整组存进预设库（${es.length} 条）`
                                      : `已覆盖更新 ${updated} 条，其余还没读到库，稍后书签会自动确认`)
                     + (extra.length ? " · " + extra.join(" · ") : ""));
    });
}

function paintBookmarks(node) {
    const c = node.__wm2Container;
    if (!c) return;
    // 先认亲：内容/名称和库里某条完全对得上（哪怕没绑过 id）就当它已经存过，并把 id 绑上
    if (adoptBindings(node)) saveData(node);
    c.querySelectorAll(".wm2-bk").forEach((el) => {
        const fid = el.dataset.folderId;
        const info = fid != null
            ? folderBkState(findFolder(node, fid))
            : bkState(findEntry(node, el.dataset.entryId));
        el.classList.toggle("saved", info.st === "saved");
        el.classList.toggle("dirty", info.st === "dirty");
        el.title = bkTip(info, fid != null ? "folder" : "entry");
    });
}

//==============================================================================
// 行 / 文件夹卡片（外观与 LoRA 卡片同一套，图标也直接复用 IC）
//==============================================================================
// 一个开关方框。工具栏里的开关只建一次（renderList 只重画列表），所以点了必须自己把
// 状态画回去：onclick 返回布尔就直接用，另外可选传 getState 在点击后回读一次。
function makeToggle(on, onclick, title, getState) {
    const t = document.createElement("span");
    t.className = "wm2-tgl";        // 方框 + 对号的样式全在这个类上，丢了一个字就整枚勾选框消失
    const paint = (v) => {
        t.classList.toggle("on", !!v);
        if (!title) t.title = v ? "已启用" : "已停用";
    };
    paint(on);
    t.addEventListener("click", (e) => {
        e.stopPropagation();
        const r = onclick();
        paint(getState ? getState() : (typeof r === "boolean" ? r : t.classList.contains("on")));
    });
    return t;
}

//  owning node 必须传进来：dragend 触发时 target 可能已被重绘摘出 DOM，
//  没法从元素反查节点，只能靠闭包里的引用清掉拖拽高亮。
function makeGrip(node, getDrag) {
    const grip = document.createElement("span");
    grip.className = "wm2-grip";
    grip.innerHTML = IC.grip;
    grip.title = "拖动排序";
    grip.draggable = true;
    grip.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        _drag = getDrag();
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", "windmix-preset"); } catch (err) {}
    });
    grip.addEventListener("dragend", () => { _drag = null; clearMarks(node); });
    return grip;
}

function entryRow(node, entry, folderId) {
    const off = !entry.enabled;
    const wrap = document.createElement("div");
    wrap.className = "wm2-wrap" + (off ? " off" : "");
    wrap.dataset.key = "entry:" + entry.id;

    const row = document.createElement("div");
    row.className = "wm2-row" + (off ? " off" : "");
    wrap.append(row);

    row.append(makeGrip(node, () => { row.classList.add("drag"); return { kind: "entry", id: entry.id }; }));

    row.append(makeToggle(entry.enabled, () => {
        entry.enabled = !entry.enabled;
        saveData(node);
        renderList(node, true);
    }));

    const name = document.createElement("input");
    name.type = "text";
    name.className = "wm2-nmi";
    name.value = entry.title || "";
    name.placeholder = "名称";
    name.title = "名称（编辑弹窗里没有这一行，名称就在这里改）\n已存过的话，改名会连着改库里那条的名称";
    name.spellcheck = false;
    name.style.flexBasis = ((node.__stData && node.__stData.nameWidth) || NAME_W_DEF) + "px";
    name.addEventListener("input", () => { entry.title = name.value; saveData(node); paintOne(node, entry); });
    // 框里横向拖动是选中文字，不能顺手把整行拖走
    name.addEventListener("dragstart", (e) => e.preventDefault());
    row.append(name);

    const ct = document.createElement("div");
    ct.className = "wm2-ct";
    const txt = document.createElement("span");
    txt.className = "txt" + (entry.content ? "" : " empty");
    txt.textContent = entry.content || "点这里写内容…";
    ct.append(txt);
    ct.title = "点击编辑内容（弹窗右下角可拖大小 · Ctrl+Enter 保存）";
    ct.addEventListener("click", () => openEditModal(node, entry, txt));
    row.append(ct);

    const bk = document.createElement("span");
    bk.className = "wm2-bk";
    bk.innerHTML = BK_SVG;
    bk.dataset.entryId = entry.id;
    bk.addEventListener("click", (e) => { e.stopPropagation(); saveEntryToLib(node, entry); });
    row.append(bk);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "wm2-ico del";
    del.innerHTML = DEL_SVG;
    del.title = "删除这条文本";
    del.addEventListener("click", () => {
        removeEntry(node, entry.id, folderId);
        saveData(node);
        renderList(node, true);
    });
    row.append(del);

    // 行接收拖拽：文本行可在根目录与文件夹之间移动，落点上半=之前、下半=之后
    row.addEventListener("dragover", (e) => {
        if (!_drag || _drag.kind !== "entry" || _drag.id === entry.id) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        clearMarks(node);
        const r = row.getBoundingClientRect();
        row.classList.add(e.clientY > r.top + r.height / 2 ? "over-bot" : "over-top");
    });
    row.addEventListener("drop", (e) => {
        if (!_drag || _drag.kind !== "entry" || _drag.id === entry.id) return;
        e.preventDefault(); e.stopPropagation();
        const r = row.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        const d = _drag; _drag = null;
        moveEntryTo(node, d, folderId, entry.id, after);
        clearMarks(node);
    });
    return wrap;
}

function folderCard(node, folder) {
    const off = folder.enabled === false;
    const closed = !!folder.collapsed;
    const es = folder.entries || [];
    const card = document.createElement("div");
    card.className = "wm2-grp" + (off ? " off" : "") + (closed ? " closed" : "") + (es.length ? "" : " empty");
    card.dataset.key = "folder:" + folder.id;

    const gh = document.createElement("div");
    gh.className = "wm2-gh";
    card.append(gh);

    const chev = document.createElement("span");
    chev.className = "chev";
    chev.innerHTML = IC.chev;
    chev.title = closed ? "展开文件夹" : "折叠文件夹";
    const toggleCollapse = () => {
        folder.collapsed = !folder.collapsed;
        card.classList.toggle("closed", folder.collapsed);
        chev.title = folder.collapsed ? "展开文件夹" : "折叠文件夹";
        saveData(node);
    };
    chev.addEventListener("click", (e) => { e.stopPropagation(); toggleCollapse(); });
    gh.append(chev);

    // 这个开关不会触发重绘（不重建列表），必须把新状态返回给 makeToggle 画回去，
    // 否则数据改了、勾还停在原位。
    gh.append(makeToggle(folder.enabled, () => {
        folder.enabled = folder.enabled === false;
        card.classList.toggle("off", !folder.enabled);
        saveData(node);
        paintCount(node);
        return folder.enabled;
    }, "启用整个文件夹（勾掉则整组不参与拼接输出）"));

    const fic = document.createElement("span");
    fic.className = "fic";
    fic.innerHTML = IC.folder;
    gh.append(fic);

    const gname = document.createElement("span");
    gname.className = "wm2-gname";
    gname.textContent = folder.name || "新建文件夹";
    gname.title = "双击改名";
    gname.addEventListener("dblclick", () => {
        const inp = document.createElement("input");
        inp.className = "wm2-rename";
        inp.value = folder.name || "";
        inp.spellcheck = false;
        inp.addEventListener("keydown", (ev) => {
            ev.stopPropagation();
            if (ev.key === "Enter") inp.blur();
            if (ev.key === "Escape") { inp.value = folder.name || ""; inp.blur(); }
        });
        inp.addEventListener("blur", () => {
            folder.name = inp.value.trim() || folder.name || "新建文件夹";
            gname.textContent = folder.name;
            saveData(node);
        });
        gh.replaceChild(inp, gname);
        inp.focus();
        inp.select();
    });
    gh.append(gname);

    const cnt = document.createElement("span");
    cnt.className = "wm2-gcnt";
    cnt.textContent = es.length + " 条";
    gh.append(cnt);

    const bk = document.createElement("span");
    bk.className = "wm2-bk";
    bk.innerHTML = BK_SVG;
    bk.dataset.folderId = folder.id;
    bk.addEventListener("click", (e) => { e.stopPropagation(); saveFolderToLib(node, folder); });
    gh.append(bk);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "wm2-ico del";
    del.innerHTML = DEL_SVG;
    del.title = "删除文件夹（连同其内全部内容）";
    del.addEventListener("click", () => {
        if (es.length && !confirm(`确定删除文件夹「${folder.name || "新建文件夹"}」及其全部内容？\n此操作不可撤销。`)) return;
        const i = node.__stData.items.findIndex((x) => x.kind === "folder" && x.id === folder.id);
        if (i >= 0) { node.__stData.items.splice(i, 1); saveData(node); renderList(node, true); }
    });
    gh.append(del);

    // 点组头空白处也折叠（和 LoRA 配方组一致）；名称要留着双击改名，
    // 勾选/书签/删除/计数各有自己的动作，都不参与。
    gh.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest(".wm2-gname,.wm2-rename,.wm2-tgl,.wm2-bk,.wm2-ico,.wm2-gcnt")) return;
        toggleCollapse();
    });

    // 整组从组头拖（和 LoRA 配方组一致；共用件的 .wm2-gh 本来就是 cursor:grab）
    gh.draggable = true;
    gh.addEventListener("dragstart", (e) => {
        if (e.target.classList && e.target.classList.contains("wm2-rename")) { e.preventDefault(); return; }
        e.stopPropagation();
        _drag = { kind: "folder", id: folder.id };
        card.classList.add("drag");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", "windmix-preset-folder"); } catch (err) {}
    });
    gh.addEventListener("dragend", () => { _drag = null; clearMarks(node); });

    const body = document.createElement("div");
    body.className = "wm2-gbody";
    card.append(body);
    if (!es.length) {
        const hint = document.createElement("div");
        hint.className = "wm2-ghint";
        hint.textContent = "空文件夹 · 把文本行拖进来";
        body.append(hint);
    } else es.forEach((e) => body.append(entryRow(node, e, folder.id)));

    // 组体接收文本行：行自己会 stopPropagation，所以只有落在缝隙/空提示上才轮到这里 = 追加到末尾
    body.addEventListener("dragover", (e) => {
        if (!_drag || _drag.kind !== "entry") return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        clearMarks(node);
        card.classList.add("over");
    });
    body.addEventListener("drop", (e) => {
        if (!_drag || _drag.kind !== "entry") return;
        e.preventDefault(); e.stopPropagation();
        const d = _drag; _drag = null;
        moveEntryTo(node, d, folder.id, null, true);
        clearMarks(node);
    });
    return card;
}

// 内容/名称改完只重画这一行的书签，不重建 DOM（重建会丢输入框焦点）
function paintOne(node, entry) {
    const c = node.__wm2Container;
    if (!c) return;
    const el = c.querySelector(`.wm2-bk[data-entry-id="${entry.id}"]`);
    if (!el) return;
    const info = bkState(entry);
    el.classList.toggle("saved", info.st === "saved");
    el.classList.toggle("dirty", info.st === "dirty");
    el.title = bkTip(info, "entry");
}

//==============================================================================
// 内容编辑弹窗：只编辑内容（名称在行上改），整窗可拖大小
//==============================================================================
function rememberedSize() {
    try {
        const raw = localStorage.getItem(SIZE_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (v && v.w >= 320 && v.w <= window.innerWidth - 8 && v.h >= 200 && v.h <= window.innerHeight - 8) return v;
    } catch (e) {}
    return null;
}

// 内容框的三挡字号（键就是按钮上的字，顺序 = 小 → 大）
const FS_PX = { 小: 14, 中: 17, 大: 21 };

function rememberedFs() {
    try {
        const v = localStorage.getItem(FS_KEY);
        if (v && FS_PX[v]) return v;
    } catch (e) {}
    return FS_DEF;
}

function openEditModal(node, entry, txtEl) {
    injectStyle();
    const bd = document.createElement("div");
    bd.className = "wm2-bd open";
    const m = document.createElement("div");
    m.className = "wm2-modal wm2-pedit";
    const saved = rememberedSize();
    if (saved) { m.style.width = saved.w + "px"; m.style.height = saved.h + "px"; }
    bd.append(m);
    document.body.append(bd);

    const h = document.createElement("h4");
    h.textContent = "编辑文本内容" + (entry.title ? " · " + entry.title : "");
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "✕";
    x.addEventListener("click", () => close());
    h.append(x);
    m.append(h);

    const sub = document.createElement("div");
    sub.className = "sub";
    const subTxt = document.createElement("span");
    subTxt.textContent = "名称在列表那一行改，这里只改内容；拖动弹窗右下角可以把整框拉大。";
    sub.append(subTxt);
    m.append(sub);

    const ta = document.createElement("textarea");
    ta.value = entry.content || "";
    ta.placeholder = "在此输入文本内容…";
    ta.spellcheck = false;
    m.append(ta);

    // 自动补全实例（词库异步才建好）；先声明，下面的 fsApply 要拿它设字号。
    let ac = null, closedEarly = false;

    // 字号三挡（小/中/大）：内容多的时候把字放大，选择记进 localStorage 下次沿用。
    // 自动补全的下拉跟着一起变 —— 它只有 .pill 自带 11px，其余项吃容器的字号。
    const fsBar = document.createElement("span");
    fsBar.className = "fs";
    const fsLbl = document.createElement("span");
    fsLbl.textContent = "字号";
    fsBar.append(fsLbl);
    const fsBtns = {};
    let fsCur = rememberedFs();
    const fsApply = () => {
        const px = FS_PX[fsCur] || FS_PX[FS_DEF];
        ta.style.fontSize = px + "px";
        if (ac && ac.dropdown) {
            // 下拉跟着内容框走：容器字号 + 给这个下拉打标记（提示胶囊自带 11px，
            // 只在这个标记下放开，管理器的补全样式不受影响）。
            // wm2-ac-scope 是配色作用域：这里再补一次，万一浏览器还在用缓存的旧
            // windmix_preset_ac.js（/web/*.js 按 Last-Modified 启发式缓存），浅色主题照样适配。
            ac.dropdown.style.fontSize = px + "px";
            ac.dropdown.classList.add("wm2-ac-sync", "wm2-ac-scope");
        }
        Object.keys(fsBtns).forEach((k) => fsBtns[k].classList.toggle("on", k === fsCur));
    };
    Object.keys(FS_PX).forEach((k) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = k;
        b.title = `内容框字号 ${FS_PX[k]}px`;
        b.addEventListener("click", () => {
            fsCur = k;
            fsApply();
            try { localStorage.setItem(FS_KEY, k); } catch (e) {}
        });
        fsBtns[k] = b;
        fsBar.append(b);
    });
    sub.append(fsBar);
    fsApply();

    const foot = document.createElement("div");
    foot.className = "foot";
    const tip = document.createElement("span");
    tip.className = "tip";
    const info = bkState(entry);
    tip.textContent = info.st === "saved"
        ? `这条已保存到「${info.where || "预设库"}」，改动还没覆盖回去`
        : (info.st === "dirty" ? `本地改过，点行尾书签可覆盖「${info.where}」` : "这条还没存进预设库");
    const sp = document.createElement("span");
    sp.className = "sp";
    const cancel = document.createElement("button");
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => close());
    const ok = document.createElement("button");
    ok.className = "ok";
    ok.textContent = "保存";
    ok.addEventListener("click", () => commit());
    foot.append(tip, sp, cancel, ok);
    m.append(foot);

    // 自动补全：词库就绪后挂到编辑框（↑↓ 选择、Tab/Enter 插入、Esc 关闭、点击选择）。
    // 下拉挂在 document.body 上，弹窗移除时不会触发 blur，必须手动清掉，否则残留。
    attachAutoComplete(ta, { zIndex: 100014, width: 520 }).then((a) => {
        ac = a;
        if (closedEarly && a) { detachAutoComplete(a); return; }   // 词库比弹窗慢时别把下拉留下
        if (a) fsApply();                                          // 下拉是异步才出现的，补一次字号
    });
    ta.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); commit(); }
    });

    // resize:both 是原生拖拽，没有 resize 事件；松手时把尺寸记下来
    m.addEventListener("pointerup", () => {
        try {
            localStorage.setItem(SIZE_KEY, JSON.stringify({ w: Math.round(m.offsetWidth), h: Math.round(m.offsetHeight) }));
        } catch (e) {}
    });

    let done = false;
    function close() {
        if (done) return;
        done = true;
        closedEarly = true;
        bd.remove();
        if (ac) detachAutoComplete(ac);
    }
    function commit() {
        if (done) return;
        entry.content = ta.value;
        saveData(node);
        if (txtEl) {
            txtEl.textContent = entry.content || "点这里写内容…";
            txtEl.classList.toggle("empty", !entry.content);
        }
        paintOne(node, entry);
        close();
    }
    bd.addEventListener("mousedown", (e) => { if (e.target === bd) close(); });
    bd.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
}

//==============================================================================
// 界面骨架（只建一次）：工具栏 → 列表 → 提示条 → 底栏
//==============================================================================
// 工具栏只建一次，onConfigure 灌进来的数据必须回写这几个框，
// 否则载入工作流后显示的是默认值、保存出去的却是真值（看着像没生效）。
function syncToolbar(node) {
    const d = node.__stData;
    if (!d || !node.__wm2Built) return;
    if (node.__stSepIn) node.__stSepIn.value = d.separator;
    if (node.__stNwIn) node.__stNwIn.value = String(d.nameWidth || NAME_W_DEF);
    if (node.__stRcIn) node.__stRcIn.value = String(d.randomCount || 1);
    if (node.__stRndTgl) node.__stRndTgl.classList.toggle("on", !!d.randomEnabled);
}

function buildUI(node) {
    if (node.__wm2Built) return;
    node.__wm2Built = true;
    injectStyle();
    if (!(window.__wmPresetNodes instanceof Set)) window.__wmPresetNodes = new Set();
    window.__wmPresetNodes.add(node);

    const data = node.__stData;
    const c = document.createElement("div");
    c.className = "wm2-container";
    node.__wm2Container = c;
    // 画布上的 pointerdown 会顺手改选中并重绘，输入/滚动时先止住
    c.addEventListener("pointerdown", (e) => e.stopPropagation());
    c.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    c.addEventListener("keydown", (e) => e.stopPropagation());

    // 1) 工具栏
    const bar = document.createElement("div");
    bar.className = "wm2-tbar";
    const folderBtn = document.createElement("button");
    folderBtn.type = "button";
    folderBtn.className = "fbtn";
    folderBtn.innerHTML = IC.folderPlus;
    folderBtn.title = "在节点内新建文件夹";
    folderBtn.addEventListener("click", () => {
        if (data.items.length >= MAX_ROWS) { warn(node, `最多 ${MAX_ROWS} 项（文本行 + 文件夹）`, true); return; }
        data.items.push({ kind: "folder", id: genFolderId(), name: "新建文件夹",
                          enabled: true, collapsed: false, entries: [] });
        saveData(node);
        renderList(node, false);
    });
    bar.append(folderBtn);

    // 2) 分隔符 / 名称宽：框里只放内容本身，不写「分隔符」「名称宽」几个字，
    //    叫什么靠鼠标悬浮的 title 说明。
    const sepFld = document.createElement("span");
    sepFld.className = "fld sep";
    const sepIn = document.createElement("input");
    sepIn.type = "text";
    sepIn.value = data.separator;
    sepIn.spellcheck = false;
    sepIn.placeholder = "分隔符";
    sepIn.title = "分隔符（\\n 表示换行）";
    sepIn.addEventListener("input", () => {
        data.separator = sepIn.value;
        saveData(node);
    });
    sepFld.append(sepIn);
    node.__stSepIn = sepIn;

    const nwFld = document.createElement("span");
    nwFld.className = "fld nw";
    const nwIn = document.createElement("input");
    nwIn.type = "number";
    nwIn.min = "20";
    nwIn.max = "400";
    nwIn.value = String(data.nameWidth || NAME_W_DEF);
    nwIn.placeholder = "名称宽";
    nwIn.title = "名称框宽度(px)，改一次所有名称框一起变";
    nwIn.addEventListener("input", () => {
        let v = parseInt(nwIn.value, 10);
        if (isNaN(v)) v = NAME_W_DEF;
        v = Math.max(20, Math.min(400, v));
        data.nameWidth = v;
        c.querySelectorAll(".wm2-nmi").forEach((el) => { el.style.flexBasis = v + "px"; });
        saveData(node);
    });
    nwFld.append(nwIn);
    node.__stNwIn = nwIn;
    bar.append(sepFld, nwFld);

    bar.append(Object.assign(document.createElement("span"), { className: "gap" }));

    // 3) 随机选择：方框和整条都能点，统一走 setRnd —— 它是唯一会写回勾选状态的地方，
    //    否则「点了但 √ 不上」（列表重绘不碰工具栏）。
    const chk = document.createElement("span");
    chk.className = "chk";
    const rndTgl = makeToggle(!!data.randomEnabled, () => setRnd(!data.randomEnabled),
        "随机从启用的文本里抽几条输出", () => data.randomEnabled);
    node.__stRndTgl = rndTgl;
    const chkTxt = document.createElement("span");
    chkTxt.textContent = "随机选择";
    chk.append(rndTgl, chkTxt);
    chk.addEventListener("click", (e) => {
        if (e.target === rndTgl) return;      // 方框自己已经处理过了
        setRnd(!data.randomEnabled);
    });
    function setRnd(v) {
        data.randomEnabled = !!v;
        rndTgl.classList.toggle("on", !!v);
        saveData(node);
        renderList(node, true);
    }
    bar.append(chk);

    const rc = document.createElement("span");
    rc.className = "fld rc";
    const rcK = document.createElement("span");
    rcK.className = "k";
    rcK.textContent = "数量";
    const rcIn = document.createElement("input");
    rcIn.type = "number";
    rcIn.min = "1";
    rcIn.value = String(data.randomCount || 1);
    rcIn.title = "随机选择时抽几条";
    rcIn.addEventListener("input", () => {
        const v = parseInt(rcIn.value, 10);
        data.randomCount = isNaN(v) ? 1 : Math.max(1, v);
        saveData(node);
    });
    rc.append(rcK, rcIn);
    node.__stRcIn = rcIn;
    bar.append(rc);
    c.append(bar);

    // 4) 列表：固定高度 + 内部滚动（节点高度与条目数解耦的关键）
    const list = document.createElement("div");
    list.className = "wm2-list";
    node.__stList = list;
    c.append(list);
    list.addEventListener("dragover", (e) => {
        if (!_drag) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const a = topAnchor(list, e.clientY);
        clearMarks(node);
        const el = a.key ? list.querySelector(`[data-key="${a.key}"]`) : null;
        if (el) el.classList.add(a.after ? "over-bot" : "over-top");
    });
    list.addEventListener("drop", (e) => {
        if (!_drag) return;
        e.preventDefault();
        const a = topAnchor(list, e.clientY);
        const d = _drag; _drag = null;
        moveTopLevel(node, d, a.key, a.after);
        clearMarks(node);
    });

    // 4) 提示条（保存结果 / 上限拦截都走这里，和 LoRA 同一个位置）
    const w = document.createElement("div");
    w.className = "wm2-warn";
    node.__wm2Warn = w;
    c.append(w);

    // 5) 底栏：预设文本（开管理器） / ＋ 新增文本框，位置与职能跟旧版一致
    const addrow = document.createElement("div");
    addrow.className = "wm2-addrow";
    const mgrBtn = document.createElement("button");
    mgrBtn.type = "button";
    mgrBtn.className = "wm2-addbtn";
    mgrBtn.textContent = "预设文本";
    mgrBtn.title = "打开预设文本管理器（可单选 / 多选 / 整个目录发送到这个节点）";
    mgrBtn.addEventListener("click", () => {
        if (window.WindMixPresetManager && window.WindMixPresetManager.open) {
            window.WindMixPresetManager.open(node);
        } else {
            warn(node, "预设管理器没加载", true);
        }
    });
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "wm2-addbtn wm2-solid";
    addBtn.textContent = "＋ 新增文本框";
    addBtn.addEventListener("click", () => {
        if (data.items.length >= MAX_ROWS) { warn(node, `最多 ${MAX_ROWS} 项（文本行 + 文件夹）`, true); return; }
        data.items.push(defaultEntry());
        saveData(node);
        renderList(node, false);
        const rows = list.querySelectorAll(".wm2-nmi");
        if (rows.length) rows[rows.length - 1].focus();
    });
    addrow.append(mgrBtn, addBtn);
    c.append(addrow);

    const domWidget = node.addDOMWidget("wm_st_rows", "div", c, { serialize: false, hideOnZoom: false });
    // 上报常量高度（节点高度不随条目数变化），并记下可用宽度用于反解内边距
    domWidget.computeSize = (width) => {
        node.__wm2WidgetW = width;
        return [width, UI_H];
    };
    if (domWidget.element && domWidget.element.style) domWidget.element.style.overflow = "visible";
    node.__wm2DomWidget = domWidget;

    renderList(node, false);
    ensureNodeFits(node);
    syncToolbar(node);
    fetchLib(false).then(() => paintBookmarks(node));
}

// 按「真正参与拼接的行数」统计：文件夹只是组织方式，里面每一条各算一行；
// 文件夹整体关掉时，它里面的行一条都不算生效。
function enableStats(items) {
    let total = 0, on = 0;
    (items || []).forEach((it) => {
        if (it.kind === "folder") {
            const es = it.entries || [];
            total += es.length;
            if (it.enabled !== false) es.forEach((e) => { if (e.enabled) on += 1; });
        } else {
            total += 1;
            if (it.enabled) on += 1;
        }
    });
    return { total, on };
}

// 表头那个计数：勾掉整个文件夹不会重绘列表，数字得自己跟着回写一次
function paintCount(node) {
    const c = node.__wm2Container;
    const el = c && c.querySelector(".wm2-lhead .act");
    if (!el) return;
    const s = enableStats(node.__stData && node.__stData.items);
    el.textContent = `${s.on}/${s.total}`;
}

function renderList(node, keepScroll) {
    const list = node.__stList;
    if (!list) return;
    // 兜底：__stData 万一丢了（热重载 / 初次回调顺序），从隐藏控件重新读，避免渲染成空白
    if (!node.__stData || typeof node.__stData !== "object") node.__stData = loadData(node);
    const data = node.__stData;
    const items = data.items || [];
    const top = keepScroll ? list.scrollTop : 0;
    list.innerHTML = "";

    const s = enableStats(items);
    const total = s.total, on = s.on;

    const head = document.createElement("div");
    head.className = "wm2-lhead";
    head.style.cursor = "default";      // 名称宽在工具栏改，表头不参与横向拖动
    const allOn = total > 0 && on === total;
    const tallob = document.createElement("span");
    tallob.className = "tallob";
    tallob.append(makeToggle(allOn, () => {
        const turnOn = !allOn;
        items.forEach((it) => {
            it.enabled = turnOn;
            if (it.kind === "folder") (it.entries || []).forEach((e) => { e.enabled = turnOn; });
        });
        saveData(node);
        renderList(node, true);
    }, allOn ? "全部停用" : "全部启用"));
    const tl = document.createElement("span");
    tl.textContent = "Toggle All";
    tallob.append(tl);
    tallob.addEventListener("click", (e) => e.stopPropagation());
    head.append(tallob);

    const cnt = document.createElement("span");
    cnt.className = "act";
    cnt.textContent = `${on}/${total}`;
    cnt.title = "生效行数 / 总行数（文件夹关闭时它里面的行不计入生效）";
    head.append(cnt);

    const sl = document.createElement("span");
    sl.className = "slabel";
    const slT = document.createElement("span");
    slT.textContent = "文本";
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "点内容编辑 · 拖手柄排序";
    sl.append(slT, hint);
    head.append(sl);
    list.append(head);

    if (!total) {
        const e = document.createElement("div");
        e.className = "wm2-empty";
        e.innerHTML = `还没有文本<br>点下方<b>＋ 新增文本框</b>，或按<b>预设文本</b>从库里发送过来`;
        list.append(e);
    }
    items.forEach((it) => {
        list.append(it.kind === "folder" ? folderCard(node, it) : entryRow(node, it, null));
    });

    if (keepScroll) list.scrollTop = top;
    paintBookmarks(node);
}

//==============================================================================
// 隐藏存储控件 + 连接守卫
//==============================================================================
// 拒绝任何连线接入隐藏的 preset_text_data 内部存储口（它是节点自身 JSON 记忆，
// 不是给外部接的；接错会覆盖整份文本行导致节点空掉）。一旦检测到连接即断链。
function _wmRejectPresetDataLink(node, appInst, slot, linkId, linkInfo) {
    let id = linkId;
    if ((id == null || id === undefined) && linkInfo && typeof linkInfo === "object" && linkInfo.id != null) {
        id = linkInfo.id;
    }
    if (appInst && appInst.graph && id != null && id !== undefined && appInst.graph.links && appInst.graph.links[id]) {
        const link = appInst.graph.links[id];
        const origin = appInst.graph.getNodeById(link.origin_id);
        if (origin && link.origin_slot != null && origin.outputs && origin.outputs[link.origin_slot]) {
            const arr = origin.outputs[link.origin_slot].links;
            if (Array.isArray(arr)) {
                const i = arr.indexOf(id);
                if (i >= 0) arr.splice(i, 1);
            }
        }
        delete appInst.graph.links[id];
    }
    // 清掉 widget 上的 link 引用
    if (node.widgets) {
        const w = node.widgets.find((x) => x.name === DATA_WIDGET);
        if (w) w.link = null;
    }
    // 断开该 input（若存在）
    try { if (slot != null && node.disconnectInput) node.disconnectInput(slot); } catch (e) { /* 可能已不存在 */ }
}

// 彻底隐藏 preset_text_data 存储 widget（输入框 + nodes2.0 自动生成的连接点）。
// 双渲染器兼容（同 widgethider.js 手法）：
// - Nodes 1.0（litegraph）：hidden=true + type="hidden" + computeSize 归零；
// - Nodes 2.0（Vue）：只认响应式 state 的 options.hidden；_state 晚到则轮询补写
//   并替换整个 options 引用强制重渲。type="hidden" 仅在老前端（无 _state）使用——
//   现代前端设 type="hidden" 会让 Vue 回退成 WidgetLegacy 照样画出且反复重挂载。
// widget 对象本身保留，value 照常序列化进 prompt、传给 execute。
function _wmHidePresetDataWidget(node) {
    const w = node.widgets && node.widgets.find((x) => x.name === DATA_WIDGET);
    if (!w) return;
    w.hidden = true;

    const applyState = () => {
        if (w._state && w._state.options) {
            w._state.options.hidden = true;
            try { w._state.options = { ...w._state.options, hidden: true }; } catch (e) {}
            if (w._origType) { w.type = w._origType; delete w._origType; }
        }
    };
    if (w._state) {
        applyState();
    } else {
        if (!w._origType) w._origType = w.type;
        w.type = "hidden";
        w.computeSize = function () { return [0, 0]; };
        if (w.options && !w._wmStateRetry) {
            w._wmStateRetry = true;
            w.options.hidden = true;
            let tries = 0;
            const tick = () => {
                if (w._state) { applyState(); w._wmStateRetry = false; return; }
                if (tries++ < 120) requestAnimationFrame(tick);
                else w._wmStateRetry = false;
            };
            requestAnimationFrame(tick);
        }
    }

    if (w.inputEl) {
        w.inputEl.style.display = "none";
        w.inputEl.disabled = true;
        let _el = w.inputEl;
        while (_el && _el !== node.element) {
            if (_el.classList && _el.classList.contains("comfy-widget")) {
                _el.style.display = "none";
                break;
            }
            _el = _el.parentElement;
        }
    }
    try { if (app && app.graph) app.graph.setDirtyCanvas(true, true); } catch (e) {}
}

//==============================================================================
// 新建节点的底距收敛
//   界面建好时锁过一次底，可「刚加进来」这一刻之后还会发生两件事：
//     · 隐藏 preset_text_data 控件（Vue 的 _state 要晚一拍才有），节点需要总高跟着变；
//     · LiteGraph 给新节点定尺寸走 node.setSize(node.computeSize())，这条路不派发
//       onResize，锁底一次都不会被叫醒 —— 表现就是「预设文本 / ＋新增文本框」离框底一大截。
//   另外共用件的自校正靠 rAF+60ms，新节点的 DOM 那会儿还没挂上文档（rect 全是 0），
//   量不到就直接return、不再补，于是推断值永远留在那儿。这里用纯 setTimeout 连补几拍，
//   每拍实测一次：离底太远先缩节点（多出来的是节点本身的高度，别把列表拉长），
//   容器偏矮才交给 lockBottomBar 补高，直到实测底距 = 侧距。
//==============================================================================
const SETTLE_MS = 130;
const SETTLE_CAP = 9;

function settleFit(node, cap) {
    if (!node.__wm2Built || !node.__wm2Container) return;
    if (node.__wm2InTick) return;                     // 自己这一拍里缩的高度，不算新变化
    if ((node.__wm2SettleLeft || 0) <= 0) node.__wm2SettleLeft = cap || SETTLE_CAP;  // 只在停顿时重新上弦
    if (node.__wm2SettleQueued) return;
    node.__wm2SettleQueued = true;
    setTimeout(() => { node.__wm2SettleQueued = false; settleTick(node); }, 25);
}

function settleTick(node) {
    if (!node.__wm2Container || !node.__wm2Container.isConnected || node.__wm2SettleLeft <= 0) {
        node.__wm2SettleLeft = 0; return;
    }
    node.__wm2SettleLeft -= 1;
    let done = false;
    node.__wm2InTick = true;
    try {
        const g = bottomGapState(node);
        if (!g) { node.__wm2Chrome = measureChrome(node); }          // 还没布局：先按推断锁，下拍再实测
        else if (Math.abs(g.actual - g.inset) <= 1.5) { node.__wm2Fresh = false; done = true; }
        else {
            // 节点比界面需要的更高 → 那一截全落在按钮条下面。缩回「界面自然高 + 标题栏」这个
            // 标准值（就是 ensureNodeFits 的下限），别把列表拉长，这样新建的节点和载入工作流
            // 的节点、和 LoRA 卡片是一样高的。只在还没被用户手动拉过（__wm2Fresh）时这么干。
            const canonical = UI_H + (node.__wm2Chrome || measureChrome(node));
            if (node.__wm2Fresh && canonical < node.size[1] && node.size[1] - canonical <= 400
                && typeof node.setSize === "function") {
                node.setSize([node.size[0], canonical]);
            } else {
                node.__wm2Chrome = measureChrome(node);
                lockBottomBar(node);
            }
        }
    } catch (e) { /* 量不到就等下一拍 */ }
    node.__wm2InTick = false;
    if (!done && node.__wm2SettleLeft > 0) {
        node.__wm2SettleQueued = true;
        setTimeout(() => { node.__wm2SettleQueued = false; settleTick(node); }, SETTLE_MS);
    }
}

// 任何来源的尺寸变化（包括不派发 onResize 的那几条）都接回来重锁一次底
function watchNodeSize(node) {
    if (node.__wm2SizeWatched) return;
    node.__wm2SizeWatched = true;
    node.__wm2LastH = Math.round(node.size && node.size[1] || 0);
    const orig = typeof node.setSize === "function" ? node.setSize : null;
    node.setSize = function (size) {
        const r = orig ? orig.apply(this, arguments) : undefined;
        const h = Math.round(this.size && this.size[1] || 0);
        if (h !== this.__wm2LastH) { this.__wm2LastH = h; settleFit(this, SETTLE_CAP); }
        return r;
    };
}

//==============================================================================
// 对预设管理器开放的「发送」接口
//   管理器里单选、多选、整个目录三种发送都走这里；把库里的 id 一起带进来绑上，
//   发过来的行一开始就是紫书签，之后本地改内容就变橙点。
//==============================================================================
function attachSendApi(node) {
    node.addPresetTextEntry = function (title, content, presetId) {
        if (!node.__stData) node.__stData = loadData(node);
        if (node.__stData.items.length >= MAX_ROWS) {
            warn(node, `节点最多 ${MAX_ROWS} 项，这条「${title || "未命名"}」没进来`, true);
            return false;
        }
        const e = { kind: "entry", ...defaultEntry(), title: title || "", content: content || "" };
        if (presetId) bindEntry(e, presetId);
        node.__stData.items.push(e);
        saveData(node);
        if (node.__wm2Built) renderList(node, false);
        return true;
    };
    node.addPresetTextFolder = function (folderName, entries) {
        if (!node.__stData) node.__stData = loadData(node);
        if (node.__stData.items.length >= MAX_ROWS) {
            warn(node, `节点最多 ${MAX_ROWS} 项，目录「${folderName || "来自预设的文件夹"}」没进来`, true);
            return false;
        }
        const list = (entries || []).slice(0, MAX_ROWS);
        node.__stData.items.push({
            kind: "folder", id: genFolderId(),
            name: folderName || "来自预设的文件夹", enabled: true, collapsed: false,
            entries: list.map((x) => {
                const src = x || {};
                const e = normEntry({
                    id: genId(), enabled: src.enabled !== false,
                    title: src.title || src.name || "", content: src.content || "",
                });
                const pid = src.presetId || "";
                if (pid) bindEntry(e, pid);
                return e;
            }),
        });
        saveData(node);
        if (node.__wm2Built) renderList(node, false);
        return true;
    };
    node.refreshPresetText = function () {
        applyData(node, loadData(node));
        if (node.__wm2Built) { renderList(node, true); syncToolbar(node); }
    };
}

//==============================================================================
// 扩展注册
//==============================================================================
function patchNodeType(nodeType) {
    const origCreate = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        const r = origCreate ? origCreate.apply(this, arguments) : undefined;
        const node = this;
        node.__stData = loadData(node);
        ensureSeed(node);

        // 数据控件必须在这里就归零高度：它晚一拍才藏的话，chrome 量出来偏大，节点会被
        // 撑高那一截，而多出来的空间正好全压在按钮条下面（新建节点底距不锁的根因）。
        // nodes2.0 / 延迟渲染下 widget 的 _state 还在下一拍，所以原来的两档兜底留着。
        try { _wmHidePresetDataWidget(node); } catch (e) {}
        setTimeout(() => _wmHidePresetDataWidget(node), 0);
        setTimeout(() => _wmHidePresetDataWidget(node), 200);

        // nodes2.0 走 onConnectInput 拦截连接，旧版走 onConnectionsChange（下面 patch）
        const origConnectInput = node.onConnectInput;
        node.onConnectInput = function (inputIndex) {
            const inp = this.inputs && this.inputs[inputIndex];
            if (inp && inp.widget && inp.widget.name === DATA_WIDGET) return false;
            if (origConnectInput) return origConnectInput.apply(this, arguments);
            return true;
        };

        if (!node.size || (node.size[0] || 0) < MIN_W) {
            node.size = [Math.max(MIN_W, node.size ? node.size[0] : MIN_W),
                         Math.max(UI_H, node.size ? node.size[1] : UI_H)];
        }
        try { buildUI(node); } catch (e) { console.warn("[WindMix] preset ui onNodeCreated failed", e); }
        // 建完之后前端还会给新节点定尺寸（不派发 onResize），所以这里挂上尺寸监听并补收敛
        node.__wm2Fresh = true;
        watchNodeSize(node);
        settleFit(node, SETTLE_CAP);
        attachSendApi(node);
        saveData(node);
        return r;
    };

    const origConf = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (config) {
        const r = origConf ? origConf.apply(this, arguments) : undefined;
        const node = this;
        if (config && config.preset_text_data) {
            try { applyData(node, normalizeData(JSON.parse(config.preset_text_data))); }
            catch (e) { applyData(node, loadData(node)); ensureSeed(node); }
        } else {
            applyData(node, loadData(node));
            ensureSeed(node);
        }
        try {
            buildUI(node);
            renderList(node, false);
            ensureNodeFits(node);      // workflow 里存的尺寸可能比界面需要的矮
            watchNodeSize(node);       // 载入的节点也可能被前端再 setSize 一次
            syncToolbar(node);         // 灌进来的分隔符/名称宽/随机要显示出来
            fetchLib(false).then(() => paintBookmarks(node));
        } catch (e) { console.warn("[WindMix] preset ui onConfigure failed", e); }
        return r;
    };

    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
        const r = origResize ? origResize.apply(this, arguments) : undefined;
        // 手动拉过节点了，之后就不再把高度缩回标准值（底距还是照锁）
        try { if (this.__wm2Built) { this.__wm2Fresh = false; watchNodeSize(this); lockBottomBar(this); } } catch (e) {}
        return r;
    };

    // 守卫：preset_text_data 只由前端 DOM 维护，任何外部连线一律立刻断掉
    const origConn = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, slot, connect, linkInfo, nodeIn) {
        const INPUT = (typeof LiteGraph !== "undefined" && LiteGraph.INPUT) ? LiteGraph.INPUT : 1;
        const rr = origConn ? origConn.apply(this, arguments) : undefined;
        if (type === INPUT && connect) {
            let reject = false, wlink = null;
            const inp = this.inputs && this.inputs[slot];
            if (inp && inp.widget && inp.widget.name === DATA_WIDGET) {
                reject = true; wlink = inp.link;
            } else if (this.widgets) {
                const w = this.widgets.find((x) => x.name === DATA_WIDGET);
                if (w && w.link != null) { reject = true; wlink = w.link; }
            }
            if (reject) _wmRejectPresetDataLink(this, app, slot, wlink, linkInfo);
        }
        return rr;
    };
}

app.registerExtension({
    name: "WindMix.PresetText",
    async init() {},
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const typeKey = nodeData.name || (nodeType && nodeType.comfyClass);
        if (typeKey !== NODE_TYPE) return;
        patchNodeType(nodeType);
    },
    setup() {
        injectStyle();
    },
});
