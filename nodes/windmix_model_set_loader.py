# nodes/windmix_model_set_loader.py
# 模型组合加载器：分别选择 unet / clip / vae，像 checkpoint 一样一次性输出
# MODEL + CLIP + VAE。参考 ComfyUI-TJ_NODE 的 model_set_loader 实现思路。
#
# - Model: diffusion_models / unet / GGUF（自动选 UNETLoader / UnetLoaderGGUF）
# - Clip:  text_encoders / clip（CLIPLoader，type 自动探测，支持 GGUF CLIP）
# - VAE:   vae（VAELoader）
# - 每个槽位选 [none] 则该路输出为 None

import folder_paths

NONE_VALUE = "[none]"
DEFAULT_CLIP_TYPE = "stable_diffusion"
MODEL_DTYPES = ["default", "fp8_e4m3fn", "fp8_e5m2", "fp16", "bf16"]
CLIP_DTYPES = ["default", "fp8_e4m3fn", "fp8_e5m2", "fp16", "bf16"]


def _list_folder(kind):
    try:
        names = list(folder_paths.get_filename_list(kind) or [])
        return [NONE_VALUE] + names if names else [NONE_VALUE]
    except Exception:
        return [NONE_VALUE]


def _model_names():
    names = []
    for kind in ("unet", "diffusion_models", "gguf"):
        try:
            names.extend(folder_paths.get_filename_list(kind) or [])
        except Exception:
            pass
    seen = set()
    deduped = []
    for n in names:
        if n not in seen:
            seen.add(n)
            deduped.append(n)
    return [NONE_VALUE] + deduped if deduped else [NONE_VALUE]


def _clip_names():
    names = []
    for kind in ("text_encoders", "clip"):
        try:
            names.extend(folder_paths.get_filename_list(kind) or [])
        except Exception:
            pass
    seen = set()
    deduped = []
    for n in names:
        if n not in seen:
            seen.add(n)
            deduped.append(n)
    return [NONE_VALUE] + deduped if deduped else [NONE_VALUE]


def _vae_names():
    return _list_folder("vae")


def _clip_loader_types():
    try:
        import nodes as _nodes
        cls = _nodes.NODE_CLASS_MAPPINGS.get("CLIPLoader")
        if cls is None:
            return [DEFAULT_CLIP_TYPE]
        spec = cls.INPUT_TYPES().get("required", {}).get("type", [None])[0]
        if isinstance(spec, (list, tuple)):
            return [str(v) for v in spec if v] or [DEFAULT_CLIP_TYPE]
    except Exception:
        pass
    return [DEFAULT_CLIP_TYPE]


def _call_comfy_node(class_name, **kwargs):
    import inspect
    import nodes as _nodes
    if class_name not in _nodes.NODE_CLASS_MAPPINGS:
        raise RuntimeError(f"所需的 ComfyUI 节点 '{class_name}' 不可用。")
    cls = _nodes.NODE_CLASS_MAPPINGS[class_name]
    node = cls()
    fn_name = getattr(cls, "FUNCTION", None)
    if not fn_name:
        raise RuntimeError(f"ComfyUI 节点 '{class_name}' 未定义 FUNCTION。")
    fn = getattr(node, fn_name)
    sig = inspect.signature(fn)
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
        return fn(**kwargs)
    return fn(**{k: v for k, v in kwargs.items() if k in sig.parameters})


def _dedupe_list(seq):
    seen = set()
    out = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _load_model(name, weight_dtype="default"):
    import nodes as _nodes

    # GGUF 模型走 UnetLoaderGGUF（与 dtype 无关）
    if str(name).lower().endswith(".gguf"):
        if "UnetLoaderGGUF" in _nodes.NODE_CLASS_MAPPINGS:
            return _call_comfy_node("UnetLoaderGGUF", unet_name=name)[0]
        raise RuntimeError("GGUF 模型需要 UnetLoaderGGUF 节点（ComfyUI-GGUF）。")

    # UNETLoader：先试指定 dtype，失败回退 default
    dtypes_to_try = [weight_dtype] if weight_dtype != "default" else []
    dtypes_to_try.append("default")
    errors = []
    for dtype in _dedupe_list(dtypes_to_try):
        try:
            return _call_comfy_node("UNETLoader", unet_name=name, weight_dtype=dtype)[0]
        except Exception as e:
            errors.append(f"UNETLoader/{dtype}: {e}")

    # 兜底：直接 comfy.sd 加载
    for kind in ("unet", "diffusion_models"):
        try:
            full_path = folder_paths.get_full_path_or_raise(kind, name)
            import comfy.sd
            return comfy.sd.load_diffusion_model(full_path)
        except Exception as e:
            errors.append(f"comfy.sd/{kind}: {e}")

    raise RuntimeError(f"模型加载失败: {name} | " + " | ".join(errors))


