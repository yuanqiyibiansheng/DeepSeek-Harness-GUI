/**
 * Standalone pet window page (desktop shell): renders the DeepSeek fat-fish
 * on a transparent, drag-anywhere, always-on-top window. Receives the agent's
 * activity phase over the same-origin `dsh:pet-activity` BroadcastChannel
 * that dsh-client-ui-pet forwards from the main window; the right-click menu
 * hides the window through the shell's `pet_control` command (the settings
 * switch brings it back). This page is NOT part of the Cordis composition —
 * it bundles the pet renderer sources directly.
 */

import { createElement, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { findBuiltinPet } from './vendor/builtinPets'
import type { PetAnimationState } from './vendor/petAnimation'
import { PetRenderer } from './vendor/PetRenderer'
import css from './pet-page.module.css'

/** Pet size in CSS pixels (window is 240x260; sprite keeps its own ratio). */
const PET_SIZE = 160

/** Phase carried by the activity bridge. */
type ActivityPhase = 'working' | 'thinking' | 'idle'

/** Map a runtime activity phase to a pet animation state. */
function phaseAnimation(phase: ActivityPhase | undefined): PetAnimationState {
  switch (phase) {
    case 'working': return 'running'
    case 'thinking': return 'waiting'
    default: return 'idle'
  }
}

/** Ask the desktop shell to control this window (no-op in a plain browser). */
function invokePetControl(action: 'show' | 'hide' | 'toggle'): void {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke(command: string, args?: unknown): Promise<unknown> }
  }).__TAURI_INTERNALS__
  if (internals === undefined) return
  try {
    void internals.invoke('pet_control', { action })
  } catch {
    // The shell bridge may be unavailable on first paint; ignore.
  }
}

/**
 * The pet window stage: animated sprite, drag region, and the right-click
 * hide menu.
 * @returns the stage element tree.
 */
function PetStage(): React.ReactElement {
  const [phase, setPhase] = useState<ActivityPhase | undefined>(undefined)
  const [transient, setTransient] = useState<PetAnimationState | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pet = findBuiltinPet('deepseek-fat-fish')

  useEffect(() => {
    const channel = new BroadcastChannel('dsh:pet-activity')
    channel.onmessage = (event: MessageEvent) => {
      const next = (event.data as { phase?: ActivityPhase } | null)?.phase
      if (next === 'working' || next === 'thinking' || next === 'idle') setPhase(next)
    }
    return () => { channel.close() }
  }, [])

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const close = (): void => { setMenuOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menuOpen])

  const playTransient = (state: PetAnimationState): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    setTransient(state)
    timerRef.current = setTimeout(() => {
      setTransient(null)
      timerRef.current = null
    }, 1_200)
  }

  const animationState: PetAnimationState = transient ?? phaseAnimation(phase)

  return (
    <div
      className={css.window}
      data-tauri-drag-region="deep"
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setMenuOpen(true)
      }}
    >
      <div className={css.stage}>
        <div
          className={css.mascot}
          role="img"
          aria-label={pet.displayName}
          title="拖动移动；右键隐藏"
          onClick={() => { playTransient('waving') }}
          onMouseEnter={() => {
            if (animationState === 'idle') playTransient('jumping')
          }}
        >
          <PetRenderer pet={pet} state={animationState} size={PET_SIZE} motionEnabled />
        </div>
        {menuOpen && (
          <div className={css.menu} role="menu">
            <button
              type="button"
              role="menuitem"
              className={css.menuItem}
              onClick={() => {
                setMenuOpen(false)
                invokePetControl('hide')
              }}
            >
              隐藏桌宠
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(createElement(PetStage))
