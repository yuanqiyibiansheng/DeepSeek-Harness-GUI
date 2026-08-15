// @vitest-environment jsdom
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalShellRow } from '../src/client/TerminalShellRow.tsx'

/** Mount the shell preference row with a stubbed injected face. */
function mount(face: { defaultShell: () => string; setShell: (shell: string) => void }): () => void {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(TerminalShellRow as never, { ...face, t: (key: string) => key }))
  })
  return () => {
    act(() => { root.unmount() })
    container.remove()
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TerminalShellRow', () => {
  it('renders the persisted shell as the current selection', () => {
    const cleanup = mount({ defaultShell: () => 'cmd', setShell: vi.fn() })
    expect(document.body.textContent).toContain('Command Prompt')
    expect(document.body.textContent).toContain('terminal.shellSetting')
    cleanup()
  })

  it('persists a new selection from the menu', () => {
    const setShell = vi.fn()
    const cleanup = mount({ defaultShell: () => 'pwsh', setShell })
    // Open the menu and choose Git Bash.
    const trigger = document.querySelector('button') as HTMLButtonElement
    act(() => { trigger.click() })
    act(() => {
      const items = [...document.querySelectorAll('button')]
      const gitBash = items.find(item => item.textContent?.includes('Git Bash'))
      expect(gitBash).toBeTruthy()
      gitBash?.click()
    })
    expect(setShell).toHaveBeenCalledWith('git-bash')
    cleanup()
  })

  it('closes the menu when the trigger is clicked again', () => {
    const cleanup = mount({ defaultShell: () => 'pwsh', setShell: vi.fn() })
    const trigger = document.querySelector('button') as HTMLButtonElement
    act(() => { trigger.click() })
    const menuList = () => [...document.querySelectorAll('button')].find(item => item.textContent?.includes('Git Bash'))
    expect(menuList()).toBeTruthy()
    act(() => { trigger.click() })
    expect(menuList()).toBeUndefined()
    cleanup()
  })
})
