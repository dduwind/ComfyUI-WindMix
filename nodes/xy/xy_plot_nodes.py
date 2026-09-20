# WindMix: XY plot nodes (moved out of efficiency_nodes.py)
# These nodes read a SCRIPT produced by the XY Plot node and drive the
# KSampler (Efficient) to generate an image grid. The stitched grid is now exposed
# directly by the KSampler nodes' "XY Plot" output pin (the old standalone
# "⚡ XY 图表拼接" node / xy_grid.py was removed).
from ..wind_utils import *   # error, extract_node_info, XY_Capsule, ...
from ..wind_efficiency_nodes import *  # XYPLOT_DEF, XYPLOT_LIM, xy_batch_default_path, torch, comfy, ...
import os

#=======================================================================================================================
# WindMix XY Plot
class Wind_XYplot:

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "grid_spacing": ("INT", {"default": 0, "min": 0, "max": 500, "step": 5}),
                    "xy_flip": (["False","True"],),
                    "y_label_orientation": (["Horizontal", "Vertical"],),
                    "cache_models": (["True", "False"],),
                    "ksampler_output_image": (["Images","Plot"],),},
                "optional": {
                    "dependencies": ("DEPENDENCIES", ),
                    "x": ("XY", ),
                    "y": ("XY", ),},
                "hidden": {"my_unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("SCRIPT",)
    RETURN_NAMES = ("script",)
    FUNCTION = "XYplot"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def XYplot(self, grid_spacing, xy_flip, y_label_orientation, cache_models, ksampler_output_image, my_unique_id,
               dependencies=None, x=None, y=None):

        # Unpack X & Y Tuples if connected
        if x != None:
            X_type, X_value  = x
        else:
            X_type = "Nothing"
            X_value = [""]
        if y != None:
            Y_type, Y_value = y
        else:
            Y_type = "Nothing"
            Y_value = [""]

        # If types are the same exit. If one isn't "Nothing", print error
        if X_type != "XY_Capsule" and (X_type == Y_type) and X_type not in ["Positive Prompt S/R", "Negative Prompt S/R"]:
            if X_type != "Nothing":
                print(f"{error('XY Plot Error:')} X and Y input types must be different.")
            return (None,)

        # Check that dependencies are connected for specific plot types
        encode_types = {
            "Checkpoint", "Refiner", "DiT Model",
            "LoRA", "LoRA Stacks", "LoRA Batch", "LoRA Wt", "LoRA MStr", "LoRA CStr",
            "Positive Prompt S/R", "Negative Prompt S/R",
            "AScore+", "AScore-",
            "Clip Skip", "Clip Skip (Refiner)"
        }

        if X_type in encode_types or Y_type in encode_types:
            if dependencies is None:  # Not connected
                print(f"{error('XY Plot Error:')} The dependencies input must be connected for certain plot types.")
                # Return None
                return (None,)

        # Check if both X_type and Y_type are special lora_types
        lora_types = {"LoRA Batch", "LoRA Wt", "LoRA MStr", "LoRA CStr"}
        if (X_type in lora_types and Y_type not in lora_types) or (Y_type in lora_types and X_type not in lora_types):
            print(f"{error('XY Plot Error:')} Both X and Y must be connected to use the 'LoRA Plot' node.")
            return (None,)

        # Do not allow LoRA and LoRA Stacks
        lora_types = {"LoRA", "LoRA Stacks"}
        if (X_type in lora_types and Y_type in lora_types):
            print(f"{error('XY Plot Error:')} X and Y input types must be different.")
            return (None,)

        # Clean Schedulers from Sampler data (if other type is Scheduler)
        if X_type == "Sampler" and Y_type == "Scheduler":
            # Clear X_value Scheduler's
            X_value = [(x[0], "") for x in X_value]
        elif Y_type == "Sampler" and X_type == "Scheduler":
            # Clear Y_value Scheduler's
            Y_value = [(y[0], "") for y in Y_value]

        # Embed information into "Scheduler" X/Y_values for text label
        if X_type == "Scheduler" and Y_type != "Sampler":
            # X_value second tuple value of each array entry = None
            X_value = [(x, None) for x in X_value]

        if Y_type == "Scheduler" and X_type != "Sampler":
            # Y_value second tuple value of each array entry = None
            Y_value = [(y, None) for y in Y_value]

        # Clean VAEs from Checkpoint data if other type is VAE
        if X_type == "Checkpoint" and Y_type == "VAE":
            # Clear X_value VAE's
            X_value = [(t[0], t[1], None) for t in X_value]
        elif Y_type == "VAE" and X_type == "Checkpoint":
            # Clear Y_value VAE's
            Y_value = [(t[0], t[1], None) for t in Y_value]

        # Flip X and Y
        if xy_flip == "True":
            X_type, Y_type = Y_type, X_type
            X_value, Y_value = Y_value, X_value
            
        # Define Ksampler output image behavior
        xyplot_as_output_image = ksampler_output_image == "Plot"

        # Pack xyplot tuple into its dictionary item under script
        script = {"xyplot": (X_type, X_value, Y_type, Y_value, grid_spacing, y_label_orientation, cache_models,
                        xyplot_as_output_image, my_unique_id, dependencies)}

        return (script,)

#=======================================================================================================================
# WindMix XY Plot: Seeds Values
class Wind_XYplot_SeedsBatch:

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "batch_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM}),},
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, batch_count):
        if batch_count == 0:
            return (None,)
        xy_type = "Seeds++ Batch"
        xy_value = list(range(batch_count))
        return ((xy_type, xy_value),)

#=======================================================================================================================
# WindMix XY Plot: Add/Return Noise
class Wind_XYplot_AddReturnNoise:

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "XY_type": (["add_noise", "return_with_leftover_noise"],)}
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, XY_type):
        type_mapping = {
            "add_noise": "AddNoise",
            "return_with_leftover_noise": "ReturnNoise"
        }
        xy_type = type_mapping[XY_type]
        xy_value = ["enable", "disable"]
        return ((xy_type, xy_value),)

