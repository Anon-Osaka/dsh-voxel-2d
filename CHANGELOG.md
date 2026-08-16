# Changelog

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
