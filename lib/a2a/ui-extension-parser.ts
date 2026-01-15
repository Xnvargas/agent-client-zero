/**
 * UI Extension Metadata Parser
 *
 * Parses metadata from agent responses to extract UI extension data
 * for rendering citations, trajectories, errors, forms, etc.
 *
 * Reference: https://github.com/i-am-bee/agentstack/blob/main/apps/agentstack-ui/src/api/a2a/utils.ts
 */

import { EXTENSION_URIS } from './extension-uris'

/**
 * Citation metadata structure
 * Reference: https://github.com/i-am-bee/agentstack/blob/main/apps/agentstack-sdk-ts/src/client/a2a/extensions/ui/citation.ts
 */
export interface Citation {
  url?: string | null
  start_index?: number | null
  end_index?: number | null
  title?: string | null
  description?: string | null
}

export interface CitationMetadata {
  citations: Citation[]
}

/**
 * Trajectory metadata structure
 * Reference: https://github.com/i-am-bee/agentstack/blob/main/apps/agentstack-sdk-ts/src/client/a2a/extensions/ui/trajectory.ts
 */
export interface TrajectoryMetadata {
  title?: string | null
  content?: string | null
  group_id?: string | null
}

/**
 * Error metadata structure
 */
export interface ErrorMetadata {
  message: string
  code?: string | null
  stacktrace?: string | null
  context?: Record<string, unknown> | null
}

/**
 * Form request metadata structure
 */
export interface FormField {
  id: string
  type: 'text' | 'date' | 'file' | 'single_select' | 'multi_select' | 'checkbox' | 'checkbox_group'
  label: string
  description?: string
  required?: boolean
  default_value?: unknown
  options?: Array<{ value: string; label: string }>
  col_span?: number
}

export interface FormRequestMetadata {
  title?: string
  description?: string
  columns?: number
  submit_label?: string
  fields: FormField[]
}

/**
 * Canvas edit request metadata
 */
export interface CanvasEditMetadata {
  artifact_id: string
  start_index: number
  end_index: number
  description: string
}

/**
 * Agent detail metadata
 */
export interface AgentDetailMetadata {
  interaction_mode?: 'single-turn' | 'multi-turn'
  user_greeting?: string
  version?: string
  framework?: string
  source_code_url?: string
  tools?: Array<{ name: string; description: string }>
  skills?: Array<{ id: string; name: string; description: string }>
  contributors?: Array<{ name: string; url?: string }>
}

/**
 * Parsed UI extensions from message metadata
 */
export interface ParsedUIExtensions {
  citations?: CitationMetadata
  trajectory?: TrajectoryMetadata
  error?: ErrorMetadata
  formRequest?: FormRequestMetadata
  canvas?: CanvasEditMetadata
  agentDetail?: AgentDetailMetadata
}

/**
 * Extract UI extension data from message metadata
 */
export function parseUIExtensions(metadata: Record<string, unknown> | undefined): ParsedUIExtensions {
  if (!metadata) return {}

  const result: ParsedUIExtensions = {}

  // Parse Citations
  const citationData = metadata[EXTENSION_URIS.CITATION]
  if (citationData && typeof citationData === 'object') {
    result.citations = citationData as CitationMetadata
  }

  // Parse Trajectory
  const trajectoryData = metadata[EXTENSION_URIS.TRAJECTORY]
  if (trajectoryData && typeof trajectoryData === 'object') {
    result.trajectory = trajectoryData as TrajectoryMetadata
  }

  // Parse Error
  const errorData = metadata[EXTENSION_URIS.ERROR]
  if (errorData && typeof errorData === 'object') {
    result.error = errorData as ErrorMetadata
  }

  // Parse Form Request
  const formData = metadata[EXTENSION_URIS.FORM_REQUEST]
  if (formData && typeof formData === 'object') {
    result.formRequest = formData as FormRequestMetadata
  }

  // Parse Canvas
  const canvasData = metadata[EXTENSION_URIS.CANVAS]
  if (canvasData && typeof canvasData === 'object') {
    result.canvas = canvasData as CanvasEditMetadata
  }

  // Parse Agent Detail
  const agentDetailData = metadata[EXTENSION_URIS.AGENT_DETAIL]
  if (agentDetailData && typeof agentDetailData === 'object') {
    result.agentDetail = agentDetailData as AgentDetailMetadata
  }

  return result
}

/**
 * Extract citations from message metadata
 * Convenience function for citation-specific extraction
 */
export function extractCitations(metadata: Record<string, unknown> | undefined): Citation[] {
  const parsed = parseUIExtensions(metadata)
  return parsed.citations?.citations || []
}

/**
 * Extract trajectory from message metadata
 * Convenience function for trajectory-specific extraction
 */
export function extractTrajectory(metadata: Record<string, unknown> | undefined): TrajectoryMetadata | null {
  const parsed = parseUIExtensions(metadata)
  return parsed.trajectory || null
}

/**
 * Extract error from message metadata
 */
export function extractError(metadata: Record<string, unknown> | undefined): ErrorMetadata | null {
  const parsed = parseUIExtensions(metadata)
  return parsed.error || null
}

/**
 * Extract form request from message metadata
 */
export function extractFormRequest(metadata: Record<string, unknown> | undefined): FormRequestMetadata | null {
  const parsed = parseUIExtensions(metadata)
  return parsed.formRequest || null
}
