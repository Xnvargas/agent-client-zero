/**
 * UI Extension Renderers
 */

export { CitationRenderer } from './CitationRenderer'
export { ErrorRenderer } from './ErrorRenderer'
export { FormRenderer } from './FormRenderer'
export type {
  CitationRendererProps,
  TrajectoryRendererProps,
  ErrorRendererProps,
  FormRendererProps,
  ProcessedCitation,
  TextSegment,
} from './types'

export { processCitations, segmentTextWithCitations, getUniqueCitations } from './citation-utils'
