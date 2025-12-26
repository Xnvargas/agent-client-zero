'use client'

import dynamic from 'next/dynamic'
import { useRef, useCallback } from 'react'
import { A2AClient, StreamChunk } from '@/lib/a2a/client'
import { A2AToCarbonTranslator } from '@/lib/translator/a2a-to-carbon'

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

interface FullScreenChatProps {
  agentUrl: string
  apiKey?: string
  agentName?: string
  onDisconnect?: () => void
}

export default function FullScreenChat({
  agentUrl,
  apiKey = '',
  agentName = 'AI Assistant',
  onDisconnect
}: FullScreenChatProps) {
  const chatInstanceRef = useRef<any>(null)
  const a2aClient = useRef(new A2AClient(agentUrl, apiKey))
  const translator = useRef(new A2AToCarbonTranslator())

  const handleSendMessage = useCallback(async (message: string) => {
    try {
      await a2aClient.current.streamMessage(message, async (chunk: StreamChunk) => {
        if (chunk.kind === 'status-update') {
          console.log('Agent status:', chunk.status?.state)
        }

        if (chunk.kind === 'artifact-update' && chunk.artifact) {
          const carbonMessages = translator.current.translateTask({
            id: chunk.taskId || 'unknown',
            status: { state: 'completed' },
            artifacts: [chunk.artifact],
            history: []
          })

          for (const carbonMessage of carbonMessages) {
            await chatInstanceRef.current?.messaging.addMessage(carbonMessage)
          }
        }
      })
    } catch (error) {
      console.error('Error sending message:', error)
      await chatInstanceRef.current?.messaging.addMessage({
        response_type: 'text',
        text: 'Sorry, there was an error communicating with the agent. Please try again.'
      })
    }
  }, [])

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

    return null
  }, [])

  return (
    <div className="full-screen-chat">
      <ChatCustomElement
        className="chat-custom-element"
        debug={false}
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
