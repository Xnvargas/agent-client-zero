'use client'

import { useState, useCallback, useEffect } from 'react'

interface AgentCard {
  name: string
  url: string
  description?: string
  skills?: Array<{ id: string; name: string; description: string }>
  securitySchemes?: Record<string, any>
  extensions?: string[]
}

// Extension configuration for A2A requests
export interface A2AExtensionConfig {
  settings?: {
    thinking_group?: {
      thinking?: boolean
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

// Agent settings that can be configured in the UI
export interface AgentSettings {
  thinkingEnabled: boolean
}

export interface AgentConfig {
  agentUrl: string
  apiKey: string
  agentCard: AgentCard
  settings: AgentSettings
  extensions: A2AExtensionConfig
}

interface AgentSetupProps {
  onConnect: (config: AgentConfig) => void
  initialUrl?: string
  initialApiKey?: string
}

const STORAGE_KEY = 'agent-client-zero-config'

// Default agent settings
const DEFAULT_SETTINGS: AgentSettings = {
  thinkingEnabled: true
}

// Build extension configuration from settings
function buildExtensions(settings: AgentSettings): A2AExtensionConfig {
  return {
    settings: {
      thinking_group: {
        thinking: settings.thinkingEnabled
      }
    }
  }
}

export default function AgentSetup({ onConnect, initialUrl = '', initialApiKey = '' }: AgentSetupProps) {
  const [agentUrl, setAgentUrl] = useState(initialUrl)
  const [apiKey, setApiKey] = useState(initialApiKey)
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validatedCard, setValidatedCard] = useState<AgentCard | null>(null)
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Load saved config on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const config = JSON.parse(saved) as AgentConfig
        if (config.agentUrl && config.agentCard) {
          // Ensure config has settings and extensions (backwards compatibility)
          const completeConfig: AgentConfig = {
            ...config,
            settings: config.settings || DEFAULT_SETTINGS,
            extensions: config.extensions || buildExtensions(config.settings || DEFAULT_SETTINGS)
          }
          // Auto-connect with saved config
          onConnect(completeConfig)
        }
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [onConnect])

  const validateAgentUrl = useCallback(async (url: string): Promise<{ card: AgentCard | null; error?: string }> => {
    try {
      // Use server-side proxy to avoid CORS issues
      const response = await fetch('/api/agent/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agentUrl: url })
      })

      const data = await response.json()

      if (!response.ok) {
        return { card: null, error: data.error || `Server returned ${response.status}` }
      }

      return { card: data.card }
    } catch (e) {
      const error = e as Error
      return { card: null, error: error.message || 'Unknown error occurred' }
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

    const result = await validateAgentUrl(agentUrl)

    setIsValidating(false)

    if (result.card) {
      setValidatedCard(result.card)
    } else {
      setError(result.error || 'Could not connect to agent. Please check the URL and ensure the agent is running.')
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
      agentCard: validatedCard,
      settings,
      extensions: buildExtensions(settings)
    }

    // Save to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch (e) {
      // Ignore localStorage errors
    }

    onConnect(config)
  }, [agentUrl, apiKey, validatedCard, settings, onConnect])

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

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="agent-setup__advanced-toggle"
          >
            {showAdvanced ? '- Hide Advanced Settings' : '+ Show Advanced Settings'}
          </button>

          {/* Advanced Settings Panel */}
          {showAdvanced && (
            <div className="agent-setup__advanced">
              <div className="agent-setup__field agent-setup__field--checkbox">
                <label className="agent-setup__checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.thinkingEnabled}
                    onChange={(e) => setSettings(prev => ({
                      ...prev,
                      thinkingEnabled: e.target.checked
                    }))}
                    className="agent-setup__checkbox"
                  />
                  <span>Enable Thinking Mode</span>
                </label>
                <span className="agent-setup__hint">
                  When enabled, the agent will show its reasoning process (requires agent support)
                </span>
              </div>
            </div>
          )}

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
