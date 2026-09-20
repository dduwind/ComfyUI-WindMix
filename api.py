from __future__ import annotations

import json
import os
import re
import shutil

from aiohttp import web
from server import PromptServer

import folder_paths


@PromptServer.instance.routes.get("/windmix/lora_metadata")
async def windmix_lora_metadata(request):
    """读取 LoRA 同级的 <lora名>.metadata.json，返回其 trainedWords。

    Query 参数 `name` 是 loras 的相对路径（与下拉框里显示的一致，
    例如 "character/hero/ana.safetensors"）。
    返回 {"trainedWords": [...]}；找不到或非 LoRA 时返回空列表。
    """
    name = request.query.get("name", "")
    result = {"trainedWords": []}
    if not name:
        return web.json_response(result)

    try:
        full = folder_paths.get_full_path("loras", name)
        if full:
            # 与 LoRA 同目录、同名（去扩展名）的 .metadata.json
            base = os.path.splitext(os.path.basename(full))[0]
            meta_path = os.path.join(os.path.dirname(full), base + ".metadata.json")
            if os.path.isfile(meta_path):
                with open(meta_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                tw = data.get("trainedWords", [])
                # 优先读 civitai.trainedWords（civitai 元数据扩展的嵌套结构），
                # 兜底顶层 trainedWords。过滤空值后用 ", " 拼成字符串返回。
                civitai = data.get("civitai") or {}
                nested = civitai.get("trainedWords")
                if isinstance(nested, list) and nested:
                    tw = nested
                if isinstance(tw, list):
                    result["trainedWords"] = [str(x) for x in tw if x]
                elif tw:
                    result["trainedWords"] = [str(tw)]
    except Exception as e:
        result["error"] = str(e)

    return web.json_response(result)


@PromptServer.instance.routes.get("/windmix/loras")
async def windmix_loras(request):
    """返回 loras 目录下的全部 LoRA 相对路径列表（含子目录），供前端选择器/文件夹树使用。"""
    try:
        loras = folder_paths.get_filename_list("loras")
    except Exception:
        loras = []
    return web.json_response({"loras": loras or []})


@PromptServer.instance.routes.get("/windmix/unets")
async def windmix_unets(request):
    """返回 diffusion_models 目录下的全部 DiT/UNet 模型相对路径列表（含子目录），
    供 UNet2 XY 输入节点的选择器/文件夹树使用。"""
    try:
        unets = folder_paths.get_filename_list("diffusion_models")
    except Exception:
        unets = []
    return web.json_response({"unets": unets or []})


# ============================== 预设文本管理器 ==============================
import time as _time
import uuid as _uuid
import base64 as _base64

_WM_NODE_DIR = os.path.dirname(os.path.abspath(__file__))
_WM_PRESET_DIR = os.path.join(_WM_NODE_DIR, "presets")
_WM_PRESET_FILE = os.path.join(_WM_PRESET_DIR, "preset_text.json")
_WM_IMAGE_DIR = os.path.join(_WM_PRESET_DIR, "images")


def _wm_read_presets():
    """读取预设文件；自动把旧版单层目录迁移为两级（旧的全部归到「未分类」大分类下）。"""
    if not os.path.exists(_WM_PRESET_FILE):
        folders = [{"name": "未分类", "parent": ""}]
        _wm_write_presets(folders, [])
        return folders, []

    try:
        with open(_WM_PRESET_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        folders = [{"name": "未分类", "parent": ""}]
        return folders, []

    raw_folders = data.get("folders", []) or []
    raw_presets = data.get("presets", []) or []

    new_folders, migrated = _wm_normalize_folders(raw_folders)
    _wm_normalize_presets(raw_presets, new_folders)

    if migrated:
        _wm_write_presets(new_folders, raw_presets)

    return new_folders, raw_presets


def _wm_normalize_folders(raw_folders):
    """把任意形态的 folders 列表归一为 [{name, parent}, ...]（parent='' 表示大分类）。
    旧版（字符串列表 / 没有 parent 字段）自动归到「未分类」大分类下的小分类。
    返回 (normalized, migrated_bool)。"""
    if not raw_folders:
        return [{"name": "未分类", "parent": ""}], False

    # 已规范化：全部是 dict 且都带 name/parent
    if all(isinstance(f, dict) and "name" in f and "parent" in f for f in raw_folders):
        has_big = any(f.get("parent", "") == "" for f in raw_folders)
        if has_big:
            return raw_folders, False
        # 没有大分类（理论上不该发生），把全部当作「未分类」下的小分类
        out = [{"name": "未分类", "parent": ""}]
        for f in raw_folders:
            nm = f.get("name", "")
            if nm and nm not in ("全部预设", "无目录"):
                out.append({"name": nm, "parent": "未分类"})
        return out, True

    # 旧格式（字符串列表）或混合：收集名称，全部归到「未分类」下
    names = []
    seen = set()
    for f in raw_folders:
        nm = f if isinstance(f, str) else (f.get("name", "") if isinstance(f, dict) else "")
        if nm and nm not in seen and nm not in ("全部预设", "无目录"):
            names.append(nm)
            seen.add(nm)
    out = [{"name": "未分类", "parent": ""}]
    for nm in names:
        out.append({"name": nm, "parent": "未分类"})
    return out, True


def _wm_normalize_presets(presets, folders):
    """补齐 preset.parent：folder 在某个 (name, parent) 里就取该 parent；否则按 folder 是否存在决定。"""
    folder_pairs = {(f.get("name", ""), f.get("parent", "")) for f in folders}
    big_names = {f["name"] for f in folders if f.get("parent", "") == ""}
    pair_to_parent = {fn: fp for fn, fp in folder_pairs}
    for p in presets:
        if "parent" in p:
            # 校正：parent 指向已删除的大分类时，清空
            if p["parent"] and p["parent"] not in big_names:
                p["parent"] = ""
            continue
        folder = p.get("folder", "")
        if folder and folder in pair_to_parent:
            p["parent"] = pair_to_parent[folder]
        else:
            p["parent"] = ""


def _wm_write_presets(folders, presets):
    os.makedirs(_WM_PRESET_DIR, exist_ok=True)
    # 原子写：先写同目录临时文件，再 os.replace 原子替换。
    # 直接 open("w") 覆盖原文件时若进程中途崩溃/断电，会留下截断的 JSON 损坏全库；
    # 临时文件写坏最多丢本次改动，旧库不受影响。os.replace 在 Windows 上也是原子操作。
    tmp = _WM_PRESET_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"folders": folders, "presets": presets}, f, indent=4, ensure_ascii=False)
    os.replace(tmp, _WM_PRESET_FILE)


