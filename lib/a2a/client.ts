import {
  extractDemandsFromAgentCard,
  buildFulfillments,
  resolveMetadata,
  type PlatformConfig,
} from './extension-handler'
import type { ExtractedDemands, Fulfillments } from './extension-types'

/**
 * Generate a UUID v4 string with cross-browser compatibility
 * Falls back to crypto.getRandomValues() if crypto.randomUUID() is unavailable
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback using crypto.getRandomValues() for broader browser support
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> (c === 'x' ? 0 : 3);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface AgentCard {
  name: string
  url: string
  description?: string
  skills?: Array<{ id: string; name: string; description: string }>
  securitySchemes?: Record<string, any>
  capabilities?: {
    streaming?: boolean
  }
  extensions?: string[]
}

// Extension configuration for A2A requests
export interface A2AExtensionConfig {
  // Settings extension configuration (for BeeAI/AgentStack compatibility)
  settings?: {
    thinking_group?: {
      thinking?: boolean
    }
    [key: string]: unknown
  }
  // Other extensions can be added here
  [key: string]: unknown
}

// Configuration options for the A2A client
export interface A2AClientConfig {
  apiKey?: string
  extensions?: A2AExtensionConfig
  platformConfig?: PlatformConfig  // Platform configuration for fulfillments
}

export interface A2AError {
  code: number
  message: string
  data?: any
}

// A2A Message types per official guide
export interface A2AMessagePart {
  kind: 'text' | 'file' | 'data'
  text?: string
  file?: {
    name: string
    mimeType: string
    bytes?: string
    uri?: string
  }
  data?: Record<string, unknown>
}

export interface A2AMessage {
  role: string
  messageId: string
  parts: A2AMessagePart[]
}

// Stream response types per official A2A guide
export interface StreamChunk {
  contextId?: string
  taskId?: string
  kind: 'status-update' | 'artifact-update'
  status?: {
    state: 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'input-required' | 'auth-required'
    message?: A2AMessage & { metadata?: Record<string, unknown> }  // Add metadata support
  }
  artifact?: {
    artifactId: string
    name?: string
    description?: string
    parts: A2AMessagePart[]
    metadata?: Record<string, unknown>  // Add metadata support
  }
  final?: boolean
}

export class A2AClient {
  private baseUrl: string
  private jsonRpcUrl: string
  private apiKey: string
  private extensions: A2AExtensionConfig
  private agentCard: AgentCard | null = null
  private platformConfig: PlatformConfig | null = null
  private extractedDemands: ExtractedDemands | null = null
  private fulfillments: Partial<Fulfillments> | null = null

  constructor(agentUrl: string, config: A2AClientConfig = {}) {
    // Normalize URL
    this.baseUrl = agentUrl.replace(/\/$/, '')
    // JSON-RPC endpoint per A2A guide
    this.jsonRpcUrl = `${this.baseUrl}/jsonrpc/`
    this.apiKey = config.apiKey || ''
    this.extensions = config.extensions || {}
    this.platformConfig = config.platformConfig || null
  }

  /**
   * Get configured extensions
   */
  getExtensions(): A2AExtensionConfig {
    return this.extensions
  }

  /**
   * Update extension configuration
   */
  setExtensions(extensions: A2AExtensionConfig): void {
    this.extensions = extensions
  }

  async initialize(): Promise<AgentCard> {
    // Agent card can be at root or .well-known, try root first per guide
    const response = await fetch(this.baseUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      // Fallback to .well-known
      const fallbackUrl = `${this.baseUrl}/.well-known/agent-card.json`
      const fallbackResponse = await fetch(fallbackUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      })

      if (!fallbackResponse.ok) {
        throw new Error(`Failed to fetch agent card: ${response.status} ${response.statusText}`)
      }

      this.agentCard = await fallbackResponse.json()
    } else {
      this.agentCard = await response.json()
    }

    if (!this.agentCard?.name || !this.agentCard?.url) {
      throw new Error('Invalid agent card: missing required fields')
    }

    // Extract extension demands from agent card
    this.extractedDemands = extractDemandsFromAgentCard(this.agentCard)

    // Build fulfillments if platform config is provided
    if (this.platformConfig) {
      this.fulfillments = buildFulfillments(this.platformConfig)
    }

    return this.agentCard
  }

  getAgentCard(): AgentCard | null {
    return this.agentCard
  }

  getJsonRpcUrl(): string {
    return this.jsonRpcUrl
  }

  /**
   * Get resolved metadata for A2A requests
   * Call this after initialize() to get metadata that fulfills agent demands
   */
  async getResolvedMetadata(): Promise<Record<string, unknown>> {
    if (!this.extractedDemands) {
      return {}
    }

    if (!this.fulfillments) {
      console.warn('No fulfillments configured. Agent may fall back to defaults.')
      return {}
    }

    return resolveMetadata(this.extractedDemands, this.fulfillments)
  }

  /**
   * Get extracted demands from agent card
   */
  getExtractedDemands(): ExtractedDemands | null {
    return this.extractedDemands
  }

  /**
   * Update platform configuration after initialization
   */
  setPlatformConfig(config: PlatformConfig): void {
    this.platformConfig = config
    this.fulfillments = buildFulfillments(config)
  }

  /**
   * Get current platform configuration
   */
  getPlatformConfig(): PlatformConfig | null {
    return this.platformConfig
  }

  /**
   * Build the base params object for A2A requests
   */
  private async buildRequestParams(message: string): Promise<Record<string, unknown>> {
    // Get resolved metadata from extension demands and fulfillments
    const resolvedMetadata = await this.getResolvedMetadata()

    const params: Record<string, unknown> = {
      message: {
        role: 'user',
        messageId: generateUUID(),
        parts: [{ kind: 'text', text: message }]
      }
    }

    // Include extension configuration if available
    // This allows the agent to access settings like thinking mode
    if (Object.keys(this.extensions).length > 0) {
      params.extensions = this.extensions
    }

    // Merge extension config with resolved metadata
    const hasResolvedMetadata = Object.keys(resolvedMetadata).length > 0
    if (hasResolvedMetadata) {
      params.metadata = {
        ...resolvedMetadata,
        ...(params.extensions || {})
      }
    }

    return params
  }

  async sendMessage(message: string): Promise<any> {
    const params = await this.buildRequestParams(message)

    const payload = {
      jsonrpc: '2.0',
      method: 'message/send',
      params,
      id: generateUUID()
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(this.jsonRpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()

    if (result.error) {
      const error = result.error as A2AError
      throw new Error(`Agent error: ${error.message} (code: ${error.code})`)
    }

    return result.result
  }

  async streamMessage(
    message: string,
    onChunk: (chunk: StreamChunk) => void | Promise<void>,
    onComplete?: () => void | Promise<void>
  ): Promise<void> {
    const params = await this.buildRequestParams(message)

    const payload = {
      jsonrpc: '2.0',
      method: 'message/stream',
      params,
      id: generateUUID()
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(this.jsonRpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`Stream request failed: ${response.status} ${response.statusText}`)
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()

          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.slice(6)

            // Skip empty data or [DONE] marker
            if (!dataStr || dataStr === '[DONE]') continue

            try {
              const data = JSON.parse(dataStr)

              if (data.error) {
                const error = data.error as A2AError
                throw new Error(`Stream error: ${error.message} (code: ${error.code})`)
              }

              if (data.result) {
                const chunk = data.result as StreamChunk
                await onChunk(chunk)

                // Check if stream is complete
                if (chunk.final === true && onComplete) {
                  await onComplete()
                }
              }
            } catch (parseError) {
              if (parseError instanceof SyntaxError) {
                console.warn('Failed to parse SSE data:', dataStr)
              } else {
                throw parseError
              }
            }
          }
        }
      }

      // Process any remaining data in the buffer
      if (buffer.trim().startsWith('data: ')) {
        const dataStr = buffer.trim().slice(6)
        if (dataStr && dataStr !== '[DONE]') {
          try {
            const data = JSON.parse(dataStr)
            if (data.result) {
              const chunk = data.result as StreamChunk
              await onChunk(chunk)
              
              if (chunk.final === true && onComplete) {
                await onComplete()
              }
            }
          } catch (e) {
            console.warn('Failed to parse final SSE data:', dataStr)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
