# @dsh-external/dsh-voxel-2d — 体素三维转二维视觉工作台 + 粒子化建模工作流

以 [yjh051108/voxel-3d-to-2d](https://github.com/yjh051108/voxel-3d-to-2d)（《压缩三维为二维：大语言模型体素空间推理的实证研究》）为基准的 DSH 混合形态插件。

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

## 粒子化建模面板（conversation.view）

- **5 阶段管线**：粒子采样 → 扩散 → 模糊云 → 云停留呼吸 → 网格凝固（SDF MarchingCubes）；
- **模糊云是终态**：不聚焦，模糊完成后停留并带 ±7% 呼吸浮动；
- **艺术风格策略**：写实 / 像素复古 / 黏土手办 / 水彩手绘，运行时可切换；
- **工作流按钮**：
  - `体素化并检查`：精细模 SDF → 体素 → 写入宿主世界 → 三转二校验；
  - `修复为素体`：调用宿主 `autoFix` 补地板/门高/支撑；
  - `素体→精细模`：把当前素体方块读回并叠加显示体素精细模；
  - `比对`：统计初始体素与当前素体的一致/差异块数，指导继续迭代。

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
