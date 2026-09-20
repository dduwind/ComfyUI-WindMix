import { app } from "/scripts/app.js";

console.log("[WindMix] lora_manager.js loaded, url=", import.meta.url);

// 两个节点共用这一套 DOM 行 UI（复刻 comfyui_fantastic-loras 的思路）：
//   文件夹筛选按钮(serialize=false, 置顶) + Add Lora 按钮 + 逐行[开关/名称/强度/删除]
//   + 每行下方 tag 文本框（选 LoRA 时自动读 metadata 填充）。
// 数据持久化在隐藏的 `lora_data` STRING 控件里（前端读写 JSON，ComfyUI 自动序列化）。
const NODE_TYPES = ["WindMixLoraStack", "WindMixLoraLoaderModelOnly", "WindMixLoraXY"];
const DATA_WIDGET = "lora_data";
const DEF_STRENGTH = 1.0;
const ROW_H = 72; // 单行(行+tag)估算高度兜底（computeSize 优先实测 DOM 高度）

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
// 后端在模型文件旁边找 <名>.png / <名>.preview.png（含 .webp/.avif 等，
// 见 prompt_studio/api.py 的 _PREVIEW_EXTS），找不到返回 404 → 浮窗整个不显示。
// 刻意不接外部插件的预览接口（曾用过 /api/lm/loras/preview-url 与
// /studio-suite/...）：图片这类数据源必须自包含，跨插件取图会让来源不唯一、
// 行为随对方插件的扫描状态漂移。
//==============================================================================
const WM_PREVIEW_TYPE = "loras";
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
        arr = Array.isArray(p) ? p : (p.loras || []);
    } catch (e) {
        arr = [];
    }
    node.__loraStack = arr
        .filter((e) => e && typeof e === "object")
        .map((e) => ({
            on: e.on !== false,
            name: (e.name || "").toString(),
            model: typeof e.model === "number" && Number.isFinite(e.model) ? e.model : DEF_STRENGTH,
            tag: (e.tag || "").toString(),
        }));
    node.__folderFilter = Array.isArray(node.properties?.folder_filter)
        ? node.properties.folder_filter
        : null;
}
function syncData(node) {
    const w = getDataWidget(node);
    if (!w) return;
    w.value = JSON.stringify(node.__loraStack || []);
    if (!node.properties) node.properties = {};
    node.properties.folder_filter = Array.isArray(node.__folderFilter) ? node.__folderFilter : [];
}

