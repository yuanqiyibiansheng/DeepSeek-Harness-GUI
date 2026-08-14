/**
 * Curated one-click provider presets for the custom-provider create card.
 *
 * Each preset pre-fills the fields the card would otherwise ask for: a route
 * id, an endpoint, a wire protocol, and a starter model list. The user still
 * owns the result — a preset is a filled form, not a write — and the card's
 * existing gates (unique route, valid base URL, at least one model) keep
 * applying. The list is deliberately small and hand-maintained: every entry is
 * a default the harness can stand behind for the named endpoint, and a preset
 * that names a wrong default becomes a misleading one-click. 中转站
 * (OpenAI-compatible relays/aggregators) are the `relay` preset: any
 * `/v1/chat/completions`-speaking gateway, with model discovery offered by the
 * card's own "Fetch available models" action.
 */

import type { ModelDraft } from './ModelListEditor.tsx'

/** A starter model row: an id plus optional display name and capacities. */
export interface PresetModel extends ModelDraft {
  id: string
}

/** One one-click preset. */
export interface ProviderPreset {
  /** Stable preset id (also the default route id when the field is untouched). */
  id: string
  /** Human-facing name shown in the preset picker. */
  name: string
  /** One-line description of what this preset connects to. */
  description: string
  /** Default route id; the user can edit it before creating. */
  route: string
  /** Display name written into the provider profile. */
  displayName: string
  /** Wire protocol for this endpoint. */
  api: string
  /** Endpoint URL, or undefined when the preset relies on provider-native auth. */
  baseURL?: string
  /** Starter model catalog for this provider. */
  models: readonly PresetModel[]
}

/** The one-click presets offered above the custom-provider form. */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'OpenAI official API (gpt-5 family).',
    route: 'openai',
    displayName: 'OpenAI',
    api: 'openai-completions',
    baseURL: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5', contextWindow: 400_000 },
      { id: 'gpt-5-mini', contextWindow: 400_000 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Anthropic official API (Claude family).',
    route: 'anthropic',
    displayName: 'Anthropic',
    api: 'anthropic-messages',
    baseURL: 'https://api.anthropic.com',
    models: [
      { id: 'claude-sonnet-4-5', contextWindow: 200_000 },
      { id: 'claude-haiku-4-5', contextWindow: 200_000 },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    description: 'Google AI Studio / Vertex Gemini models.',
    route: 'google',
    displayName: 'Google Gemini',
    api: 'openai-completions',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { id: 'gemini-2.5-pro', contextWindow: 1_000_000 },
      { id: 'gemini-2.5-flash', contextWindow: 1_000_000 },
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Fast inference for open models.',
    route: 'groq',
    displayName: 'Groq',
    api: 'openai-completions',
    baseURL: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', contextWindow: 128_000 },
      { id: 'deepseek-r1-distill-llama-70b', contextWindow: 128_000 },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Aggregator routing many providers behind one key.',
    route: 'openrouter',
    displayName: 'OpenRouter',
    api: 'openai-completions',
    baseURL: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'deepseek/deepseek-chat', contextWindow: 128_000 },
      { id: 'anthropic/claude-sonnet-4.5', contextWindow: 200_000 },
    ],
  },
  {
    id: 'moonshot',
    name: 'Kimi (Moonshot)',
    description: 'Moonshot Kimi models.',
    route: 'moonshotai',
    displayName: 'Kimi (Moonshot)',
    api: 'openai-completions',
    baseURL: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'kimi-k2', contextWindow: 128_000 },
      { id: 'moonshot-v1-8k', contextWindow: 8_192 },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax models.',
    route: 'minimax',
    displayName: 'MiniMax',
    api: 'openai-completions',
    baseURL: 'https://api.minimaxi.com/v1',
    models: [
      { id: 'MiniMax-M1', contextWindow: 128_000 },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    description: 'Local models served by Ollama on this machine.',
    route: 'ollama',
    displayName: 'Ollama (local)',
    api: 'openai-completions',
    baseURL: 'http://127.0.0.1:11434/v1',
    models: [
      { id: 'qwen2.5:14b', contextWindow: 32_768 },
    ],
  },
  {
    id: 'relay',
    name: '中转站 / OpenAI-compatible relay',
    description: 'Any /v1/chat/completions gateway. Fill the base URL and fetch models.',
    route: 'relay',
    displayName: 'Relay (中转站)',
    api: 'openai-completions',
    models: [],
  },
]
