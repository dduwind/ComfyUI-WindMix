# ComfyUI-WindMix — 预设文本节点
#
# 功能说明：
#   * 每行文本带独立的「标题」(title) 与「内容」(content)，而不是单一文本框。
#   * 预设文本管理器是独立的宽屏双栏页面（见 web/windmix_preset_manager.js），
#     目录由用户自建，预设可带预览图并压图落盘到插件目录。
#   * 全部数据通过隐藏控件 preset_text_data(JSON) 在前后端之间传递。
#
# 隐藏控件数据结构（v2：支持节点内文件夹）：
# {
#   "folders": [ {"id": str, "name": str, "entries": [ {"id","enabled","title","content"}, ... ]}, ... ],
#   "rootEntries": [ {"id": str, "enabled": bool, "title": str, "content": str}, ... ],
#   "separator": ",\\n\\n",
#   "randomEnabled": false,
#   "randomCount": 1
# }
# 文件夹仅用于前端组织，输出时 rootEntries 与所有文件夹内的启用行都参与拼接。
# （execute 同时兼容旧结构：直接 {"entries": [...]}。）

import json
import random


class WindMixPresetText:
    """⚡ 预设文本：可增删/拖拽/启停的多个文本行，按分隔符拼接成一个字符串。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 节点文本数据（JSON）。放 required 段，ComfyUI 才会自动建 widget 并序列化进 prompt、
                # 传入 execute；前端 onNodeCreated 会把它整体隐藏（数据由 DOM widget 维护，不暴露给用户）。
                # 注意：hidden 段里的自定义输入（非 UNIQUE_ID/EXTRA_PNGINFO 系统 token）前端不会建 widget，
                # 会导致 execute 收不到该参数。
                "preset_text_data": ("STRING", {"default": "{}", "multiline": True}),
            },
            "optional": {
                # 可选外部文本输入，连接到此节点后追加到结果末尾
                "可选输入": ("STRING", {"forceInput": True, "default": ""}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    CATEGORY = "⚡ WindMix/🎨 Prompt Studio"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "execute"

    @classmethod
    def IS_CHANGED(cls, preset_text_data="", **kwargs):
        # 仅「随机选择」模式返回 nan 强制每次重算，保证随机结果每次执行都变化；
        # 非随机模式返回数据指纹，让 ComfyUI 缓存正常生效——否则即使用户没开随机，
        # 每次出图也会强制重算本节点并使整条下游缓存失效。
        try:
            data = json.loads(preset_text_data) if isinstance(preset_text_data, str) else preset_text_data
        except (json.JSONDecodeError, TypeError):
            data = {}
        if isinstance(data, dict) and data.get("randomEnabled"):
            return float("nan")
        if isinstance(preset_text_data, str):
            return preset_text_data
        try:
            return json.dumps(data, ensure_ascii=False, sort_keys=True)
        except (TypeError, ValueError):
            return float("nan")

    def execute(self, preset_text_data, unique_id=None, extra_pnginfo=None, 可选输入=None):
        try:
            data = json.loads(preset_text_data) if isinstance(preset_text_data, str) else preset_text_data
        except (json.JSONDecodeError, TypeError):
            data = {}

        if not isinstance(data, dict):
            data = {}

        # 顶层顺序：优先按 items 有序序列（entry/folder 可交错，顺序即输出顺序）；
        # 无 items 时兼容旧结构（rootEntries 在前 + folders 在后）。
        # 文件夹只是前端组织方式，输出时所有启用行都参与拼接，
        # 文件夹整体启用开关(enabled=false)跳过整个文件夹。
        items = data.get("items")
        entries = []
        if isinstance(items, list) and items:
            for it in items:
                if not isinstance(it, dict):
                    continue
                if it.get("kind") == "folder":
                    if it.get("enabled", True) and isinstance(it.get("entries"), list):
                        entries.extend(it["entries"])
                elif it.get("kind") == "entry":
                    entries.append(it)
        else:
            if isinstance(data.get("rootEntries"), list):
                entries.extend(data["rootEntries"])
            elif isinstance(data.get("entries"), list):
                # 旧结构兜底（仅有扁平 entries 数组）
                entries = data["entries"]
            if isinstance(data.get("folders"), list):
                for f in data["folders"]:
                    if isinstance(f, dict) and f.get("enabled", True) and isinstance(f.get("entries"), list):
                        entries.extend(f["entries"])
        if not isinstance(entries, list):
            entries = []

        # 收集启用且内容非空的文本行
        enabled_parts = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if not entry.get("enabled", False):
                continue
            content = entry.get("content", "")
            if content is None:
                content = ""
            content = str(content)
            if content.strip():
                enabled_parts.append(content)

        # 随机选择
        random_enabled = data.get("randomEnabled", False)
        try:
            random_count = max(1, min(int(data.get("randomCount", 1)), len(enabled_parts)))
        except (ValueError, TypeError):
            random_count = 1

        if random_enabled and enabled_parts:
            try:
                final_parts = random.sample(enabled_parts, random_count)
            except ValueError:
                final_parts = enabled_parts
        else:
            final_parts = enabled_parts

        # 外部输入追加到末尾
        if 可选输入 and str(可选输入).strip():
            final_parts.append(str(可选输入).strip())

        # 处理分隔符中的换行符（前端写入的是字面量 \\n）
        separator = data.get("separator", ",\\n\\n")
        if not isinstance(separator, str):
            separator = ",\\n\\n"
        processed_sep = separator.replace("\\n", "\n")

        output_text = processed_sep.join(final_parts)
        return (output_text,)


NODE_CLASS_MAPPINGS = {
    "WindMixPresetText": WindMixPresetText,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WindMixPresetText": "🎨 预设文本",
}
