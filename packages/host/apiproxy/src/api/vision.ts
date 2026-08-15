/** Bailian vision-enhancement API contract. */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { RpcRequest, RpcResponse } from './rpc.ts'

export interface VisionStatusView {
  enabled: boolean
  configured: boolean
  model: 'qwen3.8-max'
  apiKeyUrl: string
}

export interface VisionTestView {
  model: 'qwen3.8-max'
  description: string
}

export interface VisionApi {
  status(request: RpcRequest<{}>): Promise<RpcResponse<VisionStatusView>>
  test(request: RpcRequest<{
    mediaType: ImageMediaType
    data: string
    question?: string
    name?: string
  }>, signal?: AbortSignal): Promise<RpcResponse<VisionTestView>>
  enable(request: RpcRequest<{
    apiKey?: string
    mediaType: ImageMediaType
    data: string
    question?: string
    name?: string
  }>, signal?: AbortSignal): Promise<RpcResponse<VisionTestView>>
}
