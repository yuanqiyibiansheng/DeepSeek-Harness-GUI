interface WindowControlsOverlay {
  readonly visible: boolean
  getTitlebarAreaRect(): DOMRect
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void
}

interface Navigator {
  readonly windowControlsOverlay?: WindowControlsOverlay
}