#=======================================================================================================================
# WindMix XY Plot: Step Values
class Wind_XYplot_Steps:
    parameters = ["steps","start_at_step", "end_at_step", "refine_at_step"]
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "target_parameter": (cls.parameters,),
                "batch_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM}),
                "first_step": ("INT", {"default": 10, "min": 1, "max": 10000}),
                "last_step": ("INT", {"default": 20, "min": 1, "max": 10000}),
                "first_start_step": ("INT", {"default": 0, "min": 0, "max": 10000}),
                "last_start_step": ("INT", {"default": 10, "min": 0, "max": 10000}),
                "first_end_step": ("INT", {"default": 10, "min": 0, "max": 10000}),
                "last_end_step": ("INT", {"default": 20, "min": 0, "max": 10000}),
                "first_refine_step": ("INT", {"default": 10, "min": 0, "max": 10000}),
                "last_refine_step": ("INT", {"default": 20, "min": 0, "max": 10000}),
            }
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, target_parameter, batch_count, first_step, last_step, first_start_step, last_start_step,
                 first_end_step, last_end_step, first_refine_step, last_refine_step):

        if target_parameter == "steps":
            xy_type = "Steps"
            xy_first = first_step
            xy_last = last_step
        elif target_parameter == "start_at_step":
            xy_type = "StartStep"
            xy_first = first_start_step
            xy_last = last_start_step
        elif target_parameter == "end_at_step":
            xy_type = "EndStep"
            xy_first = first_end_step
            xy_last = last_end_step
        elif target_parameter == "refine_at_step":
            xy_type = "RefineStep"
            xy_first = first_refine_step
            xy_last = last_refine_step

        xy_value = generate_ints(batch_count, xy_first, xy_last)
        return ((xy_type, xy_value),) if xy_value else (None,)

#=======================================================================================================================
# WindMix XY Plot: CFG Values
class Wind_XYplot_CFG:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "batch_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM}),
                "first_cfg": ("FLOAT", {"default": 7.0, "min": 0.0, "max": 100.0}),
                "last_cfg": ("FLOAT", {"default": 9.0, "min": 0.0, "max": 100.0}),
            }
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, batch_count, first_cfg, last_cfg):
        xy_type = "CFG Scale"
        xy_value = generate_floats(batch_count, first_cfg, last_cfg)
        return ((xy_type, xy_value),) if xy_value else (None,)

#=======================================================================================================================
# WindMix XY Plot: Sampler & Scheduler Values
class Wind_XYplot_Sampler_Scheduler:
    parameters = ["sampler", "scheduler", "sampler & scheduler"]

    @classmethod
    def INPUT_TYPES(cls):
        samplers = ["None"] + comfy.samplers.KSampler.SAMPLERS
        schedulers = ["None"] + SCHEDULERS
        inputs = {
            "required": {
                "target_parameter": (cls.parameters,),
                "input_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM, "step": 1})
            }
        }
        for i in range(1, XYPLOT_LIM+1):
            inputs["required"][f"sampler_{i}"] = (samplers,)
            inputs["required"][f"scheduler_{i}"] = (schedulers,)

        return inputs

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, target_parameter, input_count, **kwargs):
        if target_parameter == "scheduler":
            xy_type = "Scheduler"
            schedulers = [kwargs.get(f"scheduler_{i}") for i in range(1, input_count + 1)]
            xy_value = [scheduler for scheduler in schedulers if scheduler != "None"]
        elif target_parameter == "sampler":
            xy_type = "Sampler"
            samplers = [kwargs.get(f"sampler_{i}") for i in range(1, input_count + 1)]
            xy_value = [(sampler, None) for sampler in samplers if sampler != "None"]
        else:
            xy_type = "Sampler"
            samplers = [kwargs.get(f"sampler_{i}") for i in range(1, input_count + 1)]
            schedulers = [kwargs.get(f"scheduler_{i}") for i in range(1, input_count + 1)]
            xy_value = [(sampler, scheduler if scheduler != "None" else None) for sampler,
            scheduler in zip(samplers, schedulers) if sampler != "None"]

        return ((xy_type, xy_value),) if xy_value else (None,)

#=======================================================================================================================
# WindMix XY Plot: Denoise Values
class Wind_XYplot_Denoise:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "batch_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM}),
                "first_denoise": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "last_denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, batch_count, first_denoise, last_denoise):
        xy_type = "Denoise"
        xy_value = generate_floats(batch_count, first_denoise, last_denoise)
        return ((xy_type, xy_value),) if xy_value else (None,)

#=======================================================================================================================
# WindMix XY Plot: VAE Values
class Wind_XYplot_VAE:

    modes = ["VAE Names", "VAE Batch"]

    @classmethod
    def INPUT_TYPES(cls):

        vaes = ["None", "Baked VAE"] + folder_paths.get_filename_list("vae")

        inputs = {
            "required": {
                        "input_mode": (cls.modes,),
                        "batch_path": ("STRING", {"default": xy_batch_default_path, "multiline": False}),
                        "subdirectories": ("BOOLEAN", {"default": False}),
                        "batch_sort": (["ascending", "descending"],),
                        "batch_max": ("INT", {"default": -1, "min": -1, "max": XYPLOT_LIM, "step": 1}),
                        "vae_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM, "step": 1})
            }
        }

        for i in range(1, XYPLOT_LIM+1):
            inputs["required"][f"vae_name_{i}"] = (vaes,)

        return inputs

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, input_mode, batch_path, subdirectories, batch_sort, batch_max, vae_count, **kwargs):

        xy_type = "VAE"

        if "Batch" not in input_mode:
            # Extract values from kwargs
            vaes = [kwargs.get(f"vae_name_{i}") for i in range(1, vae_count + 1)]
            xy_value = [vae for vae in vaes if vae != "None"]
        else:
            if batch_max == 0:
                return (None,)

            try:
                vaes = get_batch_files(batch_path, VAE_EXTENSIONS, include_subdirs=subdirectories)

                if not vaes:
                    print(f"{error('XY Plot Error:')} No VAE files found.")
                    return (None,)

                if batch_sort == "ascending":
                    vaes.sort()
                elif batch_sort == "descending":
                    vaes.sort(reverse=True)

                # Construct the xy_value using the obtained vaes
                xy_value = [vae for vae in vaes]

                if batch_max != -1:  # If there's a limit
                    xy_value = xy_value[:batch_max]

            except Exception as e:
                print(f"{error('XY Plot Error:')} {e}")
                return (None,)

        return ((xy_type, xy_value),) if xy_value else (None,)