def _wm_build_tree(folders, presets):
    """返回两层目录树：全部预设 / 无目录（虚拟） + 大分类(可展开)含小分类。"""
    tree = [{"name": "全部预设", "count": len(presets), "virtual": True,
             "parent": "", "type": "all"}]
    uncat = sum(1 for p in presets if not p.get("folder") and not p.get("parent"))
    tree.append({"name": "无目录", "count": uncat, "virtual": True,
                 "parent": "", "type": "uncategorized"})
    # 大分类(parent="")与各自的小分类(parent=big)
    smalls_by_big = {}
    for f in folders:
        fp = f.get("parent", "")
        if fp:
            smalls_by_big.setdefault(fp, []).append(f.get("name", ""))
    bigs = [f for f in folders if f.get("parent", "") == ""]
    for big in bigs:
        bname = big.get("name", "")
        if not bname:
            continue
        bcount = sum(1 for p in presets if p.get("parent") == bname)
        children = []
        for sname in smalls_by_big.get(bname, []):
            scount = sum(1 for p in presets
                         if p.get("folder") == sname and p.get("parent") == bname)
            children.append({"name": sname, "parent": bname, "count": scount,
                             "virtual": False, "type": "small"})
        tree.append({"name": bname, "parent": "", "count": bcount,
                     "virtual": False, "type": "big", "children": children})
    return tree


