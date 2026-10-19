import { app } from "/scripts/app.js";

// =============================================================================
// UNet（📊 XY 输入: UNet · WindMixUNetXY）的界面
// 和 LoRA 卡片同一套设计：搜索即添加 + 固定高度内滚动列表 + 浏览弹窗，
// 样式 / 图标 / 提示条 / 底距几何引擎都直接 import windmix_lora_manager.js 的共用件，
// DOM 全部用 wm2-* 类，节点尺寸字段沿用 node.__wm2*（引擎按这套名字读缓存）。
// 模型没有强度、没有 tag，也不分组，所以行上只有 手柄 / 开关 / 名称 / 删除。
// 数据契约（隐藏 unet_data 控件，ComfyUI 自动序列化）：[{on,name}, ...]
// =============================================================================

import {
    injectStyle, IC, norm, dirOf, baseOf, hideWidget, warn, hlName,
    canvasScale, measureChrome, lockBottomBar, ensureNodeFits,
    UI_H, MIN_NODE_W, MAX_ROWS, PV_W, PV_H,
} from "./windmix_lora_manager.js";

const NODE_TYPES = ["WindMixUNetXY", "WindMixCkptXY"];

// 一套界面、两种节点：模型库来源 / 隐藏控件 / 预览 type / 视图与文件夹记忆的 localStorage 键
// 全部按「节点类型」查这张表。UNet 那份的值和改造前完全一样，行为不变；
// Checkpoint 只是把数据源换成 folder_paths 的 checkpoints（后端 /windmix/checkpoints）。
const TYPE_CONF = {
    WindMixUNetXY: {
        widget: "unet_data",
        url: "/windmix/unets",
        listKey: "unets",
        previewType: "diffusion_models",
        viewKey: "WindMix.unetModalView",
        memoKey: "WindMix.unetModalMemo",
        label: "模型",
    },
    WindMixCkptXY: {
        widget: "ckpt_data",
        url: "/windmix/checkpoints",
        listKey: "checkpoints",
        previewType: "checkpoints",
        viewKey: "WindMix.ckptModalView",
        memoKey: "WindMix.ckptModalMemo",
        label: "底模",
    },
};
// 取节点所属配置（未知类型退回 UNet，保证老数据不炸）
const conf = (nodeOrType) => TYPE_CONF[(typeof nodeOrType === "string" ? nodeOrType : nodeOrType?.type)] || TYPE_CONF.WindMixUNetXY;

// 模型比 LoRA 多几种后缀，显示时都当成「扩展名」削掉
const MODEL_EXT = /\.(safetensors|ckpt|pt|bin|pth|gguf|onnx)$/i;
const stemOf = (n) => n.replace(MODEL_EXT, "");
const extOf = (n) => { const m = n.match(MODEL_EXT); return m ? m[0] : ""; };
const nameOf = (p) => stemOf(baseOf(p || ""));

//==============================================================================
// 数据源（/windmix/unets = folder_paths 的 diffusion_models）
//==============================================================================
// 列表按「节点类型」各缓一份（UNet 与 Checkpoint 是两个不同的目录）
const _allCache = {};
let _previewVer = 0;
async function getModelFiles(nodeOrType, force = false) {
    const c = conf(nodeOrType);
    if (_allCache[c.url] == null || force) {
        try {
            const r = await fetch(c.url);
            const j = await r.json();
            _allCache[c.url] = Array.isArray(j[c.listKey]) ? j[c.listKey] : [];
        } catch (e) {
            _allCache[c.url] = [];
        }
    }
    return _allCache[c.url] || [];
}

// 同 LoRA 侧：R 刷新走官方扩展钩子 refreshComboInNodes（见文件末尾），这个补丁只兜老前端
function invalidateCache() {
    Object.keys(_allCache).forEach((k) => delete _allCache[k]);
    _previewVer += 1;   // 同名模型被替换后预览图也要跟着换
}
function refreshAllNodes() {
    invalidateCache();
    // 两种数据源都实拉一次，再按节点类型分发
    return Promise.all(Object.keys(TYPE_CONF).map((t) => getModelFiles(t, true))).then(() => {
        (app.graph?._nodes || []).forEach((n) => {
            if (n && NODE_TYPES.includes(n.type) && n.__xyBuilt) refreshKnown(n);
        });
        // 刷新时弹窗正开着：直接把它的数据换掉并重画
        if (_bdState?.node) {
            const node = _bdState.node;
            return getModelFiles(node, true).then((all) => {
                if (_bdState?.node !== node) return;
                node.__xyAll = all;
                node.__xyKnown = new Set(all.map(norm));
                _bdState.redraw?.();
            });
        }
    });
}
if (app.refreshCombo) {
    const _orig = app.refreshCombo.bind(app);
    app.refreshCombo = function (...args) {
        invalidateCache();
        return _orig(...args);
    };
}

