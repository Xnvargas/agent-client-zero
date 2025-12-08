import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  // Retrieve user's agent API key from database
  const { data: config } = await supabase
    .from('agent_configs')
    .select('api_key, agent_url')
    .eq('user_id', user.id)
    .single()
  
  if (!config) {
    return NextResponse.json({ error: 'Agent not configured' }, { status: 400 })
  }
  
  // Use API key server-side only
  const body = await request.json()
  const agentResponse = await fetch(config.agent_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.api_key}`
    },
    body: JSON.stringify(body)
  })
  
  const data = await agentResponse.json()
  return NextResponse.json(data)
}
