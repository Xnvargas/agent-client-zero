import { NextResponse } from 'next/server'

/**
 * Generate a UUID v4 string with cross-environment compatibility
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15) >> (c === 'x' ? 0 : 3);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Extension configuration type for A2A requests
interface A2AExtensionConfig {
  settings?: {
    thinking_group?: {
      thinking?: boolean
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

export async function POST(request: Request) {
  try {
    const { agentUrl, apiKey, message, extensions } = await request.json() as {
      agentUrl: string
      apiKey?: string
      message: string
      extensions?: A2AExtensionConfig
    }

    if (!agentUrl || !message) {
      return NextResponse.json(
        { error: 'Missing required fields: agentUrl, message' },
        { status: 400 }
      )
    }

    // Normalize URL and append /jsonrpc/ endpoint
    let normalizedUrl = agentUrl.replace(/\/$/, '')
    if (!normalizedUrl.endsWith('/jsonrpc')) {
      normalizedUrl = `${normalizedUrl}/jsonrpc/`
    } else {
      normalizedUrl = `${normalizedUrl}/`
    }

    // Build the params object with message and optional extensions
    const params: Record<string, unknown> = {
      message: {
        role: 'user',
        messageId: generateUUID(),
        parts: [{ kind: 'text', text: message }]
      }
    }

    // Include extension configuration if provided
    // This allows the agent to access settings like thinking mode
    if (extensions && Object.keys(extensions).length > 0) {
      params.extensions = extensions
    }

    // Build the A2A streaming request payload per the official guide
    const payload = {
      jsonrpc: '2.0',
      method: 'message/stream',
      params,
      id: generateUUID()
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    }

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    console.log('Sending A2A request to:', normalizedUrl)
    console.log('Payload:', JSON.stringify(payload, null, 2))

    // Make the request to the external A2A agent server-side
    const agentResponse = await fetch(normalizedUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    })

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text()
      console.error('Agent response error:', errorText)
      return NextResponse.json(
        { error: `Agent request failed: ${agentResponse.status} ${agentResponse.statusText}` },
        { status: agentResponse.status }
      )
    }

    if (!agentResponse.body) {
      return NextResponse.json(
        { error: 'Agent response body is null' },
        { status: 500 }
      )
    }

    // Create a TransformStream to forward the SSE data
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const reader = agentResponse.body.getReader()
    const decoder = new TextDecoder()

    console.log('Starting stream forwarding...')
    console.log('A2A Response Content-Type:', agentResponse.headers.get('content-type'))

    // Forward the stream in the background with proper cleanup
    ;(async () => {
      try {
        let chunkCount = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            console.log(`Stream complete. Total chunks forwarded: ${chunkCount}`)
            await writer.close()
            break
          }
          chunkCount++
          const text = decoder.decode(value, { stream: true })
          console.log(`Chunk ${chunkCount} received (${value.length} bytes):`, text.substring(0, 200))

          try {
            await writer.write(value)
          } catch (writeError) {
            // Client disconnected - stop reading from upstream
            console.log('Client disconnected, stopping stream forwarding')
            break
          }
        }
      } catch (error) {
        console.error('Stream forwarding error:', error)
      } finally {
        // Always try to clean up both ends
        try {
          await reader.cancel()
          console.log('Upstream reader cancelled')
        } catch (e) {
          // Reader may already be closed
        }
        try {
          await writer.close()
        } catch (e) {
          // Writer may already be closed/aborted
          try {
            await writer.abort(e)
          } catch (abortError) {
            // Ignore - writer is already done
          }
        }
      }
    })()

    // Return the streaming response with appropriate headers
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Request-Id': payload.id as string
      }
    })
  } catch (error) {
    console.error('Stream proxy error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}
