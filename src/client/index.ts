/**
 * @dsh-external/dsh-voxel-2d — client 面板（conversation.view 页签槽）。
 *
 * ⚠️ 与 slots 真实 API 对齐（2026-08 实测踩坑修正）：
 * - `register(options, component)` 是**双参**——component 是第二个位置参数，
 *   返回 ReactNode 的函数；`options.component` 字段会被忽略（旧骨架形态
 *   注册出的条目 component=undefined，页签渲染为空，正是此前面板不显示的原因）。
 * - conversation.view 是 list 型会话页签（聊天/轨迹同环），需在会话页头点击
 *   页签切换；label 可为字符串或 thunk。
 * - 组件挂载：React 组件无法直接返回原生 DOM，用 ref 回调把命令式面板
 *   挂进宿主 div（WeakSet 防重复挂载，面板自带 isConnected 轮询自停）。
 */
import React from 'react'
import { mountPanel } from './panel.js'

type SlotComponent = (props: unknown) => unknown
type SlotRegOptions = {
  name: string
  id: string
  label?: string | (() => string)
  order?: number
}
type SlotsService = {
  inject(key: string, callback: () => unknown): () => void
  register(options: SlotRegOptions, component: SlotComponent): () => void
}

type ClientContext = {
  slots: SlotsService
  effect(fn: () => void | (() => void), label?: string): void
}

export const inject = ['slots']

const MOUNTED = new WeakSet<HTMLElement>()

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'dsh-voxel-2d-panel',
        label: '🧊 体素工作台',
        order: 20,
      },
      () => React.createElement('div', {
        style: { padding: '12px 16px' },
        ref: (el: HTMLDivElement | null) => {
          if (el && !MOUNTED.has(el)) {
            MOUNTED.add(el)
            el.appendChild(mountPanel())
          }
        },
      }),
    ),
  ), '@dsh-external/dsh-voxel-2d: panel')
}
