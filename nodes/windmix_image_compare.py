import os
import shutil
import folder_paths
from server import PromptServer
from aiohttp import web
from nodes import PreviewImage


class WMImageCompare:
    """WindMix port of Flex-Pack's Flex Image Compare.

    Shows the incoming image batch in an interactive compare/slider/diff widget
    and lets the user save individual frames (or all) into the output folder.
    Branded WM_ instead of Flex_, lives under the 杂项 (misc) category.

    NOTE: deliberately does NOT inherit from ComfyUI's built-in PreviewImage.
    The aki-v3 node tree special-cases PreviewImage/SaveImage subclasses into the
    built-in "image" group; keeping this a plain custom node makes it show up
    under the WindMix extension alongside the other ⚡ WindMix nodes. The temp
    saver is reused via PreviewImage().save_images(...).
    """

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "wm_compare/comparison"}),
            },
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO"},
        }

    RETURN_TYPES = ()
    FUNCTION = "compare_images_preview"
    OUTPUT_NODE = True
    CATEGORY = "⚡ WindMix/🧩 杂项"

    def compare_images_preview(self, images, filename_prefix="wm_compare/comparison", prompt=None, extra_pnginfo=None):
        # Temp frames are stashed under wm_temp so they don't collide with the
        # original Flex-Pack's flex_temp when both plugins are installed.
        # Reuse PreviewImage's saver without subclassing it (see class note).
        saved = PreviewImage().save_images(images, "wm_temp", prompt, extra_pnginfo)
        return {"ui": {"bypassed_images": saved["ui"]["images"], "prefix": [filename_prefix]}}


@PromptServer.instance.routes.post("/wm_compare/save")
async def wm_compare_save(request):
    post_data = await request.json()
    filename = post_data.get("filename")
    prefix = post_data.get("prefix", "wm_compare/comparison")

    temp_dir = folder_paths.get_temp_directory()
    src_path = os.path.join(temp_dir, filename)

    if not os.path.exists(src_path):
        return web.json_response({"status": "error", "message": "File not found in temp"}, status=404)

    full_output_folder, file_prefix, counter, subfolder, _ = folder_paths.get_save_image_path(
        prefix, folder_paths.get_output_directory(), 1, 1
    )

    # Required trailing underscore so ComfyUI's scanner recognizes the file
    new_filename = f"{file_prefix}_{counter:05d}_.png"
    dst_path = os.path.join(full_output_folder, new_filename)

    os.makedirs(full_output_folder, exist_ok=True)
    shutil.copy2(src_path, dst_path)

    return web.json_response({"status": "success", "file": new_filename})


NODE_CLASS_MAPPINGS = {"WM Image Compare": WMImageCompare}
NODE_DISPLAY_NAME_MAPPINGS = {"WM Image Compare": "🧩 图像对比"}
