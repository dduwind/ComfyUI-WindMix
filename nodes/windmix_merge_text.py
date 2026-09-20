# nodes/windmix_merge_text.py
# 合并文本（动态）节点：参考 ComfyUI-ZML-Image 的 ZML_MergeText 实现思路。
#
# 特性：
# - 最多 20 个可选 STRING 输入（文本1..文本20），均为 forceInput（只能连线、不显示文本框）。
#   在 ComfyUI 中连接一个后，会自动出现下一个空闲接口，实现"动态"增删。
# - 分隔符可调，支持 \n 写法（输入里的 \n 会被转成真实换行）。
# - 输出1 合并文本：非空文本按分隔符拼接，并做标点清理（中文逗号→英文、合并连续逗号、
#   清理多余 BREAK/开头逗号，且保护 (weight) 权重表达式）。
# - 输出2 文本列表：非空文本的原始列表（无分隔符），可接需要列表的节点。
#
# 标点清理函数 format_punctuation_global 内联于此，使本模块不依赖 ZML 插件。

import re

MAX_INPUTS = 20


def format_punctuation_global(text):
    """全局标点格式化（独立于类）：
    1. 中文逗号→英文逗号
    2. 合并连续逗号
    3. 处理连续 BREAK
    4. 移除开头 BREAK
    5. 移除开头逗号
    6. 保护权重表达式 (...) 中的逗号
    """
    placeholders = []
    count = 0

    def replace_fn(match):
        nonlocal count
        placeholder = f"__WEIGHT_EXPR_{count}__"
        placeholders.append((placeholder, match.group(0)))
        count += 1
        return placeholder

    # 临时替换权重表达式（圆括号内内容），避免被逗号规则破坏
    text = re.sub(r'\((?:(?!\().)*?\)', replace_fn, text)

    # 1. 中文逗号→英文逗号
    text = text.replace('，', ',')

    # 2. 合并连续逗号（中/英）
    text = re.sub(r'[,，]+', ',', text)

    # 3. 处理连续 BREAK（逗号合并后即可正确处理 "BREAK,BREAK"）
    text = re.sub(r'(\bBREAK\b\s*,\s*)+(\bBREAK\b)', r'\2', text, flags=re.IGNORECASE)

    # 4. 移除开头的 BREAK（如 "BREAK, tag" -> "tag"）
    text = re.sub(r'^(\s*,\s*)*\bBREAK\b(\s*,\s*)*', '', text, count=1, flags=re.IGNORECASE)

    # 5. 移除开头的逗号
    text = re.sub(r'^,+', '', text)

    # 6. 恢复权重表达式
    for placeholder, expr in placeholders:
        text = text.replace(placeholder, expr)

    return text


class WindMixMergeText:
    """合并文本（动态）：将多个文本输入合并为一段，并输出非空文本的原始列表。
    参考 ComfyUI-ZML-Image 的 ZML_MergeText。"""

    @classmethod
    def INPUT_TYPES(cls):
        optional_inputs = {}
        for i in range(1, MAX_INPUTS + 1):
            optional_inputs[f"文本{i}"] = ("STRING", {"forceInput": True})
        return {
            "required": {
                "分隔符": ("STRING", {"multiline": False, "default": ",\n\n",
                         "tooltip": "用于拼接非空文本的分隔符。支持 \\n 写法表示换行。"}),
            },
            "optional": optional_inputs,
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("合并文本", "文本列表")
    OUTPUT_IS_LIST = (False, True)
    FUNCTION = "merge_text"
    CATEGORY = "⚡ WindMix/🎨 Prompt Studio"

    def merge_text(self, 分隔符, **kwargs):
        texts = []
        for i in range(1, MAX_INPUTS + 1):
            val = kwargs.get(f"文本{i}", "")
            texts.append(val or "")

        # 输出列表：仅非空文本
        non_empty_texts = [t for t in texts if t.strip()]

        # 分隔符里的 \n 转真实换行
        processed_separator = 分隔符.replace("\\n", "\n")

        # 合并文本（单值）
        combined = processed_separator.join(non_empty_texts)
        combined = format_punctuation_global(combined)

        return (combined, non_empty_texts)


NODE_CLASS_MAPPINGS = {
    "⚡ Prompt Studio Merge Text": WindMixMergeText,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "⚡ Prompt Studio Merge Text": "🎨 合并文本",
}
