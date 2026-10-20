# ComfyUI-WindMix — 新版 XY 输入节点（沿用 LoRA Stack 的 DOM 行 UI 交互）
#
#   - WindMixLoraXY  ：⚡ XY 输入: LoRA
#       界面复用 web/windmix_lora_manager.js 的 LoRA 卡片 UI（顶部搜索框输入即出候选、
#       回车添加，底部 Add LoRA / 新建配方 走浏览弹窗，弹窗左栏按文件夹筛；
#       逐行[开关/名称/强度/tag/删除]，tag 从模型元数据自动填），数据落在隐藏的 `lora_data` 控件。
#       输出单个 XY 引脚（x_or_y），接到 ⚡ XY Plot 的 X 或 Y 输入。
#       每个启用行 = X/Y 轴上的一个格子，单元格内只加载该行那一个 LoRA。
#       可选「无 LoRA 基线」开关（默认开）。
#       （老版 ⚡ XY Input: LoRA / lora_name_i 定长控件节点已删除，显示名由本节点接管；
#        注册键仍是 WindMixLoraXY，历史工作流不受影响。）
#
#   - WindMixUNetXY  ：📊 XY 输入: UNet
#       界面在 web/windmix_xy_unet_manager.js（仅 Model Names 模式），与 LoRA 卡片同一套
#       配色/按钮：样式、图标、提示条、节点底距几何引擎都直接 import windmix_lora_manager.js
#       的共用件。搜索即添加 + Add 模型 浏览弹窗（左栏按文件夹筛、可多选）+
#       逐行[手柄/开关/名称/删除]，点名称可重选、悬停看预览；模型没有强度/tag，也不分组。
#       数据落在隐藏的 `unet_data` 控件，格式 [{on,name}, ...]（与旧版兼容）。
#       输出单个 XY 引脚（x_or_y），接到 ⚡ XY Plot 的 X 或 Y 输入。
#       每个启用行 = 一个格子，单元格 = (unet_name, None, None)。
#
#   - WindMixUNet2XY ：📊 XY 输入: UNet2
#       不走本地文件名，改用外部 MODEL 对象直连：model1..model20 动态接口
#       （前端 web/windmix_xy_unet2.js），可接融合模型。单元格 = (model对象, None, None, 标签)。
#       2026-10-20 由旧类名 WindMixUNet3XY 改名而来，旧键留作 DEPRECATED 别名 → 老图照常加载。
#
#   - WindMixCkptXY  ：⚡ XY 输入: Checkpoint
#       与 UNet 同一个前端（web/windmix_xy_unet_manager.js 按节点类型配置数据源），
#       行是[手柄/开关/名称/删除]、可多选浏览弹窗，数据落在隐藏的 `ckpt_data` 控件。
#       输出 ("Checkpoint", [(ckpt名, None, None), ...])——对齐上游 Efficiency Nodes
#       的 XY Input: Checkpoint 契约；clip_skip/vae 留 None 表示沿用效率加载器的值。
#       （老版 ⚡ XY Input: UNet Model 已从 xy_plot_nodes.py 删除，它的 DiT Model 轴
#        功能由 UNet 覆盖，这个名字腾出来给了 Checkpoint。）
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
# WindMixUNet2XY（显示名 📊 XY 输入: UNet2）动态外部接口的上限（与合并文本一致）：model1..model20
MAX_UNET_MODELS = 20


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


class WindMixUNet2XY:
    """XY 输入：UNet / DiT 模型（外部连线动态接口版 · MODEL 对象直连）。

    与 UNet 同属 "DiT Model" 轴，但模型不从本地下拉选、而是从外部 MODEL 接口接入：
    每个 model1..modelN 接一个已加载的模型（UNETLoader 输出，或模型融合节点输出的
    融合模型——没有本地文件名的那种）。前端（web/windmix_xy_unet2.js）负责动态接口：
    初始只留 model1，接上 modelN 自动追加 modelN+1，断开后清理多余空接口。

    后端把「已连接」的模型对象收集成 (model对象, None, None, 标签) 单元格，
    输出 ("DiT Model", cells)。define_variable / define_model 识别到非字符串的 var[0]
    就走「对象直连」路径：不重新加载，CLIP/VAE 沿用 DiT Efficient Loader 的。
    注意：必须接 ⚡ DiT Efficient Loader（is_dit=True）才生效。"""

    @classmethod
    def INPUT_TYPES(cls):
        optional = {}
        for i in range(1, MAX_UNET_MODELS + 1):
            optional[f"model{i}"] = ("MODEL", {"forceInput": True})
        return {"optional": optional}

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, **kwargs):
        cells = []
        for i in range(1, MAX_UNET_MODELS + 1):
            m = kwargs.get(f"model{i}")
            if m is None:
                continue
            # (model对象, clip=None, vae=None, label)：非字符串 var[0] 触发对象直连；
            # 第 4 元素 label 作网格单元格标题（融合模型无文件名，按槽位编号占位）。
            cells.append((m, None, None, f"模型{i}"))
        return (("DiT Model", cells),) if cells else (None,)


