import { app } from "/scripts/app.js";

// =============================================================================
// WindMix LoRA 管理器（WindMixLoraStack / WindMixLoraLoaderModelOnly / WindMixLoraXY 共用）
// 界面全在这个文件里（后端 nodes/windmix_lora_nodes.py + nodes/windmix_xy_inputs.py）。
// 节点高度与条目数解耦：computeSize 上报常量 UI_H，条目多了走列表内滚动。
//
// 数据契约：
//   [{on,name,model,tag}, ...]                     —— 顶层 LoRA 行
//   [{folder:"配方名",on,open,loras:[...]}, ...]   —— 配方组（后端按显示顺序展开）
//   {loras:[...]}                                  —— 包裹形（历史兼容）
//
// 文件里标了 export 的部分是「共用件」（样式 / 图标 / 路径工具 / 隐藏控件 / 底距几何引擎），
// web/windmix_xy_unet_manager.js（UNet2）直接 import 过去，保证两个节点同一套配色和按钮。
// 几何引擎按 node.__wm2* 这组字段名读缓存，用它的节点必须沿用同样的字段名。
// =============================================================================

const NODE_TYPES = ["WindMixLoraStack", "WindMixLoraLoaderModelOnly", "WindMixLoraXY"];
const DATA_WIDGET = "lora_data";
const DEF_STRENGTH = 1.0;
export const MAX_ROWS = 50;

// 固定高度（px）：搜索行 32 + 间距 7 + 列表 292 + 间距 7 + 底部按钮 31
const LIST_H = 292;
export const UI_H = 32 + 7 + LIST_H + 7 + 31;
export const MIN_NODE_W = 400;
// 容器高 = 节点高 - chrome（标题栏 + 内边距），chrome 实测失败时用 DEFAULT_CHROME
const DEFAULT_CHROME = 34;
// 节点被缩得很矮时的下限：列表再小就没法操作了，按钮条高度不参与压缩
const LIST_MIN = 60;
const MIN_CONTAINER_H = 32 + 7 + LIST_MIN + 7 + 31;
// 悬浮预览：只有图，3:4
export const PV_W = 264;
export const PV_H = Math.round((PV_W * 4) / 3);
// 量不到底距时的兜底（LiteGraph 给 DOM widget 的左右内边距实测就是 15）
const DEFAULT_INSET = 15;
const GAP_SAFETY = 10;

//==============================================================================
// 后端数据源（与 v1 同一套路由）
//==============================================================================
let _loraCache = null;
async function getLoraFiles(force = false) {
    if (_loraCache == null || force) {
        try {
            const r = await fetch("/windmix/loras");
            const j = await r.json();
            _loraCache = Array.isArray(j.loras) ? j.loras : [];
        } catch (e) {
            _loraCache = [];
        }
    }
    return _loraCache || [];
}

async function fetchTag(name) {
    if (!name) return "";
    try {
        const r = await fetch(`/windmix/lora_metadata?name=${encodeURIComponent(name)}`);
        const j = await r.json();
        return Array.isArray(j.trainedWords) ? j.trainedWords.join(", ") : "";
    } catch (e) {
        return "";
    }
}

// 预览图：只认「模型同目录同名图片」，由 WindMix 自己的后端提供
let _previewVer = 0;
function previewUrl(name) {
    return `/WM_studio/prompt-studio/model-preview?type=loras` +
        `&name=${encodeURIComponent(name)}&v=${_previewVer}`;
}

if (app.refreshCombo) {
    const _orig = app.refreshCombo.bind(app);
    app.refreshCombo = function (...args) {
        _loraCache = null;
        _previewVer += 1;
        return _orig(...args);
    };
}

//==============================================================================
// 路径工具
//==============================================================================
export const norm = (p) => (p || "").replace(/\\/g, "/");
export const dirOf = (p) => { const i = norm(p).lastIndexOf("/"); return i >= 0 ? norm(p).slice(0, i) : ""; };
export const baseOf = (p) => { const i = norm(p).lastIndexOf("/"); return i >= 0 ? norm(p).slice(i + 1) : norm(p); };
export const stemOf = (n) => n.replace(/\.(safetensors|ckpt|pt|bin)$/i, "");
export const extOf = (n) => { const m = n.match(/\.(safetensors|ckpt|pt|bin)$/i); return m ? m[0] : ""; };
const clampStep = (v) => Math.round(v * 20) / 20;   // 0.05 步进，避免拖出 0.73333

//==============================================================================
// 数据读写（隐藏 lora_data 控件）
//==============================================================================
function getDataWidget(node) {
    return (node.widgets || []).find((w) => w.name === DATA_WIDGET);
}

// 隐藏控件：Nodes 1.0 看 widget.hidden，Nodes 2.0（Vue）只认响应式 _state.options.hidden
export function hideWidget(node, w) {
    if (!w) return;
    w.computeSize = () => [0, -4];
    w.type = "wm_hidden";
    w.hidden = true;
    if (w.element) w.element.style.display = "none";
    w.draw = function () {};
    const applyState = () => {
        if (w._state && w._state.options) {
            try { w._state.options = { ...w._state.options, hidden: true }; } catch (e) {}
        }
    };
    if (w._state) applyState();
    else if (w.options) {
        w.options.hidden = true;
        if (!w._wmStateRetry) {
            w._wmStateRetry = true;
            let tries = 0;
            const tick = () => {
                if (w._state) { applyState(); w._wmStateRetry = false; return; }
                if (tries++ < 120) requestAnimationFrame(tick);
                else w._wmStateRetry = false;
            };
            requestAnimationFrame(tick);
        }
    }
}

function _num(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : DEF_STRENGTH;
}

function _parseEntry(e) {
    if (e && e.folder) {
        return {
            folder: String(e.folder),
            on: e.on !== false,
            open: e.open !== false,
            loras: Array.isArray(e.loras) ? e.loras.filter((x) => x && typeof x === "object").map(_parseEntry) : [],
        };
    }
    return {
        on: !e || e.on !== false,
        name: (e && e.name) || "",
        model: _num(e && e.model),
        tag: (e && e.tag) || "",
    };
}

function _entryToJson(e) {
    if (e.folder) {
        return { folder: e.folder, on: e.on !== false, open: e.open !== false, loras: (e.loras || []).map(_entryToJson) };
    }
    return { on: e.on !== false, name: e.name || "", model: _num(e.model), tag: e.tag || "" };
}

function loadStack(node) {
    const w = getDataWidget(node);
    let arr = [];
    try {
        const p = JSON.parse(w?.value || "[]");
        arr = Array.isArray(p) ? p : (p && Array.isArray(p.loras) ? p.loras : []);
    } catch (e) {
        arr = [];
    }
    node.__wm2Stack = arr.filter((e) => e && typeof e === "object").map(_parseEntry);
    node.__wm2TagOpen = node.__wm2TagOpen || new Set();
    node.__wm2Sel = node.__wm2Sel || null;
    node.__wm2Kw = "";
}

function syncData(node) {
    const w = getDataWidget(node);
    if (!w) return;
    w.value = JSON.stringify((node.__wm2Stack || []).map(_entryToJson));
    node.setDirtyCanvas?.(true, false);
}

// 展平：[{entry, gi, lj}] —— gi<0 表示顶层行
function allRows(node) {
    const out = [];
    (node.__wm2Stack || []).forEach((e, i) => {
        if (e.folder) (e.loras || []).forEach((l, j) => out.push({ entry: l, gi: i, lj: j }));
        else out.push({ entry: e, gi: -1, lj: -1 });
    });
    return out;
}
const activeRows = (node) => allRows(node).filter((r) => r.entry.on && (r.gi < 0 || (node.__wm2Stack[r.gi] || {}).on !== false));
function findRow(node, name) {
    return allRows(node).find((r) => norm(r.entry.name) === norm(name)) || null;
}
// 「已用」只看顶层行：配方里挂过的条目不算外面用了，内外可以同时挂同一个 LoRA
function usedTopPaths(node) {
    return new Set((node.__wm2Stack || []).filter((e) => e && !e.folder)
        .map((e) => norm(e.name)).filter(Boolean));
}
// 某个路径是否已经挂在某个配方里（顶层弹窗要用它给提示胶囊，但绝不拦添加）
const inAnyGroup = (node, path) => (node.__wm2Stack || [])
    .some((e) => e.folder && (e.loras || []).some((l) => norm(l.name) === norm(path)));
function removeRow(node, name) {
    const r = findRow(node, name);
    if (!r) return;
    if (r.gi < 0) { const i = node.__wm2Stack.indexOf(r.entry); if (i >= 0) node.__wm2Stack.splice(i, 1); }
    else { const g = node.__wm2Stack[r.gi]; if (g) { const j = g.loras.indexOf(r.entry); if (j >= 0) g.loras.splice(j, 1); } }
}
// 注意：先抓对象引用再摘除源行，否则下标会因删除而整体错位
function moveRow(node, fromName, toName, after) {
    const f = findRow(node, fromName), t = findRow(node, toName);
    if (!f || !t || f.entry === t.entry) return;
    const entry = f.entry;
    const targetGroup = t.gi < 0 ? null : node.__wm2Stack[t.gi];
    removeRow(node, fromName);
    if (!targetGroup) {
        const i = node.__wm2Stack.indexOf(t.entry);
        if (i < 0) return;
        node.__wm2Stack.splice(after ? i + 1 : i, 0, entry);
    } else {
        const j = targetGroup.loras.indexOf(t.entry);
        if (j < 0) return;
        targetGroup.loras.splice(after ? j + 1 : j, 0, entry);
    }
}
function appendRowToGroup(node, fromName, gi) {
    const src = findRow(node, fromName);
    const g = node.__wm2Stack[gi];
    if (!src || !g || !g.folder || src.gi === gi) return;
    const entry = src.entry;
    removeRow(node, fromName);
    g.loras.push(entry);
}
// rawIdx 按「删除前」口径给出
function moveGroup(node, from, rawIdx) {
    const g = node.__wm2Stack[from];
    if (!g) return;
    node.__wm2Stack.splice(from, 1);
    const idx = rawIdx > from ? rawIdx - 1 : rawIdx;
    node.__wm2Stack.splice(Math.max(0, Math.min(node.__wm2Stack.length, idx)), 0, g);
}
function shiftRow(node, name, d) {
    const r = findRow(node, name);
    if (!r) return;
    if (r.gi < 0) {
        const i = node.__wm2Stack.indexOf(r.entry), j = i + d;
        if (j < 0 || j >= node.__wm2Stack.length) return;
        node.__wm2Stack.splice(i, 1); node.__wm2Stack.splice(j, 0, r.entry);
    } else {
        const a = node.__wm2Stack[r.gi].loras, j = r.lj + d;
        if (j < 0 || j >= a.length) return;
        a.splice(r.lj, 1); a.splice(j, 0, r.entry);
    }
}
function uniqueGroupName(node) {
    const names = new Set((node.__wm2Stack || []).filter((e) => e.folder).map((e) => e.folder));
    let i = 1;
    while (names.has(`配方 ${i}`)) i += 1;
    return `配方 ${i}`;
}
const rowFull = (node) => allRows(node).length >= MAX_ROWS;

