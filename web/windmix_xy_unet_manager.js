import { app } from "/scripts/app.js";

console.log("[WindMix] xy_unet_manager.js loaded, url=", import.meta.url);

// UNet2 (⚡ XY 输入: UNet2) 的 DOM 行 UI：文件夹筛选 + Add 模型 + 逐行[开关/名称/删除]。
// 与 LoRA Stack 节点同源思路，但数据源是 diffusion_models、行只有模型名（无强度/tag）。
// 数据持久化在隐藏的 `unet_data` STRING 控件里（前端读写 JSON，ComfyUI 自动序列化）。
const NODE_TYPES = ["WindMixUNetXY"];
const DATA_WIDGET = "unet_data";
const ROW_H = 40; // 单行(仅名称)估算高度兜底（computeSize 优先实测 DOM 高度）

//==============================================================================
// UNet 模型列表（后端 /windmix/unets）
//==============================================================================
let _unetCache = null;
async function getUnetFiles(force = false) {
    if (_unetCache == null || force) {
        try {
            const r = await fetch("/windmix/unets");
            const j = await r.json();
            _unetCache = Array.isArray(j.unets) ? j.unets : [];
        } catch (e) {
            _unetCache = [];
        }
    }
    return _unetCache || [];
}

// 监听 ComfyUI 刷新（按 R）时清空模型缓存，使新下载 / 换文件夹的模型立即可见
if (app.refreshComboInsp) {
    const _origUnetRefresh = app.refreshComboInsp.bind(app);
    app.refreshComboInsp = function (...args) {
        _unetCache = null;
        _previewVer += 1; // 换图 / 新下载后让浏览器重新取图（URL 上的 v 变化）
        return _origUnetRefresh(...args);
    };
}

//==============================================================================
// 模型预览图：只认「模型同目录的同名图片」，由 WindMix 自己的后端提供
//   GET /WM_studio/prompt-studio/model-preview?type=diffusion_models&name=<相对路径>
// UNet2 的列表来自 diffusion_models（后端 /windmix/unets），后端 _resolve_model_path
// 已放开任意 folder_paths 类型，故这里传 diffusion_models 即可。
// 找不到同名图返回 404 → 浮窗整个不显示。刻意不接外部插件（曾用 /api/lm/...）。
//==============================================================================
const WM_PREVIEW_TYPE = "diffusion_models";
let _previewVer = 0; // 按 R 刷新时 +1，绕过浏览器 1 小时的图片缓存

// 候选 src 列表；后端 404 时 applyImgCandidates 会把浮窗隐藏（不留空框）
async function previewCandidates(name) {
    if (!name || name === "None") return [];
    return [
        `/WM_studio/prompt-studio/model-preview?type=${WM_PREVIEW_TYPE}` +
            `&name=${encodeURIComponent(name)}&v=${_previewVer}`,
    ];
}

// img 依次尝试候选 src，全部失败则隐藏（不留占位）；onFail 为最终失败回调
function applyImgCandidates(img, cands, onFail) {
    let i = 0;
    img.style.display = "";
    img.onerror = () => {
        i += 1;
        if (i < cands.length) img.src = cands[i];
        else { img.style.display = "none"; if (onFail) onFail(); }
    };
    if (cands.length) img.src = cands[0];
    else { img.style.display = "none"; if (onFail) onFail(); }
}

// ---- hover 预览浮窗（单例，跟随鼠标；悬停行内模型名 / 选择器条目时显示）----
let _previewPop = null;
let _popToken = 0;
function getPreviewPop() {
    if (!_previewPop || !_previewPop.isConnected) {
        _previewPop = document.createElement("div");
        _previewPop.className = "wm-xy-preview";
        _previewPop.style.display = "none";
        _previewPop.append(document.createElement("img"));
        document.body.append(_previewPop);
    }
    return _previewPop;
}
function movePreviewPop(e) {
    if (!_previewPop || _previewPop.style.display === "none") return;
    const w = _previewPop.offsetWidth || 300;
    const h = _previewPop.offsetHeight || 240;
    let x = e.clientX + 18, y = e.clientY + 14;
    if (x + w > window.innerWidth - 8) x = Math.max(8, e.clientX - w - 18);
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    _previewPop.style.left = x + "px";
    _previewPop.style.top = y + "px";
}
function showPreviewPop(name, e) {
    const tok = ++_popToken;
    previewCandidates(name).then((c) => {
        if (tok !== _popToken || !c.length) return;
        const pop = getPreviewPop();
        pop.style.display = "block";
        applyImgCandidates(pop.firstChild, c, () => hidePreviewPop());
        movePreviewPop(e);
    });
}
function hidePreviewPop() {
    _popToken += 1; // 使途中的异步结果作废
    if (_previewPop) {
        _previewPop.style.display = "none";
        _previewPop.firstChild.removeAttribute("src");
    }
}

