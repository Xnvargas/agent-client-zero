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
  // Extension configuration to pass to the agent
  extensions?: A2AExtensionConfig
  // Whether to show thinking mode indicator
  showThinkingIndicator?: boolean
}

export default function FullScreenChat({
  agentUrl,
  apiKey = '',
  agentName = 'AI Assistant',
  onDisconnect,
  extensions,
  showThinkingIndicator = true
}: FullScreenChatProps) {
  const chatInstanceRef = useRef<any>(null)
  // Track agent status for UI indicators
  const [agentStatus, setAgentStatus] = useState<'idle' | 'working' | 'completed' | 'failed'>('idle')
  const [isThinking, setIsThinking] = useState(false)

  const handleSendMessage = useCallback(async (message: string) => {
    // Reset status at the start of a new message
    setAgentStatus('working')
    setIsThinking(false)

    try {
      // Use the proxy endpoint to avoid CORS issues
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentUrl,
          apiKey,
          message,
          // Include extension configuration for agent settings
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

      // Process the SSE stream per A2A guide
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      console.log('[DEBUG] Starting to read SSE stream...')

      while (true) {
        const { done, value } = await reader.read()
        console.log('[DEBUG] Read result - done:', done, 'value length:', value?.length || 0)
        if (done) {
          console.log('[DEBUG] Stream finished. Remaining buffer:', buffer)
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        console.log('[DEBUG] Decoded chunk:', chunk)
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        console.log('[DEBUG] Split into', lines.length, 'lines, buffer remainder:', buffer.length, 'chars')

        for (const line of lines) {
          const trimmedLine = line.trim()
          console.log('[DEBUG] Processing line:', trimmedLine.substring(0, 100))
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

              // Check for errors
              if (data.error) {
                console.error('A2A error:', data.error)
                await chatInstanceRef.current?.messaging.addMessage({
                  response: [{
                    response_type: 'text',
                    text: `Error: ${data.error.message}`
                  }]
                })
                continue
              }

              if (data.result) {
                const result = data.result
                console.log('A2A result:', result.kind, result.status?.state, result.final)

                // Update agent status based on stream state
                if (result.status?.state) {
                  setAgentStatus(result.status.state as 'working' | 'completed' | 'failed')
                }

                // Handle status updates with agent messages
                if (result.kind === 'status-update' && result.status?.message) {
                  const agentMessage = result.status.message
                  console.log('Agent message parts:', agentMessage.parts)

                  // Extract text from message parts
                  for (const part of agentMessage.parts) {
                    if (part.kind === 'text' && part.text) {
                      console.log('[DEBUG] Attempting to add message to chat UI...')
                      console.log('[DEBUG] Message text:', part.text)

                      // Detect thinking mode status messages
                      const isThinkingModeMessage =
                        part.text.toLowerCase().includes('thinking mode') ||
                        part.text.toLowerCase().includes("i'll show my reasoning")

                      if (isThinkingModeMessage) {
                        setIsThinking(true)
                        console.log('[DEBUG] Thinking mode detected')
                      }

                      // Check for error-like messages (e.g., settings not available)
                      const isErrorMessage =
                        part.text.toLowerCase().includes('error') ||
                        part.text.toLowerCase().includes("hasn't been activated") ||
                        part.text.toLowerCase().includes('not available')

                      try {
                        // Carbon Chat expects message with response array
                        const messagePayload = {
                          response: [{
                            response_type: isErrorMessage ? 'user_defined' : 'text',
                            ...(isErrorMessage
                              ? {
                                  user_defined: {
                                    type: 'status_message',
                                    messageType: 'warning',
                                    text: part.text
                                  }
                                }
                              : { text: part.text }
                            )
                          }]
                        }
                        console.log('[DEBUG] Message payload:', messagePayload)

                        await chatInstanceRef.current?.messaging.addMessage(messagePayload)
                        console.log('[DEBUG] addMessage completed')
                      } catch (addError) {
                        console.error('[DEBUG] addMessage error:', addError)
                      }
                    } else if (part.kind === 'file' && part.file) {
                      await chatInstanceRef.current?.messaging.addMessage({
                        response: [{
                          response_type: 'user_defined',
                          user_defined: {
                            type: 'file_attachment',
                            fileName: part.file.name,
                            mimeType: part.file.mimeType,
                            downloadUrl: part.file.uri || `data:${part.file.mimeType};base64,${part.file.bytes}`
                          }
                        }]
                      })
                    } else if (part.kind === 'data' && part.data) {
                      await chatInstanceRef.current?.messaging.addMessage({
                        response: [{
                          response_type: 'user_defined',
                          user_defined: {
                            type: 'structured_data',
                            data: part.data
                          }
                        }]
                      })
                    }
                  }
                }

                // Log status changes
                if (result.kind === 'status-update') {
                  console.log('Agent status:', result.status?.state)
                }

                // Check if stream is complete
                if (result.final === true) {
                  console.log('Stream completed with status:', result.status?.state)
                  setAgentStatus('completed')
                  setIsThinking(false)
                }
              }
            } catch (parseError) {
              if (!(parseError instanceof SyntaxError)) {
                throw parseError
              }
              console.warn('Failed to parse SSE data:', dataStr)
            }
          }
        }
      }
    } catch (error) {
      console.error('Error sending message:', error)
      setAgentStatus('failed')
      setIsThinking(false)
      await chatInstanceRef.current?.messaging.addMessage({
        response: [{
          response_type: 'user_defined',
          user_defined: {
            type: 'status_message',
            messageType: 'error',
            text: `Sorry, there was an error communicating with the agent: ${error instanceof Error ? error.message : 'Unknown error'}`
          }
        }]
      })
    }
  }, [agentUrl, apiKey, extensions])

  const renderCustomResponse = useCallback((state: any, instance: any) => {
    const messageItem = state.messageItem
    const userDefined = messageItem?.user_defined

    if (!userDefined) return null

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

    if (userDefined.type === 'structured_data') {
      return (
        <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto">
          <code>{JSON.stringify(userDefined.data, null, 2)}</code>
        </pre>
      )
    }

    // Handle status messages (warnings, errors, info)
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

  return (
    <div className="full-screen-chat">
      {/* Status indicator for agent state */}
      {showThinkingIndicator && agentStatus === 'working' && (
        <div className="agent-status-indicator">
          <div className="agent-status-indicator__content">
            <div className="agent-status-indicator__spinner" />
            <span>{isThinking ? 'Agent is thinking...' : 'Agent is working...'}</span>
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
        }}
        renderUserDefinedResponse={renderCustomResponse}
        messaging={{
          customSendMessage: async (request: any, options: any, instance: any) => {
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

function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
