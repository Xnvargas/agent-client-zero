/**
 * Types for UI extension renderers
 */

import type { Citation, TrajectoryMetadata, ErrorMetadata, FormRequestMetadata } from '@/lib/a2a'

/**
 * Processed citation for rendering
 * Includes computed display properties
 */
export interface ProcessedCitation extends Citation {
  id: string
  number: number // Citation number for display [1], [2], etc.
  highlightedText: string // The text segment this citation covers
}

/**
 * Text segment with optional citation reference
 */
export interface TextSegment {
  text: string
  citation?: ProcessedCitation
  isCited: boolean
}

/**
 * Props for CitationRenderer component
 */
export interface CitationRendererProps {
  text: string
  citations: Citation[]
  className?: string
}

/**
 * Props for TrajectoryRenderer component
 */
export interface TrajectoryRendererProps {
  steps: TrajectoryMetadata[]
  className?: string
}

/**
 * Props for ErrorRenderer component
 */
export interface ErrorRendererProps {
  error: ErrorMetadata
  className?: string
}

/**
 * Props for FormRenderer component
 */
export interface FormRendererProps {
  form: FormRequestMetadata
  onSubmit: (values: Record<string, unknown>) => void
  onCancel?: () => void
  className?: string
}