class WindMixUNet3XY(WindMixUNet2XY):
    """旧注册键兼容别名（2026-10-20 之前的类名，当时显示名是 📊 XY 输入: UNet3）。

    工作流 json 里存的是注册键而不是显示名，所以历史图仍然写着 "WindMixUNet3XY"。
    这个空壳子类把它继续注册出去（逻辑全部继承自 WindMixUNet2XY），老图就能照常加载；
    DEPRECATED=True 让「添加节点」搜索菜单默认不再列出它（由前端设置 Comfy.Node.ShowDeprecated
    控制，关掉即隐藏），新图请用 📊 XY 输入: UNet2。
    ⚠️ 必须是独立的类对象（而不是把两个键指向同一个类）：前端扩展按 beforeRegisterNodeDef
    给每个注册类型装动态接口钩子，同一个类被注册两次会把钩子套两层。"""

    DEPRECATED = True


class WindMixCkptXY:
    """XY 输入：Checkpoint 底模（新卡片 UI，与 UNet 同一个前端）。每行 = 一个 X/Y 格子。

    对齐上游 Efficiency Nodes 的 XY Input: Checkpoint 契约：
        ("Checkpoint", [(ckpt_name, clip_skip, vae_name), ...])
    本节点只填第一项，后两位给 None —— define_variable 的 Checkpoint 分支遇到 None 会沿用
    ⚡/🚀 效率加载器的 clip_skip / vae（上游同款语义）。要逐格换 VAE / ClipSkip 的话，
    用现成的 VAE 轴、Clip Skip 轴或「XY 输入: 手动」与 Checkpoint 轴组成网格即可。

    采样器端不需要新增任何东西：Checkpoint 在 priority 列表里排第一，XY Plot 会把它翻到 X 轴
    （列），define_model 只在 index==0（每列首格）载一次 ckpt，encode=True 重新编码提示词。
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 隐藏控件，前端用 DOM 行 UI 管理，这里只负责持久化 JSON：[{on,name}, ...]
                "ckpt_data": ("STRING", {"multiline": True, "default": "[]"}),
            }
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, ckpt_data):
        entries = _parse_stack(ckpt_data)
        # 只取启用行；每行 = 一个格子：(ckpt_name, clip_skip=None, vae=None)
        cells = [(e["name"], None, None) for e in entries if e.get("on", True)]
        return (("Checkpoint", cells),) if cells else (None,)


NODE_CLASS_MAPPINGS = {
    "WindMixLoraXY": WindMixLoraXY,
    "WindMixUNetXY": WindMixUNetXY,
    "WindMixUNet2XY": WindMixUNet2XY,
    "WindMixUNet3XY": WindMixUNet3XY,   # 旧键兼容别名，见上面类注释
    "WindMixCkptXY": WindMixCkptXY,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    # 注册键就是工作流里的存档标识，改键 = 老图坏掉，所以只做「加新键 + 旧键转别名」：
    #   2026-10-19 显示名轮换：UNet2→UNet（按本地文件名换轴），UNet3→UNet2（外部 MODEL 对象接入）。
    #   2026-10-20 类名跟着对齐：WindMixUNet3XY → WindMixUNet2XY，旧键留作 DEPRECATED 别名。
    "WindMixLoraXY": "📊 XY 输入: LoRA",
    "WindMixUNetXY": "📊 XY 输入: UNet",
    "WindMixUNet2XY": "📊 XY 输入: UNet2",
    "WindMixUNet3XY": "📊 XY 输入: UNet2（旧存档兼容）",
    "WindMixCkptXY": "📊 XY 输入: Checkpoint",
}
