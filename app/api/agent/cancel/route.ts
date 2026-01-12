import { NextResponse } from 'next/server'

/**
 * A2A Task Cancellation Endpoint
 *
 * Sends a tasks/cancel JSON-RPC request to the A2A agent server
 * to stop a running task.
 */
export async function POST(request: Request) {
  try {
    const { agentUrl, apiKey, taskId } = await request.json() as {
      agentUrl: string
      apiKey?: string
      taskId: string
    }

    if (!agentUrl || !taskId) {
      return NextResponse.json(
        { error: 'Missing required fields: agentUrl, taskId' },
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

    // Build A2A cancel request per JSON-RPC spec
    const payload = {
      jsonrpc: '2.0',
      method: 'tasks/cancel',
      params: {
        id: taskId
      },
      id: `cancel-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    console.log('Sending A2A cancel request to:', normalizedUrl)
    console.log('Cancel payload:', JSON.stringify(payload, null, 2))

    const agentResponse = await fetch(normalizedUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000) // 10 second timeout for cancel
    })

    if (!agentResponse.ok) {
      const errorText = await agentResponse.text()
      console.error('Agent cancel response error:', errorText)
      return NextResponse.json(
        { error: `Cancel request failed: ${agentResponse.status} ${agentResponse.statusText}` },
        { status: agentResponse.status }
      )
    }

    const data = await agentResponse.json()
    console.log('Cancel response:', JSON.stringify(data, null, 2))

    return NextResponse.json(data)
  } catch (error) {
    console.error('Cancel request error:', error)

    // Handle timeout specifically
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'Cancel request timed out' },
        { status: 504 }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cancel failed' },
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