//==============================================================================
// 路径 / 文件夹工具
//==============================================================================
function norm(p) {
    return (p || "").replace(/\\/g, "/");
}
function folderOf(path) {
    const np = norm(path);
    const i = np.lastIndexOf("/");
    return i >= 0 ? np.slice(0, i + 1) : "";
}
function basename(p) {
    const parts = norm(p).split("/");
    return parts[parts.length - 1] || p;
}
function enabledSetOf(node) {
    const f = node.__folderFilter;
    if (!Array.isArray(f) || f.length === 0) return null; // null = 全部
    // 根目录 "" 在匹配语义里代表"全部"，若与具体子目录并存会覆盖成不过滤，
    // 故防御性丢弃 ""，仅保留具体目录前缀。
    const cleaned = f.filter((x) => x !== "");
    if (cleaned.length === 0) return null;
    return new Set(cleaned.map(norm));
}
function itemsInFolders(all, set) {
    if (!set) return all.slice();
    return all.filter((p) => {
        const d = folderOf(p);
        for (const f of set) {
            const nf = norm(f);
            if (nf === "" || d === nf || d.startsWith(nf)) return true;
        }
        return false;
    });
}

//==============================================================================
// 数据持久化（隐藏 unet_data 控件）
//==============================================================================
function getDataWidget(node) {
    return (node.widgets || []).find((w) => w.name === DATA_WIDGET);
}
function hideWidget(node, w) {
    if (!w) return;
    // ---- Nodes 1.0（litegraph 画布，读 widget.hidden）----
    w.computeSize = () => [0, -4];
    w.type = "wm_hidden";
    w.hidden = true;
    if (w.element) w.element.style.display = "none";
    w._origDraw = w.draw;
    w.draw = function () {};
    // ---- Nodes 2.0（Vue，只认响应式 state 的 options.hidden，不看 widget.hidden）----
    // _state 常晚于 nodeCreated 就绪：先写裸 options 兜底，轮询到 _state 后再写代理，
    // 并替换整个 options 引用强制 Vue 重新求值（与 widgethider.js 同一手法）。
    const applyState = () => {
        if (w._state && w._state.options) {
            w._state.options.hidden = true;
            try { w._state.options = { ...w._state.options, hidden: true }; } catch (e) {}
        }
    };
    if (w._state) {
        applyState();
    } else if (w.options) {
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
function loadStack(node) {
    const w = getDataWidget(node);
    let arr = [];
    try {
        const p = JSON.parse(w?.value || "[]");
        arr = Array.isArray(p) ? p : (p.models || []);
    } catch (e) {
        arr = [];
    }
    node.__unetStack = arr
        .filter((e) => e && typeof e === "object")
        .map((e) => ({
            on: e.on !== false,
            name: (e.name || "").toString(),
        }));
    node.__folderFilter = Array.isArray(node.properties?.folder_filter)
        ? node.properties.folder_filter
        : null;
}
function syncData(node) {
    const w = getDataWidget(node);
    if (!w) return;
    w.value = JSON.stringify(node.__unetStack || []);
    if (!node.properties) node.properties = {};
    node.properties.folder_filter = Array.isArray(node.__folderFilter) ? node.__folderFilter : [];
}

//==============================================================================
// 文件夹树弹窗（复刻 LoRA 节点的纯文件夹树勾选，数据源 unets）
//==============================================================================
function buildTree(all) {
    const root = { folders: {}, files: [], fileCount: 0, prefix: "", name: "(根目录)", _open: true };
    const ensure = (prefix) => {
        if (!prefix) return root;
        const parts = prefix.replace(/\/$/, "").split("/");
        let n = root;
        let acc = "";
        for (const p of parts) {
            acc += p + "/";
            if (!n.folders[p]) n.folders[p] = { folders: {}, files: [], fileCount: 0, prefix: acc, name: p, _open: false };
            n = n.folders[p];
        }
        return n;
    };
    for (const path of all) {
        const np = norm(path);
        const idx = np.lastIndexOf("/");
        const dir = idx >= 0 ? np.slice(0, idx + 1) : "";
        const n = ensure(dir);
        n.files.push(path);
        n.fileCount++;
    }
    return root;
}
function collectPrefixes(node, out) {
    out.add(node.prefix);
    for (const c of Object.values(node.folders)) collectPrefixes(c, out);
    return out;
}
function openFolderModal(node, current, onApply) {
    injectStyle();
    getUnetFiles(true).then((all) => {
        const tree = buildTree(all);
        const selected = new Set(current && current.length ? current : collectPrefixes(tree, new Set()));

        let backdrop = document.getElementById("wm_unet_folder_modal");
        if (backdrop) backdrop.remove();
        backdrop = document.createElement("div");
        backdrop.id = "wm_unet_folder_modal";
        backdrop.className = "wm-xy-folder-backdrop";
        backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };

        const dialog = document.createElement("div");
        dialog.className = "wm-xy-folder-dialog";

        const header = document.createElement("div");
        header.className = "wm-xy-folder-header";
        const title = document.createElement("div");
        title.className = "wm-xy-folder-title";
        title.textContent = "选择模型文件夹";
        const closeBtn = document.createElement("div");
        closeBtn.className = "wm-xy-folder-close";
        closeBtn.textContent = "✕";
        closeBtn.onclick = () => backdrop.remove();
        header.append(title, closeBtn);

        const toolbar = document.createElement("div");
        toolbar.className = "wm-xy-folder-toolbar";
        const mkBtn = (label) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "wm-xy-btn";
            b.textContent = label;
            return b;
        };
        const selAll = mkBtn("全选");
        const selNone = mkBtn("全不选");
        selAll.onclick = () => { collectPrefixes(tree, selected); renderTree(); };
        selNone.onclick = () => { selected.clear(); renderTree(); };
        toolbar.append(selAll, selNone);

        const treeBox = document.createElement("div");
        treeBox.className = "wm-xy-folder-tree";

        function renderTree() {
            treeBox.innerHTML = "";
            const renderNode = (n, depth) => {
                const row = document.createElement("div");
                row.className = "wm-xy-folder-row";
                row.style.marginLeft = depth * 14 + "px";
                const tri = document.createElement("span");
                tri.textContent = n._open === false ? "▸" : "▾";
                tri.className = "wm-xy-folder-tri";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.className = "wm-xy-folder-cb";
                cb.checked = selected.has(n.prefix);
                cb.onchange = () => {
                    const desc = collectPrefixes(n, new Set());
                    if (cb.checked) desc.forEach((p) => selected.add(p));
                    else desc.forEach((p) => selected.delete(p));
                    renderTree();
                };
                const label = document.createElement("span");
                label.className = "wm-xy-folder-label";
                label.textContent = n.name;
                const cnt = document.createElement("span");
                cnt.className = "wm-xy-folder-cnt";
                cnt.textContent = "(" + n.fileCount + ")";
                tri.onclick = () => { n._open = n._open === false ? true : false; renderTree(); };
                row.append(tri, cb, label, cnt);
                treeBox.append(row);
                if (n._open !== false) {
                    for (const child of Object.values(n.folders)) renderNode(child, depth + 1);
                }
            };
            renderNode(tree, 0);
        }
        renderTree();

        const footer = document.createElement("div");
        footer.className = "wm-xy-folder-footer";
        const cancel = mkBtn("取消");
        cancel.style.flex = "0 0 auto";
        cancel.style.padding = "6px 18px";
        cancel.onclick = () => backdrop.remove();
        const apply = mkBtn("应用");
        apply.className = "wm-xy-btn wm-xy-btn-primary";
        apply.onclick = () => {
            const allPrefixes = collectPrefixes(tree, new Set());
            // 丢根目录 ""，仅保留具体子目录。根目录与具体目录并存时，根目录会
            // 在匹配时覆盖成"全部"，必须剔除，否则筛选失效（见 enabledSetOf）。
            const nonRoot = [...selected].filter((p) => p !== "");
            const selHasAll = [...selected].sort().join("|") === [...allPrefixes].sort().join("|");
            const isAll = nonRoot.length === 0 || selHasAll;
            onApply(isAll ? null : nonRoot, isAll);
            backdrop.remove();
        };
        footer.append(cancel, apply);

        dialog.append(header, toolbar, treeBox, footer);
        backdrop.append(dialog);
        document.body.append(backdrop);
    });
}

