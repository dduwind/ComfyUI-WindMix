# Lifted verbatim from ComfyUI-CRT-Nodes/py/Fancy_Timer_Node.py
# (https://github.com/PGCRT/CRT-Nodes). Display-only real-time timer node.
# The Python side is a no-op; all behaviour lives in web/fancy_timer_node.js.
#
# We expose a tiny HTTP route that serves font files from the plugin's
# top-level Font/ directory. ComfyUI's /extensions/ endpoint only serves the
# web/ subfolder, so the browser cannot otherwise reach Font/; the route
# <plugin>/Font/<file> is read directly from disk.

import os
from server import PromptServer
from aiohttp import web

@PromptServer.instance.routes.get("/windmix/font/{filename}")
async def windmix_serve_font(request):
    """Serve a font file from <plugin>/Font/ by filename (no path traversal)."""
    filename = request.match_info.get("filename", "")
    if not filename or ".." in filename or "/" in filename or "\\" in filename:
        return web.Response(status=400, text="invalid filename")
    plugin_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    font_path = os.path.join(plugin_root, "Font", filename)
    if not os.path.isfile(font_path):
        return web.Response(status=404, text="font not found")
    return web.FileResponse(font_path)


class FancyTimerNode:
    """
    A UI node that displays a real-time timer for the execution pipeline.
    This version is a display-only node with no outputs.
    """

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "execute"

    OUTPUT_NODE = True
    CATEGORY = "⚡ WindMix/🧩 杂项"

    def execute(self, **kwargs):
        return {}


NODE_CLASS_MAPPINGS = {
    "FancyTimerNode": FancyTimerNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FancyTimerNode": "🧩 Fancy Timer Node",
}
