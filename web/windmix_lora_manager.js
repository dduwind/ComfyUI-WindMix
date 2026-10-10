import { app } from "/scripts/app.js";

console.log("[WindMix] lora_manager.js loaded, url=", import.meta.url);

// 两个节点共用这一套 DOM 行 UI：
//   顶部按钮行[新建配方(图标) + 文件夹筛选] + 逐行卡片[拨杆开关/名称/强度/tag图标/删除]
//   + 行内 tag 折叠区（收起显示预览小字，展开为编辑框）+ 可折叠配方文件夹（整组开关/双击改名/
//   组内添加）+ 全元素拖拽排序（顶层行 / 配方组 / 组内行 互相拖动调序，行可拖入配方）。
// 数据持久化在隐藏的 `lora_data` STRING 控件里：
//   [{on,name,model,tag}, ...]                      —— 顶层 LoRA 行（旧格式，完全兼容）
//   [{folder:"配方名",on,open,loras:[...]}, ...]    —— 配方文件夹（后端按显示顺序展开）
// __tagOpen / open 等 UI 状态不入持久化 JSON（open 除外，跟随保存）。
const NODE_TYPES = ["WindMixLoraStack", "WindMixLoraLoaderModelOnly", "WindMixLoraXY"];
const DATA_WIDGET = "lora_data";
const DEF_STRENGTH = 1.0;
const ROW_H = 76; // 单行卡片估算高度兜底（computeSize 优先实测 DOM 高度）

//==============================================================================
// LoRA 列表（后端 /windmix/loras）
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

// 监听 ComfyUI 刷新（按 R）时清空 LoRA 缓存，使新下载 / 换文件夹的 LoRA 立即可见
if (app.refreshComboInsp) {
    const _origLoraRefresh = app.refreshComboInsp.bind(app);
    app.refreshComboInsp = function (...args) {
        _loraCache = null;
        _previewVer += 1; // 换图 / 新下载后让浏览器重新取图（URL 上的 v 变化）
        return _origLoraRefresh(...args);
    };
}

//==============================================================================
// tag（后端 /windmix/lora_metadata 读 civitai.trainedWords）
//==============================================================================
async function fetchTag(name) {
    if (!name || name === "None") return "";
    try {
        const r = await fetch(`/windmix/lora_metadata?name=${encodeURIComponent(name)}`);
        const j = await r.json();
        return Array.isArray(j.trainedWords) ? j.trainedWords.join(", ") : "";
    } catch (e) {
        return "";
    }
}

//==============================================================================
// 模型预览图：只认「模型同目录的同名图片」，由 WindMix 自己的后端提供
//   GET /WM_studio/prompt-studio/model-preview?type=loras&name=<相对路径>
// 刻意不接外部插件的预览接口：图片数据源自包含，跨插件取图来源不唯一。
//==============================================================================
const WM_PREVIEW_TYPE = "loras";
let _previewVer = 0; // 按 R 刷新时 +1，绕过浏览器 1 小时的图片缓存

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
        _previewPop.className = "wm-preview-pop";
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
    return new Set(f.map(norm));
}
function lorasInFolders(all, set) {
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
// 数据持久化（隐藏 lora_data 控件）
// 顶层条目：{on,name,model,tag} 或 {folder,on,open,loras:[...]}
// __tagOpen 是会话级 UI 状态，syncData 时剔除。
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
function _num(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : DEF_STRENGTH;
}
function _parseEntry(e) {
    if (e.folder) {
        return {
            folder: String(e.folder),
            on: e.on !== false,
            open: e.open !== false,
            __tagOpen: false,
            loras: (Array.isArray(e.loras) ? e.loras : [])
                .filter((r) => r && typeof r === "object")
                .map((r) => ({
                    on: r.on !== false,
                    name: (r.name || "").toString(),
                    model: _num(r.model),
                    tag: (r.tag || "").toString(),
                    __tagOpen: false,
                })),
        };
    }
    return {
        on: e.on !== false,
        name: (e.name || "").toString(),
        model: _num(e.model),
        tag: (e.tag || "").toString(),
        __tagOpen: false,
    };
}
function loadStack(node) {
    const w = getDataWidget(node);
    let arr = [];
    try {
        const p = JSON.parse(w?.value || "[]");
        arr = Array.isArray(p) ? p : (p.loras || []);
    } catch (e) {
        arr = [];
    }
    node.__loraStack = arr
        .filter((e) => e && typeof e === "object")
        .map(_parseEntry);
    node.__folderFilter = Array.isArray(node.properties?.folder_filter)
        ? node.properties.folder_filter
        : null;
}
function _entryToJson(e) {
    if (e.folder) {
        return {
            folder: e.folder,
            on: e.on !== false,
            open: e.open !== false,
            loras: (e.loras || []).map(_entryToJson),
        };
    }
    return {
        on: e.on !== false,
        name: e.name || "",
        model: _num(e.model),
        tag: e.tag || "",
    };
}
function syncData(node) {
    const w = getDataWidget(node);
    if (!w) return;
    w.value = JSON.stringify((node.__loraStack || []).map(_entryToJson));
    if (!node.properties) node.properties = {};
    node.properties.folder_filter = Array.isArray(node.__folderFilter) ? node.__folderFilter : [];
}

//==============================================================================
// 拖拽路径解析： "t3"=顶层第3项  "g1"=第1个配方(组)  "g1r2"=配方1内第2行
//==============================================================================
function pathParts(p) {
    if (typeof p !== "string" || !p) return null;
    if (p[0] === "t") {
        const i = parseInt(p.slice(1), 10);
        return Number.isInteger(i) ? { k: "top", i } : null;
    }
    const m = p.match(/^g(\d+)(?:r(\d+))?$/);
    if (!m) return null;
    return m[2] == null ? { k: "grp", i: +m[1] } : { k: "grow", g: +m[1], i: +m[2] };
}
function peekItem(node, p) {
    const s = node.__loraStack || [];
    if (!p) return null;
    if (p.k === "top" || p.k === "grp") return s[p.i] || null;
    if (p.k === "grow") return s[p.g]?.loras?.[p.i] || null;
    return null;
}
function removeItem(node, p) {
    const s = node.__loraStack || [];
    if (p.k === "top" || p.k === "grp") return s.splice(p.i, 1)[0];
    if (p.k === "grow") return s[p.g]?.loras?.splice(p.i, 1)[0];
    return null;
}
// 顶层重名规则：顶层（不含配方内）同名只能有一个；配方内 / 配方与顶层之间允许同名。
function topNameConflict(node, item) {
    const n = norm(item.name || "");
    if (!n) return false;
    return (node.__loraStack || []).some(
        (e) => !e.folder && e !== item && norm(e.name || "") === n
    );
}

//==============================================================================
// 文件夹树弹窗（外部文件夹筛选，样式跟随 WindMix 主题）
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
    getLoraFiles(true).then((all) => {
        const tree = buildTree(all);
        const selected = new Set(current && current.length ? current : collectPrefixes(tree, new Set()));

        let backdrop = document.getElementById("wm_lora_folder_modal");
        if (backdrop) backdrop.remove();
        backdrop = document.createElement("div");
        backdrop.id = "wm_lora_folder_modal";
        backdrop.className = "wm-folder-backdrop";
        backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };

        const dialog = document.createElement("div");
        dialog.className = "wm-folder-dialog";

        const header = document.createElement("div");
        header.className = "wm-folder-header";
        const title = document.createElement("div");
        title.className = "wm-folder-title";
        title.textContent = "选择 LoRA 文件夹";
        const closeBtn = document.createElement("div");
        closeBtn.className = "wm-folder-close";
        closeBtn.textContent = "✕";
        closeBtn.onclick = () => backdrop.remove();
        header.append(title, closeBtn);

        const toolbar = document.createElement("div");
        toolbar.className = "wm-folder-toolbar";
        const mkBtn = (label) => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "wm-btn";
            b.textContent = label;
            return b;
        };
        const selAll = mkBtn("全选");
        const selNone = mkBtn("全不选");
        selAll.onclick = () => { collectPrefixes(tree, selected); renderTree(); };
        selNone.onclick = () => { selected.clear(); renderTree(); };
        toolbar.append(selAll, selNone);

        const treeBox = document.createElement("div");
        treeBox.className = "wm-folder-tree";

        function renderTree() {
            treeBox.innerHTML = "";
            const renderNode = (n, depth) => {
                const row = document.createElement("div");
                row.className = "wm-folder-row";
                row.style.marginLeft = depth * 14 + "px";
                const tri = document.createElement("span");
                tri.textContent = n._open === false ? "▸" : "▾";
                tri.className = "wm-folder-tri";
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.className = "wm-folder-cb";
                cb.checked = selected.has(n.prefix);
                cb.onchange = () => {
                    const desc = collectPrefixes(n, new Set());
                    if (cb.checked) desc.forEach((p) => selected.add(p));
                    else desc.forEach((p) => selected.delete(p));
                    renderTree();
                };
                const label = document.createElement("span");
                label.className = "wm-folder-label";
                label.textContent = n.name;
                const cnt = document.createElement("span");
                cnt.className = "wm-folder-cnt";
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
        footer.className = "wm-folder-footer";
        const cancel = mkBtn("取消");
        cancel.style.flex = "0 0 auto";
        cancel.style.padding = "6px 18px";
        cancel.onclick = () => backdrop.remove();
        const apply = mkBtn("应用");
        apply.className = "wm-btn wm-btn-primary";
        apply.onclick = () => {
            const allPrefixes = collectPrefixes(tree, new Set());
            const isAll = [...selected].sort().join("|") === [...allPrefixes].sort().join("|");
            onApply(isAll ? null : [...selected], isAll);
            backdrop.remove();
        };
        footer.append(cancel, apply);

        dialog.append(header, toolbar, treeBox, footer);
        backdrop.append(dialog);
        document.body.append(backdrop);
    });
}

