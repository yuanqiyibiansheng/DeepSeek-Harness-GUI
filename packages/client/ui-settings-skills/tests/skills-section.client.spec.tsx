// @vitest-environment jsdom
/** Skills section behavior over a scripted wire face. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@deepseek-ai/dsh-client-connection/client'
import { SkillsSection } from '../src/client/SkillsSection.tsx'
import type { SkillsSectionInjected } from '../src/client/SkillsSection.tsx'
import { SkillsSettingsStore } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: SkillsSectionInjected['t'] = key => en[key]

/** A minimal skills wire face with scripted responses. */
function wire(overrides: Partial<IApiClient['skills']> = {}): Pick<IApiClient, 'skills'> {
  const ok = (value: unknown): RpcResponse<never> =>
    ({ rpcId: 'r', result: { ok: true, value: value as never } }) as unknown as RpcResponse<never>
  return {
    skills: {
      list: vi.fn(() => Promise.resolve(ok({ skills: [] }))),
      listManaged: vi.fn(() => Promise.resolve(ok({ skills: [
        { name: 'alpha', description: 'A test skill', modelInvocable: true, userInvocable: true, path: '/t/.dsh/skills/alpha/SKILL.md', loadable: true },
        { name: 'user-only', description: 'User only', modelInvocable: false, userInvocable: true, path: '/t/.dsh/skills/user-only/SKILL.md', loadable: true },
      ] }))),
      updateManaged: vi.fn(() => Promise.resolve(ok({ name: 'x', description: '', modelInvocable: true, userInvocable: true, path: '', loadable: true }))),
      removeManaged: vi.fn(() => Promise.resolve(ok({ removed: true }))),
      ...overrides,
    },
  }
}

function renderSection(api: Pick<IApiClient, 'skills'>): SkillsSettingsStore {
  const controller = new SkillsSettingsStore(api)
  render(
    <SkillsSection
      controller={controller}
      useSnapshot={fn => fn(controller.store.getSnapshot())}
      t={t}
    />,
  )
  return controller
}

describe('SkillsSection', () => {
  it('loads and lists user skills', async () => {
    const api = wire()
    renderSection(api)
    await waitFor(() => {
      expect(api.skills.listManaged).toHaveBeenCalled()
    })
    expect(await screen.findByText('alpha')).toBeTruthy()
    expect(screen.getByText('user-only')).toBeTruthy()
    expect(screen.getByText('A test skill')).toBeTruthy()
  })

  it('shows the empty state when no skills exist', async () => {
    const api = wire({ listManaged: vi.fn(() => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { skills: [] } } } as unknown as RpcResponse<never>)) })
    renderSection(api)
    expect(await screen.findByText(en.empty)).toBeTruthy()
  })

  it('toggles model invocation via updateManaged', async () => {
    const api = wire()
    renderSection(api)
    await screen.findByText('alpha')
    const toggleButtons = screen.getAllByRole('button', { name: new RegExp(en.modelOn) })
    fireEvent.click(toggleButtons[0] as HTMLButtonElement)
    await waitFor(() => {
      expect(api.skills.updateManaged).toHaveBeenCalledWith(
        { name: 'alpha', toggle: { modelInvocable: false } },
        undefined,
      )
    })
  })

  it('removes a skill with confirmation', async () => {
    const api = wire()
    renderSection(api)
    await screen.findByText('alpha')
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    expect(screen.getByText(en.removeSkill.replace('{name}', 'alpha'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.removeConfirm.replace('{name}', 'alpha') }))
    await waitFor(() => {
      expect(api.skills.removeManaged).toHaveBeenCalledWith({ name: 'alpha' }, undefined)
    })
  })
})
