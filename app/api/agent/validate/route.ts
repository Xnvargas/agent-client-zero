import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { agentUrl } = await request.json()

    if (!agentUrl || typeof agentUrl !== 'string') {
      return NextResponse.json(
        { error: 'Agent URL is required' },
        { status: 400 }
      )
    }

    // Normalize URL
    let normalizedUrl = agentUrl.trim()
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'http://' + normalizedUrl
    }
    // Remove trailing slash
    normalizedUrl = normalizedUrl.replace(/\/$/, '')

    const cardUrl = `${normalizedUrl}/.well-known/agent-card.json`

    // Make server-side request to the agent (bypasses CORS)
    const response = await fetch(cardUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      // Set a reasonable timeout
      signal: AbortSignal.timeout(10000)
    })

    if (!response.ok) {
      return NextResponse.json(
        { 
          error: `Server returned ${response.status}: ${response.statusText}`,
          status: response.status 
        },
        { status: 502 }
      )
    }

    const card = await response.json()

    // Validate required fields
    if (!card.name || !card.url) {
      return NextResponse.json(
        { error: 'Invalid agent card: missing name or url field' },
        { status: 422 }
      )
    }

    return NextResponse.json({ card, normalizedUrl })
  } catch (error) {
    const err = error as Error

    // Handle different error types
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'Connection timed out. The agent may not be running or is unreachable.' },
        { status: 504 }
      )
    }

    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')) {
      return NextResponse.json(
        { error: 'Connection refused. Please ensure the agent server is running and the URL is correct.' },
        { status: 503 }
      )
    }

    if (err.message.includes('ENOTFOUND') || err.message.includes('getaddrinfo')) {
      return NextResponse.json(
        { error: 'Host not found. Please check the URL and try again.' },
        { status: 503 }
      )
    }

    console.error('Agent validation error:', err)
    return NextResponse.json(
      { error: err.message || 'Unknown error occurred while connecting to agent' },
      { status: 500 }
    )
  }
}
