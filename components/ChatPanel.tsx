/**
 * ChatPanel - Unified Multi-Layout Chat Component
 *
 * Supports three layout modes:
 * - fullscreen: Chat fills entire viewport
 * - sidebar: Chat slides in from right side
 * - float: Classic chat widget with launcher bubble
 *
 * This component can be extracted and used in any Next.js/React project
 * with the Carbon AI Chat library.
 *
 * DEPENDENCIES:
 * - @carbon/ai-chat
 * - next/dynamic (for SSR-safe imports)
 *
 * REFERENCE:
 * - Carbon AI Chat React docs: https://github.com/carbon-design-system/carbon-ai-chat/blob/main/packages/ai-chat/docs/React.md
 * - Demo implementation: https://github.com/carbon-design-system/carbon-ai-chat/blob/main/demo/src/react/DemoApp.tsx
 */

'use client'

import dynamic from 'next/dynamic'
import { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import {
  parseUIExtensions,
  type Citation,
  type ErrorMetadata,
  type FormRequestMetadata,
} from '@/lib/a2a'
import { CitationRenderer, ErrorRenderer, FormRenderer } from '@/components/renderers/index'
import type {
  ChatPanelProps,
  ChatLayout,
  ViewChangeEvent,
} from './types/chat'
import {
  DEFAULT_LAYOUT,
  loadSavedLayout,
  saveLayoutPreference
} from './types/chat'
import { useLayoutMenuOptions } from './LayoutToggle'

// =============================================================================
// DYNAMIC IMPORTS (SSR-SAFE)
// =============================================================================

/**
 * ChatCustomElement - For fullscreen and sidebar layouts
 * Allows custom sizing via CSS className
 */
const ChatCustomElement = dynamic(
  () => import('@carbon/ai-chat').then((mod) => mod.ChatCustomElement),
  {
    ssr: false,
    loading: () => (
      <div className="loading-spinner">
        <div className="loading-spinner__icon" />
      </div>
    )
  }
)

/**
 * ChatContainer - For float layout
 * Provides built-in launcher bubble and positioning
 */
const ChatContainer = dynamic(
  () => import('@carbon/ai-chat').then((mod) => mod.ChatContainer),
  {
    ssr: false,
    loading: () => (
      <div className="loading-spinner">
        <div className="loading-spinner__icon" />
      </div>
    )
  }
)

// =============================================================================
// HELPER CONSTANTS & TYPES
// =============================================================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Sidebar animation duration (matches CSS transition)
const SIDEBAR_ANIMATION_MS = 250

// A2A streaming response types per the official guide
interface A2AMessagePart {
  kind: 'text' | 'file' | 'data'
  text?: string
  file?: {
    name: string
    mimeType: string
    bytes?: string
    uri?: string
  }
  data?: Record<string, unknown>
  metadata?: {
    content_type?: 'thinking' | 'reasoning_step' | 'response' | string
    [key: string]: unknown
  }
}

interface A2AMessage {
  role: string
  messageId: string
  parts: A2AMessagePart[]
  metadata?: Record<string, unknown>
}

interface A2AStreamResult {
  contextId?: string
  taskId?: string
  kind: 'status-update' | 'artifact-update'
  status?: {
    state: 'working' | 'completed' | 'failed' | 'canceled' | 'input-required' | 'auth-required'
    message?: A2AMessage
  }
  final?: boolean
}

// Chain of thought & reasoning types
enum ChainOfThoughtStepStatus {
  IN_PROGRESS = 'in_progress',
  SUCCESS = 'success',
  ERROR = 'error'
}

interface ReasoningStep {
  title: string
  content?: string
  open_state?: 'open' | 'close' | 'default'
}

interface ChainOfThoughtStep {
  title: string
  description?: string
  tool_name?: string
  request?: { args: unknown }
  response?: { content: unknown }
  status: ChainOfThoughtStepStatus
}

// Message response types enum - matches Carbon's MessageResponseTypes
const MessageResponseTypes = {
  TEXT: 'text',
  USER_DEFINED: 'user_defined',
  INLINE_ERROR: 'inline_error'
} as const

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a unique ID for streaming responses
 */
function generateResponseId(): string {
  return `response-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Check if the chat instance has the addMessageChunk method
 */
function hasStreamingSupport(instance: unknown): boolean {
  return (instance as { messaging?: { addMessageChunk?: unknown } })?.messaging?.addMessageChunk !== undefined
}

/**
 * Format file size for display
 */
function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ChatPanel({
  agentUrl,
  apiKey = '',
  agentName = 'AI Assistant',
  agentDescription,
  agentIconUrl = '/bot.svg',
  layout: externalLayout,
  onLayoutChange: externalOnLayoutChange,
  onDisconnect,
  extensions,
  showThinkingIndicator = true,
  showLayoutToggle = true
}: ChatPanelProps) {

  // ==========================================================================
  // LAYOUT STATE
  // ==========================================================================

  // Use external layout if provided, otherwise manage internally
  const [internalLayout, setInternalLayout] = useState<ChatLayout>(() => {
    return externalLayout ?? loadSavedLayout()
  })

  const layout = externalLayout ?? internalLayout

  const handleLayoutChange = useCallback((newLayout: ChatLayout) => {
    setInternalLayout(newLayout)
    saveLayoutPreference(newLayout)
    externalOnLayoutChange?.(newLayout)
  }, [externalOnLayoutChange])

  // ==========================================================================
  // SIDEBAR STATE (for animations)
  // ==========================================================================

  const [sidebarOpen, setSidebarOpen] = useState(layout === 'sidebar')
  const [sidebarClosing, setSidebarClosing] = useState(false)

  // ==========================================================================
  // REFS
  // ==========================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatInstanceRef = useRef<any>(null)

  // Track when the chat instance is ready (set in onAfterRender)
  const [instanceReady, setInstanceReady] = useState(false)

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false)

  // A2A to Carbon message_options state
  const [, setReasoningSteps] = useState<ReasoningStep[]>([])
  const [, setChainOfThought] = useState<ChainOfThoughtStep[]>([])

  // UI Extension state for current message
  const [currentCitations, setCurrentCitations] = useState<Citation[]>([])
  const [currentError, setCurrentError] = useState<ErrorMetadata | null>(null)
  const [currentFormRequest, setCurrentFormRequest] = useState<FormRequestMetadata | null>(null)
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null)

  // Ref for tracking citations during streaming (to access from useCallback)
  const streamCitationsRef = useRef<Citation[]>([])
  // Refs for tracking chain of thought and reasoning steps during streaming
  const chainOfThoughtRef = useRef<ChainOfThoughtStep[]>([])
  const reasoningStepsRef = useRef<ReasoningStep[]>([])
  // Ref for accumulated thinking content (for reasoning.content mode)
  const accumulatedThinkingRef = useRef<string>('')
  const streamingStateRef = useRef<{
    responseId: string | null
    accumulatedText: string
    hasStartedStreaming: boolean
    supportsChunking: boolean | null
    finalResponseSent: boolean
  }>({
    responseId: null,
    accumulatedText: '',
    hasStartedStreaming: false,
    supportsChunking: null,
    finalResponseSent: false
  })

  // Abort controller for canceling requests
  const abortControllerRef = useRef<AbortController | null>(null)

  // Track current A2A task ID for cancellation
  const currentTaskIdRef = useRef<string | null>(null)

  // Non-blocking text chunk queue
  const textChunkQueueRef = useRef<string[]>([])
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const CHUNK_FLUSH_INTERVAL = 50  // ms

  // Debounce tracking for reasoning pushes
  const lastReasoningPushRef = useRef<number>(0)
  const REASONING_PUSH_MIN_INTERVAL = 200  // ms

  // ==========================================================================
  // CUSTOM STRINGS FOR AI EXPLAINED POPUP
  // ==========================================================================

  const customStrings = useMemo(() => ({
    ai_slug_title: `Powered by ${agentName}`,
    ai_slug_description: agentDescription ||
      `${agentName} uses AI to process conversations and provide assistance.`
  }), [agentName, agentDescription])

  // ==========================================================================
  // AGENT PROFILE FOR MESSAGE BUBBLES
  // ==========================================================================

  const agentProfile = useMemo(() => ({
    id: 'a2a-agent',
    nickname: agentName,
    user_type: 'bot' as const,
    profile_picture_url: agentIconUrl
  }), [agentName, agentIconUrl])

  // ==========================================================================
  // HEADER MENU OPTIONS WITH LAYOUT TOGGLE
  // ==========================================================================

  const layoutMenuOptions = useLayoutMenuOptions(layout, handleLayoutChange)

  const headerMenuOptions = useMemo(() => {
    const options: Array<{ text: string; handler: () => void }> = []

    // Add layout options if enabled
    if (showLayoutToggle) {
      options.push(
        { text: '--- Layout ---', handler: () => {} },
        ...layoutMenuOptions
      )
    }

    // Add disconnect option
    if (onDisconnect) {
      if (options.length > 0) {
        options.push({ text: '---', handler: () => {} })
      }
      options.push({
        text: 'Disconnect',
        handler: () => {
          if (window.confirm('Disconnect from this agent?')) {
            onDisconnect()
          }
        }
      })
    }

    return options.length > 0 ? options : undefined
  }, [showLayoutToggle, layoutMenuOptions, onDisconnect])

  // ==========================================================================
  // VIEW CHANGE HANDLERS (for sidebar animations)
  // ==========================================================================

  /**
   * Handle view state changes for sidebar layout
   */
  const onViewChange = useCallback((event: ViewChangeEvent) => {
    if (layout !== 'sidebar') return

    if (event.newViewState.mainWindow) {
      setSidebarOpen(true)
    } else {
      setSidebarOpen(false)
      setSidebarClosing(false)
    }
  }, [layout])

  /**
   * Handle pre-view-change for sidebar animations
   */
  const onViewPreChange = useCallback(async (event: ViewChangeEvent) => {
    if (layout !== 'sidebar') return

    // If closing (mainWindow going from true to false)
    if (!event.newViewState.mainWindow) {
      setSidebarClosing(true)
      await sleep(SIDEBAR_ANIMATION_MS)
    }
  }, [layout])

  // ==========================================================================
  // LAYOUT-SPECIFIC CSS CLASS
  // ==========================================================================

  // CRITICAL: This class is applied DIRECTLY to ChatCustomElement
  // Carbon requires explicit viewport dimensions on this element, not percentages
  const elementClassName = useMemo(() => {
    switch (layout) {
      case 'fullscreen':
        return 'chat-element--fullscreen'

      case 'sidebar':
        let sidebarClass = 'chat-element--sidebar'
        if (sidebarClosing) {
          sidebarClass += ' chat-element--sidebar-closing'
        } else if (!sidebarOpen) {
          sidebarClass += ' chat-element--sidebar-closed'
        }
        return sidebarClass

      default:
        return 'chat-element--fullscreen'
    }
  }, [layout, sidebarOpen, sidebarClosing])

  // ==========================================================================
  // APPLY STRINGS TO REDUX STORE
  // ==========================================================================

  const applyStringsToRedux = useCallback(() => {
    const instance = chatInstanceRef.current
    if (!instance?.serviceManager?.store) {
      console.warn('[Strings] serviceManager.store not available')
      return
    }

    try {
      const currentState = instance.serviceManager.store.getState()
      const currentLanguagePack = currentState?.config?.derived?.languagePack || {}
      const merged = { ...currentLanguagePack, ...customStrings }

      instance.serviceManager.store.dispatch({
        type: 'CHANGE_STATE',
        partialState: {
          config: {
            derived: {
              languagePack: merged
            }
          }
        }
      })

      console.log('[Strings] Applied custom strings to Redux store')
    } catch (err) {
      console.error('[Strings] Failed to apply strings to Redux:', err)
    }
  }, [customStrings])

  // ==========================================================================
  // STORE SUBSCRIPTION TO PERSIST CUSTOM STRINGS
  // ==========================================================================

  useEffect(() => {
    if (!instanceReady) return

    const instance = chatInstanceRef.current
    if (!instance?.serviceManager?.store) {
      console.warn('[Strings] Store not available for subscription')
      return
    }

    const store = instance.serviceManager.store
    applyStringsToRedux()

    const unsubscribe = store.subscribe(() => {
      const state = store.getState()
      const currentTitle = state?.config?.derived?.languagePack?.ai_slug_title

      if (currentTitle !== customStrings.ai_slug_title) {
        console.log('[Strings] Detected overwrite, re-applying custom strings')
        const currentPack = state?.config?.derived?.languagePack || {}
        store.dispatch({
          type: 'CHANGE_STATE',
          partialState: {
            config: {
              derived: {
                languagePack: { ...currentPack, ...customStrings }
              }
            }
          }
        })
      }
    })

    console.log('[Strings] Store subscription established')
    return unsubscribe
  }, [instanceReady, customStrings, applyStringsToRedux])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [])

  // ==========================================================================
  // STREAMING METHODS
  // ==========================================================================

  const sendPartialChunk = useCallback(async (text: string, responseId: string, itemId: string = '1'): Promise<boolean> => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
      console.warn('[Streaming] addMessageChunk not available')
      return false
    }

    try {
      const chunk = {
        partial_item: {
          response_type: MessageResponseTypes.TEXT,
          text: text,
          streaming_metadata: {
            id: itemId,
            cancellable: true
          }
        },
        partial_response: {
          message_options: {
            response_user_profile: agentProfile
          }
        },
        streaming_metadata: {
          response_id: responseId
        }
      }

      console.log('[Streaming] Sending partial chunk:', { textLength: text.length, responseId })
      await instance.messaging.addMessageChunk(chunk)
      return true
    } catch (err) {
      console.error('[Streaming] Failed to send partial chunk:', err)
      return false
    }
  }, [agentProfile])

  const queueTextChunk = useCallback((
    text: string,
    responseId: string,
    itemId: string
  ) => {
    textChunkQueueRef.current.push(text)

    if (!flushTimeoutRef.current) {
      flushTimeoutRef.current = setTimeout(async () => {
        const batch = textChunkQueueRef.current.join('')
        textChunkQueueRef.current = []
        flushTimeoutRef.current = null

        if (batch) {
          try {
            await sendPartialChunk(batch, responseId, itemId)
          } catch (err) {
            console.error('[Queue] Flush error:', err)
          }
        }
      }, CHUNK_FLUSH_INTERVAL)
    }
  }, [sendPartialChunk])

  const flushTextQueue = useCallback(async (
    responseId: string,
    itemId: string
  ) => {
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }

    const remaining = textChunkQueueRef.current.join('')
    textChunkQueueRef.current = []

    if (remaining) {
      await sendPartialChunk(remaining, responseId, itemId)
    }
  }, [sendPartialChunk])

  const sendCompleteTextItem = useCallback(async (
    fullText: string,
    responseId: string,
    itemId: string = '1',
    wasStopped: boolean = false
  ): Promise<boolean> => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
      console.warn('[Streaming] Cannot send complete_item - addMessageChunk not available')
      return false
    }

    try {
      const chunk = {
        complete_item: {
          response_type: MessageResponseTypes.TEXT,
          text: fullText,
          streaming_metadata: {
            id: itemId,
            stream_stopped: wasStopped
          }
        },
        streaming_metadata: {
          response_id: responseId
        }
      }

      console.log('[Streaming] Sending complete_item:', { textLength: fullText.length, itemId, wasStopped })
      await instance.messaging.addMessageChunk(chunk)
      return true
    } catch (err) {
      console.error('[Streaming] Failed to send complete_item:', err)
      return false
    }
  }, [])

  const sendCitationsPartialItem = useCallback(async (
    citations: Citation[],
    responseId: string
  ): Promise<boolean> => {
    if (citations.length === 0) return true

    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
      return false
    }

    try {
      const chunk = {
        partial_item: {
          response_type: MessageResponseTypes.USER_DEFINED,
          user_defined: {
            type: 'sources_list',
            citations: citations
          },
          streaming_metadata: {
            id: 'citations'
          }
        },
        partial_response: {
          message_options: {
            response_user_profile: agentProfile
          }
        },
        streaming_metadata: {
          response_id: responseId
        }
      }

      console.log('[Streaming] Sending citations partial_item:', { count: citations.length })
      await instance.messaging.addMessageChunk(chunk)
      return true
    } catch (err) {
      console.error('[Streaming] Failed to send citations partial_item:', err)
      return false
    }
  }, [agentProfile])

  const sendFinalResponse = useCallback(async (
    fullText: string,
    responseId: string,
    options?: {
      citations?: Citation[]
      chainOfThought?: ChainOfThoughtStep[]
      thinkingContent?: string
    }
  ): Promise<boolean> => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
      console.warn('[Streaming] Cannot send final_response - addMessageChunk not available')
      return false
    }

    if (streamingStateRef.current.finalResponseSent) {
      console.log('[Streaming] Final response already sent, skipping duplicate')
      return true
    }

    try {
      const genericItems: Array<{
        response_type: string
        text?: string
        user_defined?: Record<string, unknown>
        streaming_metadata?: { id: string }
      }> = []

      genericItems.push({
        response_type: MessageResponseTypes.TEXT,
        text: fullText,
        streaming_metadata: { id: '1' }
      })

      if (options?.citations && options.citations.length > 0) {
        genericItems.push({
          response_type: MessageResponseTypes.USER_DEFINED,
          user_defined: {
            type: 'sources_list',
            citations: options.citations
          },
          streaming_metadata: { id: 'citations' }
        })
      }

      const finalResponse = {
        final_response: {
          id: responseId,
          output: {
            generic: genericItems
          },
          message_options: {
            response_user_profile: agentProfile,
            chain_of_thought: options?.chainOfThought && options.chainOfThought.length > 0
              ? options.chainOfThought
              : undefined,
            reasoning: options?.thinkingContent
              ? { content: options.thinkingContent }
              : undefined
          }
        }
      }

      console.log('[Streaming] Sending final_response:', {
        textLength: fullText.length,
        responseId,
        citationCount: options?.citations?.length || 0,
        chainOfThoughtCount: options?.chainOfThought?.length || 0,
        thinkingContentLength: options?.thinkingContent?.length || 0
      })
      await instance.messaging.addMessageChunk(finalResponse)
      streamingStateRef.current.finalResponseSent = true
      console.log('[Streaming] final_response sent successfully')
      return true
    } catch (err) {
      console.error('[Streaming] Failed to send final response:', err)
      return false
    }
  }, [agentProfile])

  const sendCompleteMessage = useCallback(async (text: string, isError: boolean = false): Promise<boolean> => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessage) {
      console.error('[Message] addMessage not available')
      return false
    }

    try {
      const message = {
        output: {
          generic: [{
            response_type: isError ? MessageResponseTypes.INLINE_ERROR : MessageResponseTypes.TEXT,
            text: text
          }]
        },
        message_options: {
          response_user_profile: agentProfile
        }
      }

      console.log('[Message] Sending complete message:', { textLength: text.length, isError })
      await instance.messaging.addMessage(message)
      streamingStateRef.current.finalResponseSent = true
      return true
    } catch (err) {
      console.error('[Message] Failed to send message:', err)
      return false
    }
  }, [agentProfile])

  const sendCitationsMessage = useCallback(async (citations: Citation[]) => {
    if (citations.length === 0) return false

    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessage) {
      return false
    }

    try {
      const message = {
        output: {
          generic: [{
            response_type: MessageResponseTypes.USER_DEFINED,
            user_defined: {
              type: 'sources_list',
              citations
            }
          }]
        },
        message_options: {
          response_user_profile: agentProfile
        }
      }

      await instance.messaging.addMessage(message)
      console.log('[Citations] Sent sources list:', { count: citations.length })
      return true
    } catch (err) {
      console.error('[Citations] Failed to send sources:', err)
      return false
    }
  }, [agentProfile])

  const sendUserDefinedMessage = useCallback(async (userDefined: Record<string, unknown>) => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessage) {
      return false
    }

    try {
      const message = {
        output: {
          generic: [{
            response_type: MessageResponseTypes.USER_DEFINED,
            user_defined: userDefined
          }]
        },
        message_options: {
          response_user_profile: agentProfile
        }
      }

      await instance.messaging.addMessage(message)
      return true
    } catch (err) {
      console.error('[Message] Failed to send user-defined message:', err)
      return false
    }
  }, [agentProfile])

  const pushReasoningSteps = useCallback(async (
    responseId: string,
    steps: ReasoningStep[],
    itemId: string = '1'
  ): Promise<boolean> => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
      console.warn('[Reasoning] addMessageChunk not available')
      return false
    }

    try {
      const chunk = {
        partial_item: {
          response_type: MessageResponseTypes.TEXT,
          text: '',
          streaming_metadata: {
            id: itemId
          }
        },
        partial_response: {
          message_options: {
            response_user_profile: agentProfile,
            reasoning: {
              steps,
              open_state: 'default'
            }
          }
        },
        streaming_metadata: {
          response_id: responseId
        }
      }

      console.log('[Reasoning] Pushing to Carbon:', {
        stepCount: steps.length,
        latestTitle: steps[steps.length - 1]?.title,
        responseId
      })
      await instance.messaging.addMessageChunk(chunk)
      return true
    } catch (err) {
      console.error('[Reasoning] Failed to push reasoning steps:', err)
      return false
    }
  }, [agentProfile])

  const pushChainOfThought = useCallback(async (
    responseId: string,
    steps: ChainOfThoughtStep[],
    itemId: string = '1'
  ): Promise<boolean> => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
      console.warn('[ChainOfThought] addMessageChunk not available')
      return false
    }

    try {
      const chunk = {
        partial_item: {
          response_type: MessageResponseTypes.TEXT,
          text: '',
          streaming_metadata: {
            id: itemId
          }
        },
        partial_response: {
          message_options: {
            response_user_profile: agentProfile,
            chain_of_thought: steps
          }
        },
        streaming_metadata: {
          response_id: responseId
        }
      }

      console.log('[ChainOfThought] Pushing chain of thought:', { count: steps.length, responseId })
      await instance.messaging.addMessageChunk(chunk)
      return true
    } catch (err) {
      console.error('[ChainOfThought] Failed to push chain of thought:', err)
      return false
    }
  }, [agentProfile])

  const debouncedPushReasoningSteps = useCallback(async (
    responseId: string,
    steps: ReasoningStep[],
    itemId: string
  ): Promise<boolean> => {
    const now = Date.now()
    const elapsed = now - lastReasoningPushRef.current

    if (elapsed < REASONING_PUSH_MIN_INTERVAL) {
      await new Promise(resolve =>
        setTimeout(resolve, REASONING_PUSH_MIN_INTERVAL - elapsed)
      )
    }

    lastReasoningPushRef.current = Date.now()
    return pushReasoningSteps(responseId, steps, itemId)
  }, [pushReasoningSteps])

  const executeFinalization = useCallback(async (
    responseId: string,
    itemId: string,
    options: {
      text: string
      chainOfThought?: ChainOfThoughtStep[]
      thinkingContent?: string
      citations?: Citation[]
      wasCancelled?: boolean
    }
  ): Promise<boolean> => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
      console.warn('[Finalization] addMessageChunk not available')
      return false
    }

    if (streamingStateRef.current.finalResponseSent) {
      console.log('[Finalization] Already sent, skipping')
      return true
    }

    try {
      console.log('[Finalization] Starting 3-step finalization...', {
        textLength: options.text.length,
        thinkingContentLength: options.thinkingContent?.length || 0,
        chainOfThought: options.chainOfThought?.length || 0,
        citations: options.citations?.length || 0
      })

      // STEP 1: complete_item
      const completeItem = {
        response_type: MessageResponseTypes.TEXT,
        text: options.text,
        streaming_metadata: {
          id: itemId,
          stream_stopped: options.wasCancelled || false
        }
      }

      await instance.messaging.addMessageChunk({
        complete_item: completeItem,
        streaming_metadata: { response_id: responseId }
      })
      console.log('[Finalization] Step 1: complete_item sent')

      // STEP 2: Build generic items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const genericItems: any[] = [{
        response_type: MessageResponseTypes.TEXT,
        text: options.text,
        streaming_metadata: { id: itemId }
      }]

      if (options.citations && options.citations.length > 0) {
        genericItems.push({
          response_type: MessageResponseTypes.USER_DEFINED,
          user_defined: {
            type: 'sources_list',
            citations: options.citations
          },
          streaming_metadata: { id: 'citations' }
        })
      }

      // STEP 3: final_response
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const messageOptions: any = {
        response_user_profile: agentProfile
      }

      if (options.thinkingContent) {
        messageOptions.reasoning = {
          content: options.thinkingContent
        }
      }

      if (options.chainOfThought && options.chainOfThought.length > 0) {
        messageOptions.chain_of_thought = options.chainOfThought
      }

      await instance.messaging.addMessageChunk({
        final_response: {
          id: responseId,
          output: { generic: genericItems },
          message_options: messageOptions
        }
      })
      console.log('[Finalization] Step 2: final_response sent')

      streamingStateRef.current.finalResponseSent = true
      return true

    } catch (error) {
      console.error('[Finalization] Error:', error)
      return false
    }
  }, [agentProfile])

  const handleCancelRequest = useCallback(async () => {
    console.log('[Cancel] Canceling current request')

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    if (currentTaskIdRef.current) {
      try {
        await fetch('/api/agent/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentUrl,
            apiKey,
            taskId: currentTaskIdRef.current
          })
        })
        console.log('[Cancel] Sent A2A cancel for task:', currentTaskIdRef.current)
      } catch (e) {
        console.error('[Cancel] Failed to send A2A cancel:', e)
      }
      currentTaskIdRef.current = null
    }

    const state = streamingStateRef.current
    if (state.responseId && !state.finalResponseSent && state.supportsChunking) {
      await executeFinalization(state.responseId, '1', {
        text: state.accumulatedText || '(Request cancelled)',
        chainOfThought: chainOfThoughtRef.current.length > 0 ? chainOfThoughtRef.current : undefined,
        thinkingContent: accumulatedThinkingRef.current || undefined,
        citations: streamCitationsRef.current.length > 0 ? streamCitationsRef.current : undefined,
        wasCancelled: true
      })
    }

    streamingStateRef.current = {
      responseId: null,
      accumulatedText: '',
      hasStartedStreaming: false,
      supportsChunking: streamingStateRef.current.supportsChunking,
      finalResponseSent: true
    }
    chainOfThoughtRef.current = []
    reasoningStepsRef.current = []
    accumulatedThinkingRef.current = ''
    streamCitationsRef.current = []
    setIsStreaming(false)
  }, [agentUrl, apiKey, executeFinalization])

  // ==========================================================================
  // MAIN MESSAGE HANDLER
  // ==========================================================================

  const handleSendMessage = useCallback(async (message: string) => {
    const instance = chatInstanceRef.current

    if (streamingStateRef.current.supportsChunking === null) {
      console.log('[Debug] Chat instance:', instance)
      console.log('[Debug] Messaging API:', instance?.messaging)
      console.log('[Debug] Available methods:', Object.keys(instance?.messaging || {}))
      streamingStateRef.current.supportsChunking = hasStreamingSupport(instance)
    }

    const supportsChunking = streamingStateRef.current.supportsChunking

    // Clear any pending state from previous message
    textChunkQueueRef.current = []
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }
    lastReasoningPushRef.current = 0

    // Initialize streaming state
    const responseId = generateResponseId()
    const itemId = '1'
    streamingStateRef.current = {
      responseId,
      accumulatedText: '',
      hasStartedStreaming: false,
      supportsChunking,
      finalResponseSent: false
    }
    setIsStreaming(true)

    // Reset state for new message
    setReasoningSteps([])
    setChainOfThought([])
    setCurrentCitations([])
    setCurrentError(null)
    setCurrentFormRequest(null)
    setPendingTaskId(null)
    streamCitationsRef.current = []

    // Local tracking arrays
    const chainOfThought: ChainOfThoughtStep[] = []
    const reasoningSteps: ReasoningStep[] = []

    chainOfThoughtRef.current = []
    reasoningStepsRef.current = []
    accumulatedThinkingRef.current = ''

    console.log('[Handler] Starting message handling:', {
      supportsChunking,
      responseId,
      messagePreview: message.substring(0, 50)
    })

    // Create shell message BEFORE streaming begins
    if (supportsChunking) {
      const instance = chatInstanceRef.current
      if (instance?.messaging?.addMessageChunk) {
        try {
          await instance.messaging.addMessageChunk({
            partial_item: {
              response_type: MessageResponseTypes.TEXT,
              text: '',
              streaming_metadata: { id: itemId }
            },
            partial_response: {
              message_options: {
                response_user_profile: agentProfile,
                reasoning: { content: '' }
              }
            },
            streaming_metadata: { response_id: responseId }
          })
          console.log('[Handler] Shell message created:', { responseId, itemId })
        } catch (err) {
          console.error('[Handler] Failed to create shell message:', err)
        }
      }
    }

    try {
      abortControllerRef.current = new AbortController()
      currentTaskIdRef.current = null

      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          agentUrl,
          apiKey,
          message,
          extensions
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Request failed: ${response.status} ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let receivedFinalTrue = false

      console.log('[Handler] Starting SSE stream processing...')

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          console.log('[Handler] Stream reader done - executing finalization')
          console.log('[Handler] Final state:', {
            accumulatedTextLength: streamingStateRef.current.accumulatedText.length,
            finalResponseSent: streamingStateRef.current.finalResponseSent,
            hasStartedStreaming: streamingStateRef.current.hasStartedStreaming,
            receivedFinalTrue,
            reasoningSteps: reasoningSteps.length,
            chainOfThought: chainOfThought.length,
            citations: streamCitationsRef.current.length
          })

          if (!streamingStateRef.current.finalResponseSent && supportsChunking) {
            await flushTextQueue(responseId, itemId)

            await executeFinalization(responseId, itemId, {
              text: streamingStateRef.current.accumulatedText,
              chainOfThought: chainOfThought.length > 0 ? chainOfThought : undefined,
              thinkingContent: accumulatedThinkingRef.current || undefined,
              citations: streamCitationsRef.current.length > 0 ? streamCitationsRef.current : undefined
            })
          }

          break
        }

        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()

          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.slice(6)
            if (!dataStr || dataStr === '[DONE]') continue

            try {
              const data = JSON.parse(dataStr) as {
                jsonrpc: string
                id: string
                result?: A2AStreamResult
                error?: { code: number; message: string }
              }

              if (data.error) {
                console.error('[Handler] A2A error:', data.error)
                const errorText = `Error: ${data.error.message}`

                if (supportsChunking && streamingStateRef.current.hasStartedStreaming) {
                  await sendFinalResponse(errorText, responseId)
                } else {
                  await sendCompleteMessage(errorText, true)
                }
                continue
              }

              if (data.result) {
                const result = data.result
                console.log('[Handler] A2A result:', {
                  kind: result.kind,
                  state: result.status?.state,
                  final: result.final,
                  hasMessage: !!result.status?.message,
                  taskId: result.taskId
                })

                if (result.taskId && !currentTaskIdRef.current) {
                  currentTaskIdRef.current = result.taskId
                  console.log('[Handler] Captured taskId:', result.taskId)
                }

                if (result.kind === 'status-update' && result.status?.message) {
                  const agentMessage = result.status.message
                  const uiExtensions = parseUIExtensions(agentMessage.metadata)

                  if (uiExtensions.citations?.citations?.length) {
                    const newCitations = uiExtensions.citations.citations
                    streamCitationsRef.current = [...streamCitationsRef.current, ...newCitations]
                    setCurrentCitations(prev => [...prev, ...newCitations])

                    if (supportsChunking && streamingStateRef.current.hasStartedStreaming) {
                      await sendCitationsPartialItem(streamCitationsRef.current, responseId)
                    }
                  }

                  if (uiExtensions.error) {
                    setCurrentError(uiExtensions.error)
                    console.log('[Handler] Error extension:', uiExtensions.error)
                  }

                  if (uiExtensions.formRequest) {
                    setCurrentFormRequest(uiExtensions.formRequest)
                    setPendingTaskId(result.taskId || null)
                    console.log('[Handler] Form request extension:', uiExtensions.formRequest)
                  }

                  for (const part of agentMessage.parts) {
                    const contentType = part.metadata?.content_type

                    console.log('[Handler] Processing part:', {
                      kind: part.kind,
                      contentType,
                      hasText: !!part.text,
                      hasData: !!part.data,
                      dataType: (part.data as { type?: string })?.type
                    })

                    const partExtensions = parseUIExtensions(part.metadata as Record<string, unknown>)

                    // TRAJECTORY -> Route to reasoning accordion
                    if (partExtensions.trajectory) {
                      const trajectory = partExtensions.trajectory
                      const newStep: ReasoningStep = {
                        title: trajectory.title || 'Reasoning',
                        content: trajectory.content || '',
                        open_state: 'default'
                      }

                      reasoningSteps.push(newStep)
                      reasoningStepsRef.current = [...reasoningSteps]
                      setReasoningSteps([...reasoningSteps])

                      if (supportsChunking) {
                        await debouncedPushReasoningSteps(responseId, reasoningSteps, itemId)
                      }

                      console.log('[Handler] Added trajectory step:', { title: trajectory.title, groupId: trajectory.group_id })
                    }

                    // THINKING CONTENT -> Route to reasoning accordion
                    if (contentType === 'thinking' && part.kind === 'text' && part.text) {
                      accumulatedThinkingRef.current += part.text

                      if (supportsChunking) {
                        const instance = chatInstanceRef.current
                        if (instance?.messaging?.addMessageChunk) {
                          await instance.messaging.addMessageChunk({
                            partial_item: {
                              response_type: MessageResponseTypes.TEXT,
                              text: '',
                              streaming_metadata: { id: itemId, cancellable: true }
                            },
                            partial_response: {
                              message_options: {
                                response_user_profile: agentProfile,
                                reasoning: { content: accumulatedThinkingRef.current }
                              }
                            },
                            streaming_metadata: { response_id: responseId }
                          })
                        }
                      }

                      console.log('[Handler] Streamed thinking token:', {
                        tokenLength: part.text.length,
                        totalThinking: accumulatedThinkingRef.current.length
                      })

                      continue
                    }

                    // REASONING STEP -> Route to reasoning accordion
                    if (contentType === 'reasoning_step' && part.kind === 'text' && part.text) {
                      accumulatedThinkingRef.current += part.text

                      if (supportsChunking) {
                        const instance = chatInstanceRef.current
                        if (instance?.messaging?.addMessageChunk) {
                          await instance.messaging.addMessageChunk({
                            partial_item: {
                              response_type: MessageResponseTypes.TEXT,
                              text: '',
                              streaming_metadata: { id: itemId, cancellable: true }
                            },
                            partial_response: {
                              message_options: {
                                response_user_profile: agentProfile,
                                reasoning: { content: accumulatedThinkingRef.current }
                              }
                            },
                            streaming_metadata: { response_id: responseId }
                          })
                        }
                      }

                      console.log('[Handler] Streamed reasoning_step token:', {
                        tokenLength: part.text.length,
                        totalThinking: accumulatedThinkingRef.current.length
                      })

                      continue
                    }

                    // TOOL CALL -> Track in chain_of_thought
                    else if (part.kind === 'data' && (part.data as { type?: string })?.type === 'tool_call') {
                      const toolData = part.data as { tool_name?: string; args?: unknown; type: string }
                      const cotStep: ChainOfThoughtStep = {
                        title: toolData.tool_name || 'Tool Call',
                        description: `Calling ${toolData.tool_name || 'tool'}`,
                        tool_name: toolData.tool_name,
                        request: { args: toolData.args },
                        status: ChainOfThoughtStepStatus.IN_PROGRESS
                      }

                      chainOfThought.push(cotStep)
                      chainOfThoughtRef.current = [...chainOfThought]
                      setChainOfThought([...chainOfThought])

                      if (supportsChunking) {
                        await pushChainOfThought(responseId, chainOfThought, itemId)
                      }

                      console.log('[Handler] Tool call started, showing in chain of thought:', {
                        toolName: toolData.tool_name,
                        totalSteps: chainOfThought.length
                      })
                    }

                    // TOOL RESULT -> Update chain_of_thought status
                    else if (part.kind === 'data' && (part.data as { type?: string })?.type === 'tool_result') {
                      const resultData = part.data as { tool_name?: string; result_preview?: unknown; type: string }

                      for (let i = 0; i < chainOfThought.length; i++) {
                        if (chainOfThought[i].tool_name === resultData.tool_name &&
                            chainOfThought[i].status === ChainOfThoughtStepStatus.IN_PROGRESS) {
                          chainOfThought[i] = {
                            ...chainOfThought[i],
                            response: { content: resultData.result_preview },
                            status: ChainOfThoughtStepStatus.SUCCESS
                          }
                          break
                        }
                      }

                      chainOfThoughtRef.current = [...chainOfThought]
                      setChainOfThought([...chainOfThought])

                      if (supportsChunking) {
                        await pushChainOfThought(responseId, chainOfThought, itemId)
                      }

                      console.log('[Handler] Tool completed, showing chain of thought:', { toolName: resultData.tool_name })
                    }

                    // RESPONSE CONTENT -> Route to main text stream
                    else if (part.kind === 'text' && part.text) {
                      const newText = part.text

                      streamingStateRef.current.accumulatedText += newText
                      streamingStateRef.current.hasStartedStreaming = true

                      if (supportsChunking) {
                        queueTextChunk(newText, responseId, itemId)

                        console.log('[Handler] Queued response text:', {
                          chunkLength: newText.length,
                          queueSize: textChunkQueueRef.current.length
                        })
                      } else {
                        console.log('[Handler] Accumulated response text:', { textLength: newText.length })
                      }
                    }

                    // Handle file parts
                    else if (part.kind === 'file' && part.file) {
                      await sendUserDefinedMessage({
                        type: 'file_attachment',
                        fileName: part.file.name,
                        mimeType: part.file.mimeType,
                        downloadUrl: part.file.uri || `data:${part.file.mimeType};base64,${part.file.bytes}`
                      })
                    }

                    // Handle other data parts
                    else if (part.kind === 'data' && part.data &&
                             (part.data as { type?: string }).type !== 'tool_call' &&
                             (part.data as { type?: string }).type !== 'tool_result') {
                      await sendUserDefinedMessage({
                        type: 'structured_data',
                        data: part.data
                      })
                    }
                  }
                }

                // Handle input-required state
                if (result.status?.state === 'input-required') {
                  console.log('[Handler] Input required state detected')
                  const pendingText = streamingStateRef.current.accumulatedText
                  if (pendingText && supportsChunking && streamingStateRef.current.hasStartedStreaming) {
                    await sendFinalResponse(pendingText, responseId)
                  }
                  continue
                }

                // Check if stream is complete
                const isComplete = result.final === true || result.status?.state === 'completed'

                if (isComplete) {
                  receivedFinalTrue = true
                  console.log('[Handler] Stream marked as complete:', {
                    final: result.final,
                    state: result.status?.state
                  })

                  if (supportsChunking && streamingStateRef.current.hasStartedStreaming) {
                    await flushTextQueue(responseId, itemId)

                    await executeFinalization(responseId, itemId, {
                      text: streamingStateRef.current.accumulatedText,
                      chainOfThought: chainOfThought.length > 0 ? chainOfThought : undefined,
                      thinkingContent: accumulatedThinkingRef.current || undefined,
                      citations: streamCitationsRef.current.length > 0 ? streamCitationsRef.current : undefined
                    })

                  } else if (streamingStateRef.current.accumulatedText && !streamingStateRef.current.finalResponseSent) {
                    await sendCompleteMessage(streamingStateRef.current.accumulatedText)
                    streamingStateRef.current.finalResponseSent = true

                    if (streamCitationsRef.current.length > 0) {
                      await sendCitationsMessage(streamCitationsRef.current)
                    }
                  }

                  console.log('[Handler] Final response processed:', {
                    textLength: streamingStateRef.current.accumulatedText.length,
                    citations: streamCitationsRef.current.length,
                    chainOfThought: chainOfThought.length,
                    reasoningSteps: reasoningSteps.length
                  })
                }
              }
            } catch (parseError) {
              if (!(parseError instanceof SyntaxError)) {
                throw parseError
              }
              console.warn('[Handler] Failed to parse SSE data:', dataStr.substring(0, 100))

              if (dataStr.includes('Error') || dataStr.includes('Exception') || dataStr.includes('Traceback') || dataStr.includes('AttributeError')) {
                console.error('[Handler] Backend exception detected in stream:', dataStr.substring(0, 300))
                const errorPreview = dataStr.substring(0, 500).replace(/[\[\]"]/g, '')
                if (!streamingStateRef.current.accumulatedText.includes('Backend error:')) {
                  streamingStateRef.current.accumulatedText += `\n\n Backend error: ${errorPreview}`
                }
              }
            }
          }
        }
      }

      // Handle stream end without explicit final=true
      const state = streamingStateRef.current

      console.log('[Handler] Post-stream check:', {
        accumulatedText: state.accumulatedText.length,
        hasStartedStreaming: state.hasStartedStreaming,
        finalResponseSent: state.finalResponseSent,
        supportsChunking,
        receivedFinalTrue
      })

      if (!state.finalResponseSent) {
        console.log('[Handler] Final response NOT sent yet - triggering fallback')

        if (state.accumulatedText) {
          if (supportsChunking && state.hasStartedStreaming) {
            console.log('[Handler] Fallback: executing 3-step finalization')

            if (streamCitationsRef.current.length > 0) {
              await sendCitationsPartialItem(streamCitationsRef.current, responseId)
            }

            await sendCompleteTextItem(state.accumulatedText, responseId, '1', false)

            await sendFinalResponse(state.accumulatedText, responseId, {
              citations: streamCitationsRef.current,
              chainOfThought: chainOfThought,
              thinkingContent: accumulatedThinkingRef.current || undefined
            })
          } else {
            console.log('[Handler] Sending fallback complete message')
            await sendCompleteMessage(state.accumulatedText)
          }
        } else {
          console.log('[Handler] No text accumulated, sending empty final response')
          if (supportsChunking) {
            await sendFinalResponse('', responseId, {
              chainOfThought: chainOfThought,
              thinkingContent: accumulatedThinkingRef.current || undefined
            })
          }
        }
      }

    } catch (error) {
      console.error('[Handler] Error in message handling:', error)

      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[Handler] Request was aborted by user')
        return
      }

      const errorMessage = `Sorry, there was an error communicating with the agent: ${error instanceof Error ? error.message : 'Unknown error'}`

      if (supportsChunking && streamingStateRef.current.hasStartedStreaming) {
        await sendFinalResponse(errorMessage, streamingStateRef.current.responseId || responseId)
      } else {
        await sendCompleteMessage(errorMessage, true)
      }
    } finally {
      abortControllerRef.current = null
      currentTaskIdRef.current = null

      const finalState = streamingStateRef.current
      if (!finalState.finalResponseSent && finalState.responseId) {
        console.log('[Handler] Finally block: forcing final response to clear typing indicator')
        const instance = chatInstanceRef.current
        if (instance?.messaging?.addMessageChunk && finalState.supportsChunking) {
          try {
            if (streamCitationsRef.current.length > 0) {
              await instance.messaging.addMessageChunk({
                partial_item: {
                  response_type: MessageResponseTypes.USER_DEFINED,
                  user_defined: {
                    type: 'sources_list',
                    citations: streamCitationsRef.current
                  },
                  streaming_metadata: { id: 'citations' }
                },
                streaming_metadata: { response_id: finalState.responseId }
              })
            }

            await instance.messaging.addMessageChunk({
              complete_item: {
                response_type: MessageResponseTypes.TEXT,
                text: finalState.accumulatedText || '',
                streaming_metadata: { id: '1' }
              },
              streaming_metadata: { response_id: finalState.responseId }
            })

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const genericItems: any[] = [{
              response_type: MessageResponseTypes.TEXT,
              text: finalState.accumulatedText || '',
              streaming_metadata: { id: '1' }
            }]

            if (streamCitationsRef.current.length > 0) {
              genericItems.push({
                response_type: MessageResponseTypes.USER_DEFINED,
                user_defined: {
                  type: 'sources_list',
                  citations: streamCitationsRef.current
                },
                streaming_metadata: { id: 'citations' }
              })
            }

            await instance.messaging.addMessageChunk({
              final_response: {
                id: finalState.responseId,
                output: { generic: genericItems },
                message_options: {
                  response_user_profile: agentProfile,
                  chain_of_thought: chainOfThought.length > 0 ? chainOfThought : undefined,
                  reasoning: accumulatedThinkingRef.current
                    ? { content: accumulatedThinkingRef.current }
                    : undefined
                }
              }
            })

            console.log('[Handler] Finally block: completed 3-step finalization')
          } catch (e) {
            console.error('[Handler] Finally block: failed to complete finalization:', e)
          }
        } else if (!finalState.supportsChunking && finalState.accumulatedText) {
          try {
            await sendCompleteMessage(finalState.accumulatedText)
          } catch (e) {
            console.error('[Handler] Finally block: failed to send complete message:', e)
          }
        }
      }

      setIsStreaming(false)
      streamingStateRef.current = {
        responseId: null,
        accumulatedText: '',
        hasStartedStreaming: false,
        supportsChunking: streamingStateRef.current.supportsChunking,
        finalResponseSent: false
      }
    }
  }, [agentUrl, apiKey, extensions, sendPartialChunk, sendCompleteTextItem, sendFinalResponse, sendCompleteMessage, sendUserDefinedMessage, sendCitationsMessage, sendCitationsPartialItem, agentProfile, debouncedPushReasoningSteps, pushChainOfThought, queueTextChunk, flushTextQueue, executeFinalization])

  /**
   * Handle form submission for input-required state
   */
  const handleFormSubmit = useCallback(async (values: Record<string, unknown>) => {
    console.log('[Form] Submitting form values:', values)

    setCurrentFormRequest(null)
    const taskId = pendingTaskId
    setPendingTaskId(null)

    const formResponseMessage = JSON.stringify({
      type: 'form_response',
      taskId,
      values
    })

    await handleSendMessage(formResponseMessage)
  }, [pendingTaskId, handleSendMessage])

  /**
   * Handle form cancellation
   */
  const handleFormCancel = useCallback(() => {
    console.log('[Form] Form cancelled')
    setCurrentFormRequest(null)
    setPendingTaskId(null)
  }, [])

  // ==========================================================================
  // CUSTOM RESPONSE RENDERER
  // ==========================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderCustomResponse = useCallback((state: any, _instance: any) => {
    const messageItem = state.messageItem
    const userDefined = messageItem?.user_defined

    if (!userDefined) return null

    // Text with citations
    if (userDefined.type === 'text_with_citations') {
      return (
        <CitationRenderer
          text={userDefined.text}
          citations={userDefined.citations || []}
        />
      )
    }

    // Sources list (citations without text)
    if (userDefined.type === 'sources_list' && userDefined.citations) {
      const citations = userDefined.citations as Citation[]
      if (citations.length === 0) return null

      const uniqueCitations = citations.filter(
        (c, i, arr) => c.url && arr.findIndex(x => x.url === c.url) === i
      )

      return (
        <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Sources</h4>
          <ol className="list-decimal list-inside space-y-1">
            {uniqueCitations.map((citation, idx) => (
              <li key={idx} className="text-sm">
                <a
                  href={citation.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {citation.title || citation.url || `Source ${idx + 1}`}
                </a>
                {citation.description && (
                  <span className="text-gray-500 dark:text-gray-400 ml-2"> {citation.description}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )
    }

    // Image
    if (userDefined.type === 'image') {
      return (
        <div>
          <img
            src={userDefined.url}
            alt={userDefined.alt || 'Image'}
            className="max-w-full rounded-lg"
          />
          {userDefined.caption && (
            <p className="text-sm text-gray-600 mt-2">{userDefined.caption}</p>
          )}
        </div>
      )
    }

    // Chart
    if (userDefined.type === 'chart') {
      return (
        <div className="border rounded-lg p-4 bg-white">
          {userDefined.title && (
            <h3 className="text-lg font-semibold mb-2">{userDefined.title}</h3>
          )}
          <img src={userDefined.imageUrl} className="w-full" alt={userDefined.title || 'Chart'} />
          {userDefined.description && (
            <p className="text-sm text-gray-600 mt-2">{userDefined.description}</p>
          )}
        </div>
      )
    }

    // File attachment
    if (userDefined.type === 'file_attachment') {
      return (
        <a
          href={userDefined.downloadUrl}
          download={userDefined.fileName}
          className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 transition"
        >
          <div className="text-2xl">{'\uD83D\uDCCE'}</div>
          <div>
            <div className="font-medium">{userDefined.fileName}</div>
            <div className="text-sm text-gray-500">
              {`${userDefined.mimeType} \u2022 ${formatFileSize(userDefined.size)}`}
            </div>
          </div>
        </a>
      )
    }

    // Data table
    if (userDefined.type === 'data_table') {
      return (
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              {userDefined.columns.map((col: string) => (
                <th key={col} className="border px-4 py-2 bg-gray-100 font-semibold text-left">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {userDefined.rows.map((row: any, i: number) => (
              <tr key={i}>
                {userDefined.columns.map((col: string) => (
                  <td key={col} className="border px-4 py-2">
                    {row[col]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    // Structured data
    if (userDefined.type === 'structured_data') {
      return (
        <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto">
          <code>{JSON.stringify(userDefined.data, null, 2)}</code>
        </pre>
      )
    }

    // Status message
    if (userDefined.type === 'status_message') {
      const bgColor =
        userDefined.messageType === 'error'
          ? 'bg-red-50 border-red-200'
          : userDefined.messageType === 'warning'
            ? 'bg-yellow-50 border-yellow-200'
            : 'bg-blue-50 border-blue-200'

      const textColor =
        userDefined.messageType === 'error'
          ? 'text-red-700'
          : userDefined.messageType === 'warning'
            ? 'text-yellow-700'
            : 'text-blue-700'

      const icon =
        userDefined.messageType === 'error'
          ? '\u26A0\uFE0F'
          : userDefined.messageType === 'warning'
            ? '\u26A0\uFE0F'
            : '\u2139\uFE0F'

      return (
        <div className={`border rounded-lg p-3 ${bgColor}`}>
          <div className={`flex items-start gap-2 ${textColor}`}>
            <span className="flex-shrink-0">{icon}</span>
            <span>{userDefined.text}</span>
          </div>
        </div>
      )
    }

    return null
  }, [])

  // ==========================================================================
  // INSTANCE READY HANDLER
  // ==========================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onAfterRender = useCallback((instance: any) => {
    chatInstanceRef.current = instance

    console.log('[Init] Chat instance ready, layout:', layout)
    console.log('[Init] Available messaging methods:', Object.keys(instance?.messaging || {}))
    console.log('[Init] serviceManager available:', !!instance?.serviceManager)

    try {
      if (instance?.updateIsChatLoadingCounter) {
        instance.updateIsChatLoadingCounter('reset')
        console.log('[Init] Reset loading counter')
      }

      if (instance?.messaging?.addMessageChunk) {
        instance.messaging.addMessageChunk({
          final_response: {
            id: 'init-clear-' + Date.now(),
            output: { generic: [] }
          }
        }).catch(() => {
          // Ignore errors
        })
        console.log('[Init] Sent clearing final_response')
      }
    } catch (e) {
      console.log('[Init] Could not clear pending state:', e)
    }

    setInstanceReady(true)
  }, [layout])

  // ==========================================================================
  // SHARED CONFIG PROPS
  // ==========================================================================

  const sharedConfig = useMemo(() => ({
    debug: true,
    aiEnabled: true,
    openChatByDefault: layout !== 'float',
    exposeServiceManagerForTesting: true,
    strings: customStrings,
    layout: {
      showFrame: layout === 'float'
    },
    header: {
      title: agentName,
      menuOptions: headerMenuOptions
    },
    ...(layout === 'float' && {
      launcher: {
        isOn: true
      }
    })
  }), [layout, customStrings, agentName, headerMenuOptions])

  // ==========================================================================
  // RENDER
  // ==========================================================================

  // Wrapper for overlays that appear regardless of layout
  const overlays = (
    <>
      {/* Streaming indicator */}
      {showThinkingIndicator && isStreaming && (
        <div className="chat-panel__status-indicator">
          <div className="chat-panel__status-content">
            <div className="chat-panel__status-spinner" />
            <span>Agent is responding...</span>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {currentError && (
        <div className="chat-panel__error-overlay">
          <div className="chat-panel__error-content">
            <ErrorRenderer error={currentError} />
          </div>
        </div>
      )}

      {/* Form overlay */}
      {currentFormRequest && (
        <div className="chat-panel__form-overlay">
          <div className="chat-panel__form-content">
            <FormRenderer
              form={currentFormRequest}
              onSubmit={handleFormSubmit}
              onCancel={handleFormCancel}
            />
          </div>
        </div>
      )}
    </>
  )

  // ==========================================================================
  // FLOAT LAYOUT - Uses ChatContainer
  // ==========================================================================

  if (layout === 'float') {
    return (
      <>
        {overlays}
        <ChatContainer
          {...sharedConfig as Record<string, unknown>}
          onAfterRender={onAfterRender}
          renderUserDefinedResponse={renderCustomResponse}
          messaging={{
            skipWelcome: true,
            messageLoadingIndicatorTimeoutSecs: 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            customSendMessage: async (request: any, _options: any, _instance: any) => {
              if (request.input?.text) {
                await handleSendMessage(request.input.text)
              }
            },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any}
        />
      </>
    )
  }

  // ==========================================================================
  // FULLSCREEN & SIDEBAR LAYOUTS - Use ChatCustomElement
  // ==========================================================================

  // CRITICAL: No parent wrapper div for sizing
  // className with explicit viewport dimensions goes directly on ChatCustomElement
  return (
    <>
      {overlays}

      <ChatCustomElement
        {...{
          className: elementClassName,  // Direct sizing class
          ...sharedConfig
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any}
        onViewChange={layout === 'sidebar' ? onViewChange : undefined}
        onViewPreChange={layout === 'sidebar' ? onViewPreChange : undefined}
        onAfterRender={onAfterRender}
        renderUserDefinedResponse={renderCustomResponse}
        messaging={{
          skipWelcome: true,
          messageLoadingIndicatorTimeoutSecs: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          customSendMessage: async (request: any, _options: any, _instance: any) => {
            if (request.input?.text) {
              await handleSendMessage(request.input.text)
            }
          },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any}
      />
    </>
  )
}
