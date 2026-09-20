# Efficiency Nodes - A collection of my ComfyUI custom nodes to help streamline workflows and reduce total node count.
# Originally by Luciano Cirino (Discord: TSC#9184), April 2023 - October 2023.
# Modified and rebranded as WindMix by the ComfyUI-WindMix project.
# https://github.com/LucianoCirino/efficiency-nodes-comfyui

from torch import Tensor
from PIL import Image, ImageOps, ImageDraw, ImageFont
from PIL.PngImagePlugin import PngInfo
import numpy as np
import torch

import ast
from pathlib import Path
from importlib import import_module
import os
import sys
import copy
import subprocess
import json
import psutil
import re
import datetime
from PIL import PngImagePlugin

from comfy_extras.nodes_align_your_steps import AlignYourStepsScheduler
from comfy_extras.nodes_gits import GITSScheduler

# Get the absolute path of various directories
my_dir = os.path.dirname(os.path.abspath(__file__))
comfy_dir = os.path.abspath(os.path.join(my_dir, '..', '..'))

# ---------------------------------------------------------------------------
# XY Plot label font.
#
# The 8 MB Alibaba PuHuiTi TTF that used to ship with this repo was dropped to
# keep the plugin lightweight. We now resolve a CJK-capable *system* font at
# runtime and degrade to PIL's built-in bitmap font when none is found.
# To force a specific font, drop it at the bundled path below and it wins.
# ---------------------------------------------------------------------------
_BUNDLED_LABEL_FONT = os.path.join(my_dir, '..', 'Font', 'AlibabaPuHuiTi-3-55-Regular.ttf')

_SYSTEM_LABEL_FONTS = (
    r'C:\Windows\Fonts\msyh.ttc',                              # Windows: 微软雅黑
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\simhei.ttf',                            # Windows: 黑体
    r'C:\Windows\Fonts\simsun.ttc',                            # Windows: 宋体
    '/System/Library/Fonts/PingFang.ttc',                      # macOS
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',  # Linux
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
)


def _wm_label_font_path():
    """First available label font: bundled override, else a system CJK font."""
    if os.path.isfile(_BUNDLED_LABEL_FONT):
        return _BUNDLED_LABEL_FONT
    for _candidate in _SYSTEM_LABEL_FONTS:
        if os.path.isfile(_candidate):
            return _candidate
    return None


font_path = _wm_label_font_path()


def _wm_load_label_font(size):
    """Load the XY Plot label font, degrading to PIL's default bitmap font."""
    if font_path:
        try:
            return ImageFont.truetype(str(font_path), size)
        except Exception as e:
            print(f"{warning('WindMix XY:')} font load failed '{font_path}': {e}; using default")
    return ImageFont.load_default()

# Append comfy_dir to sys.path & import files
sys.path.append(comfy_dir)
from nodes import KSampler, KSamplerAdvanced, VAEDecode, VAEDecodeTiled, \
    CLIPSetLastLayer, CLIPTextEncode, \
    PreviewImage, MAX_RESOLUTION
from comfy_extras.nodes_clip_sdxl import CLIPTextEncodeSDXL, CLIPTextEncodeSDXLRefiner
import comfy.sample
import comfy.samplers
import comfy.sd
import comfy.utils
import comfy.latent_formats
sys.path.remove(comfy_dir)

# Append my_dir to sys.path & import files
sys.path.append(my_dir)
from .wind_utils import *
from .py import smZ_cfg_denoiser
from .py import smZ_rng_source
from .py import cg_mixed_seed_noise
from .py import bnk_adv_encode
sys.path.remove(my_dir)

from comfy import samplers

# GLOBALS
REFINER_CFG_OFFSET = 0 #Refiner CFG Offset

# Resolution presets shared by WindMix Efficient Loaders.
# Format: "<aspect>_<width>,<height>".  The first entry is the manual/custom option.
RESOLUTION_PRESETS = [
    "自定义",
    "4:7_768,1344",
    "3:4_768,1024",
    "3:4_960,1280",
    "2:3_768,1152",
    "10:16_768,1280",
    "13:19_832,1216",
    "7:9_896,1152",
    "5:7_960,1344",
    "1:1_1024,1024",
    "1:1_1536,1536",
    "9:16_576,1024",
    "9:16_864,1536",
    "5:12_640,1536",
    "2:3_1024,1536",
    "9:21_720,1680",
    "9:21_864,2016",
]

def parse_resolution_preset(preset, swap=False):
    """Parse a preset string into (width, height), respecting the swap_axes flag.
    Returns (None, None) when the preset is the manual/custom entry.
    """
    if not preset or preset == "自定义":
        return None, None
    try:
        _, dims = preset.split("_", 1)
        w, h = map(int, dims.split(","))
    except Exception:
        return None, None
    return (h, w) if swap else (w, h)

# =======================================================================================================================
# WindMix metadata helpers (ported from ComfyUI-ZML-Image for the "⚡ 保存图像" node).
# The Efficient KSampler emits a JSON "生成信息" string built by the same fields ZML uses,
# so it drops straight into ⚡ 保存图像 without modification.
DEFAULT_TEXT_BLOCK_KEY = "comfy_text_block"
RECURSION_DEPTH_LIMIT = 30

TEXT_SEARCH_KEYS = [
    "文本", "text", "string", "value",
    "positive_prompt", "positive", "negative_prompt", "negative",
    "txt_内容", "提示词",
]

TEXT_NODE_PATTERNS = [
    "TextInput", "文本输入", "Primitive", "String", "ShowText",
    "Merge", "合并", "Concatenate",
    "Condition", "条件", "CLIPText",
]

def extract_text_from_conditioning(conditioning):
    texts = []
    if conditioning is None:
        return None
    for item in conditioning:
        if len(item) > 1 and isinstance(item[1], dict):
            t = item[1].get("zml_text", "")
            if t:
                texts.append(t)
    return "\n".join(texts) if texts else None

def find_upstream_text(prompt, current_node_id, input_key, depth=0):
    if depth > RECURSION_DEPTH_LIMIT:
        return None
    current_node = prompt.get(str(current_node_id))
    if not current_node:
        return None
    inputs = current_node.get("inputs", {})
    source = inputs.get(input_key)

    if isinstance(source, str):
        return source

    if isinstance(source, list) and len(source) == 2:
        source_node_id = str(source[0])
        source_node = prompt.get(source_node_id)
        if not source_node:
            return None
        class_type = source_node.get("class_type", "")
        source_inputs = source_node.get("inputs", {})

        if any(p in class_type for p in ["Merge", "合并", "Concatenate"]):
            merged_text = []
            delimiter = source_inputs.get("delimiter") or source_inputs.get("分隔符") or "\n"
            if delimiter == "\\n":
                delimiter = "\n"
            sorted_keys = sorted(source_inputs.keys())
            for key in sorted_keys:
                if any(k in key for k in ["delimiter", "分隔符"]):
                    continue
                val = find_upstream_text(prompt, source_node_id, key, depth + 1)
                if val and isinstance(val, str) and val.strip():
                    merged_text.append(val)
            return delimiter.join(merged_text) if merged_text else None

        is_target = any(p in class_type for p in TEXT_NODE_PATTERNS)
        if is_target:
            for key in TEXT_SEARCH_KEYS:
                val = source_inputs.get(key)
                if val and isinstance(val, str):
                    return val

        if "CLIPTextEncode" in class_type:
            return find_upstream_text(prompt, source_node_id, "text", depth + 1)
        if "Reroute" in class_type:
            for k, v in source_inputs.items():
                if isinstance(v, list):
                    return find_upstream_text(prompt, source_node_id, k, depth + 1)
    return None

def traverse_model_chain(prompt, start_node_id):
    """Walk the 'model' link upstream and return the checkpoint/unet file name.
    WindMix-aware: also matches '⚡ Efficient Loader' (ckpt_name) and '⚡ DiT Efficient Loader' (unet_name).
    """
    start_node = prompt.get(str(start_node_id))
    if not start_node:
        return None
    first_link = start_node.get("inputs", {}).get("model") or start_node.get("inputs", {}).get("模型")
    if not first_link or not isinstance(first_link, list):
        return None
    current_id = str(first_link[0])
    for _ in range(RECURSION_DEPTH_LIMIT):
        node = prompt.get(current_id)
        if not node:
            break
        class_type, inputs = node.get("class_type", ""), node.get("inputs", {})
        if "CheckpointLoader" in class_type:
            return inputs.get("ckpt_name")
        if "Efficient Loader" in class_type:
            return inputs.get("ckpt_name")
        if "DiT Efficient Loader" in class_type:
            return inputs.get("unet_name")
        next_link = inputs.get("model") or inputs.get("模型")
        if next_link and isinstance(next_link, list):
            current_id = str(next_link[0])
        else:
            break
    return None

def auto_discover_metadata(prompt, unique_id, pos_cond, neg_cond):
    ckpt_name = traverse_model_chain(prompt, unique_id)
    positive = extract_text_from_conditioning(pos_cond)
    if not positive:
        positive = find_upstream_text(prompt, unique_id, "正面条件") or find_upstream_text(prompt, unique_id, "positive")
    negative = extract_text_from_conditioning(neg_cond)
    if not negative:
        negative = find_upstream_text(prompt, unique_id, "负面条件") or find_upstream_text(prompt, unique_id, "negative")
    return ckpt_name, positive, negative

def collect_upstream_loras(prompt, unique_id):
    """Walk the model link upstream from the KSampler and collect every applied LoRA spec.

    Covers both WindMix-internal sources and arbitrary external LoRA nodes:
      * WindMix '⚡ Efficient Loader' / '⚡ DiT Efficient Loader' -> their `lora_name` widget
        and their `lora_stack` input (resolved through the linked stack node).
      * Any external 'LoraLoader' node sitting between the loader and the sampler.
    Returns a list of {"lora_name", "weight", "clip_weight"} ready to drop into the
    A1111-style metadata JSON. Empty list when no LoRA was applied.
    """
    loras = []
    seen = set()
    start = prompt.get(str(unique_id))
    if not start:
        return loras
    link = start.get("inputs", {}).get("model") or start.get("inputs", {}).get("模型")
    if not isinstance(link, list):
        return loras
    cur = str(link[0])
    for _ in range(RECURSION_DEPTH_LIMIT):
        node = prompt.get(cur)
        if not node or cur in seen:
            break
        seen.add(cur)
        class_type = node.get("class_type", "")
        inputs = node.get("inputs", {})

        # External / generic LoRA loader node (built-in "LoraLoader" or similar).
        if "LoraLoader" in class_type or "LoRA" in class_type:
            ln = inputs.get("lora_name")
            if isinstance(ln, str) and ln and ln != "None":
                loras.append({
                    "lora_name": ln,
                    "weight": inputs.get("strength_model", 1.0),
                    "clip_weight": inputs.get("strength_clip", 1.0),
                })

        # WindMix loaders: single lora_name widget + optional lora_stack link.
        elif "Efficient Loader" in class_type or "DiT Efficient Loader" in class_type:
            ln = inputs.get("lora_name")
            if isinstance(ln, str) and ln and ln != "None":
                loras.append({
                    "lora_name": ln,
                    "weight": inputs.get("lora_model_strength", 1.0),
                    "clip_weight": inputs.get("lora_clip_strength", 1.0),
                })
            ls = inputs.get("lora_stack")
            if isinstance(ls, list) and len(ls) == 2:
                stack_node = prompt.get(str(ls[0]))
                if stack_node:
                    stack_items = stack_node.get("inputs", {}).get("lora_stack")
                    if isinstance(stack_items, list):
                        for item in stack_items:
                            if isinstance(item, (list, tuple)) and item and isinstance(item[0], str):
                                nm = item[0]
                                mw = item[1] if len(item) > 1 else 1.0
                                cw = item[2] if len(item) > 2 else mw
                                loras.append({"lora_name": nm, "weight": mw, "clip_weight": cw})

        nxt = inputs.get("model") or inputs.get("模型")
        if isinstance(nxt, list):
            cur = str(nxt[0])
        else:
            break
    return loras

def build_windmix_gen_info(steps, sampler_name, scheduler, cfg, seed, latent, denoise, model_name, positive, negative, loras=None):
    width, height = latent["samples"].shape[3] * 8, latent["samples"].shape[2] * 8
    data = {
        "steps": steps, "sampler": sampler_name, "scheduler": scheduler, "cfg": cfg,
        "seed": seed, "width": width, "height": height, "model": model_name,
        "denoise": denoise, "positive": str(positive).strip() if positive else "",
        "negative": str(negative).strip() if negative else "",
        "loras": loras if loras else [],
    }
    return json.dumps(data)

# WindMix extra schedulers, merged into ComfyUI's *live* global list (see windmix_schedulers).
# Kept separate so we never clobber schedulers injected by other plugins (e.g. RES4LYF's beta57).
WM_EXTRA_SCHEDULERS = ["AYS SD1", "AYS SDXL", "AYS SVD", "GITS"]


def windmix_schedulers():
    """Live scheduler list = ComfyUI's current global schedulers + WindMix extras.

    Recomputed on every call so schedulers added by other plugins (e.g. RES4LYF's
    beta57) are always visible in the dropdown, and we never overwrite the global
    list with a stale snapshot taken at import time. Idempotent wrt the extras.
    """
    merged = list(samplers.KSampler.SCHEDULERS)
    for _s in WM_EXTRA_SCHEDULERS:
        if _s not in merged:
            merged.append(_s)
    return merged

########################################################################################################################
# Common function for encoding prompts
def encode_prompts(positive_prompt, negative_prompt, token_normalization, weight_interpretation, clip, clip_skip,
                   refiner_clip, refiner_clip_skip, ascore, is_sdxl, empty_latent_width, empty_latent_height,
                   return_type="both"):

    positive_encoded = negative_encoded = refiner_positive_encoded = refiner_negative_encoded = None

    # Process base encodings if needed
    if return_type in ["base", "both"]:
        clip = CLIPSetLastLayer().set_last_layer(clip, clip_skip)[0]

        positive_encoded = bnk_adv_encode.AdvancedCLIPTextEncode().encode(clip, positive_prompt, token_normalization, weight_interpretation)[0]
        negative_encoded = bnk_adv_encode.AdvancedCLIPTextEncode().encode(clip, negative_prompt, token_normalization, weight_interpretation)[0]

    # Process refiner encodings if needed
    if return_type in ["refiner", "both"] and is_sdxl and refiner_clip and refiner_clip_skip and ascore:
        refiner_clip = CLIPSetLastLayer().set_last_layer(refiner_clip, refiner_clip_skip)[0]

        refiner_positive_encoded = bnk_adv_encode.AdvancedCLIPTextEncode().encode(refiner_clip, positive_prompt, token_normalization, weight_interpretation)[0]
        refiner_positive_encoded = bnk_adv_encode.AddCLIPSDXLRParams().encode(refiner_positive_encoded, empty_latent_width, empty_latent_height, ascore[0])[0]

        refiner_negative_encoded = bnk_adv_encode.AdvancedCLIPTextEncode().encode(refiner_clip, negative_prompt, token_normalization, weight_interpretation)[0]
        refiner_negative_encoded = bnk_adv_encode.AddCLIPSDXLRParams().encode(refiner_negative_encoded, empty_latent_width, empty_latent_height, ascore[1])[0]

    # Return results based on return_type
    if return_type == "base":
        return positive_encoded, negative_encoded, clip
    elif return_type == "refiner":
        return refiner_positive_encoded, refiner_negative_encoded, refiner_clip
    elif return_type == "both":
        return positive_encoded, negative_encoded, clip, refiner_positive_encoded, refiner_negative_encoded, refiner_clip

