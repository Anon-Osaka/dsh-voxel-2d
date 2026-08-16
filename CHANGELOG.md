# Changelog

## 0.8.0 — 网页导出能力

- 新增 `voxel_export_webapp`：把当前体素世界导出为独立 HTML + Three.js 3D 查看器
- 新增 `voxel_export_cube`：导出 3×3 魔方单页应用骨架（自由旋转、层转按钮、打乱/求解播放接口）
- 插件现在可以参与“单页 HTML/Web 应用”类交付物，不再只是对话内体素工具

## 0.7.0 — 当前最新快照

- 同步 0.6.1 全部功能（Poolrooms / 水体语义、装配工作流、代码↔体素、强制门禁）
- 版本号推进到 0.7.0，作为当前本地/线上统一最新版本

## 0.6.1 — Poolrooms / 水体场景优化

- 新增 `LIQUID_TYPES` / `isLiquidType()`：
  - 水块不再触发“悬空”误报
  - 室内空心校验跳过液体
  - autoFix 不再为水体补支撑、不再填充含液体的水池列
- `validate()` 支持 `mode`：
  - `house`：小屋语义（兼容旧行为）
  - `pool`：水体场景（水不参与支撑/室内填充）
  - `generic`：仅基础不变量
- `voxel_validate` 工具新增 `mode` 参数
- `/api/state validate` 端点支持 `mode`
- 调色板新增 Poolrooms 类型：
  - `water`、`tile`、`wall`、`ceiling`、`foundation`、`fill`、`pool_floor`、`pool_edge`
- `blockColor(null)` 不再返回灰色，改为透明 `#00000000`
- 新增 `VoxelWorld.blocksTyped()`：带类型全量导出，方便外部渲染器直接使用
