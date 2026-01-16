/**
 * Citation processing utilities
 *
 * Reference: https://raw.githubusercontent.com/i-am-bee/agentstack/main/docs/development/agent-integration/citations.mdx
 */

import type { Citation } from '@/lib/a2a'
import type { ProcessedCitation, TextSegment } from './types'

/**
 * Generate unique ID for citation
 */
function generateCitationId(): string {
  return `cite-${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Process raw citations into renderable format
 * Assigns numbers and extracts highlighted text
 */
export function processCitations(text: string, citations: Citation[]): ProcessedCitation[] {
  // Sort by start_index to assign numbers in order of appearance
  const sortedCitations = [...citations]
    .filter((c) => c.start_index != null && c.end_index != null)
    .sort((a, b) => (a.start_index ?? 0) - (b.start_index ?? 0))

  return sortedCitations.map((citation, index) => ({
    ...citation,
    id: generateCitationId(),
    number: index + 1,
    highlightedText: text.substring(citation.start_index ?? 0, citation.end_index ?? text.length),
  }))
}

/**
 * Segment text into parts with and without citations
 * Returns array of segments for rendering
 */
export function segmentTextWithCitations(text: string, citations: Citation[]): TextSegment[] {
  const processedCitations = processCitations(text, citations)

  if (processedCitations.length === 0) {
    return [{ text, isCited: false }]
  }

  const segments: TextSegment[] = []
  let currentIndex = 0

  for (const citation of processedCitations) {
    const startIndex = citation.start_index ?? 0
    const endIndex = citation.end_index ?? text.length

    // Add non-cited text before this citation
    if (currentIndex < startIndex) {
      segments.push({
        text: text.substring(currentIndex, startIndex),
        isCited: false,
      })
    }

    // Add cited text segment
    segments.push({
      text: text.substring(startIndex, endIndex),
      citation,
      isCited: true,
    })

    currentIndex = endIndex
  }

  // Add remaining non-cited text
  if (currentIndex < text.length) {
    segments.push({
      text: text.substring(currentIndex),
      isCited: false,
    })
  }

  return segments
}

/**
 * Get unique citations (deduplicated by URL)
 */
export function getUniqueCitations(citations: ProcessedCitation[]): ProcessedCitation[] {
  const seen = new Set<string>()
  return citations.filter((citation) => {
    if (!citation.url || seen.has(citation.url)) {
      return false
    }
    seen.add(citation.url)
    return true
  })
}
