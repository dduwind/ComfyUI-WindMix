"""
WindMix - 分辨率 (Resolution)
基于 ComfyUI-TJ_NODE 的 TJ_Resolution 搬运，去除 auto_set / ui_state，
输出 width·height·LATENT；UI 与计算在 web/windmix_resolution.js 完成。
"""

import torch


class WindMix_Resolution:
    """
    🧩 分辨率：通过 DOM UI 选择比例预设 / 自定义比例 / 自定义分辨率，
    输出 width、height 以及一个占位 LATENT（供下游节点直接使用）。
    """

    CATEGORY = "⚡ WindMix/🧩 杂项"
    FUNCTION = "run"
    RETURN_TYPES = ("INT", "INT", "LATENT")
    RETURN_NAMES = ("width", "height", "latent")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # JS DOM UI 填充的值（widget 由 JS 隐藏）
                "width":  ("INT", {"default": 1024, "min": 8, "max": 16384, "step": 8}),
                "height": ("INT", {"default": 1024, "min": 8, "max": 16384, "step": 8}),
            }
        }

    def run(self, width, height):
        w = max(8, int(width))
        h = max(8, int(height))
        # 占位 latent：4 通道，高宽各 /8（VAE 8x 下采样），1 帧
        latent = torch.zeros((1, 4, h // 8, w // 8))
        return (w, h, {"samples": latent})


NODE_CLASS_MAPPINGS = {
    "WindMix_Resolution": WindMix_Resolution,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WindMix_Resolution": "🧩 分辨率",
}