// 预览图同样只认「模型同目录同名图片」，走 WindMix 自己的路由（type = folder_paths 的目录键）
function previewUrl(name, ptype = "diffusion_models") {
    return `/WM_studio/prompt-studio/model-preview?type=${encodeURIComponent(ptype)}` +
        `&name=${encodeURIComponent(name)}&v=${_previewVer}`;
}

//==============================================================================
// 数据读写
//==============================================================================
function getDataWidget(node) {
    const name = conf(node).widget;
    return (node.widgets || []).find((w) => w.name === name);
}

function loadStack(node) {
    const w = getDataWidget(node);
    let arr = [];
    try {
        const p = JSON.parse(w?.value || "[]");
        arr = Array.isArray(p) ? p : (p && Array.isArray(p.models) ? p.models : (p && Array.isArray(p.loras) ? p.loras : []));
    } catch (e) {
        arr = [];
    }
    // 旧版顶部的「文件夹筛选」已经并进弹窗和搜索了，属性里那份残留不再写回
    if (node.properties && "folder_filter" in node.properties) delete node.properties.folder_filter;

    const out = [];
    const seen = new Set();
    const push = (e) => {
        if (!e || typeof e !== "object") return;
        if (Array.isArray(e.loras)) { e.loras.forEach(push); return; }   // 老数据里若有分组，就地摊平
        const name = (e.name || "").toString();
        if (!name || seen.has(norm(name))) return;
        seen.add(norm(name));
        out.push({ on: e.on !== false, name });
    };
    arr.forEach(push);
    node.__xyStack = out;
    node.__xySel = node.__xySel || null;
    node.__xyKw = "";
}

function syncData(node) {
    const w = getDataWidget(node);
    if (!w) return;
    w.value = JSON.stringify((node.__xyStack || []).map((e) => ({ on: e.on !== false, name: e.name })));
    node.setDirtyCanvas?.(true, false);
}

const allRows = (node) => node.__xyStack || [];
const activeRows = (node) => allRows(node).filter((r) => r.on);
const usedPaths = (node) => new Set(allRows(node).map((r) => norm(r.name)).filter(Boolean));
const findRow = (node, name) => allRows(node).find((r) => norm(r.name) === norm(name)) || null;
const rowFull = (node) => allRows(node).length >= MAX_ROWS;
const isMissing = (node, name) => !!name && node.__xyKnown && !node.__xyKnown.has(norm(name));

function removeRow(node, name) {
    const i = allRows(node).findIndex((r) => norm(r.name) === norm(name));
    if (i >= 0) node.__xyStack.splice(i, 1);
}
function shiftRow(node, name, d) {
    const rows = allRows(node), i = rows.findIndex((r) => norm(r.name) === norm(name));
    const j = i + d;
    if (i < 0 || j < 0 || j >= rows.length) return;
    rows.splice(j, 0, rows.splice(i, 1)[0]);
}
// 拖到某行的上半区插在前面，下半区插在后面
function moveRow(node, fromName, toEntry, after) {
    const src = findRow(node, fromName);
    if (!src || src === toEntry) return;
    removeRow(node, fromName);
    const i = allRows(node).indexOf(toEntry);
    if (i < 0) { node.__xyStack.push(src); return; }
    node.__xyStack.splice(after ? i + 1 : i, 0, src);
}

