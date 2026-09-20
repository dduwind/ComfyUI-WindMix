import { app } from "/scripts/app.js";

// 🧩 Prompt Groups — 按 mode 显隐专属参数：
//   - 'separator' 模式：显示 separator，隐藏 remove_empty_lines
//   - 'line'      模式：显示 remove_empty_lines，隐藏 separator
// 两个参数按需出现（而非都摆在下面）。
// 复用 windmix_widgethider.js 的 setHidden 写法，兼容 Nodes 1.0 画布与 Nodes 2.0 (Vue)。
console.log("[WindMix] prompt_groups.js loaded, app=", typeof app, "url=", import.meta.url);

const PG_CLASS = "🧩 Prompt Groups";

const findWidgetByName = (node, name) =>
    node.widgets ? node.widgets.find((w) => w.name === name) : null;

function setHidden(node, widget, hidden) {
    if (!widget) return;

    // Nodes 1.0 画布（litegraph 读 widget.hidden）
    widget.hidden = hidden;
    widget._wmWantHidden = hidden;

    // Nodes 2.0 Vue 只认响应式 state 的 options.hidden。
    // _state 往往晚于 nodeCreated / loadedGraphNode 才就绪，故先写裸 options 兜底，
    // 并轮询直到 _state 出现再写代理 + 替换整个 options 引用强制 Vue 重新求值。
    const applyState = () => {
        if (widget._state && widget._state.options) {
            widget._state.options.hidden = widget._wmWantHidden;
            try {
                widget._state.options = { ...widget._state.options, hidden: widget._wmWantHidden };
            } catch (e) {}
        }
    };

    if (widget._state) {
        applyState();
    } else if (widget.options) {
        widget.options.hidden = widget._wmWantHidden;
        if (!widget._wmStateRetry) {
            widget._wmStateRetry = true;
            let tries = 0;
            const tick = () => {
                if (widget._state) {
                    applyState();
                    widget._wmStateRetry = false;
                    return;
                }
                if (tries++ < 120) requestAnimationFrame(tick);
                else widget._wmStateRetry = false;
            };
            requestAnimationFrame(tick);
        }
    }

    // 老前端（无 Vue 响应式 state，仅靠 type 隐藏）才用 type/computeSize hack；
    // 现代前端设 type="hidden" 会让 Vue 回退成 WidgetLegacy 照样画出且反复重挂载，必须避免。
    if (!widget._state) {
        if (widget._origType === undefined) widget._origType = widget.type;
        widget.type = hidden ? "hidden" : widget._origType;
        if (hidden) {
            if (!widget._origComputeSize) widget._origComputeSize = widget.computeSize;
            widget.computeSize = function () { return [0, -4]; };
        } else if (widget._origComputeSize) {
            widget.computeSize = widget._origComputeSize;
        }
    } else if (widget._origType !== undefined) {
        widget.type = widget._origType;
        delete widget._origType;
        if (widget._origComputeSize) {
            widget.computeSize = widget._origComputeSize;
            delete widget._origComputeSize;
        }
    }
}

function refreshPromptGroup(node) {
    const modeW = findWidgetByName(node, "mode");
    if (!modeW) return;
    const isLine = modeW.value === "line";
    // separator 仅 separator 模式可见；remove_empty_lines 仅 line 模式可见
    setHidden(node, findWidgetByName(node, "separator"), isLine);
    setHidden(node, findWidgetByName(node, "remove_empty_lines"), !isLine);
    try { app.graph?.setDirtyCanvas(true, true); } catch (e) {}
}

function hookPromptGroup(node) {
    if (node._pgHooked) return;
    node._pgHooked = true;

    const modeW = findWidgetByName(node, "mode");
    if (modeW && !modeW._pgCallbackHooked) {
        modeW._pgCallbackHooked = true;
        const orig = modeW.callback;
        modeW.callback = function (...args) {
            const r = orig ? orig.apply(this, args) : undefined;
            refreshPromptGroup(node);
            if (node.widgets) node.widgets = [...node.widgets];
            // Vue 重渲异步，rAF 后再 apply 一次，避免显隐被覆盖。
            requestAnimationFrame(() => {
                refreshPromptGroup(node);
                if (node.widgets) node.widgets = [...node.widgets];
            });
            return r;
        };
    }

    // 初始刷新（_state 可能晚到，多重试几轮）
    let attempts = 0;
    const tryRefresh = () => {
        refreshPromptGroup(node);
        if (node.widgets) node.widgets = [...node.widgets];
        attempts++;
        if (attempts < 20) setTimeout(tryRefresh, 100);
    };
    setTimeout(tryRefresh, 50);
    setTimeout(() => refreshPromptGroup(node), 600);
    setTimeout(() => refreshPromptGroup(node), 1500);
}

app.registerExtension({
    name: "windmix.prompt_groups",
    nodeCreated(node) {
        if (node.comfyClass !== PG_CLASS && node.comfyClass !== "WindMix_PromptGroups") return;
        setTimeout(() => hookPromptGroup(node), 0);
    },
    loadedGraphNode(node) {
        if (node.comfyClass !== PG_CLASS && node.comfyClass !== "WindMix_PromptGroups") return;
        setTimeout(() => {
            refreshPromptGroup(node);
            if (node.widgets) node.widgets = [...node.widgets];
        }, 0);
    }
});