########################################################################################################################
# WindMix Efficient Loader
class Wind_EfficientLoader:

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": { "ckpt_name": (folder_paths.get_filename_list("checkpoints"),),
                              "vae_name": (["Baked VAE"] + folder_paths.get_filename_list("vae"),),
                              "clip_skip": ("INT", {"default": -2, "min": -24, "max": -1, "step": 1}),
                              "lora_name": (["None"] + folder_paths.get_filename_list("loras"),),
                              "lora_model_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
                              "lora_clip_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
                              "positive": ("STRING", {"default": "CLIP_POSITIVE","multiline": True}),
                              "negative": ("STRING", {"default": "CLIP_NEGATIVE", "multiline": True}),
                              "token_normalization": (["none", "mean", "length", "length+mean"],),
                              "weight_interpretation": (["comfy", "A1111", "compel", "comfy++", "down_weight"],),
                              "resolution_preset": (RESOLUTION_PRESETS, {"default": "13:19_832,1216"}),
                              "自定义宽": ("INT", {"default": 832, "min": 64, "max": MAX_RESOLUTION, "step": 8}),
                              "自定义高": ("INT", {"default": 1216, "min": 64, "max": MAX_RESOLUTION, "step": 8}),
                              "swap_dimensions": ("BOOLEAN", {"default": False, "label_on": "开启", "label_off": "关闭"}),
                              "batch_size": ("INT", {"default": 1, "min": 1, "max": 262144})},
                "optional": {"lora_stack": ("LORA_STACK", ),},
                "hidden": { "prompt": "PROMPT",
                            "my_unique_id": "UNIQUE_ID",},
                }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "CONDITIONING", "LATENT", "VAE", "CLIP", "DEPENDENCIES",)
    RETURN_NAMES = ("model", "positive", "negative", "latent", "vae", "clip", "dependencies", )
    FUNCTION = "efficientloader"
    CATEGORY = "⚡ WindMix/🚀 效率节点"

    def efficientloader(self, ckpt_name, vae_name, clip_skip, lora_name, lora_model_strength, lora_clip_strength,
                        positive, negative, token_normalization, weight_interpretation, resolution_preset,
                        自定义宽, 自定义高, swap_dimensions, batch_size, lora_stack=None, refiner_name="None",
                        ascore=None, prompt=None, my_unique_id=None, loader_type="regular"):

        # Clean globally stored objects
        globals_cleanup(prompt)

        # Resolve resolution preset.  "自定义" keeps the manual width/height fields and optionally swaps them.
        preset_w, preset_h = parse_resolution_preset(resolution_preset, swap_dimensions)
        empty_latent_width = preset_w if preset_w is not None else 自定义宽
        empty_latent_height = preset_h if preset_h is not None else 自定义高
        if swap_dimensions and preset_w is None:
            empty_latent_width, empty_latent_height = empty_latent_height, empty_latent_width

        # Create Empty Latent
        latent = torch.zeros([batch_size, 4, empty_latent_height // 8, empty_latent_width // 8]).cpu()

        # Retrieve cache numbers
        vae_cache, ckpt_cache, lora_cache, refn_cache = get_cache_numbers("Efficient Loader")

        if lora_name != "None" or lora_stack:
            # Initialize an empty list to store LoRa parameters.
            lora_params = []

            # Check if lora_name is not the string "None" and if so, add its parameters.
            if lora_name != "None":
                lora_params.append((lora_name, lora_model_strength, lora_clip_strength))

            # If lora_stack is not None or an empty list, extend lora_params with its items.
            if lora_stack:
                lora_params.extend(lora_stack)

            # Load LoRA(s)
            model, clip = load_lora(lora_params, ckpt_name, my_unique_id, cache=lora_cache, ckpt_cache=ckpt_cache,
                                    cache_overwrite=True)

            if vae_name == "Baked VAE":
                vae = get_bvae_by_ckpt_name(ckpt_name)
                if vae is None:
                    print(
                        f"{warning('Efficiency Nodes:')} Baked VAE not found in cache, loading checkpoint to extract VAE...")
                    _, _, vae = load_checkpoint(ckpt_name, my_unique_id, output_vae=True, cache=ckpt_cache,
                                                cache_overwrite=True)
        else:
            model, clip, vae = load_checkpoint(ckpt_name, my_unique_id, cache=ckpt_cache, cache_overwrite=True)
            lora_params = None

        # Load Refiner Checkpoint if given
        if refiner_name != "None":
            refiner_model, refiner_clip, _ = load_checkpoint(refiner_name, my_unique_id, output_vae=False,
                                                             cache=refn_cache, cache_overwrite=True, ckpt_type="refn")
        else:
            refiner_model = refiner_clip = None

        # Extract clip_skips
        refiner_clip_skip = clip_skip[1] if loader_type == "sdxl" else None
        clip_skip = clip_skip[0] if loader_type == "sdxl" else clip_skip

        # Encode prompt based on loader_type
        positive_encoded, negative_encoded, clip, refiner_positive_encoded, refiner_negative_encoded, refiner_clip = \
            encode_prompts(positive, negative, token_normalization, weight_interpretation, clip, clip_skip,
                           refiner_clip, refiner_clip_skip, ascore, loader_type == "sdxl",
                           empty_latent_width, empty_latent_height)

        # Check for custom VAE
        if vae_name != "Baked VAE":
            vae = load_vae(vae_name, my_unique_id, cache=vae_cache, cache_overwrite=True)

        # Data for XY Plot
        dependencies = (vae_name, ckpt_name, clip, clip_skip, refiner_name, refiner_clip, refiner_clip_skip,
                        positive, negative, token_normalization, weight_interpretation, ascore,
                        empty_latent_width, empty_latent_height, lora_params)

        ### Debugging
        ###print_loaded_objects_entries()
        print_loaded_objects_entries(my_unique_id, prompt)

        if loader_type == "regular":
            return (model, positive_encoded, negative_encoded, {"samples":latent}, vae, clip, dependencies,)
        elif loader_type == "sdxl":
            return ((model, clip, positive_encoded, negative_encoded, refiner_model, refiner_clip,
                     refiner_positive_encoded, refiner_negative_encoded), {"samples":latent}, vae, dependencies,)

# =======================================================================================================================
########################################################################################################################
########################################################################################################################
# WindMix KSampler (Efficient)
class Wind_KSampler:
    empty_image = pil2tensor(Image.new('RGBA', (1, 1), (0, 0, 0, 0)))

    @classmethod
    def INPUT_TYPES(cls):
        return {"required":
                    {"model": ("MODEL",),
                     "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                     "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
                     "cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 100.0}),
                     "sampler_name": (comfy.samplers.KSampler.SAMPLERS,),
                     "scheduler": (windmix_schedulers(),),
                     "positive": ("CONDITIONING",),
                     "negative": ("CONDITIONING",),
                     "latent_image": ("LATENT",),
                     "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                     "preview_method": (["auto", "latent2rgb", "taesd", "vae_decoded_only", "none"],),
                     "vae_decode": (["true", "true (tiled)", "false"],),
                     },
                "optional": { "optional_vae": ("VAE",),
                              "script": ("SCRIPT",),},
                "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO", "my_unique_id": "UNIQUE_ID",},
                }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "CONDITIONING", "LATENT", "VAE", "IMAGE", "IMAGE", "STRING",)
    RETURN_NAMES = ("model", "positive", "negative", "latent", "vae", "image", "XY Plot", "生成信息",)
    OUTPUT_NODE = True
    FUNCTION = "sample"
    CATEGORY = "⚡ WindMix/🚀 效率节点"

    def sample(self, model, seed, steps, cfg, sampler_name, scheduler, positive, negative, latent_image,
               preview_method, vae_decode, denoise=1.0, prompt=None, extra_pnginfo=None, my_unique_id=None,
               optional_vae=(None,), script=None, add_noise=None, start_at_step=None, end_at_step=None,
               return_with_leftover_noise=None, sampler_type="regular"):

        # Stitched XY grid image; populated when an XY plot runs, else falls back to output_images
        xy_plot_image = None

        # Rename the vae variable
        vae = optional_vae

        # If vae is not connected, disable vae decoding
        if vae == (None,) and vae_decode != "false":
            print(f"{warning('KSampler(Efficient) Warning:')} No vae input detected, proceeding as if vae_decode was false.\n")
            vae_decode = "false"

        #---------------------------------------------------------------------------------------------------------------
        # Unpack SDXL Tuple embedded in the 'model' channel
        if sampler_type == "sdxl":
            sdxl_tuple = model
            model, _, positive, negative, refiner_model, _, refiner_positive, refiner_negative = sdxl_tuple
        else:
            refiner_model = refiner_positive = refiner_negative = None

        #---------------------------------------------------------------------------------------------------------------
        def keys_exist_in_script(*keys):
            return any(key in script for key in keys) if script else False

        #---------------------------------------------------------------------------------------------------------------
        def vae_decode_latent(vae, samples, vae_decode):
            return VAEDecodeTiled().decode(vae,samples,320)[0] if "tiled" in vae_decode else VAEDecode().decode(vae,samples)[0]

        # ---------------------------------------------------------------------------------------------------------------
        def process_latent_image(model, seed, steps, cfg, sampler_name, scheduler, positive, negative, latent_image,
                                denoise, sampler_type, add_noise, start_at_step, end_at_step, return_with_leftover_noise,
                                refiner_model, refiner_positive, refiner_negative, vae, vae_decode, preview_method):

            # Store originals
            original_calculation = comfy.samplers.calculate_sigmas
            original_KSampler_SCHEDULERS = comfy.samplers.KSampler.SCHEDULERS
            previous_preview_method = global_preview_method()
            original_prepare_noise = comfy.sample.prepare_noise
            original_KSampler = comfy.samplers.KSampler
            original_model_str = str(model)

            # monkey patch the sample function
            def calculate_sigmas(model_sampling, scheduler_name: str, steps):
                if scheduler_name.startswith("AYS"):
                    return AlignYourStepsScheduler().get_sigmas(scheduler_name.split(" ")[1], steps, denoise=1.0)[0]
                elif scheduler_name == "GITS":
                    return GITSScheduler().get_sigmas(1.20, steps, denoise=1.0)[0]
                return original_calculation(model_sampling, scheduler_name, steps)

            comfy.samplers.KSampler.SCHEDULERS = windmix_schedulers()
            comfy.samplers.calculate_sigmas = calculate_sigmas

            # Initialize output variables
            samples = images = gifs = preview = None

            try:
                # Change the global preview method (temporarily)
                set_preview_method(preview_method)

                # ------------------------------------------------------------------------------------------------------
                # Check if "noise" exists in the script before main sampling has taken place
                if keys_exist_in_script("noise"):
                    rng_source, cfg_denoiser, add_seed_noise, m_seed, m_weight = script["noise"]
                    smZ_rng_source.rng_rand_source(rng_source) # this function monkey patches comfy.sample.prepare_noise
                    if cfg_denoiser:
                        comfy.samplers.KSampler = smZ_cfg_denoiser.SDKSampler
                    if add_seed_noise:
                        comfy.sample.prepare_noise = cg_mixed_seed_noise.get_mixed_noise_function(comfy.sample.prepare_noise, m_seed, m_weight)
                    else:
                        m_seed = m_weight = None
                else:
                    rng_source = cfg_denoiser = add_seed_noise = m_seed = m_weight = None

                # ------------------------------------------------------------------------------------------------------
                # Store run parameters as strings. Load previous stored samples if all parameters match.
                latent_image_hash = tensor_to_hash(latent_image["samples"])
                positive_hash = tensor_to_hash(positive[0][0])
                negative_hash = tensor_to_hash(negative[0][0])
                refiner_positive_hash = tensor_to_hash(refiner_positive[0][0]) if refiner_positive is not None else None
                refiner_negative_hash = tensor_to_hash(refiner_negative[0][0]) if refiner_negative is not None else None

                try:
                    _ms = model.model.model_sampling
                    _ms_shift = getattr(_ms, "shift", "n/a")
                    _ms_name = type(_ms).__name__
                    _mdtype = next(model.model.parameters()).dtype
                except Exception as _e:
                    _ms_shift, _ms_name, _mdtype = "n/a", "n/a", "n/a"
                print(f"[WindMix DBG] process_latent_image: seed={seed} steps={steps} cfg={cfg} "
                      f"sampler={sampler_name} scheduler={scheduler} denoise={denoise} sampler_type={sampler_type} "
                      f"add_noise={add_noise} start_at_step={start_at_step} end_at_step={end_at_step} "
                      f"pos_hash={positive_hash} neg_hash={negative_hash} latent_hash={latent_image_hash} "
                      f"pos_shape={tuple(positive[0][0].shape)} pos_dtype={positive[0][0].dtype} "
                      f"neg_shape={tuple(negative[0][0].shape)} latent_shape={tuple(latent_image['samples'].shape)} "
                      f"model_sampling={_ms_name} model_shift={_ms_shift} model_dtype={_mdtype}")
                model_identifier = [original_model_str]

                parameters = [model_identifier] + [seed, steps, cfg, sampler_name, scheduler, positive_hash, negative_hash,
                                                  latent_image_hash, denoise, sampler_type, add_noise, start_at_step,
                                                  end_at_step, return_with_leftover_noise, refiner_model, refiner_positive_hash,
                                                  refiner_negative_hash, rng_source, cfg_denoiser, add_seed_noise, m_seed, m_weight]

                # Convert all elements in parameters to strings, except for the hash variable checks
                parameters = [str(item) if not isinstance(item, type(latent_image_hash)) else item for item in parameters]

                # Load previous latent if all parameters match, else returns 'None'
                samples = load_ksampler_results("latent", my_unique_id, parameters)

                if samples is None: # clear stored images
                    store_ksampler_results("image", my_unique_id, None)

                if samples is not None: # do not re-sample
                    images = load_ksampler_results("image", my_unique_id)

                # Sample the latent_image(s) using the Comfy KSampler nodes
                elif sampler_type == "regular":
                    samples = KSampler().sample(model, seed, steps, cfg, sampler_name, scheduler, positive, negative,
                                                        latent_image, denoise=denoise)[0] if denoise>0 else latent_image

                elif sampler_type == "advanced":
                    samples = KSamplerAdvanced().sample(model, add_noise, seed, steps, cfg, sampler_name, scheduler,
                                                        positive, negative, latent_image, start_at_step, end_at_step,
                                                        return_with_leftover_noise, denoise=1.0)[0]

                elif sampler_type == "sdxl":
                    # Disable refiner if refine_at_step is -1
                    if end_at_step == -1:
                        end_at_step = steps

                    # Perform base model sampling
                    add_noise = return_with_leftover_noise = "enable"
                    samples = KSamplerAdvanced().sample(model, add_noise, seed, steps, cfg, sampler_name, scheduler,
                                                        positive, negative, latent_image, start_at_step, end_at_step,
                                                        return_with_leftover_noise, denoise=1.0)[0]

                    # Perform refiner model sampling
                    if refiner_model and end_at_step < steps:
                        add_noise = return_with_leftover_noise = "disable"
                        samples = KSamplerAdvanced().sample(refiner_model, add_noise, seed, steps, cfg + REFINER_CFG_OFFSET,
                                                            sampler_name, scheduler, refiner_positive, refiner_negative,
                                                            samples, end_at_step, steps,
                                                            return_with_leftover_noise, denoise=1.0)[0]

                # Cache the first pass samples in the 'last_helds' dictionary "latent" if not xyplot
                if not any(keys_exist_in_script(key) for key in ["xyplot"]):
                    store_ksampler_results("latent", my_unique_id, samples, parameters)

                # ------------------------------------------------------------------------------------------------------

                # Decode image if not yet decoded
                if "true" in vae_decode:
                    if images is None:
                        images = vae_decode_latent(vae, samples, vae_decode)
                        # Store decoded image as base image of no script is detected
                        if not keys_exist_in_script("xyplot"):
                            store_ksampler_results("image", my_unique_id, images)

                # Define preview images
                if preview_method == "none" or (preview_method == "vae_decoded_only" and vae_decode == "false"):
                    preview = {"images": list()}
                elif images is not None:
                    preview = PreviewImage().save_images(images, prompt=prompt, extra_pnginfo=extra_pnginfo)["ui"]

                # Define a dummy output image
                if images is None and vae_decode == "false":
                    images = Wind_KSampler.empty_image

            finally:
                # Restore global changes
                set_preview_method(previous_preview_method)
                comfy.samplers.KSampler = original_KSampler
                comfy.sample.prepare_noise = original_prepare_noise
                comfy.samplers.calculate_sigmas = original_calculation
                comfy.samplers.KSampler.SCHEDULERS = original_KSampler_SCHEDULERS

            return samples, images, gifs, preview

        # ---------------------------------------------------------------------------------------------------------------
        # Clean globally stored objects of non-existant nodes
        globals_cleanup(prompt)

        # ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        # If not XY Plotting
        if not keys_exist_in_script("xyplot"):

            # Process latent image
            samples, images, gifs, preview = process_latent_image(model, seed, steps, cfg, sampler_name, scheduler,
                                            positive, negative, latent_image, denoise, sampler_type, add_noise,
                                            start_at_step, end_at_step, return_with_leftover_noise, refiner_model,
                                            refiner_positive, refiner_negative, vae, vae_decode, preview_method)

            # Build the A1111-style generation-info JSON consumed by the ⚡ 保存图像 node.
            gen_info = ""
            try:
                if prompt is not None and my_unique_id is not None:
                    _m, _p, _n = auto_discover_metadata(prompt, my_unique_id, positive, negative)
                    _loras = collect_upstream_loras(prompt, my_unique_id)
                    gen_info = build_windmix_gen_info(steps, sampler_name, scheduler, cfg, seed,
                                                      latent_image, denoise, _m, _p, _n, _loras)
            except Exception:
                gen_info = ""

            xy_plot_out = images if images is not None else Wind_KSampler.empty_image
            if sampler_type == "sdxl":
                result = (sdxl_tuple, positive, negative, samples, vae, images, xy_plot_out, gen_info,)
            else:
                result = (model, positive, negative, samples, vae, images, xy_plot_out, gen_info,)

            if preview is None:
                return {"result": result}
            else:
                return {"ui": preview, "result": result}

        # ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
        # If XY Plot
        elif keys_exist_in_script("xyplot"):

            # If no vae connected, throw errors
            if vae == (None,):
                print(f"{error('KSampler(Efficient) Error:')} VAE input must be connected in order to use the XY Plot script.")

                return {"ui": {"images": list()},
                        "result": (model, positive, negative, latent_image, vae, Wind_KSampler.empty_image, Wind_KSampler.empty_image, "",)}

            # If vae_decode is not set to true, print message that changing it to true
            if "true" not in vae_decode:
                print(f"{warning('KSampler(Efficient) Warning:')} VAE decoding must be set to \'true\'"
                    " for the XY Plot script, proceeding as if \'true\'.\n")

            #___________________________________________________________________________________________________________
            # Initialize, unpack, and clean variables for the XY Plot script
            vae_name = None
            ckpt_name = None
            clip = None
            clip_skip = None
            refiner_name = None
            refiner_clip = None
            refiner_clip_skip = None
            positive_prompt = None
            negative_prompt = None
            ascore = None
            empty_latent_width = None
            empty_latent_height = None
            lora_stack = None

            # Split the 'samples' tensor
            samples_tensors = torch.split(latent_image['samples'], 1, dim=0)

            # Check if 'noise_mask' exists and split if it does
            if 'noise_mask' in latent_image:
                noise_mask_tensors = torch.split(latent_image['noise_mask'], 1, dim=0)
                latent_tensors = [{'samples': img, 'noise_mask': mask} for img, mask in
                                  zip(samples_tensors, noise_mask_tensors)]
            else:
                latent_tensors = [{'samples': img} for img in samples_tensors]

            # Set latent only to the first of the batch
            latent_image = latent_tensors[0]

            # Unpack script Tuple (X_type, X_value, Y_type, Y_value, grid_spacing, Y_label_orientation, dependencies)
            X_type, X_value, Y_type, Y_value, grid_spacing, Y_label_orientation, cache_models, xyplot_as_output_image,\
                xyplot_id, dependencies = script["xyplot"]

            #_______________________________________________________________________________________________________
            # The below section is used to check wether the XY_type is allowed for the Ksampler instance being used.
            # If not the correct type, this section will abort the xy plot script.

            samplers = {
                "regular": {
                    "disallowed": ["AddNoise", "ReturnNoise", "StartStep", "EndStep", "RefineStep",
                                   "Refiner", "Refiner On/Off", "AScore+", "AScore-"],
                    "name": "KSampler (Efficient)"
                },
                "advanced": {
                    "disallowed": ["RefineStep", "Denoise", "RefineStep", "Refiner", "Refiner On/Off",
                                   "AScore+", "AScore-"],
                    "name": "KSampler Adv. (Efficient)"
                },
                "sdxl": {
                    "disallowed": ["AddNoise", "EndStep", "Denoise"],
                    "name": "KSampler SDXL (Eff.)"
                }
            }

            # Define disallowed XY_types for each ksampler type
            def get_ksampler_details(sampler_type):
                return samplers.get(sampler_type, {"disallowed": [], "name": ""})

            def suggest_ksampler(X_type, Y_type, current_sampler):
                for sampler, details in samplers.items():
                    if sampler != current_sampler and X_type not in details["disallowed"] and Y_type not in details["disallowed"]:
                        return details["name"]
                return "a different KSampler"

            # In your main function or code segment:
            details = get_ksampler_details(sampler_type)
            disallowed_XY_types = details["disallowed"]
            ksampler_name = details["name"]

            if X_type in disallowed_XY_types or Y_type in disallowed_XY_types:
                error_prefix = f"{error(f'{ksampler_name} Error:')}"

                failed_type = []
                if X_type in disallowed_XY_types:
                    failed_type.append(f"X_type: '{X_type}'")
                if Y_type in disallowed_XY_types:
                    failed_type.append(f"Y_type: '{Y_type}'")

                suggested_ksampler = suggest_ksampler(X_type, Y_type, sampler_type)

                print(f"{error_prefix} Invalid value for {' and '.join(failed_type)}. "
                    f"Use {suggested_ksampler} for this XY Plot type."
                    f"\nDisallowed XY_types for this KSampler are: {', '.join(disallowed_XY_types)}.")

                return {"ui": {"images": list()},
                    "result": (model, positive, negative, latent_image, vae, Wind_KSampler.empty_image, Wind_KSampler.empty_image, "",)}

            #_______________________________________________________________________________________________________
            # Unpack Effficient Loader dependencies
            if dependencies is not None:
                vae_name, ckpt_name, clip, clip_skip, refiner_name, refiner_clip, refiner_clip_skip,\
                    positive_prompt, negative_prompt, token_normalization, weight_interpretation, ascore,\
                    empty_latent_width, empty_latent_height, lora_stack = dependencies[:15]
                # DiT loader extras (regular loader tuples stop at 16, so these default safely)
                is_dit = bool(dependencies[16]) if len(dependencies) > 16 else False
                dit_clip_name = dependencies[17] if len(dependencies) > 17 else None
                dit_family = dependencies[18] if len(dependencies) > 18 else None
                dit_shift = dependencies[19] if len(dependencies) > 19 else 0.0
                dit_clip_type_override = dependencies[20] if len(dependencies) > 20 else "QWEN_IMAGE"
                dit_unet_name = ckpt_name  # updated by the "DiT Model" XY axis
                # "DiT Model" 轴接外部 MODEL 对象（UNet3：外部接入/融合模型）时非 None，
                # define_model 里直接用该对象、跳过按名加载。字符串路径下保持 None。
                dit_model_obj = None
                base_lora_stack = lora_stack  # snapshot the DiT Efficient Loader's persistent LoRA (built-in lora_name + lora_stack input port); re-applied on every XY reload so it survives across cells

            #_______________________________________________________________________________________________________
            # Printout XY Plot values to be processed
            def process_xy_for_print(value, replacement, type_):

                if type_ == "Seeds++ Batch" and isinstance(value, list):
                    return [v + seed for v in value]  # Add seed to every entry in the list

                elif type_ == "Scheduler" and isinstance(value, tuple):
                    return value[0]  # Return only the first entry of the tuple

                elif type_ == "VAE" and isinstance(value, list):
                    # For each string in the list, extract the filename from the path
                    return [os.path.basename(v) for v in value]

                elif (type_ == "Checkpoint" or type_ == "Refiner") and isinstance(value, list):
                    # For each tuple in the list, return only the first value if the second or third value is None
                    return [(os.path.basename(v[0]),) + v[1:] if v[1] is None or v[2] is None
                            else (os.path.basename(v[0]), v[1]) if v[2] is None
                            else (os.path.basename(v[0]),) + v[1:] for v in value]

                elif (type_ == "LoRA" or type_ == "LoRA Stacks") and isinstance(value, list):
                # Return only the first Tuple of each inner array
                    return [[(os.path.basename(v[0][0]),) + v[0][1:], "..."] if len(v) > 1
                            else [(os.path.basename(v[0][0]),) + v[0][1:]] for v in value]

                elif type_ == "LoRA Batch" and isinstance(value, list):
                    # Extract the basename of the first value of the first tuple from each sublist
                    return [os.path.basename(v[0][0]) for v in value if v and isinstance(v[0], tuple) and v[0][0]]

                elif (type_ == "LoRA Wt" or type_ == "LoRA MStr") and isinstance(value, list):
                    # Extract the first value of the first tuple from each sublist
                    return [v[0][1] for v in value if v and isinstance(v[0], tuple)]

                elif type_ == "LoRA CStr" and isinstance(value, list):
                    # Extract the first value of the first tuple from each sublist
                    return [v[0][2] for v in value if v and isinstance(v[0], tuple)]

                elif type_ == "DiT Model" and isinstance(value, list):
                    # 单元格 = (unet名 或 MODEL对象, clip, vae[, label])：名字取 basename，
                    # MODEL 对象取 label 占位，避免把巨大的模型 repr 打进日志。
                    out = []
                    for v in value:
                        if isinstance(v, (list, tuple)) and v:
                            if isinstance(v[0], str):
                                out.append((os.path.basename(v[0]),) + tuple(v[1:3]))
                            else:
                                out.append((v[3] if len(v) > 3 and v[3] else "Model",))
                        else:
                            out.append(v)
                    return out

                elif isinstance(value, tuple):
                    return tuple(replacement if v is None else v for v in value)

                else:
                    return replacement if value is None else value

            # Determine the replacements based on X_type and Y_type
            replacement_X = scheduler if X_type == 'Sampler' else clip_skip if X_type == 'Checkpoint' else None
            replacement_Y = scheduler if Y_type == 'Sampler' else clip_skip if Y_type == 'Checkpoint' else None

            # Process X_value and Y_value
            X_value_processed = process_xy_for_print(X_value, replacement_X, X_type)
            Y_value_processed = process_xy_for_print(Y_value, replacement_Y, Y_type)

            print(info("-" * 40))
            print(info('XY Plot Script Inputs:'))
            print(info(f"(X) {X_type}:"))
            for item in X_value_processed:
                print(info(f"    {item}"))
            print(info(f"(Y) {Y_type}:"))
            for item in Y_value_processed:
                print(info(f"    {item}"))
            print(info("-" * 40))

            #_______________________________________________________________________________________________________
            # Perform various initializations in this section

            # If not caching models, set to 1.
            if cache_models == "False":
                vae_cache = ckpt_cache = lora_cache = refn_cache = 1
            else:
                # Retrieve cache numbers
                vae_cache, ckpt_cache, lora_cache, refn_cache = get_cache_numbers("XY Plot")
            # Pack cache numbers in a tuple
            cache = (vae_cache, ckpt_cache, lora_cache, refn_cache)

            # Add seed to every entry in the list
            X_value = [v + seed for v in X_value] if "Seeds++ Batch" == X_type else X_value
            Y_value = [v + seed for v in Y_value] if "Seeds++ Batch" == Y_type else Y_value

            # Embedd original prompts into prompt variables
            positive_prompt = (positive_prompt, positive_prompt)
            negative_prompt = (negative_prompt, negative_prompt)

            # Set lora_stack to None if one of types are LoRA
            if "LoRA" in X_type or "LoRA" in Y_type:
                lora_stack = None

            # Optimize image generation by prioritization:
            priority = [
                "Checkpoint",
                "Refiner",
                "DiT Model",
                "LoRA",
                "LoRA Stacks",
                "VAE",
            ]
            conditioners = {
                "Positive Prompt S/R",
                "Negative Prompt S/R",
                "AScore+",
                "AScore-",
                "Clip Skip",
                "Clip Skip (Refiner)",
            }
            # Get priority values; return a high number if the type is not in priority list
            x_priority = priority.index(X_type) if X_type in priority else 999
            y_priority = priority.index(Y_type) if Y_type in priority else 999

            # Check if both are conditioners
            are_both_conditioners = X_type in conditioners and Y_type in conditioners

            # Special cases
            is_special_case = (
                    (X_type == "Refiner On/Off" and Y_type in ["RefineStep", "Steps"]) or
                    (X_type == "Nothing" and Y_type != "Nothing") or
                    (Y_type == "LoRA Batch" and (X_type == "LoRA Wt" or X_type == "LoRA MStr" or X_type == "LoRA CStr"))
            )

            # Determine whether to flip
            flip_xy = (y_priority < x_priority and not are_both_conditioners) or is_special_case

            # Perform the flip if necessary
            if flip_xy:
                X_type, Y_type = Y_type, X_type
                X_value, Y_value = Y_value, X_value

            #_______________________________________________________________________________________________________
            # The below code will clean from the cache any ckpt/vae/lora models it will not be reusing.
            # Note: Special LoRA types will not trigger cache: "LoRA Batch", "LoRA Wt", "LoRA MStr", "LoRA CStr"

            # Map the type names to the dictionaries
            dict_map = {"VAE": [], "Checkpoint": [], "LoRA": [], "Refiner": []}

            # Create a list of tuples with types and values
            type_value_pairs = [(X_type, X_value.copy()), (Y_type, Y_value.copy())]
            
            # Replace "LoRA Stacks" with "LoRA"
            type_value_pairs = [('LoRA' if t == 'LoRA Stacks' else t, v) for t, v in type_value_pairs]
            
            # Iterate over type-value pairs
            for t, v in type_value_pairs:
                if t in dict_map:
                    # Flatten the list of lists of tuples if the type is "LoRA"
                    if t == "LoRA":
                        dict_map[t] = [item for sublist in v for item in sublist]
                    else:
                        dict_map[t] = v

            vae_dict = dict_map.get("VAE", [])

            # Construct ckpt_dict and also update vae_dict based on the third entry of the tuples in dict_map["Checkpoint"]
            if dict_map.get("Checkpoint", []):
                ckpt_dict = [t[0] for t in dict_map["Checkpoint"]]
                for t in dict_map["Checkpoint"]:
                    if t[2] is not None and t[2] != "Baked VAE":
                        vae_dict.append(t[2])
            else:
                ckpt_dict = []

            lora_dict = [[t,] for t in dict_map.get("LoRA", [])] if dict_map.get("LoRA", []) else []

            # Construct refn_dict
            if dict_map.get("Refiner", []):
                refn_dict = [t[0] for t in dict_map["Refiner"]]
            else:
                refn_dict = []

            # If both ckpt_dict and lora_dict are not empty, manipulate lora_dict as described
            if ckpt_dict and lora_dict:
                lora_dict = [(lora_stack, ckpt) for ckpt in ckpt_dict for lora_stack in lora_dict]
            # If lora_dict is not empty and ckpt_dict is empty, insert ckpt_name into each tuple in lora_dict
            elif lora_dict:
                lora_dict = [(lora_stack, ckpt_name) for lora_stack in lora_dict]

            # Avoid caching models accross both X and Y
            if X_type == "Checkpoint":
                lora_dict = []
                refn_dict = []
            elif X_type == "Refiner":
                ckpt_dict = []
                lora_dict = []
            elif X_type == "LoRA":
                ckpt_dict = []
                refn_dict = []

            ### Print dict_arrays for debugging
            ###print(f"vae_dict={vae_dict}\nckpt_dict={ckpt_dict}\nlora_dict={lora_dict}\nrefn_dict={refn_dict}")

            # Clean values that won't be reused
            clear_cache_by_exception(xyplot_id, vae_dict=vae_dict, ckpt_dict=ckpt_dict, lora_dict=lora_dict, refn_dict=refn_dict)

            ### Print loaded_objects for debugging
            ###print_loaded_objects_entries()

            #_______________________________________________________________________________________________________
            # Function that changes appropiate variables for next processed generations (also generates XY_labels)
            def define_variable(var_type, var, add_noise, seed, steps, start_at_step, end_at_step,
                                return_with_leftover_noise, cfg, sampler_name, scheduler, denoise, vae_name, ckpt_name,
                                clip_skip, refiner_name, refiner_clip_skip, positive_prompt, negative_prompt, ascore,
                                lora_stack, var_label, num_label):

                # DiT Model axis swaps unet/clip: these live in the enclosing `sample` scope and are
                # read by define_model. Without `nonlocal` the assignments below would be local to this
                # nested function and never reach define_model (so the swap silently no-ops). When the
                # XY axis leaves clip/vae unset, the inherited value (the DiT Efficient Loader's clip/vae)
                # is preserved here.
                nonlocal dit_unet_name, dit_clip_name, dit_model_obj

                # Define default max label size limit
                max_label_len = 42

                # If var_type is "AddNoise", update 'add_noise' with 'var', and generate text label
                if var_type == "AddNoise":
                    add_noise = var
                    text = f"AddNoise: {add_noise}"

                # If var_type is "Seeds++ Batch", generate text label
                elif var_type == "Seeds++ Batch":
                    seed = var
                    text = f"Seed: {seed}"

                # If var_type is "Steps", update 'steps' with 'var' and generate text label
                elif var_type == "Steps":
                    steps = var
                    text = f"Steps: {steps}"

                # If var_type is "StartStep", update 'start_at_step' with 'var' and generate text label
                elif var_type == "StartStep":
                    start_at_step = var
                    text = f"StartStep: {start_at_step}"

                # If var_type is "EndStep", update 'end_at_step' with 'var' and generate text label
                elif var_type == "EndStep":
                    end_at_step = var
                    text = f"EndStep: {end_at_step}"

                # If var_type is "RefineStep", update 'end_at_step' with 'var' and generate text label
                elif var_type == "RefineStep":
                    end_at_step = var
                    text = f"RefineStep: {end_at_step}"

                # If var_type is "ReturnNoise", update 'return_with_leftover_noise' with 'var', and generate text label
                elif var_type == "ReturnNoise":
                    return_with_leftover_noise = var
                    text = f"ReturnNoise: {return_with_leftover_noise}"

                # If var_type is "CFG Scale", update cfg with var and generate text label
                elif var_type == "CFG Scale":
                    cfg = var
                    text = f"CFG: {round(cfg,2)}"

                # If var_type is "Sampler", update sampler_name and scheduler with var, and generate text label
                elif var_type == "Sampler":
                    sampler_name = var[0]
                    if var[1] == "":
                        text = f"{sampler_name}"
                    else:
                        if var[1] != None:
                            scheduler = (var[1], scheduler[1])
                        else:
                            scheduler = (scheduler[1], scheduler[1])
                        text = f"{sampler_name} ({scheduler[0]})"
                    text = text.replace("ancestral", "a").replace("uniform", "u").replace("exponential","exp")

                # If var_type is "Scheduler", update scheduler and generate labels
                elif var_type == "Scheduler":
                    if len(var) == 2:
                        scheduler = (var[0], scheduler[1])
                        text = f"{sampler_name} ({scheduler[0]})"
                    else:
                        scheduler = (var, scheduler[1])
                        text = f"{scheduler[0]}"
                    text = text.replace("ancestral", "a").replace("uniform", "u").replace("exponential","exp")

                # If var_type is "Denoise", update denoise and generate labels
                elif var_type == "Denoise":
                    denoise = var
                    text = f"Denoise: {round(denoise, 2)}"

                # If var_type is "VAE", update vae_name and generate labels
                elif var_type == "VAE":
                    vae_name = var
                    vae_filename = os.path.splitext(os.path.basename(vae_name))[0]
                    text = f"VAE: {vae_filename}"

                # If var_type is "Positive Prompt S/R", update positive_prompt and generate labels
                elif var_type == "Positive Prompt S/R":
                    search_txt, replace_txt = var
                    if replace_txt != None:
                        # check if we are in the Y loop after the X loop
                        if positive_prompt[2] is not None:
                            positive_prompt = (positive_prompt[2].replace(search_txt, replace_txt, 1), positive_prompt[1], positive_prompt[2])
                        else:
                            positive_prompt = (positive_prompt[1].replace(search_txt, replace_txt, 1), positive_prompt[1], positive_prompt[1].replace(search_txt, replace_txt, 1))
                    else:
                        if positive_prompt[2] is not None:
                            positive_prompt = (positive_prompt[2], positive_prompt[1], positive_prompt[2])
                        else:
                            positive_prompt = (positive_prompt[1], positive_prompt[1], positive_prompt[1])
                        replace_txt = search_txt
                    text = f"{replace_txt}"

                # If var_type is "Negative Prompt S/R", update negative_prompt and generate labels
                elif var_type == "Negative Prompt S/R":
                    search_txt, replace_txt = var
                    if replace_txt != None:
                        # check if we are in the Y loop after the X loop
                        if negative_prompt[2] is not None:
                            negative_prompt = (negative_prompt[2].replace(search_txt, replace_txt, 1), negative_prompt[1], negative_prompt[2])
                        else:
                            negative_prompt = (negative_prompt[1].replace(search_txt, replace_txt, 1), negative_prompt[1], negative_prompt[1].replace(search_txt, replace_txt, 1))
                    else:
                        if negative_prompt[2] is not None:
                            negative_prompt = (negative_prompt[2], negative_prompt[1], negative_prompt[2])
                        else:
                            negative_prompt = (negative_prompt[1], negative_prompt[1], negative_prompt[1])
                        replace_txt = search_txt
                    text = f"(-) {replace_txt}"

                # If var_type is "AScore+", update positive ascore and generate labels
                elif var_type == "AScore+":
                    ascore = (var,ascore[1])
                    text = f"+AScore: {ascore[0]}"

                # If var_type is "AScore-", update negative ascore and generate labels
                elif var_type == "AScore-":
                    ascore = (ascore[0],var)
                    text = f"-AScore: {ascore[1]}"

                # If var_type is "Checkpoint", update model and clip (if needed) and generate labels
                elif var_type == "Checkpoint":
                    ckpt_name = var[0]
                    if var[1] == None:
                        clip_skip = (clip_skip[1],clip_skip[1])
                    else:
                        clip_skip = (var[1],clip_skip[1])
                    if var[2] != None:
                        vae_name = var[2]
                    ckpt_filename = os.path.splitext(os.path.basename(ckpt_name))[0]
                    text = f"{ckpt_filename}"

                # DiT Model axis (WindMix): swap the diffusion model / clip / vae.
                # Mirrors the Checkpoint branch but feeds the separated-file loader path in define_model.
                elif var_type == "DiT Model":
                    if isinstance(var[0], str):
                        # 字符串路径：按名字加载（UNet2 / XY Input: UNet Model）
                        dit_model_obj = None
                        dit_unet_name = var[0]
                        if var[1] is not None:
                            dit_clip_name = var[1]
                        if var[2] is not None:
                            vae_name = var[2]
                        ckpt_filename = os.path.splitext(os.path.basename(dit_unet_name))[0]
                        text = f"{ckpt_filename}"
                    else:
                        # MODEL 对象路径：直连（UNet3：外部接入/融合模型，无本地文件名）。
                        # define_model 里直接用该对象、跳过按名加载。
                        dit_model_obj = var[0]
                        if len(var) > 1 and var[1] is not None:
                            dit_clip_name = var[1]
                        if len(var) > 2 and var[2] is not None:
                            vae_name = var[2]
                        # 融合模型无文件名：用第 4 元素(可选)作网格标题，否则占位
                        text = var[3] if len(var) > 3 and var[3] else "Model"

                # If var_type is "Refiner", update model and clip (if needed) and generate labels
                elif var_type == "Refiner":
                    refiner_name = var[0]
                    if var[1] == None:
                        refiner_clip_skip = (refiner_clip_skip[1],refiner_clip_skip[1])
                    else:
                        refiner_clip_skip = (var[1],refiner_clip_skip[1])
                    ckpt_filename = os.path.splitext(os.path.basename(refiner_name))[0]
                    text = f"{ckpt_filename}"

                # If var_type is "Refiner On/Off", set end_at_step = max steps and generate labels
                elif var_type == "Refiner On/Off":
                    end_at_step = int(var * steps)
                    text = f"Refiner: {'On' if var < 1 else 'Off'}"

                elif var_type == "Clip Skip":
                    clip_skip = (var, clip_skip[1])
                    text = f"ClipSkip ({clip_skip[0]})"

                elif var_type == "Clip Skip (Refiner)":
                    refiner_clip_skip = (var, refiner_clip_skip[1])
                    text = f"RefClipSkip ({refiner_clip_skip[0]})"

                elif "LoRA" in var_type:
                    if not lora_stack or var_type == "LoRA Stacks":
                        lora_stack = var.copy()
                    else:
                        # Updating the first tuple of lora_stack
                        lora_stack[0] = tuple(v if v is not None else lora_stack[0][i] for i, v in enumerate(var[0]))

                    max_label_len = 50 + (12 * (len(lora_stack) - 1))
                    lora_name, lora_model_wt, lora_clip_wt = lora_stack[0][:3]
                    lora_filename = os.path.splitext(os.path.basename(lora_name))[0]

                    if var_type == "LoRA" or var_type == "LoRA Stacks":
                        if len(lora_stack) == 1:
                            lora_model_wt = format(float(lora_model_wt), ".2f").rstrip('0').rstrip('.')
                            lora_clip_wt = format(float(lora_clip_wt), ".2f").rstrip('0').rstrip('.')
                            lora_filename = lora_filename[:max_label_len - len(f"LoRA: ({lora_model_wt})")]
                            if lora_model_wt == lora_clip_wt:
                                text = f"LoRA: {lora_filename}({lora_model_wt})"
                            else:
                                text = f"LoRA: {lora_filename}({lora_model_wt},{lora_clip_wt})"
                        elif len(lora_stack) > 1:
                            lora_filenames = [os.path.splitext(os.path.basename(lora_name))[0] for lora_name, _, _, *_ in
                                              lora_stack]
                            lora_details = [(format(float(lora_model_wt), ".2f").rstrip('0').rstrip('.'),
                                             format(float(lora_clip_wt), ".2f").rstrip('0').rstrip('.')) for
                                            _, lora_model_wt, lora_clip_wt, *_ in lora_stack]
                            non_name_length = sum(
                                len(f"({lora_details[i][0]},{lora_details[i][1]})") + 2 for i in range(len(lora_stack)))
                            available_space = max_label_len - non_name_length
                            max_name_length = available_space // len(lora_stack)
                            lora_filenames = [filename[:max_name_length] for filename in lora_filenames]
                            text_elements = [
                                f"{lora_filename}({lora_details[i][0]})" if lora_details[i][0] == lora_details[i][1]
                                else f"{lora_filename}({lora_details[i][0]},{lora_details[i][1]})" for i, lora_filename in
                                enumerate(lora_filenames)]
                            text = " ".join(text_elements)

                    elif var_type == "LoRA Batch":
                        text = f"LoRA: {lora_filename}"

                    elif var_type == "LoRA Wt":
                        lora_model_wt = format(float(lora_model_wt), ".2f").rstrip('0').rstrip('.')
                        text = f"LoRA Wt: {lora_model_wt}"

                    elif var_type == "LoRA MStr":
                        lora_model_wt = format(float(lora_model_wt), ".2f").rstrip('0').rstrip('.')
                        text = f"LoRA Mstr: {lora_model_wt}"

                    elif var_type == "LoRA CStr":
                        lora_clip_wt = format(float(lora_clip_wt), ".2f").rstrip('0').rstrip('.')
                        text = f"LoRA Cstr: {lora_clip_wt}"

                elif var_type == "XY_Capsule":
                    text = var.getLabel()

                else: # No matching type found
                    text=""

                def truncate_texts(texts, num_label, max_label_len):
                    truncate_length = max(min(max(len(text) for text in texts), max_label_len), 24)

                    return [text if len(text) <= truncate_length else text[:truncate_length] + "..." for text in
                            texts]

                # Add the generated text to var_label if it's not full
                if len(var_label) < num_label:
                    var_label.append(text)

                # If var_type VAE , truncate entries in the var_label list when it's full
                if len(var_label) == num_label and (var_type == "VAE" or var_type == "Checkpoint"
                                                    or var_type == "Refiner" or "LoRA" in var_type):
                    var_label = truncate_texts(var_label, num_label, max_label_len)

                # Return the modified variables
                return add_noise, seed, steps, start_at_step, end_at_step, return_with_leftover_noise, cfg,\
                    sampler_name, scheduler, denoise, vae_name, ckpt_name, clip_skip, \
                    refiner_name, refiner_clip_skip, positive_prompt, negative_prompt, ascore,\
                    lora_stack, var_label

            #_______________________________________________________________________________________________________
            # The function below is used to optimally load Checkpoint/LoRA/VAE models between generations.
            def define_model(model, clip, clip_skip, refiner_model, refiner_clip, refiner_clip_skip,
                             ckpt_name, refiner_name, positive, negative, refiner_positive, refiner_negative,
                             positive_prompt, negative_prompt, ascore, vae, vae_name, lora_stack, index,
                             types, xyplot_id, cache, sampler_type, empty_latent_width, empty_latent_height,
                             is_dit=False, dit_unet_name=None, dit_clip_name=None, dit_family=None, dit_shift=0.0,
                             dit_clip_type_override="QWEN_IMAGE", dit_model_obj=None):

                # Variable to track wether to encode prompt or not
                encode = False
                encode_refiner = False

                # Re-apply the DiT Efficient Loader's persistent LoRA(s) onto a freshly reloaded
                # base model/clip. _windmix_dit_load() returns an un-patched base, so without this the
                # loader's LoRA (from the built-in lora_name widget OR the lora_stack input port) would
                # only survive on the very first model and be silently dropped for every XY cell.
                def _reapply_base_lora(m, c):
                    if not base_lora_stack:
                        return m, c
                    for _li in base_lora_stack:
                        if not isinstance(_li, (list, tuple)) or len(_li) < 2:
                            continue
                        _ln, _lm = _li[0], _li[1]
                        _lc = _li[2] if len(_li) > 2 else _lm
                        _lp = _ln if os.path.isabs(_ln) else folder_paths.get_full_path("loras", _ln)
                        if _lp is None:
                            continue
                        _lora = comfy.utils.load_torch_file(_lp, safe_load=True)
                        m, c = comfy.sd.load_lora_for_models(m, c, _lora, _lm, _lc)
                    return m, c

                # Unpack types tuple
                X_type, Y_type = types

                # Note: Index is held at 0 when Y_type == "Nothing"

                # DiT loader: load the separated-file model (unet + clip + vae). Independent of the X/Y LoRA
                # interplay below, so it fires whether the DiT Model axis is X, Y, or paired with LoRA.
                # NOTE: must load for EVERY cell of the DiT Model axis, NOT just index == 0. When DiT Model
                # is the Y axis (inner row loop) each row is a *different* unet, so relying on the index==0
                # guard would make rows >0 reuse row 0's unet and pile LoRA patches on top -> broken grid.
                if is_dit and (X_type == "DiT Model" or Y_type == "DiT Model"):
                    if dit_model_obj is not None:
                        # MODEL 对象直连（UNet3：外部接入/融合模型）：跳过按名加载，
                        # 但必须与按名加载路径(UNet2)对齐：
                        # ① 注入 DiT Efficient Loader 的 shift（dit_shift>0 时），否则非默认 shift 丢失；
                        # ② 把 Loader 的 LoRA（lora_name widget + lora_stack 端口）注入融合模型，否则
                        #    加速 LoRA 等缺失会导致出图畸形。
                        # 先克隆基础 model/clip（若支持 clone）再操作，避免：① 就地修改用户传入的
                        # 融合模型对象（影响其它引用它的节点）② XY 网格多格复用同一融合模型时
                        # 同一 LoRA/shift 被叠加多次（权重翻倍）。
                        model = dit_model_obj
                        _needs_clone = bool(dit_shift and dit_shift > 0) or bool(base_lora_stack)
                        if _needs_clone:
                            if hasattr(model, "clone"):
                                model = model.clone()
                            if clip is not None and hasattr(clip, "clone"):
                                clip = clip.clone()
                        if dit_shift and dit_shift > 0:
                            try:
                                model.model.model_sampling.set_parameters(shift=float(dit_shift))
                            except Exception as _e:
                                print(f"[WindMix] UNet3 could not set shift on {type(model.model.model_sampling).__name__}: {_e}")
                                class _MS(comfy.model_sampling.ModelSamplingFlux, comfy.model_sampling.CONST):
                                    pass
                                _ms = _MS(model.model.model_config)
                                _ms.set_parameters(float(dit_shift))
                                model.add_object_patch("model_sampling", _ms)
                        if base_lora_stack:
                            model, clip = _reapply_base_lora(model, clip)
                    else:
                        model, clip, vae = _windmix_dit_load(dit_unet_name, dit_clip_name, vae_name, dit_family, dit_shift, dit_clip_type_override)
                        model, clip = _reapply_base_lora(model, clip)
                    encode = True

                # Load Checkpoint if required. If Y_type is LoRA, required models will be loaded by load_lora func.
                if (X_type == "Checkpoint" and index == 0 and Y_type not in ("LoRA", "LoRA Stacks")):
                    if is_dit:
                        model, clip, vae = _windmix_dit_load(dit_unet_name, dit_clip_name, vae_name, dit_family, dit_shift, dit_clip_type_override)
                        model, clip = _reapply_base_lora(model, clip)
                    elif lora_stack is None:
                        model, clip, _ = load_checkpoint(ckpt_name, xyplot_id, cache=cache[1])
                    else: # Load Efficient Loader LoRA
                        model, clip = load_lora(lora_stack, ckpt_name, xyplot_id,
                                                cache=None, ckpt_cache=cache[1])
                    encode = True

                # Load LoRA if required
                elif (X_type in ("LoRA", "LoRA Stacks")):
                    if is_dit:
                        # For DiT LoRA axes each cell must start from the clean, un-patched base
                        # (a fresh clone of original_model/original_clip) so LoRA patches don't
                        # accumulate across X/Y cells. Without this, cell N would carry LoRAs 0..N-1
                        # and only the first generated image would look correct.
                        if "DiT Model" not in (X_type, Y_type) and original_model is not None:
                            model, clip = original_model.clone(), original_clip.clone()
                        elif model is None:
                            model, clip, vae = _windmix_dit_load(dit_unet_name, dit_clip_name, vae_name, dit_family, dit_shift, dit_clip_type_override)
                        # get_batch_files() returns absolute paths while "LoRA Names" mode passes bare
                        # filenames; mirror the non-DiT load_lora() handling so both resolve correctly.
                        lora_name = lora_stack[0][0]
                        # 守卫：「无 LoRA 基线」项（来自 ⚡ XY Input: LoRA 的 include_none 开关）。
                        # lora_name == "None" 时跳过加载，model/clip 保持干净，直接出图做基线对比。
                        if lora_name and lora_name != "None":
                            lora_path = lora_name if os.path.isabs(lora_name) else folder_paths.get_full_path("loras", lora_name)
                            if lora_path is not None:
                                lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                                model, clip = comfy.sd.load_lora_for_models(model, clip, lora, lora_stack[0][1], lora_stack[0][2])
                    else:
                        # Don't cache Checkpoints
                        model, clip = load_lora(lora_stack, ckpt_name, xyplot_id, cache=cache[2])
                    encode = True
                elif Y_type in ("LoRA", "LoRA Stacks"):  # X_type must be Checkpoint, so cache those as defined
                    if is_dit:
                        # For DiT LoRA axes each cell must start from the clean, un-patched base
                        # (a fresh clone of original_model/original_clip) so LoRA patches don't
                        # accumulate across X/Y cells. Without this, cell N would carry LoRAs 0..N-1
                        # and only the first generated image would look correct.
                        if "DiT Model" not in (X_type, Y_type) and original_model is not None:
                            model, clip = original_model.clone(), original_clip.clone()
                        elif model is None:
                            model, clip, vae = _windmix_dit_load(dit_unet_name, dit_clip_name, vae_name, dit_family, dit_shift, dit_clip_type_override)
                        # get_batch_files() returns absolute paths while "LoRA Names" mode passes bare
                        # filenames; mirror the non-DiT load_lora() handling so both resolve correctly.
                        lora_name = lora_stack[0][0]
                        # 守卫：「无 LoRA 基线」项（来自 ⚡ XY Input: LoRA 的 include_none 开关）。
                        # lora_name == "None" 时跳过加载，model/clip 保持干净，直接出图做基线对比。
                        if lora_name and lora_name != "None":
                            lora_path = lora_name if os.path.isabs(lora_name) else folder_paths.get_full_path("loras", lora_name)
                            if lora_path is not None:
                                lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                                model, clip = comfy.sd.load_lora_for_models(model, clip, lora, lora_stack[0][1], lora_stack[0][2])
                    else:
                        model, clip = load_lora(lora_stack, ckpt_name, xyplot_id,
                                                cache=None, ckpt_cache=cache[1])
                    encode = True
                elif X_type == "LoRA Batch" or X_type == "LoRA Wt" or X_type == "LoRA MStr" or X_type == "LoRA CStr":
                    if is_dit:
                        # For DiT LoRA axes each cell must start from the clean, un-patched base
                        # (a fresh clone of original_model/original_clip) so LoRA patches don't
                        # accumulate across X/Y cells. Without this, cell N would carry LoRAs 0..N-1
                        # and only the first generated image would look correct.
                        if "DiT Model" not in (X_type, Y_type) and original_model is not None:
                            model, clip = original_model.clone(), original_clip.clone()
                        elif model is None:
                            model, clip, vae = _windmix_dit_load(dit_unet_name, dit_clip_name, vae_name, dit_family, dit_shift, dit_clip_type_override)
                        # get_batch_files() returns absolute paths while "LoRA Names" mode passes bare
                        # filenames; mirror the non-DiT load_lora() handling so both resolve correctly.
                        lora_name = lora_stack[0][0]
                        # 守卫：「无 LoRA 基线」项（来自 ⚡ XY Input: LoRA 的 include_none 开关）。
                        # lora_name == "None" 时跳过加载，model/clip 保持干净，直接出图做基线对比。
                        if lora_name and lora_name != "None":
                            lora_path = lora_name if os.path.isabs(lora_name) else folder_paths.get_full_path("loras", lora_name)
                            if lora_path is not None:
                                lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
                                model, clip = comfy.sd.load_lora_for_models(model, clip, lora, lora_stack[0][1], lora_stack[0][2])
                    else:
                        # Don't cache Checkpoints or LoRAs
                        model, clip = load_lora(lora_stack, ckpt_name, xyplot_id, cache=0)
                    encode = True

                if (X_type == "Refiner" and index == 0) or Y_type == "Refiner":
                    refiner_model, refiner_clip, _ = \
                        load_checkpoint(refiner_name, xyplot_id, output_vae=False, cache=cache[3], ckpt_type="refn")
                    encode_refiner = True

                # WindMix: inject per-LoRA trigger tags into the positive prompt ("LoRA Names+Tags" mode).
                # Tags live in the 4th element of any 4-tuple in lora_stack; 3-tuples (e.g. the lora_stack
                # port's constant LoRAs) carry no tag and are skipped automatically. Each non-empty tag box's
                # text is appended verbatim; multiple LoRAs in the same cell are joined with ", ".
                if isinstance(positive_prompt, str):
                    _tags = [e[3] for e in (lora_stack or [])
                             if isinstance(e, (list, tuple)) and len(e) > 3 and e[3]]
                    if _tags:
                        sep = ", " if positive_prompt else ""
                        positive_prompt = positive_prompt + sep + ", ".join(_tags)

                # Encode base prompt if required
                encode_types = ["Positive Prompt S/R", "Negative Prompt S/R", "Clip Skip", "XY_Capsule"]
                if (X_type in encode_types and index == 0) or Y_type in encode_types:
                    encode = True

                # Encode refiner prompt if required
                encode_refiner_types = ["Positive Prompt S/R", "Negative Prompt S/R", "AScore+", "AScore-",
                                        "Clip Skip (Refiner)", "XY_Capsule"]
                if (X_type in encode_refiner_types and index == 0) or Y_type in encode_refiner_types:
                    encode_refiner = True

                # Encode base prompt
                if encode == True:
                    if is_dit:
                        # DiT text encoders are T5/Qwen, not CLIP. Use ComfyUI's native CLIPTextEncode path
                        # (identical to the DiT loader's own encoding) instead of encode_prompts/AdvancedCLIPTextEncode,
                        # which is CLIP-specific and mangles DiT conditioning -> prompt-unrelated images.
                        positive = CLIPTextEncode().encode(clip, positive_prompt)[0]
                        negative = CLIPTextEncode().encode(clip, negative_prompt)[0]
                    else:
                        positive, negative, clip = \
                            encode_prompts(positive_prompt, negative_prompt, token_normalization, weight_interpretation,
                                           clip, clip_skip, refiner_clip, refiner_clip_skip, ascore, sampler_type == "sdxl",
                                           empty_latent_width, empty_latent_height, return_type="base")

                if encode_refiner == True:
                    refiner_positive, refiner_negative, refiner_clip = \
                        encode_prompts(positive_prompt, negative_prompt, token_normalization, weight_interpretation,
                                       clip, clip_skip, refiner_clip, refiner_clip_skip, ascore, sampler_type == "sdxl",
                                       empty_latent_width, empty_latent_height, return_type="refiner")

                # Load VAE if required
                if (X_type == "VAE" and index == 0) or Y_type == "VAE":
                    #vae = load_vae(vae_name, xyplot_id, cache=cache[0])
                    vae = get_bvae_by_ckpt_name(ckpt_name) if vae_name == "Baked VAE" \
                        else load_vae(vae_name, xyplot_id, cache=cache[0])
                elif X_type == "Checkpoint" and index == 0 and vae_name:
                    vae = get_bvae_by_ckpt_name(ckpt_name) if vae_name == "Baked VAE" \
                        else load_vae(vae_name, xyplot_id, cache=cache[0])

                return model, positive, negative, refiner_model, refiner_positive, refiner_negative, vae

            # ______________________________________________________________________________________________________
            # The below function is used to generate the results based on all the processed variables
            def process_values(model, refiner_model, add_noise, seed, steps, start_at_step, end_at_step,
                               return_with_leftover_noise, cfg, sampler_name, scheduler, positive, negative,
                               refiner_positive, refiner_negative, latent_image, denoise, vae, vae_decode,
                               sampler_type, latent_list=[], image_tensor_list=[], image_pil_list=[], xy_capsule=None):

                capsule_result = None
                if xy_capsule is not None:
                    capsule_result = xy_capsule.get_result(model, clip, vae)
                    if capsule_result is not None:
                        image, latent = capsule_result
                        latent_list.append(latent)

                if capsule_result is None:

                    samples, images, _, _ = process_latent_image(model, seed, steps, cfg, sampler_name, scheduler, positive, negative,
                                                  latent_image, denoise, sampler_type, add_noise, start_at_step,
                                                  end_at_step, return_with_leftover_noise, refiner_model,
                                                  refiner_positive, refiner_negative, vae, vae_decode, preview_method)

                    # Add the latent tensor to the tensors list
                    latent_list.append(samples)

                    # Decode the latent tensor if required
                    image = images if images is not None else vae_decode_latent(vae, samples, vae_decode)

                    if xy_capsule is not None:
                        xy_capsule.set_result(image, samples)

                # Add the resulting image tensor to image_tensor_list
                image_tensor_list.append(image)

                # Convert the image from tensor to PIL Image and add it to the image_pil_list
                image_pil_list.append(tensor2pil(image))

                # Return the touched variables
                return latent_list, image_tensor_list, image_pil_list

            # ______________________________________________________________________________________________________
            # The below section is the heart of the XY Plot image generation

             # Initiate Plot label text variables X/Y_label
            X_label = []
            Y_label = []

            # Store the KSamplers original scheduler inside the same scheduler variable
            scheduler = (scheduler, scheduler)

            # Store the Eff Loaders original clip_skips inside the same clip_skip variables
            clip_skip = (clip_skip, clip_skip)
            refiner_clip_skip = (refiner_clip_skip, refiner_clip_skip)

            # Store types in a Tuple for easy function passing
            types = (X_type, Y_type)

            # Clone original model parameters
            def clone_or_none(*originals):
                cloned_items = []
                for original in originals:
                    try:
                        cloned_items.append(original.clone())
                    except (AttributeError, TypeError):
                        # If not clonable, just append the original item
                        cloned_items.append(original)
                return cloned_items
            original_model, original_clip, original_positive, original_negative,\
                original_refiner_model, original_refiner_clip, original_refiner_positive, original_refiner_negative =\
                clone_or_none(model, clip, positive, negative, refiner_model, refiner_clip, refiner_positive, refiner_negative)

            # Fill Plot Rows (X)
            for X_index, X in enumerate(X_value):
                # add a none value in the positive prompt memory.
                # the tuple is composed of (actual prompt, original prompte before S/R, prompt after X S/R)
                positive_prompt = (positive_prompt[0], positive_prompt[1], None)
                negative_prompt = (negative_prompt[0], negative_prompt[1], None)

                # Define X parameters and generate labels
                add_noise, seed, steps, start_at_step, end_at_step, return_with_leftover_noise, cfg,\
                    sampler_name, scheduler, denoise, vae_name, ckpt_name, clip_skip,\
                    refiner_name, refiner_clip_skip, positive_prompt, negative_prompt, ascore,\
                    lora_stack, X_label = \
                    define_variable(X_type, X, add_noise, seed, steps, start_at_step, end_at_step,
                                    return_with_leftover_noise, cfg, sampler_name, scheduler, denoise, vae_name,
                                    ckpt_name, clip_skip, refiner_name, refiner_clip_skip, positive_prompt,
                                    negative_prompt, ascore, lora_stack, X_label, len(X_value))

                if X_type != "Nothing" and Y_type == "Nothing":
                    if X_type == "XY_Capsule":
                        model, clip, refiner_model, refiner_clip = \
                            clone_or_none(original_model, original_clip, original_refiner_model, original_refiner_clip)
                        model, clip, vae = X.pre_define_model(model, clip, vae)

                    # Models & Conditionings
                    model, positive, negative, refiner_model, refiner_positive, refiner_negative, vae = \
                        define_model(model, clip, clip_skip[0], refiner_model, refiner_clip, refiner_clip_skip[0],
                                     ckpt_name, refiner_name, positive, negative, refiner_positive, refiner_negative,
                                     positive_prompt[0], negative_prompt[0], ascore, vae, vae_name, lora_stack,
                                     0, types, xyplot_id, cache, sampler_type, empty_latent_width, empty_latent_height,
                                     is_dit, dit_unet_name, dit_clip_name, dit_family, dit_shift, dit_clip_type_override, dit_model_obj)

                    xy_capsule = None
                    if X_type == "XY_Capsule":
                        xy_capsule = X

                    # Generate Results
                    latent_list, image_tensor_list, image_pil_list = \
                        process_values(model, refiner_model, add_noise, seed, steps, start_at_step, end_at_step,
                                       return_with_leftover_noise, cfg, sampler_name, scheduler[0], positive, negative,
                                       refiner_positive, refiner_negative, latent_image, denoise, vae, vae_decode, sampler_type, xy_capsule=xy_capsule)

                elif X_type != "Nothing" and Y_type != "Nothing":
                    for Y_index, Y in enumerate(Y_value):

                        if Y_type == "XY_Capsule" or X_type == "XY_Capsule":
                            model, clip, refiner_model, refiner_clip = \
                                clone_or_none(original_model, original_clip, original_refiner_model, original_refiner_clip)

                        if Y_type == "XY_Capsule" and X_type == "XY_Capsule":
                            Y.set_x_capsule(X)

                        # Define Y parameters and generate labels
                        add_noise, seed, steps, start_at_step, end_at_step, return_with_leftover_noise, cfg,\
                            sampler_name, scheduler, denoise, vae_name, ckpt_name, clip_skip,\
                            refiner_name, refiner_clip_skip, positive_prompt, negative_prompt, ascore,\
                            lora_stack, Y_label = \
                            define_variable(Y_type, Y, add_noise, seed, steps, start_at_step, end_at_step,
                                            return_with_leftover_noise, cfg, sampler_name, scheduler, denoise, vae_name,
                                            ckpt_name, clip_skip, refiner_name, refiner_clip_skip, positive_prompt,
                                            negative_prompt, ascore, lora_stack, Y_label, len(Y_value))

                        if Y_type == "XY_Capsule":
                            model, clip, vae = Y.pre_define_model(model, clip, vae)
                        elif X_type == "XY_Capsule":
                            model, clip, vae = X.pre_define_model(model, clip, vae)

                        # Models & Conditionings
                        model, positive, negative, refiner_model, refiner_positive, refiner_negative, vae = \
                            define_model(model, clip, clip_skip[0], refiner_model, refiner_clip, refiner_clip_skip[0],
                                         ckpt_name, refiner_name, positive, negative, refiner_positive, refiner_negative,
                                         positive_prompt[0], negative_prompt[0], ascore, vae, vae_name, lora_stack,
                                         Y_index, types, xyplot_id, cache, sampler_type, empty_latent_width,
                                         empty_latent_height, is_dit, dit_unet_name, dit_clip_name, dit_family, dit_shift, dit_clip_type_override, dit_model_obj)

                        # Generate Results
                        xy_capsule = None
                        if Y_type == "XY_Capsule":
                            xy_capsule = Y

                        latent_list, image_tensor_list, image_pil_list = \
                            process_values(model, refiner_model, add_noise, seed, steps, start_at_step, end_at_step,
                                           return_with_leftover_noise, cfg, sampler_name, scheduler[0],
                                           positive, negative, refiner_positive, refiner_negative, latent_image,
                                           denoise, vae, vae_decode, sampler_type, xy_capsule=xy_capsule)

            # Clean up cache
            if cache_models == "False":
                clear_cache_by_exception(xyplot_id, vae_dict=[], ckpt_dict=[], lora_dict=[], refn_dict=[])
            else:
                # Avoid caching models accross both X and Y
                if X_type == "Checkpoint":
                    clear_cache_by_exception(xyplot_id, lora_dict=[], refn_dict=[])
                elif X_type == "Refiner":
                    clear_cache_by_exception(xyplot_id, ckpt_dict=[], lora_dict=[])
                elif X_type in ("LoRA", "LoRA Stacks"):
                    clear_cache_by_exception(xyplot_id, ckpt_dict=[], refn_dict=[])

            # __________________________________________________________________________________________________________
            # Function for printing all plot variables (WARNING: This function is an absolute mess)
            def print_plot_variables(X_type, Y_type, X_value, Y_value, add_noise, seed, steps, start_at_step, end_at_step,
                                     return_with_leftover_noise, cfg, sampler_name, scheduler, denoise, vae_name, ckpt_name,
                                     clip_skip, refiner_name, refiner_clip_skip, ascore, lora_stack, sampler_type,
                                     num_rows, num_cols, i_height, i_width):

                print("-" * 40)  # Print an empty line followed by a separator line
                print(f"{xyplot_message('XY Plot Results:')}")

                def get_vae_name(X_type, Y_type, X_value, Y_value, vae_name):
                    if X_type == "VAE":
                        vae_name = "\n      ".join(map(lambda x: os.path.splitext(os.path.basename(str(x)))[0], X_value))
                    elif Y_type == "VAE":
                        vae_name = "\n      ".join(map(lambda y: os.path.splitext(os.path.basename(str(y)))[0], Y_value))
                    elif vae_name:
                        vae_name = os.path.splitext(os.path.basename(str(vae_name)))[0]
                    else:
                        vae_name = ""
                    return vae_name

                def get_clip_skip(X_type, Y_type, X_value, Y_value, cskip, mode):
                    clip_type = "Clip Skip" if mode == "ckpt" else "Clip Skip (Refiner)"
                    if X_type == clip_type:
                        cskip = ", ".join(map(str, X_value))
                    elif Y_type == clip_type:
                        cskip = ", ".join(map(str, Y_value))
                    elif cskip[1] != None:
                        cskip = cskip[1]
                    else:
                        cskip = ""

                def get_checkpoint_name(X_type, Y_type, X_value, Y_value, ckpt_name, clip_skip, mode, vae_name=None):

                    # If ckpt_name is None, return it as is
                    if ckpt_name is not None:
                        ckpt_name = os.path.basename(ckpt_name)

                    # Define types based on mode
                    primary_type = "Checkpoint" if mode == "ckpt" else "Refiner"
                    clip_type = "Clip Skip" if mode == "ckpt" else "Clip Skip (Refiner)"

                    # Determine ckpt and othr based on primary type
                    if X_type == primary_type:
                        ckpt_type, ckpt_value = X_type, X_value.copy()
                        othr_type, othr_value = Y_type, Y_value.copy()
                    elif Y_type == primary_type:
                        ckpt_type, ckpt_value = Y_type, Y_value.copy()
                        othr_type, othr_value = X_type, X_value.copy()
                    else:
                        # Process as per original function if mode is "ckpt"
                        clip_skip = get_clip_skip(X_type, Y_type, X_value, Y_value, clip_skip, mode)
                        if mode == "ckpt":
                            if vae_name:
                                vae_name = get_vae_name(X_type, Y_type, X_value, Y_value, vae_name)
                            return ckpt_name, clip_skip, vae_name
                        else:
                            # For refn mode
                            return ckpt_name, clip_skip

                    # Process clip skip based on mode
                    if othr_type == clip_type:
                        clip_skip = ", ".join(map(str, othr_value))
                    elif ckpt_value[0][1] != None:
                        clip_skip = None

                    # Process vae_name based on mode
                    if mode == "ckpt":
                        if othr_type == "VAE":
                            vae_name = get_vae_name(X_type, Y_type, X_value, Y_value, vae_name)
                        elif ckpt_value[0][2] != None:
                            vae_name = None

                    def format_name(v, _type):
                        base = os.path.basename(v[0])
                        if _type == clip_type and v[1] is not None:
                            return base
                        elif _type == "VAE" and v[1] is not None and v[2] is not None:
                            return f"{base}({v[1]})"
                        elif v[1] is not None and v[2] is not None:
                            return f"{base}({v[1]}) + vae:{v[2]}"
                        elif v[1] is not None:
                            return f"{base}({v[1]})"
                        else:
                            return base

                    ckpt_name = "\n      ".join([format_name(v, othr_type) for v in ckpt_value])
                    if mode == "ckpt":
                        return ckpt_name, clip_skip, vae_name
                    else:
                        return ckpt_name, clip_skip

                def get_lora_name(X_type, Y_type, X_value, Y_value, lora_stack=None):
                    lora_name = lora_wt = lora_model_str = lora_clip_str = None

                    # Check for all possible LoRA types
                    lora_types = ["LoRA", "LoRA Stacks", "LoRA Batch", "LoRA Wt", "LoRA MStr", "LoRA CStr"]

                    def get_lora_name_for_weights(lora_path, lora_name):
                        if lora_path:
                            return os.path.basename(X_value[0][0][0]) if lora_name is None else lora_name
                        return None

                    if X_type not in lora_types and Y_type not in lora_types:
                        if lora_stack:
                            names_list = []
                            for name, model_wt, clip_wt, *rest in lora_stack:
                                base_name = os.path.splitext(os.path.basename(name))[0]
                                formatted_str = f"{base_name}({round(model_wt, 3)},{round(clip_wt, 3)})"
                                names_list.append(formatted_str)
                            lora_name = f"[{', '.join(names_list)}]"
                    else:
                        if X_type in lora_types:
                            value = get_lora_sublist_name(X_type, X_value)
                            if  X_type in ("LoRA", "LoRA Stacks"):
                                lora_name = value
                                lora_model_str = None
                                lora_clip_str = None
                            if X_type == "LoRA Batch":
                                lora_name = value
                                lora_model_str = X_value[0][0][1] if lora_model_str is None else lora_model_str
                                lora_clip_str = X_value[0][0][2] if lora_clip_str is None else lora_clip_str
                            elif X_type == "LoRA MStr":
                                lora_name = get_lora_name_for_weights(X_value[0][0][0], lora_name)
                                lora_model_str = value
                                lora_clip_str = X_value[0][0][2] if lora_clip_str is None else lora_clip_str
                            elif X_type == "LoRA CStr":
                                lora_name = get_lora_name_for_weights(X_value[0][0][0], lora_name)
                                lora_model_str = X_value[0][0][1] if lora_model_str is None else lora_model_str
                                lora_clip_str = value
                            elif X_type == "LoRA Wt":
                                lora_name = get_lora_name_for_weights(X_value[0][0][0], lora_name)
                                lora_wt = value

                        if Y_type in lora_types:
                            value = get_lora_sublist_name(Y_type, Y_value)
                            if  Y_type in ("LoRA", "LoRA Stacks"):
                                lora_name = value
                                lora_model_str = None
                                lora_clip_str = None
                            if Y_type == "LoRA Batch":
                                lora_name = value
                                lora_model_str = Y_value[0][0][1] if lora_model_str is None else lora_model_str
                                lora_clip_str = Y_value[0][0][2] if lora_clip_str is None else lora_clip_str
                            elif Y_type == "LoRA MStr":
                                lora_name = get_lora_name_for_weights(Y_value[0][0][0], lora_name)
                                lora_model_str = value
                                lora_clip_str = Y_value[0][0][2] if lora_clip_str is None else lora_clip_str
                            elif Y_type == "LoRA CStr":
                                lora_name = get_lora_name_for_weights(Y_value[0][0][0], lora_name)
                                lora_model_str = Y_value[0][0][1] if lora_model_str is None else lora_model_str
                                lora_clip_str = value
                            elif Y_type == "LoRA Wt":
                                lora_name = get_lora_name_for_weights(Y_value[0][0][0], lora_name)
                                lora_wt = value

                    return lora_name, lora_wt, lora_model_str, lora_clip_str

                def get_lora_sublist_name(lora_type, lora_value):
                    if lora_type in ("LoRA", "LoRA Batch", "LoRA Stacks"):
                        formatted_sublists = []
                        for sublist in lora_value:
                            formatted_entries = []
                            for x in sublist:
                                base_name = os.path.splitext(os.path.basename(str(x[0])))[0]
                                formatted_str = f"{base_name}({round(x[1], 3)},{round(x[2], 3)})" if lora_type in ("LoRA", "LoRA Stacks") else f"{base_name}"
                                formatted_entries.append(formatted_str)
                            formatted_sublists.append(f"{', '.join(formatted_entries)}")
                        return "\n      ".join(formatted_sublists)
                    elif lora_type == "LoRA MStr":
                        return ", ".join([str(round(x[0][1], 3)) for x in lora_value])
                    elif lora_type == "LoRA CStr":
                        return ", ".join([str(round(x[0][2], 3)) for x in lora_value])
                    elif lora_type == "LoRA Wt":
                        return ", ".join([str(round(x[0][1], 3)) for x in lora_value])  # assuming LoRA Wt uses the second value
                    else:
                        return ""

                # VAE, Checkpoint, Clip Skip, LoRA
                ckpt_name, clip_skip, vae_name = get_checkpoint_name(X_type, Y_type, X_value, Y_value, ckpt_name, clip_skip, "ckpt", vae_name)
                lora_name, lora_wt, lora_model_str, lora_clip_str = get_lora_name(X_type, Y_type, X_value, Y_value, lora_stack)
                refiner_name, refiner_clip_skip = get_checkpoint_name(X_type, Y_type, X_value, Y_value, refiner_name, refiner_clip_skip, "refn")

                # AddNoise
                add_noise = ", ".join(map(str, X_value)) if X_type == "AddNoise" else ", ".join(
                    map(str, Y_value)) if Y_type == "AddNoise" else add_noise

                # Seeds++ Batch
                seed = "\n      ".join(map(str, X_value)) if X_type == "Seeds++ Batch" else "\n      ".join(
                    map(str, Y_value)) if Y_type == "Seeds++ Batch" else seed

                # Steps
                steps = ", ".join(map(str, X_value)) if X_type == "Steps" else ", ".join(
                    map(str, Y_value)) if Y_type == "Steps" else steps

                # StartStep
                start_at_step = ", ".join(map(str, X_value)) if X_type == "StartStep" else ", ".join(
                    map(str, Y_value)) if Y_type == "StartStep" else start_at_step

                # EndStep/RefineStep
                end_at_step = ", ".join(map(str, X_value)) if X_type in ["EndStep", "RefineStep"] else ", ".join(
                    map(str, Y_value)) if Y_type in ["EndStep", "RefineStep"] else end_at_step

                # ReturnNoise
                return_with_leftover_noise = ", ".join(map(str, X_value)) if X_type == "ReturnNoise" else ", ".join(
                    map(str, Y_value)) if Y_type == "ReturnNoise" else return_with_leftover_noise

                # CFG
                cfg = ", ".join(map(str, X_value)) if X_type == "CFG Scale" else ", ".join(
                    map(str, Y_value)) if Y_type == "CFG Scale" else round(cfg,3)

                # Sampler/Scheduler
                if X_type == "Sampler":
                    if Y_type == "Scheduler":
                        sampler_name = ", ".join([f"{x[0]}" for x in X_value])
                        scheduler = ", ".join([f"{y}" for y in Y_value])
                    else:
                        sampler_name = ", ".join([f"{x[0]}({x[1] if x[1] != '' and x[1] is not None else scheduler[1]})" for x in X_value])
                        scheduler = "_"
                elif Y_type == "Sampler":
                    if X_type == "Scheduler":
                        sampler_name = ", ".join([f"{y[0]}" for y in Y_value])
                        scheduler = ", ".join([f"{x}" for x in X_value])
                    else:
                        sampler_name = ", ".join([f"{y[0]}({y[1] if y[1] != '' and y[1] is not None else scheduler[1]})" for y in Y_value])
                        scheduler = "_"
                else:
                    scheduler = ", ".join([str(x[0]) if isinstance(x, tuple) else str(x) for x in X_value]) if X_type == "Scheduler" else \
                        ", ".join([str(y[0]) if isinstance(y, tuple) else str(y) for y in Y_value]) if Y_type == "Scheduler" else scheduler[0]

                # Denoise
                denoise = ", ".join(map(str, X_value)) if X_type == "Denoise" else ", ".join(
                    map(str, Y_value)) if Y_type == "Denoise" else round(denoise,3)

                # Check if ascore is None
                if ascore is None:
                    pos_ascore = neg_ascore = None
                else:
                    # Ascore+
                    pos_ascore = (", ".join(map(str, X_value)) if X_type == "Ascore+"
                                  else ", ".join(map(str, Y_value)) if Y_type == "Ascore+" else round(ascore[0],3))
                    # Ascore-
                    neg_ascore = (", ".join(map(str, X_value)) if X_type == "Ascore-"
                                  else ", ".join(map(str, Y_value)) if Y_type == "Ascore-" else round(ascore[1],3))

                #..........................................PRINTOUTS....................................................
                print(f"(X) {X_type}")
                print(f"(Y) {Y_type}")
                print(f"img_count: {len(X_value)*len(Y_value)}")
                print(f"img_dims: {i_height} x {i_width}")
                print(f"plot_dim: {num_cols} x {num_rows}")
                print(f"ckpt: {ckpt_name if ckpt_name is not None else ''}")
                if clip_skip and not is_dit:
                    print(f"clip_skip: {clip_skip}")
                if sampler_type == "sdxl":
                    if refiner_clip_skip == "_":
                        print(f"refiner(clipskip): {refiner_name if refiner_name is not None else ''}")
                    else:
                        print(f"refiner: {refiner_name if refiner_name is not None else ''}")
                        print(f"refiner_clip_skip: {refiner_clip_skip if refiner_clip_skip is not None else ''}")
                        print(f"+ascore: {pos_ascore if pos_ascore is not None else ''}")
                        print(f"-ascore: {neg_ascore if neg_ascore is not None else ''}")
                if lora_name:
                    print(f"lora: {lora_name}")
                if lora_wt:
                    print(f"lora_wt: {lora_wt}")
                if lora_model_str:
                    print(f"lora_mstr: {lora_model_str}")
                if lora_clip_str:
                    print(f"lora_cstr: {lora_clip_str}")
                if vae_name:
                    print(f"vae:  {vae_name}")
                if sampler_type == "advanced":
                    print(f"add_noise: {add_noise}")
                print(f"seed: {seed}")
                print(f"steps: {steps}")
                if sampler_type == "advanced":
                    print(f"start_at_step: {start_at_step}")
                    print(f"end_at_step: {end_at_step}")
                    print(f"return_noise: {return_with_leftover_noise}")
                if sampler_type == "sdxl":
                    print(f"start_at_step: {start_at_step}")
                    if X_type == "Refiner On/Off":
                        print(f"refine_at_percent: {X_value[0]}")
                    elif Y_type == "Refiner On/Off":
                        print(f"refine_at_percent: {Y_value[0]}")
                    else:
                        print(f"refine_at_step: {end_at_step}")
                print(f"cfg: {cfg}")
                if scheduler == "_":
                    print(f"sampler(scheduler): {sampler_name}")
                else:
                    print(f"sampler: {sampler_name}")
                    print(f"scheduler: {scheduler}")
                if sampler_type == "regular":
                    print(f"denoise: {denoise}")

                if X_type == "Positive Prompt S/R" or Y_type == "Positive Prompt S/R":
                    positive_prompt = ", ".join([str(x[0]) if i == 0 else str(x[1]) for i, x in enumerate(
                        X_value)]) if X_type == "Positive Prompt S/R" else ", ".join(
                        [str(y[0]) if i == 0 else str(y[1]) for i, y in
                         enumerate(Y_value)]) if Y_type == "Positive Prompt S/R" else positive_prompt
                    print(f"+prompt_s/r: {positive_prompt}")

                if X_type == "Negative Prompt S/R" or Y_type == "Negative Prompt S/R":
                    negative_prompt = ", ".join([str(x[0]) if i == 0 else str(x[1]) for i, x in enumerate(
                        X_value)]) if X_type == "Negative Prompt S/R" else ", ".join(
                        [str(y[0]) if i == 0 else str(y[1]) for i, y in
                         enumerate(Y_value)]) if Y_type == "Negative Prompt S/R" else negative_prompt
                    print(f"-prompt_s/r: {negative_prompt}")


            # ______________________________________________________________________________________________________
            def adjusted_font_size(text, initial_font_size, i_width):
                font = _wm_load_label_font(initial_font_size)
                text_width = font.getlength(text)

                if text_width > (i_width * 0.9):
                    scaling_factor = 0.9  # A value less than 1 to shrink the font size more aggressively
                    new_font_size = int(initial_font_size * (i_width / text_width) * scaling_factor)
                else:
                    new_font_size = initial_font_size

                return new_font_size

            # ______________________________________________________________________________________________________

            def rearrange_list_A(arr, num_cols, num_rows):
                new_list = []
                for i in range(num_rows):
                    for j in range(num_cols):
                        index = j * num_rows + i
                        new_list.append(arr[index])
                return new_list

            def rearrange_list_B(arr, num_rows, num_cols):
                new_list = []
                for i in range(num_rows):
                    for j in range(num_cols):
                        index = i * num_cols + j
                        new_list.append(arr[index])
                return new_list

            # Extract plot dimensions
            num_rows = max(len(Y_value) if Y_value is not None else 0, 1)
            num_cols = max(len(X_value) if X_value is not None else 0, 1)

            # Flip X & Y results back if flipped earlier (for Checkpoint/LoRA For loop optimizations)
            if flip_xy == True:
                X_type, Y_type = Y_type, X_type
                X_value, Y_value = Y_value, X_value
                X_label, Y_label = Y_label, X_label
                num_rows, num_cols = num_cols, num_rows
                image_pil_list = rearrange_list_A(image_pil_list, num_rows, num_cols)
            else:
                image_pil_list = rearrange_list_B(image_pil_list, num_rows, num_cols)
                image_tensor_list = rearrange_list_A(image_tensor_list, num_cols, num_rows)
                latent_list = rearrange_list_A(latent_list, num_cols, num_rows)

            # Extract final image dimensions
            i_height, i_width = image_tensor_list[0].shape[1], image_tensor_list[0].shape[2]

            # Print XY Plot Results
            print_plot_variables(X_type, Y_type, X_value, Y_value, add_noise, seed,  steps, start_at_step, end_at_step,
                                 return_with_leftover_noise, cfg, sampler_name, scheduler, denoise, vae_name, ckpt_name,
                                 clip_skip, refiner_name, refiner_clip_skip, ascore, lora_stack,
                                 sampler_type, num_rows, num_cols, i_height, i_width)

            # Concatenate the 'samples' and 'noise_mask' tensors along the first dimension (dim=0)
            keys = latent_list[0].keys()
            result = {}
            for key in keys:
                tensors = [d[key] for d in latent_list]
                result[key] = torch.cat(tensors, dim=0)
            latent_list = result

            # Store latent_list as last latent
            ###update_value_by_id("latent", my_unique_id, latent_list)

            # Calculate the dimensions of the white background image
            border_size_top = i_width // 15

            # Longest Y-label length
            if len(Y_label) > 0:
                Y_label_longest = max(len(s) for s in Y_label)
            else:
                # Handle the case when the sequence is empty
                Y_label_longest = 0  # or any other appropriate value

            Y_label_scale = min(Y_label_longest + 4,24) / 24

            if Y_label_orientation == "Vertical":
                border_size_left = border_size_top
            else:  # Assuming Y_label_orientation is "Horizontal"
                # border_size_left is now min(i_width, i_height) plus 20% of the difference between the two
                border_size_left = min(i_width, i_height) + int(0.2 * abs(i_width - i_height))
                border_size_left = int(border_size_left * Y_label_scale)

            # Modify the border size, background width and x_offset initialization based on Y_type and Y_label_orientation
            if Y_type == "Nothing":
                bg_width = num_cols * i_width + (num_cols - 1) * grid_spacing
                x_offset_initial = 0
            else:
                if Y_label_orientation == "Vertical":
                    bg_width = num_cols * i_width + (num_cols - 1) * grid_spacing + 3 * border_size_left
                    x_offset_initial = border_size_left * 3
                else:  # Assuming Y_label_orientation is "Horizontal"
                    bg_width = num_cols * i_width + (num_cols - 1) * grid_spacing + border_size_left
                    x_offset_initial = border_size_left

            # Modify the background height based on X_type
            if X_type == "Nothing":
                bg_height = num_rows * i_height + (num_rows - 1) * grid_spacing
                y_offset = 0
            else:
                bg_height = num_rows * i_height + (num_rows - 1) * grid_spacing + 3 * border_size_top
                y_offset = border_size_top * 3

            # Create the white background image
            background = Image.new('RGBA', (int(bg_width), int(bg_height)), color=(255, 255, 255, 255))

            for row in range(num_rows):

                # Initialize the X_offset
                x_offset = x_offset_initial

                for col in range(num_cols):
                    # Calculate the index for image_pil_list
                    index = col * num_rows + row
                    img = image_pil_list[index]

                    # Paste the image
                    background.paste(img, (x_offset, y_offset))

                    if row == 0 and X_type != "Nothing":
                        # Assign text
                        text = X_label[col]

                        # Add the corresponding X_value as a label above the image
                        initial_font_size = int(48 * img.width / 512)
                        font_size = adjusted_font_size(text, initial_font_size, img.width)
                        label_height = int(font_size*1.5)

                        # Create a white background label image
                        label_bg = Image.new('RGBA', (img.width, label_height), color=(255, 255, 255, 0))
                        d = ImageDraw.Draw(label_bg)

                        # Create the font object
                        font = _wm_load_label_font(font_size)

                        # Calculate the text size and the starting position
                        _, _, text_width, text_height = d.textbbox([0,0], text, font=font)
                        text_x = (img.width - text_width) // 2
                        text_y = (label_height - text_height) // 2

                        # Add the text to the label image
                        d.text((text_x, text_y), text, fill='black', font=font)

                        # Calculate the available space between the top of the background and the top of the image
                        available_space = y_offset - label_height

                        # Calculate the new Y position for the label image
                        label_y = available_space // 2

                        # Paste the label image above the image on the background using alpha_composite()
                        background.alpha_composite(label_bg, (x_offset, label_y))

                    if col == 0 and Y_type != "Nothing":
                        # Assign text
                        text = Y_label[row]

                        # Add the corresponding Y_value as a label to the left of the image
                        if Y_label_orientation == "Vertical":
                            initial_font_size = int(48 * i_width / 512)  # Adjusting this to be same as X_label size
                            font_size = adjusted_font_size(text, initial_font_size, i_width)
                        else:  # Assuming Y_label_orientation is "Horizontal"
                            initial_font_size = int(48 *  (border_size_left/Y_label_scale) / 512)  # Adjusting this to be same as X_label size
                            font_size = adjusted_font_size(text, initial_font_size,  int(border_size_left/Y_label_scale))

                        # Create a white background label image
                        label_bg = Image.new('RGBA', (img.height, int(font_size*1.2)), color=(255, 255, 255, 0))
                        d = ImageDraw.Draw(label_bg)

                        # Create the font object
                        font = _wm_load_label_font(font_size)

                        # Calculate the text size and the starting position
                        _, _, text_width, text_height = d.textbbox([0,0], text, font=font)
                        text_x = (img.height - text_width) // 2
                        text_y = (font_size - text_height) // 2

                        # Add the text to the label image
                        d.text((text_x, text_y), text, fill='black', font=font)

                        # Rotate the label_bg 90 degrees counter-clockwise only if Y_label_orientation is "Vertical"
                        if Y_label_orientation == "Vertical":
                            label_bg = label_bg.rotate(90, expand=True)

                        # Calculate the available space between the left of the background and the left of the image
                        available_space = x_offset - label_bg.width

                        # Calculate the new X position for the label image
                        label_x = available_space // 2

                        # Calculate the Y position for the label image based on its orientation
                        if Y_label_orientation == "Vertical":
                            label_y = y_offset + (img.height - label_bg.height) // 2
                        else:  # Assuming Y_label_orientation is "Horizontal"
                            label_y = y_offset + img.height - (img.height - label_bg.height) // 2

                        # Paste the label image to the left of the image on the background using alpha_composite()
                        background.alpha_composite(label_bg, (label_x, label_y))

                    # Update the x_offset
                    x_offset += img.width + grid_spacing

                # Update the y_offset
                y_offset += img.height + grid_spacing

            xy_plot_image = pil2tensor(background)

         # Generate the preview_images
        preview_images = PreviewImage().save_images(xy_plot_image)["ui"]["images"]

        # Generate output_images
        output_images = torch.stack([tensor.squeeze() for tensor in image_tensor_list])

        # Set the output_image the same as plot image defined by 'xyplot_as_output_image'
        if xyplot_as_output_image == True:
            output_images = xy_plot_image

        # "XY Plot" output pin: carry the stitched grid when an XY plot ran, otherwise
        # fall back to the normal images so the pin is always a valid IMAGE.
        if xy_plot_image is None:
            xy_plot_image = output_images

        # Print cache if set to true
        if cache_models == "True":
            print_loaded_objects_entries(xyplot_id, prompt)

        print("-" * 40)  # Print an empty line followed by a separator line

        if sampler_type == "sdxl":
            sdxl_tuple = original_model, original_clip, original_positive, original_negative,\
                original_refiner_model, original_refiner_clip, original_refiner_positive, original_refiner_negative
            result = (sdxl_tuple, None, None, latent_list, optional_vae, output_images, xy_plot_image, "")
        else:
            result = (original_model, original_positive, original_negative, latent_list, optional_vae, output_images, xy_plot_image, "")
        return {"ui": {"images": preview_images}, "result": result}

