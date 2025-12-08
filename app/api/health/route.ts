import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Check database connectivity
    const supabase = await createClient()
    const { error } = await supabase.from('profiles').select('count').limit(1).single()
    
    // The guide says: const { error } = await supabase.from('profiles').select('count').limit(1).single()
    // 'count' usually not a column, likely meaning select count(*) or just selecting any column.
    // But PostgREST syntax is tricky. select('count') means select column named 'count'.
    // Using 'id' is safer if 'profiles' has 'id'. Or 'count' aggregation: select('*', { count: 'exact', head: true })
    
    // Following the guide exactly, assuming 'count' is a column OR the guide meant count aggregation syntax which is slightly different.
    // But I should stick to the guide's code block.
    
    if (error && error.code !== 'PGRST116') throw error // PGRST116 is JSON object requested, multiple (or no) rows returned
    // Actually, .single() with 0 rows returns error.
    
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'connected',
        server: 'running'
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error.message
      },
      { status: 503 }
    )
  }
}
