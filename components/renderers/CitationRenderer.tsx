/**
 * Citation Renderer Component
 *
 * Renders text with inline citation highlights and a sources list.
 * Citations appear as highlighted text with superscript numbers.
 * Hovering shows a tooltip with source details.
 * Clicking navigates to the source URL.
 *
 * Reference: https://raw.githubusercontent.com/i-am-bee/agentstack/main/docs/development/agent-integration/citations.mdx
 */

'use client'

import React, { useState, useCallback } from 'react'
import type { CitationRendererProps, ProcessedCitation, TextSegment } from './types'
import { segmentTextWithCitations, getUniqueCitations, processCitations } from './citation-utils'

/**
 * Tooltip component for citation hover state
 */
interface CitationTooltipProps {
  citation: ProcessedCitation
  position: { x: number; y: number }
}

const CitationTooltip: React.FC<CitationTooltipProps> = ({ citation, position }) => {
  return (
    <div
      className="fixed z-50 max-w-xs p-3 bg-gray-900 text-white rounded-lg shadow-lg text-sm"
      style={{
        left: position.x,
        top: position.y + 20,
        transform: 'translateX(-50%)',
      }}
    >
      {citation.title && <div className="font-semibold mb-1">{citation.title}</div>}
      {citation.description && <div className="text-gray-300 text-xs mb-2">{citation.description}</div>}
      {citation.url && <div className="text-blue-300 text-xs truncate">{citation.url}</div>}
      <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 border-8 border-transparent border-b-gray-900" />
    </div>
  )
}

/**
 * Inline citation highlight component
 */
interface CitationHighlightProps {
  segment: TextSegment
  onHover: (citation: ProcessedCitation | null, event: React.MouseEvent) => void
}

const CitationHighlight: React.FC<CitationHighlightProps> = ({ segment, onHover }) => {
  if (!segment.isCited || !segment.citation) {
    return <span>{segment.text}</span>
  }

  const handleMouseEnter = (e: React.MouseEvent) => {
    onHover(segment.citation!, e)
  }

  const handleMouseLeave = () => {
    onHover(null, {} as React.MouseEvent)
  }

  const handleClick = () => {
    if (segment.citation?.url) {
      window.open(segment.citation.url, '_blank', 'noopener,noreferrer')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  return (
    <span
      className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/40 transition-colors rounded px-0.5"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Citation ${segment.citation.number}: ${segment.citation.title || 'Source'}`}
    >
      {segment.text}
      <sup className="text-xs font-semibold ml-0.5">[{segment.citation.number}]</sup>
    </span>
  )
}

/**
 * Sources list component
 */
interface SourcesListProps {
  citations: ProcessedCitation[]
}

const SourcesList: React.FC<SourcesListProps> = ({ citations }) => {
  const uniqueCitations = getUniqueCitations(citations)

  if (uniqueCitations.length === 0) {
    return null
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
      <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Sources</h4>
      <ol className="list-decimal list-inside space-y-1">
        {uniqueCitations.map((citation) => (
          <li key={citation.id} className="text-sm">
            <a
              href={citation.url || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {citation.title || citation.url || `Source ${citation.number}`}
            </a>
            {citation.description && (
              <span className="text-gray-500 dark:text-gray-400 ml-2">— {citation.description}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * Main Citation Renderer Component
 */
export const CitationRenderer: React.FC<CitationRendererProps> = ({ text, citations, className = '' }) => {
  const [hoveredCitation, setHoveredCitation] = useState<ProcessedCitation | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })

  const segments = segmentTextWithCitations(text, citations)
  const processedCitations = processCitations(text, citations)

  const handleHover = useCallback((citation: ProcessedCitation | null, event: React.MouseEvent) => {
    setHoveredCitation(citation)
    if (citation && event.currentTarget) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      setTooltipPosition({
        x: rect.left + rect.width / 2,
        y: rect.bottom,
      })
    }
  }, [])

  return (
    <div className={`relative ${className}`}>
      {/* Main text with citations */}
      <div className="prose dark:prose-invert max-w-none">
        {segments.map((segment, index) => (
          <CitationHighlight key={index} segment={segment} onHover={handleHover} />
        ))}
      </div>

      {/* Hover tooltip */}
      {hoveredCitation && <CitationTooltip citation={hoveredCitation} position={tooltipPosition} />}

      {/* Sources list */}
      <SourcesList citations={processedCitations} />
    </div>
  )
}

export default CitationRenderer
