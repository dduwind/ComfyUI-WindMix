import { app } from "/scripts/app.js";

console.log("[WindMix] lora_folder_filter.js loaded, url=", import.meta.url);

// 文件夹筛选按钮采用 comfyui_fantastic-loras 的写法：serialize=false 让其不参与
// 序列化（保存/加载都跳过），因此可安全地 unshift 到 node.widgets 首位（视觉置顶）
// 而不会引发控件索引错位——aki-v3 的加载器对 serialize=false 的控件会自动跳过。
// 不 patch 任何全局原型方法。

const MAX_LORA_WIDGETS = 15;

// 统一分隔符：Windows 下 folder_paths 返回的路径用反斜杠，全部归一为 /
function norm(p) {
    return (p || "").replace(/\\/g, "/");
}
function basename(p) {
    const parts = norm(p).split("/");
    return parts[parts.length - 1] || p;
}

// 返回完整 LoRA 列表。首次从 lora_name_1 捕获并缓存到 node._wmFullLoraList，
// 防止筛选后下拉被收窄、再次打开弹窗时树丢失其他文件夹。
// 一律返回深拷贝，避免调用方修改污染缓存（节点复制/共享引用时尤其重要）。
function getFullLoraList(node) {
    if (node && Array.isArray(node._wmFullLoraList) && node._wmFullLoraList.length) {
        return [...node._wmFullLoraList];
    }
    const w = (node?.widgets || []).find((w) => w.name === "lora_name_1");
    const live = (w?.options?.values || [])
        .filter((v) => v && v !== "None")
        .map((v) => (typeof v === "object" && v !== null ? v.value : v));
    if (node && live.length) node._wmFullLoraList = live;
    return [...live];
}

// 由全部 LoRA 路径生成文件夹树（每节点持有直接文件列表 + 子文件夹）
function buildTree(allLoras) {
    const root = { folders: {}, files: [], fileCount: 0, prefix: "", name: "(根目录)", _open: true };
    const ensure = (prefix) => {
        if (!prefix) return root;
        const parts = prefix.replace(/\/$/, "").split("/");
        let node = root;
        let acc = "";
        for (const p of parts) {
            acc += p + "/";
            if (!node.folders[p]) node.folders[p] = { folders: {}, files: [], fileCount: 0, prefix: acc, name: p, _open: false };
            node = node.folders[p];
        }
        return node;
    };
    for (const path of allLoras) {
        const np = norm(path);
        const idx = np.lastIndexOf("/");
        const dir = idx >= 0 ? np.slice(0, idx + 1) : "";
        const n = ensure(dir);
        n.files.push(path);
        n.fileCount++;
    }
    return root;
}

function collectDescendantPrefixes(node, out) {
    out.add(node.prefix);
    for (const child of Object.values(node.folders)) collectDescendantPrefixes(child, out);
    return out;
}

// 纯字母序排序（不再有收藏置顶逻辑）
function sortLoras(list) {
    return [...list].sort((a, b) => norm(a).localeCompare(norm(b)));
}

// 给 combo widget 写新的下拉选项，并确保 Nodes 2.0 的 Vue 响应式源 (_state.options.values)
// 同步更新。不再调 w.callback（避免触发 fillTagForLora/refreshXYVisibility 的连环重渲），
// dispatchEvent 由调用方（applyFilter/resetToFullList）在循环结束后统一触发一次。
function setComboValues(node, w, values) {
    if (!w) return;
    w.options.values = values;
    const applyReactive = () => {
        if (w._state && w._state.options) {
            const arr = w._state.options.values;
            if (Array.isArray(arr)) arr.splice(0, arr.length, ...values);
            w._state.options.values = values;
            return true;
        }
        return false;
    };
    if (!applyReactive()) {
        const start = Date.now();
        const tick = () => {
            if (applyReactive()) return;
            if (Date.now() - start < 2000) requestAnimationFrame(tick);
        };
        tick();
    }
}

