// ComfyUI-WindMix — ⚡ 预设文本 节点前端（v2：支持节点内文件夹）
// 顶部单行工具栏：文件夹图标(新建节点内文件夹) + 分隔符 + 随机选择 + 数量
// 主体：根目录文本行 + 多个文件夹块（每个含「保存到预设」「删除文件夹」图标），
//       文本行可在根目录与文件夹之间、文件夹与文件夹之间拖拽移动/排序。
// 底部固定显示：预设文本 / ＋ 新增文本框。
// 内容框为内联输入框（无弹窗）。数据走隐藏控件 preset_text_data(JSON)。
import { app } from "../../scripts/app.js";
// 自动补全：复用 prompt_studio 自带的 TextAreaAutoComplete 引擎；
// 词库加载 + 挂载封装在 windmix_preset_ac.js（预设文本节点与预设管理器共用同一份缓存）
import { attachAutoComplete } from "./js/prompt_studio/windmix_preset_ac.js";

const NODE_TYPE = "WindMixPresetText";

// 最小尺寸限制：防止节点被缩得过小或空状态出现白色框
const MIN_W = 420;
const MIN_H = 140;
const ROW_H = 46; // 单行估算高度（含间距）
// 空状态真实高度估值：toolbar(40) + 根区提示(30) + footer(47) + 容器内边距(15) + 3 个 9px 间距 = ~160
const EMPTY_H = 180;
// 每增加一行约增加的高度（zone padding 12 + row min-height 34 ≈ 46，留余量取 50）
const ROW_ADD = 50;
// 每个文件夹额外占用的"头部+边距"基线：folder padding-top 16 + head 37 + head->zone margin 6 + zone padding-top 12 = ~71
const FOLDER_BASE = 75;
// ComfyUI 节点 chrome（标题栏 + 边距），LiteGraph 的 setSize 直接覆盖节点总高度，
// 所以 setSize 必须在 widget 内容高度之上再加 chrome，否则底栏按钮永远被裁掉。
// 实测标题栏 ~30-34px + 间距，留余量取 36px。
const CHROME_H = 36;

