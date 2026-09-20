# ComfyUI-WindMix — LoRA 管理器节点（复刻 comfyui_fantastic-loras 的交互思路）
#
# 两个节点，均自带完整的「文件夹筛选 + Add Lora + 逐行(开关/强度/删除) + tag 自动填」
# 交互界面（界面在 web/windmix_lora_manager.js 里用 DOM 行实现）。
#
#   - WindMixLoraStack           ：数据节点，输出标准 LORA_STACK（每项 (name, model强度, clip强度)）
#                                   外加一个 STRING 汇总所有启用 LoRA 的 tag，可接提示词或现有
#                                   ⚡ XY Input: LoRA 的 lora_stack 输入口。
#   - WindMixLoraLoaderModelOnly ：处理节点，输入 MODEL + 自带 LoRA 列表，仅把 LoRA 打到 MODEL
#                                   上（clip 传 None，不输出 CLIP）。
#
# 持久化：节点用一个隐藏的 `lora_data` STRING 控件存放 JSON（前端负责读写），ComfyUI 自动序列化。
# 后端只负责解析该 JSON 并产出结果。

from __future__ import annotations

import json

import folder_paths
import comfy.sd
import comfy.utils

# 单节点最多允许的 LoRA 行数（前端也会限制）
MAX_LORA_ROWS = 50


def _parse_stack(lora_data: str):
    """把 lora_data(JSON 字符串) 解析成统一的条目列表。

    兼容两种格式：纯数组 [{name,model,tag,on}]，或带 loras 字段的对象 {loras:[...]}。
    只保留有 name 的合法条目，强度非法时回退 1.0。
    """
    try:
        data = json.loads(lora_data or "[]")
    except Exception:
        data = []
    if isinstance(data, dict):
        data = data.get("loras", [])
    if not isinstance(data, list):
        return []

    out = []
    for e in data:
        if not isinstance(e, dict):
            continue
        name = (e.get("name") or "").strip()
        if not name:
            continue
        try:
            model = float(e.get("model", 1.0))
        except Exception:
            model = 1.0
        if model != model:  # NaN 保护
            model = 1.0
        out.append({
            "name": name,
            "model": model,
            "tag": (e.get("tag") or "").strip(),
            "on": bool(e.get("on", True)),
        })
    return out[:MAX_LORA_ROWS]


def _build_outputs(stack):
    """从条目列表产出去重后的 LORA_STACK 与 tag 汇总字符串。

    只取启用的条目；clip 强度与 model 强度平行（model-only 场景下下游若接到
    标准 loader 也能正常应用，clip 不被刻意清零）。
    """
    lora_stack = []
    tags = []
    for e in stack:
        if not e.get("on", True):
            continue
        name = e["name"]
        model = e.get("model", 1.0)
        lora_stack.append((name, model, model))
        t = (e.get("tag") or "").strip()
        if t:
            tags.append(t)
    return lora_stack, ", ".join(tags)


class WindMixLoraStack:
    """数据节点：管理一个 LoRA 列表并输出 LORA_STACK + 汇总 tag。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 隐藏控件，前端用 DOM 行 UI 管理，这里只负责持久化 JSON
                "lora_data": ("STRING", {"multiline": True, "default": "[]"}),
            }
        }

    RETURN_TYPES = ("LORA_STACK", "STRING")
    RETURN_NAMES = ("lora_stack", "tags")
    FUNCTION = "run"
    CATEGORY = "⚡ WindMix/🎛️ LoRA"

    def run(self, lora_data):
        stack = _parse_stack(lora_data)
        lora_stack, tags = _build_outputs(stack)
        return (lora_stack, tags)


class WindMixLoraLoaderModelOnly:
    """处理节点：把列表里的 LoRA 仅应用到 MODEL（不触碰 CLIP）。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_data": ("STRING", {"multiline": True, "default": "[]"}),
            }
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("MODEL", "tags")
    FUNCTION = "run"
    CATEGORY = "⚡ WindMix/🎛️ LoRA"

    def run(self, model, lora_data):
        stack = _parse_stack(lora_data)
        m = model
        tags = []
        # 顺序叠加：每个启用的 LoRA 都打到当前（已打过补丁的）model 上
        for e in stack:
            if not e.get("on", True):
                continue
            name = e["name"]
            strength = e.get("model", 1.0)
            try:
                full = folder_paths.get_full_path("loras", name)
                if not full:
                    continue
                lora_sd = comfy.utils.load_torch_file(full, safe_load=True)
                # clip 传 None ⇒ load_lora_for_models 只返回被打补丁的 model
                m, _ = comfy.sd.load_lora_for_models(m, None, lora_sd, strength, 0.0)
                t = (e.get("tag") or "").strip()
                if t:
                    tags.append(t)
            except Exception as ex:
                print(f"[WindMix LoRA Loader] 加载 LoRA 失败 {name!r}: {ex}")
        return (m, ", ".join(tags))


# 节点注册（被 __init__.py 的 NODE_MODULES 合并）
NODE_CLASS_MAPPINGS = {
    "WindMixLoraStack": WindMixLoraStack,
    "WindMixLoraLoaderModelOnly": WindMixLoraLoaderModelOnly,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WindMixLoraStack": "🎛️ LoRA Stack",
    "WindMixLoraLoaderModelOnly": "🎛️ LoRA Loader (Model Only)",
}
