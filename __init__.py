# ComfyUI-WindMix — a curated bundle of nodes the user actually uses,
# collected from various third-party ComfyUI plugins so the originals can
# be uninstalled.
#
# Checkpoint / UNET loaders by name (ported from an external name-loader plugin):
#   - WindMix_CheckpointLoaderWithName  (WindMix_ModelLoaderWithName.py)
#   - WindMix_UNETLoaderWithName        (WindMix_ModelLoaderWithName.py)
#   - Wind_WildcardConcat_Dynamic    (Wind_WildcardConcat_Dynamic.py + web/wind_wildcard_concat.js)
#
# Second batch, from ComfyUI-CRT-Nodes:
#   - FancyTimerNode  (Fancy_Timer_Node.py + web/fancy_timer_node.js)
#
# Own additions (not lifted from other plugins):
#   - WindMix_PromptGroups  (WindMix_PromptGroups.py) — promptLine-style batch
#     prompt node, but groups are split by an explicit separator line ("---")
#     so one group may span multiple lines/paragraphs.
#
# Third batch, from ComfyUI-Studio-Suite:
#   - PromptStudioOutput / PromptStudioPositiveOutput / PromptStudioNegativeOutput
#     (prompt_studio/ package: nodes.py + api.py HTTP routes + web/js/prompt_studio/*)
#   - The package's __init__ registers its routes on import; we import it as a
#     top-level subpackage and merge its node mappings below.
#
# Fourth batch, from efficiency-nodes-comfyui (prefixed ⚡ to coexist with the
# original plugin, which the user keeps until satisfied):
#   - ⚡ Efficient Loader / ⚡ KSampler (Efficient) / ⚡ KSampler Adv. (Efficient)
#   - ⚡ XY Plot + ⚡ XY Input: LoRA + ⚡ XY Input: LoRA Plot
#   - ⚡ DiT Efficient Loader (NEW) — loads separated-file DiT models
#     (Anima / Z-Image / ZiB / Krea-2) and drops into KSampler (Efficient).
#   - ⚡ XY Input: UNet Model (NEW) — swaps the diffusion model in XY plots.
#   - ⚡ 模型组合加载器 (NEW, windmix_model_set_loader.py) — 参考 ComfyUI-TJ_NODE 的
#     model_set_loader：分别选 unet/clip/vae，委托原生 UNETLoader/CLIPLoader/VAELoader
#     一次性输出 MODEL+CLIP+VAE，每槽位支持 [none]，支持 GGUF 与 dtype。
#   - All XY-Plot nodes (⚡ XY Plot / ⚡ XY Input: LoRA / LoRA Plot / UNet Model)
#     live in the `nodes/xy/` subpackage, imported via the "xy" entry in
#     NODE_MODULES below. The stitched grid is exposed by the KSampler nodes'
#     "XY Plot" output pin (the old standalone ⚡ XY 图表拼接 node was removed).
#   - ⚡prompt studio 合并文本 (NEW, windmix_merge_text.py) — 参考 ComfyUI-ZML-Image 的
#     ZML_MergeText：最多 20 个 forceInput STRING 动态接口 + 可调分隔符，输出
#     「合并文本」(单值) 与「文本列表」(列表)；标点清理函数内联，自包含不依赖 ZML 插件。
#     归类到 ⚡ WindMix/🎨 Prompt Studio。
#   - wind_efficiency_nodes.py needs its sibling `py/` subpackage and
#     wind_utils.py (both copied alongside it), imported as part of the
#     `nodes` package. Renamed from the upstream `efficiency_nodes`/`tsc_utils`
#     to avoid a sys.modules collision with the original efficiency-nodes-comfyui
#     plugin (which keeps those bare module names).

import importlib
import os

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Only the node modules we want to keep.
NODE_MODULES = [
    "WindMix_ModelLoaderWithName",
    "Wind_WildcardConcat_Dynamic",
    "Fancy_Timer_Node",
    "WindMix_PromptGroups",
    "wind_efficiency_nodes",
    "xy",
    "windmix_lora_nodes",
    "windmix_xy_inputs",
    "windmix_model_set_loader",
    "windmix_merge_text",
    "windmix_preset_text",
    "windmix_resolution",
    "windmix_image_compare",
]

for module_name in NODE_MODULES:
    try:
        mod = importlib.import_module(f".nodes.{module_name}", __name__)
        NODE_CLASS_MAPPINGS.update(getattr(mod, "NODE_CLASS_MAPPINGS", {}))
        NODE_DISPLAY_NAME_MAPPINGS.update(getattr(mod, "NODE_DISPLAY_NAME_MAPPINGS", {}))
    except Exception as e:
        print(f"[WindMix] ERROR loading {module_name}: {e}")

# prompt_studio is a top-level subpackage (kept at the plugin root so its
# __file__-derived storage/web paths resolve correctly). Its __init__ registers
# the HTTP routes on import; we merge its node mappings here.
try:
    prompt_studio_pkg = importlib.import_module(".prompt_studio", __name__)
    NODE_CLASS_MAPPINGS.update(getattr(prompt_studio_pkg, "NODE_CLASS_MAPPINGS", {}))
    NODE_DISPLAY_NAME_MAPPINGS.update(getattr(prompt_studio_pkg, "NODE_DISPLAY_NAME_MAPPINGS", {}))
    # Idempotent; re-call in case PromptServer.instance was not ready at import.
    if hasattr(prompt_studio_pkg, "register_prompt_studio_routes"):
        prompt_studio_pkg.register_prompt_studio_routes()
except Exception as e:
    print(f"[WindMix] ERROR loading prompt_studio: {e}")

# HTTP routes (LoRA metadata.json reader for tag auto-fill, etc.)
try:
    importlib.import_module(".api", __name__)
except Exception as e:
    print(f"[WindMix] ERROR loading api: {e}")

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

# Expose web assets only if the folder exists.
_web_dir = os.path.join(os.path.dirname(__file__), "web")
if os.path.isdir(_web_dir):
    WEB_DIRECTORY = "./web"
    __all__.append("WEB_DIRECTORY")
