'use client'

import dynamic from 'next/dynamic'
import { useRef, useCallback, useState, useMemo, useEffect } from 'react'
import {
  parseUIExtensions,
  extractCitations,
  extractTrajectory,
  extractError,
  extractFormRequest,
  type Citation,
  type TrajectoryMetadata,
  type ErrorMetadata,
  type FormRequestMetadata,
} from '@/lib/a2a'
import {
  A2AToCarbonTranslator,
  createTranslator,
  isFinalResponse,
  isPartialItem,
  isCompleteItem,
  type CarbonStreamChunk,
  type ReasoningStep as TranslatorReasoningStep,
  type ChainOfThoughtStep as TranslatorChainOfThoughtStep,
} from '@/lib/translator'
import { CitationRenderer, ErrorRenderer, FormRenderer } from '@/components/renderers/index'

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

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

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

interface FullScreenChatProps {
  agentUrl: string
  apiKey?: string
  agentName?: string
  agentDescription?: string
  agentIconUrl?: string  // Custom icon URL for agent avatar (use '/bot.svg' for default bot icon)
  onDisconnect?: () => void
  extensions?: A2AExtensionConfig
  showThinkingIndicator?: boolean
}

// =============================================================================
// CHAIN OF THOUGHT & REASONING TYPES
// Based on Carbon AI Chat message_options
// =============================================================================

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
  request?: { args: any }
  response?: { content: any }
  status: ChainOfThoughtStepStatus
}

