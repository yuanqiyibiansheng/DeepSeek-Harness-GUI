import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, CallId, ReasoningEffortId, createMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { serializeMessages, serializeRequest } from '../src/serialize.ts'

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'deepseek-official', model: 'deepseek-v4-flash', messages: [], ...overrides }
}

function imageRef(mediaType: ImageAttachmentRef['mediaType'] = 'image/png'): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
    mediaType,
    bytes: 68,
    width: 1,
    height: 1,
  }
}

/** A minimal durable-store stub returning fixed bytes for every image. */
function stubAttachments(bytes: Uint8Array): AttachmentStore {
  return {
    readImage: async (ref: ImageAttachmentRef) => ({ ref, data: bytes }),
  } as unknown as AttachmentStore
}

const PNG_BYTES = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

describe('serializeMessages', () => {
  it('maps user text to string content', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'hello world' }])
  })

  it('maps system-role messages in history', async () => {
    const wire = await serializeMessages([
      createMessage({
        role: 'system', content: [{ type: 'text', text: 'be brief' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'system', content: 'be brief' }])
  })

  it('maps plain assistant text without reasoning_content', async () => {
    const wire = await serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking…' },
          { type: 'text', text: 'answer' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    // Tool-call-free turn: reasoning is dropped (ignored by the API anyway).
    expect(wire).toEqual([{ role: 'assistant', content: 'answer' }])
  })

  it('passes reasoning_content back on tool-call turns (official passback rule)', async () => {
    const wire = await serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'I should check the weather.' },
          { type: 'tool-call', id: CallId('call-1'), name: 'get_weather', arguments: '{"city":"Paris"}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{
      role: 'assistant',
      // "" (not null) on tool-call turns — mirrors the official samples'
      // verbatim message replay; some gateways reject null.
      content: '',
      reasoning_content: 'I should check the weather.',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
    }])
  })

  it('serializes parallel tool calls in order', async () => {
    const wire = await serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'tool-call', id: CallId('a'), name: 'one', arguments: '{}' },
          { type: 'tool-call', id: CallId('b'), name: 'two', arguments: '{}' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    const assistant = wire[0] as { tool_calls: { id: string }[] }
    expect(assistant.tool_calls.map(call => call.id)).toEqual(['a', 'b'])
  })

  it('turns tool results into role:tool messages', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('call-1'),
          content: [{ type: 'text', text: 'Sunny 22C' }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'call-1', content: 'Sunny 22C' }])
  })

  it('sends a sentinel for empty tool-result content', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [{ type: 'tool-result', toolCallId: CallId('call-1'), content: [] }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'call-1', content: '(no output)' }])
  })

  it('splits mixed user text + tool results into separate wire messages', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [
          { type: 'text', text: 'context note' },
          { type: 'tool-result', toolCallId: CallId('call-1'), content: [{ type: 'text', text: 'ok' }] },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([
      { role: 'user', content: 'context note' },
      { role: 'tool', tool_call_id: 'call-1', content: 'ok' },
    ])
  })

  it('skips plugin-added block types (merge-extensible ContentBlockMap)', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [
          { type: 'chart', data: 'x' } as unknown as ContentBlock,
          { type: 'text', text: 'see chart' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'user', content: 'see chart' }])
  })

  it('rejects a user image when no attachment store is mounted instead of dropping it', async () => {
    await expect(serializeMessages([createUserMessage({
      content: [{ type: 'image', attachment: imageRef() }],
      source: { kind: 'plugin', plugin: 'test' },
    })])).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })

  it('rejects an image in a system message even when an attachment store is mounted', async () => {
    await expect(serializeMessages([
      createMessage({
        role: 'system',
        content: [{ type: 'image', attachment: imageRef() }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ], stubAttachments(PNG_BYTES))).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })

  it('rejects an image in an assistant message even when an attachment store is mounted', async () => {
    await expect(serializeMessages([
      createMessage({
        role: 'assistant',
        content: [{ type: 'image', attachment: imageRef() }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ], stubAttachments(PNG_BYTES))).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })

  it('rejects an image inside a tool result even when an attachment store is mounted', async () => {
    await expect(serializeMessages([
      createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: CallId('call-1'),
          content: [{ type: 'image', attachment: imageRef() }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ], stubAttachments(PNG_BYTES))).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })

  it('encodes a user image block into an image_url base64 data URL', async () => {
    const ref = imageRef('image/png')
    const wire = await serializeMessages([
      createUserMessage({
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', attachment: ref },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ], stubAttachments(PNG_BYTES))
    expect(wire).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}` } },
      ],
    }])
  })

  it('emits a plain string when a user message has text plus an image-free attachment store', async () => {
    const wire = await serializeMessages([
      createUserMessage({
        content: [{ type: 'text', text: 'only text' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ], stubAttachments(PNG_BYTES))
    expect(wire).toEqual([{ role: 'user', content: 'only text' }])
  })

  it('emits an empty user message rather than dropping block-less messages', async () => {
    const wire = await serializeMessages([createUserMessage({
      content: [],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'user', content: '' }])
  })
})

describe('serializeRequest', () => {
  const history: Message[] = [createUserMessage({
    content: [{ type: 'text', text: 'hi' }],
    source: { kind: 'plugin', plugin: 'test' },
  })]

  it('always streams with usage and maps the basics', async () => {
    const wire = await serializeRequest(request({ messages: history }))
    expect(wire).toEqual({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      stream_options: { include_usage: true },
    })
  })

  it('prepends the system prompt', async () => {
    const wire = await serializeRequest(request({ messages: history, system: 'be helpful' }))
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'be helpful' })
    expect(wire.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('maps sampling params and stop sequences', async () => {
    const wire = await serializeRequest(request({ messages: history, temperature: 0.2, maxTokens: 100, stop: ['END'] }))
    expect(wire.temperature).toBe(0.2)
    expect(wire.max_tokens).toBe(100)
    expect(wire.stop).toEqual(['END'])
  })

  it('maps tools to the wire function shape', async () => {
    const wire = await serializeRequest(request({
      messages: history,
      tools: [
        { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } },
        { name: 'b', description: 'B', parameters: { type: 'object', properties: { x: { type: 'string' } } } },
      ],
    }))
    expect(wire.tools).toEqual([
      { type: 'function', function: { name: 'a', description: 'A', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'b', description: 'B', parameters: { type: 'object', properties: { x: { type: 'string' } } } } },
    ])
  })

  it('omits an empty tools array', async () => {
    const wire = await serializeRequest(request({ messages: history, tools: [] }))
    expect(wire.tools).toBeUndefined()
  })

  it('maps adapter-default thinking and the request reasoning effort', async () => {
    const wire = await serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('max') }),
      { thinking: 'enabled', reasoningEffort: 'high' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe('max')
  })

  it('maps off to disabled thinking without a wire reasoning effort', async () => {
    const wire = await serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('off') }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('re-enables thinking when max overrides an off default', async () => {
    const wire = await serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('max') }),
      { reasoningEffort: 'off' },
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBe('max')
  })

  it('rejects enabling thinking when the deployment is locked to disabled', async () => {
    await expect(serializeRequest(
      request({ messages: history, reasoningEffort: ReasoningEffortId('high') }),
      { thinking: 'disabled' },
    )).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
  })

  it('disables thinking for session-title requests without changing adapter defaults', async () => {
    const wire = await serializeRequest(
      request({
        messages: history,
        purpose: 'session-title',
        reasoningEffort: ReasoningEffortId('max'),
      }),
      { thinking: 'enabled', reasoningEffort: 'max' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('omits thinking fields when unset (provider default applies)', async () => {
    const wire = await serializeRequest(request({ messages: history }))
    expect(wire.thinking).toBeUndefined()
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('preserves an explicit enabled default without inventing a wire effort', async () => {
    const wire = await serializeRequest(request({ messages: history }), { thinking: 'enabled' })
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })

  it('rejects an effort outside the DeepSeek capability', async () => {
    await expect(serializeRequest(request({
      messages: history,
      reasoningEffort: ReasoningEffortId('medium'),
    }))).rejects.toMatchObject({ code: 'UNSUPPORTED_REASONING_EFFORT' })
  })

  it('serializes a user image into an image_url data URL through the request body', async () => {
    const wire = await serializeRequest(
      request({
        messages: [createUserMessage({
          content: [
            { type: 'text', text: 'describe it' },
            { type: 'image', attachment: imageRef('image/jpeg') },
          ],
          source: { kind: 'plugin', plugin: 'test' },
        })],
      }),
      undefined,
      stubAttachments(PNG_BYTES),
    )
    expect(wire.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'describe it' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(PNG_BYTES).toString('base64')}` } },
      ],
    })
  })
})

describe('review fixes: assistant content shapes', () => {
  it('serializes a content-less, tool-call-less assistant message as "" content, never null', async () => {
    // Aborted/empty assistant turns: no text, no calls → "". The earlier
    // null shape was live-falsified: the API 400s a null-content assistant
    // message without tool_calls ("content or tool_calls must be set").
    const wire = await serializeMessages([createMessage({
      role: 'assistant', content: [],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'assistant', content: '' }])
  })

  it('serializes a reasoning-ONLY assistant message as "" content with the reasoning dropped', async () => {
    // The model can answer entirely in the reasoning channel (a v4-flash
    // greeting did, live). The passback rule keeps reasoning_content off
    // plain turns, and content must still be SET — a null here poisoned the
    // session log and bricked every later turn of that session.
    const wire = await serializeMessages([createMessage({
      role: 'assistant', content: [{ type: 'reasoning', text: '你好！有什么我可以帮你的吗？' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire).toEqual([{ role: 'assistant', content: '' }])
  })

  it('serializes tool-call turns with empty string content, not null', async () => {
    const wire = await serializeMessages([createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: CallId('c'), name: 'f', arguments: '{}' }],
      source: { kind: 'plugin', plugin: 'test' },
    })])
    expect(wire[0]).toMatchObject({ content: '' })
  })
})
