'use client'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import AgentSetup, { clearSavedConfig } from './AgentSetup'

// Dynamic import for FullScreenChat to avoid SSR issues
const FullScreenChat = dynamic(() => import('./FullScreenChat'), {
  ssr: false,
  loading: () => (
    <div className="loading-spinner">
      <div className="loading-spinner__icon" />
    </div>
  )
})

interface AgentCard {
  name: string
  url: string
  description?: string
  skills?: Array<{ id: string; name: string; description: string }>
}

interface AgentConfig {
  agentUrl: string
  apiKey: string
  agentCard: AgentCard
}

interface AgentChatAppProps {
  // Optional props to bypass setup screen (for backwards compatibility)
  defaultAgentUrl?: string
  defaultApiKey?: string
  skipSetup?: boolean
}

export default function AgentChatApp({
  defaultAgentUrl,
  defaultApiKey,
  skipSetup = false
}: AgentChatAppProps) {
  const [config, setConfig] = useState<AgentConfig | null>(() => {
    // If skipSetup is true and we have a default URL, create a config immediately
    if (skipSetup && defaultAgentUrl) {
      return {
        agentUrl: defaultAgentUrl,
        apiKey: defaultApiKey || '',
        agentCard: {
          name: 'AI Assistant',
          url: defaultAgentUrl
        }
      }
    }
    return null
  })

  const handleConnect = useCallback((newConfig: AgentConfig) => {
    setConfig(newConfig)
  }, [])

  const handleDisconnect = useCallback(() => {
    clearSavedConfig()
    setConfig(null)
  }, [])

  // Show setup screen if not connected
  if (!config) {
    return (
      <AgentSetup
        onConnect={handleConnect}
        initialUrl={defaultAgentUrl}
        initialApiKey={defaultApiKey}
      />
    )
  }

  // Show chat when connected
  return (
    <FullScreenChat
      agentUrl={config.agentUrl}
      apiKey={config.apiKey}
      agentName={config.agentCard.name}
      onDisconnect={handleDisconnect}
    />
  )
}
