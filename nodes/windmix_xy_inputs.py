# ComfyUI-WindMix — 新版 XY 输入节点（沿用 LoRA Stack 的 DOM 行 UI 交互）
#
#   - WindMixLoraXY  ：⚡ XY 输入: LoRA2
#       界面复用 web/windmix_lora_manager.js 的 LoRA Stack 行 UI（文件夹筛选 + Add LoRA
#       + 逐行[开关/名称/强度/删除] + tag 自动填），数据落在隐藏的 `lora_data` 控件。
#       输出单个 XY 引脚（x_or_y），接到 ⚡ XY Plot 的 X 或 Y 输入。
#       每个启用行 = X/Y 轴上的一个格子，单元格内只加载该行那一个 LoRA（沿用原
#       ⚡ XY Input: LoRA 行为）。可选「无 LoRA 基线」开关（默认开）。
#
#   - WindMixUNetXY  ：⚡ XY 输入: UNet2
#       界面在 web/windmix_xy_unet_manager.js（仅 Model Names 模式）：文件夹筛选 +
#       Add 模型 + 逐行[开关/名称/删除]，数据落在隐藏的 `unet_data` 控件。
#       输出单个 XY 引脚（x_or_y），接到 ⚡ XY Plot 的 X 或 Y 输入。
#       每个启用行 = 一个格子，单元格 = (unet_name, None, None)。
#
# 持久化：两个节点各用一个隐藏 STRING 控件存放 JSON（前端负责读写），ComfyUI 自动序列化。
# 后端只负责解析该 JSON 并产出 XY 元组，格式与 wind_efficiency_nodes.py 的 define_model 对齐：
#   - "LoRA"  ：items = list[ LORA_STACK ]，每个 LORA_STACK = list[ (name, model, clip, tag) ]
#   - "DiT Model"：cells = list[ (unet_name, clip_name, vae_name) ]

from __future__ import annotations

import json

# 复用 LoRA Stack 节点的解析器，保证隐藏 JSON 格式一致
from .windmix_lora_nodes import _parse_stack

MAX_ROWS = 50
# UNet3 动态外部接口的上限（与合并文本一致）：model1..model20
MAX_UNET3_MODELS = 20


class WindMixLoraXY:
    """XY 输入：LoRA（Stack 风格 UI）。每行 LoRA = 一个 X/Y 格子。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 隐藏控件，前端用 DOM 行 UI 管理，这里只负责持久化 JSON
                "lora_data": ("STRING", {"multiline": True, "default": "[]"}),
                "include_none": ("BOOLEAN", {"default": True, "label": "添加无 LoRA 对比"}),
            }
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, lora_data, include_none=True):
        stack = _parse_stack(lora_data)
        # 只取启用行；每行 = 一个单 LoRA 单元格：[(name, model, clip=1.0, tag)]
        items = [[(e["name"], e["model"], 1.0, e.get("tag", ""))]
                 for e in stack if e.get("on", True)]

        # 默认在第一格插入"无 LoRA"基线，便于与带 LoRA 的格子做对比
        if include_none and items:
            items.insert(0, [("None", 1.0, 1.0, "")])

        return (("LoRA", items),)


class WindMixUNetXY:
    """XY 输入：UNet / DiT 模型（仅 Model Names 模式，Stack 风格 UI）。每行 = 一个 X/Y 格子。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 隐藏控件，前端用 DOM 行 UI 管理，这里只负责持久化 JSON
                "unet_data": ("STRING", {"multiline": True, "default": "[]"}),
            }
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, unet_data):
        entries = _parse_stack(unet_data)
        # 只取启用行；每行 = 一个格子：(unet_name, None, None)
        cells = [(e["name"], None, None) for e in entries if e.get("on", True)]
        return (("DiT Model", cells),) if cells else (None,)


class WindMixUNet3XY:
    """XY 输入：UNet / DiT 模型（外部连线动态接口版 · MODEL 对象直连）。

    与 UNet2 同属 "DiT Model" 轴，但模型不从本地下拉选、而是从外部 MODEL 接口接入：
    每个 model1..modelN 接一个已加载的模型（UNETLoader 输出，或模型融合节点输出的
    融合模型——没有本地文件名的那种）。前端（web/windmix_xy_unet3.js）负责动态接口：
    初始只留 model1，接上 modelN 自动追加 modelN+1，断开后清理多余空接口。

    后端把「已连接」的模型对象收集成 (model对象, None, None, 标签) 单元格，
    输出 ("DiT Model", cells)。define_variable / define_model 识别到非字符串的 var[0]
    就走「对象直连」路径：不重新加载，CLIP/VAE 沿用 DiT Efficient Loader 的。
    注意：必须接 ⚡ DiT Efficient Loader（is_dit=True）才生效。"""

    @classmethod
    def INPUT_TYPES(cls):
        optional = {}
        for i in range(1, MAX_UNET3_MODELS + 1):
            optional[f"model{i}"] = ("MODEL", {"forceInput": True})
        return {"optional": optional}

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, **kwargs):
        cells = []
        for i in range(1, MAX_UNET3_MODELS + 1):
            m = kwargs.get(f"model{i}")
            if m is None:
                continue
            # (model对象, clip=None, vae=None, label)：非字符串 var[0] 触发对象直连；
            # 第 4 元素 label 作网格单元格标题（融合模型无文件名，按槽位编号占位）。
            cells.append((m, None, None, f"模型{i}"))
        return (("DiT Model", cells),) if cells else (None,)


NODE_CLASS_MAPPINGS = {
    "WindMixLoraXY": WindMixLoraXY,
    "WindMixUNetXY": WindMixUNetXY,
    "WindMixUNet3XY": WindMixUNet3XY,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WindMixLoraXY": "📊 XY 输入: LoRA2",
    "WindMixUNetXY": "📊 XY 输入: UNet2",
    "WindMixUNet3XY": "📊 XY 输入: UNet3",
}