//==============================================================================
// LoRA 选择器（点名称/Add 时弹出，内置文件夹侧栏 + 搜索 + 外部筛选叠加）
// onChoose 返回 false = 拒绝本次选择（如顶层重名拦截），选择器保持打开。
//==============================================================================
let _chooserEl = null;
let _chooserDocHandler = null;
let _chooserToken = 0;
function closeChooser() {
    hidePreviewPop();
    document.querySelectorAll(".wm-chooser").forEach((el) => el.remove());
    _chooserEl = null;
    if (_chooserDocHandler) {
        window.removeEventListener("pointerdown", _chooserDocHandler, true);
        _chooserDocHandler = null;
    }
}
function showChooser(node, onChoose, onCancel) {
    injectStyle();
    closeChooser();
    const token = ++_chooserToken;
    getLoraFiles().then((all) => {
        if (token !== _chooserToken) return;
        const set = enabledSetOf(node);
        const loras = lorasInFolders(all, set);

        const panel = document.createElement("div");
        panel.className = "wm-chooser";

        const header = document.createElement("div");
        header.className = "wm-chooser-header";
        const t = document.createElement("span");
        t.className = "wm-chooser-title";
        t.textContent = "选择 LoRA";
        const x = document.createElement("span");
        x.className = "wm-chooser-close";
        x.textContent = "✕";
        x.onclick = () => { closeChooser(); if (typeof onCancel === "function") onCancel(); };
        header.append(t, x);
        panel.append(header);

        const body = document.createElement("div");
        body.className = "wm-chooser-body";
        panel.append(body);

        // 左侧文件夹栏：从路径解析子目录；选父目录时包含其子目录里的文件
        const side = document.createElement("div");
        side.className = "wm-chooser-side";
        body.append(side);
        let curDir = null; // null = 全部
        const sideItems = [];
        const dirLabel = (d) => {
            if (!d) return "(根目录)";
            const parts = norm(d).replace(/\/$/, "").split("/");
            return parts[parts.length - 1] || d;
        };
        const mkSide = (label, dir, count) => {
            const it = document.createElement("div");
            it.className = "wm-chooser-side-item" + (dir === null ? " active" : "");
            const lbl = document.createElement("span");
            lbl.className = "lbl";
            lbl.textContent = label;
            const n = document.createElement("span");
            n.className = "n";
            n.textContent = count;
            it.append(lbl, n);
            it.title = dir === null ? "全部 LoRA" : dir;
            it.__dir = dir;
            it.onclick = () => {
                curDir = dir;
                sideItems.forEach((s) => s.classList.toggle("active", s.__dir === dir));
                render(search.value);
            };
            sideItems.push(it);
            side.append(it);
        };
        mkSide("全部", null, loras.length);
        const dirs = new Map();
        for (const path of loras) {
            const d = folderOf(path);
            dirs.set(d, (dirs.get(d) || 0) + 1);
        }
        for (const [d, c] of [...dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            mkSide(dirLabel(d), d, c);
        }

        const main = document.createElement("div");
        main.className = "wm-chooser-main";
        body.append(main);

        const search = document.createElement("input");
        search.className = "wm-chooser-search";
        search.placeholder = "搜索…";
        main.append(search);

        const list = document.createElement("div");
        list.className = "wm-chooser-list";
        main.append(list);

        const foot = document.createElement("div");
        foot.className = "wm-chooser-foot";
        panel.append(foot);

        const render = (q) => {
            list.innerHTML = "";
            const ql = (q || "").trim().toLowerCase();
            let vis = curDir ? loras.filter((p) => folderOf(p).startsWith(curDir)) : loras.slice();
            if (ql) vis = vis.filter((l) => l.toLowerCase().includes(ql));
            if (!vis.length) {
                const empty = document.createElement("div");
                empty.className = "wm-chooser-empty";
                empty.textContent = set ? "所选文件夹内无 LoRA" : "无匹配的 LoRA";
                list.append(empty);
            }
            for (const path of vis) {
                const item = document.createElement("div");
                item.className = "wm-chooser-item";
                item.textContent = basename(path);
                item.title = path;
                item.onclick = () => {
                    const r = onChoose(path);
                    if (r === false) return; // 被拦截（如顶层重名），选择器保持打开
                    closeChooser();
                };
                item.addEventListener("mouseenter", (e) => showPreviewPop(path, e));
                item.addEventListener("mousemove", movePreviewPop);
                item.addEventListener("mouseleave", hidePreviewPop);
                list.append(item);
            }
            foot.textContent = `共 ${vis.length} 个 · ${curDir === null ? "全部" : dirLabel(curDir)}`
                + (set ? ` · 已按 ${set.size} 个文件夹筛选` : "");
        };
        render("");
        search.oninput = () => render(search.value);

        document.body.append(panel);
        _chooserEl = panel;
        _chooserDocHandler = (e) => {
            if (_chooserEl && !_chooserEl.contains(e.target)) {
                closeChooser();
                if (typeof onCancel === "function") onCancel();
            }
        };
        setTimeout(() => {
            if (token === _chooserToken) window.addEventListener("pointerdown", _chooserDocHandler, true);
        }, 0);
        requestAnimationFrame(() => {
            const w = panel.offsetWidth, h = panel.offsetHeight;
            panel.style.left = Math.max(10, (window.innerWidth - w) / 2) + "px";
            panel.style.top = Math.max(10, (window.innerHeight - h) / 2 - 60) + "px";
        });
    });
}

//==============================================================================
// 样式：--wm-lo-* 双主题变量（浅色默认，html.dark-theme 深色），与预设文本节点同一架构
//==============================================================================
let _styleInjected = false;
function injectStyle() {
    if (_styleInjected) return;
    _styleInjected = true;
    const s = document.createElement("style");
    s.textContent = `
/* ===== 主题令牌（容器内控件 + body 级弹窗共用） ===== */
.wm-lora-container, .wm-chooser, .wm-folder-dialog, .wm-preview-pop {
  --wm-lo-brand: #534AB7;
  --wm-lo-accent: #534AB7;
  --wm-lo-panel: #f2f2f3;
  --wm-lo-field: #ffffff;
  --wm-lo-fg: #1f1f21;
  --wm-lo-dim: #85858c;
  --wm-lo-line: #d8d8dc;
  --wm-lo-line2: #c6c6cd;
  --wm-lo-toggle: #c6c6cd;
  --wm-lo-danger: #c0392b;
  --wm-lo-grpbg: #e9eaf5;
  --wm-lo-grpline: #d5d7ec;
  --wm-lo-shadow: 0 8px 30px rgba(0,0,0,.18);
}
html.dark-theme .wm-lora-container, html.dark-theme .wm-chooser,
html.dark-theme .wm-folder-dialog, html.dark-theme .wm-preview-pop {
  --wm-lo-accent: #9b8af5;
  --wm-lo-panel: #2a2a2a;
  --wm-lo-field: #1e1e1e;
  --wm-lo-fg: #e6e6e6;
  --wm-lo-dim: #9a9a9a;
  --wm-lo-line: #3a3a3a;
  --wm-lo-line2: #454545;
  --wm-lo-toggle: #4a4a52;
  --wm-lo-danger: #e57373;
  --wm-lo-grpbg: #272630;
  --wm-lo-grpline: #3a3a48;
  --wm-lo-shadow: 0 8px 30px rgba(0,0,0,.5);
}

.wm-lora-container { display:flex; flex-direction:column; gap:8px; padding-bottom:8px; }

/* ---- 顶部按钮行：新建配方(图标) + 文件夹筛选 + LoRA 总数徽标 ---- */
.wm-lora-toprow { display:flex; gap:8px; align-items:stretch; }
.wm-lora-newgrp { flex:none; width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center;
  background:var(--wm-lo-field); border:1px solid var(--border-color,#444); border-radius:8px;
  color:var(--wm-lo-accent); cursor:pointer; transition:border-color .12s, background .12s; }
.wm-lora-newgrp:hover { border-color:var(--wm-lo-accent); background:rgba(83,74,183,.08); }
.wm-folder-btn { display:flex; align-items:center; gap:6px; flex:1; min-width:0; min-height:34px; line-height:1;
  background:var(--wm-lo-field); color:var(--wm-lo-fg);
  border:1px solid var(--border-color,#444); border-radius:8px; padding:7px 10px;
  cursor:pointer; font-size:12px; transition:border-color .12s, background .12s; }
.wm-folder-btn:hover { border-color:var(--wm-lo-accent); background:rgba(83,74,183,.08); }
.wm-fb-ic { display:inline-flex; align-items:center; font-size:13px; line-height:1; }
.wm-fb-txt { line-height:1; }
.wm-fb-badge { margin-left:auto; background:var(--wm-lo-brand); color:#fff; border-radius:999px;
  padding:1px 8px; font-size:11px; line-height:14px; font-weight:600; flex:none; }
.wm-fb-badge.off { background:var(--wm-lo-line2); color:var(--wm-lo-fg); font-weight:500; }
.wm-fb-chev { color:var(--wm-lo-dim); font-size:10px; flex:none; }

/* ---- 行（卡片：同配方组底色，无边框；tag 区与卡片同底色） ---- */
.wm-lora-rows { display:flex; flex-direction:column; gap:6px; }
.wm-lora-row { display:flex; flex-direction:column; min-width:0; padding:5px 8px 4px;
  background:var(--wm-lo-grpbg); border-radius:10px;
  transition:opacity .15s, box-shadow .12s; }
.wm-lora-row.is-off { opacity:.5; }
.wm-lora-row.dragging { opacity:.35; }
.wm-lora-row.drop-target { box-shadow:inset 0 3px 0 0 var(--wm-lo-accent); }
.wm-lora-row.drop-after { box-shadow:inset 0 -3px 0 0 var(--wm-lo-accent); }
.wm-lora-main { display:flex; align-items:center; gap:6px; min-width:0; }
.wm-grip { flex:none; display:inline-flex; align-self:center; cursor:grab; color:var(--wm-lo-dim);
  opacity:.5; user-select:none; transition:opacity .12s, color .12s; }
.wm-grip:hover { opacity:1; color:var(--wm-lo-accent); }
.wm-grip:active { cursor:grabbing; }
/* 开关：原生勾选框（同预设文本「随机选择」，accent-color 跟随主题） */
.wm-on { flex:none; width:16px; height:16px; margin:0; accent-color:var(--comfy-primary,#534AB7); cursor:pointer; }
.wm-name { flex:1 1 0; min-width:0; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  padding:0; color:var(--wm-lo-fg); font-size:12px; line-height:22px;
  cursor:pointer; transition:color .12s; text-align:left; }
.wm-name:hover { color:var(--wm-lo-accent); }
.wm-strength { flex:none; width:52px; background:var(--wm-lo-field); border:1px solid var(--wm-lo-line2);
  border-radius:6px; padding:3px 4px; color:var(--wm-lo-fg); font-size:12px; line-height:16px; font-weight:600;
  font-variant-numeric:tabular-nums; text-align:center; box-sizing:border-box; outline:none;
  transition:border-color .12s, box-shadow .12s; }
.wm-strength:focus { border-color:var(--wm-lo-accent); box-shadow:0 0 0 2px rgba(155,138,245,.22); }
/* tag 图标 / 删除按钮：对齐预设文本 wm-st-fbtn（带边框小方按钮） */
.wm-ic { flex:none; width:22px; height:22px; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center;
  border:1px solid var(--border-color,#444); border-radius:6px; background:var(--wm-lo-field);
  cursor:pointer; color:var(--wm-lo-fg); transition:background .12s, color .12s, border-color .12s; }
.wm-ic svg { width:13px; height:13px; }
.wm-ic:hover { background:rgba(83,74,183,.14); border-color:var(--wm-lo-accent); color:var(--wm-lo-accent); }
.wm-ic.has { color:var(--wm-lo-accent); border-color:var(--wm-lo-accent); }
.wm-ic.none { opacity:.45; }
.wm-del { flex:none; width:22px; height:22px; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center;
  border:1px solid var(--border-color,#444); border-radius:6px; background:var(--wm-lo-field);
  color:var(--wm-lo-fg); font-size:12px; cursor:pointer; transition:background .12s, color .12s, border-color .12s; }
.wm-del:hover { color:var(--wm-lo-danger); border-color:var(--wm-lo-danger); background:rgba(229,115,115,.12); }

/* ---- tag 区（内容由 JS 条件渲染：展开=编辑框 / 收起+有tag=预览 / 无tag=零占位） ---- */
.wm-tagzone { }
.wm-tagprev { display:flex; align-items:center; gap:5px; margin-top:4px; padding:1px 2px; cursor:pointer;
  font-size:11px; line-height:15px; color:var(--wm-lo-accent); opacity:.85; transition:opacity .12s; }
.wm-tagprev:hover { opacity:1; }
.wm-tagprev .wm-tarr { margin-left:auto; opacity:.6; font-size:10px; }
.wm-tagbox { display:flex; align-items:center; gap:6px; margin-top:6px; padding-top:6px;
  border-top:1px solid var(--wm-lo-line); }
.wm-tagkey { flex:none; font-size:11px; line-height:14px; font-weight:600; color:var(--wm-lo-accent);
  border:1px solid var(--wm-lo-accent); border-radius:4px; padding:1px 5px; letter-spacing:.5px; opacity:.8; }
.wm-tagbox input { flex:1; min-width:0; background:var(--wm-lo-field); border:1px solid var(--wm-lo-line2);
  border-radius:6px; padding:4px 7px; color:var(--wm-lo-fg); font-size:12px; line-height:16px;
  box-sizing:border-box; outline:none; transition:border-color .12s, box-shadow .12s; }
.wm-tagbox input:focus { border-color:var(--wm-lo-accent); box-shadow:0 0 0 2px rgba(155,138,245,.22); }
.wm-tagbox input::placeholder { color:var(--wm-lo-dim); font-style:italic; opacity:.7; }

/* ---- 配方文件夹 ---- */
.wm-lora-group { background:var(--wm-lo-grpbg); border:1px solid var(--wm-lo-grpline);
  border-left:3px solid var(--wm-lo-brand); border-radius:10px; overflow:hidden;
  transition:opacity .15s, border-color .12s, box-shadow .12s; }
.wm-lora-group:hover { border-color:rgba(155,138,245,.4); }
.wm-lora-group.is-off { opacity:.5; }
.wm-lora-group.dragging { opacity:.35; }
.wm-lora-group.drop-target { box-shadow:inset 0 3px 0 0 var(--wm-lo-accent); }
.wm-lora-group.drop-after { box-shadow:inset 0 -3px 0 0 var(--wm-lo-accent); }
.wm-lora-group.drop-into { border-color:var(--wm-lo-accent); box-shadow:0 0 0 2px rgba(83,74,183,.3); }
.wm-ghead { display:flex; align-items:center; gap:7px; padding:7px 9px;
  background:rgba(83,74,183,.10); cursor:pointer; user-select:none; }
.wm-ghead .wm-grip { opacity:.5; }
.wm-gicon { flex:none; display:inline-flex; color:var(--wm-lo-accent); }
.wm-gname { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:12px; line-height:18px; font-weight:600; color:var(--wm-lo-fg); }
.wm-gname-input { flex:1; min-width:0; background:var(--wm-lo-field); border:1px solid var(--wm-lo-accent);
  border-radius:5px; padding:2px 6px; color:var(--wm-lo-fg); font-size:12px; line-height:16px;
  font-weight:600; box-sizing:border-box; outline:none; }
.wm-gcnt { flex:none; background:rgba(155,138,245,.18); color:var(--wm-lo-accent); border-radius:999px;
  padding:1px 8px; font-size:11px; line-height:14px; font-weight:600; }
.wm-chev { flex:none; color:var(--wm-lo-dim); font-size:10px; transition:transform .18s; }
.wm-lora-group.closed .wm-chev { transform:rotate(-90deg); }
.wm-gdel { flex:none; width:20px; height:20px; display:inline-flex; align-items:center; justify-content:center;
  border-radius:5px; color:var(--wm-lo-dim); font-size:11px; cursor:pointer;
  transition:background .12s, color .12s; }
.wm-gdel:hover { background:rgba(229,115,115,.16); color:var(--wm-lo-danger); }
.wm-gbody { display:grid; grid-template-rows:1fr; transition:grid-template-rows .2s ease; }
.wm-lora-group.closed .wm-gbody { grid-template-rows:0fr; }
.wm-gbodyin { overflow:hidden; }
.wm-grows { padding:8px 8px 8px 14px; margin-left:8px; display:flex; flex-direction:column; gap:6px;
  border-left:2px solid rgba(155,138,245,.3); }
.wm-gempty { font-size:11px; line-height:15px; color:var(--wm-lo-dim); text-align:center; padding:6px 0;
  border:1px dashed var(--wm-lo-accent); border-radius:7px; opacity:.7; }
.wm-gadd { width:100%; background:transparent; border:1px dashed var(--wm-lo-accent); border-radius:7px;
  padding:5px 0; color:var(--wm-lo-accent); font-size:11px; line-height:14px; font-weight:500;
  cursor:pointer; transition:background .12s, border-color .12s; }
.wm-gadd:hover { background:rgba(83,74,183,.14); border-color:var(--wm-lo-accent); }

/* ---- 空状态 / 重名警告 / Add 按钮 ---- */
.wm-lora-empty { border:1px dashed var(--wm-lo-accent); border-radius:10px; padding:16px 12px;
  display:flex; flex-direction:column; align-items:center; gap:4px; color:var(--wm-lo-dim); }
.wm-lora-empty b { font-size:12px; line-height:16px; color:var(--wm-lo-fg); }
.wm-lora-empty span { font-size:11px; line-height:15px; }
.wm-lora-empty svg { color:var(--wm-lo-accent); opacity:.85; margin-bottom:2px; }
.wm-lora-warn { display:none; align-items:center; gap:7px; background:rgba(229,115,115,.10);
  border:1px solid var(--wm-lo-danger); border-radius:8px; padding:6px 9px;
  font-size:11px; line-height:15px; color:var(--wm-lo-danger); }
.wm-lora-warn.show { display:flex; }
.wm-lora-warn::before { content:''; flex:none; width:7px; height:7px; border-radius:50%; background:var(--wm-lo-danger); }
.wm-lora-add { width:100%; background:transparent; border:1px dashed var(--wm-lo-accent); border-radius:8px;
  padding:8px 0; color:var(--wm-lo-accent); font-size:12px; line-height:16px; font-weight:600;
  cursor:pointer; transition:background .12s, border-color .12s; }
.wm-lora-add:hover { background:rgba(83,74,183,.16); border-color:var(--wm-lo-accent); }
.wm-lora-add:active { background:rgba(83,74,183,.26); }

/* ---- 选 LoRA 弹窗（双列：左侧文件夹栏 + 右侧列表） ---- */
.wm-chooser { position:fixed; z-index:10001; width:620px; max-width:92vw; max-height:62vh;
  display:flex; flex-direction:column; overflow:hidden;
  background:var(--wm-lo-panel); color:var(--wm-lo-fg);
  border:1px solid var(--wm-lo-line); border-radius:12px;
  box-shadow:var(--wm-lo-shadow); font-family:sans-serif; font-size:12px; }
.wm-chooser-header { display:flex; align-items:center; gap:8px; flex:none;
  padding:9px 12px; border-bottom:1px solid var(--wm-lo-line); }
.wm-chooser-header::before { content:''; width:8px; height:8px; border-radius:50%; background:var(--wm-lo-accent); flex:none; }
.wm-chooser-title { font-size:13px; font-weight:600; }
.wm-chooser-close { cursor:pointer; color:var(--wm-lo-dim); margin-left:auto; padding:2px 6px; border-radius:6px;
  transition:background .12s, color .12s; }
.wm-chooser-close:hover { background:rgba(155,138,245,.16); color:var(--wm-lo-fg); }
.wm-chooser-body { flex:1; min-height:0; display:flex; }
.wm-chooser-side { flex:none; width:148px; overflow-y:auto; padding:6px;
  border-right:1px solid var(--wm-lo-line); }
.wm-chooser-side-item { display:flex; align-items:center; gap:6px; padding:6px 8px;
  border-radius:7px; cursor:pointer; color:var(--wm-lo-fg);
  transition:background .12s, color .12s; white-space:nowrap; }
.wm-chooser-side-item:hover { background:rgba(83,74,183,.08); }
.wm-chooser-side-item.active { background:rgba(83,74,183,.16); color:var(--wm-lo-accent); font-weight:600; }
.wm-chooser-side-item .lbl { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; font-size:12px; }
.wm-chooser-side-item .n { flex:none; font-size:10.5px; color:var(--wm-lo-dim);
  background:var(--wm-lo-field); border:1px solid var(--wm-lo-line); border-radius:999px;
  padding:0 6px; line-height:14px; }
.wm-chooser-side-item.active .n { color:var(--wm-lo-accent); border-color:var(--wm-lo-accent); }
.wm-chooser-main { flex:1; min-width:0; display:flex; flex-direction:column; }
.wm-chooser-search { width:calc(100% - 16px); margin:8px; padding:6px 8px;
  background:var(--wm-lo-field); color:var(--wm-lo-fg);
  border:1px solid var(--wm-lo-line2); border-radius:7px; box-sizing:border-box;
  font-size:12px; outline:none; transition:border-color .12s, box-shadow .12s; flex:none; }
.wm-chooser-search:focus { border-color:var(--wm-lo-accent); box-shadow:0 0 0 2px rgba(155,138,245,.22); }
.wm-chooser-list { flex:1; min-height:0; overflow-y:auto; padding:0 6px 6px; }
.wm-chooser-item { position:relative; padding:8px 10px; border-radius:7px; cursor:pointer;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  transition:background .12s, color .12s; }
.wm-chooser-item:hover { background:rgba(83,74,183,.12); box-shadow:inset 3px 0 0 0 var(--wm-lo-accent); }
.wm-chooser-empty { padding:12px; color:var(--wm-lo-dim); }
.wm-chooser-foot { flex:none; padding:7px 12px; border-top:1px solid var(--wm-lo-line);
  font-size:11px; line-height:15px; color:var(--wm-lo-dim); }

/* ---- 文件夹树弹窗 ---- */
.wm-folder-backdrop { position:fixed; left:0; top:0; width:100%; height:100%;
  background:rgba(15,17,26,0.45); z-index:10000; display:flex; align-items:center; justify-content:center; }
.wm-folder-dialog { background:var(--wm-lo-panel); color:var(--wm-lo-fg);
  border-radius:12px; width:454px; max-width:92vw; max-height:86vh; display:flex; flex-direction:column;
  font-family:sans-serif; box-shadow:var(--wm-lo-shadow); overflow:hidden; }
.wm-folder-header { display:flex; align-items:center; gap:8px; justify-content:space-between;
  padding:12px 16px; border-bottom:1px solid var(--wm-lo-line); }
.wm-folder-title { font-size:14px; font-weight:600; display:flex; align-items:center; gap:8px; }
.wm-folder-title::before { content:''; width:8px; height:8px; border-radius:50%; background:var(--wm-lo-accent); }
.wm-folder-close { cursor:pointer; color:var(--wm-lo-dim); padding:2px 6px; border-radius:6px;
  transition:background .12s, color .12s; }
.wm-folder-close:hover { background:rgba(155,138,245,.16); color:var(--wm-lo-fg); }
.wm-folder-toolbar { display:flex; gap:8px; padding:10px 16px; }
.wm-folder-tree { padding:4px 16px; overflow-y:auto; max-height:60vh; }
.wm-folder-row { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:6px;
  transition:background .12s; }
.wm-folder-row:hover { background:rgba(83,74,183,.08); }
.wm-folder-tri { cursor:pointer; color:var(--wm-lo-dim); width:10px; flex:none; transition:opacity .12s; }
.wm-folder-tri:hover { opacity:1; color:var(--wm-lo-accent); }
.wm-folder-cb { accent-color:var(--wm-lo-brand); cursor:pointer; flex:none; }
.wm-folder-label { font-size:12px; cursor:default; }
.wm-folder-cnt { font-size:11px; color:var(--wm-lo-dim); }
.wm-folder-footer { display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--wm-lo-line);
  justify-content:flex-end; }

/* ---- 通用按钮（弹窗内） ---- */
.wm-btn { flex:1; padding:6px 0; font-size:12px; cursor:pointer;
  background:var(--wm-lo-field); color:var(--wm-lo-fg);
  border:1px solid var(--wm-lo-line2); border-radius:6px;
  transition:border-color .12s, background .12s; font-family:sans-serif; }
.wm-btn:hover { border-color:var(--wm-lo-accent); background:rgba(83,74,183,.08); }
.wm-btn-primary { flex:0 0 auto; padding:6px 18px; background:var(--wm-lo-brand); color:#fff;
  border:1px solid var(--wm-lo-brand); }
.wm-btn-primary:hover { background:#3c3489; border-color:#3c3489; }

/* ---- 模型预览浮窗 ---- */
.wm-preview-pop { position:fixed; z-index:100002; max-width:308px; padding:6px;
  background:var(--wm-lo-panel); border:1px solid var(--wm-lo-line2);
  border-radius:8px; box-shadow:var(--wm-lo-shadow); pointer-events:none; }
.wm-preview-pop img { display:block; max-width:296px; max-height:56vh; border-radius:5px; object-fit:contain; }
`;
    document.head.append(s);
}

// 让节点根据 DOM 真实高度重新计算外框尺寸（Nodes 2.0 下外框不自动跟随 DOM 高度）。
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
// 拖拽排序：手柄可拖，行/组/组内行互相调序；行可拖入配方组（释放到组头或组卡空白处）。
// dragstart 数据：wm-reorder:{nodeId}:{srcPath}；同节点校验防跨节点串位。
//==============================================================================
const GRIP_SVG = `<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><circle cx="2.5" cy="3" r="1.6"/><circle cx="7.5" cy="3" r="1.6"/><circle cx="2.5" cy="8" r="1.6"/><circle cx="7.5" cy="8" r="1.6"/><circle cx="2.5" cy="13" r="1.6"/><circle cx="7.5" cy="13" r="1.6"/></svg>`;
const FOLDER_PLUS_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6M9 13h6"/></svg>`;
const FOLDER_FILL_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>`;
const TAG_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><circle cx="7" cy="7" r="1.5"/></svg>`;
const EMPTY_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="14" height="12" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v10"/><path d="M7 10h6M7 14h4"/></svg>`;

let _dragSrc = null; // { nodeId, pathStr } —— dragover 期间用于判断源类型（行/组/组内行）

function clearDragMarks() {
    document.querySelectorAll(".drop-target,.drop-after,.drop-into").forEach((el) =>
        el.classList.remove("drop-target", "drop-after", "drop-into")
    );
}
function isDragEvt(e) {
    const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
    return !types.includes("Files") && types.includes("text/plain");
}

function makeGrip(node, srcPath, hostEl) {
    const grip = document.createElement("div");
    grip.className = "wm-grip";
    grip.title = "拖动调整顺序";
    grip.innerHTML = GRIP_SVG;
    grip.draggable = true;
    grip.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", `wm-reorder:${node.id}:${srcPath}`);
        e.dataTransfer.effectAllowed = "move";
        _dragSrc = { nodeId: node.id, pathStr: srcPath };
        (hostEl || grip.closest(".wm-lora-row,.wm-lora-group"))?.classList.add("dragging");
    });
    grip.addEventListener("dragend", () => {
        _dragSrc = null;
        clearDragMarks();
        document.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
    });
    return grip;
}

