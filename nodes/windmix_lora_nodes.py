# ComfyUI-WindMix — LoRA 管理器节点
#
#   - WindMixLoraStack           ：数据节点，输出标准 LORA_STACK（每项 (name, model强度, clip强度)）
#                                   外加 STRING 汇总启用 LoRA 的 tag。
#   - WindMixLoraLoaderModelOnly ：处理节点，输入 MODEL + 自带 LoRA 列表，仅把 LoRA 打到 MODEL
#                                   上（clip 传 None，不输出 CLIP）。
#
# 界面在 web/windmix_lora_manager.js（搜索即添加 + Add LoRA 浏览弹窗 + 固定高度内滚动列表 +
# 配方分组整体拖拽），⚡ XY 输入: LoRA（WindMixLoraXY）共用那套界面。
#
# 持久化：隐藏的 `lora_data` STRING 控件存 JSON，ComfyUI 自动序列化，后端只解析：
#   顶层行 [{on, name, model, tag}, ...] / 配方组 [{folder, on, open, loras:[...]}, ...] / {loras:[...]}

from __future__ import annotations

import json

import folder_paths
import comfy.sd
import comfy.utils

# 单节点最多允许的 LoRA 行数（前端也会限制）
MAX_LORA_ROWS = 50


def _parse_stack(lora_data: str):
    """lora_data(JSON) → 统一条目列表；配方组按显示顺序就地展开，整组 on=false 时跳过。"""
    try:
        data = json.loads(lora_data or "[]")
    except Exception:
        data = []
    if isinstance(data, dict):
        data = data.get("loras", [])
    if not isinstance(data, list):
        return []

    out = []

    def walk(items, depth=0):
        if depth > 4:  # 嵌套异常时不再深挖
            return
        for e in items:
            if not isinstance(e, dict):
                continue
            if e.get("folder"):
                if not e.get("on", True):
                    continue
                walk(e.get("loras") or [], depth + 1)
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

    walk(data)
    return out[:MAX_LORA_ROWS]


def _build_outputs(stack):
    """启用条目 → (LORA_STACK, tag 汇总)。clip 强度恒等于 model。"""
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
    DESCRIPTION = "LoRA 列表管理（搜索即添加 + Add LoRA 弹窗 + 配方分组），输出标准 LORA_STACK 与 tag 汇总。"

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
    DESCRIPTION = "按列表顺序把 LoRA 逐个打到 MODEL 上（不动 CLIP），输出 tag 汇总。"

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
                    print(f"[WindMix LoRA] 跳过缺失的 LoRA: {name!r}")
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