//==============================================================================
// body 级浮层：候选下拉 / 悬停预览（各自单例，和 LoRA 那两套并行存在）
//==============================================================================
let _ac = null, _acNode = null, _acItems = [], _acIdx = 0;
function getAc() {
    if (!_ac) {
        _ac = document.createElement("div");
        _ac.className = "wm2-ac";
        _ac.addEventListener("mousedown", (e) => { if (e.target.closest(".it")) e.preventDefault(); });
        _ac.addEventListener("click", (e) => {
            const it = e.target.closest(".it");
            if (!it || !_acNode) return;
            pickAc(_acNode, it.dataset.p);
        });
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
// 下拉和节点同宽、跟着画布缩放，位置贴着搜索框下方
function positionAc() {
    if (!_ac || !_acNode) return;
    const anchor = _acNode.__wm2Search || _acNode.__wm2SearchInput;
    if (!anchor?.getBoundingClientRect) return;
    const r = anchor.getBoundingClientRect();
    const k = canvasScale(_acNode) || 1;
    const cont = _acNode.__wm2Container;
    let w = NaN;
    if (cont) w = cont.getBoundingClientRect().width / k;
    if (!Number.isFinite(w) || w < 160) w = Math.max(240, Math.round(r.width / k));
    _ac.style.width = Math.round(w) + "px";
    _ac.style.transform = `scale(${k})`;
    _ac.style.transformOrigin = "top left";
    _ac.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 40)) + "px";
    _ac.style.top = r.bottom + 5 * k + "px";
}
function acMatches(node) {
    const kw = (node.__xyKw || "").trim().toLowerCase();
    const used = usedPaths(node);
    let items = (node.__xyAll || []).filter((p) => !used.has(norm(p)));
    if (kw) items = items.filter((p) => norm(p).toLowerCase().includes(kw) || nameOf(p).toLowerCase().includes(kw));
    const folds = new Map();
    items.forEach((p) => { const d = dirOf(p); if (!folds.has(d)) folds.set(d, []); folds.get(d).push(p); });
    return [...folds.entries()];
}
function renderAc(node) {
    const ac = getAc();
    // LoRA 节点那份下拉是独立单例，两边不能同时挂着
    document.querySelectorAll(".wm2-ac.open").forEach((x) => { if (x !== ac) x.classList.remove("open"); });
    _acNode = node;
    const kw = (node.__xyKw || "").trim();
    _acItems = [];
    let html = "";
    acMatches(node).forEach(([f, list]) => {
        html += `<div class="fold">${IC.folder} ${f ? f.replace(/&/g, "&amp;") : "根目录"}</div>`;
        list.forEach((p) => {
            if (_acItems.length >= 20) return;
            const idx = _acItems.push(p) - 1;
            html += `<div class="it${idx === _acIdx ? " hi" : ""}" data-p="${p.replace(/"/g, "&quot;")}">
              <span class="th">${nameOf(p).slice(0, 2).toUpperCase()}</span>
              <span class="nm">${hlName(nameOf(p), kw)}</span>
            </div>`;
        });
    });
    if (!_acItems.length) html = `<div class="none">${node.__xyKw ? "无匹配结果（已添加的不再出现）" : `库里没有可选的${conf(node).label}`}</div>`;
    else html += `<div class="foot"><span>↑↓ 选择</span><span>Enter 添加</span><span>Esc 收起</span><span style="margin-left:auto">最多 20 条</span></div>`;
    ac.innerHTML = html;
    positionAc();
    ac.classList.add("open");
}
function acMove(d) {
    if (!_acItems.length) return;
    _acIdx = Math.max(0, Math.min(_acIdx + d, _acItems.length - 1));
    if (_acNode) renderAc(_acNode);
}
function pickAc(node, path) {
    if (!path) return;
    node.__xyKw = "";
    if (node.__wm2SearchInput) node.__wm2SearchInput.value = "";
    node.__wm2Search?.classList.remove("has-q");
    addEntry(node, path);
    closeAc();
}

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
    let left = r.right + GAP;
    const modalEl = anchor.closest(".wm2-modal");
    if (modalEl) {
        const mr = modalEl.getBoundingClientRect();
        const fit = mr.right - PV_W - 8;
        if (left > fit && fit >= mr.left + 8) left = fit;
        else if (left + PV_W > window.innerWidth - 8) left = r.left - PV_W - GAP;
    } else if (left + PV_W > window.innerWidth - 8) {
        left = r.left - PV_W - GAP;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - PV_W - 8));
    pv.style.left = left + "px";
    pv.style.top = Math.max(8, Math.min(r.top - 10, window.innerHeight - PV_H - 8)) + "px";
}
function showPv(name, anchor, ptype) {
    if (!name || !anchor?.getBoundingClientRect) return;
    const token = ++_pvToken;
    const box = document.createElement("img");
    box.onload = () => {
        if (token !== _pvToken) return;
        const img = getPv().querySelector(".img");
        img.innerHTML = "";
        img.append(box);
        positionPv(anchor);
        _pv.classList.add("open");
    };
    box.onerror = () => { if (token === _pvToken) hidePv(); };
    box.src = previewUrl(name, ptype);
}
function hidePv() {
    clearTimeout(_pvTimer);
    _pvToken += 1;
    if (_pv) _pv.classList.remove("open");
}
// 悬停延时：行 400ms，弹窗条目 300ms（和 LoRA 卡片一致）
function hoverPv(name, anchor, delay, ptype) {
    anchor.addEventListener("mouseenter", () => {
        if (!name) return;
        clearTimeout(_pvTimer);
        _pvTimer = setTimeout(() => showPv(name, anchor, ptype), delay);
    });
    anchor.addEventListener("mouseleave", hidePv);
}