//==============================================================================
// 模型选择器（点名称/Add 模型时弹出，按文件夹筛选 + 搜索）
//==============================================================================
let _chooserEl = null;
let _chooserDocHandler = null;
function closeChooser() {
    hidePreviewPop();
    if (_chooserEl) { _chooserEl.remove(); _chooserEl = null; }
    if (_chooserDocHandler) {
        window.removeEventListener("pointerdown", _chooserDocHandler, true);
        _chooserDocHandler = null;
    }
}
function showChooser(node, onChoose, onCancel) {
    injectStyle();
    closeChooser();
    getUnetFiles(true).then((all) => {
        const set = enabledSetOf(node);
        const models = itemsInFolders(all, set);

        const panel = document.createElement("div");
        panel.className = "wm-xy-chooser";

        const header = document.createElement("div");
        header.className = "wm-xy-chooser-header";
        const t = document.createElement("span");
        t.className = "wm-xy-chooser-title";
        t.textContent = "选择模型";
        const x = document.createElement("span");
        x.className = "wm-xy-chooser-close";
        x.textContent = "✕";
        x.onclick = () => { closeChooser(); if (typeof onCancel === "function") onCancel(); };
        header.append(t, x);
        panel.append(header);

        const body = document.createElement("div");
        body.className = "wm-xy-chooser-body";
        const side = document.createElement("div");
        side.className = "wm-xy-chooser-side";
        const main = document.createElement("div");
        main.className = "wm-xy-chooser-main";

        const search = document.createElement("input");
        search.className = "wm-xy-chooser-search";
        search.placeholder = "搜索…";

        const list = document.createElement("div");
        list.className = "wm-xy-chooser-list";

        // 文件夹侧栏（全部 + 各文件夹，含数量徽标）
        let curDir = null; // null = 全部
        const sideItems = [];
        const dirLabel = (d) => {
            if (!d) return "(根目录)";
            const parts = String(d).replace(/\/$/, "").split("/");
            return parts[parts.length - 1] || d;
        };
        const mkSide = (label, dir, count) => {
            const it = document.createElement("div");
            it.className = "wm-xy-chooser-side-item" + (dir === null ? " active" : "");
            const lbl = document.createElement("span");
            lbl.className = "lbl";
            lbl.textContent = label;
            const n = document.createElement("span");
            n.className = "n";
            n.textContent = count;
            it.append(lbl, n);
            it.title = dir === null ? "全部模型" : dir;
            it.__dir = dir;
            it.onclick = () => {
                curDir = dir;
                sideItems.forEach((s) => s.classList.toggle("active", s.__dir === dir));
                render(search.value);
            };
            sideItems.push(it);
            side.append(it);
        };
        mkSide("全部", null, models.length);
        const dirs = new Map();
        for (const path of models) {
            const d = folderOf(path);
            dirs.set(d, (dirs.get(d) || 0) + 1);
        }
        for (const [d, c] of [...dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            mkSide(dirLabel(d), d, c);
        }

        const foot = document.createElement("div");
        foot.className = "wm-xy-chooser-foot";

        main.append(search, list, foot);
        body.append(side, main);
        panel.append(body);

        const render = (q) => {
            list.innerHTML = "";
            const ql = (q || "").trim().toLowerCase();
            let vis = curDir ? models.filter((p) => folderOf(p).startsWith(curDir)) : models.slice();
            if (ql) vis = vis.filter((l) => l.toLowerCase().includes(ql));
            foot.textContent = `共 ${vis.length} 个 · ${curDir === null ? "全部" : dirLabel(curDir)}`
                + (set ? ` · 已按 ${set.size} 个文件夹筛选` : "");
            if (!vis.length) {
                const empty = document.createElement("div");
                empty.className = "wm-xy-chooser-empty";
                empty.textContent = curDir !== null && !ql ? "该文件夹内无模型" : (set ? "所选文件夹内无模型" : "无模型");
                list.append(empty);
                return;
            }
            for (const path of vis) {
                const item = document.createElement("div");
                item.className = "wm-xy-chooser-item";
                item.textContent = basename(path);
                item.title = path;
                item.onclick = () => {
                    onChoose(path);
                    closeChooser();
                };
                // hover 预览：跟随鼠标的预览图浮窗（无预览时静默不显示）
                item.addEventListener("mouseenter", (e) => showPreviewPop(path, e));
                item.addEventListener("mousemove", movePreviewPop);
                item.addEventListener("mouseleave", hidePreviewPop);
                list.append(item);
            }
        };
        render("");
        search.oninput = () => render(search.value);

        document.body.append(panel);
        _chooserEl = panel;
        // 点击弹窗外部（空白处/其他节点）→ 关闭并取消本次添加。
        _chooserDocHandler = (e) => {
            if (_chooserEl && !_chooserEl.contains(e.target)) {
                closeChooser();
                if (typeof onCancel === "function") onCancel();
            }
        };
        setTimeout(() => window.addEventListener("pointerdown", _chooserDocHandler, true), 0);
        requestAnimationFrame(() => {
            const w = panel.offsetWidth, h = panel.offsetHeight;
            panel.style.left = Math.max(10, (window.innerWidth - w) / 2) + "px";
            panel.style.top = Math.max(10, (window.innerHeight - h) / 2 - 60) + "px";
        });
    });
}

//==============================================================================
// 行渲染
//==============================================================================
let _styleInjected = false;
function injectStyle() {
    if (_styleInjected) return;
    _styleInjected = true;
    const s = document.createElement("style");
    s.textContent = `
/* ---- 主题令牌（与 LoRA 节点同一套 --wm-lo-* 双主题变量） ---- */
.wm-xy-container, .wm-xy-chooser, .wm-xy-folder-dialog, .wm-xy-preview {
  --wm-lo-brand: #534AB7;
  --wm-lo-accent: #534AB7;
  --wm-lo-panel: #f2f2f3;
  --wm-lo-field: #ffffff;
  --wm-lo-fg: #1f1f21;
  --wm-lo-dim: #85858c;
  --wm-lo-line: #d8d8dc;
  --wm-lo-line2: #c6c6cd;
  --wm-lo-danger: #c0392b;
  --wm-lo-shadow: 0 8px 30px rgba(0,0,0,.18);
}
html.dark-theme .wm-xy-container, html.dark-theme .wm-xy-chooser,
html.dark-theme .wm-xy-folder-dialog, html.dark-theme .wm-xy-preview {
  --wm-lo-accent: #9b8af5;
  --wm-lo-panel: #2a2a2a;
  --wm-lo-field: #1e1e1e;
  --wm-lo-fg: #e6e6e6;
  --wm-lo-dim: #9a9a9a;
  --wm-lo-line: #3a3a3a;
  --wm-lo-line2: #454545;
  --wm-lo-danger: #e57373;
  --wm-lo-shadow: 0 8px 30px rgba(0,0,0,.5);
}

/* ---- WindMix UNet2 节点（与 LoRA 节点同源样式） ---- */
.wm-xy-container { display:flex; flex-direction:column; gap:6px; padding-bottom:8px; }

.wm-xy-folderbtn { display:flex; align-items:center; gap:6px; width:100%; min-width:0; min-height:34px; line-height:1;
  background:var(--wm-lo-field, #1e1e1e); color:var(--wm-lo-fg, #e6e6e6);
  border:1px solid var(--border-color, #444); border-radius:8px; padding:7px 10px; box-sizing:border-box;
  cursor:pointer; font-size:12px; margin-bottom:2px; text-align:left;
  transition:border-color .15s ease, background .15s ease; }
.wm-xy-folderbtn:hover { border-color:var(--wm-lo-accent, #9b8af5); background:rgba(83,74,183,0.08); }
.wm-xy-fb-ic { display:inline-flex; align-items:center; font-size:13px; line-height:1; }
.wm-xy-fb-txt { line-height:1; }
.wm-xy-fb-badge { margin-left:auto; background:var(--wm-lo-brand, #534AB7); color:#fff; border-radius:999px;
  padding:1px 8px; font-size:11px; line-height:14px; font-weight:600; flex:none; }
.wm-xy-fb-badge.off { background:var(--wm-lo-line2, #454545); color:var(--wm-lo-fg, #e6e6e6); font-weight:500; }
.wm-xy-fb-chev { color:var(--wm-lo-dim, #9a9a9a); font-size:10px; flex:none; }

.wm-xy-rows { display:flex; flex-direction:column; gap:2px; }

.wm-xy-row { display:flex; align-items:stretch; gap:8px; padding:4px 6px; border-radius:8px;
  transition:background .15s ease; }
.wm-xy-row:hover { background:rgba(83,74,183,0.06); }
.wm-xy-row .wm-xy-on { width:15px; height:15px; flex:none; cursor:pointer; align-self:center;
  accent-color:var(--wm-lo-accent, #9b8af5); }
.wm-xy-row .wm-xy-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  background:var(--wm-lo-field, #1e1e1e); border:1px solid var(--border-color, #444); border-radius:6px;
  padding:6px 8px; cursor:pointer; color:var(--wm-lo-fg, #e6e6e6); font-size:12px; box-sizing:border-box;
  transition:border-color .15s ease, background .15s ease; }
.wm-xy-row .wm-xy-name:hover { border-color:var(--wm-lo-accent, #9b8af5); background:rgba(83,74,183,0.10); }
.wm-xy-row .wm-xy-name:focus-visible { outline:2px solid var(--wm-lo-accent, #9b8af5); outline-offset:1px; }
.wm-xy-row .wm-xy-del { flex:none; cursor:pointer; color:var(--wm-lo-danger, #e57373); padding:3px 6px; border-radius:6px; font-size:12px;
  border:2px solid var(--border-color, #444); background:var(--wm-lo-field, #1e1e1e);
  display:inline-flex; align-items:center; justify-content:center; min-width:24px; line-height:1; font-weight:600; box-sizing:border-box;
  transition:background .15s ease, border-color .15s ease; }
.wm-xy-row .wm-xy-del:hover { background:rgba(229,115,115,0.15); border-color:var(--wm-lo-danger, #e57373); }

.wm-xy-hint { color:var(--wm-lo-fg, #e6e6e6); opacity:0.55; font-size:12px; padding:8px 4px; font-style:italic; }

.wm-xy-add { width:100%; margin-top:10px; margin-bottom:2px; padding:8px 0;
  background:transparent; color:var(--wm-lo-accent, #9b8af5);
  border:1px solid var(--wm-lo-accent, #9b8af5); border-radius:8px;
  cursor:pointer; font-size:12px; font-weight:600;
  transition:background .15s ease, border-color .15s ease; }
.wm-xy-add:hover { background:rgba(83,74,183,0.18); border-color:var(--wm-lo-accent, #9b8af5); }
.wm-xy-add:active { background:rgba(83,74,183,0.28); }

/* ---- 选模型弹窗 ---- */
.wm-xy-chooser { position:fixed; z-index:10001; width:620px; max-width:92vw; max-height:62vh; overflow:hidden;
  background:var(--wm-lo-panel, #2a2a2a); color:var(--wm-lo-fg, #e6e6e6);
  border:1px solid var(--border-color, #444); border-radius:10px;
  box-shadow:0 8px 30px rgba(0,0,0,0.5); font-family:sans-serif; font-size:12px;
  display:flex; flex-direction:column; }
.wm-xy-chooser-body { display:flex; flex:1; min-height:0; }
.wm-xy-chooser-side { flex:0 0 168px; border-right:1px solid var(--border-color, #444);
  overflow-y:auto; padding:6px; }
.wm-xy-chooser-side-item { display:flex; align-items:center; gap:6px; padding:6px 8px;
  border-radius:6px; cursor:pointer; font-size:12px; }
.wm-xy-chooser-side-item:hover { background:rgba(83,74,183,0.10); }
.wm-xy-chooser-side-item.active { background:rgba(83,74,183,0.22); }
.wm-xy-chooser-side-item .lbl { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.wm-xy-chooser-side-item .n { flex:none; font-size:11px; opacity:0.65; }
.wm-xy-chooser-main { flex:1; min-width:0; display:flex; flex-direction:column; }
.wm-xy-chooser-foot { padding:6px 12px; border-top:1px solid var(--border-color, #444);
  font-size:11px; opacity:0.65; }
.wm-xy-chooser-header { display:flex; align-items:center; justify-content:space-between;
  padding:9px 12px; border-bottom:1px solid var(--border-color, #444); }
.wm-xy-chooser-title { font-size:13px; font-weight:500; }
.wm-xy-chooser-close { cursor:pointer; color:var(--wm-lo-fg, #e6e6e6); opacity:0.6; padding:2px 6px; border-radius:6px;
  transition:background .15s ease, opacity .15s ease; }
.wm-xy-chooser-close:hover { background:rgba(255,255,255,0.08); opacity:1; }
.wm-xy-chooser-search { width:calc(100% - 20px); margin:8px 10px; padding:6px 8px;
  background:var(--wm-lo-field, #1e1e1e); color:var(--wm-lo-fg, #e6e6e6);
  border:1px solid var(--border-color, #444); border-radius:6px; box-sizing:border-box;
  font-size:12px; transition:border-color .15s ease; }
.wm-xy-chooser-search:focus { outline:none; border-color:var(--wm-lo-accent, #9b8af5); }
.wm-xy-chooser-list { flex:1; overflow-y:auto; padding-bottom:6px; }
.wm-xy-chooser-item { padding:7px 12px; cursor:pointer; border-bottom:1px solid var(--border-color, #444);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  transition:background .12s ease, color .12s ease; }
.wm-xy-chooser-item:last-child { border-bottom:none; }
.wm-xy-chooser-item:hover { background:rgba(83,74,183,0.10); }
.wm-xy-chooser-empty { padding:12px; color:var(--wm-lo-fg, #e6e6e6); opacity:0.6; }

/* ---- 文件夹树弹窗 ---- */
.wm-xy-folder-backdrop { position:fixed; left:0; top:0; width:100%; height:100%;
  background:rgba(15,17,26,0.45); z-index:10000; display:flex; align-items:center; justify-content:center; }
.wm-xy-folder-dialog { background:var(--wm-lo-panel, #2a2a2a); color:var(--wm-lo-fg, #e6e6e6);
  border-radius:12px; width:454px; max-width:92vw; max-height:86vh; display:flex; flex-direction:column;
  font-family:sans-serif; box-shadow:0 8px 30px rgba(0,0,0,0.5); overflow:hidden; }
.wm-xy-folder-header { display:flex; align-items:center; justify-content:space-between;
  padding:12px 16px; border-bottom:1px solid var(--border-color, #444); }
.wm-xy-folder-title { font-size:14px; font-weight:500; }
.wm-xy-folder-close { cursor:pointer; color:var(--wm-lo-fg, #e6e6e6); opacity:0.6; padding:2px 6px; border-radius:6px;
  transition:background .15s ease, opacity .15s ease; }
.wm-xy-folder-close:hover { background:rgba(255,255,255,0.08); opacity:1; }
.wm-xy-folder-toolbar { display:flex; gap:8px; padding:10px 16px; }
.wm-xy-folder-tree { padding:4px 16px; overflow-y:auto; max-height:60vh; }
.wm-xy-folder-row { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:6px;
  transition:background .12s ease; }
.wm-xy-folder-row:hover { background:rgba(83,74,183,0.06); }
.wm-xy-folder-tri { cursor:pointer; color:var(--wm-lo-fg, #e6e6e6); opacity:0.55; width:10px; flex:none;
  transition:opacity .12s ease; }
.wm-xy-folder-tri:hover { opacity:1; }
.wm-xy-folder-cb { accent-color:var(--wm-lo-accent, #9b8af5); cursor:pointer; flex:none; }
.wm-xy-folder-label { font-size:12px; cursor:default; }
.wm-xy-folder-cnt { font-size:11px; color:var(--wm-lo-fg, #e6e6e6); opacity:0.55; }
.wm-xy-folder-footer { display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--border-color, #444);
  justify-content:flex-end; }

/* ---- 通用按钮（弹窗内） ---- */
.wm-xy-btn { flex:1; padding:6px 0; font-size:12px; cursor:pointer;
  background:var(--wm-lo-field, #1e1e1e); color:var(--wm-lo-fg, #e6e6e6);
  border:1px solid var(--border-color, #444); border-radius:6px;
  transition:border-color .15s ease, background .15s ease; font-family:sans-serif; }
.wm-xy-btn:hover { border-color:var(--wm-lo-accent, #9b8af5); background:rgba(83,74,183,0.08); }
.wm-xy-btn-primary { flex:0 0 auto; padding:6px 18px; background:var(--wm-lo-accent, #9b8af5); color:#fff;
  border:1px solid var(--wm-lo-accent, #9b8af5); }
.wm-xy-btn-primary:hover { background:#6358c4; border-color:#6358c4; }

/* ---- 行拖动排序（⠿ 手柄） ---- */
.wm-xy-grip { flex:none; cursor:grab; color:var(--wm-lo-fg, #e6e6e6); opacity:.45; user-select:none;
  display:inline-flex; align-items:center; align-self:center; padding:0 2px;
  transition:opacity .15s ease; }
.wm-xy-grip:hover { opacity:.95; }
.wm-xy-grip:active { cursor:grabbing; }
.wm-xy-row.dragging { opacity:.35; }
.wm-xy-row.drop-target { box-shadow:0 0 0 2px var(--wm-lo-accent, #9b8af5) inset;
  background:rgba(83,74,183,0.12); border-radius:8px; }
/* ---- 模型预览浮窗 ---- */
.wm-xy-preview { position:fixed; z-index:100002; max-width:308px; padding:6px;
  background:var(--wm-lo-panel, #2a2a2a); border:1px solid var(--border-color,#555);
  border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.45); pointer-events:none; }
.wm-xy-preview img { display:block; max-width:296px; max-height:56vh; border-radius:5px; object-fit:contain; }
`;
    document.head.append(s);
}

// 让节点根据 DOM 真实高度重新计算外框尺寸（同 LoRA 节点方案）。
let _wmResizePending = new WeakSet();
function scheduleResize(node) {
    if (!node || _wmResizePending.has(node)) return;
    _wmResizePending.add(node);
    requestAnimationFrame(() => {
        _wmResizePending.delete(node);
        resizeNode(node);
    });
}
function resizeNode(node) {
    if (!node || typeof node.setSize !== "function" || typeof node.computeSize !== "function") return;
    const sz = node.computeSize();
    if (!Array.isArray(sz) || sz.length < 2 || !Number.isFinite(sz[1])) return;
    const [w, h] = sz;
    if (Math.abs((node.size?.[1] || 0) - h) < 0.5) return;
    node.setSize([Math.max(node.size?.[0] || w, w), h]);
    node.setDirtyCanvas?.(true, true);
}
function attachResizeObserver(node, el) {
    if (!el || node.__wmRO) return;
    const ro = new ResizeObserver(() => scheduleResize(node));
    ro.observe(el);
    node.__wmRO = ro;
}

//==============================================================================
// 行拖动排序（⠿ 手柄，交互同预设管理器：目标行紫色高亮，上/下半区定插入前后）
//==============================================================================
const GRIP_SVG = `<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="2.5" cy="3" r="1.6"/><circle cx="7.5" cy="3" r="1.6"/><circle cx="2.5" cy="8" r="1.6"/><circle cx="7.5" cy="8" r="1.6"/><circle cx="2.5" cy="13" r="1.6"/><circle cx="7.5" cy="13" r="1.6"/></svg>`;

// grip 手柄可拖发起排序；拖拽数据带 node.id，drop 时校验，防跨节点串位
function makeRowGrip(node, stack, i, row) {
    const grip = document.createElement("div");
    grip.className = "wm-xy-grip";
    grip.title = "拖动调整顺序";
    grip.innerHTML = GRIP_SVG;
    grip.draggable = true;
    grip.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", `wm-reorder:${node.id}:${i}`);
        e.dataTransfer.effectAllowed = "move";
        row.classList.add("dragging");
    });
    grip.addEventListener("dragend", () => row.classList.remove("dragging"));

    row.addEventListener("dragover", (e) => {
        const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
        if (types.includes("Files") || !types.includes("text/plain")) return; // 只接受本插件行拖放
        e.preventDefault();
        row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
        row.classList.remove("drop-target");
        const raw = e.dataTransfer.getData("text/plain");
        if (!raw || !raw.startsWith("wm-reorder:")) return;
        const parts = raw.split(":");
        if (String(node.id) !== parts[1]) return;
        const si = parseInt(parts[2], 10);
        if (!Number.isInteger(si) || si === i || si < 0 || si >= stack.length) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = row.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2; // 上下半区定插入前/后
        const [moved] = stack.splice(si, 1);
        let at = i;
        if (si < i) at -= 1; // 移除后目标索引左移
        if (after) at += 1;
        stack.splice(at, 0, moved);
        syncData(node);
        renderRows(node);
    });
    return grip;
}