let _wmStStyleInjected = false;
function injectStyle() {
    if (_wmStStyleInjected) return;
    _wmStStyleInjected = true;
    const s = document.createElement("style");
    s.textContent = `
/* ---- 主题色令牌 ----
   ComfyUI 两套主题（:root 浅色 / html.dark-theme 深色）里，
   --comfy-input-bg(#222) 与 --comfy-menu-bg(#353535) 都是深色、不随主题翻转，
   而 --fg-color 会翻（浅 #000 / 深 #fff）——两者混用必然出现「浅色主题下黑底黑字」。
   上一版改取 --content-bg / --bg-color 跟随主题，但深色主题下 --content-bg 是 #4e4e4e 中灰，
   面板/文本行/弹窗比原来的深灰明显发亮，观感突兀。
   现改为「两套主题各给一组调好的固定值」：深色回到 #2a2a2a / #1e1e1e 档（≈ 改动前），
   浅色用浅灰 / 白。不再依赖 ComfyUI 变量，避免变量语义变化时配色跑偏。
   深色主题类挂在 <html> 上：html.dark-theme。 */
.wm-st-container, .wm-st-modal {
  --wm-st-panel: #f2f2f3;      /* 面板、文本行、弹窗底 */
  --wm-st-panel-fg: #1f1f21;
  --wm-st-field: #ffffff;      /* 输入框、图标按钮 */
  --wm-st-field-fg: #1f1f21;
  --wm-st-accent: #534AB7;
  --wm-st-danger: #c0392b;
}
html.dark-theme .wm-st-container, html.dark-theme .wm-st-modal {
  --wm-st-panel: #2a2a2a;
  --wm-st-panel-fg: #e6e6e6;
  --wm-st-field: #1e1e1e;
  --wm-st-field-fg: #ececec;
  --wm-st-accent: #9b8af5;
  --wm-st-danger: #e57373;
}

.wm-st-container { display:flex; flex-direction:column; gap:4px; padding:5px; min-width:320px; }
.wm-st-toolbar { display:flex; align-items:center; gap:9px; padding:4px 0; flex-wrap:wrap; }
.wm-st-icon-btn { width:27px; height:27px; flex:none; display:flex; align-items:center; justify-content:center;
  border:1px solid var(--border-color,#444); border-radius:7px; background:var(--wm-st-field);
  cursor:pointer; color:var(--wm-st-field-fg); }
.wm-st-icon-btn:hover { border-color:var(--comfy-primary,#534AB7); color:var(--wm-st-accent); }
.wm-st-icon-btn svg { width:15px; height:15px; }
.wm-st-toolbar input.wm-st-sep { flex:none; width:80px; min-width:80px; box-sizing:border-box; background:var(--wm-st-field); border:1px solid var(--border-color,#444);
  border-radius:7px; padding:7px 10px; color:var(--wm-st-field-fg); font-size:13px; }
.wm-st-toolbar input.wm-st-namew { flex:none; width:80px; min-width:80px; box-sizing:border-box; background:var(--wm-st-field); border:1px solid var(--border-color,#444);
  border-radius:7px; padding:7px 10px; color:var(--wm-st-field-fg); font-size:13px; }
.wm-st-opt { display:flex; align-items:center; gap:7px; color:var(--wm-st-panel-fg); font-size:13px; opacity:0.92; }
.wm-st-opt input[type=checkbox] { width:16px; height:16px; accent-color:var(--comfy-primary,#534AB7); cursor:pointer; }
.wm-st-rc { width:50px; background:var(--wm-st-field); border:1px solid var(--border-color,#444);
  border-radius:6px; padding:6px 7px; color:var(--wm-st-field-fg); font-size:13px; }

.wm-st-zone { display:flex; flex-direction:column; gap:5px; padding:5px; border-radius:8px;
  border:1px dashed transparent; min-height:6px; margin-bottom:0; }
.wm-st-zone.drag-over { border-color:var(--comfy-primary,#534AB7); background:rgba(83,74,183,.08); }
.wm-st-folder .wm-st-zone { padding-left:14px; padding-right:0; }
.wm-st-zone-hint { color:var(--wm-st-panel-fg); opacity:0.55; font-size:12px; padding:4px 3px; }
.wm-st-row.top-before, .wm-st-folder.top-before { box-shadow: inset 0 3px 0 0 var(--comfy-primary,#534AB7); position:relative; }

.wm-st-row { display:flex; align-items:center; gap:7px; padding:5px 7px; background:var(--wm-st-panel);
  border:1px solid var(--border-color,#3a3a3a); border-radius:8px; min-height:34px; flex-shrink:0; }
.wm-st-row.drag-over { border-color:var(--comfy-primary,#534AB7); }
.wm-st-on { width:16px; height:16px; flex:none; cursor:pointer; accent-color:var(--comfy-primary,#534AB7); }
.wm-st-handle { flex:none; cursor:grab; color:var(--wm-st-panel-fg); display:inline-flex; align-items:center; }
.wm-st-handle:active { cursor:grabbing; }
.wm-st-name { flex:0 0 80px; min-width:0; height:32px; box-sizing:border-box; background:var(--wm-st-field); border:1px solid var(--border-color,#444);
  border-radius:6px; padding:6px 8px; color:var(--wm-st-field-fg); font-size:14px; }
.wm-st-content { flex:1; min-width:0; height:32px; box-sizing:border-box; background:var(--wm-st-field); border:1px solid var(--border-color,#444);
  border-radius:6px; padding:0 8px; color:var(--wm-st-field-fg); font-size:14px; line-height:30px;
  cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:block; }
.wm-st-content.empty { color:var(--wm-st-field-fg); opacity:0.45; }
.wm-st-content:hover { border-color:var(--comfy-primary,#534AB7); }

.wm-st-modal-bd { position:fixed; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:99999; }
.wm-st-modal { width:756px; max-width:92vw; background:var(--wm-st-panel); color:var(--wm-st-panel-fg);
  border:1px solid var(--border-color,#444); border-radius:12px; padding:21px; box-shadow:0 14px 50px rgba(0,0,0,.55); }
.wm-st-modal h4 { margin:0 0 12px; font-size:18px; font-weight:600; }
.wm-st-modal textarea { width:100%; height:306px; resize:vertical; background:var(--wm-st-field);
  border:1px solid var(--border-color,#444); border-radius:8px; color:var(--wm-st-field-fg); font-size:20px;
  padding:12px; box-sizing:border-box; font-family:inherit; line-height:1.55; }
.wm-st-modal-actions { display:flex; gap:12px; justify-content:flex-end; margin-top:15px; }
.wm-st-modal-actions button { padding:9px 27px; border-radius:8px; cursor:pointer; font-size:16px; border:1px solid var(--border-color,#444); }
.wm-st-modal-actions .ok { background:var(--comfy-primary,#534AB7); color:#fff; border-color:var(--comfy-primary,#534AB7); }
.wm-st-modal-actions .ok:hover { background:#3c3489; }
.wm-st-modal-actions .cancel { background:transparent; color:var(--wm-st-panel-fg); }
.wm-st-modal-actions .cancel:hover { border-color:var(--wm-st-panel-fg); }
.wm-st-name:focus, .wm-st-content:focus, .wm-st-toolbar input.wm-st-sep:focus, .wm-st-fname:focus {
  outline:none; border-color:var(--comfy-primary,#534AB7); }
.wm-st-del { flex:none; width:24px; height:24px; display:flex; align-items:center; justify-content:center;
  border:1px solid var(--border-color,#444); border-radius:6px; background:var(--wm-st-field);
  color:var(--wm-st-danger); cursor:pointer; font-size:14px; }
.wm-st-del:hover { background:rgba(229,115,115,0.12); border-color:var(--wm-st-danger); }

.wm-st-folder { border:1px solid transparent; border-left:3px solid var(--comfy-primary,#534AB7); border-radius:8px; padding:5px 7px; margin:2px 0;
  background:transparent; }
.wm-st-folder.collapsed .wm-st-zone { display:none; }
/* 空文件夹（无子内容）展开时也不显示空 zone，使其高度与折叠态一致 */
.wm-st-folder-empty:not(.collapsed) .wm-st-zone { display:none; }
.wm-st-folder.drag-over { border-color:var(--comfy-primary,#534AB7); background:rgba(83,74,183,.08); }
.wm-st-folder-off { opacity:0.45; border-left-color:var(--border-color,#555); background:transparent; }
.wm-st-folder-on { width:16px; height:16px; flex:none; cursor:pointer; accent-color:var(--comfy-primary,#534AB7); margin-right:2px; }
.wm-st-folder-head { display:flex; align-items:center; gap:7px; padding:2px 2px 4px; margin-bottom:0; }
.wm-st-collapse { flex:none; width:20px; height:20px; display:flex; align-items:center; justify-content:center;
  cursor:pointer; color:var(--wm-st-field-fg); border-radius:5px; background:var(--wm-st-field); border:1px solid var(--border-color,#444); }
.wm-st-collapse:hover { background:rgba(83,74,183,.14); border-color:var(--comfy-primary,#534AB7); color:var(--wm-st-accent); }
.wm-st-collapse svg { width:12px; height:12px; transition:transform .15s ease; }
.wm-st-folder.collapsed .wm-st-collapse svg { transform:rotate(-90deg); }
.wm-st-folder-head .wm-st-ficon { color:var(--wm-st-accent); display:inline-flex; }
.wm-st-folder-head .wm-st-handle { margin-left:2px; }
.wm-st-fname { flex:1; min-width:0; background:var(--wm-st-field); border:1px solid var(--border-color,#444);
  border-radius:6px; padding:6px 8px; color:var(--wm-st-field-fg); font-size:14px; box-sizing:border-box; }
.wm-st-fbtn { flex:none; width:22px; height:22px; display:flex; align-items:center; justify-content:center;
  border:1px solid var(--border-color,#444); border-radius:6px; background:var(--wm-st-field);
  cursor:pointer; color:var(--wm-st-field-fg); }
.wm-st-fbtn svg { width:13px; height:13px; }
.wm-st-fbtn.save { color:var(--wm-st-accent); border-color:var(--comfy-primary,#534AB7); }
.wm-st-fbtn.save:hover { background:rgba(83,74,183,.14); }
.wm-st-fbtn.del:hover { color:var(--wm-st-danger); border-color:var(--wm-st-danger); }

/* margin-top:auto：底栏按钮始终贴容器底部（=节点下边框固定距离）。
   节点/容器比内容高时，多余空间自动出现在「最后一行内容」与「底栏按钮」之间。 */
.wm-st-footer { display:flex; gap:8px; padding-top:8px; margin-top:auto; }
.wm-st-btn { flex:1; padding:10px 0; border-radius:7px; cursor:pointer; font-size:13px; font-weight:500;
  transition:background .15s ease, border-color .15s ease; border:1px solid var(--comfy-primary,#534AB7); }
.wm-st-btn-outline { background:var(--wm-st-field); color:var(--wm-st-accent); }
.wm-st-btn-outline:hover { background:rgba(83,74,183,0.12); }
.wm-st-btn-solid { background:var(--comfy-primary,#534AB7); color:#fff; }
.wm-st-btn-solid:hover { background:#3c3489; }
`;
    document.head.appendChild(s);
}

function genId() {
    return "e_" + Math.random().toString(36).slice(2, 9);
}
function genFolderId() {
    return "f_" + Math.random().toString(36).slice(2, 9);
}

function defaultEntry() {
    return { id: genId(), enabled: true, title: "", content: "" };
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
    };
}