#=======================================================================================================================
# WindMix XY Plot: Prompt S/R
class Wind_XYplot_PromptSR:

    @classmethod
    def INPUT_TYPES(cls):
        inputs = {
            "required": {
                "target_prompt": (["positive", "negative"],),
                "search_txt": ("STRING", {"default": "", "multiline": False}),
                "replace_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM-1}),
            }
        }

        # Dynamically add replace_X inputs
        for i in range(1, XYPLOT_LIM):
            replace_key = f"replace_{i}"
            inputs["required"][replace_key] = ("STRING", {"default": "", "multiline": False})

        return inputs

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, target_prompt, search_txt, replace_count, **kwargs):
        if search_txt == "":
            return (None,)

        if target_prompt == "positive":
            xy_type = "Positive Prompt S/R"
        elif target_prompt == "negative":
            xy_type = "Negative Prompt S/R"

        # Create base entry
        xy_values = [(search_txt, None)]

        if replace_count > 0:
            # Append additional entries based on replace_count
            xy_values.extend([(search_txt, kwargs.get(f"replace_{i+1}")) for i in range(replace_count)])

        return ((xy_type, xy_values),)

#=======================================================================================================================
# WindMix XY Plot: Aesthetic Score
class Wind_XYplot_AScore:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "target_ascore": (["positive", "negative"],),
                "batch_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM}),
                "first_ascore": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1000.0, "step": 0.01}),
                "last_ascore": ("FLOAT", {"default": 10.0, "min": 0.0, "max": 1000.0, "step": 0.01}),
            }
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, target_ascore, batch_count, first_ascore, last_ascore):
        if target_ascore == "positive":
            xy_type = "AScore+"
        else:
            xy_type = "AScore-"
        xy_value = generate_floats(batch_count, first_ascore, last_ascore)
        return ((xy_type, xy_value),) if xy_value else (None,)

#=======================================================================================================================
# WindMix XY Plot: Refiner On/Off
class Wind_XYplot_Refiner_OnOff:

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "refine_at_percent": ("FLOAT",{"default": 0.80, "min": 0.00, "max": 1.00, "step": 0.01})},
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, refine_at_percent):
        xy_type = "Refiner On/Off"
        xy_value = [refine_at_percent, 1]
        return ((xy_type, xy_value),)

#=======================================================================================================================
# WindMix XY Plot: Clip Skip
class Wind_XYplot_ClipSkip:

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "target_ckpt": (["Base","Refiner"],),
                "batch_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM}),
                "first_clip_skip": ("INT", {"default": -1, "min": -24, "max": -1, "step": 1}),
                "last_clip_skip": ("INT", {"default": -3, "min": -24, "max": -1, "step": 1}),
            },
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, target_ckpt, batch_count, first_clip_skip, last_clip_skip):
        if target_ckpt == "Base":
            xy_type = "Clip Skip"
        else:
            xy_type = "Clip Skip (Refiner)"
        xy_value = generate_ints(batch_count, first_clip_skip, last_clip_skip)
        return ((xy_type, xy_value),) if xy_value else (None,)

#=======================================================================================================================
# WindMix XY Plot: Checkpoint Values
class Wind_XYplot_Checkpoint:
    modes = ["Ckpt Names", "Ckpt Names+ClipSkip", "Ckpt Names+ClipSkip+VAE", "Checkpoint Batch"]
    @classmethod
    def INPUT_TYPES(cls):
        checkpoints = ["None"] + folder_paths.get_filename_list("checkpoints")
        vaes = ["Baked VAE"] + folder_paths.get_filename_list("vae")

        inputs = {
            "required": {
                        "target_ckpt": (["Base", "Refiner"],),
                        "input_mode": (cls.modes,),
                        "batch_path": ("STRING", {"default": xy_batch_default_path, "multiline": False}),
                        "subdirectories": ("BOOLEAN", {"default": False}),
                        "batch_sort": (["ascending", "descending"],),
                        "batch_max": ("INT", {"default": -1, "min": -1, "max": 50, "step": 1}),
                        "ckpt_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM, "step": 1})
            }
        }

        for i in range(1, XYPLOT_LIM+1):
            inputs["required"][f"ckpt_name_{i}"] = (checkpoints,)
            inputs["required"][f"clip_skip_{i}"] = ("INT", {"default": -1, "min": -24, "max": -1, "step": 1})
            inputs["required"][f"vae_name_{i}"] = (vaes,)

        return inputs

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, target_ckpt, input_mode, batch_path, subdirectories, batch_sort, batch_max, ckpt_count, **kwargs):

        # Define XY type
        xy_type = "Checkpoint" if target_ckpt == "Base" else "Refiner"

        if "Batch" not in input_mode:
            # Extract values from kwargs
            checkpoints = [kwargs.get(f"ckpt_name_{i}") for i in range(1, ckpt_count + 1)]
            clip_skips = [kwargs.get(f"clip_skip_{i}") for i in range(1, ckpt_count + 1)]
            vaes = [kwargs.get(f"vae_name_{i}") for i in range(1, ckpt_count + 1)]

            # Set None for Clip Skip and/or VAE if not correct modes
            for i in range(ckpt_count):
                if "ClipSkip" not in input_mode:
                    clip_skips[i] = None
                if "VAE" not in input_mode:
                    vaes[i] = None

            xy_value = [(checkpoint, clip_skip, vae) for checkpoint, clip_skip, vae in zip(checkpoints, clip_skips, vaes) if
                        checkpoint != "None"]
        else:
            if batch_max == 0:
                return (None,)

            try:
                ckpts = get_batch_files(batch_path, CKPT_EXTENSIONS, include_subdirs=subdirectories)

                if not ckpts:
                    print(f"{error('XY Plot Error:')} No Checkpoint files found.")
                    return (None,)

                if batch_sort == "ascending":
                    ckpts.sort()
                elif batch_sort == "descending":
                    ckpts.sort(reverse=True)

                # Construct the xy_value using the obtained ckpts
                xy_value = [(ckpt, None, None) for ckpt in ckpts]

                if batch_max != -1:  # If there's a limit
                    xy_value = xy_value[:batch_max]

            except Exception as e:
                print(f"{error('XY Plot Error:')} {e}")
                return (None,)

        return ((xy_type, xy_value),) if xy_value else (None,)