function _notifyXYRefresh(node) {
    try { window.dispatchEvent(new CustomEvent("windmix:xy-refresh", { detail: { node } })); } catch (e) {}
}

// 收窄每个 lora_name_i 的 options.values 为所选文件夹覆盖的 LoRA（字母序）
function applyFilter(node, selectedSet) {
    const all = getFullLoraList(node);
    if (!all.length) return;

    const filtered = all.filter((p) => {
        if (!selectedSet || selectedSet.size === 0) return false;
        const ndir = norm(p).includes("/") ? norm(p).slice(0, norm(p).lastIndexOf("/") + 1) : "";
        for (const f of selectedSet) {
            const nf = norm(f);
            if (nf === "") {
                if (ndir === "") return true;
            } else if (ndir === nf || ndir.startsWith(nf)) {
                return true;
            }
        }
        return false;
    });

    const values = ["None", ...sortLoras(filtered)];

    for (let i = 1; i <= MAX_LORA_WIDGETS; i++) {
        const w = (node.widgets || []).find((x) => x.name === `lora_name_${i}`);
        if (!w) continue;
        setComboValues(node, w, values);
    }
    _notifyXYRefresh(node);
}

// 无筛选时把每个 lora_name_i 重置回完整列表（按字母序）
function resetToFullList(node) {
    const all = getFullLoraList(node);
    if (!all.length) return;
    const values = ["None", ...sortLoras(all)];
    for (let i = 1; i <= MAX_LORA_WIDGETS; i++) {
        const w = (node.widgets || []).find((x) => x.name === `lora_name_${i}`);
        if (!w) continue;
        setComboValues(node, w, values);
    }
    _notifyXYRefresh(node);
}