// 顶层结构归一为有序 items 序列（entry / folder 可交错），
// 兼容旧结构（rootEntries + folders）→ 转换为 items（rootEntries 在前、folders 在后）。
function normItem(it) {
    if (!it || typeof it !== "object") return { kind: "entry", id: genId(), enabled: true, title: "", content: "" };
    if (it.kind === "folder") {
        return {
            kind: "folder",
            id: (it.id) || genFolderId(),
            name: (it.name) || "新建文件夹",
            // 文件夹整体启用开关（默认 true）；后端会跳过 enabled=false 的整个文件夹
            enabled: it.enabled === false ? false : true,
            // 折叠状态（默认展开）；持久化到 data，刷新/重载后保持
            collapsed: !!(it.collapsed),
            entries: Array.isArray(it.entries) ? it.entries.map(normEntry) : [],
        };
    }
    return { kind: "entry", id: (it.id) || genId(), enabled: !!(it.enabled), title: (it.title) || "", content: (it.content) || "" };
}

// 把任意解析后的对象归一化为标准结构（兼容旧 entries / rootEntries+folders）
function normalizeData(data) {
    if (!data || typeof data !== "object") data = {};
    const out = {};
    let items;
    if (Array.isArray(data.items)) {
        items = data.items.map(normItem);
    } else {
        // 旧结构：rootEntries 在前、folders 在后
        const root = Array.isArray(data.rootEntries)
            ? data.rootEntries
            : (Array.isArray(data.entries) ? data.entries : []);
        items = root.map((e) => normItem({ kind: "entry", ...normEntry(e) }));
        const folders = Array.isArray(data.folders) ? data.folders : [];
        items = items.concat(folders.map((f) => normItem({ kind: "folder", ...f })));
    }
    out.items = items;
    out.separator = typeof data.separator === "string" ? data.separator : ",\\n\\n";
    out.randomEnabled = !!data.randomEnabled;
    out.randomCount = typeof data.randomCount === "number" ? data.randomCount : 1;
    out.nameWidth = typeof data.nameWidth === "number" ? data.nameWidth : 80;
    return out;
}

function loadData(node) {
    const hw = node.widgets && node.widgets.find((w) => w.name === "preset_text_data");
    const raw = hw ? hw.value : "{}";
    let data = null;
    try {
        data = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
        data = null;
    }
    return normalizeData(data);
}

function saveData(node) {
    const hw = node.widgets && node.widgets.find((w) => w.name === "preset_text_data");
    if (hw) hw.value = JSON.stringify(node.__stData);
    // 注意：数据写入不再触发 resize 调度——打字是高频操作，逐字调度会造成
    // 「每字符克隆整个 DOM 测量高度 + 全画布重绘」的明显卡顿。
    // 尺寸同步由两条路径兜底，原有自动调整大小行为不变：
    //   1) renderRows 末尾主动调 resizeNode（增删行/文件夹、拖拽排序等结构变化）；
    //   2) ResizeObserver 持续监听容器真实高度变化（折叠/展开文件夹等）。
}

const DRAG_SVG =
    '<svg width="11" height="13" viewBox="0 0 12 14" fill="currentColor"><circle cx="3" cy="3" r="1.3"/><circle cx="9" cy="3" r="1.3"/><circle cx="3" cy="7" r="1.3"/><circle cx="9" cy="7" r="1.3"/><circle cx="3" cy="11" r="1.3"/><circle cx="9" cy="11" r="1.3"/></svg>';
const FOLDER_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const SAVE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>';
const CHEVRON_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>';

// 全局拖拽状态：{ kind:"entry"|"folder", id, fromFolderId? }
let _drag = null;

// 从任意位置取出一个 entry（顶层 items 或某个 folder 内），返回该对象（已脱离原数组）
function _takeEntry(node, entryId) {
    const items = node.__stData.items;
    for (const f of items) {
        if (f.kind === "folder") {
            const i = f.entries.findIndex((e) => e.id === entryId);
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
        const f = node.__stData.items.find((x) => x.kind === "folder" && x.id === folderId);
        if (f) {
            const i = f.entries.findIndex((e) => e.id === entryId);
            if (i >= 0) f.entries.splice(i, 1);
        }
    }
}

// 顶层 item 的 key（用于排序锚点）
function itemKey(it) {
    return it.kind + ":" + it.id;
}

// 把 entry 移入某个 folder（folderId）的 beforeEntryId 之前（null=末尾）
function moveIntoFolder(node, drag, folderId, beforeEntryId) {
    if (!drag || drag.kind !== "entry") return;
    if (beforeEntryId === drag.id) return; // 落点是自身等价于不移动
    const obj = _takeEntry(node, drag.id);
    if (!obj) return;
    const tf = node.__stData.items.find((x) => x.kind === "folder" && x.id === folderId);
    if (!tf) {
        node.__stData.items.push(obj); // 目标 folder 不存在，退回到顶层
    } else if (beforeEntryId) {
        const bi = tf.entries.findIndex((e) => e.id === beforeEntryId);
        if (bi < 0) tf.entries.push(obj);
        else tf.entries.splice(bi, 0, obj);
    } else {
        tf.entries.push(obj);
    }
    saveData(node);
    renderRows(node);
}

// 顶层排序：把 drag（entry 或 folder）移动到 beforeKey（"entry:.."/"folder:.."/null=末尾）之前
function moveTopLevel(node, drag, beforeKey) {
    if (!drag) return;
    // 落点是自身则等价于不移动。否则自身被先移出数组后就找不到锚点，
    // 会被 push 到末尾，造成「轻微误拖即跳到列表最后」
    if (beforeKey === (drag.kind === "folder" ? "folder:" : "entry:") + drag.id) return;
    const items = node.__stData.items;
    let obj = null;
    if (drag.kind === "entry") {
        obj = _takeEntry(node, drag.id);
    } else if (drag.kind === "folder") {
        const i = items.findIndex((x) => x.kind === "folder" && x.id === drag.id);
        if (i >= 0) obj = items.splice(i, 1)[0];
    }
    if (!obj) return;
    if (beforeKey) {
        const bi = items.findIndex((x) => itemKey(x) === beforeKey);
        if (bi < 0) items.push(obj);
        else items.splice(bi, 0, obj);
    } else {
        items.push(obj);
    }
    saveData(node);
    renderRows(node);
}

// 文本行拖到某个 entry 上 / 两个顶层 item 之间：统一入口
function dropOnEntry(node, drag, targetEntryId, targetFolderId) {
    if (!drag || drag.kind !== "entry") return;
    if (targetEntryId === drag.id) return; // 拖放到自身上等价于不移动
    if (targetFolderId == null) {
        // 顶层插入到目标 entry 之前
        moveTopLevel(node, drag, targetEntryId ? "entry:" + targetEntryId : null);
    } else {
        moveIntoFolder(node, drag, targetFolderId, targetEntryId || null);
    }
}

function buildEntryRow(node, entry, folderId) {
    const row = document.createElement("div");
    row.className = "wm-st-row";
    row.dataset.entryId = entry.id;
    row.dataset.folderId = folderId == null ? "root" : folderId;
    row.dataset.key = "entry:" + entry.id;
    // 整行始终可拖拽（手柄只是视觉提示），输入框里拖拽由 dragstart 守卫放行文字选择
    row.draggable = true;

    const on = document.createElement("input");
    on.type = "checkbox";
    on.className = "wm-st-on";
    on.checked = !!entry.enabled;
    on.title = "启用";
    on.addEventListener("change", () => {
        entry.enabled = on.checked;
        saveData(node);
    });

    const handle = document.createElement("span");
    handle.className = "wm-st-handle";
    handle.innerHTML = DRAG_SVG;
    handle.title = "拖拽移动 / 排序";

    const name = document.createElement("input");
    name.className = "wm-st-name";
    name.style.flexBasis = ((node.__stData && node.__stData.nameWidth) || 80) + "px";
    name.value = entry.title || "";
    name.placeholder = "名称";
    name.addEventListener("input", () => {
        entry.title = name.value;
        saveData(node);
    });

    const content = document.createElement("div");
    content.className = "wm-st-content";
    const renderContent = () => {
        content.textContent = entry.content || "";
        content.classList.toggle("empty", !entry.content);
    };
    renderContent();
    content.title = "点击编辑内容";
    content.addEventListener("click", () => openContentModal(node, entry, renderContent));

    const saveBtn = document.createElement("span");
    saveBtn.className = "wm-st-fbtn save";
    saveBtn.innerHTML = SAVE_SVG;
    saveBtn.title = "保存到预设（单条文本存入预设管理器「未分类」）";
    saveBtn.addEventListener("click", () => {
        if (window.WindMixPresetManager && window.WindMixPresetManager.importPreset) {
            window.WindMixPresetManager.importPreset(entry.title || "未命名", entry.content || "");
        } else {
            alert("预设管理器未加载");
        }
    });

    const del = document.createElement("span");
    del.className = "wm-st-del";
    del.textContent = "✕";
    del.title = "删除";
    del.addEventListener("click", () => {
        removeEntry(node, entry.id, folderId);
        saveData(node);
        renderRows(node);
    });

    row.append(on, handle, name, content, saveBtn, del);

    // 拖拽
    row.addEventListener("dragstart", (e) => {
        // 在名称输入框里拖拽是在选中文字，不应触发整行拖拽
        if (e.target.tagName === "INPUT") { e.preventDefault(); return; }
        _drag = { kind: "entry", id: entry.id, fromFolderId: folderId };
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", entry.id); } catch (_) {}
        row.style.opacity = "0.5";
    });
    row.addEventListener("dragend", () => {
        // 不能把 draggable 置为 false：拖拽被取消（Esc / 拖到无效区域）时不会
        // 触发 renderRows 重建 DOM，置 false 会导致这一行之后永远无法再拖动
        row.style.opacity = "1";
        _drag = null;
        clearDragOver(node);
        clearTopHL(node);
    });
    row.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove("drag-over");
        dropOnEntry(node, _drag, entry.id, folderId);
    });

    return row;
}

