/** Sprite renderer for the desktop pet, ported from cc-haha's PetRenderer. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import {
  PET_ATLAS_V2,
  getPetAnimationPlaybackStep,
  getPetAnimationPlaybackTickAtElapsedMs,
  getPetLookFrame,
  type PetAnimationState,
  type PetAtlasFrame,
  type PetLookDirection,
} from './petAnimation'
import type { PetDescriptor } from './petTypes'
import css from './pet.module.css'

type PetRendererProps = {
  pet: PetDescriptor
  state: PetAnimationState
  size: number
  motionEnabled: boolean
  lookDirection?: PetLookDirection | null | undefined
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function getPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches
  } catch {
    return false
  }
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getPrefersReducedMotion)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    let mediaQuery: MediaQueryList
    try {
      mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY)
    } catch {
      return
    }
    const handleChange = (event: MediaQueryListEvent): void => {
      setPrefersReducedMotion(event.matches)
    }
    setPrefersReducedMotion(mediaQuery.matches)
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
    } else {
      mediaQuery.addListener(handleChange)
    }
    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleChange)
      } else {
        mediaQuery.removeListener(handleChange)
      }
    }
  }, [])
  return prefersReducedMotion
}

const DADA_FRAME_CENTER_OFFSETS_X = {
  1: [8.5, 6.5, 7, 14, 13.5, 7, 3, -1.5],
  2: [-3.5, 3, 2.5, 3, 5, -2, -4.5, -7.5],
} as const

const DADA_FRAME_BASELINE_OFFSETS_Y = {
  1: [2, 3, 3, 0, 3, 0, 0, 0],
  2: [-6, 1, -1, 0, 0, 0, 0, 0],
} as const

function getDadaFrameOffset(
  frame: PetAtlasFrame,
  size: number,
  height: number,
): { offsetX: number; offsetY: number } {
  const rowOffsets = DADA_FRAME_CENTER_OFFSETS_X[
    frame.rowIndex as keyof typeof DADA_FRAME_CENTER_OFFSETS_X
  ]
  const baselineOffsets = DADA_FRAME_BASELINE_OFFSETS_Y[
    frame.rowIndex as keyof typeof DADA_FRAME_BASELINE_OFFSETS_Y
  ]
  return {
    offsetX: (rowOffsets?.[frame.columnIndex] ?? 0) * size / PET_ATLAS_V2.cellWidth,
    offsetY: (baselineOffsets?.[frame.columnIndex] ?? 0) * height / PET_ATLAS_V2.cellHeight,
  }
}

function getPetFrameOffset(
  petId: string,
  frame: PetAtlasFrame,
  size: number,
  height: number,
): { offsetX: number; offsetY: number } {
  return petId === 'dada-code'
    ? getDadaFrameOffset(frame, size, height)
    : { offsetX: 0, offsetY: 0 }
}

function getAtlasBackgroundStyle({
  atlasUrl,
  frame,
  offsetX,
  offsetY,
  size,
  height,
  pixelated,
}: {
  atlasUrl: string
  frame: PetAtlasFrame
  offsetX: number
  offsetY: number
  size: number
  height: number
  pixelated: boolean
}): CSSProperties {
  return {
    backgroundImage: `url(${JSON.stringify(atlasUrl)})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${size * PET_ATLAS_V2.columns}px ${height * PET_ATLAS_V2.rows}px`,
    backgroundPosition: `${-frame.columnIndex * size + offsetX}px ${-frame.rowIndex * height + offsetY}px`,
    imageRendering: pixelated ? 'pixelated' : 'auto',
  }
}

type PetPlaybackVisual = {
  frame: PetAtlasFrame
  motionState: PetAnimationState
  phase: 'action' | 'idle' | 'gaze'
}

function getInitialPetPlaybackVisual(
  requestedState: PetAnimationState,
  motionEnabled: boolean,
  lookDirection: PetLookDirection | null | undefined,
): PetPlaybackVisual {
  if (motionEnabled && requestedState === 'idle' && lookDirection !== undefined) {
    return {
      frame: getPetLookFrame(lookDirection),
      motionState: 'idle',
      phase: 'gaze',
    }
  }
  const step = getPetAnimationPlaybackStep(requestedState, 0)
  return {
    frame: step.frame,
    motionState: step.motionState,
    phase: step.phase,
  }
}

function usePetPlayback({
  requestedState,
  motionEnabled,
  lookDirection,
  usesAtlas,
  petId,
  size,
  height,
  spriteRef,
}: {
  requestedState: PetAnimationState
  motionEnabled: boolean
  lookDirection: PetLookDirection | null | undefined
  usesAtlas: boolean
  petId: string
  size: number
  height: number
  spriteRef: React.RefObject<HTMLDivElement>
}) {
  useLayoutEffect(() => {
    const sprite = spriteRef.current
    if (!sprite) return

    const applyVisual = ({ frame, motionState, phase }: PetPlaybackVisual): void => {
      sprite.dataset.petMotionState = motionState
      sprite.dataset.petMotionPhase = phase
      if (!usesAtlas) return
      const { offsetX, offsetY } = getPetFrameOffset(petId, frame, size, height)
      sprite.dataset.petRow = String(frame.rowIndex)
      sprite.dataset.petColumn = String(frame.columnIndex)
      sprite.style.backgroundPosition = `${-frame.columnIndex * size + offsetX}px ${-frame.rowIndex * height + offsetY}px`
    }

    const initialVisual = getInitialPetPlaybackVisual(requestedState, motionEnabled, lookDirection)
    applyVisual(initialVisual)
    if (!motionEnabled || (requestedState === 'idle' && lookDirection !== undefined)) return

    const startedAt = performance.now()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const updateFrame = (): void => {
      if (cancelled) return
      const tick = getPetAnimationPlaybackTickAtElapsedMs(
        requestedState,
        Math.max(0, performance.now() - startedAt),
      )
      applyVisual({
        frame: tick.frame,
        motionState: tick.motionState,
        phase: tick.phase,
      })
      timer = setTimeout(updateFrame, Math.max(1, Math.ceil(tick.remainingDurationMs)))
    }

    updateFrame()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [height, lookDirection, motionEnabled, petId, requestedState, size, spriteRef, usesAtlas])
}

export function PetRenderer({
  pet,
  state,
  size,
  motionEnabled,
  lookDirection,
}: PetRendererProps) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const effectiveMotionEnabled = motionEnabled && !prefersReducedMotion
  const atlasUrl = pet.source === 'custom' ? pet.dataUrl : pet.spritesheetUrl
  const usesAtlas = Number(pet.spriteVersionNumber) >= PET_ATLAS_V2.spriteVersionNumber
  const height = size * PET_ATLAS_V2.cellHeight / PET_ATLAS_V2.cellWidth
  const spriteRef = useRef<HTMLDivElement>(null)
  const playback = getInitialPetPlaybackVisual(state, effectiveMotionEnabled, lookDirection)
  usePetPlayback({
    requestedState: state,
    motionEnabled: effectiveMotionEnabled,
    lookDirection,
    usesAtlas,
    petId: pet.id,
    size,
    height,
    spriteRef,
  })
  const pixelated = pet.source === 'custom' && usesAtlas
  const frameOffset = getPetFrameOffset(pet.id, playback.frame, size, height)
  const style: CSSProperties = usesAtlas
    ? {
        width: size,
        height,
        ...getAtlasBackgroundStyle({
          atlasUrl,
          frame: playback.frame,
          ...frameOffset,
          size,
          height,
          pixelated,
        }),
      }
    : {
        width: size,
        height,
        backgroundImage: `url(${JSON.stringify(atlasUrl)})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        backgroundSize: 'contain',
        imageRendering: 'auto',
      }

  return (
    <div
      className={css.spriteStage}
      data-pet-motion={effectiveMotionEnabled ? 'enabled' : 'disabled'}
      style={{ width: size, height }}
    >
      <div
        ref={spriteRef}
        role="img"
        aria-label={pet.displayName}
        className={css.sprite}
        data-pet-source={pet.source}
        data-pet-state={state}
        data-pet-motion-state={playback.motionState}
        data-pet-motion-phase={playback.phase}
        data-pet-sprite-version={pet.spriteVersionNumber}
        style={style}
      />
    </div>
  )
}
