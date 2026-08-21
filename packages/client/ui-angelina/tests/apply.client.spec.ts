// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-angelina/client'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const register = vi.fn(() => () => {})
  const theme = {
    getTheme: () => ({ preference: 'system' as const }),
    register,
    setTheme: vi.fn(),
  }
  ctx.provide('theme', theme as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, register, theme }
}

describe('ui-angelina apply', () => {
  it('declares the browser-facing dependencies', () => {
    expect(inject).toEqual(['slots', 'locale', 'theme'])
  })

  it('registers and removes the Angelina theme definitions', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.register).toHaveBeenCalledTimes(2)
    expect(b.theme.setTheme).not.toHaveBeenCalled()
    await fiber.dispose()
  })
})