function clearDragOver(node) {
    const c = node.__stContainer;
    if (!c) return;
    c.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
}

// 清除顶层插入点高亮（容器在拖动时显示的插入横线）
function clearTopHL(node) {
    const c = node.__stContainer;
    if (!c) return;
    c.querySelectorAll(".top-before").forEach((el) => el.classList.remove("top-before"));
}

// 顶层拖拽：在容器上计算「鼠标当前应插入到哪个顶层 item 之前」
function computeTopBefore(container, y) {
    const kids = Array.from(container.children).filter((el) => el.dataset && el.dataset.key);
    for (const el of kids) {
        const r = el.getBoundingClientRect();
        if (y < r.top + r.height / 2) return el.dataset.key;
    }
    return null; // 末尾
}

function highlightTop(node, beforeKey) {
    clearTopHL(node);
    if (!beforeKey) return;
    const c = node.__stContainer;
    if (!c) return;
    const el = c.querySelector('[data-key="' + beforeKey + '"]');
    if (el) el.classList.add("top-before");
}

// 绑定容器顶层拖拽（一次即可，container 在多次 renderRows 中持续存在）
function attachTopDrop(node, container) {
    if (container.__wmTopBound) return;
    container.__wmTopBound = true;
    container.addEventListener("dragover", (e) => {
        if (!_drag) return;
        e.preventDefault();
        const before = computeTopBefore(container, e.clientY);
        highlightTop(node, before);
    });
    container.addEventListener("drop", (e) => {
        if (!_drag) return;
        e.preventDefault();
        const before = computeTopBefore(container, e.clientY);
        clearTopHL(node);
        moveTopLevel(node, _drag, before);
    });
}

function buildZone(node, folderId, entries) {
    const zone = document.createElement("div");
    zone.className = "wm-st-zone";
    zone.dataset.folderId = folderId == null ? "root" : folderId;
    if (!entries.length) {
        // 仅根目录空时给一行提示；文件夹空时不显示任何文字（保持可拖入的空白区）
        if (folderId == null) {
            const hint = document.createElement("div");
            hint.className = "wm-st-zone-hint";
            hint.textContent = "根目录（拖入文本或点击下方新增）";
            zone.append(hint);
        }
    } else {
        entries.forEach((entry) => zone.append(buildEntryRow(node, entry, folderId)));
    }
    zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove("drag-over");
        if (!_drag) return;
        if (_drag.kind === "entry") {
            if (folderId == null) moveTopLevel(node, _drag, null);
            else moveIntoFolder(node, _drag, folderId, null);
        } else if (_drag.kind === "folder") {
            if (folderId == null) moveTopLevel(node, _drag, null);
            else moveTopLevel(node, _drag, "folder:" + folderId);
        }
    });
    return zone;
}

