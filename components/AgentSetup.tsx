'use client'

import { useState, useCallback, useEffect } from 'react'

interface AgentCard {
  name: string
  url: string
  description?: string
  skills?: Array<{ id: string; name: string; description: string }>
  securitySchemes?: Record<string, any>
}

interface AgentConfig {
  agentUrl: string
  apiKey: string
  agentCard: AgentCard
}

interface AgentSetupProps {
  onConnect: (config: AgentConfig) => void
  initialUrl?: string
  initialApiKey?: string
}

const STORAGE_KEY = 'agent-client-zero-config'

export default function AgentSetup({ onConnect, initialUrl = '', initialApiKey = '' }: AgentSetupProps) {
  const [agentUrl, setAgentUrl] = useState(initialUrl)
  const [apiKey, setApiKey] = useState(initialApiKey)
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validatedCard, setValidatedCard] = useState<AgentCard | null>(null)

  // Load saved config on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const config = JSON.parse(saved) as AgentConfig
        if (config.agentUrl && config.agentCard) {
          // Auto-connect with saved config
          onConnect(config)
        }
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [onConnect])

  const validateAgentUrl = useCallback(async (url: string): Promise<AgentCard | null> => {
    try {
      // Normalize URL
      let normalizedUrl = url.trim()
      if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
        normalizedUrl = 'http://' + normalizedUrl
      }
      // Remove trailing slash
      normalizedUrl = normalizedUrl.replace(/\/$/, '')

      const cardUrl = `${normalizedUrl}/.well-known/agent-card.json`
      const response = await fetch(cardUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      })

      if (!response.ok) {
        return null
      }

      const card = await response.json()

      // Validate required fields
      if (!card.name || !card.url) {
        return null
      }

      return card
    } catch (e) {
      return null
    }
  }, [])

  const handleValidate = useCallback(async () => {
    if (!agentUrl.trim()) {
      setError('Please enter an agent URL')
      return
    }

    setIsValidating(true)
    setError(null)
    setValidatedCard(null)

    const card = await validateAgentUrl(agentUrl)

    setIsValidating(false)

    if (card) {
      setValidatedCard(card)
    } else {
      setError('Could not connect to agent. Please check the URL and ensure the agent is running.')
    }
  }, [agentUrl, validateAgentUrl])

  const handleConnect = useCallback(() => {
    if (!validatedCard) return

    // Normalize URL for storage
    let normalizedUrl = agentUrl.trim()
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'http://' + normalizedUrl
    }
    normalizedUrl = normalizedUrl.replace(/\/$/, '')

    const config: AgentConfig = {
      agentUrl: normalizedUrl,
      apiKey: apiKey.trim(),
      agentCard: validatedCard
    }

    // Save to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch (e) {
      // Ignore localStorage errors
    }

    onConnect(config)
  }, [agentUrl, apiKey, validatedCard, onConnect])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (validatedCard) {
        handleConnect()
      } else {
        handleValidate()
      }
    }
  }, [validatedCard, handleConnect, handleValidate])

  return (
    <div className="agent-setup">
      <div className="agent-setup__container">
        <h1 className="agent-setup__title">Connect to Agent</h1>
        <p className="agent-setup__subtitle">
          Enter the URL of your AgentStack A2A server to get started
        </p>

        <div className="agent-setup__form">
          <div className="agent-setup__field">
            <label htmlFor="agent-url" className="agent-setup__label">
              Agent Server URL
            </label>
            <input
              id="agent-url"
              type="text"
              value={agentUrl}
              onChange={(e) => {
                setAgentUrl(e.target.value)
                setValidatedCard(null)
                setError(null)
              }}
              onKeyDown={handleKeyDown}
              placeholder="http://localhost:8000"
              className={`agent-setup__input ${error ? 'agent-setup__input--error' : ''}`}
              disabled={isValidating}
            />
            <span className="agent-setup__hint">
              The agent must expose a /.well-known/agent-card.json endpoint
            </span>
          </div>

          <div className="agent-setup__field">
            <label htmlFor="api-key" className="agent-setup__label">
              API Key (optional)
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter API key if required"
              className="agent-setup__input"
              disabled={isValidating}
            />
          </div>

          {error && (
            <div className="agent-setup__error">
              {error}
            </div>
          )}

          {validatedCard && (
            <div className="agent-setup__success">
              <div className="agent-setup__success-title">Agent Found</div>
              <div className="agent-setup__success-name">{validatedCard.name}</div>
              {validatedCard.description && (
                <p className="text-sm mt-1 mb-2">{validatedCard.description}</p>
              )}
              <div className="agent-setup__success-url">{validatedCard.url}</div>
              {validatedCard.skills && validatedCard.skills.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-medium">Skills: </span>
                  <span className="text-xs">
                    {validatedCard.skills.map(s => s.name).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}

          {!validatedCard ? (
            <button
              type="button"
              onClick={handleValidate}
              disabled={isValidating || !agentUrl.trim()}
              className="agent-setup__button"
            >
              {isValidating ? 'Validating...' : 'Validate Agent'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              className="agent-setup__button"
            >
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Export for use in other components
export function clearSavedConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (e) {
    // Ignore localStorage errors
  }
}