//==============================================================================
// 样式：--wm-lo-* 双主题令牌（浅色默认，html.dark-theme 覆盖）
//==============================================================================
let _styleInjected = false;
export function injectStyle() {
    if (_styleInjected) return;
    _styleInjected = true;
    const s = document.createElement("style");
    s.id = "wm-lora-v2-style";
    s.textContent = `
.wm2-container, .wm2-ac, .wm2-modal, .wm2-pv {
  --wm-lo-brand:#534AB7; --wm-lo-accent:#4a41a8; --wm-lo-accent-soft:rgba(83,74,183,.14);
  --wm-lo-param:#534AB7;
  --wm-lo-panel:#ffffff; --wm-lo-panel2:#f7f7fa; --wm-lo-field:#f0f0f4;
  --wm-lo-row:#E9EAF5;
  --wm-lo-fg:#14141a; --wm-lo-dim:#55555f;
  --wm-lo-line:#cfcfd8; --wm-lo-line2:#b4b4c0;
  --wm-lo-danger:#b3261e; --wm-lo-warn:#8a5a12;
  --wm-lo-grpbg:#eaecf7; --wm-lo-grphead:linear-gradient(90deg, rgba(83,74,183,.16), rgba(83,74,183,.04));
  --wm-lo-fill:rgba(83,74,183,.22); --wm-lo-sel:rgba(83,74,183,.15);
  --wm-lo-shadow:0 10px 30px rgba(30,30,60,.18);
}
html.dark-theme .wm2-container, html.dark-theme .wm2-ac,
html.dark-theme .wm2-modal, html.dark-theme .wm2-pv {
  --wm-lo-brand:#6f63d8; --wm-lo-accent:#9b8af5; --wm-lo-accent-soft:rgba(155,138,245,.22);
  --wm-lo-param:#9b8af5;
  --wm-lo-panel:#2f2f33; --wm-lo-panel2:#2c2c2e; --wm-lo-field:#212123;
  --wm-lo-row:#272630;
  --wm-lo-fg:#ececee; --wm-lo-dim:#9a9aa2;
  --wm-lo-line:#424246; --wm-lo-line2:#4e4e54;
  --wm-lo-danger:#e57373; --wm-lo-warn:#e0a94a;
  --wm-lo-grpbg:#2b2a36; --wm-lo-grphead:linear-gradient(90deg, rgba(155,138,245,.20), rgba(155,138,245,.05));
  --wm-lo-fill:rgba(155,138,245,.26); --wm-lo-sel:rgba(155,138,245,.18);
  --wm-lo-shadow:0 14px 40px rgba(0,0,0,.5);
}

/* 容器：JS 按节点实际高度改写 inline height（见 lockBottomBar），差值由 flex:1 的列表吸收 */
.wm2-container { display:flex; flex-direction:column; gap:7px; font-size:12px; height:${UI_H}px; box-sizing:border-box; }

/* ---- 搜索即添加 ---- */
.wm2-search { position:relative; box-sizing:border-box; display:flex; align-items:center; gap:7px; height:32px; flex:none;
  background:var(--wm-lo-field); border:1px solid var(--wm-lo-line2); border-radius:8px; padding:0 8px;
  transition:border-color .12s, box-shadow .12s; }
.wm2-search.focus { border-color:var(--wm-lo-accent); box-shadow:0 0 0 2px var(--wm-lo-accent-soft); }
.wm2-search .mag { flex:none; color:var(--wm-lo-dim); display:inline-flex; }
.wm2-search input { flex:1; min-width:0; background:none; border:none; outline:none; color:var(--wm-lo-fg);
  font-size:12.5px; font-family:inherit; height:100%; }
.wm2-search input::placeholder { color:var(--wm-lo-dim); font-style:italic; opacity:.85; }
.wm2-search .kbd { flex:none; font-size:10px; color:var(--wm-lo-dim); border:1px solid var(--wm-lo-line);
  border-radius:4px; padding:1px 5px; background:var(--wm-lo-panel); }
.wm2-search .clr { flex:none; width:18px; height:18px; display:none; align-items:center; justify-content:center;
  border-radius:5px; cursor:pointer; color:var(--wm-lo-dim); border:none; background:none; font-size:12px; }
.wm2-search.has-q .clr { display:inline-flex; }
.wm2-search .clr:hover { background:var(--wm-lo-accent-soft); color:var(--wm-lo-accent); }

/* 候选下拉（挂 body，fixed 定位，不受节点裁剪） */
.wm2-ac { position:fixed; z-index:100012; display:none; width:360px; max-height:246px; overflow:auto;
  box-sizing:border-box;   /* 否则 positionAc 给的 border-box 宽度会被 padding+border 再加 10px，下拉比节点宽 */
  background:var(--wm-lo-panel); border:1px solid var(--wm-lo-line2); border-radius:9px;
  box-shadow:var(--wm-lo-shadow); padding:4px; font-size:12px; scrollbar-width:thin; }
.wm2-ac.open { display:block; }
.wm2-ac .fold { font-size:10.5px; color:var(--wm-lo-dim); padding:5px 7px 3px; letter-spacing:.4px;
  display:flex; align-items:center; gap:5px; }
.wm2-ac .fold::after { content:''; flex:1; height:1px; background:var(--wm-lo-line); }
.wm2-ac .it { display:flex; align-items:center; gap:7px; padding:5px 7px; border-radius:6px; cursor:pointer; }
.wm2-ac .it .th { flex:none; width:22px; height:22px; border-radius:5px; display:inline-flex; align-items:center;
  justify-content:center; font-size:9.5px; color:#dcd6ff; background:linear-gradient(135deg,#4a4380,#7a6cc0); overflow:hidden; }
.wm2-ac .it .th img { width:100%; height:100%; object-fit:cover; display:block; }
.wm2-ac .it .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--wm-lo-fg); }
.wm2-ac .it .nm mark { background:none; color:var(--wm-lo-accent); font-weight:700; }
.wm2-ac .it.hi { background:var(--wm-lo-accent-soft); }
.wm2-ac .it.hi .nm { color:var(--wm-lo-accent); font-weight:600; }
.wm2-ac .foot { display:flex; gap:10px; padding:5px 8px 3px; font-size:10px; color:var(--wm-lo-dim);
  border-top:1px solid var(--wm-lo-line); margin-top:3px; }
.wm2-ac .none { padding:10px; color:var(--wm-lo-dim); font-style:italic; }

/* ---- 列表：固定高度 + 内滚动（节点高度与条目数解耦的关键） ---- */
.wm2-list { flex:1 1 auto; min-height:0; box-sizing:border-box; height:${LIST_H}px; overflow-y:auto; overflow-x:hidden;
  background:var(--wm-lo-panel2); border:1px solid var(--wm-lo-line); border-radius:9px; padding:0 5px 5px;
  display:flex; flex-direction:column; gap:4px;
  scrollbar-width:thin; scrollbar-color:var(--wm-lo-line2) transparent; }
/* 列表是 flex column，子项必须 flex:none，否则配方组会被压扁裁切、滚不到底 */
.wm2-list > * { flex:none; }
.wm2-list::-webkit-scrollbar { width:10px; }
.wm2-list::-webkit-scrollbar-thumb { background:var(--wm-lo-line2); border-radius:5px; border:2px solid transparent; background-clip:padding-box; }
.wm2-list::-webkit-scrollbar-thumb:hover { background:var(--wm-lo-accent); background-clip:padding-box; }
.wm2-list::-webkit-scrollbar-track { background:transparent; }
.wm2-empty { text-align:center; padding:26px 8px; color:var(--wm-lo-dim); font-size:12px; font-style:italic; line-height:1.7; }
.wm2-empty b { color:var(--wm-lo-accent); font-style:normal; }

/* 表头 sticky：上边距写在表头自身并用负 margin 左右撑满，否则滚动内容会从上方缝隙露出来 */
.wm2-lhead { position:sticky; top:0; z-index:5; display:flex; align-items:center; gap:8px;
  margin:0 -5px; padding:5px 11px 7px; border-bottom:1px solid var(--wm-lo-line);
  background:var(--wm-lo-panel2); cursor:ew-resize; user-select:none; }
.wm2-lhead .tallob { display:inline-flex; align-items:center; gap:6px; font-size:11px; color:var(--wm-lo-dim); cursor:pointer; }
.wm2-lhead .act { font-size:10.5px; color:var(--wm-lo-accent); font-weight:700; font-variant-numeric:tabular-nums; }
.wm2-lhead .miss { font-size:10.5px; color:var(--wm-lo-danger); font-weight:700; }
.wm2-lhead .slabel { margin-left:auto; display:inline-flex; align-items:center; gap:5px; font-size:11px; color:var(--wm-lo-dim); }
.wm2-lhead .hint { opacity:.45; font-size:11px; transition:opacity .15s; }
.wm2-lhead:hover .hint { opacity:1; }

/* 方形对号勾选框 */
.wm2-tgl { flex:none; width:15px; height:15px; border-radius:4px; border:1.5px solid var(--wm-lo-line2);
  background:var(--wm-lo-field); position:relative; cursor:pointer; transition:background .12s, border-color .12s; }
.wm2-tgl:hover { border-color:var(--wm-lo-accent); }
.wm2-tgl.on { background:var(--wm-lo-brand); border-color:var(--wm-lo-brand); }
.wm2-tgl.on::after { content:''; position:absolute; left:4px; top:1px; width:4px; height:8px;
  border:solid #fff; border-width:0 2px 2px 0; transform:rotate(45deg); }

/* 卡片 = .wm2-wrap（行 + 展开的 tag 条），描边由它统一画，tag 展开时也会整块圈住 */
.wm2-wrap { display:flex; flex-direction:column; border:1px solid transparent; border-radius:7px;
  overflow:hidden; transition:border-color .12s; }
.wm2-wrap:hover { border-color:var(--wm-lo-line); }
.wm2-wrap.sel { border-color:var(--wm-lo-accent); }
.wm2-wrap.miss { border-color:rgba(179,38,30,.45); }
.wm2-row { display:flex; align-items:center; gap:6px; background:var(--wm-lo-panel);
  padding:4px 6px;
  transition:background .12s, opacity .15s; }
.wm2-row:not(.off) { background:var(--wm-lo-row); }
.wm2-row.off { opacity:.52; }
.wm2-row.sel { background:var(--wm-lo-sel); }
.wm2-row.miss { background:rgba(179,38,30,.10); }
.wm2-row.miss .wm2-name { color:var(--wm-lo-danger); }
.wm2-row.drag { opacity:.3; }
.wm2-row.over-top { box-shadow:inset 0 2px 0 0 var(--wm-lo-accent); }
.wm2-row.over-bot { box-shadow:inset 0 -2px 0 0 var(--wm-lo-accent); }

/* 拖拽手柄：行只能从这里拖（整行可拖会抢走强度框的横向拖动） */
.wm2-grip { flex:none; width:15px; height:22px; display:inline-flex; align-items:center; justify-content:center;
  margin:0 -2px; color:var(--wm-lo-dim); opacity:.38; cursor:grab; border-radius:4px;
  transition:opacity .12s, color .12s, background .12s; }
.wm2-wrap:hover .wm2-grip { opacity:.9; }
.wm2-grip:hover { color:var(--wm-lo-accent); background:var(--wm-lo-accent-soft); opacity:1; }
.wm2-grip:active { cursor:grabbing; }
.wm2-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--wm-lo-fg); font-size:12px; line-height:20px; cursor:pointer; text-align:left; }
.wm2-name:hover { color:var(--wm-lo-accent); text-decoration:underline; text-underline-offset:2px; }
.wm2-name .ext { color:var(--wm-lo-dim); font-size:10.5px; }
.wm2-name.miss .ext { color:var(--wm-lo-danger); opacity:.8; }

.wm2-sv { flex:none; width:46px; height:21px; text-align:center; font-size:11.5px; font-weight:700;
  font-variant-numeric:tabular-nums; color:var(--wm-lo-fg); border:1px solid var(--wm-lo-line2);
  border-radius:5px; outline:none; cursor:ew-resize; font-family:inherit; padding:0 3px; transition:border-color .12s;
  background:linear-gradient(var(--wm-lo-fill), var(--wm-lo-fill)) no-repeat 0 0 / var(--v,0%) 100%;
  -moz-appearance:textfield; appearance:textfield; }
.wm2-sv::-webkit-outer-spin-button, .wm2-sv::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
.wm2-sv:hover { border-color:var(--wm-lo-accent); }
.wm2-sv:focus { border-color:var(--wm-lo-accent); box-shadow:0 0 0 2px var(--wm-lo-accent-soft); background-color:var(--wm-lo-field); }
.wm2-sv.rangeout { border-color:var(--wm-lo-warn); color:var(--wm-lo-warn); }
.wm2-row.off .wm2-sv { --wm-lo-fill:transparent; color:var(--wm-lo-dim); font-weight:500; }

.wm2-ico { flex:none; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center;
  border:none; background:none; border-radius:4px; cursor:pointer; color:var(--wm-lo-dim); transition:background .12s, color .12s;
  padding:0; box-sizing:border-box; line-height:1; font-size:12px; }   /* 浏览器给 button 的默认 padding 会把内芯挤扁（实测 17→8px）；line-height:1 让文字型 ✕ 也居中 */
.wm2-ico:hover { background:var(--wm-lo-accent-soft); color:var(--wm-lo-accent); }
/* tag / 删除这类小按钮：外框固定 20×20，内芯 15×15 */
.wm2-ico > svg { width:15px; height:15px; display:block; flex:none; }
.wm2-ico.tag-has { color:var(--wm-lo-param); background:var(--wm-lo-accent-soft); }
.wm2-ico.tag-none { color:var(--wm-lo-dim); opacity:.5; }
.wm2-ico.del:hover { background:rgba(179,38,30,.14); color:var(--wm-lo-danger); }

/* tag 输入条是所在卡片的下半部分：底色跟行一致（勾选=--wm-lo-row，未勾选=--wm-lo-panel） */
.wm2-tagedit { display:none; align-items:center; gap:6px; padding:4px 6px 4px 27px; margin:-2px 0 0;
  background:var(--wm-lo-row); }
.wm2-wrap.tagedit-open .wm2-tagedit { display:flex; }
.wm2-wrap.off .wm2-tagedit { background:var(--wm-lo-panel); }
.wm2-tagedit .key { flex:none; font-size:9.5px; font-weight:700; letter-spacing:.5px; color:var(--wm-lo-accent);
  border:1px solid var(--wm-lo-accent); border-radius:4px; padding:1px 4px; opacity:.8; }
.wm2-tagedit input { flex:1; min-width:0; background:var(--wm-lo-field); border:1px solid var(--wm-lo-line2);
  border-radius:5px; padding:3px 6px; color:var(--wm-lo-fg); font-size:11.5px; outline:none; font-family:inherit; }
.wm2-tagedit input:focus { border-color:var(--wm-lo-accent); }

/* 配方组 */
.wm2-grp { border:1px solid var(--wm-lo-line); border-radius:8px; overflow:hidden; background:var(--wm-lo-grpbg); }
.wm2-grp.off { opacity:.52; }
.wm2-grp.over { border-color:var(--wm-lo-accent); box-shadow:0 0 0 2px var(--wm-lo-accent-soft); }
.wm2-grp.drag { opacity:.35; }
.wm2-grp.over-top { box-shadow:inset 0 3px 0 0 var(--wm-lo-accent); }
.wm2-grp.over-bot { box-shadow:inset 0 -3px 0 0 var(--wm-lo-accent); }
.wm2-gh { display:flex; align-items:center; gap:6px; padding:5px 7px; background:var(--wm-lo-grphead);
  cursor:grab; user-select:none; }
.wm2-gh:active { cursor:grabbing; }
/* 折叠箭头做成 20×20 的按钮盒，整块都是命中区；只点那根细线太难瞄 */
.wm2-gh .chev { flex:none; width:20px; height:20px; color:var(--wm-lo-accent); display:inline-flex;
  align-items:center; justify-content:center; border-radius:6px; transition:background .14s, transform .15s; }
.wm2-gh .chev:hover { background:var(--wm-lo-accent-soft); }
.wm2-grp.closed .wm2-gh .chev { transform:rotate(-90deg); }
.wm2-gh .fic { flex:none; color:var(--wm-lo-accent); display:inline-flex; }
.wm2-gname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-weight:600; font-size:12px; color:var(--wm-lo-fg); }
.wm2-gcnt { flex:none; background:var(--wm-lo-accent-soft); color:var(--wm-lo-accent); border-radius:999px;
  padding:0 7px; font-size:10px; line-height:15px; font-weight:700; }
.wm2-gbody { padding:5px 5px 6px; display:flex; flex-direction:column; gap:4px; }
.wm2-grp.closed .wm2-gbody { display:none; }
/* 空配方：给一块明显的落区，拖 LoRA 进来或点 Add LoRA */
.wm2-grp.empty .wm2-gbody { min-height:62px; justify-content:center; align-items:stretch;
  border:1px dashed var(--wm-lo-line2); border-radius:7px; margin:0 1px 1px; background:var(--wm-lo-panel2); }
.wm2-grp.empty .wm2-gadd { align-self:center; }
.wm2-ghint { text-align:center; font-size:10.5px; color:var(--wm-lo-dim); font-style:italic; line-height:1.6; }
.wm2-gadd { align-self:flex-start; display:inline-flex; align-items:center; gap:4px; background:none;
  border:1px dashed var(--wm-lo-line2); border-radius:6px; color:var(--wm-lo-dim); font-size:11px;
  padding:3px 8px; cursor:pointer; font-family:inherit; }
.wm2-gadd:hover { color:var(--wm-lo-accent); border-color:var(--wm-lo-accent); background:var(--wm-lo-accent-soft); }
.wm2-rename { flex:1; min-width:0; background:var(--wm-lo-field); border:1px solid var(--wm-lo-accent);
  border-radius:5px; padding:2px 6px; color:var(--wm-lo-fg); font-size:12px; font-weight:600; outline:none; font-family:inherit; }

/* 提示条（重名 / 上限 / 已添加 N 个）：出现时列表自动让出高度，节点尺寸不变。
   默认同系紫（--wm-lo-param），红色只留给真正的失败（.err 变体）。 */
.wm2-warn { display:none; flex:none; font-size:11px; color:var(--wm-lo-param);
  background:var(--wm-lo-accent-soft); border:1px solid var(--wm-lo-accent-soft);
  border-radius:6px; padding:4px 7px; }
.wm2-warn.err { color:var(--wm-lo-danger); }
.wm2-warn.on { display:block; }

/* 底部操作条：左正方形图标按钮 + 右 Add LoRA（两个按钮边框样式保持一致） */
.wm2-addrow { display:flex; gap:6px; align-items:stretch; flex:none; height:31px; }
.wm2-grpbtn { flex:none; width:32px; display:inline-flex; align-items:center; justify-content:center;
  background:var(--wm-lo-field); border:1px solid var(--wm-lo-accent); border-radius:7px;
  color:var(--wm-lo-accent); cursor:pointer; padding:0; }
.wm2-grpbtn:hover { background:var(--wm-lo-accent-soft); }
.wm2-addbtn { flex:1; min-width:0; border-radius:7px; cursor:pointer; font-size:12px; font-weight:600;
  font-family:inherit; background:var(--wm-lo-field); color:var(--wm-lo-accent);
  border:1px solid var(--wm-lo-accent); display:inline-flex; align-items:center; justify-content:center; gap:5px; }
.wm2-addbtn:hover { background:var(--wm-lo-accent-soft); }

/* 浏览弹窗 */
.wm2-bd { position:fixed; inset:0; z-index:100013; background:rgba(0,0,0,.55);
  display:none; align-items:center; justify-content:center; padding:20px; }
.wm2-bd.open { display:flex; }
.wm2-modal { width:560px; max-width:100%; max-height:80vh; display:flex; flex-direction:column; gap:10px;
  background:var(--wm-lo-panel); border:1px solid var(--wm-lo-line2); border-radius:12px;
  padding:14px; box-shadow:var(--wm-lo-shadow); color:var(--wm-lo-fg); }
.wm2-modal h4 { margin:0; font-size:13px; font-weight:700; display:flex; align-items:center; gap:8px; }
/* 关闭按钮：外框固定 22×22，× 用 flex 居中 + line-height:1（文字行框不对称，默认会偏下） */
.wm2-modal h4 .x { margin-left:auto; flex:none; width:22px; height:22px; border-radius:6px; line-height:1;
  display:inline-flex; align-items:center; justify-content:center; cursor:pointer; color:var(--wm-lo-dim); font-size:13px; }
.wm2-modal h4 .x:hover { color:var(--wm-lo-danger); background:rgba(179,38,30,.12); }
.wm2-msearch { display:flex; align-items:center; gap:8px; background:var(--wm-lo-field);
  border:1px solid var(--wm-lo-line2); border-radius:8px; padding:6px 9px; color:var(--wm-lo-dim); }
.wm2-msearch input { flex:1; min-width:0; background:none; border:none; outline:none; color:var(--wm-lo-fg);
  font-size:12.5px; font-family:inherit; }
.wm2-mbody { display:flex; gap:10px; min-height:0; flex:1; }
.wm2-mside { flex:0 0 150px; display:flex; flex-direction:column; gap:2px; overflow:auto; scrollbar-width:thin; }
.wm2-mside .f { padding:5px 9px; border-radius:7px; font-size:12px; color:var(--wm-lo-fg); cursor:pointer;
  display:flex; align-items:center; gap:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.wm2-mside .f .n { margin-left:auto; font-size:10.5px; color:var(--wm-lo-dim); flex:none; }
/* 长目录名：图标/箭头/计数锁死不缩，名称（.lbl）自己截断省略 */
.wm2-mside .f svg { flex:none; }
.wm2-mside .f .lbl { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.wm2-mside .f:hover { background:var(--wm-lo-accent-soft); }
.wm2-mside .f.on { background:var(--wm-lo-accent-soft); color:var(--wm-lo-accent); font-weight:600; }
/* 层级树折叠箭头 */
.wm2-mside .f .chev { flex:none; color:var(--wm-lo-dim); display:inline-flex; transition:transform .15s; }
.wm2-mside .f.open .chev { transform:rotate(90deg); }
.wm2-mlist { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; overflow:auto;
  border-left:1px solid var(--wm-lo-line); padding-left:10px; scrollbar-width:thin; }
.wm2-mit { display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:7px; cursor:pointer;
  border:1px solid transparent; }
.wm2-mit:hover { background:var(--wm-lo-accent-soft); }
.wm2-mit.on { background:var(--wm-lo-sel); border-color:var(--wm-lo-accent); }
.wm2-mit.used { opacity:.45; cursor:default; }
.wm2-mit .th { flex:none; width:26px; height:26px; border-radius:6px; overflow:hidden; display:inline-flex;
  align-items:center; justify-content:center; font-size:10px; color:#dcd6ff; background:linear-gradient(135deg,#4a4380,#7a6cc0); }
.wm2-mit .th img { width:100%; height:100%; object-fit:cover; }
.wm2-mit .nm { flex:1; min-width:0; }
.wm2-mit .nm .t { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; color:var(--wm-lo-fg); }
.wm2-mit .tagu { flex:none; font-size:10px; color:var(--wm-lo-accent); background:var(--wm-lo-accent-soft);
  border-radius:999px; padding:1px 7px; font-weight:600; }

/* ---- 视图切换 + 缩略图网格模式（设计稿：design/lorastack_grid_modal.html） ---- */
.wm2-modal.wide { width:760px; }
/* 网格模式：弹窗高度锁死 80vh，溢出全部交给网格内部滚动条，外层绝不滚动 */
.wm2-modal.gridmode { height:80vh; overflow:hidden; }
.wm2-vsw { margin-left:auto; flex:none; display:flex; gap:2px; background:var(--wm-lo-field);
  border:1px solid var(--wm-lo-line); border-radius:7px; padding:2px; }
.wm2-vsw button { width:26px; height:22px; border:none; background:none; border-radius:5px;
  color:var(--wm-lo-dim); cursor:pointer; display:inline-flex; align-items:center;
  justify-content:center; padding:0; }
.wm2-vsw button.on { background:var(--wm-lo-panel); color:var(--wm-lo-accent);
  box-shadow:0 1px 3px rgba(0,0,0,.14); }
.wm2-mgrid { flex:1; min-width:0; min-height:0; display:flex; flex-direction:column; gap:8px;
  border-left:1px solid var(--wm-lo-line); padding-left:10px; }
.wm2-ginfo { flex:none; font-size:11.5px; color:var(--wm-lo-dim); }
.wm2-ginfo b { color:var(--wm-lo-accent); font-weight:600; }
/* 固定 4 列等宽 + 固定行高 230px：卡片尺寸恒定（不依赖 aspect-ratio，部分前端不生效），
   高度 = 弹窗剩余空间，排不完的走内部滚动条 */
.wm2-grid { flex:1; min-height:0; display:grid; grid-template-columns:repeat(4,1fr); grid-auto-rows:230px; gap:10px;
  overflow:auto; padding:2px 4px 6px 2px; scrollbar-width:thin; align-content:start; }
.wm2-grid::-webkit-scrollbar { width:6px; }
.wm2-grid::-webkit-scrollbar-thumb { background:var(--wm-lo-line2); border-radius:3px; }
.wm2-grid::-webkit-scrollbar-thumb:hover { background:var(--wm-lo-accent); }
/* 卡片：上图下名（列方向 flex，图区吃掉行高剩余），右上角勾选圈（悬停浮现、选中实心紫） */
.wm2-card { position:relative; border-radius:10px; overflow:hidden; cursor:pointer;
  display:flex; flex-direction:column;
  background:var(--wm-lo-panel2); border:1.5px solid var(--wm-lo-line);
  transition:border-color .12s, box-shadow .12s; }
.wm2-card:hover { border-color:var(--wm-lo-accent); box-shadow:0 3px 12px rgba(30,30,60,.16); }
.wm2-card .im { flex:1; min-height:0; background:linear-gradient(135deg,#4a4380,#7a6cc0);
  position:relative; overflow:hidden; display:flex; align-items:center; justify-content:center;
  color:#dcd6ff; font-size:13px; font-weight:600; }
.wm2-card .im img { width:100%; height:100%; object-fit:cover; display:block; }
.wm2-card .cap { flex:none; padding:6px 8px 7px; border-top:1px solid var(--wm-lo-line); background:var(--wm-lo-panel); }
.wm2-card .cap .t { display:block; font-size:11.5px; line-height:15px; color:var(--wm-lo-fg);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wm2-card .cap .d { display:block; font-size:10px; line-height:14px; color:var(--wm-lo-dim);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:1px; }
.wm2-card .chk { position:absolute; right:6px; top:6px; z-index:2; width:21px; height:21px;
  border-radius:50%; border:1.5px solid rgba(255,255,255,.85); background:rgba(20,20,26,.35);
  opacity:0; transition:opacity .12s, background .12s, border-color .12s;
  display:inline-flex; align-items:center; justify-content:center; }
.wm2-card:hover .chk { opacity:1; }
.wm2-card .chk svg { width:12px; height:12px; color:#fff; opacity:0; transform:scale(.6);
  transition:opacity .12s, transform .14s cubic-bezier(.34,1.56,.64,1); }
.wm2-card.sel { border-color:var(--wm-lo-accent); box-shadow:0 0 0 2px var(--wm-lo-accent-soft); }
.wm2-card.sel .chk { opacity:1; background:var(--wm-lo-brand); border-color:var(--wm-lo-brand); }
.wm2-card.sel .chk svg { opacity:1; transform:scale(1); }
/* 角标（当前 / 外面已有 / 组内已有…）：左上胶囊，压在图上 */
.wm2-card .tagu { position:absolute; left:6px; top:6px; z-index:2; font-size:9.5px; color:#fff;
  background:rgba(20,20,26,.55); border-radius:999px; padding:1.5px 7px; font-weight:600; }
.wm2-mfoot .hint { font-size:11px; color:var(--wm-lo-dim); font-style:italic; }
.wm2-mfoot { display:flex; align-items:center; gap:9px; }
.wm2-mfoot .cnt { font-size:11.5px; color:var(--wm-lo-dim); }
.wm2-mfoot .sp { flex:1; }
.wm2-mfoot button { padding:6px 18px; border-radius:7px; cursor:pointer; font-size:12.5px; font-family:inherit;
  background:none; color:var(--wm-lo-fg); border:1px solid var(--wm-lo-line2); }
.wm2-mfoot button.ok { background:var(--wm-lo-brand); border-color:var(--wm-lo-brand); color:#fff; font-weight:600; }
.wm2-mfoot button:disabled { opacity:.45; cursor:default; }

/* 悬浮预览：只有一张图（3:4），不带文件名/路径等任何文字。
   图没加载成功前不显示，避免弹出一块空黑框。 */
.wm2-pv { position:fixed; z-index:100014; display:none; width:${PV_W}px; pointer-events:none; }  /* 现在会盖在列表上，必须穿透，否则抢走 hover 会一直闪 */
.wm2-pv.open { display:block; }
.wm2-pv .img { width:${PV_W}px; height:${PV_H}px; border-radius:10px; overflow:hidden;
  box-shadow:var(--wm-lo-shadow); background:#101014; }
.wm2-pv .img img { width:100%; height:100%; object-fit:cover; display:block; }
`;
    document.head.append(s);
}

