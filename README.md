# @dsh-external/dsh-voxel-2d — 体素三维转二维视觉工作台

以 [yjh051108/voxel-3d-to-2d](https://github.com/yjh051108/voxel-3d-to-2d)（《压缩三维为二维：大语言模型体素空间推理的实证研究》）为基准的 DSH 混合形态插件（工具 + UI 面板）。

**工程范式落地**（实验的核心结论）：*二维是模型的推理画布，三维一致性必须交给代数兜底*——体素世界以逐层 2D 切片为状态，模型只做 2D 层编辑；堆叠、正交三视图投影、重力、跨视图一致性、不变量校验与自动修复全部由确定性代码完成。

## 宿主工具（10 个 voxel_*）

| 工具 | 作用 | 对应实验表示法 |
|---|---|---|
| `voxel_world_init` | 创建/重置世界（4..16³，可带演示） | — |
| `voxel_demo` | 载入真值演示：house(80)/tower(127)/chimney-house(83) | probe.ps1/probe2.ps1 的 New-GT* |
| `voxel_layer_get` / `voxel_layer_set` | 读/写单层 2D 网格（模型只编辑单层） | B · Y 层 2D 切片 |
| `voxel_world_build` | 按 Y 层切片批量堆叠成 3D（JSON 或 yN: 文本） | B |
| `voxel_export_coords` | 导出 [x,y,z] 坐标表 | A · 直接 3D 坐标 |
| `voxel_project_views` | TOP/FRONT/SIDE 正交投影 + 跨视图一致性 + 门洞一致性 | C · 正交三视图 |
| `voxel_gravity` | 列式物理：指定类型（缺省 sand）方块下落压实 | 实验阶段 3 |
| `voxel_validate` | 不变量校验：无支撑块/地板实心/门高≥2/室内空心 | 生成后校验器 |
| `voxel_render_iso` | 等距 ASCII 渲染，聊天内"看见"三维成果 | — |

坐标约定与 probe.ps1 完全一致：切片行从上到下 z 递减、列 x 递增；三视图行 y/z 递减。

## 视觉面板（conversation.view）

- **3D 视图**：Canvas 等距渲染（画家算法 + 朝向感知可见面），拖拽旋转/滚轮缩放/双击复位；
- **Y 层切片**：逐层 2D 网格，点击放置/右键清除（可选方块类型）——面板即"2D 画布"；
- **三视图**：TOP/FRONT/SIDE 投影 + 跨视图违规红色高亮 + 门洞一致性；
- **校验报告**：确定性不变量清单 + 一键自动修复（补地板→补门高→补支撑）。
- 面板与工具共享同一世界（宿主 `/@dsh-external/dsh-voxel-2d/api` 读写，1.5s 轮询）。

## 构建与注入

```bash
DSH_CHECKOUT=<dsh 源码 checkout> bash scripts/build.sh   # host: tsc → lib/
npm run build:client                                     # client: tsdown → lib/client.js
```

注入器环境内：`dev_build_plugin <本目录>` → `dev_inject_plugin <本目录>`；
改代码后 `dev_reload_package dsh-voxel-2d`（若子模块未刷新，先 uninject 再 inject）。

## 已知语义（与实验一致的诚实行为）

- 「无支撑块」对屋顶横跨空心室内、螺旋台阶等合法悬空会误报——仅作参考，不参与总体判定（实验方法学备注原话）；
- 重力只落沙类方块（石材合法悬空，Minecraft 语义）；
- 门洞一致性：FRONT 正交投影会被后墙填满，完整小屋的 FRONT 看不到门缝属正常遮挡；
- 三视图跨视图一致性：三张正交投影一般不唯一确定体素网格（离散断层成像），违规高亮正是实验结论的可视化。
