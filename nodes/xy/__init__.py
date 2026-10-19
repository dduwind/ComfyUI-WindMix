# WindMix: XY subsystem package.
#
# Holds all "XY Plot" related nodes:
#   - xy_plot_nodes.py : ⚡ XY Plot + ⚡ XY Input: LoRA Plot
#                       (moved here from wind_efficiency_nodes.py)
#   NOTE: the old "⚡ XY Input: LoRA" node was removed; "📊 XY 输入: LoRA" is now
#         WindMixLoraXY (nodes/windmix_xy_inputs.py), which emits the same XY tuple.
#   NOTE: the old "⚡ XY Input: UNet Model" node was removed too — its DiT Model axis
#         is covered by "📊 XY 输入: UNet" (WindMixUNetXY); the object-direct
#         UNet2 (WindMixUNet3XY) and Checkpoint inputs also live in nodes/windmix_xy_inputs.py.
#

# NOTE: The standalone "⚡ XY 图表拼接" node was removed. The ⚡ KSampler
# (Efficient) / ⚡ KSampler Adv. (Efficient) nodes now expose the stitched grid
# directly via their "XY Plot" IMAGE output pin, so a separate concatenation
# node is redundant.
#
# This package is imported by the plugin root __init__.py; its node mappings
# are merged into the parent NODE_CLASS_MAPPINGS below.

import importlib

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

for module_name in ["xy_plot_nodes"]:
    try:
        mod = importlib.import_module(f".{module_name}", __name__)
        NODE_CLASS_MAPPINGS.update(getattr(mod, "NODE_CLASS_MAPPINGS", {}))
        NODE_DISPLAY_NAME_MAPPINGS.update(getattr(mod, "NODE_DISPLAY_NAME_MAPPINGS", {}))
    except Exception as e:
        print(f"[WindMix/xy] ERROR loading {module_name}: {e}")