#=======================================================================================================================
# WindMix KSampler Adv (Efficient)
class Wind_KSamplerAdvanced(Wind_KSampler):

    @classmethod
    def INPUT_TYPES(cls):
        return {"required":
                    {"model": ("MODEL",),
                     "add_noise": (["enable", "disable"],),
                     "noise_seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                     "steps": ("INT", {"default": 20, "min": 1, "max": 10000}),
                     "cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 100.0}),
                     "sampler_name": (comfy.samplers.KSampler.SAMPLERS,),
                     "scheduler": (windmix_schedulers(),),
                     "positive": ("CONDITIONING",),
                     "negative": ("CONDITIONING",),
                     "latent_image": ("LATENT",),
                     "start_at_step": ("INT", {"default": 0, "min": 0, "max": 10000}),
                     "end_at_step": ("INT", {"default": 10000, "min": 0, "max": 10000}),
                     "return_with_leftover_noise": (["disable", "enable"],),
                     "preview_method": (["auto", "latent2rgb", "taesd", "none"],),
                     "vae_decode": (["true", "true (tiled)", "false", "output only", "output only (tiled)"],),
                     },
                "optional": {"optional_vae": ("VAE",),
                             "script": ("SCRIPT",), },
                "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO", "my_unique_id": "UNIQUE_ID", },
                }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "CONDITIONING", "LATENT", "VAE", "IMAGE", "IMAGE", "STRING",)
    RETURN_NAMES = ("model", "positive", "negative", "latent", "vae", "image", "XY Plot", "生成信息",)
    OUTPUT_NODE = True
    FUNCTION = "sample_adv"
    CATEGORY = "⚡ WindMix/🚀 效率节点"

    def sample_adv(self, model, add_noise, noise_seed, steps, cfg, sampler_name, scheduler, positive, negative,
               latent_image, start_at_step, end_at_step, return_with_leftover_noise, preview_method, vae_decode,
               prompt=None, extra_pnginfo=None, my_unique_id=None, optional_vae=(None,), script=None):

        return super().sample(model, noise_seed, steps, cfg, sampler_name, scheduler, positive, negative,
               latent_image, preview_method, vae_decode, denoise=1.0, prompt=prompt, extra_pnginfo=extra_pnginfo, my_unique_id=my_unique_id,
               optional_vae=optional_vae, script=script, add_noise=add_noise, start_at_step=start_at_step,end_at_step=end_at_step,
                       return_with_leftover_noise=return_with_leftover_noise,sampler_type="advanced")