// 打开模态：纯文件夹树勾选（无收藏、无搜索框）
function openFolderModal(node, currentSelected, onApply) {
    const all = getFullLoraList(node);
    const tree = buildTree(all);
    const selected = new Set(currentSelected && currentSelected.length ? currentSelected : collectDescendantPrefixes(tree, new Set()));

    let backdrop = document.getElementById("windmix_folder_modal");
    if (backdrop) backdrop.remove();

    backdrop = document.createElement("div");
    backdrop.id = "windmix_folder_modal";
    Object.assign(backdrop.style, {
        position: "fixed", left: "0", top: "0", width: "100%", height: "100%",
        background: "rgba(15,17,26,0.45)", zIndex: "10000",
        display: "flex", alignItems: "center", justifyContent: "center",
    });
    backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.remove(); };

    const dialog = document.createElement("div");
    Object.assign(dialog.style, {
        background: "#ffffff", color: "#26215C", borderRadius: "12px",
        width: "340px", maxHeight: "86vh", display: "flex", flexDirection: "column",
        fontFamily: "sans-serif", boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "0.5px solid #D3D1C7",
    });
    const title = document.createElement("div");
    title.style.fontSize = "14px";
    title.style.fontWeight = "500";
    title.textContent = "选择 LoRA 文件夹";
    const closeBtn = document.createElement("div");
    Object.assign(closeBtn.style, {
        width: "22px", height: "22px", lineHeight: "20px", textAlign: "center",
        cursor: "pointer", color: "#888780", borderRadius: "4px",
    });
    closeBtn.textContent = "✕";
    closeBtn.onclick = () => backdrop.remove();
    header.append(title, closeBtn);

    const toolbar = document.createElement("div");
    Object.assign(toolbar.style, { display: "flex", gap: "8px", padding: "10px 16px" });
    const mkBtn = (label) => {
        const b = document.createElement("button");
        b.textContent = label;
        Object.assign(b.style, {
            flex: "1", padding: "6px 0", fontSize: "12px", cursor: "pointer",
            background: "#fff", color: "#444441", border: "0.5px solid #B4B2A9", borderRadius: "6px",
        });
        return b;
    };
    const selAll = mkBtn("全选");
    const selNone = mkBtn("全不选");
    selAll.onclick = () => { collectDescendantPrefixes(tree, selected); renderFolderTree(); };
    selNone.onclick = () => { selected.clear(); renderFolderTree(); };
    toolbar.append(selAll, selNone);

    const treeBox = document.createElement("div");
    Object.assign(treeBox.style, {
        padding: "4px 16px", overflowY: "auto", borderBottom: "0.5px solid #D3D1C7",
        maxHeight: "60vh",
    });

    // 单文件行：只显示文件名（无星标）
    function fileRow(path, depth) {
        const row = document.createElement("div");
        Object.assign(row.style, {
            display: "flex", alignItems: "center", gap: "6px", padding: "2px 0",
            marginLeft: depth * 14 + "px",
        });
        const name = document.createElement("span");
        name.textContent = basename(path);
        name.title = path;
        Object.assign(name.style, { fontSize: "12px", color: "#444441" });
        row.append(name);
        return row;
    }

    function renderFolderTree() {
        treeBox.innerHTML = "";
        const renderNode = (node, depth) => {
            const row = document.createElement("div");
            Object.assign(row.style, {
                display: "flex", alignItems: "center", gap: "6px", padding: "3px 0",
                marginLeft: depth * 14 + "px",
            });
            const tri = document.createElement("span");
            tri.textContent = node._open === false ? "▸" : "▾";
            tri.style.cursor = "pointer";
            tri.style.color = "#888780";
            tri.style.width = "10px";
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = selected.has(node.prefix);
            cb.onchange = () => {
                const desc = collectDescendantPrefixes(node, new Set());
                if (cb.checked) desc.forEach((p) => selected.add(p));
                else desc.forEach((p) => selected.delete(p));
                renderFolderTree();
            };
            const label = document.createElement("span");
            label.textContent = node.name;
            label.style.fontSize = "12px";
            const cnt = document.createElement("span");
            cnt.textContent = "(" + node.fileCount + ")";
            cnt.style.fontSize = "11px";
            cnt.style.color = "#888780";
            tri.onclick = () => { node._open = node._open === false ? true : false; renderFolderTree(); };
            row.append(tri, cb, label, cnt);
            treeBox.append(row);
            if (node._open !== false) {
                for (const f of node.files) treeBox.append(fileRow(f, depth + 1));
                for (const child of Object.values(node.folders)) renderNode(child, depth + 1);
            }
        };
        renderNode(tree, 0);
    }
    renderFolderTree();

    const footer = document.createElement("div");
    Object.assign(footer.style, {
        display: "flex", gap: "8px", padding: "12px 16px",
        borderTop: "0.5px solid #D3D1C7", justifyContent: "flex-end",
    });
    const cancel = mkBtn("取消");
    cancel.style.flex = "0 0 auto";
    cancel.style.padding = "6px 16px";
    cancel.onclick = () => backdrop.remove();
    const apply = mkBtn("应用 (" + selected.size + ")");
    apply.style.flex = "0 0 auto";
    apply.style.padding = "6px 16px";
    apply.style.background = "#534AB7";
    apply.style.color = "#fff";
    apply.style.border = "none";
    apply.onclick = () => {
        const allPrefixes = collectDescendantPrefixes(tree, new Set());
        // 丢根目录 ""，仅保留具体子目录。根目录与具体目录并存时，applyFilter 里
        // ndir.startsWith("") 会匹配全部，导致筛选失效（同 UNet2 节点修复）。
        const nonRoot = [...selected].filter((p) => p !== "");
        const selHasAll = [...selected].sort().join("|") === [...allPrefixes].sort().join("|");
        const isAll = nonRoot.length === 0 || selHasAll;
        onApply(isAll ? [] : nonRoot, isAll);
        backdrop.remove();
    };
    footer.append(cancel, apply);

    dialog.append(header, toolbar, treeBox, footer);
    backdrop.append(dialog);
    document.body.append(backdrop);
}

