export interface AgentCard {
  name: string
  url: string
  description?: string
  skills?: Array<{ id: string; name: string; description: string }>
  securitySchemes?: Record<string, any>
}

export interface A2AError {
  code: number
  message: string
  data?: any
}

export interface StreamChunk {
  kind: 'task' | 'status-update' | 'artifact-update'
  taskId?: string
  status?: {
    state: 'submitted' | 'working' | 'completed' | 'failed'
    message?: any
  }
  artifact?: {
    artifactId: string
    name?: string
    description?: string
    parts: Array<{
      kind: 'text' | 'file' | 'data'
      text?: string
      file?: {
        name: string
        mimeType: string
        bytes?: string
        uri?: string
      }
      data?: Record<string, any>
    }>
  }
}

export class A2AClient {
  private agentUrl: string
  private apiKey: string
  private agentCard: AgentCard | null = null

  constructor(agentUrl: string, apiKey: string = '') {
    // Normalize URL
    this.agentUrl = agentUrl.replace(/\/$/, '')
    this.apiKey = apiKey
  }

  async initialize(): Promise<AgentCard> {
    const cardUrl = `${this.agentUrl}/.well-known/agent-card.json`

    const response = await fetch(cardUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch agent card: ${response.status} ${response.statusText}`)
    }

    this.agentCard = await response.json()

    if (!this.agentCard?.name || !this.agentCard?.url) {
      throw new Error('Invalid agent card: missing required fields')
    }

    return this.agentCard
  }

  getAgentCard(): AgentCard | null {
    return this.agentCard
  }

  async sendMessage(message: string, skillId?: string): Promise<any> {
    const payload = {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          messageId: crypto.randomUUID(),
          parts: [
            {
              kind: 'text',
              text: message
            }
          ]
        },
        configuration: {
          acceptedOutputModes: ['application/json', 'text/plain', 'image/*'],
          historyLength: 10,
          blocking: true
        }
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(this.agentUrl, {
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
    onChunk: (chunk: StreamChunk) => void | Promise<void>
  ): Promise<void> {
    const payload = {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'message/stream',
      params: {
        message: {
          role: 'user',
          messageId: crypto.randomUUID(),
          parts: [{ kind: 'text', text: message }]
        },
        configuration: {
          acceptedOutputModes: ['application/json', 'text/plain', 'image/*'],
          historyLength: 10
        }
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(this.agentUrl, {
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
                await onChunk(data.result as StreamChunk)
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
              await onChunk(data.result as StreamChunk)
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