########################################################################################################################
# Common XY Plot Functions/Variables
XYPLOT_LIM = 15 #XY Plot default axis size limit
XYPLOT_DEF = 3  #XY Plot default batch count
CKPT_EXTENSIONS = LORA_EXTENSIONS = ['.safetensors', '.ckpt']
VAE_EXTENSIONS = ['.safetensors', '.ckpt', '.pt']
try:
    xy_batch_default_path = os.path.abspath(os.sep) + "example_folder"
except Exception:
    xy_batch_default_path = ""

def generate_floats(batch_count, first_float, last_float):
    if batch_count > 1:
        interval = (last_float - first_float) / (batch_count - 1)
        return [round(first_float + i * interval, 3) for i in range(batch_count)]
    else:
        return [first_float] if batch_count == 1 else []

def generate_ints(batch_count, first_int, last_int):
    if batch_count > 1:
        interval = (last_int - first_int) / (batch_count - 1)
        values = [int(first_int + i * interval) for i in range(batch_count)]
    else:
        values = [first_int] if batch_count == 1 else []
    values = list(set(values))  # Remove duplicates
    values.sort()  # Sort in ascending order
    return values

def get_batch_files(directory_path, valid_extensions, include_subdirs=False):
    batch_files = []

    try:
        if include_subdirs:
            # Using os.walk to get files from subdirectories
            for dirpath, dirnames, filenames in os.walk(directory_path):
                for file in filenames:
                    if any(file.endswith(ext) for ext in valid_extensions):
                        batch_files.append(os.path.join(dirpath, file))
        else:
            # Previous code for just the given directory
            batch_files = [os.path.join(directory_path, f) for f in os.listdir(directory_path) if
                           os.path.isfile(os.path.join(directory_path, f)) and any(
                               f.endswith(ext) for ext in valid_extensions)]
    except Exception as e:
        print(f"Error while listing files in {directory_path}: {e}")

    return batch_files