def _load_clip(name, clip_type, weight_dtype="default"):
    errors = []
    types_to_try = []
    if clip_type and clip_type != NONE_VALUE:
        types_to_try.append(str(clip_type))
    for t in _clip_loader_types():
        if t not in types_to_try:
            types_to_try.append(t)

    # GGUF CLIP（与 dtype 无关）
    if str(name).lower().endswith(".gguf"):
        import nodes as _nodes
        if "CLIPLoaderGGUF" in _nodes.NODE_CLASS_MAPPINGS:
            return _call_comfy_node("CLIPLoaderGGUF", clip_name=name)[0]

    for t in types_to_try:
        try:
            return _call_comfy_node("CLIPLoader", clip_name=name, type=t, weight_dtype=weight_dtype)[0]
        except Exception:
            try:
                return _call_comfy_node("CLIPLoader", clip_name=name, type=t)[0]
            except Exception as e:
                errors.append(f"{t}: {e}")
    try:
        return _call_comfy_node("CLIPLoader", clip_name=name)[0]
    except Exception as e:
        errors.append(f"no-type: {e}")
        raise RuntimeError("CLIP 加载失败，已尝试: " + " | ".join(errors))


def _load_vae(name):
    return _call_comfy_node("VAELoader", vae_name=name)[0]


class WindMixModelSetLoader:
    """分别选择 unet / clip / vae，像 checkpoint 一样一次性输出
    MODEL + CLIP + VAE。

    - Model: diffusion_models / unet / GGUF（自动选 UNETLoader / UnetLoaderGGUF）
    - Clip:  text_encoders / clip（CLIPLoader，type 自动探测，支持 GGUF CLIP）
    - VAE:   vae（VAELoader）
    - 每个槽位选 [none] 则该路输出为 None
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_name":  (_model_names(), {"default": NONE_VALUE,
                               "tooltip": "UNET / diffusion_models / GGUF 模型。选 [none] 则 MODEL 输出为空。"}),
                "model_dtype": (MODEL_DTYPES,   {"default": "default",
                               "tooltip": "UNETLoader 的 weight_dtype（GGUF 忽略）。"}),
                "clip_name":   (_clip_names(),  {"default": NONE_VALUE,
                               "tooltip": "text_encoders / clip。选 [none] 则 CLIP 输出为空。"}),
                "clip_type":   (_clip_loader_types(), {"default": DEFAULT_CLIP_TYPE,
                               "tooltip": "CLIPLoader 的 type 参数（GGUF CLIP 忽略）。"}),
                "clip_dtype":  (CLIP_DTYPES,    {"default": "default",
                               "tooltip": "CLIPLoader 的 weight_dtype（支持该参数的版本才生效；GGUF CLIP 忽略）。"}),
                "vae_name":    (_vae_names(),   {"default": NONE_VALUE,
                               "tooltip": "VAE。选 [none] 则 VAE 输出为空。"}),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    RETURN_NAMES = ("MODEL", "CLIP", "VAE")
    FUNCTION = "load"
    CATEGORY = "⚡ WindMix/🚀 效率节点"

    @classmethod
    def VALIDATE_INPUTS(cls, **kwargs):
        return True

    def load(self, model_name=NONE_VALUE, model_dtype="default",
             clip_name=NONE_VALUE, clip_type=DEFAULT_CLIP_TYPE, clip_dtype="default",
             vae_name=NONE_VALUE):
        model = None
        clip = None
        vae = None

        if model_name and model_name != NONE_VALUE:
            model = _load_model(model_name, weight_dtype=model_dtype)

        if clip_name and clip_name != NONE_VALUE:
            clip = _load_clip(clip_name, clip_type, weight_dtype=clip_dtype)

        if vae_name and vae_name != NONE_VALUE:
            vae = _load_vae(vae_name)

        return (model, clip, vae)


NODE_CLASS_MAPPINGS = {
    "⚡ Model Set Loader": WindMixModelSetLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "⚡ Model Set Loader": "🚀 模型组合加载器",
}
