import locale


def _is_chinese_locale():
    value = locale.getdefaultlocale()[0] or ""
    return value.lower().startswith("zh")


class WMPromptOutput:
    CATEGORY = "⚡ WindMix/🎨 Prompt Studio"
    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "encode"
    DESCRIPTION = "Prompt Studio merged output node with an in-canvas editor for positive and negative prompts."

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "placeholder": "Positive prompt" if not _is_chinese_locale() else "正向提示词",
                    },
                ),
                "negative": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "placeholder": "Negative prompt" if not _is_chinese_locale() else "反向提示词",
                    },
                ),
            }
        }

    def encode(self, positive, negative):
        return (positive, negative)


class WMPromptPositiveOutput:
    CATEGORY = "⚡ WindMix/🎨 Prompt Studio"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("positive",)
    FUNCTION = "encode"
    DESCRIPTION = "Single positive prompt output with Prompt Studio editor support."

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "positive": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "placeholder": "Positive prompt" if not _is_chinese_locale() else "正向提示词",
                    },
                )
            }
        }

    def encode(self, positive):
        return (positive,)


class WMPromptNegativeOutput:
    CATEGORY = "⚡ WindMix/🎨 Prompt Studio"
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("negative",)
    FUNCTION = "encode"
    DESCRIPTION = "Single negative prompt output with Prompt Studio editor support."

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "negative": (
                    "STRING",
                    {
                        "multiline": True,
                        "default": "",
                        "placeholder": "Negative prompt" if not _is_chinese_locale() else "反向提示词",
                    },
                )
            }
        }

    def encode(self, negative):
        return (negative,)


NODE_CLASS_MAPPINGS = {
    "WMPromptOutput": WMPromptOutput,
    "WMPromptPositiveOutput": WMPromptPositiveOutput,
    "WMPromptNegativeOutput": WMPromptNegativeOutput,
}


if _is_chinese_locale():
    NODE_DISPLAY_NAME_MAPPINGS = {
        "WMPromptOutput": "🎨 Prompt Studio 双提示词输出",
        "WMPromptPositiveOutput": "🎨 Prompt Studio 正向输出",
        "WMPromptNegativeOutput": "🎨 Prompt Studio 反向输出",
    }
else:
    NODE_DISPLAY_NAME_MAPPINGS = {
        "WMPromptOutput": "🎨 Prompt Studio Output",
        "WMPromptPositiveOutput": "🎨 Prompt Studio Positive Output",
        "WMPromptNegativeOutput": "🎨 Prompt Studio Negative Output",
    }


