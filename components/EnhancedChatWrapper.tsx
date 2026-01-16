'use client'

/**
 * EnhancedChatWrapper.tsx (FIXED VERSION)
 *
 * FIXES APPLIED:
 * 1. Added trajectory URI parsing from artifact/status metadata
 * 2. Added proper handling for DataPart tool_call/tool_result
 * 3. Improved chunk processing to check all metadata sources
 *
 * DOCUMENTATION REFERENCES:
 * - AgentStack trajectory extension: https://github.com/i-am-bee/agentstack/blob/main/apps/agentstack-sdk-py/src/agentstack_sdk/a2a/extensions/ui/trajectory.py
 * - Carbon AI Chat chain_of_thought: https://github.com/carbon-design-system/carbon-ai-chat/blob/main/examples/react/reasoning-and-chain-of-thought/src/scenarios.ts
 * - A2A Protocol streaming: https://github.com/a2aproject/a2a-python
 */

import dynamic from 'next/dynamic'
import { useRef, useCallback } from 'react'
import { A2AClient, StreamChunk, A2AMessagePart, extractCitations, type Citation } from '@/lib/a2a'
import {
  A2AToCarbonTranslator,
  CarbonMessage,
  ChainOfThoughtStepStatus
} from '@/lib/translator/a2a-to-carbon'
import { CitationRenderer } from './renderers'

const ChatContainer = dynamic(
  () => import('@carbon/ai-chat').then((mod) => mod.ChatContainer),
  { ssr: false }
)

interface EnhancedChatWrapperProps {
  agentUrl: string
  apiKey: string
}

// Extended A2A part with metadata support
interface A2APartWithMetadata extends A2AMessagePart {
  metadata?: {
    content_type?: 'thinking' | 'response' | 'status'
    [key: string]: unknown
  }
}

// Context for streaming parts including artifact metadata
interface StreamingContext {
  part: A2APartWithMetadata
  artifactMetadata?: Record<string, unknown>
}

