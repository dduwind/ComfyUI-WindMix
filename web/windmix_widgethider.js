import { app } from "/scripts/app.js";

console.log("[WindMix] widgethider.js loaded, app=", typeof app, "url=", import.meta.url);

(function () {
"use strict";

const findWidgetByName = (node, name) =>
    node.widgets ? node.widgets.find((w) => w.name === name) : null;

// 兼容 Nodes 1.0 画布与 Nodes 2.0 (Vue) 的读值：优先读响应式源 _state.value
function getWidgetValue(w) {
    if (!w) return undefined;
    if (w._state) return w._state.value;
    return w.value;
}

// 兼容两种前端的写值：
// - widget.value 是 Vue 重建（node.widgets=[...] 或 loadWidgetsConfig）时的权威源，必须写；
// - _state.value 是即时响应式源，让输入框立即显示新值。
// 只写 _state.value 不写 widget.value，会在下一次重渲时丢值（这正是全局强度/ tag
// 自动填「写了却没变」的根因）。
function setWidgetValue(w, v) {
    if (!w) return;
    w.value = v;
    if (w._state) w._state.value = v;
}

//==============================================================================
// ④ LoRA metadata.json → tag 自动填充
// 选 LoRA 时从同级的 <lora名>.metadata.json 读取 trainedWords，自动填入对应 tag_i
// （显示出来且可编辑；若 metadata 无 trainedWords 则不覆盖用户已填内容）。
//==============================================================================
const _metaCache = new Map();
function fetchTrainedWords(name) {
    if (!name || name === "None") return Promise.resolve("");
    if (_metaCache.has(name)) return _metaCache.get(name);
    const p = fetch(`/windmix/lora_metadata?name=${encodeURIComponent(name)}`)
        .then((r) => (r.ok ? r.json() : { trainedWords: [] }))
        .then((d) => (Array.isArray(d.trainedWords) ? d.trainedWords.join(", ") : ""))
        .catch(() => "");
    _metaCache.set(name, p);
    return p;
}
function fillTagForLora(node, i, reassign) {
    const lw = findWidgetByName(node, `lora_name_${i}`);
    const tw = findWidgetByName(node, `tag_${i}`);
    if (!lw || !tw) return;
    const name = getWidgetValue(lw);
    if (!name || name === "None") return;
    fetchTrainedWords(name).then((words) => {
        const lwNow = findWidgetByName(node, `lora_name_${i}`);
        if (getWidgetValue(lwNow) !== name) return; // 竞态保护
        if (!words) return;
        const cur = (getWidgetValue(tw) || "").trim();
        if (cur !== words) {
            setWidgetValue(tw, words);   // 双写：Vue 重建时也不会丢
            tw._wmAutoTag = name;
            // 双保险：节点可能被 folder_filter / hookStrengthSync 重排 node.widgets，
            // 把刚写入的值冲掉。延迟再写一次覆盖。
            setTimeout(() => {
                const tw2 = findWidgetByName(node, `tag_${i}`);
                if (tw2 && (getWidgetValue(tw2) || "").trim() !== words) {
                    setWidgetValue(tw2, words);
                }
            }, 300);
        }
        if (reassign && node.widgets) node.widgets = [...node.widgets];
    });
}
function hookLoraTagAutoFill(node, runInitial) {
    if (!node.widgets) return;
    for (let i = 1; i <= MAX_COUNT; i++) {
        const lw = findWidgetByName(node, `lora_name_${i}`);
        if (!lw || lw._tagHooked) continue;
        lw._tagHooked = true;
        const orig = lw.callback;
        lw.callback = function (...args) {
            const r = orig ? orig.apply(this, args) : undefined;
            fillTagForLora(node, i, true);   // 单 LoRA 切换：写值后立即重渲一次
            return r;
        };
    }
    if (runInitial) {
        for (let i = 1; i <= MAX_COUNT; i++) fillTagForLora(node, i, false);
        // 批量初始填充：等 fetch 都写完后统一重渲一次（避免 15 次重渲）
        setTimeout(() => { if (node.widgets) node.widgets = [...node.widgets]; }, 600);
    }
}

function setHidden(node, widget, hidden) {
    if (!widget) return;

    // Nodes 1.0 画布（litegraph 读 widget.hidden）
    widget.hidden = hidden;
    // 记录目标值，供 _state 就绪后的轮询使用（避免中途多次调用时取值被覆盖）
    widget._wmWantHidden = hidden;

    // Nodes 2.0 Vue 只认响应式 state 的 options.hidden。
    // 坑：nodeCreated / loadedGraphNode 时 widget._state 往往还没赋值，
    // 此时若只写裸 widget.options.hidden，Vue 不会重渲染（computed 已被缓存）。
    // 因此：_state 就绪则立即写；否则先写裸对象兜底，并轮询直到 _state 出现再写代理。
    const applyState = () => {
        if (widget._state && widget._state.options) {
            widget._state.options.hidden = widget._wmWantHidden;
            // 强制 Vue 重新求值 computed：替换整个 options 引用。
            // 否则 _state.options.hidden 只是改了属性，Vue 的 computed/safeWidgets
            // 缓存了旧值不重渲染——这是 Nodes 2.0 下 tag/batch_path 隐藏不生效的根因。
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
        // 清理旧版本可能遗留的脏 type / computeSize
        widget.type = widget._origType;
        delete widget._origType;
        if (widget._origComputeSize) {
            widget.computeSize = widget._origComputeSize;
            delete widget._origComputeSize;
        }
    }
}

function recompute(node) {
    try {
        if (typeof node.computeSize === "function") {
            const size = node.computeSize();
            if (Array.isArray(size) && size.length >= 2) {
                node.size = [Math.max(node.size[0] || 0, size[0]), size[1]];
            }
        }
    } catch (e) {}
    try { app.graph?.setDirtyCanvas(true, true); } catch (e) {}
}

//==============================================================================
// ⚡ DiT Efficient Loader: auto-switch clip_type/clip_name/vae_name
//==============================================================================

const DIT_FAMILY_CONFIG = {
    "Anima": {
        clip_type: "qwen_image",
        clip_name: "qwen_3_06b_base.safetensors",
        vae_name: "qwen_image_vae.safetensors",
    },
    "Z-Image": {
        clip_type: "lumina2",
        clip_name: "qwen_3_4b.safetensors",
        vae_name: "Z-Image_clear_vae.safetensors",
    },
    "Krea-2": {
        clip_type: "krea2",
        clip_name: "qwen3vl_4b_fp8_scaled.safetensors",
        vae_name: "qwen_image_vae.safetensors",
    },
    "Generic DiT": {
        clip_type: "flux",
        clip_name: "Auto",
        vae_name: "Auto",
    },
};

function setComboIfPresent(widget, value) {
    if (!widget) return;
    const opts = widget.options?.values;
    if (!Array.isArray(opts) || !opts.includes(value)) return;
    widget.value = value;
    if (typeof widget.callback === "function") widget.callback(value);
}

function applyDiTFamilyConfig(node) {
    const family = findWidgetByName(node, "model_family")?.value;
    const cfg = DIT_FAMILY_CONFIG[family];
    if (!cfg) return;

    setComboIfPresent(findWidgetByName(node, "clip_type"), cfg.clip_type);
    setComboIfPresent(findWidgetByName(node, "clip_name"), cfg.clip_name);
    setComboIfPresent(findWidgetByName(node, "vae_name"), cfg.vae_name);
    recompute(node);
}

function hookDiTFamily(node) {
    const familyWidget = findWidgetByName(node, "model_family");
    if (!familyWidget || familyWidget._familyHooked) return;
    familyWidget._familyHooked = true;

    const origCallback = familyWidget.callback;
    familyWidget.callback = function (...args) {
        const r = origCallback ? origCallback.apply(this, args) : undefined;
        applyDiTFamilyConfig(node);
        return r;
    };

    // Initial apply (retry until options are populated)
    let attempts = 0;
    const tryApply = () => {
        applyDiTFamilyConfig(node);
        const clipName = findWidgetByName(node, "clip_name");
        const opts = clipName?.options?.values;
        const targetName = DIT_FAMILY_CONFIG[familyWidget.value]?.clip_name;
        attempts++;
        if ((!Array.isArray(opts) || !opts.includes(targetName)) && attempts < 20) {
            setTimeout(tryApply, 100);
        }
    };
    setTimeout(tryApply, 50);
}

//==============================================================================
// XY Input visibility configuration
//==============================================================================

const MAX_COUNT = 15;

const XY_INPUT_CONFIG = {
    "⚡ XY Input: LoRA": {
        // 简化版：固定「LoRA Names+Tags」风格，无模式切换。
        // 无 modes——refreshXYVisibility 走 always + numbered 分支。
        countWidget: "lora_count",
        always: ["lora_count", "model_strength", "include_none"],
        numbered: ["lora_name_{i}", "model_str_{i}", "tag_{i}"],
        hidden: []
    },
    "⚡ XY Input: LoRA Plot": {
        countWidget: null,
        numbered: [],
        modes: {
            "X: LoRA Batch, Y: LoRA Weight": {
                always: ["input_mode", "X_batch_path", "X_subdirectories", "X_batch_sort",
                         "X_batch_count", "Y_batch_count", "Y_first_value", "Y_last_value"],
                numbered: [],
                hidden: ["lora_name", "model_strength", "clip_strength",
                         "X_first_value", "X_last_value"]
            },
            "X: LoRA Batch, Y: Model Strength": {
                always: ["input_mode", "X_batch_path", "X_subdirectories", "X_batch_sort",
                         "X_batch_count", "Y_batch_count", "Y_first_value", "Y_last_value",
                         "clip_strength"],
                numbered: [],
                hidden: ["lora_name", "model_strength",
                         "X_first_value", "X_last_value"]
            },
            "X: LoRA Batch, Y: Clip Strength": {
                always: ["input_mode", "X_batch_path", "X_subdirectories", "X_batch_sort",
                         "X_batch_count", "Y_batch_count", "Y_first_value", "Y_last_value",
                         "model_strength"],
                numbered: [],
                hidden: ["lora_name", "clip_strength",
                         "X_first_value", "X_last_value"]
            },
            "X: Model Strength, Y: Clip Strength": {
                always: ["input_mode", "lora_name", "model_strength", "clip_strength",
                         "X_batch_count", "X_first_value", "X_last_value",
                         "Y_batch_count", "Y_first_value", "Y_last_value"],
                numbered: [],
                hidden: ["X_batch_path", "X_subdirectories", "X_batch_sort"]
            }
        }
    },
    "⚡ XY Input: UNet Model": {
        countWidget: "model_count",
        numbered: ["unet_name_{i}", "clip_name_{i}", "vae_name_{i}"],
        modes: {
            "Model Names": {
                always: ["input_mode", "model_count"],
                numbered: ["unet_name_{i}"],
                hidden: ["clip_name_{i}", "vae_name_{i}"]
            },
            "Model Names+Clip": {
                always: ["input_mode", "model_count"],
                numbered: ["unet_name_{i}", "clip_name_{i}"],
                hidden: ["vae_name_{i}"]
            },
            "Model Names+Clip+VAE": {
                always: ["input_mode", "model_count"],
                numbered: ["unet_name_{i}", "clip_name_{i}", "vae_name_{i}"],
                hidden: []
            }
        }
    }
};

function collectManagedNames(config) {
    const names = new Set();
    // 顶层 always/hidden（简化节点用，无 modes）
    for (const n of config.always || []) names.add(n);
    for (const n of config.hidden || []) names.add(n);
    // 兼容旧的多模式节点
    if (config.modes) {
        for (const m of Object.values(config.modes)) {
            for (const n of m.always || []) names.add(n);
            for (const n of m.hidden || []) names.add(n);
        }
    }
    for (const tpl of config.numbered || []) {
        for (let i = 1; i <= MAX_COUNT; i++) names.add(tpl.replace("{i}", i));
    }
    if (config.countWidget) names.add(config.countWidget);
    return names;
}

// 校验并修复 countWidget（lora_count / model_count / batch_count / input_count）的值：
// 加载工作流时如果存了损坏数据（NaN / -1 / 超出 MAX_COUNT），INT 控件会直接显示坏值，
// 导致节点没法用、每次都要手动重新添加。这里把无效值重置为默认 3（XYPLOT_DEF），
// 合法的 0 保留（用户可能故意设为 0）。
// 兜底校验节点上所有 widget 的值——加载工作流时如果存了损坏数据（NaN/null/undefined/
// 越界/COMBO 不在选项里），ComfyUI 会直接显示坏值，导致整个节点没法用。
// 这里按 widget 类型分别回退到合法默认：COMBO 取 options.values[0]，INT/FLOAT 取
// options.default（缺失则取 min），BOOLEAN/STRING 同理。只改明确非法的值，保留用户已设的合法值。
function ensureValidWidgets(node) {
    if (!node.widgets) return;
    for (const w of node.widgets) {
        if (!w) continue;
        // 跳过按钮/隐藏控件（本扩展自己加的文件夹筛选按钮、legacy 隐藏 hack）
        if (w.type === "button" || w.type === "hidden") continue;
        const opts = w.options || {};
        const val = w.value;

        // COMBO：只在值明显非法（null/undefined/空串）时才回退到第一项；
        // 保留合法的非空字符串值，即使不在当前 options.values 里——
        // 文件夹筛选会收窄 options，但用户保存的 LoRA 路径可能不在当前筛选范围内，
        // 这时不应覆盖用户数据，只在下拉里看不到而已（原版行为）。
        if (Array.isArray(opts.values) && opts.values.length > 0) {
            if (val == null || val === "") {
                const DEFAULT = opts.values[0];
                setWidgetValue(w, DEFAULT);
                // 校验阶段严禁触发 callback：否则会级联触发 hookStrengthSync / tag 填充，
                // 在工作流加载/刷新时把用户已保存的独立强度/tag 覆盖掉（导致参数错位）。
            }
            continue;
        }

        // INT 或 FLOAT：值必须是有限数，且在 [min, max] 范围内（修「lora_count NaN/越界」
        // 「model_strength 默认变 NaN」「model_str/clip_str 越界」之类）
        if (typeof opts.min === "number" && typeof opts.max === "number") {
            let v;
            if (typeof val === "number") v = val;
            else if (typeof val === "string") v = Number(val);
            else v = NaN;  // null / undefined / object 等都视作非法
            if (!Number.isFinite(v) || v < opts.min || v > opts.max) {
                const DEFAULT = (typeof opts.default === "number" && Number.isFinite(opts.default))
                    ? opts.default : opts.min;
                setWidgetValue(w, DEFAULT);
                // 同上：静默修复，不触发 callback。
            }
            continue;
        }

        // BOOLEAN：值必须是 true/false（修「subdirectories 串成 NaN/字符串」之类）
        if (typeof opts.default === "boolean") {
            if (typeof val !== "boolean") {
                const DEFAULT = opts.default;
                setWidgetValue(w, DEFAULT);
                // 同上：静默修复，不触发 callback。
            }
            continue;
        }

        // STRING：值必须是字符串（修「batch_path / tag_i 变成 undefined」之类）
        if (typeof opts.default === "string") {
            if (typeof val !== "string") {
                setWidgetValue(w, opts.default);
                // 同上：静默修复，不触发 callback。
            }
        }
    }
}

function refreshXYVisibility(node, overrideCount) {
    const config = XY_INPUT_CONFIG[node.comfyClass];
    if (!config) return;

    // 先校验值，避免损坏数据导致后续 parseInt 拿到 NaN/-1 算错
    ensureValidWidgets(node);

        const countWidget = config.countWidget ? findWidgetByName(node, config.countWidget) : null;
        let count;
        if (overrideCount != null && Number.isFinite(overrideCount)) {
            // 打字阶段的实时预览（DOM input 事件传来输入框里的临时值）：
            // 只按该值计算显隐，绝不写回控件——写回会在 blur 前干扰
            // Vue 输入框的显示绑定，blur 提交后由 callback/轮询走正常流程。
            count = Math.min(MAX_COUNT, Math.max(0, Math.round(overrideCount)));
        } else {
            count = Math.min(MAX_COUNT, Math.max(0, parseInt(getWidgetValue(countWidget), 10) || 0));
            // Nodes 2.0 下改 count 可能只更新 _state.value 而 w.value 不同步；
            // 双写保证 Vue 重渲（node.widgets=[...]）从 w.value 恢复时不丢值。
            if (countWidget) setWidgetValue(countWidget, count);
        }

    // 计算可见集合：
    // - 旧节点（有 config.modes）：按当前 input_mode 的 always/numbered 计算
    // - 简化节点（无 config.modes）：直接用顶层 always/numbered，忽略 input_mode
    let visible;
    if (config.modes) {
        const modeWidget = findWidgetByName(node, "input_mode");
        const mode = modeWidget?.value;
        const modeConfig = config.modes[mode];
        if (!modeConfig) return;
        visible = new Set(modeConfig.always || []);
        for (const tpl of modeConfig.numbered || []) {
            for (let i = 1; i <= count; i++) visible.add(tpl.replace("{i}", i));
        }
    } else {
        visible = new Set(config.always || []);
        for (const tpl of config.numbered || []) {
            for (let i = 1; i <= count; i++) visible.add(tpl.replace("{i}", i));
        }
        // hidden 永远隐藏
        for (const n of config.hidden || []) visible.delete(n);
    }

    const apply = () => {
        for (const name of collectManagedNames(config)) {
            setHidden(node, findWidgetByName(node, name), !visible.has(name));
        }
    };
    apply();
    recompute(node);
    // 强制 Vue 重渲所有 widget
    if (node.widgets) node.widgets = [...node.widgets];
    // 关键：Vue 重渲是异步的，同步再调 apply() 也会被冲掉——
    // 必须在 requestAnimationFrame 里等重绘完成后再 apply 一次，
    // 否则 lora_count 改了但 lora_name_i 仍被隐藏（行数永远 3 个，count 改了没反应）。
    requestAnimationFrame(() => {
        apply();
        if (node.widgets) node.widgets = [...node.widgets];
    });
}

// 全局 model_strength 是主控：改动时同步到每个 model_str_i（Python 端 model_str_i
// 是必填控件，全局兜底走不到，所以必须由前端把全局值写进每个编号控件）。
// 单独改 model_str_i 时不受全局同步影响（syncing 守卫）。
// 仅对 ⚡ XY Input: LoRA 生效（clip 已移除，clip_str 固定 1.0）。
function hookStrengthSync(node) {
    if (node._strengthSynced) return;
    node._strengthSynced = true;

    let syncing = false;
    const sync = () => {
        if (syncing) return;
        const count = Math.min(MAX_COUNT, Math.max(0, parseInt(getWidgetValue(findWidgetByName(node, "lora_count")), 10) || 0));
        const ms = getWidgetValue(findWidgetByName(node, "model_strength"));
        if (ms === undefined || ms === null) return;
        syncing = true;
        for (let i = 1; i <= count; i++) {
            const mw = findWidgetByName(node, `model_str_${i}`);
            if (mw) setWidgetValue(mw, ms);
        }
        syncing = false;
        // 强制 Vue 重渲 input（v-model 缓存问题——与隐藏同源）。
        if (node.widgets) node.widgets = [...node.widgets];
        // rAF 兜底：让 widgethider 重新 apply hidden（与 refreshXYVisibility 一致），
        // 避免同步重渲被 Vue 异步重绘覆盖。
        requestAnimationFrame(() => refreshXYVisibility(node));
    };
    node._syncStrength = sync;

    const wrap = (name) => {
        const w = findWidgetByName(node, name);
        if (!w || w._strSynced) return;
        w._strSynced = true;
        const orig = w.callback;
        w.callback = function (...args) {
            const r = orig ? orig.apply(this, args) : undefined;
            if (!syncing) sync();
            return r;
        };
    };

    wrap("model_strength");
    wrap("lora_count");   // lora_count 变化时也要重同步

    setTimeout(sync, 0);
}

function hookXYInput(node) {
    const config = XY_INPUT_CONFIG[node.comfyClass];
    if (!config || node._xyHooked) return;
    node._xyHooked = true;

    if (node.comfyClass === "⚡ XY Input: LoRA") {
        hookStrengthSync(node);
        hookLoraTagAutoFill(node, false);
        // 强制设置中文 label，避免某些 ComfyUI 版本不读 BOOLEAN widget 的 options.label
        const inc = findWidgetByName(node, "include_none");
        if (inc) inc.label = "添加无 LoRA 对比";
        // 注意：include_none 是 Python INPUT_TYPES 字段，本就排在 folder_filter 动态按钮前面，
        // 无需 reorder。严禁 splice/unshift 重排 widget 顺序，否则序列化索引错位（历史教训）。
    }

    // 监听触发 refreshXYVisibility 的目标：
    // - 旧多模式节点：input_mode 变化时切模式需要重渲
    // - 简化节点（无 input_mode）：只听 countWidget
    const targets = [];
    if (config.modes) targets.push("input_mode");
    if (config.countWidget) targets.push(config.countWidget);

    for (const w of node.widgets || []) {
        if (!targets.includes(w.name) || w._xyCallbackHooked) continue;
        w._xyCallbackHooked = true;

        const origCallback = w.callback;
        w.callback = function (...args) {
            const r = origCallback ? origCallback.apply(this, args) : undefined;
            refreshXYVisibility(node);
            return r;
        };
    }

    // Initial refresh (retry until widgets + _state are populated)
    let attempts = 0;
    const tryRefresh = () => {
        refreshXYVisibility(node);
        attempts++;
        if (attempts < 20) setTimeout(tryRefresh, 100);
    };
    setTimeout(tryRefresh, 50);
    // 额外延迟重刷：覆盖 _state 晚到导致 tag / batch_path 等控件首轮没隐藏的情况
    setTimeout(() => refreshXYVisibility(node), 600);
    setTimeout(() => refreshXYVisibility(node), 1500);
    setTimeout(() => refreshXYVisibility(node), 3000);

    // Nodes 2.0 下 count 值变化可能不走 w.callback：轻量轮询兜底，
    // 检测 countWidget 的 _state.value 变化即触发 refresh（节点删除时清理）。
    // 间隔 100ms 让 lora_count 调整接近实时；同步触发全局强度同步，保证新暴露的
    // model_str_i 立即拿到当前 model_strength。
    if (config.countWidget && !node._wmCountTimer) {
        let lastCount = getWidgetValue(findWidgetByName(node, config.countWidget));
        let lastMs = getWidgetValue(findWidgetByName(node, "model_strength"));
        node._wmCountTimer = setInterval(() => {
            if (!node.widgets) return;
            const cur = getWidgetValue(findWidgetByName(node, config.countWidget));
            const curMs = getWidgetValue(findWidgetByName(node, "model_strength"));
            let changed = false;
            if (cur !== lastCount) {
                lastCount = cur;
                changed = true;
                refreshXYVisibility(node);
            }
            if (curMs !== lastMs) {
                lastMs = curMs;
                changed = true;
            }
            // count 或 model_strength 任一变都同步强度到新暴露/已有的 model_str_i
            if (changed && typeof node._syncStrength === "function") node._syncStrength();
        }, 100);
        const origRemove = node.onRemove;
        node.onRemove = function (...a) {
            if (node._wmCountTimer) { clearInterval(node._wmCountTimer); node._wmCountTimer = null; }
            return origRemove ? origRemove.apply(this, a) : undefined;
        };
    }
}

//==============================================================================
// Register extension
//==============================================================================

const WINDMIX_NODES = new Set([
    "⚡ DiT Efficient Loader",
    "⚡ XY Input: LoRA",
    "⚡ XY Input: LoRA Plot",
    "⚡ XY Input: UNet Model",
]);

// 与文件夹筛选扩展协作：当它重排 node.widgets（触发 Vue 重渲、可能重置 _state.hidden）
// 后，立即重新应用显隐，避免 tag / batch_path 等被「洗掉」再次出现 15 个 tag 的问题。
if (!window._wmXYRefreshBound) {
    window._wmXYRefreshBound = true;
    window.addEventListener("windmix:xy-refresh", (e) => {
        const node = e?.detail?.node;
        if (node && XY_INPUT_CONFIG[node.comfyClass]) refreshXYVisibility(node);
    });
}

//==============================================================================
// 实时打字同步（Nodes 2.0 Vue 数字输入框）
// 前端 1.52.x 的 ScrubableNumberInput 只有 blur / 回车才把打字内容提交到
// widget（v-model 不随按键更新），所以在 lora_count / model_count 框里打字时，
// 下面的行数全程不动、点了别处才变——体感就是「数量不能实时同步」。
// 这里监听 DOM input 事件（capture）：打字期间直接按「输入框里的值」实时刷新
// 显隐（仅预览、不写回控件）；blur 提交后仍由 callback / 轮询走正常流程接管。
// 按钮点击 / ↑↓ 键 / 拖动滑擦本身立即提交，不走这条路。
//==============================================================================
function _findNodeByDomId(idStr) {
    const g = app.graph;
    const nodes = (g && (g._nodes || g.nodes)) || [];
    for (const n of nodes) {
        if (n && String(n.id) === String(idStr)) return n;
    }
    return null;
}
if (!window._wmXYTypingBound) {
    window._wmXYTypingBound = true;
    let _typingTimer = null;
    document.addEventListener("input", (e) => {
        const el = e.target;
        if (!el || el.tagName !== "INPUT") return;
        if (el.type === "checkbox" || el.type === "radio") return;
        const wname = el.getAttribute("aria-label") || "";
        if (!wname) return;
        let isCountWidget = false;
        for (const cfg of Object.values(XY_INPUT_CONFIG)) {
            if (cfg.countWidget === wname) { isCountWidget = true; break; }
        }
        if (!isCountWidget) return;
        const nodeEl = el.closest("[data-node-id]");
        if (!nodeEl) return;
        const nid = nodeEl.getAttribute("data-node-id");
        if (nid == null) return;
        const node = _findNodeByDomId(nid);
        if (!node || !XY_INPUT_CONFIG[node.comfyClass]) return;
        // 兼容本地化数字格式：去掉千分位分隔符与空白再解析
        const raw = String(el.value).replace(/[\s,，]/g, "");
        if (raw === "" || raw === "-" || raw === ".") return;
        const v = Number(raw);
        if (!Number.isFinite(v)) return;
        if (_typingTimer) clearTimeout(_typingTimer);
        _typingTimer = setTimeout(() => refreshXYVisibility(node, v), 80);
    }, true);
}

app.registerExtension({
    name: "windmix.eff.widgethider",
    nodeCreated(node) {
        if (!WINDMIX_NODES.has(node.comfyClass)) return;

        // Wait one tick so widgets are built, then apply both hooks.
        setTimeout(() => {
            if (node.comfyClass === "⚡ DiT Efficient Loader") {
                hookDiTFamily(node);
            } else {
                hookXYInput(node);
            }
        }, 0);
    },
    loadedGraphNode(node) {
        if (!WINDMIX_NODES.has(node.comfyClass)) return;
        // 工作流加载时 input_mode / count 在 nodeCreated 之后才恢复，
        // 这里(图已配置完成)再触发一次显隐刷新，确保对齐最终值。
        setTimeout(() => {
            if (node.comfyClass === "⚡ DiT Efficient Loader") {
                applyDiTFamilyConfig(node);
            } else {
                refreshXYVisibility(node);
                if (node.comfyClass === "⚡ XY Input: LoRA") {
                    // 工作流加载后，值已恢复：重新同步全局强度，并按已选 LoRA 自动填 tag
                    if (typeof node._syncStrength === "function") node._syncStrength();
                    hookLoraTagAutoFill(node, true);
                }
            }
        }, 0);
    }
});

})();