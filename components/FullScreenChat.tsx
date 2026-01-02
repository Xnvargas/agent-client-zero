'use client'

import dynamic from 'next/dynamic'
import { useRef, useCallback, useState } from 'react'

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
}

interface A2AMessage {
  role: string
  messageId: string
  parts: A2AMessagePart[]
}

interface A2AStreamResult {
  contextId?: string
  taskId?: string
  kind: 'status-update' | 'artifact-update'
  status?: {
    state: 'working' | 'completed' | 'failed' | 'canceled'
    message?: A2AMessage
  }
  final?: boolean
}

interface FullScreenChatProps {
  agentUrl: string
  apiKey?: string
  agentName?: string
  onDisconnect?: () => void
  extensions?: A2AExtensionConfig
  showThinkingIndicator?: boolean
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
  onDisconnect,
  extensions,
  showThinkingIndicator = true
}: FullScreenChatProps) {
  const chatInstanceRef = useRef<any>(null)
  
  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false)
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

  // =============================================================================
  // STREAMING METHODS
  // =============================================================================

  /**
   * Send a partial chunk during streaming
   */
  const sendPartialChunk = useCallback((text: string, responseId: string, itemId: string = '1') => {
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
        streaming_metadata: {
          response_id: responseId
        }
      }
      
      console.log('[Streaming] Sending partial chunk:', { textLength: text.length, responseId })
      instance.messaging.addMessageChunk(chunk)
      return true
    } catch (err) {
      console.error('[Streaming] Failed to send partial chunk:', err)
      return false
    }
  }, [])

  /**
   * Send the complete item chunk (optional but good for accessibility)
   */
  const sendCompleteItem = useCallback((fullText: string, responseId: string, itemId: string = '1', wasStopped: boolean = false) => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
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
      
      console.log('[Streaming] Sending complete item:', { textLength: fullText.length, responseId, wasStopped })
      instance.messaging.addMessageChunk(chunk)
      return true
    } catch (err) {
      console.error('[Streaming] Failed to send complete item:', err)
      return false
    }
  }, [])

  /**
   * Send the final response chunk (REQUIRED to clear typing indicator)
   */
  const sendFinalResponse = useCallback((fullText: string, responseId: string) => {
    const instance = chatInstanceRef.current
    if (!instance?.messaging?.addMessageChunk) {
      return false
    }

    try {
      const finalResponse = {
        final_response: {
          id: responseId,
          output: {
            generic: [{
              response_type: MessageResponseTypes.TEXT,
              text: fullText
            }]
          }
        }
      }
      
      console.log('[Streaming] Sending final response:', { textLength: fullText.length, responseId })
      instance.messaging.addMessageChunk(finalResponse)
      return true
    } catch (err) {
      console.error('[Streaming] Failed to send final response:', err)
      return false
    }
  }, [])

  /**
   * Fallback: Send a complete message using addMessage (non-streaming)
   */
  const sendCompleteMessage = useCallback(async (text: string, isError: boolean = false) => {
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
        }
      }
      
      console.log('[Message] Sending complete message:', { textLength: text.length, isError })
      await instance.messaging.addMessage(message)
      return true
    } catch (err) {
      console.error('[Message] Failed to send message:', err)
      return false
    }
  }, [])

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
        }
      }
      
      await instance.messaging.addMessage(message)
      return true
    } catch (err) {
      console.error('[Message] Failed to send user-defined message:', err)
      return false
    }
  }, [])

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

    console.log('[Handler] Starting message handling:', { 
      supportsChunking, 
      responseId,
      messagePreview: message.substring(0, 50) 
    })

    try {
      // Make request to A2A proxy
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

      console.log('[Handler] Starting SSE stream processing...')

      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          console.log('[Handler] Stream finished. Accumulated text length:', streamingStateRef.current.accumulatedText.length)
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
                  sendFinalResponse(errorText, responseId)
                } else {
                  await sendCompleteMessage(errorText, true)
                }
                continue
              }

              if (data.result) {
                const result = data.result
                console.log('[Handler] A2A result:', { kind: result.kind, state: result.status?.state, final: result.final })

                // Handle status updates with agent messages
                if (result.kind === 'status-update' && result.status?.message) {
                  const agentMessage = result.status.message

                  for (const part of agentMessage.parts) {
                    // Handle text parts
                    if (part.kind === 'text' && part.text) {
                      const newText = part.text
                      
                      if (supportsChunking) {
                        // STREAMING MODE: Use addMessageChunk
                        streamingStateRef.current.accumulatedText += newText
                        streamingStateRef.current.hasStartedStreaming = true
                        
                        // Send partial chunk with the new text
                        sendPartialChunk(newText, responseId, itemId)
                        
                      } else {
                        // FALLBACK MODE: Accumulate text, send at end
                        streamingStateRef.current.accumulatedText += newText
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
                    
                    // Handle data parts
                    else if (part.kind === 'data' && part.data) {
                      await sendUserDefinedMessage({
                        type: 'structured_data',
                        data: part.data
                      })
                    }
                  }
                }

                // Check if stream is complete
                if (result.final === true) {
                  console.log('[Handler] Stream marked as final')
                  
                  const finalText = streamingStateRef.current.accumulatedText
                  
                  if (supportsChunking && streamingStateRef.current.hasStartedStreaming) {
                    // STREAMING MODE: Only send final_response (not complete_item to avoid duplicates)
                    // The final_response includes the text and clears the typing indicator
                    sendFinalResponse(finalText, responseId)
                    streamingStateRef.current.finalResponseSent = true
                  } else if (finalText) {
                    // FALLBACK MODE: Send accumulated text as single message
                    await sendCompleteMessage(finalText)
                    streamingStateRef.current.finalResponseSent = true
                  }
                  
                  console.log('[Handler] Final response sent, text length:', finalText.length)
                }
              }
            } catch (parseError) {
              if (!(parseError instanceof SyntaxError)) {
                throw parseError
              }
              console.warn('[Handler] Failed to parse SSE data:', dataStr.substring(0, 100))
            }
          }
        }
      }

      // Handle case where stream ends without explicit final=true
      const state = streamingStateRef.current
      if (state.accumulatedText && !state.hasStartedStreaming && !state.finalResponseSent) {
        // We accumulated text but never started streaming (fallback mode)
        console.log('[Handler] Stream ended without final flag, sending accumulated text')
        await sendCompleteMessage(state.accumulatedText)
      } else if (supportsChunking && state.hasStartedStreaming && !state.finalResponseSent) {
        // Streaming mode: ensure we sent final_response
        // (This is a safety net - normally final=true should trigger this)
        console.log('[Handler] Ensuring final_response was sent')
        sendFinalResponse(state.accumulatedText, responseId)
      }

    } catch (error) {
      console.error('[Handler] Error in message handling:', error)
      
      const errorMessage = `Sorry, there was an error communicating with the agent: ${error instanceof Error ? error.message : 'Unknown error'}`
      
      if (supportsChunking && streamingStateRef.current.hasStartedStreaming) {
        // End streaming with error
        sendFinalResponse(errorMessage, streamingStateRef.current.responseId || responseId)
      } else {
        await sendCompleteMessage(errorMessage, true)
      }
    } finally {
      setIsStreaming(false)
      streamingStateRef.current = {
        responseId: null,
        accumulatedText: '',
        hasStartedStreaming: false,
        supportsChunking: streamingStateRef.current.supportsChunking,
        finalResponseSent: false
      }
    }
  }, [agentUrl, apiKey, extensions, sendPartialChunk, sendCompleteItem, sendFinalResponse, sendCompleteMessage, sendUserDefinedMessage])

  // =============================================================================
  // CUSTOM RESPONSE RENDERER
  // =============================================================================

  const renderCustomResponse = useCallback((state: any, _instance: any) => {
    const messageItem = state.messageItem
    const userDefined = messageItem?.user_defined

    if (!userDefined) return null

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
      
      <ChatCustomElement
        className="chat-custom-element"
        debug={true}
        aiEnabled={true}
        openChatByDefault={true}
        layout={{
          showFrame: false
        }}
        header={{
          title: agentName
        }}
        onAfterRender={(instance: any) => {
          chatInstanceRef.current = instance
          
          // Log available methods for debugging
          console.log('[Init] Chat instance ready')
          console.log('[Init] Available messaging methods:', Object.keys(instance?.messaging || {}))
        }}
        renderUserDefinedResponse={renderCustomResponse}
        messaging={{
          customSendMessage: async (request: any, _options: any, _instance: any) => {
            if (request.input?.text) {
              await handleSendMessage(request.input.text)
            }
          }
        }}
      />
      
      {onDisconnect && (
        <button
          onClick={onDisconnect}
          className="disconnect-button"
          title="Disconnect from agent"
        >
          Disconnect
        </button>
      )}
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