//==============================================================================
// 添加 / 替换
//==============================================================================
function addEntry(node, path) {
    if (rowFull(node)) { warn(node, `已达上限 ${MAX_ROWS} 条`); return null; }
    if (usedPaths(node).has(norm(path))) { warn(node, `列表里已经有「${nameOf(path)}」了`); return null; }
    const entry = { on: true, name: path };
    node.__xyStack.push(entry);
    node.__xySel = norm(path);
    syncData(node);
    renderRows(node, true);
    return entry;
}

function replaceEntry(node, entry, path) {
    if (!path) return false;
    if (norm(path) === norm(entry.name)) return true;
    if (usedPaths(node).has(norm(path))) { warn(node, `列表里已经有「${nameOf(path)}」了`); return false; }
    const wasSel = node.__xySel === norm(entry.name);
    entry.name = path;
    if (wasSel) node.__xySel = norm(path);
    syncData(node);
    renderRows(node, true);
    warn(node, `已换成 ${nameOf(path)}`);
    return true;
}

//==============================================================================
// 渲染
//==============================================================================
function makeRow(node, entry) {
    const missing = isMissing(node, entry.name);
    const sel = node.__xySel === norm(entry.name);
    // 描边画在 wrap 上，行只负责排内容
    const wrap = document.createElement("div");
    wrap.className = "wm2-wrap" + (entry.on ? "" : " off") + (missing ? " miss" : "") + (sel ? " sel" : "");
    wrap.dataset.name = entry.name;

    const row = document.createElement("div");
    row.className = "wm2-row" + (entry.on ? "" : " off") + (missing ? " miss" : "") + (sel ? " sel" : "");
    wrap.append(row);

    const grip = document.createElement("span");
    grip.className = "wm2-grip";
    grip.innerHTML = IC.grip;
    grip.title = "拖动排序";
    grip.draggable = true;
    grip.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        node.__xyDrag = norm(entry.name);
        node.__xySel = norm(entry.name);
        row.classList.add("drag");
        try { e.dataTransfer.setData("text/plain", `wmxy:${node.id}:row`); } catch (err) {}
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setDragImage(row, 16, 12); } catch (err) {}
    });
    grip.addEventListener("dragend", () => { node.__xyDrag = null; clearMarks(node); renderRows(node, true); });
    row.append(grip);

    row.append(makeToggle(entry.on, () => {
        entry.on = !entry.on;
        syncData(node);
        renderRows(node, true);
    }));

    const name = document.createElement("span");
    name.className = "wm2-name" + (missing ? " miss" : "");
    const stemSpan = document.createElement("span");
    stemSpan.textContent = nameOf(entry.name);
    name.append(stemSpan);
    const ext = extOf(entry.name || "");
    if (ext) { const s = document.createElement("span"); s.className = "ext"; s.textContent = ext; name.append(s); }
    name.title = (entry.name || `未选择${conf(node).label}`) + `\n点击重新选择其他${conf(node).label}`;
    name.onclick = (e) => {
        e.stopPropagation();
        node.__xySel = norm(entry.name);
        openModal(node, { replace: entry });
    };
    hoverPv(entry.name, name, 400, conf(node).previewType);
    row.append(name);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "wm2-ico del";
    del.textContent = "✕";
    del.title = "删除";
    del.onclick = (e) => {
        e.stopPropagation();
        removeRow(node, entry.name);
        if (node.__xySel === norm(entry.name)) node.__xySel = null;
        syncData(node);
        renderRows(node, true);
    };
    row.append(del);

    row.addEventListener("dragover", (e) => {
        if (!node.__xyDrag || node.__xyDrag === norm(entry.name)) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        clearMarks(node);
        const r = row.getBoundingClientRect();
        row.classList.add(e.clientY > r.top + r.height / 2 ? "over-bot" : "over-top");
    });
    row.addEventListener("drop", (e) => {
        const from = node.__xyDrag;
        if (!from || from === norm(entry.name)) return;
        e.preventDefault(); e.stopPropagation();
        const r = row.getBoundingClientRect();
        moveRow(node, from, entry, e.clientY > r.top + r.height / 2);
        clearMarks(node);
        syncData(node);
        renderRows(node, true);
    });

    return wrap;
}

