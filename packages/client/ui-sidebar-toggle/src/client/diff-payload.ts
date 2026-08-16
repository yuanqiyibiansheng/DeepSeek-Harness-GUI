/** Payload returned by the local desktop rollback service. */
export interface DiffPayload {
  ok?: boolean
  root?: string
  cwd?: string
  files?: string
  numstat?: string
  stat?: string
  diff?: string
  newFiles?: string
  fingerprint?: string
  /** True for the session-baseline review served in non-git workspaces. */
  snapshot?: boolean
  error?: string
}