@PromptServer.instance.routes.get("/windmix/preset_text/presets")
async def windmix_preset_text_presets_get(request):
    """列出预设文本。query 参数：
       - folder='全部预设'/'无目录' 走虚拟过滤
       - parent+folder 指定具体小分类
       - parent='大分类' folder='' 返回该大分类下全部预设
       固定返回 folders 树（含数量 + 两层结构）与当前过滤后的 presets。"""
    folder = request.query.get("folder", "全部预设")
    parent = request.query.get("parent", "")
    all_flag = request.query.get("all")
    folders, presets = _wm_read_presets()

    # 注意过滤顺序：parent 优先于 folder 的虚拟判断，否则「大分类视图」(folder="", parent=bn)
    # 会被 folder in (None,"",全部预设) 提前命中而返回全部预设。
    if all_flag:
        visible = presets
    elif parent and folder:
        visible = [p for p in presets
                   if p.get("folder") == folder and p.get("parent") == parent]
    elif parent and not folder:
        visible = [p for p in presets if p.get("parent") == parent]
    elif folder == "无目录":
        visible = [p for p in presets if not p.get("folder") and not p.get("parent")]
    elif folder in (None, "", "全部预设"):
        visible = presets
    else:
        # 未知分类（如已被删除）：返回空列表，前端检测到视图失效会回退「全部预设」重新拉取
        visible = []

    return web.json_response(
        {"success": True, "folders": _wm_build_tree(folders, presets),
         "presets": visible}
    )


