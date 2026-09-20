# wildcards

通配符词库目录，供节点 **`🎲 Wildcard Concat (Dynamic)`** 使用。

节点会**递归扫描**本目录下所有 `.txt`，在面板里列成文件列表；点开某个文件挑选行，
即可按 `string_delimiter` 拼接到提示词中。

## 自带词库

本目录随插件附带 **6 组赛博朋克风格的中文词库**，开箱即可用：

| 文件 | 内容 |
|---|---|
| `👗人物服装.txt` | 服装与装备 |
| `💇 发型.txt` | 发型 |
| `😊 面部表情.txt` | 表情 |
| `🧘 肢体动作.txt` | 动作姿态 |
| `🖼️ 构图.txt` | 镜头构图 |
| `🏞️ 场景.txt` | 环境场景 |

除此之外的词库请自行添加——各人的取向差异很大，且多为私人收集整理，
不适合随代码一起分发。把 `.txt` 放进本目录即可，或者用节点上的
`wildcards_dir` 输入框指向别处。

也可以用环境变量覆盖默认查找路径：

```bat
set WINDMIX_WILDCARDS_DIR=D:\my-wildcards
```

## 目录约定

```
wildcards/
├─ 👗人物服装.txt     →（下拉里显示为 “👗人物服装”）
├─ 🏞️ 场景.txt
└─ cyberpunk/        →  子目录会递归扫描
   ├─ Hair_Colors.txt →  下拉里显示为 “cyberpunk/Hair_Colors”
   └─ Lighting.txt
```

## 文件格式

```
1girl, solo, long hair
anime style, cel shading
```

- **一行 = 一个条目**，为空的行自动忽略
- 以 `#` 开头的行视为注释，会被跳过
- 文件名（不含 `.txt`）就是面板里显示的名字
- 编码请用 **UTF-8**，否则中文会乱码

## 路径解析顺序

1. **节点上的 `wildcards_dir` 输入框**——最高优先级。它默认会自动填好，
   你可以直接改成任意目录（绝对路径即可）。
2. 输入框留空时，回退到节点内部的 `_wildcards_dir()`，按下列顺序找：
   - 环境变量 `WINDMIX_WILDCARDS_DIR`
   - 插件根目录的 `wildcards/`（即本目录）
   - 节点同级的 `nodes/wildcards/`
   - 以上都没有 → 仍返回本目录路径（**不会报错**，面板只是显示空列表）
