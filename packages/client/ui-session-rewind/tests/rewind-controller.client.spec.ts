// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { RewindController } from '../src/client/rewind-controller.ts'

describe('RewindController', () => {
  it('refetches checkpoints when a completed turn count changes after already being ready', async () => {
    const remote = {
      listTurnCheckpoints: vi.fn(async () => ({ ok: true as const, value: [] })),
      execute: vi.fn(async () => ({ ok: true as const, value: null as never })),
    }
    const controller = new RewindController(remote, 's1' as never)
    await controller.ensure(1)
    await controller.ensure(2)
    expect(remote.listTurnCheckpoints).toHaveBeenCalledTimes(2)
    expect(remote.listTurnCheckpoints).toHaveBeenNthCalledWith(1, 's1')
    expect(remote.listTurnCheckpoints).toHaveBeenNthCalledWith(2, 's1')
  })
})
