/** Composer shortcut for the existing Desktop visual-enhancement capability. */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  HoverCard, IconSparkle16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  VisionEnableProbe, VisionEnhancementState,
} from './vision-enhancement-controller.ts'
import { VisionEnhancementDialog } from './VisionEnhancementDialog.tsx'
import css from './VisionEnhancementRow.module.css'

/** Shared registration face for the Settings row and composer shortcut. */
export interface VisionEnhancementInjected {
  hooks: {
    /** Host-backed status bound by the slot renderer as useVisionEnhancement. */
    visionEnhancement: SnapshotStore<VisionEnhancementState>
  }
  /** Load status once when either entry first mounts. */
  load: () => Promise<void>
  /** Disable the capability through its existing Settings namespace. */
  disable: () => Promise<void>
  /** Verify a real image and enable the capability atomically. */
  enable: (input: VisionEnableProbe, signal?: AbortSignal) => Promise<string>
}

/** Full composer shortcut props. */
export type VisionEnhancementShortcutProps =
  PropsRuntime<'conversation.input.left'> & InjectFace<VisionEnhancementInjected>

function statusText(state: VisionEnhancementState): string {
  if (state.status === 'loading' || state.status === 'idle') return '正在读取状态'
  if (state.status === 'saving') return state.enabled ? '正在关闭' : '正在开启'
  if (state.status === 'error') return '状态异常，点击重新配置'
  if (state.enabled) return '已开启，点击关闭'
  return state.configured ? '已关闭，点击验证并开启' : '待配置，点击验证并开启'
}

function hoverContent(state: VisionEnhancementState): ReactNode {
  return (
    <div className={css.shortcutHover}>
      <div className={css.shortcutHoverTitle}>
        <span>视觉增强</span>
        <span className={state.enabled ? css.shortcutHoverOn : css.shortcutHoverStatus}>
          {state.enabled ? '已开启' : state.configured ? '已关闭' : '待配置'}
        </span>
      </div>
      <p>使用百炼 Qwen3.8 读取对话或工作区中的截图、照片、图表和图片文字，并把识别结果提供给 Agent。</p>
      <div className={css.shortcutHoverHint}>{state.error ?? statusText(state)}</div>
    </div>
  )
}

/** Render an always-visible, shared-state visual-enhancement switch in the composer. */
export function VisionEnhancementShortcut({
  useVisionEnhancement, load, disable, enable,
}: VisionEnhancementShortcutProps): ReactNode {
  const state = useVisionEnhancement(snapshot => snapshot)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [failure, setFailure] = useState<string>()

  useEffect(() => { void load() }, [load])

  const busy = state.status === 'idle' || state.status === 'loading' || state.status === 'saving'
  const activate = (): void => {
    setFailure(undefined)
    if (!state.enabled) {
      setDialogOpen(true)
      return
    }
    void disable().catch((error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error))
      setDialogOpen(true)
    })
  }

  return (
    <>
      <HoverCard
        openDelayMs={350}
        anchor={(
          <button
            type="button"
            className={state.enabled ? css.shortcutOn : css.shortcut}
            role="switch"
            aria-checked={state.enabled}
            aria-label={`视觉增强：${statusText(state)}`}
            disabled={busy}
            onClick={activate}
          >
            <IconSparkle16 size={14} />
            <span className={css.shortcutLabel}>视觉增强</span>
            {state.enabled && <span className={css.shortcutDot} aria-hidden />}
          </button>
        )}
        content={hoverContent(state)}
      />
      <VisionEnhancementDialog
        open={dialogOpen}
        configured={state.configured}
        failure={failure}
        enable={enable}
        onClose={() => { setDialogOpen(false) }}
      />
    </>
  )
}
