interface AgentCard {
  name: string
  url: string
  skills: Array<{ id: string; name: string; description: string }>
  securitySchemes?: Record<string, any>
}

export class A2AClient {
  private agentUrl: string
  private apiKey: string
  private agentCard: AgentCard | null = null

  constructor(agentUrl: string, apiKey: string) {
    this.agentUrl = agentUrl
    this.apiKey = apiKey
  }

  async initialize() {
    // Fetch agent card to discover capabilities
    const cardUrl = new URL('/.well-known/agent-card.json', this.agentUrl)
    const response = await fetch(cardUrl.toString())
    this.agentCard = await response.json()
    return this.agentCard
  }

  async sendMessage(message: string, skillId?: string) {
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

    const response = await fetch(this.agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    })

    const result = await response.json()
    return result.result // Returns Task object
  }

  async streamMessage(message: string, onChunk: (chunk: any) => void) {
    const payload = {
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'message/stream',
      params: {
        message: {
          role: 'user',
          messageId: crypto.randomUUID(),
          parts: [{ kind: 'text', text: message }]
        }
      }
    }

    const response = await fetch(this.agentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(payload)
    })

    const reader = response.body?.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader!.read()
      if (done) break

      const chunk = decoder.decode(value)
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            onChunk(data.result)
          } catch (e) {
            console.error('Error parsing chunk', e)
          }
        }
      }
    }
  }
}