function renderRows(node) {
    if (!node.__wmBuilt || !node.__rowsEl) return;
    injectStyle();
    const stack = node.__unetStack || [];
    node.__rowsEl.innerHTML = "";

    if (!stack.length) {
        const hint = document.createElement("div");
        hint.className = "wm-xy-hint";
        hint.textContent = "暂无模型，点击下方「+ Add 模型」添加";
        node.__rowsEl.append(hint);
    }

    stack.forEach((entry, i) => {
        const row = document.createElement("div");
        row.className = "wm-xy-row";

        const on = document.createElement("input");
        on.type = "checkbox";
        on.className = "wm-xy-on";
        on.checked = !!entry.on;
        on.onchange = () => { entry.on = on.checked; syncData(node); };

        const name = document.createElement("div");
        name.className = "wm-xy-name";
        name.textContent = entry.name ? basename(entry.name) : "（点击选择模型）";
        name.title = entry.name || "点击选择模型";
        name.onclick = () => {
            showChooser(node, (path) => {
                entry.name = path;
                syncData(node);
                name.textContent = basename(path);
                name.title = path;
            });
        };

        // 鼠标悬停模型名 → 显示预览浮窗
        if (entry.name) {
            name.addEventListener("mouseenter", (e) => showPreviewPop(entry.name, e));
            name.addEventListener("mousemove", movePreviewPop);
            name.addEventListener("mouseleave", hidePreviewPop);
        }

        const del = document.createElement("div");
        del.className = "wm-xy-del";
        del.textContent = "✕";
        del.title = "删除";
        del.onclick = () => {
            node.__unetStack.splice(i, 1);
            syncData(node);
            renderRows(node);
        };

        row.append(makeRowGrip(node, stack, i, row), on, name, del);
        node.__rowsEl.append(row);
    });

    if (node.__rowsDomWidget && node.__rowsDomWidget.computeSize) {
        scheduleResize(node);
    }
}