def print_xy_values(xy_type, xy_value, xy_name):
    print("===== XY Value Returns =====")
    print(f"{xy_name} Values:")
    print("- Type:", xy_type)
    print("- Entries:", xy_value)
    print("============================")

########################################################################################################################
# WindMix helper: load a separated-file DiT model (unet + clip + vae) with flow-matching sampling.
# Shared by the DiT loader and the XY-Plot engine's DiT model-swap branch.
########################################################################################################################
def _windmix_dit_load(unet_name, clip_name, vae_name, model_family, shift, clip_type="QWEN_IMAGE"):
    # Cache key: every argument that affects the loaded DiT model must be part of the key,
    # otherwise two XY cells with different shifts or clip_types would incorrectly reuse each other.
    cache_key = (unet_name, clip_name, vae_name, model_family, float(shift), clip_type)

    # Search the shared loaded_objects cache first. When found we return clones so that
    # per-cell LoRA/shift patches don't mutate the cached base model.
    for entry in loaded_objects["dit"]:
        if entry[:6] == cache_key:
            _, _, _, _, _, _, cached_model, cached_clip, cached_vae, _ = entry
            return cached_model.clone(), cached_clip.clone(), cached_vae

    unet_path = folder_paths.get_full_path("diffusion_models", unet_name)
    model = comfy.sd.load_diffusion_model(unet_path, model_options={})

    # shift=0 means "trust the model's own sampling config" (same as ComfyUI's native Load Diffusion Model).
    # Only override the shift when the user explicitly sets a value > 0.
    if shift and shift > 0:
        try:
            model.model.model_sampling.set_parameters(shift=float(shift))
        except Exception as e:
            print(f"[WindMix] DiT loader could not set shift on {type(model.model.model_sampling).__name__}: {e}")
            class _MS(comfy.model_sampling.ModelSamplingFlux, comfy.model_sampling.CONST):
                pass
            ms = _MS(model.model.model_config)
            ms.set_parameters(float(shift))
            model.add_object_patch("model_sampling", ms)

    clip_type_enum = Wind_DiTEfficientLoader._resolve_clip_type(clip_type)
    if clip_type_enum is None:
        family_cfg = Wind_DiTEfficientLoader.FAMILY_CONFIG.get(model_family, Wind_DiTEfficientLoader.FAMILY_CONFIG["Generic DiT"])
        clip_type_enum = Wind_DiTEfficientLoader._resolve_clip_type(family_cfg["clip_type"]) or comfy.sd.CLIPType.STABLE_DIFFUSION
    clip_path = folder_paths.get_full_path("text_encoders", clip_name)
    clip = comfy.sd.load_clip(ckpt_paths=[clip_path],
                              embedding_directory=folder_paths.get_folder_paths("embeddings"),
                              clip_type=clip_type_enum, model_options={})

    if vae_name and vae_name != "None":
        vae = comfy.sd.VAE(sd=comfy.utils.load_torch_file(folder_paths.get_full_path("vae", vae_name)))
    else:
        vae = None

    # Keep a modest cache of recently loaded DiT base models. This avoids reloading the same
    # UNet+CLIP+VAE from disk for every XY cell when the model axis is fixed and only LoRA
    # or prompt is varied. The base model/clip are cloned on retrieval so cached entries stay clean.
    loaded_objects["dit"].append(cache_key + (model, clip, vae, []))
    _DIT_CACHE_LIMIT = 5
    while len(loaded_objects["dit"]) > _DIT_CACHE_LIMIT:
        loaded_objects["dit"].pop(0)

    try:
        _ms = model.model.model_sampling
        _ms_shift = getattr(_ms, "shift", "n/a")
        _ms_name = type(_ms).__name__
        _mdtype = next(model.model.parameters()).dtype
    except Exception as _e:
        _ms_shift, _ms_name, _mdtype = "n/a", "n/a", "n/a"
        print(f"[WindMix DBG] _windmix_dit_load introspect error: {_e}")
    print(f"[WindMix DBG] _windmix_dit_load: unet={unet_name} unet_path={unet_path} "
          f"clip_name={clip_name} clip_path={clip_path} clip_type_enum={clip_type_enum} "
          f"vae_name={vae_name} shift_arg={shift} model_sampling={_ms_name} model_shift={_ms_shift} model_dtype={_mdtype}")
    return model, clip, vae

