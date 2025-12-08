import { pipeline } from '@xenova/transformers'
import { createClient } from '@/lib/supabase/client'

class EmbeddingService {
  private model: any = null

  async initialize() {
    if (!this.model) {
      this.model = await pipeline(
        'feature-extraction',
        'Supabase/gte-small'
      )
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    await this.initialize()
    
    const output = await this.model(text, {
      pooling: 'mean',
      normalize: true,
    })
    
    return Array.from(output.data)
  }

  async searchSimilarMessages(
    query: string,
    conversationId?: string,
    threshold: number = 0.78,
    limit: number = 10
  ) {
    const queryEmbedding = await this.generateEmbedding(query)
    
    const supabase = createClient()
    const { data, error } = await supabase.rpc('match_messages', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
      conversation_filter: conversationId || null,
    })
    
    return { data, error }
  }
}

export const embeddingService = new EmbeddingService()