@PromptServer.instance.routes.post("/windmix/preset_text/presets")
async def windmix_preset_text_presets_post(request):
    """预设的增删改与目录管理。body.action ∈ {add, update, delete, reorder, move, move_many, move_folder, rename_folder, reorder_folders, import_presets, duplicate, add_folder, delete_folder}。"""
    input_data = await request.json()
    action = input_data.get("action")
    folders, presets = _wm_read_presets()
    resp = {"success": False, "message": "unknown action"}

    if action == "add":
        name = (input_data.get("name") or "").strip()
        if not name:
            resp = {"success": False, "message": "名称不能为空"}
        else:
            new_id = "p_" + _uuid.uuid4().hex[:12]
            item = {
                "id": new_id,
                "name": name,
                "content": input_data.get("content", "") or "",
                "folder": input_data.get("folder") or "",
                "parent": input_data.get("parent") or "",
                "image": input_data.get("image") or "",
            }
            presets.append(item)
            _wm_write_presets(folders, presets)
            resp = {"success": True, "id": new_id}

    elif action == "add_many":
        # 批量添加：一次请求加入多条预设（同一 folder/parent），只读写一次文件，
        # 供节点「保存到预设」整目录使用，避免逐条请求反复重写整个预设文件。
        items_in = input_data.get("items") or []
        if not isinstance(items_in, list):
            items_in = []
        target_folder = input_data.get("folder") or ""
        target_parent = input_data.get("parent") or ""
        added = 0
        for it in items_in:
            if not isinstance(it, dict):
                continue
            nm = (it.get("name") or "").strip()
            if not nm:
                continue
            presets.append({
                "id": "p_" + _uuid.uuid4().hex[:12],
                "name": nm,
                "content": it.get("content", "") or "",
                "folder": target_folder,
                "parent": target_parent,
                "image": it.get("image", "") or "",
            })
            added += 1
        if added:
            _wm_write_presets(folders, presets)
            resp = {"success": True, "added": added}
        else:
            resp = {"success": False, "message": "没有可添加的预设"}

    elif action == "update":
        item_id = input_data.get("id")
        item = next((p for p in presets if p.get("id") == item_id), None)
        if item:
            if input_data.get("name") is not None:
                item["name"] = input_data["name"]
            if input_data.get("content") is not None:
                item["content"] = input_data["content"]
            if "folder" in input_data:
                item["folder"] = input_data["folder"] or ""
            if "parent" in input_data:
                item["parent"] = input_data["parent"] or ""
            if "image" in input_data:
                old_img = item.get("image", "")
                new_img = input_data["image"] or ""
                # 替换缩略图时删除磁盘上的旧文件，避免孤儿图片堆积
                if old_img and old_img != new_img:
                    _wm_delete_image_file(old_img)
                item["image"] = new_img
            _wm_write_presets(folders, presets)
            resp = {"success": True}
        else:
            resp = {"success": False, "message": "未找到该预设"}

    elif action == "delete":
        item_id = input_data.get("id")
        removed = [p for p in presets if p.get("id") == item_id]
        before = len(presets)
        presets = [p for p in presets if p.get("id") != item_id]
        if len(presets) < before:
            # 删除预设时一并清理其缩略图文件，避免孤儿图片
            for p in removed:
                _wm_delete_image_file(p.get("image", ""))
            _wm_write_presets(folders, presets)
            resp = {"success": True}
        else:
            resp = {"success": False, "message": "未找到该预设"}

    elif action == "reorder":
        # 在扁平列表内重排：把 id 对应的项移动到 beforeId 之前；beforeId 为空则移到末尾。
        item_id = input_data.get("id")
        before_id = input_data.get("beforeId") or None
        item = next((p for p in presets if p.get("id") == item_id), None)
        if item:
            presets = [p for p in presets if p.get("id") != item_id]
            if before_id:
                idx = next((i for i, p in enumerate(presets) if p.get("id") == before_id), None)
                if idx is None:
                    presets.append(item)
                else:
                    presets.insert(idx, item)
            else:
                presets.append(item)
            _wm_write_presets(folders, presets)
            resp = {"success": True}
        else:
            resp = {"success": False, "message": "未找到该预设"}

    elif action == "move":
        # 把预设移动到另一个 (folder, parent)；parent='' + folder='' 表示无目录。
        item_id = input_data.get("id")
        item = next((p for p in presets if p.get("id") == item_id), None)
        if item:
            item["folder"] = input_data.get("folder") or ""
            item["parent"] = input_data.get("parent") or ""
            _wm_write_presets(folders, presets)
            resp = {"success": True}
        else:
            resp = {"success": False, "message": "未找到该预设"}

    elif action == "move_many":
        # 批量移动到指定 (folder, parent)
        ids = input_data.get("ids") or []
        if not isinstance(ids, list):
            ids = [ids]
        target_folder = input_data.get("folder") or ""
        target_parent = input_data.get("parent") or ""
        moved = 0
        for p in presets:
            if p.get("id") in ids:
                p["folder"] = target_folder
                p["parent"] = target_parent
                moved += 1
        if moved:
            _wm_write_presets(folders, presets)
            resp = {"success": True, "moved": moved}
        else:
            resp = {"success": False, "message": "未找到匹配的预设"}

    elif action == "move_folder":
        # 把小分类 (name, old_parent) 重新归类到另一个大分类 new_parent（拖拽小分类归类）
        name = input_data.get("name")
        old_parent = input_data.get("old_parent") or ""
        new_parent = input_data.get("new_parent") or ""
        if not name:
            resp = {"success": False, "message": "目录名无效"}
        elif new_parent and not any(f.get("name") == new_parent and f.get("parent", "") == "" for f in folders):
            resp = {"success": False, "message": "目标大分类不存在"}
        elif any(f.get("name") == name and f.get("parent", "") == new_parent for f in folders):
            resp = {"success": False, "message": "目标大分类下已存在同名小分类"}
        else:
            for f in folders:
                if f.get("name") == name and f.get("parent", "") == old_parent:
                    f["parent"] = new_parent
                    break
            for p in presets:
                if p.get("folder") == name and p.get("parent") == old_parent:
                    p["parent"] = new_parent
            _wm_write_presets(folders, presets)
            resp = {"success": True}

    elif action == "rename_folder":
        # 重命名目录（大分类或小分类），并同步更新关联的预设/子分类引用。
        old_name = input_data.get("old_name") or ""
        new_name = (input_data.get("new_name") or "").strip()
        parent = input_data.get("parent") or ""
        reserved = ("全部预设", "无目录")
        if not old_name or not new_name:
            resp = {"success": False, "message": "目录名无效"}
        elif new_name in reserved:
            resp = {"success": False, "message": "该名称是保留名，不可使用"}
        elif any(f.get("name") == new_name and f.get("parent", "") == parent for f in folders):
            resp = {"success": False, "message": "该目录下已存在同名目录"}
        else:
            for f in folders:
                if f.get("name") == old_name and f.get("parent", "") == parent:
                    f["name"] = new_name
                # 重命名大分类时，同步其下小分类的 parent 引用
                if parent == "" and f.get("parent", "") == old_name:
                    f["parent"] = new_name
            for p in presets:
                if p.get("folder") == old_name and p.get("parent") == parent:
                    p["folder"] = new_name
                # 重命名大分类时，同步预设的 parent 引用
                if parent == "" and p.get("parent") == old_name:
                    p["parent"] = new_name
            _wm_write_presets(folders, presets)
            resp = {"success": True}

    elif action == "reorder_folders":
        # 在同一 parent 下，把若干目录按 names 给定顺序重排（仅调整顺序，不跨 parent）。
        parent = input_data.get("parent") or ""
        names = input_data.get("names") or []
        if not isinstance(names, list):
            names = []
        group_items = [f for f in folders if f.get("parent", "") == parent]
        by_name = {f["name"]: f for f in group_items}
        ordered = []
        seen_names = set()
        for n in names:
            if n in by_name and n not in seen_names:
                ordered.append(by_name[n])
                seen_names.add(n)
        for f in group_items:
            if f["name"] not in seen_names:
                ordered.append(f)  # names 未列出的保持原相对顺序，追加在末尾
                seen_names.add(f["name"])
        result = []
        oi = 0
        for f in folders:
            if f.get("parent", "") == parent:
                result.append(ordered[oi])
                oi += 1
            else:
                result.append(f)
        folders = result
        _wm_write_presets(folders, presets)
        resp = {"success": True}

    elif action == "import_presets":
        # 导入外部 JSON：支持纯数组或 {presets:[...]}。
        # 尊重原 JSON 里每条预设的 folder(小分类)/parent(大分类)，缺失的分类自动创建；
        # 仅有 name/content、未带分类的条目才回退到「未分类/未分类」。
        data = input_data.get("data")
        presets_in = None
        if isinstance(data, list):
            presets_in = data
        elif isinstance(data, dict):
            presets_in = data.get("presets") or []
        if not isinstance(presets_in, list) or not presets_in:
            resp = {"success": False, "message": "JSON 中没有可导入的预设"}
        else:
            if not any(f.get("name") == "未分类" and f.get("parent", "") == "" for f in folders):
                folders.append({"name": "未分类", "parent": ""})
            if not any(f.get("name") == "未分类" and f.get("parent", "") == "未分类" for f in folders):
                folders.append({"name": "未分类", "parent": "未分类"})

            def ensure_folder(name, parent):
                # 创建/复用分类：parent=="" 为大分类，否则为 parent 下的小分类
                if not name:
                    return
                if any(f.get("name") == name and f.get("parent", "") == parent for f in folders):
                    return
                folders.append({"name": name, "parent": parent})

            added = 0
            for it in presets_in:
                if not isinstance(it, dict):
                    continue
                nm = (it.get("name") or "").strip()
                if not nm:
                    continue
                folder = (it.get("folder") or "").strip()
                parent = (it.get("parent") or "").strip()
                if folder and parent:
                    # 带完整分类：确保大分类 + 小分类都存在，并归入该小分类
                    ensure_folder(parent, "")
                    ensure_folder(folder, parent)
                elif folder and not parent:
                    # 仅给了小分类名：归入「未分类」大分类下的该小分类
                    ensure_folder(folder, "未分类")
                else:
                    folder, parent = "未分类", "未分类"
                presets.append({
                    "id": "p_" + _uuid.uuid4().hex[:12],
                    "name": nm,
                    "content": it.get("content", "") or "",
                    "folder": folder,
                    "parent": parent,
                    "image": it.get("image", "") or "",
                })
                added += 1
            if added:
                _wm_write_presets(folders, presets)
                resp = {"success": True, "added": added}
            else:
                resp = {"success": False, "message": "没有有效预设可导入"}

    elif action == "duplicate":
        item_id = input_data.get("id")
        after_id = input_data.get("after_id") or None
        item = next((p for p in presets if p.get("id") == item_id), None)
        if item:
            new_id = "p_" + _uuid.uuid4().hex[:12]
            copy = dict(item)
            copy["id"] = new_id
            copy["name"] = (item.get("name", "") + " 副本").strip()
            # 缩略图文件独立拷贝：否则原件与副本共享同一张图片，
            # 之后任意一方删除/替换图片都会把共享文件删掉，导致另一条预设丢图
            src_img = item.get("image", "") or ""
            if src_img.startswith("images/"):
                src_abs = os.path.normpath(os.path.join(_WM_PRESET_DIR, src_img))
                img_dir = os.path.normpath(_WM_IMAGE_DIR)
                if src_abs.startswith(img_dir + os.sep) and os.path.isfile(src_abs):
                    ext = os.path.splitext(src_abs)[1] or ".jpg"
                    new_name = "copy_" + _wm_safe_name(copy["name"]) + "_" + _uuid.uuid4().hex[:8] + ext
                    try:
                        shutil.copyfile(src_abs, os.path.join(img_dir, new_name))
                        copy["image"] = "images/" + new_name
                    except Exception:
                        pass
            if after_id and any(p.get("id") == after_id for p in presets):
                idx = next(i for i, p in enumerate(presets) if p.get("id") == after_id)
                presets.insert(idx + 1, copy)
            else:
                presets.append(copy)
            _wm_write_presets(folders, presets)
            resp = {"success": True, "id": new_id}
        else:
            resp = {"success": False, "message": "未找到该预设"}

    elif action == "add_folder":
        name = (input_data.get("name") or "").strip()
        parent = input_data.get("parent") or ""
        # 校验：不能是保留名；同一 parent 下不能重名
        reserved = ("全部预设", "无目录")
        if not name or name in reserved:
            resp = {"success": False, "message": "目录名无效"}
        elif any(f.get("name") == name and f.get("parent", "") == parent for f in folders):
            resp = {"success": False, "message": "该目录下已存在同名目录"}
        elif parent and not any(f.get("name") == parent and f.get("parent", "") == "" for f in folders):
            resp = {"success": False, "message": "父级大分类不存在"}
        else:
            folders.append({"name": name, "parent": parent})
            _wm_write_presets(folders, presets)
            resp = {"success": True}

    elif action == "delete_folder":
        name = (input_data.get("name") or "").strip()
        parent = (input_data.get("parent") or "").strip()
        purge = input_data.get("purge", False)  # True=连分类下的预设一并永久删除
        # 找到目标 folder 条目
        idx = next((i for i, f in enumerate(folders)
                    if f.get("name") == name and f.get("parent", "") == parent), -1)
        if idx < 0:
            # 容错：即便 folders 里没有该目录条目，只要仍有预设引用它，就直接清掉这些预设，
            # 避免「里面有内容却提示未找到该目录」的尴尬；确实什么都没有才报未找到。
            refs = [p for p in presets
                    if (p.get("folder") == name and p.get("parent") == parent)
                    or (parent == "" and p.get("parent") == name)]
            if not refs:
                resp = {"success": False, "message": "未找到该目录"}
            else:
                if purge:
                    # 连预设一并永久删除，同时清理磁盘缩略图，避免孤儿图片
                    kept, removed = [], []
                    for p in presets:
                        if ((p.get("folder") == name and p.get("parent") == parent)
                                or (parent == "" and p.get("parent") == name)):
                            removed.append(p)
                        else:
                            kept.append(p)
                    presets = kept
                    for p in removed:
                        _wm_delete_image_file(p.get("image", ""))
                else:
                    for p in presets:
                        if (p.get("folder") == name and p.get("parent") == parent) or (parent == "" and p.get("parent") == name):
                            p["folder"] = ""
                            p["parent"] = ""
                _wm_write_presets(folders, presets)
                resp = {"success": True}
        else:
            folders.pop(idx)
            if parent == "":
                # 删除大分类：级联删除其下小分类
                folders = [f for f in folders
                           if f.get("parent", "") != name]
                if purge:
                    # 连预设一并永久删除，同时清理缩略图，避免孤儿图片
                    kept, removed = [], []
                    for p in presets:
                        if p.get("parent") == name:
                            removed.append(p)
                        else:
                            kept.append(p)
                    presets = kept
                    for p in removed:
                        _wm_delete_image_file(p.get("image", ""))
                else:
                    for p in presets:
                        if p.get("parent") == name:
                            p["folder"] = ""
                            p["parent"] = ""
            else:
                if purge:
                    # 连预设一并永久删除，同时清理缩略图，避免孤儿图片
                    kept, removed = [], []
                    for p in presets:
                        if p.get("folder") == name and p.get("parent") == parent:
                            removed.append(p)
                        else:
                            kept.append(p)
                    presets = kept
                    for p in removed:
                        _wm_delete_image_file(p.get("image", ""))
                else:
                    for p in presets:
                        if p.get("folder") == name and p.get("parent") == parent:
                            p["folder"] = ""
                            p["parent"] = ""
            _wm_write_presets(folders, presets)
            resp = {"success": True}

    return web.json_response(resp)


