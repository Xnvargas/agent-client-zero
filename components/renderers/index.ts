/**
 * UI Extension Renderers
 */

export { CitationRenderer } from './CitationRenderer'
export type {
  CitationRendererProps,
  TrajectoryRendererProps,
  ErrorRendererProps,
  FormRendererProps,
  ProcessedCitation,
  TextSegment,
} from './types'

export { processCitations, segmentTextWithCitations, getUniqueCitations } from './citation-utils'