function makeToggle(on, onclick, title) {
    const t = document.createElement("span");
    t.className = "wm2-tgl" + (on ? " on" : "");
    t.title = title || (on ? "已启用" : "已停用");
    t.onclick = (e) => { e.stopPropagation(); onclick(); };
    return t;
}

function clearMarks(node) {
    (node.__wm2Container?.querySelectorAll(".over-top,.over-bot,.drag") || []).forEach((x) => {
        x.classList.remove("over-top", "over-bot", "drag");
    });
}

function renderRows(node, keepScroll) {
    const list = node.__xyList;
    if (!list) return;
    const top = list.scrollTop;
    list.innerHTML = "";

    const head = document.createElement("div");
    head.className = "wm2-lhead";
    head.style.cursor = "default";           // 模型没有强度，表头不参与横向等比调
    const all = allRows(node), act = activeRows(node);
    const allOn = all.length > 0 && act.length === all.length;
    const tallob = document.createElement("span");
    tallob.className = "tallob";
    tallob.append(makeToggle(allOn, () => {
        const turnOn = !allOn;
        all.forEach((r) => { r.on = turnOn; });
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

    const missCount = all.filter((r) => isMissing(node, r.name)).length;
    if (missCount > 0) {
        const m = document.createElement("span");
        m.className = "miss";
        m.textContent = `⚠ ${missCount} 缺失`;
        head.append(m);
    }

    const sl = document.createElement("span");
    sl.className = "slabel";
    sl.innerHTML = `${conf(node).label}<span class="hint">点名称重选 · 拖手柄排序</span>`;
    head.append(sl);
    list.append(head);

    if (!all.length) {
        const e = document.createElement("div");
        e.className = "wm2-empty";
        e.innerHTML = `还没有${conf(node).label}<br>上方<b>搜索框</b>输入关键词回车，或点下方<b>Add ${conf(node).label}</b> 浏览全部`;
        list.append(e);
    }
    all.forEach((entry) => list.append(makeRow(node, entry)));

    if (keepScroll) list.scrollTop = top;
}

//==============================================================================
// 浏览弹窗：与 LoRA 弹窗同一套交互（列表/缩略图双视图 + 层级目录树 + 文件夹记忆），
// 样式全部走 wm2-* 共用件，只是数据源和「已添加」判重按 UNet 的扁平列表算
//==============================================================================
let _bd = null, _bdState = null;
// 视图 + 文件夹记忆：与 LoRA 弹窗同一套行为；UNet 和 Checkpoint 各记各的一份
// （键在 TYPE_CONF.viewKey / memoKey）。弹窗是单实例，打开时按所属节点把那一份读进来，
// 之后读写都走 _viewKey / _memoKey 这两个「当前弹窗所属」的键。
let _uv = "grid";
let _viewKey = TYPE_CONF.WindMixUNetXY.viewKey;
let _memoKey = TYPE_CONF.WindMixUNetXY.memoKey;
const CHECK_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 L6.5 12 L13 4"/></svg>`;
const readView = (k) => { try { return localStorage.getItem(k) === "list" ? "list" : "grid"; } catch (e) { return "grid"; } };
const readMemo = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch (e) { return {}; } };
let _memo = {};
function saveMemo(dir, collapsed) {
    _memo = { dir, collapsed: [...collapsed] };
    try { localStorage.setItem(_memoKey, JSON.stringify(_memo)); } catch (e) {}
}
function memoDir(all) {
    const d = _memo.dir;
    if (!d) return null;                       // 没记忆 / 记忆是「全部」
    if (!all.length) return d;                 // 列表还没到，先按记忆留着，别误报
    return all.some((p) => { const x = dirOf(p); return x === d || x.startsWith(d + "/"); }) ? d : null;
}
function closeModal() {
    if (_bd) _bd.classList.remove("open");
    _bdState = null;
    hidePv();
}
function openModal(node, opts = {}) {
    injectStyle();
    const repl = opts.replace || null;
    const tconf = conf(node);
    // 换到本节点所属的那份视图/文件夹记忆
    _viewKey = tconf.viewKey;
    _memoKey = tconf.memoKey;
    _uv = readView(_viewKey);
    _memo = readMemo(_memoKey);
    const LBL = tconf.label;   // 弹窗里的文案按节点类型说「模型」还是「底模」
    _bd = _bd && _bd.isConnected ? _bd : (() => {
        const b = document.createElement("div");
        b.className = "wm2-bd";
        document.body.append(b);
        return b;
    })();
    const want = _memo.dir || null;
    _bdState = {
        node, kw: "", dir: memoDir(node.__xyAll || []), sel: new Set(), replace: repl,
        collapsed: new Set(Array.isArray(_memo.collapsed) ? _memo.collapsed : []),
    };
    const bd = _bd;
    bd.innerHTML = "";
    bd.classList.add("open");
    _bdState.redraw = () => { renderSide(); renderBody(); };
    // 弹窗每次打开实拉一次列表：新丢进模型目录的不用先按 R 就能选到（按节点类型取对应目录）
    getModelFiles(node, true).then((all) => {
        node.__xyAll = all;
        node.__xyKnown = new Set(all.map(norm));
        if (node.__xyBuilt) renderRows(node, true);
        if (_bdState?.node !== node) return;
        const d = all.length ? memoDir(all) : null;
        if (want && all.length && d === null) {
            // 记忆里的文件夹没了：说一句并把记忆清掉，免得每次都提示
            saveMemo(null, _bdState.collapsed);
            warn(node, `记忆的文件夹「${want}」已不存在，回到「全部」`);
        }
        _bdState.dir = d;
        renderSide();
        renderBody();
    });

    const m = document.createElement("div");
    m.className = "wm2-modal";
    bd.append(m);

    const h = document.createElement("h4");
    h.textContent = repl ? `重新选择${LBL} · ${nameOf(repl.name)}` : `Add ${LBL}`;
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
    kw.placeholder = `搜索${LBL}名称 / 文件夹…`;
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
    // 缩略图网格视图（与 LoRA 同款：信息行 + 卡片网格）
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
        closeModal();
        if (repl) replaceEntry(node, repl, picks[0]);
        else {
            let added = 0;
            picks.forEach((p) => { if (addEntry(node, p)) added += 1; });
            if (added) warn(node, `已添加 ${added} 个${LBL}`);
        }
    };
    foot.append(cnt, sp, cancel, ok);
    m.append(foot);

    function kwFiltered() {
        const kw2 = _bdState.kw.trim().toLowerCase();
        return (node.__xyAll || []).filter((p) => !kw2 ||
            norm(p).toLowerCase().includes(kw2) || nameOf(p).toLowerCase().includes(kw2));
    }
    // 层级目录树：sd35 / sd35/flux 这类路径拆成父子节点，count 含所有子孙文件
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
        const used = usedPaths(node);
        const hideUsed = !repl;                 // 已添加过的不再出现，替换模式除外
        const kw2 = _bdState.kw.trim().toLowerCase();
        const d = _bdState.dir;
        return (node.__xyAll || []).filter((p) => {
            if (d !== null) { const pd = dirOf(p); if (pd !== d && !pd.startsWith(d + "/")) return false; }
            if (kw2 && !norm(p).toLowerCase().includes(kw2) && !nameOf(p).toLowerCase().includes(kw2)) return false;
            return true;
        }).filter((p) => !hideUsed || !used.has(norm(p)));
    }
    function renderSide() {
        side.innerHTML = "";
        const all = (node.__xyAll || []).length;
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
                    saveMemo(_bdState.dir, _bdState.collapsed);
                    renderSide();
                };
                it.append(ch);
            }
            it.insertAdjacentHTML("beforeend", IC.folder);
            const s = document.createElement("span");
            s.className = "lbl";
            s.textContent = label;
            const c = document.createElement("span");
            c.className = "n";
            c.textContent = n;
            it.append(s, c);
            it.onclick = () => { _bdState.dir = dir; saveMemo(dir, _bdState.collapsed); renderSide(); renderBody(); };
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
            ? (_bdState.sel.size ? `换成：${nameOf([..._bdState.sel][0])}` : `单选一个${LBL}`)
            : `已选 ${_bdState.sel.size} 个 · 可多选`;
        ok.disabled = _bdState.sel.size === 0;
    }
    // 角标：替换模式标出「当前」
    function chipOf(p) {
        return repl && norm(p) === norm(repl.name) ? "当前" : "";
    }
    // 两种视图共用的点选逻辑（网格卡片与列表条目行为完全一致）
    function togglePick(p) {
        if (repl) { _bdState.sel.clear(); _bdState.sel.add(p); }   // 单选
        else if (_bdState.sel.has(p)) _bdState.sel.delete(p);
        else _bdState.sel.add(p);
        refreshSelUI();
    }
    function emptyText() {
        return repl ? `没有可选的${LBL}` : `没有匹配的${LBL}（已添加过的不再出现）`;
    }
    // 缩略图网格：上图下名 + 右上角勾选圈；卡片自带预览图，不再挂悬停浮窗
    function renderGrid() {
        grid.innerHTML = "";
        const its = items();
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
            const abG = document.createTextNode(nameOf(p).slice(0, 2).toUpperCase());
            im.append(abG);
            const img = document.createElement("img");
            img.loading = "lazy";
            img.alt = "";
            img.onerror = () => img.remove();
            img.onload = () => abG.remove();   // 有图撤文字，无图留首字母兜底
            img.src = previewUrl(p, conf(node).previewType);
            im.append(img);
            const cap = document.createElement("div");
            cap.className = "cap";
            const t = document.createElement("span");
            t.className = "t";
            t.textContent = nameOf(p);
            t.title = p;
            const d = document.createElement("span");
            d.className = "d";
            d.textContent = dirOf(p) || "根目录";
            cap.append(t, d);
            const chk = document.createElement("span");
            chk.className = "chk";
            chk.innerHTML = CHECK_SVG;
            cd.append(im, cap, chk);
            const chip = chipOf(p);
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
            const abT = document.createTextNode(nameOf(p).slice(0, 2).toUpperCase());
            th.append(abT);
            const im = document.createElement("img");
            im.loading = "lazy";
            im.onerror = () => im.remove();
            im.onload = () => abT.remove();   // 图加载成功就撤占位文字，图片满框
            im.src = previewUrl(p, conf(node).previewType);
            th.append(im);
            const nm = document.createElement("span");
            nm.className = "nm";
            const tt = document.createElement("span");
            tt.className = "t";
            tt.textContent = nameOf(p);
            tt.title = p;
            nm.append(tt);
            // 勾选方框只是选中态的显示，点击交给整条 item 处理
            const tg = document.createElement("span");
            tg.className = on ? "wm2-tgl on" : "wm2-tgl";
            it.append(th, nm);
            const chip = chipOf(p);
            if (chip) {
                const lab = document.createElement("span");
                lab.className = "tagu";
                lab.textContent = chip;
                it.append(lab);
            }
            it.append(tg);
            it.onclick = () => togglePick(p);
            hoverPv(p, nm, 300, conf(node).previewType);
            list.append(it);
        });
        refreshSelUI();
    }
    // 按当前视图渲染对应一侧；切换时不重建，勾选集合两边共享
    function renderBody() {
        if (_uv === "grid") renderGrid();
        else renderList();
    }
    function applyView() {
        const g = _uv === "grid";
        m.classList.toggle("wide", g);
        // 网格：弹窗高度锁死 80vh，卡片固定 4 列，溢出交给网格内部滚动条；列表：按内容自适应
        m.classList.toggle("gridmode", g);
        list.style.display = g ? "none" : "";
        gridWrap.style.display = g ? "" : "none";
        bList.classList.toggle("on", !g);
        bGrid.classList.toggle("on", g);
        renderBody();
    }
    bList.onclick = () => { _uv = "list"; try { localStorage.setItem(_viewKey, "list"); } catch (e) {} applyView(); };
    bGrid.onclick = () => { _uv = "grid"; try { localStorage.setItem(_viewKey, "grid"); } catch (e) {} applyView(); };
    renderSide();
    applyView();

    bd.onclick = (e) => { if (e.target === bd) closeModal(); };
}