function buildFolderBlock(node, folder) {
    const block = document.createElement("div");
    block.className = "wm-st-folder";
    block.dataset.key = "folder:" + folder.id;
    // 整个文件夹块始终可拖拽（手柄只是视觉提示）
    block.draggable = true;
    // 整个文件夹启用/禁用时，给块加灰显类
    if (folder.enabled === false) block.classList.add("wm-st-folder-off");
    // 折叠状态：初始即隐藏 zone
    if (folder.collapsed) block.classList.add("collapsed");
    // 空文件夹（无子内容）标记，CSS 会隐藏其 zone，使高度与折叠态一致
    if ((folder.entries || []).length === 0) block.classList.add("wm-st-folder-empty");

    const head = document.createElement("div");
    head.className = "wm-st-folder-head";

    // 折叠/展开按钮（放在最前面）
    const collapseBtn = document.createElement("span");
    collapseBtn.className = "wm-st-collapse";
    collapseBtn.innerHTML = CHEVRON_SVG;
    collapseBtn.title = folder.collapsed ? "展开文件夹" : "折叠文件夹";
    collapseBtn.addEventListener("click", () => {
        folder.collapsed = !folder.collapsed;
        block.classList.toggle("collapsed", folder.collapsed);
        collapseBtn.title = folder.collapsed ? "展开文件夹" : "折叠文件夹";
        saveData(node);
        // 折叠/展开改变内容高度，但容器自身 box 不变（ResizeObserver 感知不到），
        // 必须主动触发下一帧按真实高度同步节点尺寸，否则展开时文本行会先溢出
        // 节点下边框呈"悬浮"状，直到下次无关操作才补上（节点一下子长高很多）。
        scheduleResize(node);
    });

    // 文件夹整体启用勾选（置灰=整个文件夹参与拼接；勾掉=跳过整个文件夹）
    const folderOn = document.createElement("input");
    folderOn.type = "checkbox";
    folderOn.className = "wm-st-folder-on";
    folderOn.checked = folder.enabled !== false;
    folderOn.title = "启用整个文件夹（勾掉则整个文件夹不参与拼接输出）";
    folderOn.addEventListener("change", () => {
        folder.enabled = folderOn.checked;
        block.classList.toggle("wm-st-folder-off", !folderOn.checked);
        saveData(node);
    });

    const ficon = document.createElement("span");
    ficon.className = "wm-st-ficon";
    ficon.innerHTML = FOLDER_SVG;

    const handle = document.createElement("span");
    handle.className = "wm-st-handle";
    handle.innerHTML = DRAG_SVG;
    handle.title = "拖拽排序文件夹";

    const fname = document.createElement("input");
    fname.className = "wm-st-fname";
    fname.value = folder.name || "新建文件夹";
    fname.placeholder = "文件夹名称";
    fname.addEventListener("input", () => {
        folder.name = fname.value;
        saveData(node);
    });

    const saveBtn = document.createElement("span");
    saveBtn.className = "wm-st-fbtn save";
    saveBtn.innerHTML = SAVE_SVG;
    saveBtn.title = "保存到预设（作为目录存入预设管理器）";
    saveBtn.addEventListener("click", () => {
        const entries = (folder.entries || []).map((e) => ({ title: e.title || "", content: e.content || "" }));
        if (window.WindMixPresetManager && window.WindMixPresetManager.importFolder) {
            window.WindMixPresetManager.importFolder(folder.name || "新建文件夹", entries);
        } else {
            alert("预设管理器未加载");
        }
    });

    const delBtn = document.createElement("span");
    delBtn.className = "wm-st-fbtn del";
    delBtn.textContent = "✕";
    delBtn.title = "删除文件夹（连同其内全部内容一并删除）";
    delBtn.addEventListener("click", () => {
        // 空文件夹直接删除，不弹确认；非空才弹确认
        const isEmpty = (folder.entries || []).length === 0;
        if (!isEmpty && !confirm('确定删除文件夹「' + (folder.name || "新建文件夹") + '」及其全部内容？\n此操作不可撤销。')) return;
        const i = node.__stData.items.findIndex((x) => x.kind === "folder" && x.id === folder.id);
        if (i >= 0) {
            node.__stData.items.splice(i, 1);
            saveData(node);
            renderRows(node);
        }
    });

    head.append(collapseBtn, folderOn, ficon, handle, fname, saveBtn, delBtn);

    const zone = buildZone(node, folder.id, folder.entries || []);
    block.append(head, zone);

    // 整个文件夹块作为拖入目标：展开/折叠、空/有内容都能把文本行拖进来归类
    // （空文件夹的 zone 已被 CSS 隐藏，必须靠块本身接收 drop 才能往里放内容）
    block.addEventListener("dragstart", (e) => {
        // 拖拽源自文件夹内的文本行时，交由该行的 dragstart 设置 _drag，这里不要覆盖
        if (e.target.closest && e.target.closest(".wm-st-row")) return;
        // 在文件夹名输入框里拖拽是在选中文字，不触发文件夹拖拽
        if (e.target.tagName === "INPUT") { e.preventDefault(); return; }
        _drag = { kind: "folder", id: folder.id };
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", folder.id); } catch (_) {}
        block.style.opacity = "0.5";
    });
    block.addEventListener("dragend", () => {
        // 同上：拖拽取消时不会有 renderRows 重建，不能把 draggable 置 false
        block.style.opacity = "1";
        _drag = null;
        clearDragOver(node);
        clearTopHL(node);
    });
    block.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        block.classList.add("drag-over");
    });
    block.addEventListener("dragleave", () => block.classList.remove("drag-over"));
    block.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        block.classList.remove("drag-over");
        if (!_drag) return;
        if (_drag.kind === "entry") moveIntoFolder(node, _drag, folder.id, null);
        else if (_drag.kind === "folder") moveTopLevel(node, _drag, "folder:" + folder.id);
    });
    return block;
}

function openPresetManager(node) {
    if (window.WindMixPresetManager && window.WindMixPresetManager.open) {
        window.WindMixPresetManager.open(node);
    } else {
        alert("预设管理器未加载");
    }
}

//------------------------------------------------------------------------------
// 自动补全：词库加载与挂载逻辑已抽到 ./js/prompt_studio/windmix_preset_ac.js，
// 与「预设管理器」编辑弹窗共用同一份词库缓存（只下载一次）。实现细节见该文件。
//------------------------------------------------------------------------------

// 内容编辑弹窗：大输入框 + 取消 / 保存
function openContentModal(node, entry, after) {
    const bd = document.createElement("div");
    bd.className = "wm-st-modal-bd";
    const modal = document.createElement("div");
    modal.className = "wm-st-modal";

    const h = document.createElement("h4");
    h.textContent = "编辑内容" + (entry.title ? "（" + entry.title + "）" : "");

    const ta = document.createElement("textarea");
    ta.value = entry.content || "";
    ta.placeholder = "在此输入文本内容…";

    const actions = document.createElement("div");
    actions.className = "wm-st-modal-actions";
    const cancel = document.createElement("button");
    cancel.className = "cancel";
    cancel.textContent = "取消";
    const ok = document.createElement("button");
    ok.className = "ok";
    ok.textContent = "保存";
    actions.append(cancel, ok);

    modal.append(h, ta, actions);
    bd.append(modal);
    document.body.append(bd);
    ta.focus();

    // 自动补全：词库就绪后挂到编辑框（↑↓ 选择、Tab/Enter 插入、Esc 关闭、点击选择）
    let acRef = null;
    attachAutoComplete(ta).then((ac) => { acRef = ac; });

    const close = () => {
        if (bd.parentNode) bd.parentNode.removeChild(bd);
        // 下拉挂在 document.body 上（fixed 定位），弹窗移除时不会触发 ta 的 blur，
        // 必须手动清掉，否则会残留在页面上
        if (acRef) { acRef.dropdown.remove(); acRef = null; }
    };
    cancel.addEventListener("click", close);
    bd.addEventListener("mousedown", (e) => { if (e.target === bd) close(); });
    ok.addEventListener("click", () => {
        entry.content = ta.value;
        saveData(node);
        if (after) after();
        close();
    });
}