// 统计所选文件夹前缀覆盖的 LoRA 数量
function countLorasInPrefixes(allLoras, selectedSet) {
    if (!selectedSet || selectedSet.size === 0) return 0;
    let n = 0;
    for (const p of allLoras) {
        const ndir = norm(p).includes("/") ? norm(p).slice(0, norm(p).lastIndexOf("/") + 1) : "";
        for (const f of selectedSet) {
            const nf = norm(f);
            if (nf === "" || ndir === nf || ndir.startsWith(nf)) { n++; break; }
        }
    }
    return n;
}

// 刷新按钮文字
function updateFolderBtn(btn, node) {
    if (!btn) return;
    const sel = node.properties?.folder_filter;
    let txt = "文件夹筛选";
    if (Array.isArray(sel) && sel.length) {
        const all = getFullLoraList(node);
        const cnt = countLorasInPrefixes(all, new Set(sel));
        txt = `文件夹筛选 · ${sel.length}文件夹/${cnt}LoRA`;
    }
    // 只改 label，不碰 name（name 是控件标识，改了会扰乱序列化匹配）
    if (btn.label !== undefined) btn.label = txt;
}

// 工作流加载/刷新后恢复文件夹筛选：ComfyUI 可能还没把完整 LoRA 列表填进
// lora_name_1.options.values（尤其首次加载或切换工作流时）。单次 setTimeout 容易
// 扑空，导致下拉只剩 ["None"]，已保存的 LoRA 值虽然没丢但显示为 None。
// 这里轮询直到完整列表就绪，再 apply/reset，同时触发 windmix:xy-refresh 让
// widgethider 重新对齐显隐。
function restoreFolderFilter(node, btn) {
    let attempts = 0;
    const tick = () => {
        const all = getFullLoraList(node);
        if (!all.length) {
            if (++attempts < 20) setTimeout(tick, 200);
            return;
        }
        const saved = node.properties?.folder_filter;
        if (Array.isArray(saved) && saved.length) {
            applyFilter(node, new Set(saved));
        } else {
            resetToFullList(node);
        }
        updateFolderBtn(btn, node);
        try { window.dispatchEvent(new CustomEvent("windmix:xy-refresh", { detail: { node } })); } catch (e) {}
    };
    setTimeout(tick, 200);
}

app.registerExtension({
    name: "windmix.lora.folderfilter",
    nodeCreated(node) {
        if (node.comfyClass !== "⚡ XY Input: LoRA") return;
        if (node._wmFolderBtn) return;
        node._wmFolderBtn = true;

        const findWidget = (name) => (node.widgets || []).find((w) => w.name === name);

        const btn = node.addWidget("button", "文件夹筛选", "folder_filter", () => {
            if (!node.properties) node.properties = {};
            const current = Array.isArray(node.properties.folder_filter) ? node.properties.folder_filter : [];
            openFolderModal(node, current, (sel, isAll) => {
                node.properties.folder_filter = isAll ? [] : sel;
                // 节点已无 Batch 模式，直接按文件夹筛选 / 完整列表分支
                if (isAll) {
                    resetToFullList(node);
                } else {
                    applyFilter(node, new Set(sel));
                }
                updateFolderBtn(btn, node);
            });
        });
        // serialize=false 让按钮不参与保存/加载，值不写进工作流。
        // 按钮保持在 node.widgets 末尾（addWidget 默认追加位置）：
        // 若 unshift 到首位会打乱 aki-v3 加载器按索引恢复 widget 值时的对齐，
        // 实测导致刷新/切工作流后 lora_count、model_strength 等控件错位。
        if (btn) {
            btn.serialize = false;
            if (btn.options) btn.options.serialize = false;
            btn.serializeValue = () => undefined;
        }

        // 工作流加载后恢复已保存的筛选（带重试，等 LoRA 列表就绪）
        restoreFolderFilter(node, btn);
    },
    loadedGraphNode(node) {
        if (node.comfyClass !== "⚡ XY Input: LoRA") return;
        // 用重试机制确保 LoRA 列表已就绪，避免切换工作流后下拉被清空
        const btn = (node.widgets || []).find((w) => w.name === "folder_filter");
        restoreFolderFilter(node, btn);
    },
});