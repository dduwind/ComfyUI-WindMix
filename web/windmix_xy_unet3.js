// web/windmix_xy_unet3.js
// ⚡ XY 输入: UNet3 — 动态 MODEL 输入接口
//
// 行为复刻 web/windmix_merge_text.js 的动态接口逻辑：
//   后端在 INPUT_TYPES 里预定义了 model1..model20 共 20 个 forceInput MODEL 接口，
//   但前端按需裁剪 / 新增，保证「始终只有一个空闲接口」——
//     * 已连接的接口后方自动追加下一个空闲接口；
//     * 断开后若有 ≥2 个空闲接口，移除其中索引较大的多余空闲接口；
//     * 节点首次创建时把所有空接口剪到仅剩 model1。
//   这样界面上不会一次性冒出 20 个接口，而是随连线动态增减。
//
// 每个接口接一个 MODEL 对象（UNETLoader 输出，或模型融合节点输出的融合模型）。

import { app } from "../../scripts/app.js";

const NODE_TYPE = "WindMixUNet3XY";
const MAX_MODELS = 20;

app.registerExtension({
    name: "WindMix.UNet3XY.DynamicInputs",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        const typeKey = nodeData.name || (nodeType && nodeType.comfyClass);
        if (typeKey !== NODE_TYPE) return;
        console.log("[WindMix.UNet3XY] dynamic MODEL inputs hooked for", nodeData.name);

        const origOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = origOnNodeCreated ? origOnNodeCreated.apply(this, arguments) : undefined;
            try {
                const node = this;
                setTimeout(() => {
                    try {
                        ensureOneFreeModelInput(node, true);
                        node.size = node.computeSize(node.size);
                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                    } catch (e) { console.error("WindMixUNet3XY init error:", e); }
                }, 0);
            } catch (e) {
                console.error("WindMixUNet3XY init schedule error:", e);
            }
            return r;
        };

        const origOnConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function (side, slot, connect, link_info, output) {
            const r = origOnConnectionsChange ? origOnConnectionsChange.apply(this, arguments) : undefined;
            if (side === 1) { // 输入侧
                const node = this;
                setTimeout(() => {
                    try {
                        ensureOneFreeModelInput(node, false);
                        node.size = node.computeSize(node.size);
                        if (app.graph) app.graph.setDirtyCanvas(true, true);
                    } catch (e) { console.error("WindMixUNet3XY conn change error:", e); }
                }, 50);
            }
            return r;
        };

        function ensureOneFreeModelInput(node, prune) {
            prune = prune || false;
            const slots = [];
            for (let i = 0; i < (node.inputs ? node.inputs.length : 0); i++) {
                const inp = node.inputs[i];
                const name = (inp && (inp.name || inp.label)) || "";
                const m = /^model(\d+)$/.exec(name);
                if (m) slots.push({ slot: i, idx: parseInt(m[1], 10), linked: !!inp.link });
            }
            slots.sort((a, b) => a.idx - b.idx);

            // 初始裁剪：去掉所有「未连接且索引 > 1」的空接口，只保留 model1
            if (prune) {
                const toRemove = slots
                    .filter(s => !s.linked && s.idx > 1)
                    .sort((a, b) => b.idx - a.idx);
                toRemove.forEach(s => { try { node.removeInput(s.slot); } catch (e) {} });
                return ensureOneFreeModelInput(node, false);
            }

            const maxIdx = slots.length
                ? Math.max.apply(null, slots.map(s => s.idx))
                : 0;
            const empty = slots.filter(s => !s.linked);

            // 没有任何空闲接口且未达上限 → 新增下一个 modelN
            if (empty.length === 0 && maxIdx < MAX_MODELS) {
                const nextIdx = maxIdx + 1;
                try { node.addInput("model" + nextIdx, "MODEL", { forceInput: true }); } catch (e) {}
                return ensureOneFreeModelInput(node, false);
            }

            // 保持仅一个空闲接口：移除多余的空接口（优先移除索引较大的）
            const empties = [];
            for (let i = 0; i < (node.inputs ? node.inputs.length : 0); i++) {
                const inp = node.inputs[i];
                const name = (inp && (inp.name || inp.label)) || "";
                const m = /^model(\d+)$/.exec(name);
                if (m && !inp.link) empties.push({ slot: i, idx: parseInt(m[1], 10) });
            }
            empties.sort((a, b) => b.idx - a.idx);
            while (empties.length > 1) {
                const rem = empties.shift();
                try { node.removeInput(rem.slot); } catch (e) {}
                return ensureOneFreeModelInput(node, false);
            }
        }
    }
});