//==============================================================================
// 主体 UI
//==============================================================================
function buildUI(node) {
    if (node.__xyBuilt) return;
    node.__xyBuilt = true;
    injectStyle();

    hideWidget(node, getDataWidget(node));
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
    input.placeholder = `搜索${conf(node).label}名称 / 文件夹… 回车添加`;
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

    const openAc = () => { _acIdx = 0; renderAc(node); };
    input.addEventListener("focus", () => {
        search.classList.add("focus");
        if (node.__xyAll?.length) openAc();
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
        node.__xyKw = input.value;
        search.classList.toggle("has-q", !!input.value);
        _acIdx = 0;
        renderAc(node);
    });
    input.addEventListener("blur", () => { search.classList.remove("focus"); });
    input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "ArrowDown") { e.preventDefault(); acMove(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); acMove(-1); }
        else if (e.key === "Enter") {
            e.preventDefault();
            const p = _acItems[_acIdx];
            if (p) pickAc(node, p);
            else if (node.__xyKw.trim()) warn(node, `没找到「${node.__xyKw.trim()}」，换个关键词或用 Add ${conf(node).label} 浏览`);
        } else if (e.key === "Escape") { closeAc(); input.blur(); }
    });
    clr.onclick = (e) => { e.stopPropagation(); node.__xyKw = ""; input.value = ""; search.classList.remove("has-q"); input.focus(); };
    clr.onmousedown = (e) => e.preventDefault();

    // 2) 列表（固定高度 + 内滚动）
    const list = document.createElement("div");
    list.className = "wm2-list";
    list.tabIndex = 0;
    c.append(list);
    node.__xyList = list;
    list.addEventListener("drop", (e) => {
        if (!node.__xyDrag || e.target.closest(".wm2-row")) return;
        e.preventDefault(); e.stopPropagation();
        const from = node.__xyDrag;
        node.__xyDrag = null;
        const rows = allRows(node);
        const src = findRow(node, from);
        if (src) {
            removeRow(node, from);
            rows.push(src);
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
        const idx = rows.findIndex((r) => norm(r.name) === node.__xySel);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const d = e.key === "ArrowUp" ? -1 : 1;
            if (e.ctrlKey && node.__xySel) shiftRow(node, node.__xySel, d);
            else { const n = rows[Math.max(0, Math.min(rows.length - 1, (idx < 0 ? 0 : idx) + d))]; if (n) node.__xySel = norm(n.name); }
            syncData(node);
            renderRows(node, true);
        } else if (e.key === " " && node.__xySel) {
            e.preventDefault();
            const r = findRow(node, node.__xySel);
            if (r) { r.on = !r.on; syncData(node); renderRows(node, true); }
        } else if (e.key === "Delete" && node.__xySel) {
            e.preventDefault();
            removeRow(node, node.__xySel);
            node.__xySel = null;
            syncData(node);
            renderRows(node, true);
        }
    });

    // 3) 提示条
    const w = document.createElement("div");
    w.className = "wm2-warn";
    c.append(w);
    node.__wm2Warn = w;

    // 4) 底部按钮（模型不分组，所以只有 Add 模型，占满整行）
    const addrow = document.createElement("div");
    addrow.className = "wm2-addrow";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "wm2-addbtn";
    addBtn.textContent = `＋ Add ${conf(node).label}`;
    addBtn.onclick = () => openModal(node, {});
    addrow.append(addBtn);
    c.append(addrow);

    const domWidget = node.addDOMWidget("wm_xy_unet_ui", "div", c, { serialize: false });
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
    return getModelFiles(node).then((all) => {
        node.__xyAll = all;
        node.__xyKnown = new Set(all.map(norm));
        if (node.__xyBuilt) renderRows(node, true);
    });
}