export default function EnhancedChatWrapper({ agentUrl, apiKey }: EnhancedChatWrapperProps) {
  const chatInstanceRef = useRef<any>(null)
  const a2aClient = useRef(new A2AClient(agentUrl, { apiKey }))
  const translator = useRef(new A2AToCarbonTranslator())
  
  // Track active tool calls to update their status when results come in
  const activeToolCalls = useRef<Map<string, string>>(new Map()) // toolName -> messageId

  /**
   * Add a Carbon message to the chat UI
   */
  const addCarbonMessage = useCallback(async (carbonMessage: CarbonMessage) => {
    if (!chatInstanceRef.current?.messaging) {
      console.warn('Chat instance not ready')
      return null
    }

    try {
      const result = await chatInstanceRef.current.messaging.addMessage(carbonMessage)
      return result
    } catch (error) {
      console.error('Failed to add message:', error)
      return null
    }
  }, [])

  /**
   * Update an existing message in the chat UI
   */
  const updateCarbonMessage = useCallback(async (messageId: string, carbonMessage: CarbonMessage) => {
    if (!chatInstanceRef.current?.messaging) {
      console.warn('Chat instance not ready')
      return
    }

    try {
      // Try to update the message - this depends on Carbon AI Chat's API
      // If direct update isn't available, we may need to use other methods
      await chatInstanceRef.current.messaging.updateMessage?.(messageId, carbonMessage)
    } catch (error) {
      console.error('Failed to update message:', error)
    }
  }, [])

  /**
   * Process a streaming A2A part and translate it to Carbon format
   * @param part The A2A part to process
   * @param artifactMetadata Optional metadata from the artifact (for citations, trajectory, etc.)
   */
  const processStreamingPart = useCallback(async (part: A2APartWithMetadata, artifactMetadata?: Record<string, unknown>) => {
    // Check for metadata-based content types (thinking, response, status)
    if (part.metadata?.content_type) {
      const carbonMessage = translator.current.translateStreamingPart(part as any, artifactMetadata)
      if (carbonMessage) {
        await addCarbonMessage(carbonMessage)
      }
      return
    }

    // Check for data-based types (tool_call, tool_result)
    if (part.kind === 'data' && part.data) {
      const dataType = (part.data as any).type

      if (dataType === 'tool_call') {
        const toolName = (part.data as any).tool_name || 'tool'
        const carbonMessage = translator.current.translateStreamingPart(part as any, artifactMetadata)

        if (carbonMessage) {
          const result = await addCarbonMessage(carbonMessage)
          // Track this tool call so we can update it when the result comes
          if (result?.id) {
            activeToolCalls.current.set(toolName, result.id)
          }
        }
        return
      }
      return
    }

    // Check for content_type in part metadata
    if (part.metadata?.content_type) {
      const carbonMessage = translator.current.translateStreamingPart(part, artifactMetadata)
      if (carbonMessage) {
        await addCarbonMessage(carbonMessage)
      }
      return
    }

      if (dataType === 'tool_result') {
        const toolName = (part.data as any).tool_name || 'tool'
        const carbonMessage = translator.current.translateStreamingPart(part as any, artifactMetadata)

        if (carbonMessage) {
          // Check if we have an active tool call to update
          const existingMessageId = activeToolCalls.current.get(toolName)

          if (existingMessageId) {
            // Update the existing tool call with the result
            await updateCarbonMessage(existingMessageId, carbonMessage)
            activeToolCalls.current.delete(toolName)
          } else {
            // No existing tool call, add as new message
            await addCarbonMessage(carbonMessage)
          }
        }
        return
      }
    }

    // Handle standard text parts
    if (part.kind === 'text' && part.text) {
      const carbonMessage = translator.current.translateStreamingPart(part as any, artifactMetadata)
      if (carbonMessage) {
        await addCarbonMessage(carbonMessage)
      }
    }
  }, [addCarbonMessage, updateCarbonMessage])

  /**
   * Handle incoming stream chunks from the A2A agent
   */
  const handleStreamChunk = useCallback(async (chunk: StreamChunk) => {
    console.log('Received stream chunk:', chunk.kind)

    if (chunk.kind === 'status-update') {
      const state = chunk.status?.state
      console.log('Agent status:', state)

      // Handle status message if present
      if (chunk.status?.message?.parts) {
        // Get message metadata (may contain extension data)
        const messageMetadata = chunk.status.message.metadata
        for (const part of chunk.status.message.parts) {
          await processStreamingPart(part as A2APartWithMetadata, messageMetadata)
        }
      }
    }

    if (chunk.kind === 'artifact-update') {
      const artifact = chunk.artifact

      if (artifact?.parts) {
        // Get artifact metadata (may contain citations, trajectory, etc.)
        const artifactMetadata = artifact.metadata
        for (const part of artifact.parts) {
          await processStreamingPart(part as A2APartWithMetadata, artifactMetadata)
        }
      }
    }
  }, [processStreamingPart])

  /**
   * Send a message to the A2A agent
   */
  const handleSendMessage = useCallback(async (message: string) => {
    console.log('Sending message:', message)

    try {
      // Clear any stale tool call tracking
      activeToolCalls.current.clear()

      // Send to A2A agent with streaming
      await a2aClient.current.streamMessage(
        message,
        handleStreamChunk,
        () => {
          console.log('Stream completed')
          // Clear tool call tracking on completion
          activeToolCalls.current.clear()
        }
      )
    } catch (error) {
      console.error('Error sending message:', error)
      
      // Show error in chat
      await addCarbonMessage({
        response_type: 'text',
        text: `Error: ${error instanceof Error ? error.message : 'Failed to communicate with agent'}`
      })
    }
  }, [handleStreamChunk, addCarbonMessage])

  /**
   * Render custom/user-defined responses
   */
  const renderCustomResponse = useCallback((state: any) => {
    const messageItem = state.messageItem
    const userDefined = messageItem?.user_defined
    const metadata = messageItem?.metadata

    // Check for citation metadata first - render with CitationRenderer
    const citations = extractCitations(metadata)
    if (citations.length > 0 && messageItem?.text) {
      return (
        <CitationRenderer
          text={messageItem.text}
          citations={citations}
        />
      )
    }

    if (!userDefined) return null

    // Handle status messages
    if (userDefined.type === 'status_message') {
      return (
        <div className="text-sm text-gray-500 italic py-2">
          {userDefined.message}
        </div>
      )
    }

    // Handle images
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

    // Handle charts
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

    // Handle file attachments
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

    // Handle data tables
    if (userDefined.type === 'data_table') {
      return (
        <div className="overflow-x-auto">
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
                      {typeof row[col] === 'object' ? JSON.stringify(row[col]) : row[col]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    // Handle generic structured data
    if (userDefined.type === 'structured_data') {
      return (
        <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
          <code>{JSON.stringify(userDefined.data, null, 2)}</code>
        </pre>
      )
    }

    return null
  }, [])

  return (
    <div className="h-screen w-full">
      <ChatContainer
        debug={process.env.NODE_ENV === 'development'}
        aiEnabled={true}
        openChatByDefault={true}
        launcher={{ isOn: false }}
        header={{ title: 'AI Assistant' }}
        onAfterRender={(instance: any) => {
          chatInstanceRef.current = instance
        }}
        renderUserDefinedResponse={renderCustomResponse}
        messaging={{
          customSendMessage: async (request: any) => {
            if (request.input?.text) {
              await handleSendMessage(request.input.text)
            }
          }
        }}
      />
    </div>
  )
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