function updateFolderBtn(btn, node) {
    if (!btn) return;
    const f = node.__folderFilter;
    const n = Array.isArray(f) ? f.length : 0;
    btn.innerHTML =
        `<span class="wm-xy-fb-ic">📁</span><span class="wm-xy-fb-txt">文件夹筛选</span>` +
        (n ? `<span class="wm-xy-fb-badge">${n}</span>` : `<span class="wm-xy-fb-badge off">全部</span>`) +
        `<span class="wm-xy-fb-chev">▾</span>`;
}

//==============================================================================
// 核心 UI 构建
//==============================================================================
function buildCoreUI(node) {
    if (node.__wmBuilt) return;
    node.__wmBuilt = true;

    const dataW = getDataWidget(node);
    hideWidget(node, dataW);
    loadStack(node);

    const container = document.createElement("div");
    container.className = "wm-xy-container";

    // 1) 文件夹筛选按钮（DOM，置于最上）
    const folderBtn = document.createElement("button");
    folderBtn.className = "wm-xy-folderbtn";
    folderBtn.type = "button";
    folderBtn.onclick = () => {
        openFolderModal(node, node.__folderFilter || [], (sel) => {
            node.__folderFilter = sel;
            syncData(node);
            updateFolderBtn(folderBtn, node);
        });
    };
    container.append(folderBtn);
    node.__wmFolderBtn = folderBtn;

    // 2) 行容器
    const rowsEl = document.createElement("div");
    rowsEl.className = "wm-xy-rows";
    container.append(rowsEl);
    node.__rowsEl = rowsEl;

    // 3) Add 模型按钮
    const addBtn = document.createElement("button");
    addBtn.className = "wm-xy-add";
    addBtn.type = "button";
    addBtn.textContent = "+ Add 模型";
    addBtn.onclick = () => {
        const entry = { on: true, name: "" };
        node.__unetStack.push(entry);
        syncData(node);
        renderRows(node);
        showChooser(node, (path) => {
            entry.name = path;
            syncData(node);
            renderRows(node);
        }, () => {
            const idx = node.__unetStack.indexOf(entry);
            if (idx >= 0) {
                node.__unetStack.splice(idx, 1);
                syncData(node);
                renderRows(node);
            }
        });
    };
    container.append(addBtn);

    const domWidget = node.addDOMWidget("wm_unet_rows", "div", container, { serialize: false });
    domWidget.serializeValue = () => undefined;
    domWidget.computeSize = function (width) {
        const el = node.__rowsDomWidget?.element || container;
        let h = el ? (el.scrollHeight || el.offsetHeight || 0) : 0;
        if (!h) {
            const n = (node.__unetStack || []).length;
            h = n === 0 ? 50 : n * ROW_H + 70;
        }
        return [width, h + 8];
    };
    node.__rowsDomWidget = domWidget;

    updateFolderBtn(folderBtn, node);
    renderRows(node);
    attachResizeObserver(node, container);
}

//==============================================================================
// 扩展注册
//==============================================================================
function patchNodeType(nodeType) {
    const origONC = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
        origONC?.apply(this, arguments);
        try { buildCoreUI(this); }
        catch (e) { console.warn("[WindMix] unet manager onNodeCreated failed", e); }
    };
    const origOConf = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
        origOConf?.apply(this, arguments);
        try {
            if (!this.__wmBuilt) buildCoreUI(this);
            loadStack(this);
            renderRows(this);
            if (this.__wmFolderBtn) updateFolderBtn(this.__wmFolderBtn, this);
            scheduleResize(this);
        } catch (e) { console.warn("[WindMix] unet manager onConfigure failed", e); }
    };
}

app.registerExtension({
    name: "windmix.xy.unet.manager",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (NODE_TYPES.includes(nodeData?.name)) patchNodeType(nodeType);
    },
});