function patchNodeType(nodeType) {
    const origCreate = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        origCreate?.apply(this, arguments);
        try { buildUI(this); } catch (e) { console.warn("[WindMix] unet ui onNodeCreated failed", e); }
    };
    const origConf = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        origConf?.apply(this, arguments);
        try {
            if (!this.__xyBuilt) buildUI(this);
            loadStack(this);
            renderRows(this, true);
            ensureNodeFits(this);   // workflow 里存的尺寸可能比界面需要的矮
        } catch (e) { console.warn("[WindMix] unet ui onConfigure failed", e); }
    };
    const origResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
        origResize?.apply(this, arguments);
        try { if (this.__xyBuilt) lockBottomBar(this); } catch (e) {}
    };
}

document.addEventListener("pointerdown", (e) => {
    if (!_ac?.classList.contains("open")) return;
    // 只认「自己那个节点的搜索框」：类名和 LoRA 节点共用，按类判断会互相判定为内部点击
    const inside = e.target.closest(".wm2-ac") ||
        (_acNode?.__wm2Search && e.target.closest(".wm2-search") === _acNode.__wm2Search);
    if (!inside) closeAc();
}, true);
// 弹窗没有可聚焦的遮罩，Escape 只能在 document 上兜底
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _bd?.classList.contains("open")) { e.stopPropagation(); closeModal(); }
}, true);
window.addEventListener("scroll", () => {
    if (_ac?.classList.contains("open")) positionAc();
    hidePv();
}, true);
window.addEventListener("resize", () => { if (_ac?.classList.contains("open")) positionAc(); hidePv(); });

app.registerExtension({
    name: "windmix.xy.unet.manager",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (NODE_TYPES.includes(nodeData?.name)) patchNodeType(nodeType);
    },
    setup() {
        injectStyle();
    },
    // 前端在 refreshComboInNodes() 里统一 invoke 这个钩子（R / 顶栏刷新都走它）
    refreshComboInNodes() {
        return refreshAllNodes();
    },
});