// =============================================================================
// CARBON AI CHAT MESSAGE TYPES
// Based on Carbon AI Chat documentation and source code
// =============================================================================

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
function hasStreamingSupport(instance: any): boolean {
  return instance?.messaging?.addMessageChunk !== undefined
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function FullScreenChat({
  agentUrl,
  apiKey = '',
  agentName = 'AI Assistant',
  agentDescription,
  agentIconUrl = '/bot.svg',  // Default to bot.svg - replace with your own icon
  onDisconnect,
  extensions,
  showThinkingIndicator = true
}: FullScreenChatProps) {
  const chatInstanceRef = useRef<any>(null)

  // Track when the chat instance is ready (set in onAfterRender)
  const [instanceReady, setInstanceReady] = useState(false)

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false)

  // A2A to Carbon message_options state
  const [reasoningSteps, setReasoningSteps] = useState<ReasoningStep[]>([])
  const [chainOfThought, setChainOfThought] = useState<ChainOfThoughtStep[]>([])

  // UI Extension state for current message
  const [currentCitations, setCurrentCitations] = useState<Citation[]>([])
  const [currentError, setCurrentError] = useState<ErrorMetadata | null>(null)
  const [currentFormRequest, setCurrentFormRequest] = useState<FormRequestMetadata | null>(null)
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null)

  // Ref for tracking citations during streaming (to access from useCallback)
  const streamCitationsRef = useRef<Citation[]>([])
  // Refs for tracking chain of thought and reasoning steps during streaming
  // These are needed for handleCancelRequest which is a separate callback
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

  // A2A to Carbon translator instance
  const translatorRef = useRef<A2AToCarbonTranslator | null>(null)

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Non-blocking text chunk queue
  // Reference: scenarios.ts uses setTimeout for non-blocking sends
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const textChunkQueueRef = useRef<string[]>([])
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const CHUNK_FLUSH_INTERVAL = 50  // ms - balances responsiveness vs load

  // Debounce tracking for reasoning pushes
  const lastReasoningPushRef = useRef<number>(0)
  const REASONING_PUSH_MIN_INTERVAL = 200  // ms - max 5 pushes per second

  // =============================================================================
  // CUSTOM STRINGS FOR AI EXPLAINED POPUP
  // =============================================================================

  const customStrings = useMemo(() => ({
    ai_slug_title: `Powered by ${agentName}`,
    ai_slug_description: agentDescription ||
      `${agentName} uses AI to process conversations and provide assistance.`
  }), [agentName, agentDescription])

  // =============================================================================
  // AGENT PROFILE FOR MESSAGE BUBBLES
  // This customizes the name and icon shown in agent response bubbles
  // =============================================================================

  const agentProfile = useMemo(() => ({
    id: 'a2a-agent',
    nickname: agentName,           // Shows agent name instead of 'watsonx'
    user_type: 'bot' as const,     // 'bot' allows custom icon; 'watsonx' uses default gradient
    profile_picture_url: agentIconUrl  // Custom avatar icon URL
  }), [agentName, agentIconUrl])

  // =============================================================================
  // HEADER MENU OPTIONS WITH DISCONNECT
  // =============================================================================

  const headerMenuOptions = useMemo(() => {
    if (!onDisconnect) return undefined
    return [{
      text: 'Disconnect',
      handler: () => {
        if (window.confirm('Disconnect from this agent?')) {
          onDisconnect()
        }
      }
    }]
  }, [onDisconnect])

  // =============================================================================
  // APPLY STRINGS TO REDUX STORE
  // Carbon AI Chat uses Redux internally - dispatching directly ensures strings
  // persist through config updates that would otherwise reset the language pack.
  // Requires exposeServiceManagerForTesting={true} on ChatCustomElement.
  // =============================================================================

  const applyStringsToRedux = useCallback(() => {
    const instance = chatInstanceRef.current
    if (!instance?.serviceManager?.store) {
      console.warn('[Strings] serviceManager.store not available - ensure exposeServiceManagerForTesting={true}')
      return
    }

    try {
      // Get the current state to access the existing language pack
      const currentState = instance.serviceManager.store.getState()
      const currentLanguagePack = currentState?.config?.derived?.languagePack || {}

      // Merge custom strings over the current language pack
      const merged = { ...currentLanguagePack, ...customStrings }

      // Dispatch directly to Redux store using the CHANGE_STATE action
      // This bypasses the config update mechanism that causes the reset
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

      console.log('[Strings] Applied custom strings to Redux store:', Object.keys(customStrings))
    } catch (err) {
      console.error('[Strings] Failed to apply strings to Redux:', err)
    }
  }, [customStrings])

  // =============================================================================
  // STORE SUBSCRIPTION TO PERSIST CUSTOM STRINGS
  // Carbon AI Chat's applyConfigChangesDynamically() replaces the entire config,
  // which resets languagePack to defaults. This subscription detects when our
  // custom strings are overwritten and immediately re-applies them.
  // =============================================================================

  useEffect(() => {
    if (!instanceReady) return

    const instance = chatInstanceRef.current
    if (!instance?.serviceManager?.store) {
      console.warn('[Strings] Store not available for subscription')
      return
    }

    const store = instance.serviceManager.store

    // Apply custom strings immediately when subscription starts
    applyStringsToRedux()

    // Subscribe to store changes to detect when strings are overwritten
    const unsubscribe = store.subscribe(() => {
      const state = store.getState()
      const currentTitle = state?.config?.derived?.languagePack?.ai_slug_title

      // If our custom title was overwritten, re-apply all custom strings
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

  // Cleanup on unmount - cancel any pending requests
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [])

  // Initialize translator when agent profile is available
  useEffect(() => {
    translatorRef.current = createTranslator(agentName, agentIconUrl)
    console.log('[Translator] Initialized with agent:', agentName)
  }, [agentName, agentIconUrl])

  // =============================================================================
  // STREAMING METHODS
  // =============================================================================

  /**
   * Send a partial chunk during streaming
   */
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

  /**
   * Queue a text chunk for non-blocking send to Carbon.
   * Chunks are batched and flushed every CHUNK_FLUSH_INTERVAL ms.
   *
   * This prevents blocking the SSE parse loop while still providing
   * smooth streaming to the UI.
   *
   * Reference: scenarios.ts uses setTimeout scheduling
   */
  const queueTextChunk = useCallback((
    text: string,
    responseId: string,
    itemId: string
  ) => {
    textChunkQueueRef.current.push(text)

    // Schedule flush if not already scheduled
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

  /**
   * Flush any pending chunks immediately.
   * Call this before finalization to ensure all text is sent.
   */
  const flushTextQueue = useCallback(async (
    responseId: string,
    itemId: string
  ) => {
    // Clear scheduled flush
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }

    // Send remaining chunks
    const remaining = textChunkQueueRef.current.join('')
    textChunkQueueRef.current = []

    if (remaining) {
      await sendPartialChunk(remaining, responseId, itemId)
    }
  }, [sendPartialChunk])

  /**
   * Send complete_item to finalize a streaming text item
   * IMPORTANT: Call this BEFORE final_response for smooth transitions
   */
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

  /**
   * Send citations as a partial_item during streaming
   * This allows the UI to render sources incrementally rather than all at once
   */
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
            id: 'citations'  // Fixed ID so updates merge correctly
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

  /**
   * Send the final response chunk (REQUIRED to clear typing indicator)
   * Now includes citations inline and preserves chain of thought
   */
  const sendFinalResponse = useCallback(async (
    fullText: string,
    responseId: string,
    options?: {
      citations?: Citation[]
      chainOfThought?: ChainOfThoughtStep[]
      thinkingContent?: string  // Accumulated thinking content for reasoning.content mode
    }
  ): Promise<boolean> => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
      console.warn('[Streaming] Cannot send final_response - addMessageChunk not available')
      return false
    }

    // Prevent duplicate final responses
    if (streamingStateRef.current.finalResponseSent) {
      console.log('[Streaming] Final response already sent, skipping duplicate')
      return true
    }

    try {
      // Build the generic items array
      const genericItems: Array<{
        response_type: string
        text?: string
        user_defined?: Record<string, unknown>
        streaming_metadata?: { id: string }
      }> = []

      // Add main text response
      genericItems.push({
        response_type: MessageResponseTypes.TEXT,
        text: fullText,
        streaming_metadata: { id: '1' }
      })

      // Add citations inline (not as separate message!)
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
            // CRITICAL: Preserve chain of thought so accordion stays visible
            chain_of_thought: options?.chainOfThought && options.chainOfThought.length > 0
              ? options.chainOfThought
              : undefined,
            // CRITICAL: Preserve thinking content using reasoning.content mode
            reasoning: options?.thinkingContent
              ? { content: options.thinkingContent }
              : undefined
          }
        }
      }

      console.log('[Streaming] ✅ Sending final_response:', {
        textLength: fullText.length,
        responseId,
        citationCount: options?.citations?.length || 0,
        chainOfThoughtCount: options?.chainOfThought?.length || 0,
        thinkingContentLength: options?.thinkingContent?.length || 0
      })
      await instance.messaging.addMessageChunk(finalResponse)
      streamingStateRef.current.finalResponseSent = true
      console.log('[Streaming] ✅ final_response sent successfully')
      return true
    } catch (err) {
      console.error('[Streaming] Failed to send final response:', err)
      return false
    }
  }, [agentProfile])

  /**
   * Fallback: Send a complete message using addMessage (non-streaming)
   */
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

      // Mark final response as sent to prevent double-clearing
      streamingStateRef.current.finalResponseSent = true

      return true
    } catch (err) {
      console.error('[Message] Failed to send message:', err)
      return false
    }
  }, [agentProfile])

  /**
   * Send citations as a follow-up message with source list
   */
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

  /**
   * Send a user-defined message (for files, structured data, etc.)
   */
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
          response_user_profile: agentProfile  // Custom agent name and icon
        }
      }

      await instance.messaging.addMessage(message)
      return true
    } catch (err) {
      console.error('[Message] Failed to send user-defined message:', err)
      return false
    }
  }, [agentProfile])

  /**
   * Push reasoning steps to Carbon via message_options
   * Used for thinking/reasoning content from A2A agents
   */
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
          text: '',  // Don't show thinking as main text
          streaming_metadata: {
            id: itemId
          }
        },
        partial_response: {
          message_options: {
            response_user_profile: agentProfile,
            reasoning: {
              steps,
              open_state: 'default'  // Auto-expand during streaming
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

  /**
   * Push chain of thought to Carbon via message_options
   * Used for tool calls and their results from A2A agents
   */
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
          text: '',  // Don't show CoT as main text
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

  /**
   * Push reasoning steps with debouncing.
   * Prevents overwhelming Carbon with rapid updates (max 5/second).
   */
  const debouncedPushReasoningSteps = useCallback(async (
    responseId: string,
    steps: ReasoningStep[],
    itemId: string
  ): Promise<boolean> => {
    const now = Date.now()
    const elapsed = now - lastReasoningPushRef.current

    if (elapsed < REASONING_PUSH_MIN_INTERVAL) {
      // Wait for remaining interval
      await new Promise(resolve =>
        setTimeout(resolve, REASONING_PUSH_MIN_INTERVAL - elapsed)
      )
    }

    lastReasoningPushRef.current = Date.now()
    return pushReasoningSteps(responseId, steps, itemId)
  }, [pushReasoningSteps])

  /**
   * Execute the 3-step finalization pattern required by Carbon AI Chat.
   *
   * Reference: CustomServer.md - "Typical streaming flow"
   * Reference: scenarios.ts - streamText function
   *
   * Steps:
   * 1. complete_item - Finalize the text item with full content
   * 2. final_response - Close the message and clear UI state
   */
  const executeFinalization = useCallback(async (
    responseId: string,
    itemId: string,
    options: {
      text: string
      chainOfThought?: ChainOfThoughtStep[]
      thinkingContent?: string  // Accumulated thinking content for reasoning.content mode
      citations?: Citation[]
      wasCancelled?: boolean
    }
  ): Promise<boolean> => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
      console.warn('[Finalization] addMessageChunk not available')
      return false
    }

    // Prevent duplicate finalization
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

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // STEP 1: complete_item with full accumulated text
      // Reference: scenarios.ts line ~127
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
      console.log('[Finalization] ✅ Step 1: complete_item sent')

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // STEP 2: Build generic items array for final_response
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const genericItems: any[] = [{
        response_type: MessageResponseTypes.TEXT,
        text: options.text,
        streaming_metadata: { id: itemId }
      }]

      // Add citations as user_defined item if present
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

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // STEP 3: final_response with message_options preserved
      // Reference: scenarios.ts line ~137
      // "if (finalMessageOptions) { finalResponse.final_response.message_options = finalMessageOptions }"
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const messageOptions: any = {
        response_user_profile: agentProfile
      }

      // Preserve thinking content in final response using reasoning.content mode
      if (options.thinkingContent) {
        messageOptions.reasoning = {
          content: options.thinkingContent
        }
      }

      // Preserve chain of thought in final response
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
      console.log('[Finalization] ✅ Step 2: final_response sent')

      // Mark as complete
      streamingStateRef.current.finalResponseSent = true
      return true

    } catch (error) {
      console.error('[Finalization] Error:', error)
      return false
    }
  }, [agentProfile])

  /**
   * Cancel the current streaming request - sends A2A cancel and clears UI
   * Preserves chain of thought and reasoning steps accumulated so far
   */
  const handleCancelRequest = useCallback(async () => {
    console.log('[Cancel] Canceling current request')

    // 1. Abort frontend fetch connection
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    // 2. Send A2A task/cancel to backend agent
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

    // 3. Execute finalization with cancel flag using shared helper
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

    // 4. Reset all state (don't manipulate loading counter - let Carbon handle it)
    streamingStateRef.current = {
      responseId: null,
      accumulatedText: '',
      hasStartedStreaming: false,
      supportsChunking: streamingStateRef.current.supportsChunking,
      finalResponseSent: true
    }
    // Reset refs
    chainOfThoughtRef.current = []
    reasoningStepsRef.current = []
    accumulatedThinkingRef.current = ''
    streamCitationsRef.current = []
    setIsStreaming(false)
  }, [agentUrl, apiKey, executeFinalization])

  // =============================================================================
  // MAIN MESSAGE HANDLER
  // =============================================================================

  const handleSendMessage = useCallback(async (message: string) => {
    const instance = chatInstanceRef.current
    
    // Debug: Log available methods on first call
    if (streamingStateRef.current.supportsChunking === null) {
      console.log('[Debug] Chat instance:', instance)
      console.log('[Debug] Messaging API:', instance?.messaging)
      console.log('[Debug] Available methods:', Object.keys(instance?.messaging || {}))
      console.log('[Debug] addMessageChunk exists:', typeof instance?.messaging?.addMessageChunk)
      console.log('[Debug] addMessage exists:', typeof instance?.messaging?.addMessage)
      streamingStateRef.current.supportsChunking = hasStreamingSupport(instance)
    }

    const supportsChunking = streamingStateRef.current.supportsChunking

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Clear any pending state from previous message
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

    // Reset A2A to Carbon message_options state for new message
    setReasoningSteps([])
    setChainOfThought([])

    // Reset UI extension state for new message
    setCurrentCitations([])
    setCurrentError(null)
    setCurrentFormRequest(null)
    setPendingTaskId(null)
    streamCitationsRef.current = []

    // Local tracking arrays for chain of thought and reasoning steps
    // These are maintained alongside React state so we can pass them to sendFinalResponse
    // (React state updates are async and won't be available in the closure)
    const chainOfThought: ChainOfThoughtStep[] = []
    const reasoningSteps: ReasoningStep[] = []

    // Also reset refs for cancel handler access
    chainOfThoughtRef.current = []
    reasoningStepsRef.current = []
    accumulatedThinkingRef.current = ''  // Reset thinking accumulator for new message

    console.log('[Handler] Starting message handling:', {
      supportsChunking,
      responseId,
      messagePreview: message.substring(0, 50)
    })

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // CRITICAL: Create shell message BEFORE streaming begins
    // This seeds the message container so Carbon's reducers can attach chunks
    // Without this, streaming chunks have nothing to attach to and the UI
    // gets stuck in a "responding" state
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
                reasoning: { content: '' }    // Initialize empty reasoning content for token streaming
                // chain_of_thought intentionally omitted - will be added on first tool call
              }
            },
            streaming_metadata: { response_id: responseId }
          })
          console.log('[Handler] ✅ Shell message created:', { responseId, itemId })
        } catch (err) {
          console.error('[Handler] Failed to create shell message:', err)
        }
      }
    }

    try {
      // Create abort controller for this request
      abortControllerRef.current = new AbortController()

      // Reset task ID
      currentTaskIdRef.current = null

      // Make request to A2A proxy
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

      // Process the SSE stream
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

          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          // CRITICAL: Execute finalization on normal stream completion
          // Reference: CustomServer.md - "Always send a final response chunk"
          // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          if (!streamingStateRef.current.finalResponseSent && supportsChunking) {
            // Flush any pending text chunks before finalization
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

              // Handle JSON-RPC errors
              if (data.error) {
                console.error('[Handler] A2A error:', data.error)
                const errorText = `Error: ${data.error.message}`
                
                if (supportsChunking && streamingStateRef.current.hasStartedStreaming) {
                  // End streaming with error
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

                // Capture taskId for cancellation support
                if (result.taskId && !currentTaskIdRef.current) {
                  currentTaskIdRef.current = result.taskId
                  console.log('[Handler] Captured taskId:', result.taskId)
                }

                // Handle status updates with agent messages
                if (result.kind === 'status-update' && result.status?.message) {
                  const agentMessage = result.status.message

                  // Parse UI extensions from message-level metadata
                  const uiExtensions = parseUIExtensions(agentMessage.metadata)

                  // Extract citations from message metadata
                  if (uiExtensions.citations?.citations?.length) {
                    const newCitations = uiExtensions.citations.citations
                    streamCitationsRef.current = [...streamCitationsRef.current, ...newCitations]
                    setCurrentCitations(prev => [...prev, ...newCitations])

                    // Stream citations immediately as they arrive for smoother UX
                    if (supportsChunking && streamingStateRef.current.hasStartedStreaming) {
                      await sendCitationsPartialItem(streamCitationsRef.current, responseId)
                    }
                  }

                  // Extract error from message metadata
                  if (uiExtensions.error) {
                    setCurrentError(uiExtensions.error)
                    console.log('[Handler] Error extension:', uiExtensions.error)
                  }

                  // Extract form request from message metadata (for input-required state)
                  if (uiExtensions.formRequest) {
                    setCurrentFormRequest(uiExtensions.formRequest)
                    setPendingTaskId(result.taskId || null)
                    console.log('[Handler] Form request extension:', uiExtensions.formRequest)
                  }

                  for (const part of agentMessage.parts) {
                    const contentType = part.metadata?.content_type

                    // Log part processing for debugging
                    console.log('[Handler] Processing part:', {
                      kind: part.kind,
                      contentType,
                      hasText: !!part.text,
                      hasData: !!part.data,
                      dataType: part.data?.type
                    })

                    // Parse UI extensions from part-level metadata (trajectory often comes here)
                    const partExtensions = parseUIExtensions(part.metadata as Record<string, unknown>)

                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    // TRAJECTORY (legacy) → Route to reasoning accordion
                    // NOTE: Trajectory is metadata-only - it does NOT consume the part's content
                    // After processing trajectory, we continue to check the part's actual content
                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    // FIXED: Async calls OUTSIDE setState, following Carbon's pattern
                    // Reference: scenarios.ts runReasoningStepsScenario
                    if (partExtensions.trajectory) {
                      const trajectory = partExtensions.trajectory
                      const newStep: ReasoningStep = {
                        title: trajectory.title || 'Reasoning',
                        content: trajectory.content || '',
                        open_state: 'default'
                      }

                      // Step 1: Synchronous array mutation (like Carbon's collectedSteps.push)
                      reasoningSteps.push(newStep)

                      // Step 2: Update ref for cancel handler access
                      reasoningStepsRef.current = [...reasoningSteps]

                      // Step 3: Update React state - PURE, no side effects!
                      setReasoningSteps([...reasoningSteps])

                      // Step 4: Push to Carbon OUTSIDE setState (properly awaited)
                      if (supportsChunking) {
                        await debouncedPushReasoningSteps(responseId, reasoningSteps, itemId)
                      }

                      console.log('[Handler] Added trajectory step:', { title: trajectory.title, groupId: trajectory.group_id })
                      // NOTE: Do NOT use 'continue' here - trajectory is metadata only,
                      // the part's actual content (text/data/file) should still be processed below
                    }

                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    // THINKING CONTENT → Route to reasoning accordion using content mode
                    // Uses reasoning.content for continuous token streaming instead of steps[]
                    // Reference: Carbon AI Chat streamReasoningContentFirst() pattern
                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    if (contentType === 'thinking' && part.kind === 'text' && part.text) {
                      // Phase 1: Stream to reasoning.content (existing behavior)
                      accumulatedThinkingRef.current += part.text

                      // Push accumulated content to Carbon for live streaming display
                      // CRITICAL: Must include partial_item and streaming_metadata.response_id
                      // so Carbon knows which message to update
                      if (supportsChunking) {
                        const instance = chatInstanceRef.current
                        if (instance?.messaging?.addMessageChunk) {
                          await instance.messaging.addMessageChunk({
                            partial_item: {
                              response_type: MessageResponseTypes.TEXT,
                              text: '',  // Main text stays empty during thinking
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

                      // CRITICAL: Do NOT add to accumulatedText - thinking goes to accordion only
                      continue
                    }

                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    // REASONING STEP → Route based on whether title is present
                    // - No title: stream to reasoning.content
                    // - With title: add to reasoning.steps[] as discrete step
                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    if (contentType === 'reasoning_step' && part.kind === 'text' && part.text) {
                      const stepTitle = part.metadata?.title as string | undefined

                      if (stepTitle) {
                        // DISCRETE MODE: Has title -> add to reasoning.steps[]
                        const newStep: ReasoningStep = {
                          title: stepTitle,
                          content: part.text,
                          open_state: 'default'
                        }

                        reasoningSteps.push(newStep)
                        reasoningStepsRef.current = [...reasoningSteps]
                        setReasoningSteps([...reasoningSteps])

                        if (supportsChunking) {
                          await debouncedPushReasoningSteps(responseId, reasoningSteps, itemId)
                        }

                        console.log('[Handler] Added discrete reasoning step:', {
                          title: stepTitle,
                          totalSteps: reasoningSteps.length
                        })
                      } else {
                        // STREAMING MODE: No title -> append to reasoning.content
                        accumulatedThinkingRef.current += part.text

                        if (supportsChunking) {
                          const instance = chatInstanceRef.current
                          if (instance?.messaging?.addMessageChunk) {
                            await instance.messaging.addMessageChunk({
                              partial_item: {
                                response_type: MessageResponseTypes.TEXT,
                                text: '',  // Main text stays empty during reasoning
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
                      }

                      continue
                    }

                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    // TOOL CALL → Track in chain_of_thought and show immediately with spinner
                    // Push to Carbon right away so user sees the accordion with IN_PROGRESS status
                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    else if (part.kind === 'data' && part.data?.type === 'tool_call') {
                      const toolData = part.data as { tool_name?: string; args?: any; type: string }
                      const cotStep: ChainOfThoughtStep = {
                        title: toolData.tool_name || 'Tool Call',
                        description: `Calling ${toolData.tool_name || 'tool'}`,
                        tool_name: toolData.tool_name,
                        request: { args: toolData.args },
                        status: ChainOfThoughtStepStatus.IN_PROGRESS  // Show spinner
                      }

                      // Step 1: Synchronous array mutation
                      chainOfThought.push(cotStep)

                      // Step 2: Update ref for cancel handler access
                      chainOfThoughtRef.current = [...chainOfThought]

                      // Step 3: Update React state - PURE, no side effects!
                      setChainOfThought([...chainOfThought])

                      // Step 4: Push immediately to show the accordion with spinner
                      if (supportsChunking) {
                        await pushChainOfThought(responseId, chainOfThought, itemId)
                      }

                      console.log('[Handler] Tool call started, showing in chain of thought:', {
                        toolName: toolData.tool_name,
                        totalSteps: chainOfThought.length
                      })
                    }

                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    // TOOL RESULT → Update chain_of_thought status and show accordion
                    // This is when we push to Carbon - after tool completes, not when it starts
                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    else if (part.kind === 'data' && part.data?.type === 'tool_result') {
                      const resultData = part.data as { tool_name?: string; result_preview?: any; type: string }

                      // Step 1: Synchronous array mutation - update local array
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

                      // Step 2: Update ref for cancel handler access
                      chainOfThoughtRef.current = [...chainOfThought]

                      // Step 3: Update React state - PURE, no side effects!
                      setChainOfThought([...chainOfThought])

                      // Step 4: Push to Carbon - NOW we show the "How did I get this answer?" accordion
                      // This happens when the tool completes (SUCCESS/ERROR), not when it starts
                      if (supportsChunking) {
                        await pushChainOfThought(responseId, chainOfThought, itemId)
                      }

                      console.log('[Handler] Tool completed, showing chain of thought:', { toolName: resultData.tool_name })
                    }

                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    // RESPONSE CONTENT → Route to main text stream
                    // FIXED: Use non-blocking queue pattern to prevent parse loop blocking
                    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                    else if (part.kind === 'text' && part.text) {
                      const newText = part.text

                      // Always accumulate
                      streamingStateRef.current.accumulatedText += newText
                      streamingStateRef.current.hasStartedStreaming = true

                      if (supportsChunking) {
                        // Queue for batched send - doesn't block parse loop
                        queueTextChunk(newText, responseId, itemId)

                        console.log('[Handler] Queued response text:', {
                          chunkLength: newText.length,
                          queueSize: textChunkQueueRef.current.length
                        })
                      } else {
                        // FALLBACK MODE: Just accumulate, send at end
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

                    // Handle other data parts (not tool_call or tool_result)
                    else if (part.kind === 'data' && part.data &&
                             part.data.type !== 'tool_call' && part.data.type !== 'tool_result') {
                      await sendUserDefinedMessage({
                        type: 'structured_data',
                        data: part.data
                      })
                    }
                  }
                }

                // Handle input-required state (form submission needed)
                if (result.status?.state === 'input-required') {
                  console.log('[Handler] Input required state detected')
                  // Stop streaming and show form - the form renderer will handle submission
                  const pendingText = streamingStateRef.current.accumulatedText
                  if (pendingText && supportsChunking && streamingStateRef.current.hasStartedStreaming) {
                    await sendFinalResponse(pendingText, responseId)
                  }
                  // Don't continue processing - wait for form submission
                  continue
                }

                // Check if stream is complete (final: true OR state: completed)
                const isComplete = result.final === true || result.status?.state === 'completed'

                if (isComplete) {
                  receivedFinalTrue = true
                  console.log('[Handler] ✅ Stream marked as complete:', {
                    final: result.final,
                    state: result.status?.state
                  })

                  if (supportsChunking && streamingStateRef.current.hasStartedStreaming) {
                    // Flush any pending text chunks before finalization
                    await flushTextQueue(responseId, itemId)

                    // Use shared executeFinalization helper
                    await executeFinalization(responseId, itemId, {
                      text: streamingStateRef.current.accumulatedText,
                      chainOfThought: chainOfThought.length > 0 ? chainOfThought : undefined,
                      thinkingContent: accumulatedThinkingRef.current || undefined,
                      citations: streamCitationsRef.current.length > 0 ? streamCitationsRef.current : undefined
                    })

                  } else if (streamingStateRef.current.accumulatedText && !streamingStateRef.current.finalResponseSent) {
                    // FALLBACK MODE: Send accumulated text as single message
                    await sendCompleteMessage(streamingStateRef.current.accumulatedText)
                    streamingStateRef.current.finalResponseSent = true

                    // In fallback mode, still need to send citations separately
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

              // Check if this looks like a Python exception (backend error leaked into stream)
              if (dataStr.includes('Error') || dataStr.includes('Exception') || dataStr.includes('Traceback') || dataStr.includes('AttributeError')) {
                console.error('[Handler] Backend exception detected in stream:', dataStr.substring(0, 300))
                // Append error to accumulated text so user sees it
                const errorPreview = dataStr.substring(0, 500).replace(/[\[\]"]/g, '')
                if (!streamingStateRef.current.accumulatedText.includes('Backend error:')) {
                  streamingStateRef.current.accumulatedText += `\n\n⚠️ Backend error: ${errorPreview}`
                }
              }
            }
          }
        }
      }

      // =======================================================================
      // CRITICAL: Handle stream end without explicit final=true
      // This is the fallback that ensures typing indicator is ALWAYS cleared
      // =======================================================================
      const state = streamingStateRef.current
      
      console.log('[Handler] Post-stream check:', {
        accumulatedText: state.accumulatedText.length,
        hasStartedStreaming: state.hasStartedStreaming,
        finalResponseSent: state.finalResponseSent,
        supportsChunking,
        receivedFinalTrue
      })

      if (!state.finalResponseSent) {
        console.log('[Handler] ⚠️ Final response NOT sent yet - triggering fallback')

        if (state.accumulatedText) {
          if (supportsChunking && state.hasStartedStreaming) {
            console.log('[Handler] Fallback: executing 3-step finalization')

            // Step 1: Citations (if any)
            if (streamCitationsRef.current.length > 0) {
              await sendCitationsPartialItem(streamCitationsRef.current, responseId)
            }

            // Step 2: Complete item
            await sendCompleteTextItem(state.accumulatedText, responseId, '1', false)

            // Step 3: Final response
            await sendFinalResponse(state.accumulatedText, responseId, {
              citations: streamCitationsRef.current,
              chainOfThought: chainOfThought,
              thinkingContent: accumulatedThinkingRef.current || undefined
            })
          } else {
            // Non-streaming fallback
            console.log('[Handler] Sending fallback complete message')
            await sendCompleteMessage(state.accumulatedText)
          }
        } else {
          // No text accumulated - still need to clear typing indicator
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

      // Handle user-initiated abort separately
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[Handler] Request was aborted by user')
        // Typing indicator already cleared by handleCancelRequest
        return
      }

      const errorMessage = `Sorry, there was an error communicating with the agent: ${error instanceof Error ? error.message : 'Unknown error'}`

      if (supportsChunking && streamingStateRef.current.hasStartedStreaming) {
        // End streaming with error
        await sendFinalResponse(errorMessage, streamingStateRef.current.responseId || responseId)
      } else {
        await sendCompleteMessage(errorMessage, true)
      }
    } finally {
      // Clear abort controller
      abortControllerRef.current = null
      currentTaskIdRef.current = null

      // CRITICAL: Ensure typing indicator is ALWAYS cleared
      const finalState = streamingStateRef.current
      if (!finalState.finalResponseSent && finalState.responseId) {
        console.log('[Handler] Finally block: forcing final response to clear typing indicator')
        const instance = chatInstanceRef.current
        if (instance?.messaging?.addMessageChunk && finalState.supportsChunking) {
          try {
            // Complete the 3-step process even in the finally block

            // Step 1: Citations (if any)
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

            // Step 2: Complete item
            await instance.messaging.addMessageChunk({
              complete_item: {
                response_type: MessageResponseTypes.TEXT,
                text: finalState.accumulatedText || '',
                streaming_metadata: { id: '1' }
              },
              streaming_metadata: { response_id: finalState.responseId }
            })

            // Step 3: Final response
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

      // CRITICAL: Ensure typing indicator is ALWAYS cleared via final_response
      // (Don't manually manipulate loading counter - Carbon handles this internally)

      setIsStreaming(false)
      streamingStateRef.current = {
        responseId: null,
        accumulatedText: '',
        hasStartedStreaming: false,
        supportsChunking: streamingStateRef.current.supportsChunking,
        finalResponseSent: false
      }
    }
  }, [agentUrl, apiKey, extensions, sendPartialChunk, sendCompleteTextItem, sendFinalResponse, sendCompleteMessage, sendUserDefinedMessage, sendCitationsMessage, sendCitationsPartialItem, applyStringsToRedux, agentProfile, debouncedPushReasoningSteps, pushChainOfThought, queueTextChunk, flushTextQueue, executeFinalization])

  /**
   * Handle form submission for input-required state
   * Sends form data as a message to resume the task
   */
  const handleFormSubmit = useCallback(async (values: Record<string, unknown>) => {
    console.log('[Form] Submitting form values:', values)

    // Clear the form request state
    setCurrentFormRequest(null)
    const taskId = pendingTaskId
    setPendingTaskId(null)

    // Format the form response as a message
    const formResponseMessage = JSON.stringify({
      type: 'form_response',
      taskId,
      values
    })

    // Send the form response through the normal message handler
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

  // =============================================================================
  // CUSTOM RESPONSE RENDERER
  // =============================================================================

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

      // Deduplicate by URL
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
                  <span className="text-gray-500 dark:text-gray-400 ml-2">— {citation.description}</span>
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
          <div className="text-2xl">📎</div>
          <div>
            <div className="font-medium">{userDefined.fileName}</div>
            <div className="text-sm text-gray-500">
              {`${userDefined.mimeType} • ${formatFileSize(userDefined.size)}`}
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

    // Status message (warnings, errors, info)
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
          ? '⚠️'
          : userDefined.messageType === 'warning'
            ? '⚠️'
            : 'ℹ️'

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

  // =============================================================================
  // RENDER
  // =============================================================================

  return (
    <div className="full-screen-chat">
      {/* Optional: Custom streaming indicator (Carbon should show its own) */}
      {showThinkingIndicator && isStreaming && (
        <div className="agent-status-indicator">
          <div className="agent-status-indicator__content">
            <div className="agent-status-indicator__spinner" />
            <span>Agent is responding...</span>
          </div>
        </div>
      )}

      {/* Error renderer overlay */}
      {currentError && (
        <div className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <div className="max-w-2xl w-full">
            <ErrorRenderer error={currentError} />
          </div>
        </div>
      )}

      {/* Form renderer overlay for input-required state */}
      {currentFormRequest && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <FormRenderer
              form={currentFormRequest}
              onSubmit={handleFormSubmit}
              onCancel={handleFormCancel}
            />
          </div>
        </div>
      )}

      <ChatCustomElement
        {...{
          className: 'chat-custom-element',
          debug: true,
          aiEnabled: true,
          openChatByDefault: true,
          exposeServiceManagerForTesting: true
        } as any}
        strings={customStrings}
        layout={{
          showFrame: false
        }}
        header={{
          title: agentName,
          menuOptions: headerMenuOptions
        }}
        onAfterRender={(instance: any) => {
          chatInstanceRef.current = instance

          console.log('[Init] Chat instance ready')
          console.log('[Init] Available messaging methods:', Object.keys(instance?.messaging || {}))
          console.log('[Init] serviceManager available:', !!instance?.serviceManager)
          console.log('[Init] updateIsChatLoadingCounter available:', !!instance?.updateIsChatLoadingCounter)

          // Clear any stale loading/streaming state on mount using 'reset'
          // NOTE: Don't loop 'decrease' - use 'reset' to avoid console errors
          try {
            if (instance?.updateIsChatLoadingCounter) {
              instance.updateIsChatLoadingCounter('reset')
              console.log('[Init] Reset loading counter')
            }

            // Clear any pending streaming state by sending an empty final response
            if (instance?.messaging?.addMessageChunk) {
              instance.messaging.addMessageChunk({
                final_response: {
                  id: 'init-clear-' + Date.now(),
                  output: { generic: [] }
                }
              }).catch(() => {
                // Ignore errors - there might not be any pending stream
              })
              console.log('[Init] Sent clearing final_response')
            }
          } catch (e) {
            console.log('[Init] Could not clear pending state:', e)
          }

          // Mark instance as ready - this triggers the store subscription
          setInstanceReady(true)
        }}
        renderUserDefinedResponse={renderCustomResponse}
        messaging={{
          skipWelcome: true,
          messageLoadingIndicatorTimeoutSecs: 0,
          customSendMessage: async (request: any, _options: any, _instance: any) => {
            if (request.input?.text) {
              await handleSendMessage(request.input.text)
            }
          },
        } as any}
      />
    </div>
  )
}

// =============================================================================
// UTILITIES
// =============================================================================

function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