function renderRows(node) {
    const container = node.__stContainer;
    if (!container) return;
    // 兜底：如果 __stData 因为某种原因丢失（比如热重载、刷新后初次回调），
    // 从隐藏控件 preset_text_data 里重新读，避免渲染成空白
    if (!node.__stData || typeof node.__stData !== "object") {
        node.__stData = loadData(node);
    }
    container.innerHTML = "";
    const data = node.__stData;

    // 顶部单行工具栏
    const toolbar = document.createElement("div");
    toolbar.className = "wm-st-toolbar";

    const folderBtn = document.createElement("span");
    folderBtn.className = "wm-st-icon-btn";
    folderBtn.innerHTML = FOLDER_SVG;
    folderBtn.title = "在节点内新建文件夹";
    folderBtn.addEventListener("click", () => {
        node.__stData.items.push({ kind: "folder", id: genFolderId(), name: "新建文件夹", enabled: true, collapsed: false, entries: [] });
        saveData(node);
        renderRows(node);
    });

    const sep = document.createElement("input");
    sep.className = "wm-st-sep";
    sep.value = data.separator;
    sep.title = "分隔符（\\n 表示换行）";
    sep.placeholder = "分隔符";
    sep.addEventListener("input", () => {
        data.separator = sep.value;
        saveData(node);
    });

    const nw = document.createElement("input");
    nw.type = "number";
    nw.className = "wm-st-namew";
    nw.min = "20";
    nw.max = "400";
    nw.value = String(data.nameWidth);
    nw.title = "名称框宽度(px)，调整即改变所有名称框宽度";
    nw.placeholder = "名称宽";
    nw.addEventListener("input", () => {
        let v = parseInt(nw.value, 10);
        if (isNaN(v)) v = 80;
        v = Math.max(20, Math.min(400, v));
        data.nameWidth = v;
        container.querySelectorAll(".wm-st-name").forEach((el) => { el.style.flexBasis = v + "px"; });
        saveData(node);
    });

    const rndLabel = document.createElement("label");
    rndLabel.className = "wm-st-opt";
    const rnd = document.createElement("input");
    rnd.type = "checkbox";
    rnd.checked = !!data.randomEnabled;
    rnd.addEventListener("change", () => {
        data.randomEnabled = rnd.checked;
        saveData(node);
    });
    rndLabel.append(rnd, document.createTextNode("随机选择"));

    const rcLabel = document.createElement("label");
    rcLabel.className = "wm-st-opt";
    rcLabel.append(document.createTextNode("数量"));
    const rc = document.createElement("input");
    rc.type = "number";
    rc.min = "1";
    rc.className = "wm-st-rc";
    rc.value = String(data.randomCount);
    rc.addEventListener("input", () => {
        const v = parseInt(rc.value, 10);
        data.randomCount = isNaN(v) ? 1 : Math.max(1, v);
        saveData(node);
    });
    rcLabel.append(rc);

    toolbar.append(folderBtn, sep, nw, rndLabel, rcLabel);
    container.append(toolbar);

    // 顶层有序序列：entry / folder 可交错，统一按 items 顺序渲染
    data.items.forEach((it) => {
        if (it.kind === "folder") container.append(buildFolderBlock(node, it));
        else container.append(buildEntryRow(node, it, null));
    });

    // 底部固定按钮
    const footer = document.createElement("div");
    footer.className = "wm-st-footer";
    const presetBtn = document.createElement("button");
    presetBtn.className = "wm-st-btn wm-st-btn-outline";
    presetBtn.textContent = "预设文本";
    presetBtn.addEventListener("click", () => openPresetManager(node));
    const addBtn = document.createElement("button");
    addBtn.className = "wm-st-btn wm-st-btn-solid";
    addBtn.textContent = "＋ 新增文本框";
    addBtn.addEventListener("click", () => {
        node.__stData.items.push({ kind: "entry", id: genId(), enabled: true, title: "", content: "" });
        saveData(node);
        renderRows(node);
    });
    footer.append(presetBtn, addBtn);
    container.append(footer);

    saveData(node);
    // 渲染完后立即按真实 DOM 高度同步外框，避免底栏按钮外露
    resizeNode(node);
}

// 让节点根据 DOM 真实高度重新计算外框尺寸。
// 关键：DOM 容器高度变化后画布背景框(node.size)不会自动同步，需要主动 setSize。
// 用 requestAnimationFrame 延后到下一次布局，确保拿到准确的 scrollHeight。
// 配合 ResizeObserver 持续监听，后续增删行也会自动同步。

// 读取容器真实内容高度。
// 把容器克隆到 body 外部测量，彻底脱离节点/widget 父容器的高度约束，
// 避免"节点被拉多高 → 量出来多高 → 又 setSize 更高"的正反馈。
// 影响节点高度的结构签名：只有行数 / 文件夹折叠态与行数 / 容器宽度有关；
// 标题、内容文字都是单行固定高度控件（超长省略号），与高度无关。
function _heightSig(node) {
    const data = node && node.__stData;
    const parts = [];
    ((data && data.items) || []).forEach((it) => {
        if (it && it.kind === "folder") parts.push("f" + (it.collapsed ? 1 : 0) + ":" + ((it.entries || []).length));
        else parts.push("e");
    });
    return parts.join(",");
}

function _measureContentHeight(node) {
    const container = node && node.__stContainer;
    if (!container) return 0;
    if (!container.isConnected) return _estimateHeight(node.__stData);

    // 测量缓存：结构与宽度未变化时（例如打字、勾选启用、改分隔符）直接复用上次结果，
    // 彻底避免高频的「克隆整个 DOM → 插入 body → 强制重排 → 移除」。
    // 结构变化（增删行/文件夹、折叠）必然伴随 __stData 变化，签名失配后会重新实测。
    const wpx = container.getBoundingClientRect().width;
    const key = Math.round(wpx / 8) + "|" + _heightSig(node);
    if (node.__stHCache && node.__stHCache.key === key) return node.__stHCache.h;

    const clone = container.cloneNode(true);
    clone.style.cssText = "";
    clone.style.position = "absolute";
    clone.style.left = "-99999px";
    clone.style.top = "-99999px";
    clone.style.visibility = "hidden";
    clone.style.height = "auto";
    clone.style.minHeight = "0";
    clone.style.maxHeight = "none";
    clone.style.width = container.getBoundingClientRect().width + "px";
    clone.style.flex = "0 0 auto";
    clone.style.alignSelf = "flex-start";
    clone.style.overflow = "visible";
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));

    document.body.appendChild(clone);
    let h = 0;
    try {
        void clone.getBoundingClientRect();
        h = clone.getBoundingClientRect().height || clone.scrollHeight || 0;
    } catch (_) {}
    clone.remove();
    if (h) node.__stHCache = { key, h };
    return h;
}