//==============================================================================
// 图标
//==============================================================================
export const IC = {
    grip: `<svg width="9" height="15" viewBox="0 0 9 15" fill="currentColor"><circle cx="2" cy="2" r="1.4"/><circle cx="7" cy="2" r="1.4"/><circle cx="2" cy="7.5" r="1.4"/><circle cx="7" cy="7.5" r="1.4"/><circle cx="2" cy="13" r="1.4"/><circle cx="7" cy="13" r="1.4"/></svg>`,
    chev: `<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2.5 4.5 L6 8 L9.5 4.5"/></svg>`,
    folder: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>`,
    folderPlus: `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4.5a1.5 1.5 0 0 1 1.5-1.5h3l1.6 1.8h5.4a1.5 1.5 0 0 1 1.5 1.5v5.7a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M8 7.4v3.2M6.4 9h3.2"/></svg>`,
    tag: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><circle cx="7" cy="7" r="1.6"/></svg>`,
    mag: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
};

//==============================================================================
// body 级浮层：候选下拉 / 悬停预览（单例）
//==============================================================================
let _ac = null, _acNode = null, _acItems = [], _acIdx = 0;
function getAc() {
    if (!_ac) {
        _ac = document.createElement("div");
        _ac.className = "wm2-ac";
// 只拦 .it 的默认行为：保住焦点方便连续添加，同时不吃掉滚动条
        _ac.addEventListener("mousedown", (e) => { if (e.target.closest(".it")) e.preventDefault(); });
        _ac.addEventListener("click", (e) => {
            const it = e.target.closest(".it");
            if (!it || !_acNode) return;
            pickAcItem(_acNode, it.dataset.p);
        });
        // 鼠标划过候选项 = 高亮那条（和 ↑↓ 的视觉保持一致）
        _ac.addEventListener("mouseover", (e) => {
            const it = e.target.closest(".it");
            if (!it) return;
            _ac.querySelectorAll(".it.hi").forEach((x) => x.classList.remove("hi"));
            it.classList.add("hi");
        });
        document.body.append(_ac);
    }
    return _ac;
}
function closeAc() {
    if (_ac) _ac.classList.remove("open");
    _acNode = null;
}
// 下拉只重新贴合、绝不关闭；宽度和缩放跟着节点走
function positionAc() {
    if (!_ac || !_acNode) return;
    const anchor = _acNode.__wm2Search || _acNode.__wm2SearchInput;
    if (!anchor?.getBoundingClientRect) return;
    const r = anchor.getBoundingClientRect();
    const k = canvasScale(_acNode) || 1;
    const cont = _acNode.__wm2Container;
    let w = NaN;
    if (cont) w = cont.getBoundingClientRect().width / k;          // 逻辑宽度 = 节点内部宽度
    if (!Number.isFinite(w) || w < 160) w = Math.max(240, Math.round(r.width / k));
    _ac.style.width = Math.round(w) + "px";
    _ac.style.transform = `scale(${k})`;
    _ac.style.transformOrigin = "top left";
    _ac.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 40)) + "px";
    _ac.style.top = r.bottom + 5 * k + "px";
}
function acMatches(node) {
    const kw = (node.__wm2Kw || "").trim().toLowerCase();
    const used = usedTopPaths(node);      // 只屏蔽顶层已有的；配方里用过的照样能快添到外面
    let items = (node.__wm2All || []).filter((p) => !used.has(norm(p)));
    if (kw) items = items.filter((p) => norm(p).toLowerCase().includes(kw) || stemOf(baseOf(p)).toLowerCase().includes(kw));
    const folds = new Map();
    items.forEach((p) => { const d = dirOf(p); if (!folds.has(d)) folds.set(d, []); folds.get(d).push(p); });
    return [...folds.entries()];
}
export function hlName(name, kw) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (!kw) return esc(name);
    const i = name.toLowerCase().indexOf(kw.toLowerCase());
    if (i < 0) return esc(name);
    return esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + kw.length)) + "</mark>" + esc(name.slice(i + kw.length));
}
function renderAc(node, anchor) {
    const ac = getAc();
    _acNode = node;
    const kw = (node.__wm2Kw || "").trim();
    const groups = acMatches(node);
    _acItems = [];
    let html = "";
    groups.forEach(([f, list]) => {
        html += `<div class="fold">${IC.folder} ${f ? f.replace(/&/g, "&amp;") : "根目录"}</div>`;
        list.forEach((p) => {
            if (_acItems.length >= 20) return;
            const idx = _acItems.push(p) - 1;
            html += `<div class="it${idx === _acIdx ? " hi" : ""}" data-p="${p.replace(/"/g, "&quot;")}">
              <span class="th">${stemOf(baseOf(p)).slice(0, 2).toUpperCase()}</span>
              <span class="nm">${hlName(stemOf(baseOf(p)), kw)}</span>
            </div>`;
        });
    });
    if (!_acItems.length) html = `<div class="none">${node.__wm2Kw ? "无匹配结果（已添加的不再出现）" : "库里没有可选的 LoRA"}</div>`;
    else html += `<div class="foot"><span>↑↓ 选择</span><span>Enter 添加</span><span>Esc 收起</span><span style="margin-left:auto">最多 20 条</span></div>`;
    ac.innerHTML = html;
    positionAc();
    ac.classList.add("open");
}
function acMove(d) {
    if (!_acItems.length) return;
    _acIdx = Math.max(0, Math.min(_acIdx + d, _acItems.length - 1));
    if (_acNode) renderAc(_acNode, _acNode.__wm2SearchInput);
}
// 从候选里选定一条：清搜索框 → 加行 → 收起下拉
function pickAcItem(node, path) {
    if (!path) return;
    node.__wm2Kw = "";
    if (node.__wm2SearchInput) node.__wm2SearchInput.value = "";
    node.__wm2Search?.classList.remove("has-q");
    addEntry(node, path, -1);
    closeAc();
}

// 悬停预览：只有图片本体，加载成功才弹出；鼠标移走立即取消（含还在加载中的那张）
let _tagCache = new Map();        // path → trainedWords，tag 自动填充/回填用
let _pv = null, _pvTimer = null, _pvToken = 0;
function getPv() {
    if (!_pv) {
        _pv = document.createElement("div");
        _pv.className = "wm2-pv";
        _pv.innerHTML = `<div class="img"></div>`;
        document.body.append(_pv);
    }
    return _pv;
}
function positionPv(anchor) {
    const pv = getPv();
    const r = anchor.getBoundingClientRect();
    const GAP = 10;
// 与行级预览同一套定位；弹窗内整张收进窗口内部
    let left = r.right + GAP;
    const modalEl = anchor.closest(".wm2-modal");
    if (modalEl) {
        const mr = modalEl.getBoundingClientRect();
        const fit = mr.right - PV_W - 8;                     // 能整个塞进弹窗就贴着右内壁
        if (left > fit && fit >= mr.left + 8) left = fit;
        else if (left + PV_W > window.innerWidth - 8) left = r.left - PV_W - GAP;
    } else if (left + PV_W > window.innerWidth - 8) {
        left = r.left - PV_W - GAP;                          // 右边放不下就翻到左边
    }
    left = Math.max(8, Math.min(left, window.innerWidth - PV_W - 8));
    pv.style.left = left + "px";
    pv.style.top = Math.max(8, Math.min(r.top - 10, window.innerHeight - PV_H - 8)) + "px";
}
function showPv(name, anchor) {
    if (!name || !anchor?.getBoundingClientRect) return;
    const token = ++_pvToken;
    const box = document.createElement("img");
    box.onload = () => {
        if (token !== _pvToken) return;            // 等待期间鼠标已经移走
        const pv = getPv();
        const img = pv.querySelector(".img");
        img.innerHTML = "";
        img.append(box);
        positionPv(anchor);
        pv.classList.add("open");
    };
    box.onerror = () => { if (token === _pvToken) hidePv(); };
    box.src = previewUrl(name);
}
function hidePv() {
    clearTimeout(_pvTimer);
    _pvToken += 1;
    if (_pv) _pv.classList.remove("open");
}

//==============================================================================
// 渲染
//==============================================================================
function makeToggle(on, onclick, title) {
    const t = document.createElement("span");
    t.className = "wm2-tgl" + (on ? " on" : "");
    t.title = title || (on ? "已启用" : "已停用");
    t.onclick = (e) => { e.stopPropagation(); onclick(); };
    return t;
}

function makeStrength(node, entry) {
    const inp = document.createElement("input");
    inp.className = "wm2-sv";
    inp.type = "number";
    inp.step = "0.05";
    inp.value = entry.model.toFixed(2);
    const paint = () => {
        inp.value = entry.model.toFixed(2);
        inp.style.setProperty("--v", Math.max(0, Math.min(100, (Math.abs(entry.model) / 2) * 100)) + "%");
    };
    paint();
    // 横向拖动改强度：0.001/px，Shift=×10，Alt=×0.1；4px 阈值内不当作拖动
    inp.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        const sx = ev.clientX, sv = entry.model;
        let moved = false;
        const mv = (m) => {
            const dx = m.clientX - sx;
            if (!moved && Math.abs(dx) < 4) return;
            moved = true;
            const mult = m.shiftKey ? 10 : m.altKey ? 0.1 : 1;
            entry.model = clampStep(Math.max(-10, Math.min(10, sv + dx * 0.001 * mult)));
            paint();
        };
        const up = () => {
            document.removeEventListener("pointermove", mv);
            document.removeEventListener("pointerup", up);
            if (moved) { syncData(node); renderRows(node, true); }
        };
        document.addEventListener("pointermove", mv);
        document.addEventListener("pointerup", up);
    });
    inp.addEventListener("input", () => {
        const v = parseFloat(inp.value);
        if (Number.isFinite(v)) { entry.model = v; syncData(node); paint(); }
    });
    inp.addEventListener("blur", () => {
        let v = parseFloat(inp.value);
        if (!Number.isFinite(v)) v = DEF_STRENGTH;
        entry.model = Math.max(-10, Math.min(10, v));
        syncData(node);
        paint();
    });
    inp.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") inp.blur();
    });
    inp.addEventListener("click", (ev) => ev.stopPropagation());
    inp.title = "横向拖动改强度（Shift 粗调 / Alt 微调）· 点击输入精确值";
    return inp;
}

function makeRow(node, entry, gi) {
    const wrap = document.createElement("div");
    const missing = entry.name && node.__wm2Known && !node.__wm2Known.has(norm(entry.name));
    // 卡片状态同时挂在 wrap 上：描边由 wrap 画，才能把展开的 tag 条一起圈住
    wrap.className = "wm2-wrap" + (entry.on ? "" : " off") + (missing ? " miss" : "") +
        (node.__wm2Sel === norm(entry.name) ? " sel" : "") +
        (node.__wm2TagOpen?.has(norm(entry.name)) ? " tagedit-open" : "");
    wrap.dataset.name = entry.name;

    const row = document.createElement("div");
    row.className = "wm2-row" + (entry.on ? "" : " off") + (missing ? " miss" : "") +
        (node.__wm2Sel === norm(entry.name) ? " sel" : "");
    wrap.append(row);

    // 只有这个手柄能拖：整行可拖会和强度框的横向拖动抢鼠标
    const grip = document.createElement("span");
    grip.className = "wm2-grip";
    grip.innerHTML = IC.grip;
    grip.title = "拖动排序 / 拖进配方";
    grip.draggable = true;
    grip.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        node.__wm2Drag = { kind: "row", name: entry.name };
        node.__wm2Sel = norm(entry.name);
        row.classList.add("drag");
        try { e.dataTransfer.setData("text/plain", `wm2:${node.id}:row`); } catch (err) {}
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setDragImage(row, 16, 12); } catch (err) {}
    });
    grip.addEventListener("dragend", () => { node.__wm2Drag = null; clearMarks(node); renderRows(node, true); });
    row.append(grip);

    row.append(makeToggle(entry.on, () => {
        entry.on = !entry.on;
        syncData(node);
        renderRows(node, true);
    }));

    const name = document.createElement("span");
    name.className = "wm2-name" + (missing ? " miss" : "");
    const stemSpan = document.createElement("span");
    stemSpan.textContent = stemOf(baseOf(entry.name || ""));     // 只显示文件名，不带目录
    name.append(stemSpan);
    const ext = extOf(entry.name || "");
    if (ext) { const s = document.createElement("span"); s.className = "ext"; s.textContent = ext; name.append(s); }
    name.title = (entry.name || "未选择 LoRA") + "\n点击重新选择其他 LoRA";
    // 点名字 = 换这一个 LoRA（弹窗单选，只换路径，强度/tag 保留）
    name.onclick = (e) => {
        e.stopPropagation();
        node.__wm2Sel = norm(entry.name);
        openModal(node, gi, { replace: entry });
    };
    name.addEventListener("mouseenter", () => {
        if (!entry.name) return;
        clearTimeout(_pvTimer);
        _pvTimer = setTimeout(() => showPv(entry.name, name), 400);
    });
    name.addEventListener("mouseleave", hidePv);
    row.append(name);

    row.append(makeStrength(node, entry));

    const tagBtn = document.createElement("button");
    tagBtn.type = "button";
    tagBtn.className = "wm2-ico " + (entry.tag ? "tag-has" : "tag-none");
    tagBtn.innerHTML = IC.tag;
    tagBtn.title = entry.tag ? "编辑 tag：" + entry.tag : "添加 tag";
    tagBtn.onclick = (e) => {
        e.stopPropagation();
        const k = norm(entry.name);
        if (node.__wm2TagOpen.has(k)) node.__wm2TagOpen.delete(k); else node.__wm2TagOpen.add(k);
        // 只做「展开文本框」，不自动抢焦点：想改字自己点进去，避免误触把已有 tag 选瞎
        renderRows(node, true);
    };
    row.append(tagBtn);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "wm2-ico del";
    del.textContent = "✕";
    del.title = "删除";
    del.onclick = (e) => {
        e.stopPropagation();
        removeRow(node, entry.name);
        if (node.__wm2Sel === norm(entry.name)) node.__wm2Sel = null;
        syncData(node);
        renderRows(node, true);
    };
    row.append(del);

    const tagBox = document.createElement("div");
    tagBox.className = "wm2-tagedit";
    const key = document.createElement("span");
    key.className = "key";
    key.textContent = "TAG";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "触发词 / 说明，逗号分隔";
    inp.value = entry.tag || "";
    inp.oninput = () => { entry.tag = inp.value.trim(); syncData(node); tagBtn.className = "wm2-ico " + (entry.tag ? "tag-has" : "tag-none"); tagBtn.title = entry.tag ? "编辑 tag：" + entry.tag : "添加 tag"; };
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") inp.blur(); };
    inp.onblur = () => { node.__wm2TagOpen.delete(norm(entry.name)); renderRows(node, true); };
    tagBox.append(key, inp);
    wrap.append(tagBox);

    // 拖放的落点仍在整行上（手柄拖起来，往哪放看这一行的上下半区）
    row.addEventListener("dragover", (e) => {
        const dg = node.__wm2Drag;
        if (!dg || (dg.kind === "row" && norm(dg.name) === norm(entry.name))) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        clearMarks(node);
        const r = row.getBoundingClientRect();
        row.classList.add(e.clientY > r.top + r.height / 2 ? "over-bot" : "over-top");
    });
    row.addEventListener("drop", (e) => {
        const dg = node.__wm2Drag;
        if (!dg || (dg.kind === "row" && norm(dg.name) === norm(entry.name))) return;
        e.preventDefault(); e.stopPropagation();
        const r = row.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        if (dg.kind === "row") moveRow(node, dg.name, entry.name, after);
        // 组只能插在「顶层行」前后；落在组内行上就忽略（避免拿组内下标当顶层下标）
        else if (dg.kind === "group") {
            const ti = node.__wm2Stack.indexOf(entry);
            if (ti >= 0) moveGroup(node, dg.gi, ti + (after ? 1 : 0));
        }
        clearMarks(node);
        syncData(node);
        renderRows(node, true);
    });

    return wrap;
}

function clearMarks(node) {
    (node.__wm2Container?.querySelectorAll(".over-top,.over-bot,.drag,.over") || []).forEach((x) => {
        x.classList.remove("over-top", "over-bot", "drag", "over");
    });
}

function makeGroup(node, g, gi) {
    const empty = !(g.loras || []).length;
    const grp = document.createElement("div");
    grp.className = "wm2-grp" + (g.on ? "" : " off") + (g.open === false ? " closed" : "") + (empty ? " empty" : "");

    const head = document.createElement("div");
    head.className = "wm2-gh";
    grp.append(head);

    const chev = document.createElement("span");
    chev.className = "chev";
    chev.innerHTML = IC.chev;
    head.append(chev);

    // 整组开关放在最前，与最右的删除按钮隔开，避免误删
    head.append(makeToggle(g.on, () => { g.on = !g.on; syncData(node); renderRows(node, true); }, g.on ? "整组启用" : "整组停用"));

    const fic = document.createElement("span");
    fic.className = "fic";
    fic.innerHTML = IC.folder;
    head.append(fic);

    const gname = document.createElement("span");
    gname.className = "wm2-gname";
    gname.textContent = g.folder;
    gname.title = "双击重命名";
    gname.ondblclick = (e) => {
        e.stopPropagation();
        const inp = document.createElement("input");
        inp.className = "wm2-rename";
        inp.value = g.folder;
        gname.replaceWith(inp);
        head.draggable = false;      // 编辑期间关掉整行拖拽，否则选字会被当成拖拽
        inp.focus(); inp.select();
        const done = () => {
            const v = inp.value.trim();
            if (v) g.folder = v;
            syncData(node);
            renderRows(node, true);
        };
        inp.onblur = () => { head.draggable = true; done(); };
        inp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === "Enter") inp.blur(); };
        inp.onclick = (ev) => ev.stopPropagation();
        inp.ondblclick = (ev) => ev.stopPropagation();
    };
    head.append(gname);

    const nOn = (g.loras || []).filter((l) => l.on).length;
    const cnt = document.createElement("span");
    cnt.className = "wm2-gcnt";
    cnt.textContent = `${nOn}/${(g.loras || []).length}`;
    head.append(cnt);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "wm2-ico del";
    del.textContent = "✕";
    del.title = "删除配方";
    del.onclick = (e) => {
        e.stopPropagation();
        node.__wm2Stack.splice(gi, 1);
        syncData(node);
        renderRows(node, true);
    };
    head.append(del);

    head.onclick = (e) => {
        // 点名字（要双击改名）和点重命名框都不该折叠，否则第一次 click 就把 DOM 换了，dblclick 永远打不中
        if (e.target.closest(".wm2-gname,.wm2-rename")) return;
        g.open = g.open === false;
        syncData(node);
        renderRows(node, true);
    };

    // 整行组头可拖：拖到别的组上/下边缘调顺序，或拖到顶层行前后插入
    head.draggable = true;
    head.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        node.__wm2Drag = { kind: "group", gi };
        grp.classList.add("drag");
        try { e.dataTransfer.setData("text/plain", `wm2:${node.id}:group`); } catch (err) {}
        e.dataTransfer.effectAllowed = "move";
    });
    head.addEventListener("dragend", () => { node.__wm2Drag = null; clearMarks(node); renderRows(node, true); });
    head.addEventListener("dragover", (e) => {
        const dg = node.__wm2Drag;
        if (!dg || (dg.kind === "group" && dg.gi === gi)) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        clearMarks(node);
        grp.classList.add("over");
    });
    head.addEventListener("drop", (e) => {
        const dg = node.__wm2Drag;
        if (!dg) return;
        e.preventDefault(); e.stopPropagation();
        if (dg.kind === "row") appendRowToGroup(node, dg.name, gi);
        else if (dg.kind === "group" && dg.gi !== gi) moveGroup(node, dg.gi, gi + 1);
        clearMarks(node);
        syncData(node);
        renderRows(node, true);
    });

    const body = document.createElement("div");
    body.className = "wm2-gbody";
    grp.append(body);
    (g.loras || []).forEach((l) => body.append(makeRow(node, l, gi)));

    if (empty) {
        const hint = document.createElement("div");
        hint.className = "wm2-ghint";
        hint.textContent = "空配方 · 双击组名可重命名";
        body.append(hint);
    }

    const add = document.createElement("button");
    add.type = "button";
    add.className = "wm2-gadd";
    add.textContent = "＋ Add LoRA";
    add.title = "往这个配方里加 LoRA";
    add.onclick = (e) => { e.stopPropagation(); openModal(node, gi); };
    body.append(add);

    body.addEventListener("dragover", (e) => {
        const dg = node.__wm2Drag;
        if (!dg || dg.kind !== "row") return;
        e.preventDefault(); e.stopPropagation();
        clearMarks(node);
        grp.classList.add("over");
    });
    body.addEventListener("drop", (e) => {
        const dg = node.__wm2Drag;
        if (!dg || dg.kind !== "row") return;
        e.preventDefault(); e.stopPropagation();
        appendRowToGroup(node, dg.name, gi);
        clearMarks(node);
        syncData(node);
        renderRows(node, true);
    });

    return grp;
}

function renderRows(node, keepScroll) {
    const list = node.__wm2List;
    if (!list) return;
    const top = list.scrollTop;
    list.innerHTML = "";

    const head = document.createElement("div");
    head.className = "wm2-lhead";
    const all = allRows(node), act = activeRows(node);
    const allOn = all.length > 0 && act.length === all.length;
    const tallob = document.createElement("span");
    tallob.className = "tallob";
    tallob.append(makeToggle(allOn, () => {
        const turnOn = !allOn;
        all.forEach((r) => { r.entry.on = turnOn; });
        (node.__wm2Stack || []).forEach((e) => { if (e.folder) e.on = turnOn; });
        syncData(node);
        renderRows(node, true);
    }, allOn ? "全部停用" : "全部启用"));
    const t = document.createElement("span");
    t.textContent = "Toggle All";
    tallob.append(t);
    tallob.onclick = (e) => e.stopPropagation();
    head.append(tallob);

    const cnt = document.createElement("span");
    cnt.className = "act";
    cnt.textContent = `${act.length}/${all.length}`;
    head.append(cnt);

    const missCount = all.filter((r) => r.entry.name && node.__wm2Known && !node.__wm2Known.has(norm(r.entry.name))).length;
    if (missCount > 0) {
        const m = document.createElement("span");
        m.className = "miss";
        m.textContent = `⚠ ${missCount} 缺失`;
        head.append(m);
    }

    const sl = document.createElement("span");
    sl.className = "slabel";
    sl.innerHTML = `Strength<span class="hint">↔ 拖动等比调全部</span>`;
    head.append(sl);

    // 表头横向拖动 = 等比缩放全部启用行
    head.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0 || ev.target.closest(".wm2-tgl")) return;
        ev.stopPropagation();
        const rows = activeRows(node).map((r) => ({ entry: r.entry, orig: r.entry.model }));
        if (!rows.length) return;
        const sx = ev.clientX;
        let moved = false;
        const hint = head.querySelector(".hint");
        const mv = (m) => {
            if (!moved && Math.abs(m.clientX - sx) < 4) return;
            moved = true;
            const k = 1 + (m.clientX - sx) * 0.0005;
            rows.forEach((r) => { r.entry.model = clampStep(Math.max(-10, Math.min(10, r.orig * k))); });
            if (hint) { hint.textContent = `×${k.toFixed(2)}`; hint.style.opacity = 1; hint.style.color = "var(--wm-lo-accent)"; }
            paintAllStrength(node);
        };
        const up = () => {
            document.removeEventListener("pointermove", mv);
            document.removeEventListener("pointerup", up);
            syncData(node);
            renderRows(node, true);
        };
        document.addEventListener("pointermove", mv);
        document.addEventListener("pointerup", up);
    });
    list.append(head);

    if (!all.length) {
        const e = document.createElement("div");
        e.className = "wm2-empty";
        e.innerHTML = `还没有 LoRA<br>上方<b>搜索框</b>输入关键词回车，或点下方<b>Add LoRA</b> 浏览全部`;
        list.append(e);
    }
    (node.__wm2Stack || []).forEach((entry, i) => {
        list.append(entry.folder ? makeGroup(node, entry, i) : makeRow(node, entry, -1));
    });

    if (keepScroll) list.scrollTop = top;
}

// 只刷新数值与填充条，不重建 DOM（拖动中调用，避免抖焦点）
function paintAllStrength(node) {
    const rows = [...(node.__wm2List?.querySelectorAll(".wm2-wrap") || [])];
    const map = new Map();
    allRows(node).forEach((r) => map.set(norm(r.entry.name), r.entry));
    rows.forEach((w) => {
        const e = map.get(norm(w.dataset.name));
        if (!e) return;
        const inp = w.querySelector(".wm2-sv");
        if (!inp) return;
        inp.value = e.model.toFixed(2);
        inp.style.setProperty("--v", Math.max(0, Math.min(100, (Math.abs(e.model) / 2) * 100)) + "%");
    });
}

//==============================================================================
// 添加 LoRA
//==============================================================================
// 自动填 tag（读 civitai trainedWords）；已有 tag 的行不覆盖
function autoFillTag(node, entry) {
    const path = entry.name;
    if (!path) return;
    fetchTag(path).then((tag) => {
        if (!tag || entry.tag) return;
        entry.tag = tag;
        _tagCache.set(norm(path), tag);
        syncData(node);
        if (!node.__wm2TagOpen.has(norm(path))) {
            const wrap = node.__wm2List?.querySelector(`.wm2-wrap[data-name="${CSS.escape(path)}"]`);
            const btn = wrap?.querySelector(".wm2-ico.tag-none");
            if (btn) { btn.className = "wm2-ico tag-has"; btn.title = "编辑 tag：" + tag; }
        } else {
            renderRows(node, true);
        }
    });
}

function addEntry(node, path, gi) {
    if (rowFull(node)) { warn(node, `已达上限 ${MAX_ROWS} 条`); return null; }
    const entry = { on: true, name: path, model: DEF_STRENGTH, tag: "" };
    if (gi >= 0 && node.__wm2Stack[gi]?.folder) node.__wm2Stack[gi].loras.push(entry);
    else node.__wm2Stack.push(entry);
    node.__wm2Sel = norm(path);
    syncData(node);
    renderRows(node, true);
    autoFillTag(node, entry);
    return entry;
}

// 就地换掉某一行的 LoRA：只改路径，强度 / tag / 启用状态都跟着行保留
function replaceEntry(node, entry, path) {
    if (!path) return false;
    if (norm(path) === norm(entry.name)) return true;
    // 拦重复只看「同一层」：配方里允许和外面、组内重复；顶层不允许出现两条同名。
    const inGroup = (node.__wm2Stack || []).some((e) => e.folder && (e.loras || []).includes(entry));
    const dup = inGroup ? false
        : usedTopPaths(node).has(norm(path));
    if (dup) { warn(node, `列表里已经有「${stemOf(baseOf(path))}」了`); return false; }
    const hadTag = !!entry.tag;
    node.__wm2TagOpen?.delete(norm(entry.name));    // tagOpen / 选中态都按路径记，旧键清掉
    entry.name = path;
    node.__wm2Sel = norm(path);
    syncData(node);
    renderRows(node, true);
    if (!hadTag) autoFillTag(node, entry);
    else _tagCache.set(norm(path), entry.tag);
    warn(node, `已换成 ${stemOf(baseOf(path))}`);
    return true;
}

let _warnTimers = new WeakMap();
export function warn(node, msg, isErr) {
    const el = node.__wm2Warn;
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("err", !!isErr);
    el.classList.add("on");
    clearTimeout(_warnTimers.get(node));
    _warnTimers.set(node, setTimeout(() => el.classList.remove("on"), 2600));
}

//==============================================================================
// 浏览弹窗（多选添加 / 单选替换 + 文件夹侧栏）
//==============================================================================
let _bd = null, _bdState = null;
// 弹窗视图：grid=缩略图网格 / list=列表。localStorage 记住上次选择，全局共享。
let _wm2View = (() => {
    try { return localStorage.getItem("WindMix.loraModalView") === "list" ? "list" : "grid"; }
    catch (e) { return "grid"; }
})();
const CHECK_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 L6.5 12 L13 4"/></svg>`;
function closeModal() {
    if (_bd) _bd.classList.remove("open");
    _bdState = null;
    hidePv();
}
// opts.replace = 某个行条目 → 进入「重新选择」单选模式（点 LoRA 名字进来走这里）
function openModal(node, gi, opts = {}) {
    injectStyle();
    const repl = opts.replace || null;
    const bd = _bd && _bd.isConnected ? _bd : (() => {
        const b = document.createElement("div");
        b.className = "wm2-bd";
        document.body.append(b);
        _bd = b;
        return b;
    })();
    _bdState = { node, gi, kw: "", dir: null, sel: new Set(), replace: repl, collapsed: new Set() };
    bd.innerHTML = "";
    bd.classList.add("open");

    const m = document.createElement("div");
    m.className = "wm2-modal";
    bd.append(m);

    const h = document.createElement("h4");
    h.textContent = repl
        ? `重新选择 LoRA · ${stemOf(baseOf(repl.name || ""))}`
        : (gi >= 0 && node.__wm2Stack[gi] ? `添加到配方 · ${node.__wm2Stack[gi].folder}` : "Add LoRA");
    // 视图切换：列表 ⇄ 缩略图网格（选择记在 localStorage，下次打开保持）
    const vsw = document.createElement("span");
    vsw.className = "wm2-vsw";
    const bList = document.createElement("button");
    bList.type = "button";
    bList.title = "列表视图";
    bList.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2.5" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/><rect x="1" y="11.5" width="14" height="2" rx="1"/></svg>`;
    const bGrid = document.createElement("button");
    bGrid.type = "button";
    bGrid.title = "缩略图视图";
    bGrid.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6.2" height="6.2" rx="1.4"/><rect x="8.8" y="1" width="6.2" height="6.2" rx="1.4"/><rect x="1" y="8.8" width="6.2" height="6.2" rx="1.4"/><rect x="8.8" y="8.8" width="6.2" height="6.2" rx="1.4"/></svg>`;
    vsw.append(bList, bGrid);
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "✕";
    x.style.marginLeft = "0";   // 右侧空间交给 vsw 的 margin-left:auto
    x.onclick = () => closeModal();
    h.append(vsw, x);
    m.append(h);

    const searchWrap = document.createElement("div");
    searchWrap.className = "wm2-msearch";
    searchWrap.innerHTML = IC.mag;
    const kw = document.createElement("input");
    kw.type = "text";
    kw.placeholder = "搜索 LoRA 名称 / 文件夹…";
    kw.onkeydown = (e) => e.stopPropagation();
    kw.oninput = () => { _bdState.kw = kw.value; renderSide(); renderBody(); };
    searchWrap.append(kw);
    m.append(searchWrap);
    setTimeout(() => kw.focus(), 0);

    const body = document.createElement("div");
    body.className = "wm2-mbody";
    m.append(body);
    const side = document.createElement("div");
    side.className = "wm2-mside";
    const list = document.createElement("div");
    list.className = "wm2-mlist";
    // 缩略图网格视图（设计稿同款：信息行 + 卡片网格）
    const gridWrap = document.createElement("div");
    gridWrap.className = "wm2-mgrid";
    const ginfo = document.createElement("div");
    ginfo.className = "wm2-ginfo";
    const grid = document.createElement("div");
    grid.className = "wm2-grid";
    gridWrap.append(ginfo, grid);
    body.append(side, list, gridWrap);

    const foot = document.createElement("div");
    foot.className = "wm2-mfoot";
    const cnt = document.createElement("span");
    cnt.className = "cnt";
    const sp = document.createElement("span");
    sp.className = "sp";
    const cancel = document.createElement("button");
    cancel.textContent = "取消";
    cancel.onclick = () => closeModal();
    const ok = document.createElement("button");
    ok.className = "ok";
    ok.textContent = repl ? "替换" : "添加";
    ok.onclick = () => {
        const picks = [...(_bdState?.sel || [])];
        if (repl) {
            closeModal();
            replaceEntry(node, repl, picks[0]);
            return;
        }
        let added = 0;
        picks.forEach((p) => { if (addEntry(node, p, gi)) added += 1; });
        closeModal();
        if (added) warn(node, `已添加 ${added} 个 LoRA`);
    };
    foot.append(cnt, sp, cancel, ok);
    m.append(foot);

    function kwFiltered() {
        const kw2 = _bdState.kw.trim().toLowerCase();
        return (node.__wm2All || []).filter((p) => !kw2 ||
            norm(p).toLowerCase().includes(kw2) || stemOf(baseOf(p)).toLowerCase().includes(kw2));
    }
    // 层级目录树：style / style/anime 这类路径拆成父子节点，count 含所有子孙文件
    function treeOf(paths) {
        const root = { kids: new Map() };
        for (const p of paths) {
            const d = dirOf(p);
            if (!d) continue;   // 根目录散文件只出现在「全部」里，不单独建节点
            let n = root;
            for (const seg of d.split("/")) {
                if (!n.kids.has(seg)) n.kids.set(seg, { name: seg, path: (n.path ? n.path + "/" : "") + seg, kids: new Map(), count: 0 });
                n = n.kids.get(seg);
                n.count += 1;
            }
        }
        return root;
    }
    function items() {
        // 只按「顶层行」判重：配方里挂过的 LoRA 依然要出现在顶层 Add LoRA 列表里
        const used = usedTopPaths(node);
        const hideUsed = !repl && gi < 0;
        const kw2 = _bdState.kw.trim().toLowerCase();
        const d = _bdState.dir;
        return (node.__wm2All || []).filter((p) => {
            if (d !== null) { const pd = dirOf(p); if (pd !== d && !pd.startsWith(d + "/")) return false; }
            if (kw2 && !norm(p).toLowerCase().includes(kw2) && !stemOf(baseOf(p)).toLowerCase().includes(kw2)) return false;
            return true;
        }).filter((p) => !hideUsed || !used.has(norm(p)));
    }
    function renderSide() {
        side.innerHTML = "";
        const all = (node.__wm2All || []).length;
        const CHEV = `<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 2.5 L8 6 L4 9.5"/></svg>`;
        const row = (label, dir, n, depth, kids, key) => {
            const it = document.createElement("div");
            it.className = "f" + (_bdState.dir === dir ? " on" : "");
            it.style.paddingLeft = (9 + depth * 13) + "px";
            if (kids) {
                // 有子目录：箭头单独负责折叠/展开，点行其余部分仍是筛选
                if (!_bdState.collapsed.has(key)) it.classList.add("open");
                const ch = document.createElement("span");
                ch.className = "chev";
                ch.innerHTML = CHEV;
                ch.onclick = (e) => {
                    e.stopPropagation();
                    if (_bdState.collapsed.has(key)) _bdState.collapsed.delete(key);
                    else _bdState.collapsed.add(key);
                    renderSide();
                };
                it.append(ch);
            }
            // 文件夹图标：所有行都有，父目录行是「箭头+图标」，层级一眼可辨
            it.insertAdjacentHTML("beforeend", IC.folder);
            const s = document.createElement("span");
            s.className = "lbl";
            s.textContent = label;
            const c = document.createElement("span");
            c.className = "n";
            c.textContent = n;
            it.append(s, c);
            it.onclick = () => { _bdState.dir = dir; renderSide(); renderBody(); };
            side.append(it);
        };
        row("全部", null, all, 0, false, "");
        const walk = (map, depth) => {
            [...map.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((nd) => {
                row(nd.name, nd.path, nd.count, depth, nd.kids.size > 0, nd.path);
                if (!_bdState.collapsed.has(nd.path)) walk(nd.kids, depth + 1);
            });
        };
        walk(treeOf(kwFiltered()).kids, 0);
    }
    // 选中态只改 class，不重建列表（多选时每点一次都重排一次会闪）
    function refreshSelUI() {
        list.querySelectorAll(".wm2-mit").forEach((it) => {
            const on = _bdState.sel.has(it.dataset.p);
            it.classList.toggle("on", on);
            const tg = it.querySelector(".wm2-tgl");
            if (tg) tg.className = on ? "wm2-tgl on" : "wm2-tgl";
        });
        grid.querySelectorAll(".wm2-card").forEach((cd) => {
            cd.classList.toggle("sel", _bdState.sel.has(cd.dataset.p));
        });
        cnt.textContent = repl
            ? (_bdState.sel.size ? `换成：${stemOf(baseOf([..._bdState.sel][0]))}` : "单选一个 LoRA")
            : `已选 ${_bdState.sel.size} 个 · 可多选`;
        ok.disabled = _bdState.sel.size === 0;
    }
    // 角标文案：替换模式标「当前」；往配方里加时标出「外面已有 / 组内已有」，但仍然可选
    function chipOf(p, used) {
        if (repl && norm(p) === norm(repl.name)) return "当前";
        if (!repl && gi >= 0) {
            const inGrp = (node.__wm2Stack[gi]?.loras || []).some((l) => norm(l.name) === norm(p));
            if (inGrp) return "组内已有";
            if (used.has(norm(p))) return "外面已有";
        } else if (!repl && gi < 0 && inAnyGroup(node, p)) return "配方里已有";   // 只是提示，内外可以同时挂
        else if (repl && used.has(norm(p))) return "外面已有";   // 替换到顶层重名会被拦，先给个提示
        return "";
    }
    // 两种视图共用的点选逻辑（网格卡片与列表条目行为完全一致）
    function togglePick(p) {
        if (repl) { _bdState.sel.clear(); _bdState.sel.add(p); }   // 单选
        else if (_bdState.sel.has(p)) _bdState.sel.delete(p);
        else _bdState.sel.add(p);
        refreshSelUI();
    }
    function emptyText() {
        return repl ? "没有可选的 LoRA"
            : gi >= 0 ? "没有匹配的 LoRA" : "没有匹配的 LoRA（顶层已添加过的不再出现）";
    }
    // 缩略图网格：上图下名 + 右上角勾选圈；卡片自带预览图，不再挂悬停浮窗
    function renderGrid() {
        grid.innerHTML = "";
        const its = items();
        const used = usedTopPaths(node);
        ginfo.innerHTML = "";
        const b = document.createElement("b");
        b.textContent = _bdState.dir === null ? "全部" : _bdState.dir;
        ginfo.append(b, document.createTextNode(` · ${Math.min(its.length, 200)} 个${its.length > 200 ? "（仅显示前 200）" : ""}`));
        if (!its.length) {
            const e = document.createElement("div");
            e.className = "wm2-empty";
            e.textContent = emptyText();
            grid.append(e);
            return;
        }
        its.slice(0, 200).forEach((p) => {
            const on = _bdState.sel.has(p);
            const cd = document.createElement("div");
            cd.className = "wm2-card" + (on ? " sel" : "");
            cd.dataset.p = p;
            const im = document.createElement("div");
            im.className = "im";
            const abG = document.createTextNode(stemOf(baseOf(p)).slice(0, 2).toUpperCase());
            im.append(abG);
            const img = document.createElement("img");
            img.loading = "lazy";
            img.alt = "";
            img.onerror = () => img.remove();
            img.onload = () => abG.remove();  // 同列表：有图撤文字，无图留首字母兜底
            img.src = previewUrl(p);
            im.append(img);
            const cap = document.createElement("div");
            cap.className = "cap";
            const t = document.createElement("span");
            t.className = "t";
            t.textContent = stemOf(baseOf(p));
            t.title = p;
            const d = document.createElement("span");
            d.className = "d";
            d.textContent = dirOf(p) || "根目录";
            cap.append(t, d);
            const chk = document.createElement("span");
            chk.className = "chk";
            chk.innerHTML = CHECK_SVG;
            const chip = chipOf(p, used);
            cd.append(im, cap, chk);
            if (chip) {
                const lab = document.createElement("span");
                lab.className = "tagu";
                lab.textContent = chip;
                cd.append(lab);
            }
            cd.onclick = () => togglePick(p);
            grid.append(cd);
        });
    }
    function renderList() {
        list.innerHTML = "";
        const its = items();
        const used = usedTopPaths(node);     // 提示胶囊里的「外面已有」只看顶层行
        if (!its.length) {
            const e = document.createElement("div");
            e.className = "wm2-empty";
            e.textContent = emptyText();
            list.append(e);
        }
        its.slice(0, 200).forEach((p) => {
            const it = document.createElement("div");
            const on = _bdState.sel.has(p);
            it.className = "wm2-mit" + (on ? " on" : "");
            it.dataset.p = p;
            const th = document.createElement("span");
            th.className = "th";
            const abT = document.createTextNode(stemOf(baseOf(p)).slice(0, 2).toUpperCase());
            th.append(abT);
            const im = document.createElement("img");
            im.loading = "lazy";
            im.onerror = () => im.remove();
            im.onload = () => abT.remove();   // 图加载成功就撤占位文字，图片满框
            im.src = previewUrl(p);
            th.append(im);
            const nm = document.createElement("span");
            nm.className = "nm";
            const t = document.createElement("span");
            t.className = "t";
            t.textContent = stemOf(baseOf(p));
            t.title = p;
            nm.append(t);
            const tg = document.createElement("span");
            tg.className = on ? "wm2-tgl on" : "wm2-tgl";
            it.append(th, nm);
            const chip = chipOf(p, used);
            if (chip) {
                const lab = document.createElement("span");
                lab.className = "tagu";
                lab.textContent = chip;
                it.append(lab);
            }
            it.append(tg);
            it.onclick = () => togglePick(p);
// 悬停弹预览：走全局浮层单例，锚点用名称元素
            it.addEventListener("mouseenter", () => {
                clearTimeout(_pvTimer);
                _pvTimer = setTimeout(() => showPv(p, nm), 300);
            });
            it.addEventListener("mouseleave", hidePv);
            list.append(it);
        });
        refreshSelUI();
    }
    // 按当前视图渲染对应一侧；切换时不重建，勾选集合两边共享
    function renderBody() {
        if (_wm2View === "grid") renderGrid();
        else renderList();
    }
    function applyView() {
        const grid = _wm2View === "grid";
        m.classList.toggle("wide", grid);
        // 网格：弹窗高度锁死 80vh，卡片固定 4 列，溢出全部交给网格内部滚动条；
        // 列表：弹窗按内容自适应（原有行为）
        m.classList.toggle("gridmode", grid);
        list.style.display = grid ? "none" : "";
        gridWrap.style.display = grid ? "" : "none";
        bList.classList.toggle("on", !grid);
        bGrid.classList.toggle("on", grid);
        renderBody();
    }
    bList.onclick = () => { _wm2View = "list"; try { localStorage.setItem("WindMix.loraModalView", "list"); } catch (e) {} applyView(); };
    bGrid.onclick = () => { _wm2View = "grid"; try { localStorage.setItem("WindMix.loraModalView", "grid"); } catch (e) {} applyView(); };
    renderSide();
    applyView();

    bd.onclick = (e) => { if (e.target === bd) closeModal(); };
}

//==============================================================================
// 节点尺寸：容器填满节点内部可用高度，高度差由 flex:1 的列表吸收
//   底距（按钮条 → 框底）= 左右内边距；chrome = computeSize() 高 - UI_H
//==============================================================================
export function measureChrome(node) {
    const sz = node.computeSize?.();
    const h = Array.isArray(sz) && Number.isFinite(sz[1]) ? sz[1] : NaN;
    if (!Number.isFinite(h) || h <= UI_H) return node.__wm2Chrome ?? DEFAULT_CHROME;
    return Math.max(8, Math.round(h - UI_H));
}
// 节点框判据：缩放必须等于 ds.scale，否则会把 widget 包装层当成框（量出来一直偏大）
function findFrameEl(node) {
    const out = { el: null, rect: null, k: null, cands: [] };
    try {
        const c = node.__wm2Container;
        if (!c || !Array.isArray(node.size) || !(node.size[0] > 20) || !(node.size[1] > 20)) return out;
        const cr = c.getBoundingClientRect();
        const want = app?.canvas?.ds?.scale;
        const hasWant = Number.isFinite(want) && want > 0;
        let el = c.parentElement;
        for (let i = 0; el && i < 8; i++) {
            const r = el.getBoundingClientRect();
            const kx = r.width / node.size[0];
            const ky = r.height / node.size[1];
            const fits = cr.left >= r.left - 3 && cr.right <= r.right + 3 && cr.top >= r.top - 3;
            if (kx > 0.1 && ky > 0.1 && fits && Math.abs(kx - ky) <= 0.06 * Math.max(kx, ky)) {
                out.cands.push(`${(el.className || el.tagName || "?").toString().slice(0, 34)} k=${kx.toFixed(3)}`);
                if (!hasWant || Math.abs(kx - want) <= 0.03 * want) {
                    out.el = el; out.rect = r; out.k = kx;
                    return out;
                }
            }
            el = el.parentElement;
        }
    } catch (e) { /* 量不到就算了 */ }
    return out;
}
// 节点框屏幕几何：DOM 优先，退回画布坐标换算（screen = canvasRect + ds.offset + pos*scale）
function nodeFrameRect(node) {
    const f = findFrameEl(node);
    if (f.rect) return { rect: f.rect, k: f.k, source: "dom", cands: f.cands };
    const nr = nodeRectOnScreen(node);
    if (nr) return { rect: nr, k: nr.scale, source: "canvas", cands: f.cands };
    return { rect: null, k: null, source: "none", cands: f.cands };
}

// 画布缩放：优先用 DOM 框反推，退回 ds.scale
export function canvasScale(node) {
    const s = app?.canvas?.ds?.scale;
    if (Number.isFinite(s) && s > 0) return s;
    const fr = nodeFrameRect(node);
    return Number.isFinite(fr.k) && fr.k > 0 ? fr.k : null;
}

// 左右内边距：优先按节点框实测；__wm2WidgetW 是上一次 computeSize 的宽度，只做兜底
function sideInset(node) {
    const c = node.__wm2Container;
    if (c) {
        const fr = nodeFrameRect(node);
        if (fr.rect) {
            const cr = c.getBoundingClientRect();
            const d = ((cr.left - fr.rect.left) + (fr.rect.right - cr.right)) / 2 / fr.k;
            if (Number.isFinite(d) && d >= 0 && d < 80) return d;
        }
    }
    const nw = node.size?.[0];
    if (!Number.isFinite(nw)) return null;
    let avail = NaN;
    if (c) {
        const k = canvasScale(node);
        const w = c.getBoundingClientRect().width;
        if (k && Number.isFinite(w) && w > 0) avail = w / k;
    }
    if (!Number.isFinite(avail) || avail <= 0) avail = node.__wm2WidgetW;
    if (!Number.isFinite(avail) || avail <= 0) return null;
    const d = nw - avail;
    return d >= 0 && d < 160 ? d / 2 : null;
}
// widget 起点：各版本 last_y 有「从节点顶」和「从中心」两种口径，用 (0, chrome] 区间判断
function widgetTop(node) {
    const chrome = node.__wm2Chrome ?? DEFAULT_CHROME;
    const y = node.__wm2DomWidget?.last_y;
    if (!Number.isFinite(y)) return null;
    const half = (node.size?.[1] || 0) / 2;
    const ok = (v) => Number.isFinite(v) && v > 0 && v <= chrome;
    if (ok(y + half)) return y + half;
    if (ok(y)) return y;
    return null;
}
// 容器填满可用高度，并把底距调成和左右内边距一致（onResize 里也调，跟手）
// 实测成功过的 topOff/inset 会缓存起来，免得下次重渲染又被推断值顶回出框
export function lockBottomBar(node) {
    const c = node.__wm2Container;
    if (!c) return;
    const chrome = node.__wm2Chrome ?? DEFAULT_CHROME;
    const measured = Number.isFinite(node.__wm2MeasTop) && Number.isFinite(node.__wm2MeasInset);
    const top = measured ? node.__wm2MeasTop : widgetTop(node);
    const inset = measured ? node.__wm2MeasInset : sideInset(node);
// 量得到就按「底距 = 左右间距」，量不到退回 chrome 并留 GAP_SAFETY 余量
    const safety = measured ? 0 : GAP_SAFETY;
    const wantH = Math.round((top != null && inset != null
        ? node.size[1] - top - inset
        : (node.size?.[1] || 0) - chrome) - safety);
    const h = Math.max(MIN_CONTAINER_H, wantH);
    // 矮到装不下「搜索框 + 列表最小高度 + 按钮条」时把节点顶回来：再缩按钮条就要出框了
    const avail = Math.round((node.size?.[1] || 0) - (top ?? chrome) - (inset ?? 0));
    if (avail < MIN_CONTAINER_H && h === MIN_CONTAINER_H && !node.__wm2Snapping && typeof node.setSize === "function") {
        node.__wm2Snapping = true;
        try { node.setSize([node.size?.[0] || MIN_NODE_W, MIN_CONTAINER_H + (top ?? chrome) + (inset ?? 0)]); } finally { node.__wm2Snapping = false; }
    }
    if (Math.round(c.getBoundingClientRect().height) !== h) c.style.height = h + "px";
    node.setDirtyCanvas?.(true, false);
// 推断完再用真实屏幕几何校正一轮（前端版本一变推断就会偏）
    node.__wm2GapTries = 0;      // 每次重新布局都允许再收敛几轮
    scheduleGapFix(node);
}

// 节点矩形换算到屏幕坐标：LiteGraph 的画布变换是 screen = canvasRect + ds.offset + pos * ds.scale
function nodeRectOnScreen(node) {
    try {
        const cv = app?.canvas?.canvas;
        const ds = app?.canvas?.ds;
        if (!cv || !ds || !Number.isFinite(ds.scale) || ds.scale <= 0) return null;
        if (!Array.isArray(node.pos) || !Array.isArray(node.size)) return null;
        const r = cv.getBoundingClientRect();
        const left = r.left + ds.offset[0] + node.pos[0] * ds.scale;
        const top = r.top + ds.offset[1] + node.pos[1] * ds.scale;
        const w = node.size[0] * ds.scale;
        const h = node.size[1] * ds.scale;
        if ([left, top, w, h].some((v) => !Number.isFinite(v))) return null;
        return { left, top, right: left + w, bottom: top + h, scale: ds.scale };
    } catch (e) { return null; }
}

// 实测「按钮条 → 框底」；出框（actual 为负）正是要修的情况，不能当异常跳过
function measureBottomGap(node) {
    const c = node.__wm2Container;
    if (!c) { gapDiag(node, "no-container"); return null; }
    const cr = c.getBoundingClientRect();
    if (cr.width < 8 || cr.height < 8) { gapDiag(node, "not-laid-out"); return null; }   // 还没布局 / 节点在屏幕外
    const fr = nodeFrameRect(node);
    if (!fr.rect) { gapDiag(node, "no-frame"); return null; }
    const { rect, k } = fr;
    // 容器横向必须真的落在框内，否则参考系不可信（纵向允许超出 = 出框，正是要修的）
    if (cr.left < rect.left - 4 || cr.right > rect.right + 4 || cr.top < rect.top - 4) {
        gapDiag(node, "container-outside-frame"); return null;
    }
// 参考系宽度须与容器同量级，差太多说明认错了元素，宁可不校正
    if (Math.abs(rect.width - cr.width) > 0.2 * rect.width) { gapDiag(node, "frame width mismatch"); return null; }
    let inset = sideInset(node);
    if (!Number.isFinite(inset) || inset < 0 || inset > 80) inset = DEFAULT_INSET;
    return { actual: (rect.bottom - cr.bottom) / k, inset, k,
             topOff: (cr.top - rect.top) / k, source: fr.source };
}
// 只读探针：给「新建节点收敛」判断是否已经贴底用（不改布局、不打诊断）
export function bottomGapState(node) {
    _gapDiagMute = true;
    try { return measureBottomGap(node); } finally { _gapDiagMute = false; }
}

// 量不到时往控制台打一次现场几何（最多 6 条）
let _gapDiagN = 0;
let _gapDiagMute = false;
function gapDiag(node, why, ok) {
    if (_gapDiagMute) return;                    // 探针式调用不占诊断额度
    if (!ok && _gapDiagN >= 6) return;
    if (!ok) _gapDiagN += 1;
    try {
        const c = node.__wm2Container;
        const cr = c?.getBoundingClientRect?.();
        const cv = app?.canvas;
        const car = cv?.canvas?.getBoundingClientRect?.();
        const info = {
            来源: ok ? "实测成功" : "跳过",
            原因: why || "",
            size: node.size ? [Math.round(node.size[0]), Math.round(node.size[1])] : null,
            pos: node.pos ? [Math.round(node.pos[0]), Math.round(node.pos[1])] : null,
            chrome: node.__wm2Chrome,
            容器高: c ? Math.round(cr.height) : null,
            容器底: c ? Math.round(cr.bottom) : null,
            ds: cv?.ds ? { scale: cv.ds.scale, offset: [Math.round(cv.ds.offset?.[0] ?? NaN), Math.round(cv.ds.offset?.[1] ?? NaN)] } : null,
            canvasRect: car ? [Math.round(car.left), Math.round(car.top), Math.round(car.width), Math.round(car.height)] : null,
            祖先: (() => { const out = []; let el = c?.parentElement;
                for (let i = 0; el && i < 7; i++) {
                    const r = el.getBoundingClientRect();
                    out.push(`${(el.className || el.tagName || "?").toString().slice(0, 36)} ${Math.round(r.width)}×${Math.round(r.height)}`);
                    el = el.parentElement; } return out; })(),
        };
        if (ok) info.实测 = `底距 ${ok.actual.toFixed(1)} → 目标 ${ok.inset.toFixed(1)}（k=${ok.k.toFixed(2)}）`;
        console.warn("[WindMix LoRA] 底距实测", info);
    } catch (e) { /* 诊断本身不能出问题 */ }
}

function applyGapFix(node) {
    const c = node.__wm2Container;
    if (!c) return;
    const m = measureBottomGap(node);
    if (!m) return;
// 缓存实测值，lockBottomBar 下次直接用
    if (Number.isFinite(m.topOff) && m.topOff > 0 && m.topOff < 200) node.__wm2MeasTop = m.topOff;
    if (Number.isFinite(m.inset) && m.inset >= 0 && m.inset < 80) node.__wm2MeasInset = m.inset;
// Δ高度 = 实测底距 - 目标底距（加高容器会减小底距）
    const delta = Math.round(m.actual - m.inset);
    if (Math.abs(delta) > 600) { gapDiag(node, `delta 过大 ${delta}`); return; }
    const cur = parseFloat(c.style.height);
    const base = Number.isFinite(cur) ? cur : c.getBoundingClientRect().height / (m.k || 1);
    if (!delta) { againGap(node, 2); return; }   // LiteGraph 可能随后又重排，复查两轮
    const next = Math.max(MIN_CONTAINER_H, Math.round(base) + delta);
    if (next === Math.round(base)) { againGap(node, 2); return; }
    c.style.height = next + "px";
    gapDiag(node, "", m);
    // 需要更高、但节点内部装不下时把节点本身撑大，保证按钮条永远在框里且底距不变
    const topOff = Number.isFinite(m.topOff) ? m.topOff : (node.__wm2MeasTop ?? (node.__wm2Chrome ?? DEFAULT_CHROME));
    const need = Math.round(topOff + next + m.inset);
    if (need > node.size[1] && need - node.size[1] < 400 && typeof node.setSize === "function") {
        node.setSize([node.size[0], need]);
    }
    node.setDirtyCanvas?.(true, false);
    againGap(node, 3);        // 改完布局还会变，再收敛几轮（次数由 lockBottomBar 复位，不会自我循环）
}
// 改完布局前端还会重排，复查两轮；次数由 lockBottomBar 复位
function againGap(node, cap) {
    if ((node.__wm2GapTries || 0) >= cap) return;
    node.__wm2GapTries = (node.__wm2GapTries || 0) + 1;
    setTimeout(() => scheduleGapFix(node), 140);
}

function scheduleGapFix(node) {
    if (node.__wm2GapQueued) return;
    node.__wm2GapQueued = true;
    const run = () => {
        if (!node.__wm2GapQueued) return;             // rAF / 定时器谁先到谁做，只做一次
        node.__wm2GapQueued = false;
        try { applyGapFix(node); } catch (e) { /* 量不到就沿用推断值 */ }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    setTimeout(run, 60);   // 后台标签页里 rAF 不触发，兜一下
}
// 建好界面 / 从 workflow 恢复后：先把节点撑到至少装得下整个界面，再锁底
export function ensureNodeFits(node) {
    node.__wm2Chrome = measureChrome(node);
    const w0 = Math.round(node.size?.[0] || 0);
    const h0 = Math.round(node.size?.[1] || 0);
    const w = Math.max(w0 || MIN_NODE_W, MIN_NODE_W);
    const h = Math.max(h0, UI_H + node.__wm2Chrome);
    if (w !== w0 || h !== h0) {
        if (typeof node.setSize === "function") node.setSize([w, h]);
        else node.size = [w, h];
        node.__wm2Chrome = measureChrome(node);
    }
    lockBottomBar(node);
    node.setDirtyCanvas?.(true, true);
}

//==============================================================================
// 主体 UI
//==============================================================================
function buildUI(node) {
    if (node.__wm2Built) return;
    node.__wm2Built = true;
    injectStyle();

    hideWidget(node, getDataWidget(node));
    node.__wm2TagOpen = node.__wm2TagOpen || new Set();
    node.__wm2Sel = null;
    loadStack(node);

    const c = document.createElement("div");
    c.className = "wm2-container";
    node.__wm2Container = c;
    c.addEventListener("pointerdown", (e) => e.stopPropagation());
    c.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    c.addEventListener("keydown", (e) => e.stopPropagation());
    c.addEventListener("focusin", (e) => { if (e.target.tagName === "INPUT") e.stopPropagation(); });

    // 1) 搜索即添加
    const search = document.createElement("div");
    search.className = "wm2-search";
    const mag = document.createElement("span");
    mag.className = "mag";
    mag.innerHTML = IC.mag;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "搜索 LoRA 名称 / 文件夹… 回车添加";
    input.spellcheck = false;
    const clr = document.createElement("button");
    clr.type = "button";
    clr.className = "clr";
    clr.textContent = "✕";
    clr.title = "清空";
    const kbd = document.createElement("span");
    kbd.className = "kbd";
    kbd.textContent = "Enter";
    search.append(mag, input, clr, kbd);
    c.append(search);
    node.__wm2Search = search;
    node.__wm2SearchInput = input;

    const openAc = () => { _acIdx = 0; renderAc(node, search); };
    // 已经有缓存就同步弹，别让一个 await 把下拉推迟到「用户已经移开鼠标」之后
    input.addEventListener("focus", () => {
        search.classList.add("focus");
        if (node.__wm2All?.length) openAc();
        else refreshKnown(node).then(openAc);
    });
    // 输入框已聚焦时再点一次不再触发 focus —— 要靠 click 主动重开
    input.addEventListener("click", () => {
        if (_ac?.classList.contains("open") && _acNode === node) return;
        openAc();
    });
    search.addEventListener("click", (e) => {
        if (e.target === search || e.target.tagName !== "INPUT") openAc();
    });
    input.addEventListener("input", () => {
        node.__wm2Kw = input.value;
        search.classList.toggle("has-q", !!input.value);
        _acIdx = 0;
        renderAc(node, search);
    });
    // 失焦只去掉高亮，不收下拉：下拉由「点到外面 / Esc / 选中一条」来关
    input.addEventListener("blur", () => { search.classList.remove("focus"); });
    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "ArrowDown") { e.preventDefault(); acMove(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); acMove(-1); }
        else if (e.key === "Enter") {
            e.preventDefault();
            const p = _acItems[_acIdx];
            if (p) pickAcItem(node, p);
            else if (node.__wm2Kw.trim()) warn(node, `没找到「${node.__wm2Kw.trim()}」，换个关键词或用 Add LoRA 浏览`);
        } else if (e.key === "Escape") { closeAc(); input.blur(); }
    });
    clr.onclick = (e) => { e.stopPropagation(); node.__wm2Kw = ""; input.value = ""; search.classList.remove("has-q"); input.focus(); };
    clr.onmousedown = (e) => e.preventDefault();

    // 2) 列表（固定高度 + 内滚动）
    const list = document.createElement("div");
    list.className = "wm2-list";
    list.tabIndex = 0;
    c.append(list);
    node.__wm2List = list;
    // 顶层空白处 = 落到顶层末尾
    list.addEventListener("dragover", (e) => {
        if (!node.__wm2Drag) return;
        if (e.target.closest(".wm2-row") || e.target.closest(".wm2-gh") || e.target.closest(".wm2-gbody")) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
    });
    list.addEventListener("drop", (e) => {
        const dg = node.__wm2Drag;
        if (!dg) return;
        if (e.target.closest(".wm2-row") || e.target.closest(".wm2-gh") || e.target.closest(".wm2-gbody")) return;
        e.preventDefault(); e.stopPropagation();
        if (dg.kind === "row") {
            const src = findRow(node, dg.name);
            if (src && src.gi >= 0) { removeRow(node, dg.name); node.__wm2Stack.push(src.entry); }
        }
        clearMarks(node);
        syncData(node);
        renderRows(node, true);
    });
    // 键盘：↑↓ 选行 / Ctrl+↑↓ 移动 / Space 开关 / Del 删除
    list.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.target.tagName === "INPUT") return;
        const rows = allRows(node);
        if (!rows.length) return;
        const idx = rows.findIndex((r) => norm(r.entry.name) === node.__wm2Sel);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const d = e.key === "ArrowUp" ? -1 : 1;
            if (e.ctrlKey && node.__wm2Sel) shiftRow(node, node.__wm2Sel, d);
            else { const n = rows[Math.max(0, Math.min(rows.length - 1, (idx < 0 ? 0 : idx) + d))]; if (n) node.__wm2Sel = norm(n.entry.name); }
            syncData(node);
            renderRows(node, true);
        } else if (e.key === " " && node.__wm2Sel) {
            e.preventDefault();
            const r = findRow(node, node.__wm2Sel);
            if (r) { r.entry.on = !r.entry.on; syncData(node); renderRows(node, true); }
        } else if (e.key === "Delete" && node.__wm2Sel) {
            e.preventDefault();
            removeRow(node, node.__wm2Sel);
            node.__wm2Sel = null;
            syncData(node);
            renderRows(node, true);
        }
    });

    // 3) 重名 / 上限提示条
    const w = document.createElement("div");
    w.className = "wm2-warn";
    c.append(w);
    node.__wm2Warn = w;

    // 4) 底部：左正方形「新建配方」图标按钮 + 右 Add LoRA
    const addrow = document.createElement("div");
    addrow.className = "wm2-addrow";
    const grpBtn = document.createElement("button");
    grpBtn.type = "button";
    grpBtn.className = "wm2-grpbtn";
    grpBtn.title = "新建配方";
    grpBtn.innerHTML = IC.folderPlus;
    grpBtn.onclick = () => {
        if (rowFull(node)) { warn(node, `已达上限 ${MAX_ROWS} 条`); return; }
        node.__wm2Stack.push({ folder: uniqueGroupName(node), on: true, open: true, loras: [] });
        syncData(node);
        renderRows(node, true);
        // 只建一个空配方，不弹 LoRA 选择框：组里有 Add LoRA 按钮，外面的行也能直接拖进来
        if (node.__wm2List) node.__wm2List.scrollTop = node.__wm2List.scrollHeight;
    };
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "wm2-addbtn";
    addBtn.textContent = "＋ Add LoRA";
    addBtn.onclick = () => openModal(node, -1);
    addrow.append(grpBtn, addBtn);
    c.append(addrow);

    const domWidget = node.addDOMWidget("wm_lora_v2_ui", "div", c, { serialize: false });
    // 上报常量高度（节点高度不随条目数变化），并记下可用宽度用于反解内边距
    domWidget.computeSize = (width) => {
        node.__wm2WidgetW = width;
        return [width, UI_H];
    };
    node.__wm2DomWidget = domWidget;

    ensureNodeFits(node);
    refreshKnown(node);
}