def _wm_safe_name(name):
    """把卡片名清洗成合法文件名片段（Windows/Unix 通用）：
    去非法字符、压缩空白、限长，避免路径分隔符/保留名冲突。"""
    if not name:
        return ""
    s = str(name).strip()
    s = re.sub(r'[\\/:*?"<>|]', "", s)      # 去掉 Windows 非法字符
    s = re.sub(r'\s+', " ", s).strip()        # 压缩连续空白
    s = s.strip(". ")                          # 去掉首尾可能出问题的点/空格
    return s[:40] if s else ""


def _wm_delete_image_file(rel_path):
    """安全删除 presets/images/ 下的旧缩略图（防目录穿越），失败静默忽略。"""
    if not rel_path or not rel_path.startswith("images/"):
        return
    abs_path = os.path.normpath(os.path.join(_WM_PRESET_DIR, rel_path))
    img_dir = os.path.normpath(_WM_IMAGE_DIR)
    # 必须带分隔符比较，否则 presets/images2/xxx 这类同级路径也会被误判为目录内文件
    if abs_path.startswith(img_dir + os.sep) and os.path.isfile(abs_path):
        try:
            os.remove(abs_path)
        except Exception:
            pass


@PromptServer.instance.routes.post("/windmix/preset_text/image")
async def windmix_preset_text_image(request):
    """接收 base64 图片（dataURL），压图(最长边≤512, JPEG)后落盘到 presets/images/，
    返回 {success, path:'images/xxx.jpg'}。前端用 path 拼插件根地址显示。"""
    input_data = await request.json()
    data_url = input_data.get("image", "")
    if not data_url or "," not in data_url:
        return web.json_response({"success": False, "message": "无图片数据"})

    try:
        header, b64 = data_url.split(",", 1)
        raw = _base64.b64decode(b64)
    except Exception as e:
        return web.json_response({"success": False, "message": "图片解码失败: " + str(e)})

    try:
        from io import BytesIO
        from PIL import Image
    except Exception as e:
        return web.json_response({"success": False, "message": "服务端缺少 PIL: " + str(e)})

    os.makedirs(_WM_IMAGE_DIR, exist_ok=True)
    # 按卡片名命名：cn_<清洗后的卡片名>_<6位短uuid>.jpg；无名字则回退随机名
    safe = _wm_safe_name(input_data.get("name", ""))
    if safe:
        fname = "cn_" + safe + "_" + _uuid.uuid4().hex[:6] + ".jpg"
    else:
        fname = "img_" + _uuid.uuid4().hex[:12] + ".jpg"
    out_path = os.path.join(_WM_IMAGE_DIR, fname)
    # 极小概率同名冲突则补长 uuid 后缀，避免覆盖
    while os.path.exists(out_path):
        fname = ("cn_" + safe + "_" + _uuid.uuid4().hex[:8] + ".jpg") if safe else ("img_" + _uuid.uuid4().hex[:12] + ".jpg")
        out_path = os.path.join(_WM_IMAGE_DIR, fname)

    try:
        img = Image.open(BytesIO(raw)).convert("RGB")
        max_side = 512
        if max(img.width, img.height) > max_side:
            ratio = max_side / max(img.width, img.height)
            img = img.resize((max(1, int(img.width * ratio)), max(1, int(img.height * ratio))), Image.LANCZOS)
        img.save(out_path, "JPEG", quality=82, optimize=True)
    except Exception as e:
        return web.json_response({"success": False, "message": "图片处理失败: " + str(e)})

    return web.json_response({"success": True, "path": "images/" + fname})


@PromptServer.instance.routes.get("/windmix/preset_text/image")
async def windmix_preset_text_image_get(request):
    """按相对路径读取 presets/images/ 下的图片并返回（用于管理器预览图显示）。"""
    rel = request.query.get("path", "")
    if not rel or "/" not in rel:
        return web.Response(status=400, text="invalid path")
    # 仅允许访问 images/ 子目录，防目录穿越
    if not rel.startswith("images/"):
        return web.Response(status=400, text="forbidden")
    abs_path = os.path.normpath(os.path.join(_WM_PRESET_DIR, rel))
    if not abs_path.startswith(os.path.normpath(_WM_IMAGE_DIR)) or not os.path.isfile(abs_path):
        return web.Response(status=404, text="not found")
    return web.FileResponse(abs_path)
