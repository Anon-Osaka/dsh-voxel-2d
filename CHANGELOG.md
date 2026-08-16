# Changelog

## 0.7.0 — 场景语义层（TYPE_META / WaterBodies / Manifest）

- 新增 `BlockTypeMeta` / `TYPE_META`：
  - `solid` / `liquid` / `transparent` / `emissive` / `decor`
  - `collidable`、`walkable`、`stepHeight`
  - `lightAnchor`、`water.surfaceOffset`、`water.freeboard`
- 新增 `VoxelWorld.waterBodies()`：按 6 邻域合并连通水体，输出水面/池底高度
- 新增 `VoxelWorld.lightAnchors()`：导出灯位锚点
- 新增 `VoxelWorld.sceneManifest()`：推荐渲染常量（净高/门洞/墙厚/水面/步高/玩家身高）
- `validate(mode='pool')` 新增“水体深度有效”检查
- `/api/state` 增加 `typeMeta`、`manifest`、`waterBodies`、`lightAnchors`、`blocksTyped`
- 新增工具 `voxel_scene_manifest`
- 调色板新增 `lamp`

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