// 已知文件集合：用于「缺失即红」和候选列表
function refreshKnown(node) {
    return getLoraFiles().then((all) => {
        node.__wm2All = all;
        node.__wm2Known = new Set(all.map(norm));
        if (node.__wm2Built) renderRows(node, true);
    });
}

function patchNodeType(nodeType) {
    const origCreate = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        origCreate?.apply(this, arguments);
        try { buildUI(this); } catch (e) { console.warn("[WindMix] lora ui onNodeCreated failed", e); }
    };
    const origConf = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        origConf?.apply(this, arguments);
        try {
            if (!this.__wm2Built) buildUI(this);
            loadStack(this);
            renderRows(this, true);
            ensureNodeFits(this);   // workflow 里存的尺寸可能比界面需要的矮
        } catch (e) { console.warn("[WindMix] lora ui onConfigure failed", e); }
    };
    // 用户拖动节点边框改尺寸时：只有列表跟着变，底部按钮条与框底的距离锁死
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
        origResize?.apply(this, arguments);
        try { if (this.__wm2Built) lockBottomBar(this); } catch (e) {}
    };
}

document.addEventListener("pointerdown", (e) => {
    if (_ac?.classList.contains("open") && !e.target.closest(".wm2-ac") && !e.target.closest(".wm2-search")) closeAc();
}, true);
// 弹窗没有可聚焦的遮罩，Escape 只能在 document 上兜底
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _bd?.classList.contains("open")) { e.stopPropagation(); closeModal(); }
}, true);
// 滚动只重新贴合，绝不关下拉
window.addEventListener("scroll", (e) => {
    if (_ac?.classList.contains("open")) positionAc();
    hidePv();
}, true);
window.addEventListener("resize", () => { if (_ac?.classList.contains("open")) positionAc(); hidePv(); });

app.registerExtension({
    name: "windmix.lora.manager",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (NODE_TYPES.includes(nodeData?.name)) patchNodeType(nodeType);
    },
    setup() {
        injectStyle();
    },
});
