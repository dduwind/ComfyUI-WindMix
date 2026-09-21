# presets

预设文本库存放目录，供节点 **`📝 预设文本`** 与 **预设管理器** 面板使用。

## 为什么这里是空的

本仓库**不附带任何预设内容**。预设是各人自己攒的提示词片段，通常含私人角色名、
私人分类和未公开的创作素材，不适合随代码一起分发。

首次启动 ComfyUI 时，插件会在这里**自动创建**一个空的 `preset_text.json`
（见 `api.py::_wm_read_presets`）。你在节点或管理器里新增的预设会写进这个文件，
它已被 `.gitignore` 排除，不会上传。

## 目录约定

```
presets/
├─ preset_text.json      ← 预设数据（自动创建，不随仓库分发）
└─ images/               ← 预设卡片配图（自动创建，不随仓库分发）
   └─ cn_<卡片名>_<短id>.jpg
```

两个都是**按需自动创建**：`preset_text.json` 在首次读取时生成，`images/`
在第一次上传配图时生成。缺失不会报错。

## 数据结构

`preset_text.json` 是单个 JSON 文件：

```json
{
  "folders": [
    { "name": "未分类", "parent": "" }
  ],
  "presets": [
    {
      "id": "p_1a2b3c4d5e6f",
      "name": "示例预设",
      "content": "1girl, solo, long hair",
      "folder": "未分类",
      "parent": "",
      "image": ""
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 自动生成，形如 `p_` + 12 位十六进制。**不要手改**，增删改都靠它定位 |
| `name` | 卡片显示名 |
| `content` | 预设正文，插入节点输入框的文本 |
| `parent` | **大分类**（两级目录的第一层）。空串表示未归类 |
| `folder` | **小分类**（第二层）。空串表示未归类 |
| `image` | 配图的**相对路径**，形如 `images/cn_xxx_ab12cd.jpg`；无配图为空串 |

`folders` 是扁平的 `{name, parent}` 列表，两层结构由 `parent` 字段表达——
`parent` 为空串的条目就是大分类本身。旧版单层数据在读取时会被自动迁移
（见 `api.py::_wm_normalize_folders`）。

## 手工编辑须知

- 文件必须保持 **UTF-8** 编码，中文否则乱码
- 写入是**原子操作**（先写 `.tmp` 再 `os.replace`），手工编辑时别留下临时文件
- 手工改坏 JSON 会导致整个预设库读不出来。插件遇到解析失败会**返回空库**
  （不崩，但你的预设会看起来"消失"）——所以改之前先备份
- 想要版本控制或分享预设，直接从管理器里**导出**，比手改 JSON 安全

## 相关接口

| 路由 | 用途 |
|---|---|
| `GET /windmix/preset_text/presets` | 读取预设树与列表 |
| `POST /windmix/preset_text/presets` | 增删改、排序、移动、导入 |
| `POST /windmix/preset_text/image` | 上传卡片配图（压到最长边 512 的 JPEG） |
| `GET /windmix/preset_text/image` | 读取配图 |
