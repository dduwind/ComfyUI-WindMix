import { app } from "/scripts/app.js";

// =============================================================================
// UNet2（📊 XY 输入: UNet2 · WindMixUNetXY）的界面
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

const NODE_TYPES = ["WindMixUNetXY"];
const DATA_WIDGET = "unet_data";

// 模型比 LoRA 多几种后缀，显示时都当成「扩展名」削掉
const MODEL_EXT = /\.(safetensors|ckpt|pt|bin|pth|gguf|onnx)$/i;
const stemOf = (n) => n.replace(MODEL_EXT, "");
const extOf = (n) => { const m = n.match(MODEL_EXT); return m ? m[0] : ""; };
const nameOf = (p) => stemOf(baseOf(p || ""));

//==============================================================================
// 数据源（/windmix/unets = folder_paths 的 diffusion_models）
//==============================================================================
let _allCache = null;
let _previewVer = 0;
async function getModelFiles(force = false) {
    if (_allCache == null || force) {
        try {
            const r = await fetch("/windmix/unets");
            const j = await r.json();
            _allCache = Array.isArray(j.unets) ? j.unets : [];
        } catch (e) {
            _allCache = [];
        }
    }
    return _allCache || [];
}

if (app.refreshCombo) {
    const _orig = app.refreshCombo.bind(app);
    app.refreshCombo = function (...args) {
        _allCache = null;
        _previewVer += 1;
        return _orig(...args);
    };
}

// 预览图同样只认「模型同目录同名图片」，走 WindMix 自己的路由
function previewUrl(name) {
    return `/WM_studio/prompt-studio/model-preview?type=diffusion_models` +
        `&name=${encodeURIComponent(name)}&v=${_previewVer}`;
}

