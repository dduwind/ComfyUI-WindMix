# WindMix Prompt Groups — split a multiline prompt into groups.
#
# Two modes (COMBO `mode`):
#   - "separator" (default): group mode. Multi-line groups are delimited by a
#     separator line. ANY line containing `separator` is treated as a group
#     boundary and consumed (its surrounding text is not preserved). A group
#     may span multiple lines. If no separator appears, the whole text is one
#     group.
#   - "line": per-line mode, replicating Easy-Use `easy promptLine`. Each line
#     (optionally skipping blank lines via `remove_empty_lines`) becomes one
#     group = one batch run.
#
# Each group is emitted as one list element (OUTPUT_IS_LIST), so downstream
# nodes run once per group.

class WindMix_PromptGroups:
    """Split a multiline prompt into groups: by separator line or per-line."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": ("COMBO", {"default": "separator",
                                   "options": ["separator", "line"],
                                   "tooltip": "separator=按分隔行分组(多行归一组); line=逐行(每行一次batch, 复刻Easy-Use promptLine)"}),
                "separator": ("STRING", {"multiline": False, "default": "---",
                                         "tooltip": "Any line containing this text is a group boundary (consumed). 仅在 'separator' 模式可用。"}),
                "remove_empty_lines": ("BOOLEAN", {"default": True,
                                                   "tooltip": "跳过空行。仅在 'line' 模式可用（复刻 Easy-Use promptLine）；'separator' 模式始终丢弃空组。"}),
                "prompt": ("STRING", {"multiline": True, "default": ""}),
            },
        }

    RETURN_TYPES = ("STRING", "COMBO")
    RETURN_NAMES = ("string", "combo")
    OUTPUT_IS_LIST = (True, True)
    FUNCTION = "execute"
    CATEGORY = "⚡ WindMix/🧩 杂项"
    DESCRIPTION = "Split prompt into groups: by separator line (multi-line groups) or per-line (line mode = Easy-Use promptLine)."

    def execute(self, mode, separator, remove_empty_lines, prompt):
        if mode == "line":
            # Per-line mode: replicate Easy-Use promptLine exactly.
            # remove_empty_lines 仅在此模式生效。
            lines = [ln.rstrip("\r") for ln in prompt.split("\n")]
            if remove_empty_lines:
                lines = [ln for ln in lines if ln.strip()]
            rows = lines
        else:
            # Separator group mode (original behavior).
            # 始终丢弃空组（strip 后为空），不依赖 remove_empty_lines。
            sep = (separator or "").strip()
            groups, current = [], []
            for raw in prompt.split("\n"):
                line = raw.rstrip("\r")  # tolerate Windows CRLF pastes
                # contains match: any line that contains the separator is a boundary
                if sep and sep in line:
                    groups.append("\n".join(current).strip())
                    current = []
                else:
                    current.append(line)
            groups.append("\n".join(current).strip())
            rows = [g for g in groups if g]

        if not rows:
            rows = [""]

        return (rows, rows)


NODE_CLASS_MAPPINGS = {
    "WindMix_PromptGroups": WindMix_PromptGroups,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "WindMix_PromptGroups": "🧩 Prompt Groups",
}