// 当真实高度拿不到时的兜底估算（容器未挂载到文档等情况）。
// 常量与 CSS 实际渲染高度对应（有偏差只影响兜底，正常路径走 _measureContentHeight 实测）：
//   基础 ≈ 工具栏(41) + 底栏(49) + 容器padding(10) + 间隙(12) ≈ 112
//   文本行 = padding 10 + border 2 + 输入框 32 ≈ 44，取 45
//   文件夹头 = margin 4 + border 2 + padding 10 + 名称框 ~34 ≈ 50，取 52
//   文件夹展开的 zone = padding 10 + 行若干
function _estimateHeight(data) {
    if (!data || !Array.isArray(data.items) || data.items.length === 0) return EMPTY_H;
    let h = 112;
    data.items.forEach((it) => {
        if (it && it.kind === "folder") {
            h += 52;
            if (!it.collapsed) h += 10 + (it.entries || []).length * 45;
        } else {
            h += 45;
        }
    });
    return h;
}
let _wmStResizePending = new WeakSet();
function scheduleResize(node) {
    if (!node || _wmStResizePending.has(node)) return;
    _wmStResizePending.add(node);
    requestAnimationFrame(() => {
        _wmStResizePending.delete(node);
        resizeNode(node);
    });
}
function resizeNode(node) {
    if (!node || typeof node.setSize !== "function") return;
    // 优先用真实布局高度；拿不到再按内容估算
    let contentH = _measureContentHeight(node);
    if (!contentH) contentH = _estimateHeight(node.__stData);
    const w = Math.max(MIN_W, node.size ? node.size[0] : MIN_W);
    // 关键：setSize 直接覆盖节点总高度，所以必须把 chrome（标题栏 ~30-36px）加回去，
    // 否则节点永远缺一段高度，底栏按钮就会被裁在外面。+6 为底部留白余量。
    const totalH = Math.ceil(Math.max(MIN_H, contentH + CHROME_H + 6));
    const curW = node.size ? node.size[0] : 0;
    const curH = node.size ? node.size[1] : 0;
    // 宽度变化：立即同步
    if (Math.abs(curW - w) >= 0.5) {
        node.setSize([w, totalH]);
        node.setDirtyCanvas?.(true, true);
        if (node.graph && node.graph.setDirtyCanvas) node.graph.setDirtyCanvas(true, true);
        return;
    }
    // 高度：需要更高时总是同步（避免内容被裁/按钮与文本重叠）；
    // 仅当"需要更矮"时加阈值(>=6px)防抖动，避免亚像素无限伸缩。
    // 这是「新建第 3 个文本框 / 新建文件夹后内容盖住文本」的根因修复点。
    if (totalH > curH + 0.5) {
        node.setSize([w, totalH]);
        node.setDirtyCanvas?.(true, true);
        if (node.graph && node.graph.setDirtyCanvas) node.graph.setDirtyCanvas(true, true);
    } else if (curH - totalH >= 6) {
        node.setSize([w, totalH]);
        node.setDirtyCanvas?.(true, true);
        if (node.graph && node.graph.setDirtyCanvas) node.graph.setDirtyCanvas(true, true);
    }
}
function attachResizeObserver(node, container) {
    if (typeof ResizeObserver === "undefined") return;
    if (node.__stRO) return;
    node.__stRO = new ResizeObserver(() => scheduleResize(node));
    node.__stRO.observe(container);
}

// 拒绝任何连线接入隐藏的 preset_text_data 内部存储口（它是节点自身 JSON 记忆，
// 不是给外部接的；接错会覆盖整份文本行导致节点空掉）。一旦检测到连接即断链。
function _wmRejectPresetDataLink(node, app, slot, linkId, linkInfo) {
    let id = linkId;
    if ((id == null || id === undefined) && linkInfo && typeof linkInfo === "object" && linkInfo.id != null) {
        id = linkInfo.id;
    }
    if (app && app.graph && id != null && id !== undefined && app.graph.links && app.graph.links[id]) {
        const link = app.graph.links[id];
        const origin = app.graph.getNodeById(link.origin_id);
        if (origin && link.origin_slot != null && origin.outputs && origin.outputs[link.origin_slot]) {
            const arr = origin.outputs[link.origin_slot].links;
            if (Array.isArray(arr)) {
                const i = arr.indexOf(id);
                if (i >= 0) arr.splice(i, 1);
            }
        }
        delete app.graph.links[id];
    }
    // 清掉 widget 上的 link 引用
    if (node.widgets) {
        const w = node.widgets.find((x) => x.name === "preset_text_data");
        if (w) w.link = null;
    }
    // 断开该 input（若存在）
    try {
        if (slot != null && node.disconnectInput) node.disconnectInput(slot);
    } catch (e) { /* 忽略：可能已不存在 */ }
}