//==============================================================================
// 数据读写
//==============================================================================
function getDataWidget(node) {
    return (node.widgets || []).find((w) => w.name === DATA_WIDGET);
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
    if (!_acItems.length) html = `<div class="none">${node.__xyKw ? "无匹配结果（已添加的不再出现）" : "库里没有可选的模型"}</div>`;
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
function showPv(name, anchor) {
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
    box.src = previewUrl(name);
}
function hidePv() {
    clearTimeout(_pvTimer);
    _pvToken += 1;
    if (_pv) _pv.classList.remove("open");
}
// 悬停延时：行 400ms，弹窗条目 300ms（和 LoRA 卡片一致）
function hoverPv(name, anchor, delay) {
    anchor.addEventListener("mouseenter", () => {
        if (!name) return;
        clearTimeout(_pvTimer);
        _pvTimer = setTimeout(() => showPv(name, anchor), delay);
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
    name.title = (entry.name || "未选择模型") + "\n点击重新选择其他模型";
    name.onclick = (e) => {
        e.stopPropagation();
        node.__xySel = norm(entry.name);
        openModal(node, { replace: entry });
    };
    hoverPv(entry.name, name, 400);
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
    sl.innerHTML = `模型<span class="hint">点名称重选 · 拖手柄排序</span>`;
    head.append(sl);
    list.append(head);

    if (!all.length) {
        const e = document.createElement("div");
        e.className = "wm2-empty";
        e.innerHTML = `还没有模型<br>上方<b>搜索框</b>输入关键词回车，或点下方<b>Add 模型</b> 浏览全部`;
        list.append(e);
    }
    all.forEach((entry) => list.append(makeRow(node, entry)));

    if (keepScroll) list.scrollTop = top;
}

//==============================================================================
// 浏览弹窗（多选添加 / 单选替换 + 文件夹侧栏），结构与 LoRA 的弹窗共用同一批样式
//==============================================================================
let _bd = null, _bdState = null;
function closeModal() {
    if (_bd) _bd.classList.remove("open");
    _bdState = null;
    hidePv();
}
function openModal(node, opts = {}) {
    injectStyle();
    const repl = opts.replace || null;
    _bd = _bd && _bd.isConnected ? _bd : (() => {
        const b = document.createElement("div");
        b.className = "wm2-bd";
        document.body.append(b);
        return b;
    })();
    _bdState = { node, kw: "", dir: null, sel: new Set(), replace: repl };
    const bd = _bd;
    bd.innerHTML = "";
    bd.classList.add("open");

    const m = document.createElement("div");
    m.className = "wm2-modal";
    bd.append(m);

    const h = document.createElement("h4");
    h.textContent = repl ? `重新选择模型 · ${nameOf(repl.name)}` : "Add 模型";
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "✕";
    x.onclick = () => closeModal();
    h.append(x);
    m.append(h);

    const searchWrap = document.createElement("div");
    searchWrap.className = "wm2-msearch";
    searchWrap.innerHTML = IC.mag;
    const kw = document.createElement("input");
    kw.type = "text";
    kw.placeholder = "搜索模型名称 / 文件夹…";
    kw.onkeydown = (e) => e.stopPropagation();
    kw.oninput = () => { _bdState.kw = kw.value; renderSide(); renderList(); };
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
    body.append(side, list);

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
            if (added) warn(node, `已添加 ${added} 个模型`);
        }
    };
    foot.append(cnt, sp, cancel, ok);
    m.append(foot);

    const filtered = () => {
        const kw2 = _bdState.kw.trim().toLowerCase();
        return (node.__xyAll || []).filter((p) => {
            if (_bdState.dir !== null && (dirOf(p) || "根目录") !== _bdState.dir) return false;
            if (kw2 && !norm(p).toLowerCase().includes(kw2) && !nameOf(p).toLowerCase().includes(kw2)) return false;
            return true;
        }).filter((p) => repl || !usedPaths(node).has(norm(p)));   // 顶层已添加过的不再出现
    };
    function renderSide() {
        side.innerHTML = "";
        const mk = (label, dir, n) => {
            const it = document.createElement("div");
            it.className = "f" + (_bdState.dir === dir ? " on" : "");
            it.innerHTML = IC.folder;
            const s = document.createElement("span");
            s.textContent = label;
            const c = document.createElement("span");
            c.className = "n";
            c.textContent = n;
            it.append(s, c);
            it.onclick = () => { _bdState.dir = dir; renderSide(); renderList(); };
            side.append(it);
        };
        const all = node.__xyAll || [];
        mk("全部", null, all.length);
        const m2 = new Map();
        const kw2 = _bdState.kw.trim().toLowerCase();
        all.filter((p) => !kw2 || norm(p).toLowerCase().includes(kw2))
            .forEach((p) => { const d = dirOf(p) || "根目录"; m2.set(d, (m2.get(d) || 0) + 1); });
        [...m2.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([d, n]) => mk(d, d, n));
    }
    // 选中态只改 class，不重建列表（多选时每点一次都重排一次会闪）
    function refreshSelUI() {
        list.querySelectorAll(".wm2-mit").forEach((it) => {
            const on = _bdState.sel.has(it.dataset.p);
            it.classList.toggle("on", on);
            const tg = it.querySelector(".wm2-tgl");
            if (tg) tg.className = on ? "wm2-tgl on" : "wm2-tgl";
        });
        cnt.textContent = repl
            ? (_bdState.sel.size ? `换成：${nameOf([..._bdState.sel][0])}` : "单选一个模型")
            : `已选 ${_bdState.sel.size} 个 · 可多选`;
        ok.disabled = _bdState.sel.size === 0;
    }
    function renderList() {
        list.innerHTML = "";
        const its = filtered();
        if (!its.length) {
            const e = document.createElement("div");
            e.className = "wm2-empty";
            e.textContent = repl ? "没有可选的模型" : "没有匹配的模型（已添加过的不再出现）";
            list.append(e);
        }
        its.slice(0, 200).forEach((p) => {
            const it = document.createElement("div");
            const on = _bdState.sel.has(p);
            it.className = "wm2-mit" + (on ? " on" : "");
            it.dataset.p = p;
            const th = document.createElement("span");
            th.className = "th";
            th.textContent = nameOf(p).slice(0, 2).toUpperCase();
            const im = document.createElement("img");
            im.loading = "lazy";
            im.onerror = () => im.remove();
            im.src = previewUrl(p);
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
            if (repl && norm(p) === norm(repl.name)) {
                const lab = document.createElement("span");
                lab.className = "tagu";
                lab.textContent = "当前";
                it.append(lab);
            }
            it.append(tg);
            it.onclick = () => {
                if (repl) { _bdState.sel.clear(); _bdState.sel.add(p); }
                else if (_bdState.sel.has(p)) _bdState.sel.delete(p);
                else _bdState.sel.add(p);
                refreshSelUI();
            };
            hoverPv(p, nm, 300);
            list.append(it);
        });
        refreshSelUI();
    }
    renderSide();
    renderList();

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
    input.placeholder = "搜索模型名称 / 文件夹… 回车添加";
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
            else if (node.__xyKw.trim()) warn(node, `没找到「${node.__xyKw.trim()}」，换个关键词或用 Add 模型 浏览`);
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
    addBtn.textContent = "＋ Add 模型";
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
    return getModelFiles().then((all) => {
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
});