#=======================================================================================================================
# WindMix XY Plot: LoRA Batch (DISABLED)
class Wind_XYplot_LoRA_Batch:

    @classmethod
    def INPUT_TYPES(cls):

        return {"required": {
                "batch_path": ("STRING", {"default": xy_batch_default_path, "multiline": False}),
                "subdirectories": ("BOOLEAN", {"default": False}),
                "batch_sort": (["ascending", "descending"],),
                "batch_max": ("INT",{"default": -1, "min": -1, "max": XYPLOT_LIM, "step": 1}),
                "model_strength": ("FLOAT", {"default": 1.0, "min": -10.00, "max": 10.0, "step": 0.01}),
                "clip_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01})},
                "optional": {"lora_stack": ("LORA_STACK",)}
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, batch_path, subdirectories, batch_sort, model_strength, clip_strength, batch_max, lora_stack=None):
        if batch_max == 0:
            return (None,)

        xy_type = "LoRA Stacks"

        loras = get_batch_files(batch_path, LORA_EXTENSIONS, include_subdirs=subdirectories)

        if not loras:
            print(f"{error('XY Plot Error:')} No LoRA files found.")
            return (None,)

        if batch_sort == "ascending":
            loras.sort()
        elif batch_sort == "descending":
            loras.sort(reverse=True)

        # Construct the xy_value using the obtained loras
        xy_value = [[(lora, model_strength, clip_strength)] + (list(lora_stack) if lora_stack else []) for lora in loras]

        if batch_max != -1:  # If there's a limit
            xy_value = xy_value[:batch_max]

        return ((xy_type, xy_value),) if xy_value else (None,)

#=======================================================================================================================
# WindMix XY Plot: LoRA Values
# 简化版：固定「LoRA Names+Tags」风格，无模式切换。
# 保留 lora_stack 可选输入；clip 控件全部移除（clip_str 固定 1.0）。
class Wind_XYplot_LoRA:

    @classmethod
    def INPUT_TYPES(cls):
        loras = ["None"] + folder_paths.get_filename_list("loras")

        inputs = {
            "required": {
                "lora_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM, "step": 1}),
                "model_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
            }
        }

        for i in range(1, XYPLOT_LIM+1):
            inputs["required"][f"lora_name_{i}"] = (loras, {"default": "None"})
            inputs["required"][f"model_str_{i}"] = ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01})
            inputs["required"][f"tag_{i}"] = ("STRING", {"default": "", "multiline": False})

        # include_none 放到 INPUT_TYPES 字典最末尾——视觉上落在所有 Python widget 之后、
        # 紧挨 folder_btn（JS addWidget 默认末尾追加的按钮），无需 JS reorder。
        # ⚠️ 历史教训：JS 端 splice/unshift 重排 node.widgets 会导致序列化索引错位。
        inputs["required"]["include_none"] = ("BOOLEAN", {"default": True, "label": "添加无 LoRA 对比"})

        inputs["optional"] = {
            "lora_stack": ("LORA_STACK",)
        }
        return inputs

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, lora_count, model_strength, include_none=True, lora_stack=None, **kwargs):
        lora_stack = lora_stack if lora_stack else []

        loras = [kwargs.get(f"lora_name_{i}") for i in range(1, lora_count + 1)]
        model_strs = [kwargs.get(f"model_str_{i}", model_strength) for i in range(1, lora_count + 1)]
        tags = [kwargs.get(f"tag_{i}", "") for i in range(1, lora_count + 1)]

        # 4-tuple: (lora_name, model_str, clip_str, tag)。clip_str 固定 1.0（已移除 clip 控件）。
        # 第 4 个元素 (tag) 由 define_model 拼到正向提示词。
        items = [[(lora, model_str, 1.0, tag)] + lora_stack for lora, model_str, tag
                 in zip(loras, model_strs, tags) if lora != "None"]

        # 默认在第一格插入"无 LoRA"基线（include_none=True），便于与带 LoRA 的格子做对比；
        # 仅在存在非 None LoRA 时才加，避免"只有 None 列表"这种无意义空格子。
        if include_none and items:
            items.insert(0, [("None", model_strength, 1.0, "")] + lora_stack)

        return (("LoRA", items),)