########################################################################################################################
# NODE MAPPING

# --- WindMix: non-XY helper nodes (moved back from the XY block) ---

########################################################################################################################
# Noise Sources & Seed Variations
# https://github.com/shiimizu/ComfyUI_smZNodes
# https://github.com/chrisgoringe/cg-noise

########################################################################################################################
########################################################################################################################
########################################################################################################################
# WindMix DiT Efficient Loader  (WindMix addition — separated-file DiT models: Anima / Z-Image / ZiB / Krea-2)
#
# Efficiency's stock "Efficient Loader" only understands bundled checkpoints, so it cannot load the new
# DiT models that ship as three separate files (diffusion_models / text_encoders / vae). This loader
# loads them separately, picks the right CLIP type per family, applies a flow-matching ModelSampling,
# and returns the SAME tuple shape as the regular loader (incl. a DEPENDENCIES blob) so it drops
# straight into KSampler (Efficient) / KSampler Adv. (Efficient) and the XY-Plot engine.
#
# The dependencies tuple mirrors the regular loader's 16 positions, then appends:
#   index 16 -> is_dit (True)     index 17 -> clip_name     index 18 -> model_family
# The stock XY engine ignores those extras, so the regular loader path is untouched.
########################################################################################################################
class Wind_DiTEfficientLoader:

    # Per-family defaults. clip_type is stored lower-case and mapped to comfy.sd.CLIPType at runtime.
    FAMILY_CONFIG = {
        "Anima": {
            "clip_type": "qwen_image",
            "clip_name": "qwen_3_06b_base.safetensors",
            "vae_name": "qwen_image_vae.safetensors",
        },
        "Z-Image": {
            "clip_type": "lumina2",
            "clip_name": "qwen_3_4b.safetensors",
            "vae_name": "Z-Image_clear_vae.safetensors",
        },
        "Krea-2": {
            "clip_type": "krea2",
            "clip_name": "qwen3vl_4b_fp8_scaled.safetensors",
            "vae_name": "qwen_image_vae.safetensors",
        },
        "Generic DiT": {
            "clip_type": "flux",
            "clip_name": None,
            "vae_name": None,
        },
    }

    CLIP_TYPE_ALIASES = {
        "qwen": "QWEN_IMAGE",
        "sd": "STABLE_DIFFUSION",
        "sdxl": "STABLE_DIFFUSION",
        "sd3": "SD3",
        "flux": "FLUX",
        "lumina": "LUMINA2",
    }

    @classmethod
    def _resolve_clip_type(cls, value):
        """Map a lower-case/aliased clip_type string to a comfy.sd.CLIPType enum."""
        if not value or value == "Auto":
            return None
        upper = cls.CLIP_TYPE_ALIASES.get(value, value).upper()
        return getattr(comfy.sd.CLIPType, upper, None)

    @classmethod
    def INPUT_TYPES(cls):
        clip_type_options = ["Auto"] + [t.name.lower() for t in comfy.sd.CLIPType]
        return {"required": {
            "model_family": (list(cls.FAMILY_CONFIG.keys()), {"default": "Anima"}),
            "clip_type": (clip_type_options, {"default": "Auto",
                                              "tooltip": "Auto=按 model_family 自动选择；手动选择时覆盖自动配置（全部小写）"}),
            "unet_name": (folder_paths.get_filename_list("diffusion_models"),),
            "clip_name": (["Auto"] + folder_paths.get_filename_list("text_encoders"),
                          {"default": "Auto", "tooltip": "Auto=按 model_family 自动选择默认 text_encoder"}),
            "vae_name": (["Auto", "None"] + folder_paths.get_filename_list("vae"),
                         {"default": "Auto", "tooltip": "Auto=按 model_family 自动选择默认 VAE；None=不使用 VAE"}),
            "shift": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 0.01,
                                 "tooltip": "Flow-matching shift。0=使用模型默认配置；>0 时强制覆盖模型推荐的 shift。"}),
            "lora_name": (["None"] + folder_paths.get_filename_list("loras"),),
            "lora_model_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            "lora_clip_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            "positive": ("STRING", {"default": "CLIP_POSITIVE", "multiline": True}),
            "negative": ("STRING", {"default": "CLIP_NEGATIVE", "multiline": True}),
            "resolution_preset": (RESOLUTION_PRESETS, {"default": "13:19_832,1216"}),
            "自定义宽": ("INT", {"default": 832, "min": 64, "max": MAX_RESOLUTION, "step": 8}),
            "自定义高": ("INT", {"default": 1216, "min": 64, "max": MAX_RESOLUTION, "step": 8}),
            "互换宽高": ("BOOLEAN", {"default": False, "label_on": "开启", "label_off": "关闭", "tooltip": "Swap width/height"}),
            "batch_size": ("INT", {"default": 1, "min": 1, "max": 262144}),
        },
            "optional": {"lora_stack": ("LORA_STACK", ),},
            "hidden": {"prompt": "PROMPT", "my_unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("MODEL", "CONDITIONING", "CONDITIONING", "LATENT", "VAE", "CLIP", "DEPENDENCIES",)
    RETURN_NAMES = ("model", "positive", "negative", "latent", "vae", "clip", "dependencies",)
    FUNCTION = "ditloader"
    CATEGORY = "⚡ WindMix/🚀 效率节点"

    def ditloader(self, model_family, unet_name, clip_name, vae_name, shift,
                  clip_type,
                  lora_name, lora_model_strength, lora_clip_strength,
                  positive, negative, resolution_preset,
                  自定义宽, 自定义高, 互换宽高, batch_size,
                  lora_stack=None, prompt=None, my_unique_id=None):

        globals_cleanup(prompt)

        # Resolve resolution preset.  "自定义" keeps the manual width/height fields and optionally swaps them.
        preset_w, preset_h = parse_resolution_preset(resolution_preset, 互换宽高)
        width = preset_w if preset_w is not None else 自定义宽
        height = preset_h if preset_h is not None else 自定义高
        if 互换宽高 and preset_w is None:
            width, height = height, width

        # Resolve Auto values against the selected model family.
        family_cfg = self.FAMILY_CONFIG.get(model_family, self.FAMILY_CONFIG["Generic DiT"])
        if clip_type == "Auto":
            clip_type = family_cfg["clip_type"]
        if clip_name == "Auto":
            clip_name = family_cfg["clip_name"]
        if vae_name == "Auto":
            vae_name = family_cfg["vae_name"] if family_cfg["vae_name"] is not None else "None"

        # Empty latent
        latent = torch.zeros([batch_size, 4, height // 8, width // 8]).cpu()

        get_cache_numbers("DiT Efficient Loader")  # keep cache counters consistent

        # 1) Diffusion model (unet)
        unet_path = folder_paths.get_full_path("diffusion_models", unet_name)
        model = comfy.sd.load_diffusion_model(unet_path, model_options={})

        # 2) Flow-matching sampling schedule
        # shift=0 means "trust the model's own sampling config" (same as ComfyUI's native Load Diffusion Model).
        # Only override the shift when the user explicitly sets a value > 0.
        if shift and shift > 0:
            try:
                model.model.model_sampling.set_parameters(shift=float(shift))
            except Exception as e:
                print(f"[WindMix] DiT loader could not set shift on {type(model.model.model_sampling).__name__}: {e}")
                class ModelSamplingAdvanced(comfy.model_sampling.ModelSamplingFlux, comfy.model_sampling.CONST):
                    pass
                model_sampling = ModelSamplingAdvanced(model.model.model_config)
                model_sampling.set_parameters(float(shift))
                model.add_object_patch("model_sampling", model_sampling)

        # 3) CLIP (text encoder) — type chosen freely by the user (full ComfyUI CLIPType list)
        clip_type_enum = self._resolve_clip_type(clip_type)
        if clip_type_enum is None:
            clip_type_enum = comfy.sd.CLIPType.STABLE_DIFFUSION
        clip_path = folder_paths.get_full_path("text_encoders", clip_name)
        clip = comfy.sd.load_clip(ckpt_paths=[clip_path],
                                  embedding_directory=folder_paths.get_folder_paths("embeddings"),
                                  clip_type=clip_type_enum, model_options={})

        # 4) VAE
        if vae_name == "None" or vae_name is None:
            vae = None
        else:
            vae = comfy.sd.VAE(sd=comfy.utils.load_torch_file(folder_paths.get_full_path("vae", vae_name)))

        # 5) Optional LoRA(s) — supports both the single lora_name widget AND a lora_stack input.
        #    The stack is compatible with other plugins' LoRA stacks: each item may be a
        #    (name, model_strength) 2-tuple (no clip strength) or (name, model_strength, clip_strength) 3-tuple.
        lora_items = []
        if lora_name != "None":
            lora_items.append((lora_name, lora_model_strength, lora_clip_strength))
        if lora_stack:
            lora_items.extend(lora_stack)

        lora_params = lora_items if lora_items else None

        for lora_item in lora_items:
            if not isinstance(lora_item, (list, tuple)) or len(lora_item) < 2:
                print(f"[WindMix] DiT loader: skipping malformed LoRA stack entry: {lora_item!r}")
                continue
            ln = lora_item[0]
            lm_str = lora_item[1]
            lc_str = lora_item[2] if len(lora_item) > 2 else lm_str  # 2-tuple → reuse model strength for clip
            lora_path = ln if os.path.isabs(ln) else folder_paths.get_full_path("loras", ln)
            if lora_path is None:
                print(f"[WindMix] DiT loader: LoRA '{ln}' not found, skipped.")
                continue
            lora = comfy.utils.load_torch_file(lora_path, safe_load=True)
            model, clip = comfy.sd.load_lora_for_models(model, clip, lora, lm_str, lc_str)

        # 6) Encode prompts using ComfyUI's native CLIPTextEncode path.
        #    This bypasses encode_prompts / bnk_adv_encode, which were designed for
        #    SD1.5/SDXL advanced weighting and can subtly alter DiT conditioning.
        positive_encoded = CLIPTextEncode().encode(clip, positive)[0]
        negative_encoded = CLIPTextEncode().encode(clip, negative)[0]

        # 7) Dependencies (16 stock positions mirrored, then DiT extras)
        #    Note: index 3 is the legacy `clip_skip` slot. DiT text encoders (Qwen/T5) do NOT
        #    support CLIP last-layer skip, so we store None here instead of the old hardcoded -1.
        #    The KSampler's clip_skip consumers are made None/non-tuple safe below.
        dependencies = (vae_name, unet_name, clip, None, None, None, None,
                        positive, negative, "none", "comfy", None,
                        width, height, lora_params, None,
                        True, clip_name, model_family, shift, clip_type)

        print_loaded_objects_entries(my_unique_id, prompt)

        return (model, positive_encoded, negative_encoded, {"samples": latent}, vae, clip, dependencies,)

########################################################################################################################
# WindMix XY Input: Model (DiT/UNet)  (WindMix addition — swaps the diffusion model for XY plots)
#
# Produces an "XY" of type "DiT Model" carrying (unet_name, clip_name, vae_name) tuples. The KSampler
# (Efficient) XY engine reads this and, when the source loader is a DiT loader, reloads the unet/clip/vae
# via separated-file loading instead of load_checkpoint.
########################################################################################################################
# WindMix "⚡ 保存图像" node
# Ported from ComfyUI-ZML-Image's ZML_SaveImageWithMetadata (zml-保存图像 A1111).
# Changes: renamed to avoid collision, default save path -> ./WM/%Y-%m-%d, default filename -> WM-%H%M%S.
# Consumes the "生成信息" STRING emitted by the WindMix Efficient KSampler(s).
class Wind_SaveImageWithMetadata:
    def __init__(self):
        self.output_dir = folder_paths.get_output_directory()
        self.type, self.prefix_append, self.compress_level = "output", "", 4

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "图像": ("IMAGE", {"tooltip": "输入要保存的图像"}),
                "元数据保存格式": (["A1111数据+工作流", "仅工作流", "仅A1111数据", "不保存任何信息"],
                                  {"tooltip": "A1111数据+工作流模式下，会将正面提示词自动注入到文本块，以适配其它图像节点。"}),
                "保存路径": ("STRING", {"default": "./WM/%Y-%m-%d", "tooltip": "支持时间代码 (如 %Y-%m-%d)，./ 代表 output 目录"}),
                "文件名": ("STRING", {"default": "WM-%H%M%S", "tooltip": "文件名模式，支持时间代码"}),
            },
            "optional": {
                "生成信息": ("STRING", {"forceInput": True, "tooltip": "来自效率采样器的生成信息"}),
                "正面提示词": ("STRING", {"multiline": False, "default": "",
                                       "tooltip": "提示词保存优先级：1. 此输入框 -> 2. 生成信息中的 positive"}),
                "负面提示词": ("STRING", {"multiline": False, "default": "",
                                       "tooltip": "提示词保存优先级：1. 此输入框 -> 2. 生成信息中的 negative"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES, FUNCTION, OUTPUT_NODE, CATEGORY = (), "save_images", True, "⚡ WindMix/🧩 杂项"

    def save_images(self, 图像, 元数据保存格式="A1111数据+工作流",
                   保存路径="./WM/%Y-%m-%d", 文件名="WM-%H%M%S", 生成信息=None,
                   正面提示词="", 负面提示词="", prompt=None, extra_pnginfo=None):
        now = datetime.datetime.now()
        try:
            p_filled, f_filled = now.strftime(保存路径), now.strftime(文件名)
        except Exception:
            p_filled, f_filled = 保存路径, 文件名
        if p_filled.startswith("./"):
            abs_path = os.path.join(self.output_dir, p_filled[2:])
        else:
            abs_path = p_filled if os.path.isabs(p_filled) else os.path.join(self.output_dir, p_filled)
        full_path_prefix = os.path.join(abs_path, f_filled)
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            full_path_prefix, self.output_dir, 图像[0].shape[1], 图像[0].shape[0])

        parameters_text = ""
        need_a1111 = "A111" in 元数据保存格式
        need_workflow = "工作流" in 元数据保存格式
        save_text_block = "A1111数据+工作流" == 元数据保存格式

        if need_a1111:
            base_info = json.loads(生成信息) if 生成信息 else {}
            f_pos = 正面提示词 if 正面提示词.strip() else base_info.get("positive", "")
            f_neg = 负面提示词 if 负面提示词.strip() else base_info.get("negative", "")

            # --- text block logic (must run before LoRA append) ---
            if save_text_block:
                pos_for_block = f_pos
                lora_regex = re.compile(r"<lora:([^:>]+)(?::([^:>]+))?(?::([^:>]+))?>")
                pos_for_block = lora_regex.sub("", pos_for_block)
                pos_lines = pos_for_block.split('\n')
                pos_for_block = "\n".join([line for line in pos_lines if not line.strip().startswith("LoRA JSON:")])
                json_regex = re.compile(r"\[\s*\{\s*\"lora_name\".*?\}\s*\]", re.DOTALL)
                pos_for_block = json_regex.sub("", pos_for_block)
                pos_for_block = re.sub(r",\s*,", ",", pos_for_block).strip(" ,")
            else:
                pos_for_block = f_pos
            # ----------------------------------------

            # Standard A1111 <lora:name:weight> tags sourced from the generation-info JSON.
            loras_in = base_info.get("loras") if isinstance(base_info, dict) else None
            if loras_in:
                try:
                    lora_tags = []
                    for _l in loras_in:
                        _nm = _l.get("lora_name")
                        if not _nm:
                            continue
                        _nm = str(_nm).replace(".safetensors", "").replace(".ckpt", "")
                        _wt = _l.get("weight", 1.0)
                        lora_tags.append(f"<lora:{_nm}:{_wt}>")
                    if lora_tags:
                        _l_text = ", ".join(lora_tags)
                        f_pos = f"{f_pos}, {_l_text}" if f_pos else _l_text
                except Exception:
                    pass

            lines = [f_pos] if f_pos else []
            n_part = f"Negative prompt: {f_neg}" if f_neg else ""
            if n_part:
                lines.append(n_part)

            params = [f"Steps: {base_info.get('steps', '')}", f"Sampler: {base_info.get('sampler', '')}",
                      f"Schedule type: {base_info.get('scheduler', '')}", f"CFG scale: {base_info.get('cfg', '')}",
                      f"Seed: {base_info.get('seed', '')}",
                      f"Size: {base_info.get('width', '')}x{base_info.get('height', '')}"]
            m_name = base_info.get('model', '')
            if m_name:
                params.append(f"Model: {m_name.replace('.safetensors', '').replace('.ckpt', '')}")
            if base_info.get('denoise') and base_info['denoise'] < 1.0:
                params.append(f"Denoising strength: {base_info['denoise']}")
            params.append(f"Generation time: {now.strftime('%Y-%m-%d %H:%M:%S')}")
            lines.append(", ".join([p for p in params if p.strip()]))
            parameters_text = "\n".join(lines)

        results = []
        for image in 图像:
            img = Image.fromarray(np.clip(255. * image.cpu().numpy(), 0, 255).astype(np.uint8))
            metadata = PngInfo()
            if need_a1111 and parameters_text:
                metadata.add_text("parameters", parameters_text)
            if need_workflow:
                if prompt:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo:
                    for x in extra_pnginfo:
                        metadata.add_text(x, json.dumps(extra_pnginfo[x]))

            if save_text_block and pos_for_block:
                metadata.add_text(DEFAULT_TEXT_BLOCK_KEY, pos_for_block, zip=True)

            fname = f"{filename}.png" if len(图像) == 1 else f"{filename}_{counter}.png"
            img.save(os.path.join(full_output_folder, fname), pnginfo=metadata, compress_level=self.compress_level)
            results.append({"filename": fname, "subfolder": subfolder, "type": self.type})
            counter += 1
        return {"ui": {"images": results}}

########################################################################################################################

NODE_CLASS_MAPPINGS = {
    # --- WindMix efficiency nodes (Wind_ prefix differentiates from upstream TSC_ plugin) ---
    "⚡ Efficient Loader": Wind_EfficientLoader,
    "⚡ KSampler (Efficient)": Wind_KSampler,
    "⚡ KSampler Adv. (Efficient)": Wind_KSamplerAdvanced,
    # --- WindMix additions: separated-file DiT models + DiT model XY axis ---
    "⚡ DiT Efficient Loader": Wind_DiTEfficientLoader,
    # --- WindMix image output with A1111 metadata ---
    "⚡ 保存图像": Wind_SaveImageWithMetadata,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "⚡ Efficient Loader": "🚀 XL 效率加载器",
    "⚡ KSampler (Efficient)": "🚀 效率采样器",
    "⚡ KSampler Adv. (Efficient)": "🚀 效率采样器(高级)",
    "⚡ DiT Efficient Loader": "🚀 DiT 效率加载器",
    "⚡ 保存图像": "🚀 保存图像",
}