// 彻底隐藏 preset_text_data 存储 widget（输入框 + nodes2.0 自动生成的连接点）。
// 双渲染器兼容（同 widgethider.js 手法）：
// - Nodes 1.0（litegraph）：hidden=true + type="hidden" + computeSize 归零；
// - Nodes 2.0（Vue）：只认响应式 state 的 options.hidden；_state 晚到则轮询补写
//   并替换整个 options 引用强制重渲。type="hidden" 仅在老前端（无 _state）使用——
//   现代前端设 type="hidden" 会让 Vue 回退成 WidgetLegacy 照样画出且反复重挂载。
// widget 对象本身保留，value 照常序列化进 prompt、传给 execute。
function _wmHidePresetDataWidget(node) {
    const w = node.widgets && node.widgets.find((x) => x.name === "preset_text_data");
    if (!w) return;
    w.hidden = true;

    // Nodes 2.0 响应式隐藏
    const applyState = () => {
        if (w._state && w._state.options) {
            w._state.options.hidden = true;
            try { w._state.options = { ...w._state.options, hidden: true }; } catch (e) {}
            // Vue 走 options.hidden 即可隐藏，type hack 反而引起 WidgetLegacy 回退重挂载
            if (w._origType) { w.type = w._origType; delete w._origType; }
        }
    };
    if (w._state) {
        applyState();
    } else {
        // 老前端（无 _state）：type hack + computeSize 归零兜底
        if (!w._origType) w._origType = w.type;
        w.type = "hidden";
        w.computeSize = function () { return [0, 0]; };
        // _state 可能晚到：轮询补写响应式 hidden，就绪后还原 type
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
        // 连 label 所在的整行一起隐藏（旧版 DOM widget）
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

app.registerExtension({
    name: "WindMix.PresetText",
    async init() {},
    async beforeRegisterNodeDef(nodeType, nodeData, appInstance) {
        const typeKey = nodeData.name || (nodeType && nodeType.comfyClass);
        if (typeKey !== NODE_TYPE) return;

        const onCreated = nodeType.prototype.onNodeCreated;

        // 守卫：禁止把任何连线接入隐藏的 preset_text_data 内部存储口（它只由前端 DOM 维护，
        // 接错会覆盖节点 JSON 记忆导致文本行丢失）。只允许「可选输入」被外部连。
        const onConnChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (type, slot, connect, linkInfo, nodeIn) {
            const INPUT = (typeof LiteGraph !== "undefined" && LiteGraph.INPUT) ? LiteGraph.INPUT : 1;
            const r = onConnChange ? onConnChange.apply(this, arguments) : undefined;
            if (type === INPUT && connect) {
                const inp = this.inputs && this.inputs[slot];
                let reject = false;
                let wlink = null;
                if (inp && inp.widget && inp.widget.name === "preset_text_data") {
                    reject = true;
                    wlink = inp.link;
                } else if (this.widgets) {
                    const w = this.widgets.find((x) => x.name === "preset_text_data");
                    if (w && w.link != null) {
                        reject = true;
                        wlink = w.link;
                    }
                }
                if (reject) {
                    _wmRejectPresetDataLink(this, appInstance, slot, wlink, linkInfo);
                }
            }
            return r;
        };

            nodeType.prototype.onNodeCreated = function () {
                const r = onCreated ? onCreated.apply(this, arguments) : undefined;
                injectStyle();
                const node = this;

                node.__stData = loadData(node);
                // 全新节点（没有任何条目）默认带一个空白文本框，避免创建后没有任何可输入区域
                ensureSeed(node);

                // nodes2.0 / 延迟渲染下，widget 可能在 nextTick 才真正建好。
                // 这里用 setTimeout(() => _wmHidePresetDataWidget(node), 0) 两档兜底，确保必中。
                setTimeout(() => _wmHidePresetDataWidget(node), 0);
                setTimeout(() => _wmHidePresetDataWidget(node), 200);

                // nodes2.0 走 onConnectInput 拦截连接，旧版走 onConnectionsChange（已在 beforeRegister 处定义）。
                const _origOnConnectInput = node.onConnectInput;
                node.onConnectInput = function (inputIndex, outputType, outputSlot, outputNode, outputIndex) {
                    const inp = this.inputs && this.inputs[inputIndex];
                    if (inp && inp.widget && inp.widget.name === "preset_text_data") return false;
                    if (_origOnConnectInput) {
                        return _origOnConnectInput.apply(this, arguments);
                    }
                    return true;
                };

            // 默认宽度设大一点，避免一创建就挤成一团；高度按内容估算起步，
            // 随后由 computeSize + scheduleResize 按真实 DOM 高度精确修正
            if (!node.size || (node.size[0] || 0) < MIN_W) {
                const estH = _estimateHeight(node.__stData) + CHROME_H + 6;
                node.size = [Math.max(MIN_W, node.size ? node.size[0] : MIN_W),
                             Math.max(MIN_H, node.size ? node.size[1] : estH)];
            }
            // 不再设 node.minSize，改为由 domWidget.computeSize + MIN_H 兜底最小高度，
            // 这样更贴合内容、避免硬性 minSize 导致空内容占位

            const container = document.createElement("div");
            container.className = "wm-st-container";
            node.__stContainer = container;

            const domWidget = node.addDOMWidget("wm_st_rows", "div", container, {
                serialize: false,
                hideOnZoom: false,
            });
            // 永久设为 overflow:visible，保证 scrollHeight 总是返回真实内容高度，
            // 避免 LiteGraph wrapper 默认 overflow:hidden 把 scrollHeight 截断到可见区。
            if (domWidget.element && domWidget.element.style) {
                domWidget.element.style.overflow = "visible";
            }
            node.__stDomWidget = domWidget;
            if (domWidget.computeSize) {
                domWidget.computeSize = function (width) {
                    // 控件区高度 = max(内容真实高度, 节点内容区可用高度)。
                    // 关键：当节点比内容高（余量/缓冲/手动拉高）时，控件区填满节点内容区，
                    // 多余空间在容器内被 flex(margin-top:auto) 推到「内容与底栏按钮」之间，
                    // 底栏按钮因此始终贴容器底部 → 距节点下边框恒定，不再出现在按钮下方。
                    let h = _measureContentHeight(node);
                    if (!h) h = _estimateHeight(node.__stData);
                    const avail = (node.size && node.size[1]) ? node.size[1] - CHROME_H : 0;
                    return [width, Math.max(h, avail)];
                };
            }

            renderRows(node);
            attachResizeObserver(node, container);
            attachTopDrop(node, container);
            // 用户手动缩放节点时，钳制最小尺寸：高度不允许比内容矮（避免内容露出），
            // 宽度不允许比 MIN_W 窄（避免节点被横向挤扁）
            let _wmResizing = false;
            node.onResize = function () {
                if (_wmResizing) return;
                _wmResizing = true;
                let contentH = _measureContentHeight(node);
                if (!contentH) contentH = _estimateHeight(node.__stData);
                const totalH = Math.ceil(Math.max(MIN_H, contentH + CHROME_H + 6));
                const curW = node.size ? node.size[0] : MIN_W;
                const curH = node.size ? node.size[1] : totalH;
                let w = curW, h = curH;
                if (h < totalH) h = totalH;
                if (w < MIN_W) w = MIN_W;
                if (w !== curW || h !== curH) node.setSize([w, h]);
                _wmResizing = false;
            };
            // 延后到下一帧再同步外框，确保拿到准确的 scrollHeight（解决初始加载按钮外露）
            scheduleResize(node);
            saveData(node);

            // 供预设管理器「发送到节点」时调用：追加到顶层末尾并重绘
            node.addPresetTextEntry = function (title, content) {
                node.__stData.items.push({
                    kind: "entry", id: genId(),
                    enabled: true, title: title || "", content: content || "",
                });
                saveData(node);
                renderRows(node);
            };
            // 供预设管理器「发送整个目录」时调用：在节点内新建一个文件夹（顶层末尾）并填入条目
            node.addPresetTextFolder = function (folderName, entries) {
                node.__stData.items.push({
                    kind: "folder", id: genFolderId(),
                    name: folderName || "来自预设的文件夹", enabled: true, collapsed: false,
                    entries: (entries || []).map((e) => ({
                        id: genId(),
                        enabled: e.enabled !== false,
                        title: e.title || e.name || "",
                        content: e.content || "",
                    })),
                });
                saveData(node);
                renderRows(node);
            };
            node.refreshPresetText = function () {
                renderRows(node);
            };
            return r;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (config) {
            const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
            const node = this;
            // 加载旧工作流时宽度下限；高度由 computeSize + scheduleResize 同步
            if (!node.size || (node.size[0] || 0) < MIN_W) {
                node.size = [Math.max(MIN_W, node.size ? node.size[0] : MIN_W),
                             Math.max(MIN_H, node.size ? node.size[1] : EMPTY_H + 8)];
            }
            if (config && config.preset_text_data) {
                try {
                    node.__stData = normalizeData(JSON.parse(config.preset_text_data));
                } catch (e) {
                    node.__stData = loadData(node);
                    ensureSeed(node);
                }
            } else {
                node.__stData = loadData(node);
                ensureSeed(node);
            }
            if (node.__stContainer) {
                renderRows(node);
                // 延后同步外框，避免加载后按钮外露
                scheduleResize(node);
            }
            return r;
        };
    },
});