#=======================================================================================================================
# WindMix XY Plot: LoRA Plot
class Wind_XYplot_LoRA_Plot:

    modes = ["X: LoRA Batch, Y: LoRA Weight",
             "X: LoRA Batch, Y: Model Strength",
             "X: LoRA Batch, Y: Clip Strength",
             "X: Model Strength, Y: Clip Strength",
            ]

    @classmethod
    def INPUT_TYPES(cls):
        loras = ["None"] + folder_paths.get_filename_list("loras")
        return {"required": {
                "input_mode": (cls.modes,),
                "lora_name": (loras,),
                "model_strength": ("FLOAT", {"default": 1.0, "min": -10.00, "max": 10.0, "step": 0.01}),
                "clip_strength": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01}),
                "X_batch_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM}),
                "X_batch_path": ("STRING", {"default": xy_batch_default_path, "multiline": False}),
                "X_subdirectories": ("BOOLEAN", {"default": False}),
                "X_batch_sort": (["ascending", "descending"],),
                "X_first_value": ("FLOAT", {"default": 0.0, "min": -10.00, "max": 10.0, "step": 0.01}),
                "X_last_value": ("FLOAT", {"default": 1.0, "min": -10.00, "max": 10.0, "step": 0.01}),
                "Y_batch_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM}),
                "Y_first_value": ("FLOAT", {"default": 0.0, "min": -10.00, "max": 10.0, "step": 0.01}),
                "Y_last_value": ("FLOAT", {"default": 1.0, "min": -10.00, "max": 10.0, "step": 0.01}),},
            "optional": {"lora_stack": ("LORA_STACK",)}
        }

    RETURN_TYPES = ("XY","XY",)
    RETURN_NAMES = ("x","y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def __init__(self):
        self.lora_batch = Wind_XYplot_LoRA_Batch()

    def generate_values(self, mode, X_or_Y, *args, **kwargs):
        result = self.lora_batch.xy_value(*args, **kwargs)

        if result and result[0]:
            xy_type, xy_value_list = result[0]

            # Adjust type based on the mode
            if "LoRA Weight" in mode:
                xy_type = "LoRA Wt"
            elif "Model Strength" in mode:
                xy_type = "LoRA MStr"
            elif "Clip Strength" in mode:
                xy_type = "LoRA CStr"

            # Check whether the value is for X or Y
            if "LoRA Batch" in mode: # Changed condition
                return self.generate_batch_values(*args, **kwargs)
            else:
                return ((xy_type, xy_value_list),)

        return (None,)

    def xy_value(self, input_mode, lora_name, model_strength, clip_strength, X_batch_count, X_batch_path, X_subdirectories,
                 X_batch_sort, X_first_value, X_last_value, Y_batch_count, Y_first_value, Y_last_value, lora_stack=None):

        x_value, y_value = [], []
        lora_stack = lora_stack if lora_stack else []

        if "Model Strength" in input_mode and "Clip Strength" in input_mode:
            if lora_name == 'None':
                return (None,None,)
        if "LoRA Batch" in input_mode:
            lora_name = None
        if "LoRA Weight" in input_mode:
            model_strength = None
            clip_strength = None
        if "Model Strength" in input_mode:
            model_strength = None
        if "Clip Strength" in input_mode:
            clip_strength = None

        # Handling X values
        if "X: LoRA Batch" in input_mode:
            try:
                x_value = self.lora_batch.xy_value(X_batch_path, X_subdirectories, X_batch_sort,
                                                   model_strength, clip_strength, X_batch_count, lora_stack)[0][1]
            except Exception as e:
                print(f"{error('XY Plot Error:')} {e}")
                return (None,)
            x_type = "LoRA Batch"
        elif "X: Model Strength" in input_mode:
            x_floats = generate_floats(X_batch_count, X_first_value, X_last_value)
            x_type = "LoRA MStr"
            x_value = [[(lora_name, x, clip_strength)] + lora_stack for x in x_floats]

        # Handling Y values
        y_floats = generate_floats(Y_batch_count, Y_first_value, Y_last_value)
        if "Y: LoRA Weight" in input_mode:
            y_type = "LoRA Wt"
            y_value = [[(lora_name, y, y)] + lora_stack for y in y_floats]
        elif "Y: Model Strength" in input_mode:
            y_type = "LoRA MStr"
            y_value = [[(lora_name, y, clip_strength)] + lora_stack for y in y_floats]
        elif "Y: Clip Strength" in input_mode:
            y_type = "LoRA CStr"
            y_value = [[(lora_name, model_strength, y)] + lora_stack for y in y_floats]

        return ((x_type, x_value), (y_type, y_value))

#=======================================================================================================================
# WindMix XY Plot: LoRA Stacks
class Wind_XYplot_LoRA_Stacks:

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
                    "node_state": (["Enabled"],)},
                "optional": {
                    "lora_stack_1": ("LORA_STACK",),
                    "lora_stack_2": ("LORA_STACK",),
                    "lora_stack_3": ("LORA_STACK",),
                    "lora_stack_4": ("LORA_STACK",),
                    "lora_stack_5": ("LORA_STACK",),},
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, node_state, lora_stack_1=None, lora_stack_2=None, lora_stack_3=None, lora_stack_4=None, lora_stack_5=None):
        xy_type = "LoRA Stacks"
        xy_value = [stack for stack in [lora_stack_1, lora_stack_2, lora_stack_3, lora_stack_4, lora_stack_5] if stack is not None]
        if not xy_value or not any(xy_value) or node_state == "Disabled":
            return (None,)
        else:
            return ((xy_type, xy_value),)

#=======================================================================================================================
# WindMix XY Plot: Manual Entry Notes
class Wind_XYplot_Manual_XY_Entry_Info:

    syntax = "(X/Y_types)     (X/Y_values)\n" \
               "Seeds++ Batch   batch_count\n" \
               "Steps           steps_1;steps_2;...\n" \
               "StartStep       start_step_1;start_step_2;...\n" \
               "EndStep         end_step_1;end_step_2;...\n" \
               "CFG Scale       cfg_1;cfg_2;...\n" \
               "Sampler(1)      sampler_1;sampler_2;...\n" \
               "Sampler(2)      sampler_1,scheduler_1;...\n" \
               "Sampler(3)      sampler_1;...;,default_scheduler\n" \
               "Scheduler       scheduler_1;scheduler_2;...\n" \
               "Denoise         denoise_1;denoise_2;...\n" \
               "VAE             vae_1;vae_2;vae_3;...\n" \
               "+Prompt S/R     search_txt;replace_1;replace_2;...\n" \
               "-Prompt S/R     search_txt;replace_1;replace_2;...\n" \
               "Checkpoint(1)   ckpt_1;ckpt_2;ckpt_3;...\n" \
               "Checkpoint(2)   ckpt_1,clip_skip_1;...\n" \
               "Checkpoint(3)   ckpt_1;ckpt_2;...;,default_clip_skip\n" \
               "Clip Skip       clip_skip_1;clip_skip_2;...\n" \
               "LoRA(1)         lora_1;lora_2;lora_3;...\n" \
               "LoRA(2)         lora_1;...;,default_model_str,default_clip_str\n" \
               "LoRA(3)         lora_1,model_str_1,clip_str_1;..."

    @classmethod
    def INPUT_TYPES(cls):
        samplers = ";\n".join(comfy.samplers.KSampler.SAMPLERS)
        schedulers = ";\n".join(SCHEDULERS)
        vaes = ";\n".join(folder_paths.get_filename_list("vae"))
        ckpts = ";\n".join(folder_paths.get_filename_list("checkpoints"))
        loras = ";\n".join(folder_paths.get_filename_list("loras"))
        return {"required": {
            "notes": ("STRING", {"default":
                                    f"_____________SYNTAX_____________\n{cls.syntax}\n\n"
                                    f"____________SAMPLERS____________\n{samplers}\n\n"
                                    f"___________SCHEDULERS___________\n{schedulers}\n\n"
                                    f"_____________VAES_______________\n{vaes}\n\n"
                                    f"___________CHECKPOINTS__________\n{ckpts}\n\n"
                                    f"_____________LORAS______________\n{loras}\n","multiline": True}),},}

    RETURN_TYPES = ()
    CATEGORY = "⚡ WindMix/📊 xy图表"


