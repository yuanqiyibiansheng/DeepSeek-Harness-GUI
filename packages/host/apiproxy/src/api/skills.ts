/**
 * skills domain contract: read-only skill catalog lookup addressed by session.
 * The session's header cwd resolves to the canonical project root host-side —
 * the client never submits a raw path, and skill lookup never creates or
 * resumes an Agent.
 *
 * Management methods (listManaged / updateManaged / removeManaged) address the
 * USER skill root only (`~/.dsh/skills`): that is the one root the UI owns.
 * Project and bundled roots stay untouched by this surface.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Skill catalog row (wire projection of the host SkillSummary; provider/source vocabulary stays host-side). */
export interface SkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`): invocable here, absent from the model catalog. */
  readonly modelInvocable: boolean
}

/** One user-managed skill row, richer than the catalog projection. */
export interface ManagedSkillEntry {
  /** Kebab-case identifier. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Whether the model catalog may invoke this skill. */
  readonly modelInvocable: boolean
  /** Whether the user may invoke this skill (`/name`). */
  readonly userInvocable: boolean
  /** Absolute path of the SKILL.md (or flat .md) file. */
  readonly path: string
  /** Whether the body is loadable (frontmatter parses). */
  readonly loadable: boolean
}

/** Skill-frontmatter toggles the manager writes. Absent fields are left untouched. */
export interface SkillToggleInput {
  /** Set `disable-model-invocation`; omitted leaves the field untouched. */
  readonly modelInvocable?: boolean
  /** Set `user-invocable`; omitted leaves the field untouched. */
  readonly userInvocable?: boolean
}

/**
 * Skill-domain unary methods (the map key skill.* of RpcMethodMap). Listing
 * is the domain's only RPC: invocation itself is a plain `session.prompt`
 * whose leading `/name` token the host recognizes at the pre-step boundary
 * (`dsh-tool-skill` injects the rendered body there), so every client shares
 * one deterministic path with no dedicated invocation wire.
 */
export interface SkillsApi {
  /** Lists the user-invocable skill catalog for the session's project. */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillEntry[] }>>

  /** Lists every user-owned skill in `~/.dsh/skills`, including disabled and unloadable ones. */
  listManaged(request: RpcRequest<{}>): Promise<RpcResponse<{ skills: readonly ManagedSkillEntry[] }>>

  /** Flip a user-owned skill's model/user invocation toggle by editing its frontmatter. */
  updateManaged(request: RpcRequest<{ name: string; toggle: SkillToggleInput }>): Promise<RpcResponse<ManagedSkillEntry>>

  /** Delete a user-owned skill (its whole skill directory or flat file). */
  removeManaged(request: RpcRequest<{ name: string }>): Promise<RpcResponse<{ removed: true }>>
}
