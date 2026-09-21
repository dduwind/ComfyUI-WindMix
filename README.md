# ComfyUI-WindMix

把日常真正会用到的节点**集中搬进一个插件**——它们原本散落在十几个第三方 ComfyUI 插件里。
搬完之后，**把那些原插件卸掉，这里的节点照样能用**。

所有节点统一挂在 `⚡ WindMix` 根菜单下，避免与其他插件重名冲突。
改进一些老插件的功能，支持新的模型，并加入一些新的节点，能够提高效率
---



---

## 一、安装

### 方式 A：ComfyUI-Manager（推荐）

1. 打开 ComfyUI → 右侧 **Manager** → **Custom Nodes Manager**
2. 在搜索框粘贴 `https://github.com/dduwind/ComfyUI-WindMix`，点 **Install**
   （或从菜单选 **Install via Git URL**，填入同一地址）
3. 重启 ComfyUI

### 方式 B：git clone

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/dduwind/ComfyUI-WindMix.git
```

### 方式 C：下载压缩包

从 Releases 或 Code → Download ZIP 下载后，解压到：

```
ComfyUI/
└── custom_nodes/
    └── ComfyUI-WindMix/      ← 本目录
```

然后**重启 ComfyUI**。

> **改了东西之后怎么生效**
> - 改 `web/` 下的前端 JS → 浏览器 **Ctrl+Shift+R** 硬刷即可
> - 改 `*.py`（含 `api.py`）→ 必须**重启 ComfyUI**，硬刷不生效

### 依赖

- 核心节点只依赖 ComfyUI 自带能力，**无需额外 pip 包**。
- `🚀 DiT 效率加载器` / `📊 XY 输入: UNet3` 处理 DiT 模型（Anima / Z-Image / Krea-2 等）时，需要 模型等加载后端已就绪——沿用上游 efficiency 的加载逻辑。

---

## 二、节点总览

共 27 个节点，按 `⚡ WindMix` 下的子菜单归类。

| 分类 | 显示名 | 类名 | 说明 |
|---|---|---|---|
| 📦 名称加载器 | 📦 Checkpoint Loader With Name | `WindMix_CheckpointLoaderWithName` | 按名字（文本框）而非下拉框加载 Checkpoint |
| 📦 名称加载器 | 📦 UNET Loader With Name | `WindMix_UNETLoaderWithName` | 同上，加载 UNET |
| 🎛️ LoRA | 🎛️ LoRA Stack | `WindMixLoraStack` | 多 LoRA 堆叠，输出给效率节点 |
| 🎛️ LoRA | 🎛️ LoRA Loader (Model Only) | `WindMixLoraLoaderModelOnly` | 仅返回加载了 LoRA 的 MODEL |
| 🚀 效率节点 | 🚀 XL 效率加载器 | `⚡ Efficient Loader` | 移植自 efficiency，`⚡` 前缀可与原版并存 |
| 🚀 效率节点 | 🚀 效率采样器 | `⚡ KSampler (Efficient)` | — |
| 🚀 效率节点 | 🚀 效率采样器(高级) | `⚡ KSampler Adv. (Efficient)` | — |
| 🚀 效率节点 | 🚀 DiT 效率加载器 | `⚡ DiT Efficient Loader` | 加载分离文件 DiT 模型（Anima / Z-Image / ZiB / Krea-2 等） |
| 🚀 效率节点 | 🚀 保存图像 | `⚡ 保存图像` | 带 XY Plot 拼接输出 pin 的保存节点 |
| 🚀 效率节点 | 🚀 模型组合加载器 | `⚡ Model Set Loader` | 分别选 unet/clip/vae，一次输出 MODEL+CLIP+VAE，每槽支持 `[none]` |
| 🎨 Prompt Studio | 🎨 合并文本 | `⚡ Prompt Studio Merge Text` | 最多 20 个动态 STRING 输入 + 可调分隔符 |
| 🎨 Prompt Studio | 🎨 预设文本 | `WindMixPresetText` | 可增删/拖拽/启停的多行文本，支持预设管理器 |
| 🎨 Prompt Studio | 🎨 Prompt Studio 双提示词输出 | `PromptStudioOutput` | 移植自 Studio-Suite 的 iframe 提示词编辑器 |
| 🎨 Prompt Studio | 🎨 Prompt Studio 正向输出 | `PromptStudioPositiveOutput` | 同上，只输出正向 |
| 🎨 Prompt Studio | 🎨 Prompt Studio 反向输出 | `PromptStudioNegativeOutput` | 同上，只输出反向 |
| 📊 xy图表 | 📊 XY 图表 | `⚡ XY Plot` | XY Plot 引擎，输出拼接网格图 |
| 📊 xy图表 | 📊 XY 输入: LoRA | `⚡ XY Input: LoRA` | 按 LoRA 换轴（含文件夹筛选、tag 注入） |
| 📊 xy图表 | 📊 XY 输入: LoRA 图表 | `⚡ XY Input: LoRA Plot` | LoRA 轴专用图表变体 |
| 📊 xy图表 | 📊 XY 输入: UNet模型 | `⚡ XY Input: UNet Model` | 按 UNet 模型换轴 |
| 📊 xy图表 | 📊 XY 输入: LoRA2 | `WindMixLoraXY` | LoRA 轴（WindMix 版，行 UI 动态显隐） |
| 📊 xy图表 | 📊 XY 输入: UNet2 | `WindMixUNetXY` | UNet 轴（带文件夹筛选 UI） |
| 📊 xy图表 | 📊 XY 输入: UNet3 | `WindMixUNet3XY` | UNet/DiT 轴（外部 MODEL 对象接入，动态接口） |
| 🧩 杂项 | 🧩 Fancy Timer Node | `FancyTimerNode` | 定时 / 延时触发节点 |
| 🧩 杂项 | 🧩 Prompt Groups | `WindMix_PromptGroups` | 按分隔行切组、批量输出提示词 |
| 🧩 杂项 | 🧩 Wildcard Concat (Dynamic) | `Wind_WildcardConcat_Dynamic` | 动态通配符拼接（含 `/wildmix/` 路由） |
| 🧩 杂项 | 🧩 分辨率 | `WindMix_Resolution` | 常用分辨率预设 |
| 🧩 杂项 | 🧩 图像对比 | `WM Image Compare` | 图像对比节点（保存对比结果，`/wm_compare/save`） |

---

## 三、模块说明

### 1. 名称加载器（📦）

用文本框输入模型名（与文件名一致，不含扩展名）加载，方便在脚本 / 批处理中引用，不必每次从下拉框选。

### 2. 效率节点（🚀）

移植自 [`efficiency-nodes-comfyui`](https://github.com/LucianoCirino/efficiency-nodes-comfyui)，加 `⚡` 前缀可与原版并存：

- 单模型、SDXL、DiT 三类加载器 / 采样器。
- **DiT 相关 Baked VAE 默认 `"None"`**（内部哨兵同步），非 DiT 模型行为不变。
- `🚀 DiT 效率加载器` 是 `📊 XY 输入: UNet3` / `📊 XY 输入: UNet模型` 等 DiT 换轴功能的**前置依赖**。

### 3. 模型组合加载器（🚀）

分别指定 `unet / clip / vae` 三个槽位（每槽支持 `[none]`），委托原生 `UNETLoader` / `CLIPLoader` / `VAELoader` 一次性输出 `MODEL+CLIP+VAE`，支持 GGUF 与 dtype 选择。参考自 ComfyUI-TJ_NODE 的 `model_set_loader`。

### 4. Prompt Studio（🎨）

- **🎨 合并文本**：——最多 20 个 `forceInput` STRING 动态接口（接上自动追加下一个、断开自动清理），可调分隔符，输出「合并文本」(单值) 与「文本列表」(列表)。标点清理函数内联，自包含不依赖 ZML 插件。
- **🎨 Prompt Studio 输出**（双 / 正向 / 反向）：移植自 Studio-Suite 的 iframe 提示词编辑器，用于可视化编辑复杂提示词，自带分组标签、历史、收藏、自动补全。
  > ⚠️ iframe 编辑器**禁止 `<script type="module">`**（会破坏 ComfyUI 的 combo 初始化）。翻译 / 自动补全等扩展必须用普通 `<script>`，并硬刷验证。

### 5. 预设系统（🎨 预设文本 + 预设管理器）

节点 `🎨 预设文本` 的数据由内置**预设管理器**维护（前端弹窗），支持：

- 大分类 / 小分类两级组织，拖拽排序、重命名、归类。
- 卡片增删、启停、拖拽排序；卡片可设**缩略图**（上传或拖拽，文件名按 `cn_<卡片名>_<短uuid>.jpg` 命名）。
- 文本行按**分隔符**拼接输出（默认分隔符字面量 `,\n\n`，由 `execute` 转真实换行）。
- 弹窗内含自动补全（共用 Danbooru 中文词库）。
- 视图状态（当前小分类 + 左栏展开集合）持久化到 `localStorage`，重开自动恢复。

数据文件：`presets/preset_text.json`

```json
{
  "folders": [ { "name": "摄影提示词", "parent": "" } ],
  "presets": [ { "id": "…", "name": "…", "content": "…", "folder": "…", "parent": "…", "image": "images/xxx.jpg" } ]
}
```

`parent=""` 表示大分类；导入 JSON 时若含 `folder` / `parent` 会自动补建缺失分类。

### 6. XY 网格（📊）

由 `⚡ XY Plot` 引擎驱动，配合各类「XY 输入」节点生成参数网格图：

- **📊 XY 输入: LoRA**：按 LoRA 换轴，支持「LoRA Names+Tags」模式（产出 4 元组，tag 自动拼入正提示词）、文件夹筛选、正向提示词 tag 注入。
- **📊 XY 输入: UNet2**：按 UNet 模型换轴，带文件夹筛选 UI（根目录 `""` 语义 = 全部）。
- **📊 XY 输入: UNet3**：**外部 MODEL 对象**接入版——`model1..model20` 动态接口（接上 modelN 自动出现 modelN+1），可接单模型或**融合模型**（两个及以上模型经融合节点输出的对象，非本地文件）。
  - 须接 **🚀 DiT 效率加载器**（`is_dit=True`）。
  - 已对齐按名加载路径：融合模型自动继承 Loader 的 **LoRA** 与 **shift**（注入前先克隆模型，避免污染原始对象或在网格多格间叠加权重）。
  - ⚠️ 融合模型须与 Loader 同 family（同 CLIP/VAE 类型），否则编码 / 解码维度不匹配会畸形。
- **📊 XY 输入: LoRA2**：WindMix 自有版本，行 UI 用 DOM 渲染，数据存隐藏字段 `lora_data`，支持 ⠿ 手柄拖动排序。

### 7. 杂项（🧩）

- **🧩 Prompt Groups**：按分隔行（separator 模式）或空行（line 模式）切分组，批量输出多组提示词；切换模式时对应参数自动显隐。
- **🧩 Wildcard Concat (Dynamic)**：动态通配符拼接，含 `/wildmix/` 路由与 `wildcards/` 词库。
- **🧩 Fancy Timer Node**：定时 / 延时触发。
- **🧩 分辨率**：常用分辨率预设。
- **🧩 图像对比**：图像对比结果保存。

---

## 四、HTTP API 路由

### `api.py`（预设管理器 / 模型列表）

| 方法 | 路由 | 用途 |
|---|---|---|
| GET | `/windmix/lora_metadata` | 读取 LoRA `metadata.json`（供 tag 自动填充） |
| GET | `/windmix/loras` | 列出可用 LoRA（支持按文件夹筛选） |
| GET | `/windmix/unets` | 列出可用 UNet 模型 |
| GET | `/windmix/preset_text/presets` | 读取预设树（支持过滤） |
| POST | `/windmix/preset_text/presets` | 预设增删改 / 排序 / 移动 / 导入 / 复制 / 分类管理 |
| POST | `/windmix/preset_text/image` | 上传卡片缩略图（按卡片名命名） |
| GET | `/windmix/preset_text/image` | 读取缩略图 |

### `nodes/`（节点自带）

| 方法 | 路由 | 来源节点 |
|---|---|---|
| GET | `/windmix/font/{filename}` | 🧩 Fancy Timer Node |
| GET | `/wildmix/wildcards/files` | 🧩 Wildcard Concat (Dynamic) |
| GET | `/wildmix/wildcards/lines` | 🧩 Wildcard Concat (Dynamic) |
| POST | `/wm_compare/save` | 🧩 图像对比 |



---

## 五、目录结构

```
ComfyUI-WindMix/
├── __init__.py                    # 节点注册入口（NODE_MODULES 循环导入 + WEB_DIRECTORY）
├── api.py                         # /windmix/* HTTP 路由
├── README.md
├── .gitignore
├── nodes/
│   ├── WindMix_ModelLoaderWithName.py      # 📦 Checkpoint / UNET Loader With Name
│   ├── WindMix_PromptGroups.py             # 🧩 Prompt Groups
│   ├── Wind_WildcardConcat_Dynamic.py      # 🧩 Wildcard Concat
│   ├── Fancy_Timer_Node.py                 # 🧩 Fancy Timer
│   ├── wind_efficiency_nodes.py            # 🚀 效率 / DiT 加载采样器（上游改名）
│   ├── wind_utils.py                       # 上游 tsc_utils 改名
│   ├── windmix_lora_nodes.py               # 🎛️ LoRA Stack / Loader
│   ├── windmix_model_set_loader.py         # 🚀 模型组合加载器
│   ├── windmix_merge_text.py               # 🎨 合并文本
│   ├── windmix_preset_text.py              # 🎨 预设文本
│   ├── windmix_resolution.py               # 🧩 分辨率
│   ├── windmix_image_compare.py            # 🧩 图像对比
│   ├── windmix_xy_inputs.py                # 📊 XY 输入: LoRA2 / UNet2 / UNet3
│   ├── xy/                                 # XY 子包
│   │   └── xy_plot_nodes.py                # 📊 XY 图表 + XY 输入: LoRA / LoRA 图表 / UNet模型
│   └── py/                                 # 上游 helper（bnk_* / smZ_*，保留原 CATEGORY）
├── web/                           # 前端扩展（每个节点模块配套 .js）
│   ├── windmix_*.js               # 各节点前端
│   ├── js/
│   │   ├── efficiency/            # 效率节点前端
│   │   └── prompt_studio/         # 主页面补全引擎 + iframe 控制器
│   ├── prompt_bundle/             # Prompt Studio 预编译 bundle
│   └── prompt_static/             # Prompt Studio iframe 静态资源（图标 / 样式扩展）
├── prompt_studio/                 # Studio-Suite 移植
│   ├── nodes.py                   # Prompt Studio 三个输出节点
│   ├── api.py                     # WM_* 路由
│   ├── model_info.py
│   └── storage/                   # 词库（进库）+ 运行时数据（已 gitignore）
├── presets/                       # 预设管理器数据
├── wildcards/                     # 通配符词库
├── Font/                          # Fancy Timer / 计时胶囊用的 DS-Digital 字体
└── example_workflows/             # 示例工作流
```

---

## 六、常见问题 / 注意事项

1. **与原插件共存**
2. **从旧版升级**：早期版本用过 `efficiency_nodes.py` / `tsc_utils.py` 等上游原名，升级时建议**整体覆盖** `ComfyUI-WindMix/` 目录，避免旧文件残留造成 `sys.modules` 冲突。
3. **DiT 换轴前置**：`📊 XY 输入: UNet3` / `📊 XY 输入: UNet模型` 必须接 `🚀 DiT 效率加载器`；融合模型须与 Loader 同 family。
4. **改动生效条件**：JS 改完硬刷即可；`api.py` / `*.py` 改动**必须重启 ComfyUI**。
5. **XY 标签字体**：默认走系统字体（见「依赖」）。若某台机器系统字体都不匹配，可在 `Font/` 放一份 `AlibabaPuHuiTi-3-55-Regular.ttf`，会被优先使用。
6. **模型预览图**：模型中带文件夹里放**同名图片**（`xxx.safetensors` ↔ `xxx.png` / `xxx.preview.png`）即会显示在预览浮窗；没有同名图就不显示（不再依赖其他插件的预览数据）。
7. **运行时数据**：`prompt_studio/storage/prompt_data/` 与 `notes/` 由 ComfyUI 运行时自动创建（见 `api.py::_ensure_dirs`），已加入 `.gitignore`。

---

## 七、二次开发

- 每个节点模块末尾自带 `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS`；`__init__.py` 通过 `NODE_MODULES` 列表循环导入，`nodes/xy/` 作为子包单独导入。
- 新增节点须有 `WEB_DIRECTORY="./web"`（已在根 `__init__.py` 处理）。
- 前端扩展统一在 `web/` 下，用 `app.registerExtension` + `beforeRegisterNodeDef` 钩子；控件显隐需同时兼容 Nodes 1.0 画布与 Nodes 2.0 Vue 渲染器（同时写 `widget.hidden` 与 `_state.options.hidden`）。
- 节点文本框等持久化数据走 `required` 段 widget（隐藏可视框但保留序列化），注意不要把内部存储口暴露为可连接输入。
- **Prompt Studio 是父子 iframe 结构**：改 `postMessage` / `CustomEvent` / `localStorage` 协议名时，**两侧必须同时改**，漏一侧会静默失效。

---

## 八、致谢

本插件是「收编」性质的集合，绝大多数节点逻辑来自以下开源项目，版权归原作者所有：

| 上游项目 | 收编内容 |
|---|---|
| [efficiency-nodes-comfyui](https://github.com/LucianoCirino/efficiency-nodes-comfyui)（Luciano Cirino） | 🚀 效率节点全部、📊 XY Plot 引擎 |
| ComfyUI-Studio-Suite | 🎨 Prompt Studio（iframe 编辑器 + 节点 + 路由） |
| [sd-webui-prompt-all-in-one](https://github.com/Physton/sd-webui-prompt-all-in-one)（Physton） | Prompt Studio iframe 的编辑器前端与词库体系 |
| ComfyUI-CRT-Nodes | 🧩 Fancy Timer Node |
| ComfyUI-ZML-Image | 🎨 合并文本（思路参考，代码自包含） |
| ComfyUI-FRED-Nodes_v2 | 📦 Checkpoint / UNET Loader With Name |🧩 Wildcard Concat|



移植代码请遵循各上游项目的原始许可；**分发或商用前请自行确认上游许可条款**。

---

## 九、许可

本仓库自身的组织代码以 **MIT** 授权（见 `LICENSE`，如未附则视为待定）；
自上游移植的部分版权归原作者，遵循其原始许可。