#=======================================================================================================================
# WindMix XY Plot: Manual Entry
class Wind_XYplot_Manual_XY_Entry:

    plot_types = ["Nothing", "Seeds++ Batch", "Steps", "StartStep", "EndStep", "CFG Scale", "Sampler", "Scheduler",
                  "Denoise", "VAE", "Positive Prompt S/R", "Negative Prompt S/R", "Checkpoint", "Clip Skip", "LoRA"]
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "plot_type": (cls.plot_types,),
            "plot_value": ("STRING", {"default": "", "multiline": True}),}
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, plot_type, plot_value):

        # Store X values as arrays
        if plot_type not in {"Positive Prompt S/R", "Negative Prompt S/R", "VAE", "Checkpoint", "LoRA", "Scheduler"}:
            plot_value = plot_value.replace(" ", "")  # Remove spaces
        plot_value = plot_value.replace("\n", "")  # Remove newline characters
        plot_value = plot_value.rstrip(";")  # Remove trailing semicolon
        plot_value = plot_value.split(";")  # Turn to array

        # Define the valid bounds for each type
        bounds = {
            "Seeds++ Batch": {"min": 1, "max": 50},
            "Steps": {"min": 1, "max": 10000},
            "StartStep": {"min": 0, "max": 10000},
            "EndStep": {"min": 0, "max": 10000},
            "CFG Scale": {"min": 0, "max": 100},
            "Sampler": {"options": comfy.samplers.KSampler.SAMPLERS},
            "Scheduler": {"options": SCHEDULERS},
            "Denoise": {"min": 0, "max": 1},
            "VAE": {"options": folder_paths.get_filename_list("vae")},
            "Checkpoint": {"options": folder_paths.get_filename_list("checkpoints")},
            "Clip Skip": {"min": -24, "max": -1},
            "LoRA": {"options": folder_paths.get_filename_list("loras"),
                     "model_str": {"min": -10, "max": 10},"clip_str": {"min": -10, "max": 10},},
        }

        # Validates a value based on its corresponding value_type and bounds.
        def validate_value(value, value_type, bounds):
            # ________________________________________________________________________
            # Seeds++ Batch
            if value_type == "Seeds++ Batch":
                try:
                    x = int(float(value))
                    if x < bounds["Seeds++ Batch"]["min"]:
                        x = bounds["Seeds++ Batch"]["min"]
                    elif x > bounds["Seeds++ Batch"]["max"]:
                        x = bounds["Seeds++ Batch"]["max"]
                except ValueError:
                    print(f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid batch count.")
                    return None
                if float(value) != x:
                    print(f"\033[31mmXY Plot Error:\033[0m '{value}' is not a valid batch count.")
                    return None
                return x
            # ________________________________________________________________________
            # Steps
            elif value_type == "Steps":
                try:
                    x = int(value)
                    if x < bounds["Steps"]["min"]:
                        x = bounds["Steps"]["min"]
                    elif x > bounds["Steps"]["max"]:
                        x = bounds["Steps"]["max"]
                    return x
                except ValueError:
                    print(
                        f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid Step count.")
                    return None
            # __________________________________________________________________________________________________________
            # Start at Step
            elif value_type == "StartStep":
                try:
                    x = int(value)
                    if x < bounds["StartStep"]["min"]:
                        x = bounds["StartStep"]["min"]
                    elif x > bounds["StartStep"]["max"]:
                        x = bounds["StartStep"]["max"]
                    return x
                except ValueError:
                    print(
                        f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid Start Step.")
                    return None
            # __________________________________________________________________________________________________________
            # End at Step
            elif value_type == "EndStep":
                try:
                    x = int(value)
                    if x < bounds["EndStep"]["min"]:
                        x = bounds["EndStep"]["min"]
                    elif x > bounds["EndStep"]["max"]:
                        x = bounds["EndStep"]["max"]
                    return x
                except ValueError:
                    print(
                        f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid End Step.")
                    return None
            # __________________________________________________________________________________________________________
            # CFG Scale
            elif value_type == "CFG Scale":
                try:
                    x = float(value)
                    if x < bounds["CFG Scale"]["min"]:
                        x = bounds["CFG Scale"]["min"]
                    elif x > bounds["CFG Scale"]["max"]:
                        x = bounds["CFG Scale"]["max"]
                    return x
                except ValueError:
                    print(
                        f"\033[31mXY Plot Error:\033[0m '{value}' is not a number between {bounds['CFG Scale']['min']}"
                        f" and {bounds['CFG Scale']['max']} for CFG Scale.")
                    return None
            # __________________________________________________________________________________________________________
            # Sampler
            elif value_type == "Sampler":
                if isinstance(value, str) and ',' in value:
                    value = tuple(map(str.strip, value.split(',')))
                if isinstance(value, tuple):
                    if len(value) >= 2:
                        value = value[:2]  # Slice the value tuple to keep only the first two elements
                        sampler, scheduler = value
                        scheduler = scheduler.lower()  # Convert the scheduler name to lowercase
                        if sampler not in bounds["Sampler"]["options"]:
                            valid_samplers = '\n'.join(bounds["Sampler"]["options"])
                            print(
                                f"\033[31mXY Plot Error:\033[0m '{sampler}' is not a valid sampler. Valid samplers are:\n{valid_samplers}")
                            sampler = None
                        if scheduler not in bounds["Scheduler"]["options"]:
                            valid_schedulers = '\n'.join(bounds["Scheduler"]["options"])
                            print(
                                f"\033[31mXY Plot Error:\033[0m '{scheduler}' is not a valid scheduler. Valid schedulers are:\n{valid_schedulers}")
                            scheduler = None
                        if sampler is None or scheduler is None:
                            return None
                        else:
                            return sampler, scheduler
                    else:
                        print(
                            f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid sampler.'")
                        return None
                else:
                    if value not in bounds["Sampler"]["options"]:
                        valid_samplers = '\n'.join(bounds["Sampler"]["options"])
                        print(
                            f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid sampler. Valid samplers are:\n{valid_samplers}")
                        return None
                    else:
                        return value, None
            # __________________________________________________________________________________________________________
            # Scheduler
            elif value_type == "Scheduler":
                if value not in bounds["Scheduler"]["options"]:
                    valid_schedulers = '\n'.join(bounds["Scheduler"]["options"])
                    print(
                        f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid Scheduler. Valid Schedulers are:\n{valid_schedulers}")
                    return None
                else:
                    return value
            # __________________________________________________________________________________________________________
            # Denoise
            elif value_type == "Denoise":
                try:
                    x = float(value)
                    if x < bounds["Denoise"]["min"]:
                        x = bounds["Denoise"]["min"]
                    elif x > bounds["Denoise"]["max"]:
                        x = bounds["Denoise"]["max"]
                    return x
                except ValueError:
                    print(
                        f"\033[31mXY Plot Error:\033[0m '{value}' is not a number between {bounds['Denoise']['min']} "
                        f"and {bounds['Denoise']['max']} for Denoise.")
                    return None
            # __________________________________________________________________________________________________________
            # VAE
            elif value_type == "VAE":
                if value not in bounds["VAE"]["options"]:
                    valid_vaes = '\n'.join(bounds["VAE"]["options"])
                    print(f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid VAE. Valid VAEs are:\n{valid_vaes}")
                    return None
                else:
                    return value
            # __________________________________________________________________________________________________________
            # Checkpoint
            elif value_type == "Checkpoint":
                if isinstance(value, str) and ',' in value:
                    value = tuple(map(str.strip, value.split(',')))
                if isinstance(value, tuple):
                    if len(value) >= 2:
                        value = value[:2]  # Slice the value tuple to keep only the first two elements
                        checkpoint, clip_skip = value
                        try:
                            clip_skip = int(clip_skip)  # Convert the clip_skip to integer
                        except ValueError:
                            print(f"\033[31mXY Plot Error:\033[0m '{clip_skip}' is not a valid clip_skip. "
                                  f"Valid clip skip values are integers between {bounds['Clip Skip']['min']} and {bounds['Clip Skip']['max']}.")
                            return None
                        if checkpoint not in bounds["Checkpoint"]["options"]:
                            valid_checkpoints = '\n'.join(bounds["Checkpoint"]["options"])
                            print(
                                f"\033[31mXY Plot Error:\033[0m '{checkpoint}' is not a valid checkpoint. Valid checkpoints are:\n{valid_checkpoints}")
                            checkpoint = None
                        if clip_skip < bounds["Clip Skip"]["min"] or clip_skip > bounds["Clip Skip"]["max"]:
                            print(f"\033[31mXY Plot Error:\033[0m '{clip_skip}' is not a valid clip skip. "
                                  f"Valid clip skip values are integers between {bounds['Clip Skip']['min']} and {bounds['Clip Skip']['max']}.")
                            clip_skip = None
                        if checkpoint is None or clip_skip is None:
                            return None
                        else:
                            return checkpoint, clip_skip, None
                    else:
                        print(
                            f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid checkpoint.'")
                        return None
                else:
                    if value not in bounds["Checkpoint"]["options"]:
                        valid_checkpoints = '\n'.join(bounds["Checkpoint"]["options"])
                        print(
                            f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid checkpoint. Valid checkpoints are:\n{valid_checkpoints}")
                        return None
                    else:
                        return value, None, None
            # __________________________________________________________________________________________________________
            # Clip Skip
            elif value_type == "Clip Skip":
                try:
                    x = int(value)
                    if x < bounds["Clip Skip"]["min"]:
                        x = bounds["Clip Skip"]["min"]
                    elif x > bounds["Clip Skip"]["max"]:
                        x = bounds["Clip Skip"]["max"]
                    return x
                except ValueError:
                    print(f"\033[31mXY Plot Error:\033[0m '{value}' is not a valid Clip Skip.")
                    return None
            # __________________________________________________________________________________________________________
            # LoRA
            elif value_type == "LoRA":
                if isinstance(value, str) and ',' in value:
                    value = tuple(map(str.strip, value.split(',')))

                if isinstance(value, tuple):
                    lora_name, model_str, clip_str = (value + (1.0, 1.0))[:3]  # Defaults model_str and clip_str to 1 if not provided

                    if lora_name not in bounds["LoRA"]["options"]:
                        valid_loras = '\n'.join(bounds["LoRA"]["options"])
                        print(f"{error('XY Plot Error:')} '{lora_name}' is not a valid LoRA. Valid LoRAs are:\n{valid_loras}")
                        lora_name = None

                    try:
                        model_str = float(model_str)
                        clip_str = float(clip_str)
                    except ValueError:
                        print(f"{error('XY Plot Error:')} The LoRA model strength and clip strength values should be numbers"
                            f" between {bounds['LoRA']['model_str']['min']} and {bounds['LoRA']['model_str']['max']}.")
                        return None

                    if model_str < bounds["LoRA"]["model_str"]["min"] or model_str > bounds["LoRA"]["model_str"]["max"]:
                        print(f"{error('XY Plot Error:')} '{model_str}' is not a valid LoRA model strength value. "
                              f"Valid lora model strength values are between {bounds['LoRA']['model_str']['min']} and {bounds['LoRA']['model_str']['max']}.")
                        model_str = None

                    if clip_str < bounds["LoRA"]["clip_str"]["min"] or clip_str > bounds["LoRA"]["clip_str"]["max"]:
                        print(f"{error('XY Plot Error:')} '{clip_str}' is not a valid LoRA clip strength value. "
                              f"Valid lora clip strength values are between {bounds['LoRA']['clip_str']['min']} and {bounds['LoRA']['clip_str']['max']}.")
                        clip_str = None

                    if lora_name is None or model_str is None or clip_str is None:
                        return None
                    else:
                        return lora_name, model_str, clip_str
                else:
                    if value not in bounds["LoRA"]["options"]:
                        valid_loras = '\n'.join(bounds["LoRA"]["options"])
                        print(f"{error('XY Plot Error:')} '{value}' is not a valid LoRA. Valid LoRAs are:\n{valid_loras}")
                        return None
                    else:
                        return value, 1.0, 1.0

            # __________________________________________________________________________________________________________
            else:
                return None

        # Validate plot_value array length is 1 if doing a "Seeds++ Batch"
        if len(plot_value) != 1 and plot_type == "Seeds++ Batch":
            print(f"{error('XY Plot Error:')} '{';'.join(plot_value)}' is not a valid batch count.")
            return (None,)

        # Apply allowed shortcut syntax to certain input types
        if plot_type in ["Sampler", "Checkpoint", "LoRA"]:
            if plot_value[-1].startswith(','):
                # Remove the leading comma from the last entry and store it as suffixes
                suffixes = plot_value.pop().lstrip(',').split(',')
                # Split all preceding entries into subentries
                plot_value = [entry.split(',') for entry in plot_value]
                # Make all entries the same length as suffixes by appending missing elements
                for entry in plot_value:
                    entry += suffixes[len(entry) - 1:]
                # Join subentries back into strings
                plot_value = [','.join(entry) for entry in plot_value]

        # Prompt S/R X Cleanup
        if plot_type in {"Positive Prompt S/R", "Negative Prompt S/R"}:
            if plot_value[0] == '':
                print(f"{error('XY Plot Error:')} Prompt S/R value can not be empty.")
                return (None,)
            else:
                plot_value = [(plot_value[0], None) if i == 0 else (plot_value[0], x) for i, x in enumerate(plot_value)]

        # Loop over each entry in plot_value and check if it's valid
        if plot_type not in {"Nothing", "Positive Prompt S/R", "Negative Prompt S/R"}:
            for i in range(len(plot_value)):
                plot_value[i] = validate_value(plot_value[i], plot_type, bounds)
                if plot_value[i] == None:
                    return (None,)

        # Set up Seeds++ Batch structure
        if plot_type == "Seeds++ Batch":
            plot_value = list(range(plot_value[0]))

        # Nest LoRA value in another array to reflect LoRA stack changes
        if plot_type == "LoRA":
            plot_value = [[x] for x in plot_value]

        # Clean X/Y_values
        if plot_type == "Nothing":
            plot_value = [""]

        return ((plot_type, plot_value),)

#=======================================================================================================================
# WindMix XY Plot: Join Inputs
class Wind_XYplot_JoinInputs:

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "xy_1": ("XY",),
            "xy_2": ("XY",),},
        }

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, xy_1, xy_2):
        xy_type_1, xy_value_1 = xy_1
        xy_type_2, xy_value_2 = xy_2

        if xy_type_1 != xy_type_2:
            print(f"{error('Join XY Inputs Error:')} Input types must match")
            return (None,)
        elif xy_type_1 == "Seeds++ Batch":
            xy_type = xy_type_1
            combined_length = len(xy_value_1) + len(xy_value_2)
            xy_value = list(range(combined_length))
        elif xy_type_1 == "Positive Prompt S/R" or xy_type_1 == "Negative Prompt S/R":
            xy_type = xy_type_1
            xy_value = xy_value_1 + [(xy_value_1[0][0], t[1]) for t in xy_value_2[1:]]
        else:
            xy_type = xy_type_1
            xy_value = xy_value_1 + xy_value_2
        return ((xy_type, xy_value),)

########################################################################################################################
# WindMix Image Overlay
class Wind_XYplot_DiTModel:
    @classmethod
    def INPUT_TYPES(cls):
        unets = ["None"] + folder_paths.get_filename_list("diffusion_models")
        clips = ["None"] + folder_paths.get_filename_list("text_encoders")
        vaes = ["None"] + folder_paths.get_filename_list("vae")
        inputs = {"required": {
            "input_mode": (["Model Names", "Model Names+Clip", "Model Names+Clip+VAE"],),
            "model_count": ("INT", {"default": XYPLOT_DEF, "min": 0, "max": XYPLOT_LIM, "step": 1}),
        }}
        for i in range(1, XYPLOT_LIM + 1):
            inputs["required"][f"unet_name_{i}"] = (unets,)
            inputs["required"][f"clip_name_{i}"] = (clips,)
            inputs["required"][f"vae_name_{i}"] = (vaes,)
        return inputs

    RETURN_TYPES = ("XY",)
    RETURN_NAMES = ("x_or_y",)
    FUNCTION = "xy_value"
    CATEGORY = "⚡ WindMix/📊 xy图表"

    def xy_value(self, input_mode, model_count, **kwargs):
        xy_type = "DiT Model"
        unets = [kwargs.get(f"unet_name_{i}") for i in range(1, model_count + 1)]
        clips = [kwargs.get(f"clip_name_{i}") for i in range(1, model_count + 1)]
        vaes = [kwargs.get(f"vae_name_{i}") for i in range(1, model_count + 1)]
        for i in range(model_count):
            if "Clip" not in input_mode:
                clips[i] = None
            if "VAE" not in input_mode:
                vaes[i] = None
        xy_value = [(u, c, v) for u, c, v in zip(unets, clips, vaes) if u != "None"]
        return ((xy_type, xy_value),) if xy_value else (None,)

NODE_CLASS_MAPPINGS = {
    "⚡ XY Plot": Wind_XYplot,
    "⚡ XY Input: LoRA": Wind_XYplot_LoRA,
    "⚡ XY Input: LoRA Plot": Wind_XYplot_LoRA_Plot,
    "⚡ XY Input: UNet Model": Wind_XYplot_DiTModel,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "⚡ XY Plot": "📊 XY 图表",
    "⚡ XY Input: LoRA": "📊 XY 输入: LoRA",
    "⚡ XY Input: LoRA Plot": "📊 XY 输入: LoRA 图表",
    "⚡ XY Input: UNet Model": "📊 XY 输入: UNet模型",
}
