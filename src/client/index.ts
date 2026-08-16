/**
 * @dsh-external/dsh-voxel-2d — 粒子化建模 + 体素化工作流面板（conversation.view）。
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
    ctx.slots.register({ name: 'conversation.view', id: 'dsh-voxel-2d-panel', label: '🧊 粒子化建模', order: 20 }, () =>
      React.createElement('div', {
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
