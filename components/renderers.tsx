'use client'

/**
 * Custom renderers for Carbon AI Chat
 *
 * These components handle rendering of specialized content types
 * that come from A2A agents via AgentStack extensions.
 */

import React from 'react'
import type { Citation } from '@/lib/a2a'

/**
 * Props for CitationRenderer component
 */
interface CitationRendererProps {
  text: string
  citations: Citation[]
}

/**
 * CitationRenderer - Renders text with inline citation references
 *
 * This component takes text and an array of citations, rendering the text
 * with superscript citation markers and a footnote section with sources.
 */
export function CitationRenderer({ text, citations }: CitationRendererProps) {
  if (!citations.length) {
    return <span>{text}</span>
  }

  return (
    <div className="space-y-4">
      <div className="prose prose-sm max-w-none">
        {text}
        {citations.length > 0 && (
          <sup className="text-blue-600 ml-1">
            [{citations.map((_, i) => i + 1).join(', ')}]
          </sup>
        )}
      </div>

      <div className="border-t pt-3 mt-3">
        <div className="text-xs text-gray-500 mb-2 font-medium">Sources:</div>
        <div className="space-y-2">
          {citations.map((citation, index) => (
            <CitationItem
              key={index}
              citation={citation}
              index={index + 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Individual citation item component
 */
interface CitationItemProps {
  citation: Citation
  index: number
}

function CitationItem({ citation, index }: CitationItemProps) {
  const hasUrl = Boolean(citation.url)

  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-blue-600 font-medium min-w-[20px]">[{index}]</span>
      <div className="flex-1">
        {hasUrl ? (
          <a
            href={citation.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline font-medium"
          >
            {citation.title || citation.source || citation.url}
          </a>
        ) : (
          <span className="font-medium text-gray-700">
            {citation.title || citation.source || 'Unknown source'}
          </span>
        )}
        {citation.snippet && (
          <p className="text-gray-500 mt-0.5 line-clamp-2">{citation.snippet}</p>
        )}
      </div>
    </div>
  )
}

/**
 * Export all renderers
 */
export default {
  CitationRenderer,
}