//==============================================================================
// 文件夹树弹窗（复刻 windmix_lora_folder_filter 的纯文件夹树勾选）
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
// LoRA 选择器（点名称/Add Lora 时弹出，按文件夹筛选 + 搜索）
//==============================================================================
let _chooserEl = null;
let _chooserDocHandler = null;
function closeChooser() {
    hidePreviewPop();
    if (_chooserEl) { _chooserEl.remove(); _chooserEl = null; }
    if (_chooserDocHandler) {
        // 用 window 捕获阶段，确保画布/其他节点的指针事件也能被捕获（默认模式下
        // document 冒泡监听可能收不到 litegraph 画布的 mousedown）。
        window.removeEventListener("pointerdown", _chooserDocHandler, true);
        _chooserDocHandler = null;
    }
}
function showChooser(node, onChoose, onCancel) {
    injectStyle();
    closeChooser();
    getLoraFiles(true).then((all) => {
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

        const search = document.createElement("input");
        search.className = "wm-chooser-search";
        search.placeholder = "搜索…";
        panel.append(search);

        const list = document.createElement("div");
        list.className = "wm-chooser-list";
        panel.append(list);

        const render = (q) => {
            list.innerHTML = "";
            const ql = (q || "").trim().toLowerCase();
            const vis = ql ? loras.filter((l) => l.toLowerCase().includes(ql)) : loras;
            if (!vis.length) {
                const empty = document.createElement("div");
                empty.className = "wm-chooser-empty";
                empty.textContent = set ? "所选文件夹内无 LoRA" : "无 LoRA";
                list.append(empty);
                return;
            }
            for (const path of vis) {
                const item = document.createElement("div");
                item.className = "wm-chooser-item";
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
        // 用 window 捕获阶段 pointerdown，保证 litegraph 画布上的点击也能触发关闭。
        _chooserDocHandler = (e) => {
            if (_chooserEl && !_chooserEl.contains(e.target)) {
                closeChooser();
                if (typeof onCancel === "function") onCancel();
            }
        };
        // 延迟一帧绑定，避开触发本弹窗的那次点击（pointerdown）
        setTimeout(() => window.addEventListener("pointerdown", _chooserDocHandler, true), 0);
        // 居中偏上
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
/* ---- WindMix LoRA 节点美化（仅视觉，结构不变） ---- */
.wm-lora-container { display:flex; flex-direction:column; gap:6px; padding-bottom:8px; }

/* 文件夹筛选：实色描边按钮，左对齐 */
.wm-folder-btn { width:100%; margin-bottom:2px; padding:8px 10px; text-align:center;
  background:var(--comfy-input-bg, #2a2a2a); color:var(--fg-color, #eee);
  border:1px solid var(--border-color, #444); border-radius:8px;
  cursor:pointer; font-size:12px;
  transition:border-color .15s ease, background .15s ease; }
.wm-folder-btn:hover { border-color:var(--comfy-primary, #534AB7); background:rgba(83,74,183,0.08); }

.wm-lora-rows { display:flex; flex-direction:column; gap:2px; }

/* 单行：hover 微高亮，控件聚焦描边（无障碍） */
.wm-lora-row { display:flex; align-items:stretch; gap:8px; padding:4px 6px; border-radius:8px;
  transition:background .15s ease; }
.wm-lora-row:hover { background:rgba(83,74,183,0.06); }
.wm-lora-row .wm-on { width:15px; height:15px; flex:none; cursor:pointer; align-self:center;
  accent-color:var(--comfy-primary, #534AB7); }
.wm-lora-row .wm-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  background:var(--comfy-input-bg, #2a2a2a); border:1px solid var(--border-color, #444); border-radius:6px;
  padding:6px 8px; cursor:pointer; color:var(--fg-color, #eee); font-size:12px; box-sizing:border-box;
  transition:border-color .15s ease, background .15s ease; }
.wm-lora-row .wm-name:hover { border-color:var(--comfy-primary, #534AB7); background:rgba(83,74,183,0.10); }
.wm-lora-row .wm-name:focus-visible { outline:2px solid var(--comfy-primary, #534AB7); outline-offset:1px; }
.wm-lora-row .wm-strength { width:60px; background:var(--comfy-input-bg, #2a2a2a); border:1px solid var(--border-color, #444);
  border-radius:6px; padding:6px 6px; color:var(--fg-color, #eee); font-size:12px; box-sizing:border-box;
  transition:border-color .15s ease; }
.wm-lora-row .wm-strength:focus { outline:none; border-color:var(--comfy-primary, #534AB7); }
.wm-lora-row .wm-del { flex:none; cursor:pointer; color:#e57373; padding:3px 6px; border-radius:6px; font-size:12px;
  border:2px solid var(--border-color, #444); background:var(--comfy-input-bg, #2a2a2a);
  display:inline-flex; align-items:center; justify-content:center; min-width:24px; line-height:1; font-weight:600; box-sizing:border-box;
  transition:background .15s ease, border-color .15s ease; }
.wm-lora-row .wm-del:hover { background:rgba(229,115,115,0.15); border-color:#e57373; }

/* tag 输入框：更轻、占位更淡 */
.wm-lora-tag { margin:0 0 6px 6px; }
.wm-lora-tag input { width:calc(100% - 8px); background:var(--comfy-input-bg, #2a2a2a);
  border:1px solid var(--border-color, #444); border-radius:6px; padding:5px 8px;
  color:var(--fg-color, #eee); font-size:11px; box-sizing:border-box;
  transition:border-color .15s ease; }
.wm-lora-tag input:focus { outline:none; border-color:var(--comfy-primary, #534AB7); }
.wm-lora-tag input::placeholder { color:var(--fg-color, #eee); opacity:0.45; }

.wm-lora-hint { color:var(--fg-color, #eee); opacity:0.55; font-size:12px; padding:8px 4px; font-style:italic; }

/* Add LoRA：实线 + 强调色，hover/active 加底色区分状态 */
.wm-lora-add { width:100%; margin-top:10px; margin-bottom:2px; padding:8px 0;
  background:transparent; color:#9b8af5;
  border:1px solid var(--comfy-primary, #534AB7); border-radius:8px;
  cursor:pointer; font-size:12px; font-weight:600;
  transition:background .15s ease, border-color .15s ease; }
.wm-lora-add:hover { background:rgba(83,74,183,0.18); border-color:#9b8af5; }
.wm-lora-add:active { background:rgba(83,74,183,0.28); }

/* ---- 选 LoRA 弹窗 ---- */
.wm-chooser { position:fixed; z-index:10001; width:480px; max-width:92vw; max-height:62vh; overflow:auto;
  background:var(--comfy-menu-bg, #2a2a2a); color:var(--fg-color, #eee);
  border:1px solid var(--border-color, #444); border-radius:10px;
  box-shadow:0 8px 30px rgba(0,0,0,0.5); font-family:sans-serif; font-size:12px; }
.wm-chooser-header { display:flex; align-items:center; justify-content:space-between;
  padding:9px 12px; border-bottom:1px solid var(--border-color, #444); }
.wm-chooser-title { font-size:13px; font-weight:500; }
.wm-chooser-close { cursor:pointer; color:var(--fg-color, #eee); opacity:0.6; padding:2px 6px; border-radius:6px;
  transition:background .15s ease, opacity .15s ease; }
.wm-chooser-close:hover { background:rgba(255,255,255,0.08); opacity:1; }
.wm-chooser-search { width:calc(100% - 20px); margin:8px 10px; padding:6px 8px;
  background:var(--comfy-input-bg, #2a2a2a); color:var(--fg-color, #eee);
  border:1px solid var(--border-color, #444); border-radius:6px; box-sizing:border-box;
  font-size:12px; transition:border-color .15s ease; }
.wm-chooser-search:focus { outline:none; border-color:var(--comfy-primary, #534AB7); }
.wm-chooser-list { padding-bottom:6px; }
.wm-chooser-item { padding:7px 12px; cursor:pointer; border-bottom:1px solid var(--border-color, #444);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  transition:background .12s ease, color .12s ease; }
.wm-chooser-item:last-child { border-bottom:none; }
.wm-chooser-item:hover { background:rgba(83,74,183,0.10); }
.wm-chooser-empty { padding:12px; color:var(--fg-color, #eee); opacity:0.6; }

/* ---- 文件夹树弹窗 ---- */
.wm-folder-backdrop { position:fixed; left:0; top:0; width:100%; height:100%;
  background:rgba(15,17,26,0.45); z-index:10000; display:flex; align-items:center; justify-content:center; }
.wm-folder-dialog { background:var(--comfy-menu-bg, #2a2a2a); color:var(--fg-color, #eee);
  border-radius:12px; width:454px; max-width:92vw; max-height:86vh; display:flex; flex-direction:column;
  font-family:sans-serif; box-shadow:0 8px 30px rgba(0,0,0,0.5); overflow:hidden; }
.wm-folder-header { display:flex; align-items:center; justify-content:space-between;
  padding:12px 16px; border-bottom:1px solid var(--border-color, #444); }
.wm-folder-title { font-size:14px; font-weight:500; }
.wm-folder-close { cursor:pointer; color:var(--fg-color, #eee); opacity:0.6; padding:2px 6px; border-radius:6px;
  transition:background .15s ease, opacity .15s ease; }
.wm-folder-close:hover { background:rgba(255,255,255,0.08); opacity:1; }
.wm-folder-toolbar { display:flex; gap:8px; padding:10px 16px; }
.wm-folder-tree { padding:4px 16px; overflow-y:auto; max-height:60vh; }
.wm-folder-row { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:6px;
  transition:background .12s ease; }
.wm-folder-row:hover { background:rgba(83,74,183,0.06); }
.wm-folder-tri { cursor:pointer; color:var(--fg-color, #eee); opacity:0.55; width:10px; flex:none;
  transition:opacity .12s ease; }
.wm-folder-tri:hover { opacity:1; }
.wm-folder-cb { accent-color:var(--comfy-primary, #534AB7); cursor:pointer; flex:none; }
.wm-folder-label { font-size:12px; cursor:default; }
.wm-folder-cnt { font-size:11px; color:var(--fg-color, #eee); opacity:0.55; }
.wm-folder-footer { display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--border-color, #444);
  justify-content:flex-end; }

/* ---- 通用按钮（弹窗内） ---- */
.wm-btn { flex:1; padding:6px 0; font-size:12px; cursor:pointer;
  background:var(--comfy-input-bg, #2a2a2a); color:var(--fg-color, #eee);
  border:1px solid var(--border-color, #444); border-radius:6px;
  transition:border-color .15s ease, background .15s ease; font-family:sans-serif; }
.wm-btn:hover { border-color:var(--comfy-primary, #534AB7); background:rgba(83,74,183,0.08); }
.wm-btn-primary { flex:0 0 auto; padding:6px 18px; background:var(--comfy-primary, #534AB7); color:#fff;
  border:1px solid var(--comfy-primary, #534AB7); }
.wm-btn-primary:hover { background:#6358c4; border-color:#6358c4; }

/* ---- 行拖动排序（⠿ 手柄） ---- */
.wm-grip { flex:none; cursor:grab; color:var(--fg-color, #eee); opacity:.45; user-select:none;
  display:inline-flex; align-items:center; align-self:center; padding:0 2px;
  transition:opacity .15s ease; }
.wm-grip:hover { opacity:.95; }
.wm-grip:active { cursor:grabbing; }
.wm-lora-row.dragging { opacity:.35; }
.wm-lora-row.drop-target { box-shadow:0 0 0 2px var(--comfy-primary, #534AB7) inset;
  background:rgba(83,74,183,0.12); border-radius:8px; }
/* ---- 模型预览浮窗 ---- */
.wm-preview-pop { position:fixed; z-index:100002; max-width:308px; padding:6px;
  background:var(--comfy-menu-bg,#2a2a2a); border:1px solid var(--border-color,#555);
  border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.45); pointer-events:none; }
.wm-preview-pop img { display:block; max-width:296px; max-height:56vh; border-radius:5px; object-fit:contain; }
`;
    document.head.append(s);
}

// 让节点根据 DOM 真实高度重新计算外框尺寸。
// 关键：Nodes 2.0 (Vue) 下，添加/删除 LoRA 行改变了 DOM 容器高度，但画布背景框
// (node.size) 不会自动跟着变，只有缩放触发全局重排时才恢复（用户反馈的现象）。
// 这里用 ResizeObserver 盯着 DOM 容器，高度一变就主动 setSize 同步，根治外框比
// 内容矮、内容悬浮。setSize 后 DOM 高度不变（DOM 流布局不受 node.size 影响），
// 故不会与 ResizeObserver 形成递归——但再加一道「高度没变就跳过」的保险。
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
    if (Math.abs((node.size?.[1] || 0) - h) < 0.5) return; // 高度没变，跳过，防递归
    node.setSize([Math.max(node.size?.[0] || w, w), h]);
    node.setDirtyCanvas?.(true, true);
}
// 观察 DOM 容器尺寸变化（添加/删除 LoRA 行会改高度），主动同步外框。
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

// grip 手柄可拖发起排序；拖拽数据带 node.id，drop 时校验，防跨节点串位。
// 用手柄而非整行 draggable，避免与行内强度/tag 输入框的拖选冲突。
function makeRowGrip(node, stack, i, row) {
    const grip = document.createElement("div");
    grip.className = "wm-grip";
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
    const stack = node.__loraStack || [];
    node.__rowsEl.innerHTML = "";

    if (!stack.length) {
        const hint = document.createElement("div");
        hint.className = "wm-lora-hint";
        hint.textContent = "暂无 LoRA，点击下方「+ Add LoRA」添加";
        node.__rowsEl.append(hint);
    }

    stack.forEach((entry, i) => {
        const row = document.createElement("div");
        row.className = "wm-lora-row";

        const on = document.createElement("input");
        on.type = "checkbox";
        on.className = "wm-on";
        on.checked = !!entry.on;
        on.onchange = () => { entry.on = on.checked; syncData(node); };

        const name = document.createElement("div");
        name.className = "wm-name";
        name.textContent = entry.name ? basename(entry.name) : "（点击选择 LoRA）";
        name.title = entry.name || "点击选择 LoRA";
        name.onclick = () => {
            showChooser(node, (path) => {
                entry.name = path;
                syncData(node);
                name.textContent = basename(path);
                name.title = path;
                // 自动填充 tag
                fetchTag(path).then((tag) => {
                    entry.tag = tag;
                    syncData(node);
                    if (tagInput) tagInput.value = tag;
                });
            });
        };

        // 鼠标悬停模型名 → 显示预览浮窗
        if (entry.name) {
            name.addEventListener("mouseenter", (e) => showPreviewPop(entry.name, e));
            name.addEventListener("mousemove", movePreviewPop);
            name.addEventListener("mouseleave", hidePreviewPop);
        }

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

        const del = document.createElement("div");
        del.className = "wm-del";
        del.textContent = "✕";
        del.title = "删除";
        del.onclick = () => {
            node.__loraStack.splice(i, 1);
            syncData(node);
            renderRows(node);
        };

        row.append(makeRowGrip(node, stack, i, row), on, name, strength, del);

        const tagWrap = document.createElement("div");
        tagWrap.className = "wm-lora-tag";
        const tagInput = document.createElement("input");
        tagInput.type = "text";
        tagInput.placeholder = "tag（选 LoRA 后自动填充，可编辑）";
        tagInput.value = entry.tag || "";
        tagInput.oninput = () => { entry.tag = tagInput.value; syncData(node); };
        tagWrap.append(tagInput);

        node.__rowsEl.append(row, tagWrap);
    });

    if (node.__rowsDomWidget && node.__rowsDomWidget.computeSize) {
        scheduleResize(node);
    }
}

function updateFolderBtn(btn, node) {
    if (!btn) return;
    const f = node.__folderFilter;
    let txt = "📁 文件夹筛选";
    if (Array.isArray(f) && f.length) txt = `📁 文件夹筛选 · ${f.length} 文件夹`;
    btn.textContent = txt;
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

    // 单一 DOM 容器：文件夹按钮 + 行 + Add 按钮 全部是 DOM 元素。
    // 不混用 litegraph 的 addWidget("button") —— 在 Nodes 2.0( Vue) 下，
    // litegraph 按钮控件与 DOM widget 是两套定位/事件体系，会重叠且吞掉点击
    // （表现为「Add LoRA 出现两个、点了没反应」）。comfyui_fantastic-loras 也是
    // 整块用 DOM 控件，所以我们照抄它的做法。
    const container = document.createElement("div");
    container.className = "wm-lora-container";

    // 1) 文件夹筛选按钮（DOM，置于最上）
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
    container.append(folderBtn);
    node.__wmFolderBtn = folderBtn;

    // 2) 行容器（renderRows 只管这里）
    const rowsEl = document.createElement("div");
    rowsEl.className = "wm-lora-rows";
    container.append(rowsEl);
    node.__rowsEl = rowsEl;

    // 3) Add LoRA 按钮（DOM，置于最下）
    const addBtn = document.createElement("button");
    addBtn.className = "wm-lora-add";
    addBtn.type = "button";
    addBtn.textContent = "+ Add LoRA";
    addBtn.onclick = () => {
        const entry = { on: true, name: "", model: DEF_STRENGTH, tag: "" };
        node.__loraStack.push(entry);
        syncData(node);
        renderRows(node);
        // 立即弹出选择器；点击外部/✕ 则撤销本次空行
        showChooser(node, (path) => {
            entry.name = path;
            syncData(node);
            renderRows(node);
            fetchTag(path).then((tag) => {
                entry.tag = tag;
                syncData(node);
                renderRows(node);
            });
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
        // 必须用 scrollHeight 而非 offsetHeight：默认(litegraph)模式下 ComfyUI 会把 DOM 容器
        // 高度固定为「上次计算值」，offsetHeight 会被这个旧高度约束而偏小（外框比内容矮、内容悬浮）。
        // scrollHeight 始终反映真实内容高度（含被 overflow 裁剪的部分），Nodes 2.0 下两者一致。
        let h = el ? (el.scrollHeight || el.offsetHeight || 0) : 0;
        if (!h) {
            const n = (node.__loraStack || []).length;
            h = n === 0 ? 60 : n * ROW_H + 90;
        }
        return [width, h + 8];
    };
    node.__rowsDomWidget = domWidget;

    updateFolderBtn(folderBtn, node);
    renderRows(node);
    attachResizeObserver(node, container); // 持续盯着 DOM 高度，外框自动跟随
}

//==============================================================================
// 扩展注册（采用 fantastic-loras 验证过的 beforeRegisterNodeDef + 原型钩子写法，
// onConfigure 在保存数据加载后触发，能正确读出 lora_data）
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
            loadStack(this);          // 读回已保存的 lora_data
            renderRows(this);
            if (this.__wmFolderBtn) updateFolderBtn(this.__wmFolderBtn, this);
            scheduleResize(this);          // 加载后内容变多，重算外框高度
        } catch (e) { console.warn("[WindMix] lora manager onConfigure failed", e); }
    };
}

app.registerExtension({
    name: "windmix.lora.manager",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (NODE_TYPES.includes(nodeData?.name)) patchNodeType(nodeType);
    },
});
