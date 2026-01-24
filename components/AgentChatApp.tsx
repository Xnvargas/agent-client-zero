'use client'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import AgentSetup, { clearSavedConfig, type AgentConfig, type A2AExtensionConfig } from './AgentSetup'
import type { ChatLayout } from './types/chat'
import { DEFAULT_LAYOUT, loadSavedLayout, saveLayoutPreference } from './types/chat'
import LayoutToggle from './LayoutToggle'

// Dynamic import for ChatPanel to avoid SSR issues
const ChatPanel = dynamic(() => import('./ChatPanel'), {
  ssr: false,
  loading: () => (
    <div className="loading-spinner">
      <div className="loading-spinner__icon" />
    </div>
  )
})

interface AgentChatAppProps {
  // Optional props to bypass setup screen
  defaultAgentUrl?: string
  defaultApiKey?: string
  skipSetup?: boolean
  // Layout configuration
  initialLayout?: ChatLayout
  showLayoutToggle?: boolean
  // Allow embedding in custom containers
  className?: string
}

// Default settings for skip setup mode
const DEFAULT_SKIP_SETTINGS = {
  thinkingEnabled: true
}

const DEFAULT_SKIP_EXTENSIONS: A2AExtensionConfig = {
  settings: {
    thinking_group: {
      thinking: true
    }
  }
}

export default function AgentChatApp({
  defaultAgentUrl,
  defaultApiKey,
  skipSetup = false,
  initialLayout,
  showLayoutToggle = true,
  className = ''
}: AgentChatAppProps) {

  // ==========================================================================
  // AGENT CONFIG STATE
  // ==========================================================================

  const [config, setConfig] = useState<AgentConfig | null>(() => {
    if (skipSetup && defaultAgentUrl) {
      return {
        agentUrl: defaultAgentUrl,
        apiKey: defaultApiKey || '',
        agentCard: {
          name: 'AI Assistant',
          url: defaultAgentUrl
        },
        settings: DEFAULT_SKIP_SETTINGS,
        extensions: DEFAULT_SKIP_EXTENSIONS
      }
    }
    return null
  })

  // ==========================================================================
  // LAYOUT STATE
  // ==========================================================================

  const [layout, setLayout] = useState<ChatLayout>(() => {
    return initialLayout ?? loadSavedLayout()
  })

  const handleLayoutChange = useCallback((newLayout: ChatLayout) => {
    setLayout(newLayout)
    saveLayoutPreference(newLayout)
  }, [])

  // ==========================================================================
  // CONNECTION HANDLERS
  // ==========================================================================

  const handleConnect = useCallback((newConfig: AgentConfig) => {
    setConfig(newConfig)
  }, [])

  const handleDisconnect = useCallback(() => {
    clearSavedConfig()
    setConfig(null)
  }, [])

  // ==========================================================================
  // RENDER
  // ==========================================================================

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
    <div className={`agent-chat-app ${className}`}>
      <ChatPanel
        agentUrl={config.agentUrl}
        apiKey={config.apiKey}
        agentName={config.agentCard.name}
        agentDescription={config.agentCard.description}
        agentIconUrl={config.agentCard.iconUrl}
        layout={layout}
        onLayoutChange={handleLayoutChange}
        onDisconnect={handleDisconnect}
        extensions={config.extensions}
        showThinkingIndicator={config.settings?.thinkingEnabled ?? true}
        showLayoutToggle={showLayoutToggle}
      />

      {/* Optional: Floating layout toggle (alternative to header menu) */}
      {showLayoutToggle && layout !== 'float' && (
        <LayoutToggle
          currentLayout={layout}
          onLayoutChange={handleLayoutChange}
          variant="floating"
        />
      )}
    </div>
  )
}

// =============================================================================
// EXPORTS FOR EXTERNAL USE
// =============================================================================

export { type ChatLayout } from './types/chat'
export { DEFAULT_LAYOUT, loadSavedLayout, saveLayoutPreference } from './types/chat'
