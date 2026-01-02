'use client'

import dynamic from 'next/dynamic'
import { useRef } from 'react'
import { A2AClient } from '@/lib/a2a/client'
import { A2AToCarbonTranslator } from '@/lib/translator/a2a-to-carbon'

const ChatContainer = dynamic(
  () => import('@carbon/ai-chat').then((mod) => mod.ChatContainer),
  { ssr: false }
)

export default function EnhancedChatWrapper({ agentUrl, apiKey }: { agentUrl: string; apiKey: string }) {
  const chatInstanceRef = useRef<any>(null)
  const a2aClient = useRef(new A2AClient(agentUrl, { apiKey }))
  const translator = useRef(new A2AToCarbonTranslator())

  const handleSendMessage = async (message: string) => {
    // Send to a2a agent with streaming
    await a2aClient.current.streamMessage(message, async (chunk: any) => {
      if (chunk.kind === 'status-update') {
        // Show typing indicator or status
        console.log('Agent status:', chunk.status.state)
      }

      if (chunk.kind === 'artifact-update') {
        const artifact = chunk.artifact
        
        // Translate artifact to Carbon message format
        const carbonMessages = translator.current.translateTask({
          id: chunk.taskId,
          status: { state: 'completed' },
          artifacts: [artifact],
          history: []
        })

        // Add each message to the chat
        for (const carbonMessage of carbonMessages) {
          await chatInstanceRef.current?.messaging.addMessage(carbonMessage)
        }
      }
    })
  }

  const renderCustomResponse = (state: any, instance: any) => {
    const messageItem = state.messageItem
    const userDefined = messageItem?.user_defined

    if (!userDefined) return null

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
          <img src={userDefined.imageUrl} className="w-full" />
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

    // Handle generic structured data
    if (userDefined.type === 'structured_data') {
      return (
        <pre className="bg-gray-100 p-4 rounded-lg overflow-x-auto">
          <code>{JSON.stringify(userDefined.data, null, 2)}</code>
        </pre>
      )
    }
  }

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return 'Unknown size'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="h-screen w-full">
      <ChatContainer
        debug={false}
        aiEnabled={true}
        openChatByDefault={true}
        launcher={{ isOn: false }}
        header={{ title: 'AI Assistant' }}
        onAfterRender={(instance) => {
          chatInstanceRef.current = instance
        }}
        renderUserDefinedResponse={renderCustomResponse}
        messaging={{
          customSendMessage: async (request, options, instance) => {
            if (request.input.text) {
              await handleSendMessage(request.input.text)
            }
          }
        }}
      />
    </div>
  )
}
