import { app } from "/scripts/app.js";

console.log("[WindMix] widgethider.js loaded, app=", typeof app, "url=", import.meta.url);

(function () {
"use strict";

const findWidgetByName = (node, name) =>
    node.widgets ? node.widgets.find((w) => w.name === name) : null;

function setHidden(widget, hidden) {
    if (!widget) return;
    widget.hidden = hidden;
    if (!widget._origType) widget._origType = widget.type;
    widget.type = hidden ? "hidden" : widget._origType;
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
        countWidget: "lora_count",
        numbered: ["lora_name_{i}", "model_str_{i}", "clip_str_{i}"],
        modes: {
            "LoRA Names": {
                always: ["input_mode", "lora_count", "model_strength", "clip_strength"],
                numbered: ["lora_name_{i}"],
                hidden: ["batch_path", "subdirectories", "batch_sort", "batch_max",
                         "model_str_{i}", "clip_str_{i}"]
            },
            "LoRA Names+Weights": {
                always: ["input_mode", "lora_count"],
                numbered: ["lora_name_{i}", "model_str_{i}", "clip_str_{i}"],
                hidden: ["batch_path", "subdirectories", "batch_sort", "batch_max",
                         "model_strength", "clip_strength"]
            },
            "LoRA Batch": {
                always: ["input_mode", "batch_path", "subdirectories", "batch_sort",
                         "batch_max", "model_strength", "clip_strength"],
                numbered: [],
                hidden: ["lora_count", "lora_name_{i}", "model_str_{i}", "clip_str_{i}"]
            }
        }
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
    for (const m of Object.values(config.modes)) {
        for (const n of m.always) names.add(n);
        for (const n of m.hidden) names.add(n);
    }
    for (const tpl of config.numbered) {
        for (let i = 1; i <= MAX_COUNT; i++) names.add(tpl.replace("{i}", i));
    }
    names.add(config.countWidget);
    return names;
}

function refreshXYVisibility(node) {
    const config = XY_INPUT_CONFIG[node.comfyClass];
    if (!config) return;

    const modeWidget = findWidgetByName(node, "input_mode");
    const mode = modeWidget?.value;
    const modeConfig = config.modes[mode];
    if (!modeConfig) return;

    const countWidget = config.countWidget ? findWidgetByName(node, config.countWidget) : null;
    const count = Math.min(MAX_COUNT, Math.max(0, parseInt(countWidget?.value, 10) || 0));

    const visible = new Set(modeConfig.always);
    for (const tpl of modeConfig.numbered || []) {
        for (let i = 1; i <= count; i++) visible.add(tpl.replace("{i}", i));
    }

    for (const name of collectManagedNames(config)) {
        setHidden(findWidgetByName(node, name), !visible.has(name));
    }
    recompute(node);
}

function hookXYInput(node) {
    const config = XY_INPUT_CONFIG[node.comfyClass];
    if (!config || node._xyHooked) return;
    node._xyHooked = true;

    const targets = ["input_mode"];
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

    // Initial refresh (retry until widgets are populated)
    let attempts = 0;
    const tryRefresh = () => {
        refreshXYVisibility(node);
        attempts++;
        if (attempts < 10) setTimeout(tryRefresh, 50);
    };
    setTimeout(tryRefresh, 50);
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
    }
});

})();