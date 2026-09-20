// web/windmix_merge_text.js
// ⚡prompt studio 合并文本 — 动态输入接口
//
// 行为参考 ComfyUI-ZML-Image 的 ZML_MergeText 动态输入逻辑：
//   后端在 INPUT_TYPES 里预定义了 文本1..文本20 共 20 个 forceInput 接口，
//   但前端按需裁剪 / 新增，保证「始终只有一个空闲接口」——
//     * 已连接的接口后方自动追加下一个空闲接口；
//     * 断开后若有 ≥2 个空闲接口，移除其中索引较大的多余空闲接口；
//     * 节点首次创建时把所有空接口剪到仅剩 文本1。
//   这样界面上不会一次性冒出 20 个接口，而是随连线动态增减。
//
// 分隔符默认值与 ZML 一致 (,\n\n)，并在输入框以转义形式展示（\n 显示为字面量）。

import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "WindMix.MergeText.DynamicInputs",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        // 与 __init__.py 中 NODE_CLASS_MAPPINGS 的 key 保持一致
        const typeKey = nodeData.name || (nodeType && nodeType.comfyClass);
        if (typeKey !== "⚡ Prompt Studio Merge Text") {
            return;
        }
        console.log("[WindMix.MergeText] dynamic inputs hooked for", nodeData.name);

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
            try {
                const node = this;
                setTimeout(() => {
                    try {
                        ensureOneFreeTextInput(node, true);
                        ensureSeparatorDisplayEscaped(node);
                        node.size = node.computeSize(node.size);
                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                    } catch (e) { console.error("WindMixMergeText init error:", e); }
                }, 0);
            } catch (e) {
                console.error("WindMixMergeText init schedule error:", e);
            }
            return r;
        };

        const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (side, slot, connect, link_info, output) {
            const r = origOnConnectionsChange ? origOnConnectionsChange.apply(this, arguments) : undefined;
            if (side === 1) {
                const node = this;
                setTimeout(() => {
                    try {
                        ensureOneFreeTextInput(node, false);
                        ensureSeparatorDisplayEscaped(node);
                        node.size = node.computeSize(node.size);
                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                    } catch (e) { console.error("WindMixMergeText conn change error:", e); }
                }, 50);
            }
            return r;
        };

        function ensureOneFreeTextInput(node, prune) {
            prune = prune || false;
            const textSlots = [];
            for (let i = 0; i < (node.inputs ? node.inputs.length : 0); i++) {
                const inp = node.inputs[i];
                const name = (inp && (inp.name || inp.label)) || "";
                const m = /^文本(\d+)$/.exec(name);
                if (m) textSlots.push({ slot: i, idx: parseInt(m[1], 10), linked: !!inp.link });
            }
            textSlots.sort((a, b) => a.idx - b.idx);

            // 初始裁剪：去掉所有「未连接且索引 > 1」的空接口，只保留 文本1
            if (prune) {
                const toRemove = textSlots
                    .filter(s => !s.linked && s.idx > 1)
                    .sort((a, b) => b.idx - a.idx);
                toRemove.forEach(s => { try { node.removeInput(s.slot); } catch (e) {} });
                return ensureOneFreeTextInput(node, false);
            }

            const maxIdx = textSlots.length
                ? Math.max.apply(null, textSlots.map(s => s.idx))
                : 0;
            const empty = textSlots.filter(s => !s.linked);

            // 没有任何空闲接口且未达上限 → 新增下一个 文本N
            if (empty.length === 0 && maxIdx < 20) {
                const nextIdx = maxIdx + 1;
                try { node.addInput("文本" + nextIdx, "STRING", { forceInput: true }); } catch (e) {}
                return ensureOneFreeTextInput(node, false);
            }

            // 保持仅一个空闲接口：移除多余的空接口（优先移除索引较大的）
            const empties = [];
            for (let i = 0; i < (node.inputs ? node.inputs.length : 0); i++) {
                const inp = node.inputs[i];
                const name = (inp && (inp.name || inp.label)) || "";
                const m = /^文本(\d+)$/.exec(name);
                if (m && !inp.link) empties.push({ slot: i, idx: parseInt(m[1], 10) });
            }
            empties.sort((a, b) => b.idx - a.idx);
            while (empties.length > 1) {
                const rem = empties.shift();
                try { node.removeInput(rem.slot); } catch (e) {}
                return ensureOneFreeTextInput(node, false);
            }
        }

        function ensureSeparatorDisplayEscaped(node) {
            const widgets = node.widgets || [];
            const w = widgets.find(w => w.name === "分隔符");
            if (!w) return;
            // 仅挂载一次回调钩子：把真实换行转成字面量 \n 显示
            if (!w.__windmix_escape_hooked) {
                w.__windmix_escape_hooked = true;
                const origCb = w.callback;
                w.callback = function (v) {
                    const s = String(v == null ? "" : v);
                    const escaped = s.replace(/\n/g, "\\n");
                    if (escaped !== w.value) {
                        w.value = escaped;
                        if (node.graph) node.graph.setDirtyCanvas(true, true);
                    }
                    if (origCb) try { origCb(w.value); } catch (e) {}
                };
            }
            // 初始化统一展示为转义形式（与 ZML 一致：默认显示为 ,\n\n）
            w.value = String(w.value == null ? "" : w.value).replace(/\n/g, "\\n");
        }
    }
});