// 行卡 drop：上半区插到目标行前，下半区插到目标行后（同容器排序 / 跨容器移动）
function bindRowDrop(row, node, pathStr) {
    row.addEventListener("dragover", (e) => {
        if (!isDragEvt(e)) return;
        e.preventDefault();
        e.stopPropagation();
        row.classList.toggle("drop-after", (e.clientY - row.getBoundingClientRect().top) > row.offsetHeight / 2);
        row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target", "drop-after"));
    row.addEventListener("drop", (e) => {
        if (!isDragEvt(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const after = row.classList.contains("drop-after"); // 先读再清，remove 会抹掉状态
        row.classList.remove("drop-target", "drop-after");
        const raw = e.dataTransfer.getData("text/plain");
        const parts = String(raw).split(":");
        if (parts[0] !== "wm-reorder" || String(node.id) !== parts[1]) return;
        const src = pathParts(parts.slice(2).join(":"));
        const dst = pathParts(pathStr);
        if (!src || !dst) return;
        const item = peekItem(node, src);
        if (!item || item === peekItem(node, dst)) return;
        // 顶层重名校验：任何会让顶层出现同名的移动都拦截（配方内允许同名）
        if (dst.k === "top" && !item.folder && topNameConflict(node, item)) {
            showWarn(node, `顶层已存在同名：${basename(item.name)}（配方内外不受此限制）`);
            return;
        }
        removeItem(node, src);
        _dragSrc = null;
        clearDragMarks();
        const stack = node.__loraStack;
        if (dst.k === "top") {
            let at = dst.i;
            if (src.k === "top" && src.i < dst.i) at -= 1;
            if (after) at += 1;
            stack.splice(Math.max(0, Math.min(at, stack.length)), 0, item);
        } else {
            const g = stack[dst.g]?.loras;
            if (!g) return;
            let at = dst.i;
            if (src.k === "grow" && src.g === dst.g && src.i < dst.i) at -= 1;
            if (after) at += 1;
            g.splice(Math.max(0, Math.min(at, g.length)), 0, item);
        }
        syncData(node);
        renderRows(node);
    });
}

// 组卡 drop：行拖入 → 加入组末尾；组拖动 → 上下半区定插入前后
function bindGroupDrop(grp, node, gi) {
    grp.addEventListener("dragover", (e) => {
        if (!isDragEvt(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (_dragSrc && _dragSrc.nodeId === node.id && _dragSrc.pathStr && pathParts(_dragSrc.pathStr)?.k !== "grp") {
            grp.classList.add("drop-into");
        } else {
            grp.classList.toggle("drop-after", (e.clientY - grp.getBoundingClientRect().top) > grp.offsetHeight / 2);
            grp.classList.add("drop-target");
        }
    });
    grp.addEventListener("dragleave", () => grp.classList.remove("drop-target", "drop-after", "drop-into"));
    grp.addEventListener("drop", (e) => {
        if (!isDragEvt(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const after = grp.classList.contains("drop-after"); // 先读再清
        grp.classList.remove("drop-target", "drop-after", "drop-into");
        const raw = e.dataTransfer.getData("text/plain");
        const parts = String(raw).split(":");
        if (parts[0] !== "wm-reorder" || String(node.id) !== parts[1]) return;
        const src = pathParts(parts.slice(2).join(":"));
        if (!src) return;
        const item = peekItem(node, src);
        const stack = node.__loraStack;
        const g = stack[gi]?.loras;
        if (!item || !g) return;
        if (item.folder) {
            // 组拖到组头/组卡 → 组排序（上下半区）
            if (src.k !== "grp") return;
            removeItem(node, src);
            _dragSrc = null;
            clearDragMarks();
            let at = gi;
            if (src.i < gi) at -= 1;
            if (after) at += 1;
            stack.splice(Math.max(0, Math.min(at, stack.length)), 0, item);
        } else {
            // 行拖到组上 → 移入该配方末尾
            removeItem(node, src);
            _dragSrc = null;
            clearDragMarks();
            g.push(item);
        }
        syncData(node);
        renderRows(node);
    });
}

// 顶层容器 drop：行/组拖到列表空白处 → 移到顶层末尾
function bindTopDrop(rowsEl, node) {
    rowsEl.addEventListener("dragover", (e) => {
        if (!isDragEvt(e)) return;
        e.preventDefault();
    });
    rowsEl.addEventListener("drop", (e) => {
        if (!isDragEvt(e)) return;
        e.preventDefault();
        clearDragMarks();
        const raw = e.dataTransfer.getData("text/plain");
        const parts = String(raw).split(":");
        if (parts[0] !== "wm-reorder" || String(node.id) !== parts[1]) return;
        const src = pathParts(parts.slice(2).join(":"));
        if (!src) return;
        const item = peekItem(node, src);
        if (!item) return;
        if (!item.folder && topNameConflict(node, item)) {
            showWarn(node, `顶层已存在同名：${basename(item.name)}（配方内外不受此限制）`);
            return;
        }
        removeItem(node, src);
        node.__loraStack.push(item);
        syncData(node);
        renderRows(node);
    });
}

//==============================================================================
// 渲染
//==============================================================================
function showWarn(node, msg) {
    const el = node.__wmWarnEl;
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    if (node.__wmWarnTimer) clearTimeout(node.__wmWarnTimer);
    node.__wmWarnTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// 选完 LoRA 后统一处理：写 name、自动拉 tag、自动展开 tag 区
function applyChosenPath(node, entry, path) {
    entry.name = path;
    syncData(node);
    renderRows(node);
    fetchTag(path).then((tag) => {
        entry.tag = tag;
        entry.__tagOpen = false; // 自动折叠：有 tag 只显示预览
        syncData(node);
        renderRows(node);
    });
}

function renderRowCard(node, entry, dropPath) {
    const row = document.createElement("div");
    row.className = "wm-lora-row" + (entry.on ? "" : " is-off");
    row.dataset.drop = dropPath;

    const main = document.createElement("div");
    main.className = "wm-lora-main";
    row.append(main);

    main.append(makeGrip(node, dropPath, row));

    const on = document.createElement("input");
    on.type = "checkbox";
    on.className = "wm-on";
    on.checked = !!entry.on;
    on.title = "启用 / 停用";
    on.onchange = () => {
        entry.on = on.checked;
        row.classList.toggle("is-off", !entry.on);
        syncData(node);
    };
    main.append(on);

    const name = document.createElement("span");
    name.className = "wm-name";
    name.textContent = entry.name ? basename(entry.name) : "（点击选择 LoRA）";
    name.title = entry.name || "点击选择 LoRA";
    name.onclick = () => {
        showChooser(node, (path) => {
            const p = pathParts(dropPath);
            // 顶层行换名时同样遵守顶层唯一规则
            if (p?.k === "top" && norm(entry.name || "") !== norm(path)) {
                const probe = { name: path };
                const conflict = (node.__loraStack || []).some(
                    (e) => !e.folder && e !== entry && norm(e.name || "") === norm(path)
                );
                if (conflict) {
                    showWarn(node, `顶层已存在同名：${basename(path)}（配方内外不受此限制）`);
                    return false;
                }
            }
            applyChosenPath(node, entry, path);
        });
    };
    if (entry.name) {
        name.addEventListener("mouseenter", (e) => showPreviewPop(entry.name, e));
        name.addEventListener("mousemove", movePreviewPop);
        name.addEventListener("mouseleave", hidePreviewPop);
    }
    main.append(name);

    const strength = document.createElement("input");
    strength.type = "number";
    strength.step = "0.05";
    strength.className = "wm-strength";
    strength.value = entry.model;
    strength.oninput = () => {
        let v = parseFloat(strength.value);
        if (!Number.isFinite(v)) v = DEF_STRENGTH;
        entry.model = v;
        syncData(node);
    };
    main.append(strength);

    const tagIc = document.createElement("span");
    tagIc.className = "wm-ic " + (entry.tag ? "has" : "none");
    tagIc.title = "展开 / 收起 tag";
    tagIc.innerHTML = TAG_SVG;
    main.append(tagIc);

    const del = document.createElement("span");
    del.className = "wm-del";
    del.textContent = "✕";
    del.title = "删除";
    del.onclick = () => {
        removeItem(node, pathParts(dropPath));
        syncData(node);
        renderRows(node);
    };
    main.append(del);

    // tag 区：展开 = 编辑框；收起且有 tag = 预览小字；收起且无 tag = 零占位
    const zone = document.createElement("div");
    zone.className = "wm-tagzone";
    const inner = document.createElement("div");
    inner.className = "wm-taginner";
    zone.append(inner);
    row.append(zone);

    const refreshTagIcon = () => {
        tagIc.className = "wm-ic " + (entry.tag ? "has" : "none");
    };

    const renderTagZone = () => {
        inner.innerHTML = "";
        if (entry.__tagOpen) {
            const box = document.createElement("div");
            box.className = "wm-tagbox";
            const key = document.createElement("span");
            key.className = "wm-tagkey";
            key.textContent = "TAG";
            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "tag（选 LoRA 后自动填充，可编辑）";
            input.value = entry.tag || "";
            input.oninput = () => { entry.tag = input.value; syncData(node); refreshTagIcon(); };
            box.append(key, input);
            inner.append(box);
        } else if (entry.tag) {
            const prev = document.createElement("div");
            prev.className = "wm-tagprev";
            prev.innerHTML = `${TAG_SVG}<span></span><span class="wm-tarr">▾</span>`;
            prev.querySelector("span").textContent = entry.tag;
            prev.title = entry.tag;
            prev.onclick = () => { entry.__tagOpen = true; renderTagZone(); scheduleResize(node); };
            inner.append(prev);
        }
    };
    renderTagZone();

    tagIc.onclick = () => {
        entry.__tagOpen = !entry.__tagOpen;
        renderTagZone();
        scheduleResize(node);
    };

    bindRowDrop(row, node, dropPath);
    return row;
}

function renderGroup(node, entry, gi) {
    const grp = document.createElement("div");
    grp.className = "wm-lora-group" + (entry.open === false ? " closed" : "") + (entry.on ? "" : " is-off");

    const head = document.createElement("div");
    head.className = "wm-ghead";
    head.append(makeGrip(node, "g" + gi, grp));

    const on = document.createElement("input");
    on.type = "checkbox";
    on.className = "wm-on";
    on.checked = !!entry.on;
    on.title = "整组开关";
    on.onchange = () => {
        entry.on = on.checked;
        grp.classList.toggle("is-off", !entry.on);
        syncData(node);
    };
    head.append(on);

    const icon = document.createElement("span");
    icon.className = "wm-gicon";
    icon.innerHTML = FOLDER_FILL_SVG;
    head.append(icon);

    const gname = document.createElement("span");
    gname.className = "wm-gname";
    gname.textContent = entry.folder;
    gname.title = "双击重命名";
    gname.onclick = (e) => e.stopPropagation(); // 双击改名，单击不折叠
    gname.ondblclick = () => {
        const inp = document.createElement("input");
        inp.className = "wm-gname-input";
        inp.value = entry.folder;
        gname.replaceWith(inp);
        inp.focus();
        inp.select();
        const commit = () => {
            const v = inp.value.trim();
            if (v) entry.folder = v;
            syncData(node);
            renderRows(node);
        };
        inp.addEventListener("blur", commit);
        inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") inp.blur(); });
    };
    head.append(gname);

    const cnt = document.createElement("span");
    cnt.className = "wm-gcnt";
    cnt.textContent = (entry.loras || []).length;
    head.append(cnt);

    const chev = document.createElement("span");
    chev.className = "wm-chev";
    chev.textContent = "▾";
    head.append(chev);

    const gdel = document.createElement("span");
    gdel.className = "wm-gdel";
    gdel.textContent = "✕";
    gdel.title = "删除配方（组内 LoRA 一并移除）";
    gdel.onclick = (e) => {
        e.stopPropagation();
        node.__loraStack.splice(gi, 1);
        syncData(node);
        renderRows(node);
    };
    head.append(gdel);

    // 点组头空白 = 折叠/展开
    head.addEventListener("click", () => {
        entry.open = entry.open === false;
        grp.classList.toggle("closed", entry.open === false);
        syncData(node);
    });

    const gbody = document.createElement("div");
    gbody.className = "wm-gbody";
    const gbodyin = document.createElement("div");
    gbodyin.className = "wm-gbodyin";
    const grows = document.createElement("div");
    grows.className = "wm-grows";
    gbodyin.append(grows);
    gbody.append(gbodyin);
    grp.append(head, gbody);

    if (!(entry.loras || []).length) {
        const empty = document.createElement("div");
        empty.className = "wm-gempty";
        empty.textContent = "空配方 · 点下方按钮添加 LoRA";
        grows.append(empty);
    }
    (entry.loras || []).forEach((r, ri) => {
        grows.append(renderRowCard(node, r, `g${gi}r${ri}`));
    });

    const gadd = document.createElement("button");
    gadd.type = "button";
    gadd.className = "wm-gadd";
    gadd.textContent = "+ 添加到配方";
    gadd.onclick = () => {
        showChooser(node, (path) => {
            entry.loras.push({ on: true, name: path, model: DEF_STRENGTH, tag: "", __tagOpen: false });
            syncData(node);
            renderRows(node);
        });
    };
    grows.append(gadd);

    bindGroupDrop(grp, node, gi);
    return grp;
}

function renderRows(node) {
    if (!node.__wmBuilt || !node.__rowsEl) return;
    injectStyle();
    const stack = node.__loraStack || [];
    node.__rowsEl.innerHTML = "";

    if (!stack.length) {
        const empty = document.createElement("div");
        empty.className = "wm-lora-empty";
        empty.innerHTML = `${EMPTY_SVG}<b>暂无 LoRA</b><span>点击下方「+ Add LoRA」添加，或右上角图标新建配方</span>`;
        node.__rowsEl.append(empty);
    }

    stack.forEach((entry, gi) => {
        if (entry.folder) node.__rowsEl.append(renderGroup(node, entry, gi));
        else node.__rowsEl.append(renderRowCard(node, entry, "t" + gi));
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
        `<span class="wm-fb-ic">📁</span><span class="wm-fb-txt">文件夹筛选</span>` +
        (n ? `<span class="wm-fb-badge">${n}</span>` : `<span class="wm-fb-badge off">全部</span>`) +
        `<span class="wm-fb-chev">▾</span>`;
}

function uniqueGroupName(stack) {
    const names = new Set(stack.filter((e) => e.folder).map((e) => e.folder));
    if (!names.has("新配方")) return "新配方";
    let i = 2;
    while (names.has("新配方 " + i)) i += 1;
    return "新配方 " + i;
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

    // 整块用 DOM 控件（不混用 litegraph addWidget），Nodes 1.0/2.0 双端定位一致。
    const container = document.createElement("div");
    container.className = "wm-lora-container";

    // 1) 顶部按钮行：新建配方（图标） + 文件夹筛选
    const toprow = document.createElement("div");
    toprow.className = "wm-lora-toprow";

    const newGrpBtn = document.createElement("button");
    newGrpBtn.type = "button";
    newGrpBtn.className = "wm-lora-newgrp";
    newGrpBtn.title = "新建配方";
    newGrpBtn.innerHTML = FOLDER_PLUS_SVG;
    newGrpBtn.onclick = () => {
        node.__loraStack.push({
            folder: uniqueGroupName(node.__loraStack),
            on: true, open: true, loras: [], __tagOpen: false,
        });
        syncData(node);
        renderRows(node);
    };
    toprow.append(newGrpBtn);

    const folderBtn = document.createElement("button");
    folderBtn.className = "wm-folder-btn";
    folderBtn.type = "button";
    folderBtn.onclick = () => {
        openFolderModal(node, node.__folderFilter || [], (sel) => {
            node.__folderFilter = sel; // null = 全部
            syncData(node);
            updateFolderBtn(folderBtn, node);
        });
    };
    toprow.append(folderBtn);
    node.__wmFolderBtn = folderBtn;
    container.append(toprow);

    // 2) 行容器（顶层 LoRA 行 + 配方组）
    const rowsEl = document.createElement("div");
    rowsEl.className = "wm-lora-rows";
    container.append(rowsEl);
    node.__rowsEl = rowsEl;
    bindTopDrop(rowsEl, node);

    // 3) 重名拦截警告条（Add 按钮上方）
    const warn = document.createElement("div");
    warn.className = "wm-lora-warn";
    container.append(warn);
    node.__wmWarnEl = warn;

    // 4) Add LoRA（加到顶层；取消则撤销空行）
    const addBtn = document.createElement("button");
    addBtn.className = "wm-lora-add";
    addBtn.type = "button";
    addBtn.textContent = "+ Add LoRA";
    addBtn.onclick = () => {
        const entry = { on: true, name: "", model: DEF_STRENGTH, tag: "", __tagOpen: false };
        node.__loraStack.push(entry);
        syncData(node);
        renderRows(node);
        showChooser(node, (path) => {
            if (topNameConflict(node, { name: path, __probe: true })) {
                showWarn(node, `顶层已存在同名：${basename(path)}（配方内外不受此限制）`);
                return false;
            }
            applyChosenPath(node, entry, path);
        }, () => {
            const idx = node.__loraStack.indexOf(entry);
            if (idx >= 0) {
                node.__loraStack.splice(idx, 1);
                syncData(node);
                renderRows(node);
            }
        });
    };
    container.append(addBtn);

    const domWidget = node.addDOMWidget("wm_lora_rows", "div", container, { serialize: false });
    domWidget.serializeValue = () => undefined;
    domWidget.computeSize = function (width) {
        const el = node.__rowsDomWidget?.element || container;
        // 用 scrollHeight 取真实内容高度（含被裁剪部分），避免外框比内容矮
        let h = el ? (el.scrollHeight || el.offsetHeight || 0) : 0;
        if (!h) {
            const n = (node.__loraStack || []).length;
            h = n === 0 ? 60 : n * ROW_H + 110;
        }
        return [width, h + 8];
    };
    node.__rowsDomWidget = domWidget;

    if (node.__wmFolderBtn) updateFolderBtn(node.__wmFolderBtn, node);
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
        catch (e) { console.warn("[WindMix] lora manager onNodeCreated failed", e); }
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
        } catch (e) { console.warn("[WindMix] lora manager onConfigure failed", e); }
    };
}

app.registerExtension({
    name: "windmix.lora.manager",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (NODE_TYPES.includes(nodeData?.name)) patchNodeType(nodeType);
    },
});
